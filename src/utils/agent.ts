import { SocksClient } from 'socks';
import { request } from 'http';
import * as url from 'url';

interface ProxyOpt {
  targetHost: string;
  targetPort: number;
  readyTimeout: number;
}

export const createAgentSockets = async (
  agent: string,
  { readyTimeout, targetHost, targetPort }: ProxyOpt,
) => {
  const urlResult = url.parse(agent);

  if (urlResult.protocol.includes('socks')) {
    const info = await SocksClient.createConnection({
      proxy: {
        userId: urlResult.auth,
        password: urlResult.auth,
        host: urlResult.hostname,
        port: Number.parseInt(urlResult.port),
        type: urlResult.protocol.includes('4') ? 4 : 5,
      },
      command: 'connect',
      timeout: readyTimeout,
      destination: {
        host: targetHost,
        port: targetPort,
      },
    });

    return info.socket;
  }

  if (urlResult.protocol.includes('http')) {
    return new Promise((resolve, reject) => {
      request({
        auth: urlResult.auth,
        agent: false,
        protocol: urlResult.protocol.includes('https') ? 'https:' : 'http:',
        hostname: urlResult.hostname,
        port: urlResult.port,
        path: `${targetHost}:${targetPort}`,
        method: 'CONNECT',
        timeout: readyTimeout,
      })
        .on('error', (e) => {
          console.error(`fail to connect proxy: ${e.message}`);
          reject(e);
        })
        .on('connect', (res, socket) => {
          resolve(socket);
        })
        .end();
    });
  }
};
