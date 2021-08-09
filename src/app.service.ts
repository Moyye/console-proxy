import { Injectable, Logger } from '@nestjs/common';
import {
  MessageBody,
  OnGatewayConnection,
  OnGatewayDisconnect,
  OnGatewayInit,
  SubscribeMessage,
  WebSocketGateway,
} from '@nestjs/websockets';
import { promisify } from 'util';
import * as Path from 'path';
import { Config as ConnectionConfig, NodeSSH } from './utils/nodeSSH';
import { ClientChannel } from 'ssh2';
import * as _ from 'lodash';
import * as moment from 'moment';
import { Undefinable } from 'tsdef';
import * as isValidDomain from 'is-valid-domain';
import * as dns from 'dns';
import * as net from 'net';
import { ConsoleSocket, SFTP } from './interface';
import { decrypt, md5, sleep, WsErrorCatch } from './utils/kit';
import { ForwardInParams } from './dto';
import * as fs from 'fs';
import fetch from 'node-fetch';
import IORedis from 'ioredis';
import { parse as redisInfoParser } from 'redis-info';

const lookup = promisify(dns.lookup);

enum KEYS {
  connectionId = '_connectionId',
  socket = '_socket',
  sftp = '_sftp',
  statusShell = '_statusShell',
  connection = '_connection',
  shellMap = '_shellMap',
  connectionMap = '_connectionMap',
  clearConnectionTimeoutHolder = '_clearConnectionTimeoutHolder',
  redisId = '_redisId',
  redisMap = '_redisMap',
}

