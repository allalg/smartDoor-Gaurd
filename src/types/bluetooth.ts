export type BleConnectionState =
  | 'unsupported'
  | 'disconnected'
  | 'requesting_permission'
  | 'connecting'
  | 'connected'
  | 'transferring'
  | 'authenticating'
  | 'success'
  | 'failed'
  | 'error';

export interface BleDeviceConfig {
  serviceUuid: string;
  authCharUuid: string;
  statusCharUuid: string;
  namePrefix: string;
}

export interface BleDeviceInfo {
  id: string;
  name: string;
  connected: boolean;
  rssi?: number;
}

export interface BleAuthPayload {
  requestId: string;
  token: string;
  timestamp: number;
}

export interface BleDeviceStatus {
  state: 'idle' | 'person_detected' | 'verifying' | 'granted' | 'denied';
  message?: string;
  code?: number;
}
