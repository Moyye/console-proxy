/* eslint-disable @typescript-eslint/ban-ts-comment */
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
import IORedis from 'ioredis';
import { parse as redisInfoParser } from 'redis-info';
import * as shellEscape from 'shell-escape';

const lookup = promisify(dns.lookup);
const readFile = promisify(fs.readFile);

enum KEYS {
  statusShell = 'statusShell',
  connectionSubMap = 'connectionSubMap',
  connectionId = 'connectionId',
  serverStatusLock = 'serverStatusLock',
}

@Injectable()
@WebSocketGateway()
export class Provider
  implements OnGatewayInit, OnGatewayConnection, OnGatewayDisconnect {
  private logger: Logger = new Logger('Provider');

  afterInit(): void {
    return this.logger.log(
      `Websocket server successfully started port:${process.env.PORT}`,
    );
  }

  async handleConnection(socket: ConsoleSocket): Promise<void> {
    this.logger.log(`Client connected, socketId: ${socket.id}`);
    socket.shellService = new Shell(socket);
    socket.sftpService = new Sftp(socket);
    socket.redisService = new Redis(socket);
    socket.serverStatusService = new ServerStatus(socket);
  }

  handleDisconnect(socket: ConsoleSocket) {
    this.logger.log(`Client disconnect, socketId: ${socket.id}`);

    socket.shellService.handleDisconnect();
    socket.sftpService.handleDisconnect();
    socket.redisService.handleDisconnect();
    socket.serverStatusService.handleDisconnect();
    socket.removeAllListeners();
  }

  @SubscribeMessage('terminal:preConnect')
  async preShellConnect(socket: ConsoleSocket, messageBody) {
    return socket.shellService.preConnect(messageBody);
  }

  @SubscribeMessage('terminal:new')
  async newShell(socket: ConsoleSocket, messageBody) {
    return socket.shellService.newShell(messageBody);
  }

  @SubscribeMessage('terminal:close')
  async closeShell(socket: ConsoleSocket, messageBody) {
    return socket.shellService.closeShell(messageBody);
  }

  @SubscribeMessage('terminal:disconnect')
  async terminalDisconnect(socket: ConsoleSocket, { id }) {
    return socket.shellService.handleDisconnect(id);
  }

  @SubscribeMessage('terminal:input')
  async shellInput(socket: ConsoleSocket, messageBody) {
    return socket.shellService.input(messageBody);
  }

  @SubscribeMessage('terminal:resize')
  async shellResize(socket: ConsoleSocket, messageBody) {
    return socket.shellService.resize(messageBody);
  }

  @SubscribeMessage('serverStatus:hasInit')
  async serverStatusHasInit(socket: ConsoleSocket, MessageBody) {
    const { init } = await socket.serverStatusService.hasInit(MessageBody);
    return init;
  }

  @SubscribeMessage('serverStatus:startFresh')
  async serverStatusStartFresh(socket: ConsoleSocket, MessageBody) {
    return socket.serverStatusService.startFresh(MessageBody);
  }

  @SubscribeMessage('serverStatus:serverStatus')
  async serverStatus(socket: ConsoleSocket, { id }) {
    return socket.serverStatusService.ServerStatus(id);
  }

  @SubscribeMessage('serverStatus:disconnect')
  async serverStatusDisConnect(socket: ConsoleSocket, { id }) {
    return socket.serverStatusService.handleDisconnect(id);
  }

  @SubscribeMessage('file:new')
  async newSftp(socket: ConsoleSocket, messageBody) {
    return socket.sftpService.newSftp({ ...messageBody, ...messageBody.data });
  }

  @SubscribeMessage('file:close')
  async closeSftp(socket: ConsoleSocket, messageBody) {
    return socket.sftpService.closeSftp(messageBody);
  }

  @SubscribeMessage('file:disconnect')
  async disconnectSftp(socket: ConsoleSocket, { id }) {
    return socket.sftpService.handleDisconnect(id);
  }

  @SubscribeMessage('file:list')
  async sftpReaddir(socket: ConsoleSocket, messageBody) {
    return socket.sftpService.sftpReaddir(messageBody);
  }

  @SubscribeMessage('file:touch')
  async touch(socket: ConsoleSocket, messageBody) {
    return socket.sftpService.touch(messageBody);
  }

  @SubscribeMessage('file:writeFile')
  async writeFile(socket: ConsoleSocket, messageBody) {
    return socket.sftpService.writeFile(messageBody);
  }

  @SubscribeMessage('file:writeFileByPath')
  async writeFileByPath(socket: ConsoleSocket, messageBody) {
    return socket.sftpService.writeFileByPath(messageBody);
  }

  @SubscribeMessage('file:writeFiles')
  async writeFiles(socket: ConsoleSocket, messageBody) {
    return socket.sftpService.writeFiles(messageBody);
  }

  @SubscribeMessage('file:getFile')
  async getFile(socket: ConsoleSocket, messageBody) {
    return socket.sftpService.getFile(messageBody);
  }

  @SubscribeMessage('file:getFiles')
  async getFiles(socket: ConsoleSocket, messageBody) {
    return socket.sftpService.getFiles(messageBody);
  }

  @SubscribeMessage('file:getFiles')
  async getFileByPath(socket: ConsoleSocket, messageBody) {
    return socket.sftpService.getFileByPath(messageBody);
  }

  @SubscribeMessage('file:getFilesByPath')
  async getFilesByPath(socket: ConsoleSocket, messageBody) {
    return socket.sftpService.getFilesByPath(messageBody);
  }

  @SubscribeMessage('file:rename')
  async rename(socket: ConsoleSocket, messageBody) {
    return socket.sftpService.rename(messageBody);
  }

  @SubscribeMessage('file:unlink')
  async unlink(socket: ConsoleSocket, messageBody) {
    return socket.sftpService.unlink(messageBody);
  }

  @SubscribeMessage('file:rmdir')
  async rmdir(socket: ConsoleSocket, messageBody) {
    return socket.sftpService.rmdir(messageBody);
  }

  @SubscribeMessage('file:rmrf')
  async rmrf(socket: ConsoleSocket, messageBody) {
    return socket.sftpService.rmrf(messageBody);
  }

  @SubscribeMessage('file:mkdir')
  async mkdir(socket: ConsoleSocket, messageBody) {
    return socket.sftpService.mkdir(messageBody);
  }

  @SubscribeMessage('redis:connect')
  async redisConnect(socket: ConsoleSocket, messageBody) {
    return socket.redisService.redisConnect(messageBody);
  }

  @SubscribeMessage('redis:disConnect')
  async redisDisConnect(socket: ConsoleSocket, { id }) {
    return socket.redisService.handleDisconnect(id);
  }

  @SubscribeMessage('redis:deleteKey')
  async deleteRedisKey(socket: ConsoleSocket, messageBody) {
    return socket.redisService.deleteRedisKey(messageBody);
  }

  @SubscribeMessage('redis:keys')
  async redisKeys(socket: ConsoleSocket, messageBody) {
    return socket.redisService.redisKeys(messageBody);
  }

  @SubscribeMessage('redis:hscan')
  async redisHScan(socket: ConsoleSocket, messageBody) {
    return socket.redisService.redisHScan(messageBody);
  }

  @SubscribeMessage('redis:sscan')
  async redisSScan(socket: ConsoleSocket, messageBody) {
    return socket.redisService.redisSScan(messageBody);
  }

  @SubscribeMessage('redis:command')
  async redisCommand(socket: ConsoleSocket, messageBody) {
    return socket.redisService.redisCommand(messageBody);
  }

  @SubscribeMessage('redis:info')
  async redisInfo(socket: ConsoleSocket, messageBody) {
    return socket.redisService.redisInfo(messageBody);
  }
}

