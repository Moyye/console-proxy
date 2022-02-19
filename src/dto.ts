import { Config as ConnectionConfig } from './utils/nodeSSH';

export interface ForwardParams {
  connectionId: string;
  config: ConnectionConfig;
  remoteAddr: string;
  remotePort: number;
  localAddr: string;
  localPort: number;
}

export class ForwardInRequestDto {
  type: string;
  connectionId: string;
  config: ConnectionConfig;
  remoteAddr: string;
  remotePort: number;
  localAddr: string;
  localPort: number;
}

export class ForwardInResponseDto {
  success: boolean;
  errorMessage: string;
}
