import { Injectable, Logger } from '@nestjs/common';
import { NodeSSH } from 'node-ssh';
import * as isValidDomain from 'is-valid-domain';
import { promisify } from 'util';
import * as dns from 'dns';
import * as net from 'net';
import { ForwardInParams } from './dto';
import * as _ from 'lodash';

const lookup = promisify(dns.lookup);

@Injectable()
export class ForwardService {
  private connectionMap: Map<string, NodeSSH> = new Map();
  private logger: Logger = new Logger('ForwardService');

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
    if (this.connectionMap.get(id)) {
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

      this.connectionMap.set(id, connection);

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
            this.connectionMap.delete(id);

            // 重新连接
            this.connectionMap.set(id, await this.forwardIn(params));
          }, 1000);
        });

        connection.connection.forwardIn(remoteAddr, remotePort, (err) => {
          if (err) {
            if (connection.connection) {
              connection.connection.removeAllListeners('close');
            }
            connection.dispose();
            this.logger.error(err);
            this.connectionMap.delete(id);
            reject(err);
            return;
          }
          this.logger.log(
            `forwardIn success, server: ${remoteAddr}:${remotePort} => ${localAddr}:${localPort}`,
          );
          resolve(connection);
          this.connectionMap.set(id, connection);
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
    const connection = this.connectionMap.get(id);
    if (connection) {
      const config: ForwardInParams = _.get(connection, '_config');
      connection.connection.removeAllListeners('close');
      connection.connection.unforwardIn(config.remoteAddr, config.remotePort);
      connection.dispose();
      this.connectionMap.delete(id);
      this.logger.log('unForward success');
    }
  }

  forwardStatus() {
    const status: Record<string, boolean> = {};

    this.connectionMap.forEach((connection, id) => {
      status[id] = connection.isConnected();
    });

    return status;
  }
}
