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
import { Config as ConnectionConfig, NodeSSH } from 'node-ssh';
import { ClientChannel } from 'ssh2';
import * as _ from 'lodash';
import * as moment from 'moment';
import { Undefinable } from 'tsdef';
import * as isValidDomain from 'is-valid-domain';
import * as dns from 'dns';

const lookup = promisify(dns.lookup);

import { ConsoleSocket, SFTP } from './interface';
import { decrypt, md5, sleep, WsErrorCatch } from './utils/kit';

enum KEYS {
  connectionId = '__id',
  socket = '_socket',
  sftp = '_sftp',
  statusShell = '_statusShell',
  connection = '_connection',
  shellMap = '_shellMap',
  connectionMap = '_connectionMap',
  clearConnectionTimeoutHolder = '_clearConnectionTimeoutHolder',
}

@Injectable()
@WebSocketGateway()
export class AppService
  implements OnGatewayInit, OnGatewayConnection, OnGatewayDisconnect
{
  private logger: Logger = new Logger('WebsocketGateway');

  private connectionMap: Map<string, NodeSSH> = new Map();

  private shellMap: Map<string, ClientChannel> = new Map();

  private ftpMap: Map<string, SFTP> = new Map();

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

  ping(): string {
    return 'pong';
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
    const connectionMap: Record<string, NodeSSH> = _.get(
      socket,
      KEYS.connectionMap,
    );
    if (connectionMap) {
      for (const connection of Object.values(connectionMap)) {
        this.clearConnection(connection);
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
      this.logger.error('[newTerminal ] error', error.stack);
      return false;
    }

    return true;
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
      targetPath = stdout;
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
          id: targetPath + '/' + file.filename,
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
    const connection = await this.getConnection(id);
    if (!connection) {
      return { errorMessage: '无法连接' };
    }

    await AppService.execs(connection, `touch ${remotePath}`);

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

    const { stdout: statusStr = '' } = await AppService.execs(
      connection,
      'cat .terminal.icu/agent/status.txt',
    );
    if (!statusStr) {
      return { errorMessage: 'agent 初始化失败' };
    }

    return {
      data: JSON.parse(statusStr),
    };
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

    await AppService.execs(connection, `rm -rf ${remotePath}`);

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
      const connection = await new NodeSSH().connect(config);

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
    try {
      if (_.get(connection, '_initAgentLock')) return;
      _.set(connection, '_initAgentLock', true);

      // 初始化 node
      const checkNodeResult = await AppService.execs(
        connection,
        '.terminal.icu/node/bin/node -v',
      );
      if (!checkNodeResult.stdout) {
        let arch = 'x64';
        const { stdout } = await AppService.execs(connection, 'uname -m');
        if (stdout.includes('x86') || stdout.includes('x64')) {
          arch = 'x64';
        } else if (stdout.includes('amd64') || stdout.includes('arm64')) {
          arch = 'arm64';
        } else if (stdout.includes('armv7l') || stdout.includes('arm32')) {
          arch = 'armv7l';
        }

        const data = await AppService.execs(
          connection,
          'mkdir -p .terminal.icu' +
            '&& cd .terminal.icu' +
            `&& wget http://npm.taobao.org/mirrors/node/v14.16.0/node-v14.16.0-linux-${arch}.tar.xz -q` +
            `&& tar -xvf node-v14.16.0-linux-${arch}.tar.xz` +
            `&& rm node-v14.16.0-linux-${arch}.tar.xz` +
            `&& mv node-v14.16.0-linux-${arch} node`,
        );
        if (data.stderr) {
          await connection.execCommand(
            `echo ${data.stderr} > .terminal.icu/error.txt`,
          );
        }
      }

      // 初始化脚本
      await AppService.execs(connection, 'mkdir -p .terminal.icu/agent');
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
      let nodeExists = false;
      if (checkNodeResult.stdout) {
        nodeExists = true;
      } else {
        const checkNodeResult2 = await AppService.execs(
          connection,
          '.terminal.icu/node/bin/node -v',
        );
        if (checkNodeResult2.stdout) {
          nodeExists = true;
        }
      }

      if (nodeExists) {
        const statusShell = await connection.requestShell();
        statusShell.write(
          '.terminal.icu/node/bin/node .terminal.icu/agent/linuxInfo.js\r\n',
        );
        _.set(connection, KEYS.statusShell, statusShell);
      }
    } catch (error) {
      this.logger.error('[initAgent] error', error.stack);
    }
  }
}