class Base {
  static logger: Logger = new Logger('Base');
  connectionMap: Map<string, NodeSSH> = new Map();

  static exec(connection: NodeSSH, command: string, parameters: string[]) {
    return connection.exec(command, parameters);
  }

  static execs(connection: NodeSSH, command: string) {
    return connection.execCommand(command, {
      execOptions: {
        env: {
          HISTCONTROL: 'ignorespace',
          HISTIGNORE: '*',
          HISTSIZE: '0',
          HISTFILESIZE: '0',
          HISTFILE: '/dev/null',
        },
      },
    });
  }

  handleConnectionClose(nodeSSH: NodeSSH) {
    Base.logger.log('handleConnectionClose');
  }

  @WsErrorCatch()
  async preConnect({ ...config }) {
    try {
      await this.getConnection(config, undefined, 'preConnect');

      Base.logger.log(
        `[preConnect] connected, server: ${config.username}@${config.host}`,
      );
    } catch (error) {
      Base.logger.error('[preConnect] error', error.stack);
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

  async getConnection(
    configOrId?: ConnectionConfig | string,
    retryDelay?: number,
    debugfrom?: string,
  ): Promise<Undefinable<NodeSSH>> {
    if (typeof configOrId === 'string') {
      return this.connectionMap.get(configOrId);
    }

    const config = configOrId;

    const secretKey = md5(
      `${config.host}${config.username}${config.port}`,
    ).toString();

    if (config.password) {
      config.password = decrypt(config.password, secretKey);
    }
    if (config.privateKey) {
      config.privateKey = decrypt(config.privateKey, secretKey);
    }

    const connectionId = md5(
      `${config.host}${config.username}${config.port}${config.password}${config.privateKey}`,
    ).toString();

    const connectExist = this.connectionMap.get(connectionId);
    if (connectExist) return connectExist;

    if (retryDelay) {
      await sleep(retryDelay);
      return this.getConnection(config);
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
        tryKeyboard: true,
        keepaliveInterval: 10000,
        readyTimeout: 100000,
        ...config,
        host:
          config.host === 'linuxServer' ? process.env.TMP_SERVER : config.host,
        privateKey: config.privateKey || undefined,
      });

      // 方便读取 id, 避免重新计算
      _.set(connection, KEYS.connectionId, connectionId);
      _.set(connection, 'debugfrom', debugfrom);

      this.connectionMap.set(connectionId, connection);

      connection.connection?.on('error', (error) => {
        Base.logger.error('connection server error', error.stack);
        this.handleConnectionClose(connection);
      });
      connection.connection?.on('close', () => {
        Base.logger.warn('connection server close');
        this.handleConnectionClose(connection);
      });

      return connection;
    }

    return undefined;
  }
}

