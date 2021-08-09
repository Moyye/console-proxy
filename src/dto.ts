import { Config as ConnectionConfig } from './utils/nodeSSH';

export interface ForwardInParams {
  id: string;
  config: ConnectionConfig;
  remoteAddr: string;
  remotePort: number;
  localAddr: string;
  localPort: number;
}

export class ForwardInRequestDto {
  id: string;
  host: string;
  port: number;
  username: string;
  password: string;
  privateKey: string;
  remotePort: number;
  localAddr: string;
  localPort: number;
}

export class ForwardInResponseDto {
  success: boolean;
  errorMessage: string;
}