@Injectable()
@WebSocketGateway()
export class AppService
  implements OnGatewayInit, OnGatewayConnection, OnGatewayDisconnect
{
  private logger: Logger = new Logger('WebsocketGateway');

  private connectionMap: Map<string, NodeSSH> = new Map();

  private forwardConnectionMap: Map<string, NodeSSH> = new Map();

  private shellMap: Map<string, ClientChannel> = new Map();

  private ftpMap: Map<string, SFTP> = new Map();

  private redisMap: Map<string, IORedis.Redis> = new Map();

  static sftpPromisify(sftpClient) {
    ['readdir', 'readFile', 'writeFile', 'rename', 'unlink', 'rmdir'].forEach(
      (method) => {
        sftpClient[method] = promisify(sftpClient[method]);
      },
    );

    return sftpClient;
  }

  private static execs(connection: NodeSSH, command: string) {
    return connection.execCommand(command, {
      execOptions: { env: { HISTIGNORE: '*' } },
    });
  }

  private static exec(
    connection: NodeSSH,
    command: string,
    parameters: string[],
  ) {
    return connection.exec(command, parameters);
  }

  async getSftp(
    connectionId: string | null,
    connection?: NodeSSH,
    retryDelay?: number,
  ): Promise<undefined | SFTP> {
    if (connectionId) {
      const sftpExist = this.ftpMap.get(connectionId);
      if (sftpExist) {
        return sftpExist;
      }

      if (retryDelay) {
        await sleep(retryDelay);
        return this.getSftp(connectionId, connection);
      }
    }

    if (connection) {
      const sftp: unknown = await connection.requestSFTP();
      const promiseSftp = AppService.sftpPromisify(sftp);
      if (connectionId) {
        this.ftpMap.set(connectionId, promiseSftp);
      }
      return promiseSftp as SFTP;
    }

    return undefined;
  }

  async getShell(id: string, connection?: NodeSSH) {
    const sshExist = this.shellMap.get(id);
    if (sshExist) {
      return sshExist;
    }
    if (connection) {
      const shell = await connection.requestShell({
        term: 'xterm-256color',
      });
      this.shellMap.set(id, shell);
      return shell;
    }

    return undefined;
  }

  handleDisconnect(socket: ConsoleSocket) {
    socket.removeAllListeners();

    // 断开 SSH
    const connectionMap: Record<string, NodeSSH> = _.get(
      socket,
      KEYS.connectionMap,
    );

    if (connectionMap) {
      for (const connection of Object.values(connectionMap)) {
        this.clearConnection(connection);
      }
    }

    // 断开 REDIS
    const redisMap: Record<string, IORedis.Redis> = _.get(
      socket,
      KEYS.redisMap,
    );

    if (redisMap) {
      for (const redis of Object.values(redisMap).filter(Boolean)) {
        redis.quit();
        this.redisMap.delete(_.get(redis, KEYS.redisId));
      }
    }

    this.logger.log(`Client disconnected: ${socket.id}`);
  }

  afterInit(): void {
    return this.logger.log(
      `Websocket server successfully started port:${process.env.PORT}`,
    );
  }

  async handleConnection(socket: ConsoleSocket): Promise<void> {
    socket.emit('login');
    this.logger.log(`Client connected, socketId: ${socket.id}`);
  }

  @SubscribeMessage('terminal:preConnect')
  @WsErrorCatch()
  async preSSHConnect(
    socket: ConsoleSocket,
    { host, username, password = '', privateKey = '', port = 22 },
  ) {
    const secretKey = md5(`${host}${username}${port}`).toString();

    if (password) {
      password = decrypt(password, secretKey);
    }
    if (privateKey) {
      privateKey = decrypt(privateKey, secretKey);
    }

    const connectionId = md5(
      `${host}${username}${port}${password}${privateKey}`,
    ).toString();

    try {
      await this.getConnection(connectionId, {
        host: host === 'linuxServer' ? process.env.TMP_SERVER : host,
        username,
        port,
        tryKeyboard: true,
        keepaliveInterval: 10000,
        ...(password && { password }),
        ...(privateKey && { privateKey }),
      });

      this.logger.log(`[preConnect] connected, server: ${username}@${host}`);
    } catch (error) {
      this.logger.error('[preConnect] error', error.stack);
      return {
        success: false,
        errorMessage: error.message,
      };
    }

    return {
      success: true,
      errorMessage: '',
    };
  }

  @SubscribeMessage('terminal:new')
  @WsErrorCatch()
  async newTerminal(
    socket: ConsoleSocket,
    { id, host, username, password = '', privateKey = '', port = 22 },
  ) {
    try {
      const secretKey = md5(`${host}${username}${port}`).toString();

      if (password) {
        password = decrypt(password, secretKey);
      }
      if (privateKey) {
        privateKey = decrypt(privateKey, secretKey);
      }

      const connectionId = md5(
        `${host}${username}${port}${password}${privateKey}`,
      ).toString();

      const connection = (await this.getConnection(connectionId, {
        host: host === 'linuxServer' ? process.env.TMP_SERVER : host,
        username,
        port,
        tryKeyboard: true,
        keepaliveInterval: 10000,
        ...(password && { password }),
        ...(privateKey && { privateKey }),
      }))!;

      // 初始化 sftp
      const sftp = (await this.getSftp(connectionId, connection))!;
      // 初始化 terminal
      const shell = (await this.getShell(id, connection))!;

      // connection <-> sftp
      _.set(connection, KEYS.sftp, sftp);
      _.set(sftp, KEYS.connection, connection);
      // connection <-> shell[]
      _.set(connection, `${KEYS.shellMap}.${id}`, shell);
      _.set(shell, KEYS.connection, connection);
      // socket <-> connection[]
      _.set(socket, `${KEYS.connectionMap}.${connectionId}`, connection);
      _.set(connection, KEYS.socket, socket);
      _.set(connection, KEYS.connectionId, connectionId);

      // 建立 terminal 监听
      shell.on('data', (data) => {
        socket.emit('terminal:data', { data: data.toString(), id });
      });
      shell.on('close', () => {
        if (connection.isConnected()) {
          this.closeTerminal({ id });
        }
        socket.emit('terminal:data', {
          data: '连接意外退出,重新连接中\r\n',
          id,
        });
        setTimeout(() => {
          socket.emit('terminal:reconnect', { id });
        }, 2 * 1000);
      });
      shell.on('error', (error) => {
        this.logger.error(`[shell]: ${host}${username} error`, error.stack());
      });

      this.logger.log(`[newTerminal] connected, server: ${username}@${host}`);
    } catch (error) {
      this.logger.error('[newTerminal] error', error.stack);
      return {
        success: false,
        errorMessage: error.message,
      };
    }

    return {
      success: true,
      errorMessage: '',
    };
  }

  @SubscribeMessage('terminal:close')
  @WsErrorCatch()
  async closeTerminal(@MessageBody() { id }) {
    const shell = await this.getShell(id);
    if (shell) {
      const connection: NodeSSH = _.get(shell, KEYS.connection);
      // const socket: ConsoleSocket = _.get(connection, KEYS.socket);
      const sshMap: Record<string, NodeSSH> = _.get(connection, KEYS.shellMap);

      shell.close();
      delete sshMap[id];
      this.shellMap.delete(id);
      this.logger.log(`[closeTerminal] socketId: ${id}`);

      if (_.isEmpty(sshMap)) {
        this.clearConnection(connection);
      }
    }
  }

  @SubscribeMessage('file:list')
  @WsErrorCatch()
  async list(@MessageBody() { id, data }) {
    let targetPath = data?.path;
    if (!targetPath || targetPath === '~') {
      const connection = await this.getConnection(id, undefined, 1000);
      if (!connection) {
        return { errorMessage: '无法连接' };
      }
      const { stdout } = await AppService.execs(connection, 'pwd');
      targetPath = stdout || '/';
    }

    const sftp = await this.getSftp(id, undefined, 1000);
    if (!sftp) {
      return { errorMessage: '无法连接' };
    }

    const originalList = await sftp.readdir(targetPath);
    const list = originalList
      .map((file: any) => {
        const createdAt = new Date(file.attrs.atime * 1000);
        const updatedAt = new Date(file.attrs.mtime * 1000);
        const isFile = file.attrs.isFile();
        return {
          createdAt,
          updatedAt,
          isFile,
          isDir: file.attrs.isDirectory(),
          filename: file.filename,
          size: file.attrs.size || 0,
          id: (targetPath + '/' + file.filename).replace('//', '/'),
        };
      })
      .filter((file) => file.isDir || file.isFile);

    return {
      data: {
        pwd: targetPath,
        fileEntries: list,
      },
    };
  }

  @SubscribeMessage('file:find')
  @WsErrorCatch()
  async find(@MessageBody() { id, data: { path, search } }) {
    let targetPath = path;
    const connection = await this.getConnection(id);
    if (!connection) {
      return { errorMessage: '无法连接' };
    }

    if (!path) {
      const { stdout } = await AppService.execs(connection, 'pwd');
      targetPath = stdout;
    }

    const { stdout } = await AppService.execs(
      connection,
      `find ${targetPath} -type f -name "*${search}*" | head -20`,
    );
    return {
      data: stdout.split('\n'),
    };
  }

  @SubscribeMessage('terminal:resize')
  @WsErrorCatch()
  async resize(
    @MessageBody() { id, data: { cols, rows, height = 480, width = 640 } },
  ) {
    (await this.getShell(id))?.setWindow(rows, cols, height, width);
  }

  @SubscribeMessage('terminal:input')
  @WsErrorCatch()
  async input(@MessageBody() { id, data }) {
    (await this.getShell(id))?.write(data);
  }

  @SubscribeMessage('file:touch')
  @WsErrorCatch()
  async touch(@MessageBody() { id, data: { remotePath } }) {
    const sftp = await this.getSftp(id);
    if (!sftp) {
      return { errorMessage: '无法连接' };
    }
    await sftp.writeFile(remotePath, '');

    return {
      data: true,
    };
  }

  @SubscribeMessage('file:serverStatus')
  @WsErrorCatch()
  async serverStatus(@MessageBody() { id }) {
    const connection = await this.getConnection(id, undefined, 1000);
    if (!connection) {
      return { errorMessage: '无法连接' };
    }
    if (!connection.isConnected()) {
      this.clearConnection(connection);
    }

    try {
      const sftp = await this.getSftp(id);
      if (!sftp) {
        return { errorMessage: '无法连接' };
      }
      const file = await sftp.readFile('.terminal.icu/agent/status.txt', {});

      return { data: JSON.parse(file.toString()) };
    } catch (e) {
      return { data: {} };
    }
  }

  @SubscribeMessage('file:writeFile')
  @WsErrorCatch()
  async writeFile(@MessageBody() { id, data: { remotePath, buffer } }) {
    const sftp = await this.getSftp(id);
    if (!sftp) {
      return { errorMessage: '无法连接' };
    }

    await sftp.writeFile(remotePath, buffer);

    return {
      data: true,
    };
  }

  @SubscribeMessage('file:getFile')
  @WsErrorCatch()
  async getFile(@MessageBody() { id, data: { remotePath } }) {
    const sftp = await this.getSftp(id);
    if (!sftp) {
      return { errorMessage: '无法连接' };
    }

    const buffer = await sftp.readFile(remotePath, {});

    return {
      data: buffer,
    };
  }

  @SubscribeMessage('file:getFiles')
  @WsErrorCatch()
  async getFiles(@MessageBody() { id, data: { remotePaths } }) {
    const connection = await this.getConnection(id);
    const sftp = await this.getSftp(id);

    if (!sftp || !connection) {
      return { errorMessage: '无法连接' };
    }

    const tarFilename = `/tmp/${moment().format('YYYYMMDDHHmmss')}.tar.gz`;
    const tarFileStringArr: string[] = ['-czf', tarFilename];
    remotePaths.forEach((item) => {
      tarFileStringArr.push('-C');
      tarFileStringArr.push(item.path);
      tarFileStringArr.push(item.filename);
    });
    await AppService.exec(connection, 'tar', tarFileStringArr);
    const buffer = await sftp.readFile(tarFilename, {});
    sftp.unlink(tarFilename).then();

    return {
      data: buffer,
    };
  }

  @SubscribeMessage('file:rename')
  @WsErrorCatch()
  async rename(@MessageBody() { id, data: { srcPath, destPath } }) {
    const sftp = await this.getSftp(id);
    if (!sftp) {
      return { errorMessage: '无法连接' };
    }

    await sftp.rename(srcPath, destPath);

    return {
      data: true,
    };
  }

  @SubscribeMessage('file:unlink')
  @WsErrorCatch()
  async unlink(@MessageBody() { id, data: { remotePath } }) {
    const sftp = await this.getSftp(id);
    if (!sftp) {
      return { errorMessage: '无法连接' };
    }

    await sftp.unlink(remotePath);

    return {
      data: true,
    };
  }

  @SubscribeMessage('file:rmdir')
  @WsErrorCatch()
  async rmdir(@MessageBody() { id, data: { remotePath } }) {
    const sftp = await this.getSftp(id);
    if (!sftp) {
      return { errorMessage: '无法连接' };
    }

    await sftp.rmdir(remotePath);

    return {
      data: true,
    };
  }

  @SubscribeMessage('file:rmrf')
  @WsErrorCatch()
  async rmrf(@MessageBody() { id, data: { remotePath } }) {
    const connection = await this.getConnection(id);
    if (!connection) {
      return { errorMessage: '无法连接' };
    }

    const { stderr } = await AppService.execs(
      connection,
      `rm -rf ${remotePath}`,
    );
    if (stderr) {
      const sftp = await this.getSftp(id);
      await sftp.rmdir(remotePath);
    }

    return {
      data: true,
    };
  }

  @SubscribeMessage('file:mkdir')
  @WsErrorCatch()
  async mkdir(@MessageBody() { id, data: { remotePath } }) {
    const sftp = await this.getSftp(id);
    if (!sftp) {
      return { errorMessage: '无法连接' };
    }

    await sftp.mkdir(remotePath, {});

    return {
      data: true,
    };
  }

  ping(): string {
    return 'pong';
  }

  async newForwardIn({
    id,
    host,
    username,
    password = '',
    privateKey = '',
    port = 22,
    remotePort,
    localAddr,
    localPort,
  }) {
    // 已经处理过，不再处理
    if (this.forwardConnectionMap.get(id)) {
      return { success: true, errorMessage: '' };
    }

    try {
      if (isValidDomain(host, { allowUnicode: true })) {
        try {
          const { address } = await lookup(host);
          host = address;
        } catch (e) {
          // nothing
        }
      }

      const connection = await this.forwardIn({
        id,
        config: {
          host: host === 'linuxServer' ? process.env.TMP_SERVER : host,
          username,
          port,
          tryKeyboard: true,
          ...(password && { password }),
          ...(privateKey && { privateKey }),
          keepaliveInterval: 10000,
        },
        remoteAddr: host,
        remotePort,
        localAddr,
        localPort,
      });

      this.forwardConnectionMap.set(id, connection);

      this.logger.log(`[newForwardOut] connected, server: ${username}@${host}`);
    } catch (error) {
      this.logger.error('[newForwardOut] error', error.stack);
      return { success: false, errorMessage: error.message };
    }

    return { success: true, errorMessage: '' };
  }

  async forwardIn(params: ForwardInParams) {
    return new Promise<NodeSSH>(async (resolve, reject) => {
      try {
        const { id, config, remoteAddr, remotePort, localAddr, localPort } =
          params;

        const connection = await new NodeSSH().connect(config);

        _.set(connection, '_config', params);

        connection.connection?.on('error', (error) => {
          this.logger.error('connection server error', error.stack);
        });
        connection.connection?.on('close', () => {
          this.logger.warn('connection close, and retry forward');
          setTimeout(async () => {
            // 移除原来的
            connection.dispose();
            this.forwardConnectionMap.delete(id);

            // 重新连接
            this.forwardConnectionMap.set(id, await this.forwardIn(params));
          }, 1000);
        });

        connection.connection.forwardIn(remoteAddr, remotePort, (err) => {
          if (err) {
            if (connection.connection) {
              connection.connection.removeAllListeners('close');
            }
            connection.dispose();
            this.logger.error(err);
            this.forwardConnectionMap.delete(id);
            reject(err);
            return;
          }
          this.logger.log(
            `forwardIn success, server: ${remoteAddr}:${remotePort} => ${localAddr}:${localPort}`,
          );
          resolve(connection);
          this.forwardConnectionMap.set(id, connection);
        });

        connection.connection.on('tcp connection', (info, accept) => {
          const stream = accept().pause();
          const socket = net.connect(localPort, localAddr, function () {
            socket.on('error', (error) => {
              console.log('forward tcp error', error);
            });
            stream.pipe(socket);
            socket.pipe(stream);
            stream.resume();
          });
        });
      } catch (error) {
        reject(error);
      }
    });
  }

  unForward(id: string) {
    const connection = this.forwardConnectionMap.get(id);
    if (connection) {
      const config: ForwardInParams = _.get(connection, '_config');
      connection.connection.removeAllListeners('close');
      connection.connection.unforwardIn(config.remoteAddr, config.remotePort);
      connection.dispose();
      this.forwardConnectionMap.delete(id);
      this.logger.log('unForward success');
    }
  }

  forwardStatus() {
    const status: Record<string, boolean> = {};

    this.forwardConnectionMap.forEach((connection, id) => {
      status[id] = connection.isConnected();
    });

    return status;
  }

  //  分割线
  @SubscribeMessage('redis:connect')
  @WsErrorCatch()
  async redisConnect(
    socket: ConsoleSocket,
    { id, initKeys = true, host, port = 6379, password, ...config },
  ) {
    this.logger.log(`[newRedis] start ${id} initKeys: ${initKeys} ${host}`);
    let redis: IORedis.Redis;

    redis = this.redisMap.get(id);
    if (redis) {
      this.logger.log('[newRedis] connecting');
      // 正在连接
    } else {
      this.logger.log('[newRedis] new redis');

      // 新建连接
      const secretKey = md5(`${host}${port}`).toString();
      if (password) {
        password = decrypt(password, secretKey);
      }

      try {
        await new Promise((resolve, reject) => {
          redis = new IORedis({
            ...config,
            host,
            port,
            password,
          });
          redis.on('error', async (error) => {
            this.logger.log(`[newRedis] error event ${error.message}`);
            await redis.quit();
            reject(error);
          });
          redis.on('connect', () => {
            this.logger.log(`[newRedis] connect success event`);
            resolve(redis);
          });
          redis.on('close', () => {
            this.logger.log(`[newRedis] close event`);
          });
        });
      } catch (error) {
        this.logger.log(`[newRedis] error ${error.message}`);
        return {
          success: false,
          errorMessage: error.message,
        };
      }
      this.redisMap.set(id, redis);
      _.set(redis, KEYS.redisId, id);
      _.set(socket, `${KEYS.redisMap}.${id}`, redis);
    }

    return {
      success: true,
      data: initKeys ? (await this.redisKeys({ match: '*', id })).data : [],
    };
  }

  @SubscribeMessage('redis:disConnect')
  @WsErrorCatch()
  async redisDisConnect(socket: ConsoleSocket, { id }) {
    this.logger.log(`redis:disConnect`);
    const redis = this.redisMap.get(id);
    this.redisMap.delete(id);
    _.set(socket, `${KEYS.redisMap}.${id}`, undefined);
    if (redis) {
      redis.removeAllListeners();
      await redis.quit();
    }

    return {
      success: true,
    };
  }

  @SubscribeMessage('redis:deleteKey')
  @WsErrorCatch()
  async deleteRedisKey(
    @MessageBody() { id, refreshKeys = true, keys, match, count, method },
  ) {
    this.logger.log('redis:deleteKey start', keys.map((v) => v.key).join(','));
    const redis = this.redisMap.get(id);
    if (!redis) {
      return { errorMessage: 'redis 已断开连接' };
    }

    method = method === 'unlink' ? 'unlink' : 'del';

    await Promise.all([
      // 普通的 key
      Promise.all(
        keys.filter((v) => v.isLeaf).map((v) => redis[method](v.key).catch()),
      ),
      // 前缀 key
      Promise.all(
        keys
          .filter((v) => !v.isLeaf)
          .map((v) => {
            return new Promise((resolve) => {
              if (!v.key) {
                resolve(true);
                return;
              }

              const stream = redis.scanStream({
                match: `${v.key}:*`,
                count: 50,
              });

              stream.on('data', async (resultKeys) => {
                stream.pause();
                await Promise.all(resultKeys.map((key) => redis[method](key)));
                stream.resume();
              });
              stream.on('end', () => resolve(true));
              stream.on('error', () => resolve(true));
            });
          }),
      ),
    ]);

    return {
      success: true,
      data: refreshKeys
        ? (await this.redisKeys({ match, id, count })).data
        : [],
    };
  }

  @SubscribeMessage('redis:keys')
  @WsErrorCatch()
  async redisKeys(@MessageBody() { id, match, needType = true, count = 500 }) {
    const redis = this.redisMap.get(id);
    if (!redis) {
      return { errorMessage: 'redis 已断开连接', data: [] };
    }

    let cursor: undefined | string = undefined;
    const result: string[] = [];
    while (cursor !== '0' && result.length < count) {
      const [currentCursor, currentResult] = await redis.scan(
        cursor || '0',
        'match',
        match || '*',
        'count',
        50,
      );

      cursor = currentCursor;
      result.push(...currentResult);
    }

    const keys = _.uniq(_.flatten(result));
    if (!needType) {
      return {
        success: true,
        data: keys.map((v) => ({ key: v })),
      };
    }

    const pipeline = redis.pipeline();
    keys.forEach((key) => pipeline.type(key));
    const types = await pipeline.exec();
    return {
      success: true,
      data: keys.map((key, index) => ({
        key,
        type: types[index][1],
      })),
    };
  }

  @SubscribeMessage('redis:hscan')
  @WsErrorCatch()
  async redisHScan(@MessageBody() { id, match, key, count = 500 }) {
    const redis = this.redisMap.get(id);
    if (!redis) {
      return { errorMessage: 'redis 已断开连接' };
    }

    let cursor: undefined | string = undefined;
    const result: string[] = [];
    while (cursor !== '0' && result.length / 2 < count) {
      const [currentCursor, currentResult] = await redis.hscan(
        key,
        cursor || '0',
        'match',
        match || '*',
        'count',
        50,
      );

      cursor = currentCursor;
      result.push(...currentResult);
    }

    return {
      success: true,
      data: result,
    };
  }

  @SubscribeMessage('redis:sscan')
  @WsErrorCatch()
  async redisSScan(@MessageBody() { id, match, key, count = 500 }) {
    const redis = this.redisMap.get(id);
    if (!redis) {
      return { errorMessage: 'redis 已断开连接' };
    }

    let cursor: undefined | string = undefined;
    const result: string[] = [];
    while (cursor !== '0' && result.length < count) {
      const [currentCursor, currentResult] = await redis.sscan(
        key,
        cursor || '0',
        'match',
        match || '*',
        'count',
        50,
      );

      cursor = currentCursor;
      result.push(...currentResult);
    }

    return {
      success: true,
      data: result,
    };
  }

  @SubscribeMessage('redis:command')
  @WsErrorCatch()
  async redisCommand(@MessageBody() { id, command, params }) {
    const redis = this.redisMap.get(id);
    if (!redis) {
      return { errorMessage: 'redis disconnect' };
    }

    try {
      const data = await redis[command](...params);
      return { success: true, data };
    } catch (e) {
      this.logger.error(e, 'redis:command');
      return { errorMessage: e.message };
    }
  }

  @SubscribeMessage('redis:info')
  @WsErrorCatch()
  async redisInfo(@MessageBody() { id }) {
    const redis = this.redisMap.get(id);
    if (!redis) {
      return { errorMessage: 'redis disconnect' };
    }
    try {
      const [[, keyspace], [, info], [, [, databases]]] = await redis
        .pipeline()
        .info('keyspace')
        .info()
        .config('get', 'databases')
        .exec();
      const parseInfo = redisInfoParser(info);
      return {
        success: true,
        data: {
          databases: Number.parseInt(databases),
          keyspace: _.pick(redisInfoParser(keyspace), ['databases']),
          cpu: _.pick(parseInfo, ['used_cpu_sys', 'used_cpu_user']),
          memory: _.pick(parseInfo, [
            'maxmemory',
            'used_memory',
            'total_system_memory',
          ]),
          server: _.pick(parseInfo, ['redis_version', 'uptime_in_days']),
          clients: _.pick(parseInfo, ['connected_clients', 'blocked_clients']),
          time: Date.now(),
        },
      };
    } catch (e) {
      this.logger.error(e, 'redis:command');
      return { errorMessage: e.message };
    }
  }

  //  分割线
  private async getConnection(
    connectId: string,
    config?: ConnectionConfig,
    retryDelay?: number,
  ): Promise<Undefinable<NodeSSH>> {
    const connectExist = this.connectionMap.get(connectId);
    if (connectExist) {
      const timeoutHolder = _.get(
        connectExist,
        KEYS.clearConnectionTimeoutHolder,
      );
      if (timeoutHolder) {
        this.logger.log(`[getConnection] reuse ${connectId}`);
        _.set(connectExist, KEYS.clearConnectionTimeoutHolder, undefined);
        clearTimeout(timeoutHolder);
      }
      return connectExist;
    }

    if (retryDelay) {
      await sleep(retryDelay);
      return this.getConnection(connectId, config);
    }

    if (config) {
      if (isValidDomain(config.host, { allowUnicode: true })) {
        try {
          const { address } = await lookup(config.host);
          config.host = address;
        } catch (e) {
          // nothing
        }
      }
      const connection = await new NodeSSH().connect({
        ...config,
        algorithms: {
          kex: [
            'curve25519-sha256',
            'curve25519-sha256@libssh.org',
            'ecdh-sha2-nistp256',
            'ecdh-sha2-nistp384',
            'ecdh-sha2-nistp521',
            'diffie-hellman-group-exchange-sha256',
            'diffie-hellman-group14-sha256',
            'diffie-hellman-group15-sha512',
            'diffie-hellman-group16-sha512',
            'diffie-hellman-group17-sha512',
            'diffie-hellman-group18-sha512',
            'diffie-hellman-group-exchange-sha1',
            'diffie-hellman-group14-sha1',
            'diffie-hellman-group1-sha1',
          ],
          serverHostKey: [
            'ssh-ed25519',
            'ecdsa-sha2-nistp256',
            'ecdsa-sha2-nistp384',
            'ecdsa-sha2-nistp521',
            'rsa-sha2-512',
            'rsa-sha2-256',
            'ssh-rsa',
            'ssh-dss',
          ],
          cipher: [
            'chacha20-poly1305@openssh.com',
            'aes128-gcm',
            'aes128-gcm@openssh.com',
            'aes256-gcm',
            'aes256-gcm@openssh.com',
            'aes128-ctr',
            'aes192-ctr',
            'aes256-ctr',
            '3des-cbc',
            'aes256-cbc',
            'aes192-cbc',
            'aes128-cbc',
            'arcfour256',
            'arcfour128',
            'arcfour',
            'blowfish-cbc',
            'cast128-cbc',
          ],
          hmac: [
            'hmac-sha2-256-etm@openssh.com',
            'hmac-sha2-512-etm@openssh.com',
            'hmac-sha1-etm@openssh.com',
            'hmac-sha2-256',
            'hmac-sha2-512',
            'hmac-sha1',
            'hmac-md5',
            'hmac-sha2-256-96',
            'hmac-sha2-512-96',
            'hmac-ripemd160',
            'hmac-sha1-96',
            'hmac-md5-96',
          ],
        },
      });

      connection.connection?.on('error', (error) => {
        this.logger.error('connection server error', error.stack);
        this.clearConnection(connection, true);
      });
      connection.connection?.on('close', () => {
        this.logger.warn('connection server close');
        this.clearConnection(connection, true);
      });
      this.connectionMap.set(connectId, connection);
      this.initAgent(connection).then();

      return connection;
    }

    return undefined;
  }

  private clearConnection(connection: NodeSSH, force = false) {
    const shellMap: Record<string, ClientChannel> = _.get(
      connection,
      KEYS.shellMap,
    );
    if (shellMap) {
      _.set(connection, KEYS.shellMap, undefined);
      for (const [id, shell] of Object.entries(shellMap)) {
        this.shellMap.delete(id);
        shell.close();
      }
    }

    const clearConnectionTimeoutHolder = setTimeout(
      () => {
        const connectionId = _.get(connection, KEYS.connectionId);
        const socket: ConsoleSocket = _.get(connection, KEYS.socket);

        // 清除刷新状态的的 shell
        const statusShell: ClientChannel = _.get(connection, KEYS.statusShell);
        if (statusShell) {
          statusShell.close();
        }

        // 清除 sftp
        this.ftpMap.delete(connectionId);
        const sftp: SFTP = _.get(connection, KEYS.sftp);
        if (sftp) {
          _.set(connection, KEYS.sftp, undefined);
          sftp.end();
        }

        delete socket[connectionId];
        this.connectionMap.delete(connectionId);
        connection.dispose();

        this.logger.log(`[clearConnection] connectionId: ${connectionId}`);
      },
      force ? 0 : 10 * 1000,
    );

    _.set(
      connection,
      KEYS.clearConnectionTimeoutHolder,
      clearConnectionTimeoutHolder,
    );
  }

  private async initAgent(connection: NodeSSH) {
    this.logger.log('[initAgent] start');
    try {
      if (_.get(connection, '_initAgentLock')) return;
      _.set(connection, '_initAgentLock', true);

      let nodePath = '';
      // 检查node是否已经安装
      const nativeNode = await AppService.execs(connection, 'node -v');

      if (
        nativeNode.stdout &&
        Number.parseInt(nativeNode.stdout.replace('v', '').split('.')[0], 10) >=
          8
      ) {
        nodePath = 'node';
      }

      if (!nodePath) {
        // 初始化 node
        const checkIsInitNode = await AppService.execs(
          connection,
          '.terminal.icu/node/bin/node -v',
        );
        if (checkIsInitNode.stdout) {
          nodePath = '.terminal.icu/node/bin/node';
        }

        if (!checkIsInitNode.stdout) {
          await AppService.execs(connection, 'mkdir -p .terminal.icu/agent');

          this.logger.log('[initAgent] install node start');
          // 传送检查脚本
          await connection.putFile(
            Path.join(__dirname, 'detector/detect-node.sh'),
            '.terminal.icu/agent/detect-node.sh',
          );

          const { stdout: nodeRelease, stderr } = await AppService.execs(
            connection,
            'bash .terminal.icu/agent/detect-node.sh',
          );

          if (stderr) {
            throw new Error(`[initAgent] bash not support ${stderr}`);
          }

          const nodeVersion = nodeRelease.split('-')[1];
          this.logger.log(`[initAgent] install node version ${nodeRelease}`);

          // 尝试外网安装，速度快，不限速
          this.logger.log(`[initAgent] install node use wget`);
          const data = await AppService.execs(
            connection,
            'cd .terminal.icu' +
              `&& wget --timeout=10 http://npm.taobao.org/mirrors/node/${nodeVersion}/${nodeRelease}`,
          );

          if (data.stderr && !data.stderr.includes('100%')) {
            this.logger.log(`[initAgent] install node use sftp`);

            // 无法访问外网，则代下载并发送
            // 判断文件是否存在
            const fileExists = fs.existsSync(
              Path.join(__dirname, `node/${nodeRelease}`),
            );
            if (!fileExists) {
              if (!fs.existsSync(Path.join(__dirname, `node`))) {
                fs.mkdirSync(Path.join(__dirname, `node`));
              }
              // 下载
              await fetch(
                `http://npm.taobao.org/mirrors/node/${nodeVersion}/${nodeRelease}`,
              )
                .then((res) => res.buffer())
                .then((buffer) => {
                  fs.writeFileSync(
                    Path.join(__dirname, `node/${nodeRelease}`),
                    buffer,
                  );
                });
            }

            try {
              await connection.putFile(
                Path.join(__dirname, `node/${nodeRelease}`),
                `.terminal.icu/${nodeRelease}`,
              );
            } catch (error) {
              this.logger.error('[init agent] error', error);
              throw error;
            }
          }

          // 解压缩
          const compressResult = await AppService.execs(
            connection,
            'cd .terminal.icu' +
              `&& tar -xzf ${nodeRelease}` +
              `&& rm ${nodeRelease}` +
              `&& rm -rf node` +
              `&& mv ${nodeRelease.replace('.tar.gz', '')} node`,
          );

          if (!compressResult.stderr) {
            nodePath = '.terminal.icu/node/bin/node';
          }
          this.logger.log(
            '[init agent] compressResult',
            JSON.stringify(compressResult),
          );
        }
      }

      // 初始化脚本
      try {
        await AppService.execs(connection, 'mkdir -p .terminal.icu/agent');
      } catch (e) {}

      await connection.putFiles(
        [
          {
            local: Path.join(__dirname, 'detector/base.js'),
            remote: '.terminal.icu/agent/base.js',
          },
          {
            local: Path.join(__dirname, 'detector/linuxInfo.js'),
            remote: '.terminal.icu/agent/linuxInfo.js',
          },
        ],
        { concurrency: 2 },
      );

      // 初始化监控
      if (nodePath) {
        const statusShell = await connection.requestShell({
          env: { HISTIGNORE: '*' },
        });
        statusShell.write(`${nodePath} .terminal.icu/agent/linuxInfo.js\r\n`);
        _.set(connection, KEYS.statusShell, statusShell);
        // statusShell.on('data', (data) => {
        //   console.log(data.toString());
        // });
      }
      this.logger.log('[initAgent] done');
    } catch (error) {
      this.logger.error('[initAgent] error', error.stack);
    }
  }
}