export class Shell extends Base {
  static logger: Logger = new Logger('Shell');
  private shellMap: Map<string, ClientChannel> = new Map();

  constructor(private socket: ConsoleSocket) {
    super();
  }

  @WsErrorCatch()
  async getShell(id: string, connection?: NodeSSH) {
    const sshExist = this.shellMap.get(id);
    if (sshExist) return sshExist;

    if (connection) {
      const shell = await connection.requestShell({
        term: 'xterm-256color',
      });
      this.shellMap.set(id, shell);

      // 可以根据 connection 找到 shell
      _.set(connection, `${KEYS.connectionSubMap}.${id}`, shell);

      // 可以根据 shell 获取 connection
      _.set(shell, KEYS.connectionId, connection);
      return shell;
    }

    return undefined;
  }

  @WsErrorCatch()
  async closeShell({ id }) {
    // i love you baby
    const shell = await this.getShell(id);
    if (shell) {
      shell.removeAllListeners();
      shell.close();
      this.shellMap.delete(id);
      Shell.logger.log(`[closeShell] shellId: ${id}`);

      // 获取 connection 如果没有其他的 shell 连接了就直接关闭
      const connection = _.get(shell, KEYS.connectionId);
      const connectionId = _.get(connection, KEYS.connectionId);
      const shells = _.get(connection, KEYS.connectionSubMap);
      // 剔除本次连接
      if (shells) {
        delete shells[id];
      }
      if (connection && connectionId) {
        setTimeout(() => {
          const shells = _.get(connection, KEYS.connectionSubMap);
          if (!shells) {
            // 如果没有直接关闭
            this.handleDisconnect(connectionId);
          }

          // 检查是否还有其他的连接，没有就关闭连接
          if (_.isEmpty(shells)) {
            this.handleDisconnect(connectionId);
          }
        }, 5000);
      }
    }
  }

  @WsErrorCatch()
  async newShell({ id, ...config }) {
    try {
      const connection = (await this.getConnection(
        config,
        undefined,
        'shell',
      ))!;

      // 初始化 terminal
      const shell = await this.getShell(id, connection);

      // @ts-ignore
      if (shell.errorMessage) {
        // @ts-ignore
        throw new Error(shell.errorMessage);
      }

      // 建立 terminal 监听
      shell.on('data', (data) => {
        this.socket.emit('terminal:data', { data: data.toString(), id });
      });
      shell.on('close', () => {
        this.closeShell({ id });

        this.socket.emit('terminal:data', {
          data: 'connection close\r\nwill reconnect after 2 second\r\n',
          id,
        });
        setTimeout(() => {
          this.socket.emit('terminal:reconnect', { id });
        }, 2 * 1000);
      });

      shell.on('error', (error) => {
        Shell.logger.error(
          `[shell]: ${config.host}${config.username} error`,
          error.stack(),
        );
      });

      Shell.logger.log(
        `[newShell] connected, server: ${config.username}@${config.host}`,
      );
    } catch (error) {
      Shell.logger.error('[newShell] error', error.stack);
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

  @WsErrorCatch()
  async input({ id, data }) {
    (await this.getShell(id))?.write(data);
  }

  @WsErrorCatch()
  async resize({ id, data: { cols, rows, height = 480, width = 640 } }) {
    (await this.getShell(id))?.setWindow(rows, cols, height, width);
  }

  handleDisconnect(connectionId?: string) {
    Shell.logger.log(
      `[handleDisconnect] connectionId: ${connectionId ? 'one' : 'all'}`,
    );
    if (connectionId) {
      const connection = this.connectionMap.get(connectionId);
      if (connection) {
        this.connectionMap.delete(connectionId);
        connection.dispose(true);
      }

      return;
    }

    this.connectionMap.forEach((connection, id) => {
      this.connectionMap.delete(id);
      connection.dispose(true);
    });

    this.shellMap.forEach((shell, id) => {
      shell.close();
      this.shellMap.delete(id);
    });
  }

  handleConnectionClose(connection: NodeSSH) {
    const connectionId = _.get(connection, KEYS.connectionId);
    Shell.logger.log(`[handleConnectionClose] connectionId: ${connectionId}`);
    this.handleDisconnect(connectionId);

    const shells = _.get(connection, KEYS.connectionSubMap);
    if (shells) {
      for (const [id, shell] of Object.entries(shells)) {
        Shell.logger.log(`[handleConnectionClose] shellId: ${id}`);

        // (shell as ClientChannel).emit('close');
      }
    }
  }
}

export class Sftp extends Base {
  static logger: Logger = new Logger('Sftp');
  private sftpMap: Map<string, SFTP> = new Map();

  constructor(private socket: ConsoleSocket) {
    super();
  }

  static sftpPromisify(sftpClient) {
    ['readdir', 'readFile', 'writeFile', 'rename', 'unlink', 'rmdir'].forEach(
      (method) => {
        sftpClient[method] = promisify(sftpClient[method]);
      },
    );

    return sftpClient;
  }

  @WsErrorCatch()
  async closeSftp({ id }) {
    const sftp = await this.sftpMap.get(id);
    if (sftp) {
      sftp.end();
      this.sftpMap.delete(id);
      Shell.logger.log(`[closeSftp] sftpId: ${id}`);
    }
  }

  @WsErrorCatch()
  async newSftp({ id, ...config }) {
    try {
      const connection = (await this.getConnection(config, undefined, 'sftp'))!;

      const sftp: unknown = await connection.requestSFTP();
      this.sftpMap.set(id, Sftp.sftpPromisify(sftp));
    } catch (error) {
      Sftp.logger.error('[newSftp] error', error.stack);
      return {
        success: false,
        errorMessage: error.message,
      };
    }

    return {
      data: true,
      errorMessage: '',
    };
  }

  @WsErrorCatch()
  async sftpReaddir({ id, data }) {
    let targetPath = data?.path;
    if (!targetPath || targetPath === '~') {
      const connection = await this.getConnection(id);
      if (!connection) return { errorMessage: '无法连接' };

      const { stdout } = await Base.execs(connection, 'pwd');
      targetPath = stdout || '/';
    }

    const sftp = this.sftpMap.get(id);
    if (!sftp) return { errorMessage: '无法连接' };

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

  @WsErrorCatch()
  async touch({ id, data: { remotePath } }) {
    const sftp = await this.sftpMap.get(id);
    if (!sftp) return { errorMessage: '无法连接' };

    await sftp.writeFile(remotePath, '');

    return {
      data: true,
    };
  }

  @WsErrorCatch()
  async writeFile({ id, data: { remotePath, buffer } }) {
    const sftp = await this.sftpMap.get(id);
    if (!sftp) return { errorMessage: '无法连接' };

    this.socket.emit(`file:uploaded:${id}`, {
      filepath: Path.basename(remotePath),
      process: 0.01,
    });

    await sftp.writeFile(remotePath, buffer);

    this.socket.emit(`file:uploaded:${id}`, {
      filepath: Path.basename(remotePath),
      process: 1,
    });

    return {
      data: true,
    };
  }

  @WsErrorCatch()
  async writeFileByPath({ id, data: { localDirectory, remoteDirectory } }) {
    const connection = await this.getConnection(id);
    if (!connection) return { errorMessage: '无法连接' };

    await connection.putDirectory(localDirectory, remoteDirectory, {
      concurrency: 5,
      transferOptions: {
        // @ts-ignore
        step: (
          total_transferred: number,
          chunk: number,
          total: number,
          localFile: string,
        ) => {
          this.socket.emit(`file:uploaded:${id}`, {
            filepath: localFile,
            process: Number.parseFloat((total_transferred / total).toFixed(3)),
          });
        },
      },
    });

    return {
      data: true,
    };
  }

  @WsErrorCatch()
  async writeFiles({ id, data: { files } }) {
    const connection = await this.getConnection(id);
    if (!connection) return { errorMessage: '无法连接' };

    await connection.putFiles(files, {
      concurrency: 5,
      transferOptions: {
        // @ts-ignore
        step: (
          total_transferred: number,
          chunk: number,
          total: number,
          localFile: string,
        ) => {
          this.socket.emit(`file:uploaded:${id}`, {
            filepath: localFile,
            process: Number.parseFloat((total_transferred / total).toFixed(3)),
          });
        },
      },
    });

    return {
      data: true,
    };
  }

  @WsErrorCatch()
  async getFile({ id, data: { remotePath } }) {
    const sftp = await this.sftpMap.get(id);
    if (!sftp) return { errorMessage: '无法连接' };

    const buffer = await sftp.readFile(remotePath, {});

    return {
      data: buffer,
    };
  }

  @WsErrorCatch()
  async getFiles(@MessageBody() { id, data: { remotePaths } }) {
    const connection = await this.getConnection(id);
    const sftp = await this.sftpMap.get(id);

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
    await Base.exec(connection, 'tar', tarFileStringArr);
    const buffer = await sftp.readFile(tarFilename, {});
    sftp.unlink(tarFilename).then();

    return {
      data: buffer,
    };
  }

  @WsErrorCatch()
  async getFileByPath({ id, data: { localDirectory, remoteDirectory } }) {
    const connection = await this.getConnection(id);
    if (!connection) return { errorMessage: '无法连接' };

    await connection.getDirectory(localDirectory, remoteDirectory, {
      concurrency: 5,
      transferOptions: {
        // @ts-ignore
        step: (
          total_transferred: number,
          chunk: number,
          total: number,
          remoteFile: string,
        ) => {
          this.socket.emit(`file:download:${id}`, {
            filepath: remoteFile,
            process: Number.parseFloat((total_transferred / total).toFixed(3)),
          });
        },
      },
    });

    return {
      data: true,
    };
  }

  @WsErrorCatch()
  async getFilesByPath({ id, data: { files } }) {
    const connection = await this.getConnection(id);
    if (!connection) return { errorMessage: '无法连接' };

    await connection.getFiles(files, {
      concurrency: 5,
      transferOptions: {
        // @ts-ignore
        step: (
          total_transferred: number,
          chunk: number,
          total: number,
          remoteFile: string,
        ) => {
          this.socket.emit(`file:download:${id}`, {
            filepath: remoteFile,
            process: Number.parseFloat((total_transferred / total).toFixed(3)),
          });
        },
      },
    });

    return {
      data: true,
    };
  }

  @WsErrorCatch()
  async rename({ id, data: { srcPath, destPath } }) {
    const sftp = await this.sftpMap.get(id);
    if (!sftp) return { errorMessage: '无法连接' };

    await sftp.rename(srcPath, destPath);

    return {
      data: true,
    };
  }

  @WsErrorCatch()
  async unlink(@MessageBody() { id, data: { remotePath } }) {
    const sftp = await this.sftpMap.get(id);
    if (!sftp) return { errorMessage: '无法连接' };

    await sftp.unlink(remotePath);

    return {
      data: true,
    };
  }

  @WsErrorCatch()
  async rmdir(@MessageBody() { id, data: { remotePath } }) {
    const sftp = await this.sftpMap.get(id);
    if (!sftp) return { errorMessage: '无法连接' };

    await sftp.rmdir(remotePath);

    return {
      data: true,
    };
  }

  @WsErrorCatch()
  async rmrf(@MessageBody() { id, data: { remotePath } }) {
    const connection = await this.getConnection(id);
    if (!connection) {
      return { errorMessage: '无法连接' };
    }

    const { stderr } = await Base.execs(connection, `rm -rf ${remotePath}`);
    if (stderr) {
      const sftp = await this.sftpMap.get(id);
      if (sftp) {
        await sftp.rmdir(remotePath);
      }
    }

    return {
      data: true,
    };
  }

  @WsErrorCatch()
  async mkdir(@MessageBody() { id, data: { remotePath } }) {
    const sftp = await this.sftpMap.get(id);
    if (!sftp) return { errorMessage: '无法连接' };

    await sftp.mkdir(remotePath, {});

    return {
      data: true,
    };
  }

  @WsErrorCatch()
  async serverStatus({ id }) {
    try {
      const sftp = await this.sftpMap.get(id);
      if (!sftp) return { errorMessage: '无法连接' };

      const file = await sftp.readFile('.terminal.icu/agent/status.txt', {});

      return { data: JSON.parse(file.toString()) };
    } catch (e) {
      return { data: {} };
    }
  }

  handleDisconnect(connectionId?: string) {
    Sftp.logger.log(
      `[handleDisconnect] connectionId: ${connectionId ? 'one' : 'all'}`,
    );
    if (connectionId) {
      const connection = this.connectionMap.get(connectionId);
      if (connection) {
        this.connectionMap.delete(connectionId);
        connection.dispose(true);
      }

      return;
    }

    this.connectionMap.forEach((connection, id) => {
      this.connectionMap.delete(id);
      connection.dispose(true);
    });

    this.sftpMap.forEach((sftp, id) => {
      sftp.end();
      this.sftpMap.delete(id);
    });
  }
}

export class Redis extends Base {
  static logger: Logger = new Logger('Redis');
  private redisMap: Map<string, IORedis.Redis> = new Map();

  constructor(private socket: ConsoleSocket) {
    super();
  }

  @WsErrorCatch()
  async redisConnect({
                       id,
                       host,
                       password,
                       initKeys = true,
                       port = 6379,
                       ...config
                     }) {
    Redis.logger.log(
      `[redisConnect] start ${id} initKeys: ${initKeys} ${host}`,
    );
    let redis: IORedis.Redis;

    redis = this.redisMap.get(id);
    if (redis) {
      Redis.logger.log('[redisConnect] connecting');
      // 正在连接
    } else {
      Redis.logger.log('[redisConnect] new redis');

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
            Redis.logger.log(`[redisConnect] error event ${error.message}`);
            await redis.quit();
            reject(error);
          });
          redis.on('connect', () => {
            Redis.logger.log(`[redisConnect] connect success event`);
            resolve(redis);
          });
          redis.on('close', () => {
            Redis.logger.log(`[redisConnect] close event`);
          });
        });
      } catch (error) {
        Redis.logger.log(`[redisConnect] error ${error.message}`);
        return {
          success: false,
          errorMessage: error.message,
        };
      }
      this.redisMap.set(id, redis);
    }

    return {
      success: true,
      data: initKeys ? (await this.redisKeys({ match: '*', id })).data : [],
    };
  }

  @WsErrorCatch()
  async deleteRedisKey(
    @MessageBody() { id, refreshKeys = true, keys, match, count, method },
  ) {
    Redis.logger.log(
      `redis:deleteKey start ${keys.map((v) => v.key).join(',')}`,
    );
    const redis = this.redisMap.get(id);
    if (!redis) return { errorMessage: 'redis 已断开连接' };

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

  @WsErrorCatch()
  async redisKeys({ id, match, needType = true, count = 500 }) {
    const redis = this.redisMap.get(id);
    if (!redis) return { errorMessage: 'redis 已断开连接', data: [] };

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

  @WsErrorCatch()
  async redisHScan(@MessageBody() { id, match, key, count = 500 }) {
    const redis = this.redisMap.get(id);
    if (!redis) return { errorMessage: 'redis 已断开连接' };

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

  @WsErrorCatch()
  async redisSScan(@MessageBody() { id, match, key, count = 500 }) {
    const redis = this.redisMap.get(id);
    if (!redis) return { errorMessage: 'redis 已断开连接' };

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

  @WsErrorCatch()
  async redisCommand(@MessageBody() { id, command, params }) {
    const redis = this.redisMap.get(id);
    if (!redis) return { errorMessage: 'redis disconnect' };

    try {
      const data = await redis[command](...params);
      return { success: true, data };
    } catch (e) {
      Redis.logger.error(`redis:command ${e.message}`);
      return { errorMessage: e.message };
    }
  }

  @WsErrorCatch()
  async redisInfo(@MessageBody() { id }) {
    const redis = this.redisMap.get(id);
    if (!redis) {
      return { errorMessage: 'redis disconnect' };
    }
    try {
      const [
        [, keyspace],
        [, info],
        [, [, databases]],
      ] = await redis
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
      Redis.logger.error(`redis:redisInfo ${e.message}`);
      return { errorMessage: e.message };
    }
  }

  @WsErrorCatch()
  async handleDisconnect(connectionId?: string) {
    Redis.logger.log(
      `[handleDisconnect] connectionId: ${connectionId ? 'one' : 'all'}`,
    );

    if (connectionId) {
      const redis = this.redisMap.get(connectionId);
      if (redis) {
        await redis.quit();
        redis.removeAllListeners();
        this.redisMap.delete(connectionId);
      }
      return;
    }

    this.redisMap.forEach((redis, id) => {
      redis.quit();
      redis.removeAllListeners();
      this.redisMap.delete(id);
    });
  }
}

export class ServerStatus extends Base {
  static logger: Logger = new Logger('ServerStatus');
  static NvmNodePath = '.terminal.icu/versions/node/v14.18.0/bin/node';
  connectionMap: Map<string, NodeSSH> = new Map();

  constructor(private socket: ConsoleSocket) {
    super();
  }

  private static async hasNode(connection: NodeSSH, command?: string) {
    // 检查本机 node 是否已经安装
    const { stdout } = await ServerStatus.execs(
      connection,
      command || 'node -v',
    );

    if (
      stdout &&
      Number.parseInt(stdout.replace('v', '').split('.')[0], 10) >= 8
    ) {
      return true;
    }
  }

  private static async hasNvmNode(connection: NodeSSH) {
    // 检查是否已经安装 nvm & node
    const { stdout } = await ServerStatus.execs(
      connection,
      `if [ -f "${ServerStatus.NvmNodePath}" ]; then echo 'exists' ;fi`,
    );

    if (stdout === 'exists') {
      return true;
    }
  }

  private static async sendLargeTextFile(
    connection: NodeSSH,
    files: { local: string; remote: string }[],
  ) {
    // 首先使用 sftp
    try {
      await connection.putFiles(files);
      return true;
    } catch (err1) {
      try {
        for (const file of files) {
          // 删除源文件
          await ServerStatus.execs(connection, `rm ${file.remote}`);

          const content = (await readFile(file.local))
            .toString()
            .split('\n')
            .reverse();
          const chunks: string[] = [];
          let counter = 0;
          let tmpChunk: string[] = [];

          while (content.length) {
            const chunk = content.pop();

            counter += chunk.length;
            tmpChunk.push(chunk);
            if (counter >= 1000) {
              chunks.push(tmpChunk.join('\n'));
              tmpChunk = [];
              counter = 0;
            }
          }

          if (tmpChunk.length) {
            chunks.push(tmpChunk.join('\n'));
          }

          chunks.reverse();
          while (chunks.length) {
            await ServerStatus.execs(
              connection,
              `echo ${shellEscape([chunks.pop()])} >> ${file.remote}`,
            );
          }
        }
      } catch (err2) {
        return false;
      }
    }
  }

  private static async installNode(connection: NodeSSH) {
    await ServerStatus.execs(connection, `mkdir -p .terminal.icu`);

    await ServerStatus.sendLargeTextFile(connection, [
      {
        local: Path.join(__dirname, 'detector/nvm.sh'),
        remote: '.terminal.icu/nvm.sh',
      },
    ]);

    // 官方
    this.logger.log('开始', 'nvm 官方安装 node');

    const officeResult = await ServerStatus.execs(
      connection,
      `source .terminal.icu/nvm.sh && nvm install 14.18.0`,
    );
    this.logger.log(officeResult, 'nvm 官方安装 node');

    // 淘宝
    if (!(await ServerStatus.hasNvmNode(connection))) {
      this.logger.log('开始', 'nvm 淘宝安装 node');

      const taobaoResult = await ServerStatus.execs(
        connection,
        `source .terminal.icu/nvm.sh && export NVM_NODEJS_ORG_MIRROR=https://npm.taobao.org/mirrors/node && nvm install 14.18.0`,
      );
      this.logger.log(taobaoResult, 'nvm 淘宝安装 node');
    }
  }

  private static async installJs(connection: NodeSSH) {
    await ServerStatus.execs(connection, `mkdir -p .terminal.icu`);

    await ServerStatus.sendLargeTextFile(connection, [
      {
        local: Path.join(__dirname, 'detector/base.js'),
        remote: '.terminal.icu/base.js',
      },
      {
        local: Path.join(__dirname, 'detector/info.js'),
        remote: '.terminal.icu/info.js',
      },
    ]);
  }

  handleDisconnect(connectionId?: string) {
    ServerStatus.logger.log(
      `[handleDisconnect] connectionId: ${connectionId ? 'one' : 'all'}`,
    );
    if (connectionId) {
      const connection = this.connectionMap.get(connectionId);
      if (connection) {
        this.connectionMap.delete(connectionId);
        connection.dispose(true);
      }

      return;
    }

    this.connectionMap.forEach((connection, id) => {
      this.connectionMap.delete(id);
      connection.dispose(true);
    });
  }

  @WsErrorCatch()
  async hasInit(config: ConnectionConfig) {
    const connection = await this.getConnection(config);

    return {
      init: await ServerStatus.hasNvmNode(connection),
    };
  }

  @WsErrorCatch()
  async startFresh(configOrConnection: ConnectionConfig | NodeSSH) {
    let connection: NodeSSH;
    if (configOrConnection instanceof NodeSSH) {
      connection = configOrConnection;
    } else {
      connection = await this.getConnection(configOrConnection);
    }

    if (_.get(connection, KEYS.serverStatusLock)) return;
    _.set(connection, KEYS.serverStatusLock, true);

    let nodePath = '';
    if (await ServerStatus.hasNvmNode(connection)) {
      nodePath = ServerStatus.NvmNodePath;
    }

    // 通过 nvm 安装 node
    if (!nodePath) {
      await ServerStatus.installNode(connection);
      // 再次检查是否安装 node
      if (await ServerStatus.hasNvmNode(connection)) {
        nodePath = ServerStatus.NvmNodePath;
      }
    }

    // 尝试使用本地 node
    if (!nodePath && (await ServerStatus.hasNode(connection))) {
      nodePath = 'node';
    }

    // 尝试使用旧版本
    if (
      !nodePath &&
      (await ServerStatus.hasNode(connection, '.terminal.icu/node/bin/node -v'))
    ) {
      nodePath = '.terminal.icu/node/bin/node';
    }
    // TODO 还是不行通过本地直接传送

    // 安装客户端
    if (nodePath) {
      await ServerStatus.installJs(connection);

      // 启动
      const statusShell = await connection.requestShell({
        env: {
          HISTIGNORE: '*',
          HISTSIZE: '0',
          HISTFILESIZE: '0',
          HISTCONTROL: 'ignorespace',
        },
      });
      statusShell.write(`${nodePath} .terminal.icu/info.js\r\n`);
      _.set(connection, KEYS.statusShell, statusShell);
      // statusShell.on('data', (data) => {
      //   console.log(data.toString());
      // });
    }
  }

  @WsErrorCatch()
  async ServerStatus(connectionId: string) {
    const connection = await this.getConnection(connectionId);
    if (!connection) {
      return { errorMessage: 'connectionNotFound' };
    }

    if (!connection.isConnected()) {
      await connection.reconnect();
      _.set(connection, KEYS.serverStatusLock, false);
      await this.startFresh(connection);
    }

    const { stdout } = await ServerStatus.execs(
      connection,
      'cat .terminal.icu/status.txt',
    );

    return { data: JSON.parse(stdout || '{}') };
  }
}

@Injectable()
export class Forward {
  private logger: Logger = new Logger('WebsocketGateway');

  private forwardConnectionMap: Map<string, NodeSSH> = new Map();

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
          host,
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
        const {
          id,
          config,
          remoteAddr,
          remotePort,
          localAddr,
          localPort,
        } = params;

        const connection = await new NodeSSH().connect(config);

        _.set(connection, '_config', params);

        connection.connection?.on('error', (error) => {
          this.logger.error('connection server error', error.stack);
        });
        connection.connection?.on('close', () => {
          this.logger.warn('connection close, and retry forward');
          setTimeout(async () => {
            // 移除原来的
            connection.dispose(true);
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
            connection.dispose(true);
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
          const socket = net.connect(localPort, localAddr, function() {
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
      connection.dispose(true);
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
}
