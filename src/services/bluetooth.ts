import type {
  BleConnectionState,
  BleDeviceConfig,
  BleDeviceInfo,
  BleAuthPayload,
  BleDeviceStatus,
} from '@/types/bluetooth';

// Configurable GATT Service & Characteristic UUIDs
export const DEFAULT_BLE_CONFIG: BleDeviceConfig = {
  serviceUuid: (
    import.meta.env.VITE_BLE_SERVICE_UUID || '19b10000-e8f2-537e-4f6c-d104768a1214'
  ).toLowerCase(),
  authCharUuid: (
    import.meta.env.VITE_BLE_CHAR_AUTH_UUID || '19b10001-e8f2-537e-4f6c-d104768a1214'
  ).toLowerCase(),
  statusCharUuid: (
    import.meta.env.VITE_BLE_CHAR_STATUS_UUID || '19b10002-e8f2-537e-4f6c-d104768a1214'
  ).toLowerCase(),
  namePrefix: import.meta.env.VITE_BLE_DEVICE_NAME_PREFIX || 'SmartDoor',
};

class BluetoothService {
  private device: BluetoothDevice | null = null;
  private server: BluetoothRemoteGATTServer | null = null;
  private authCharacteristic: BluetoothRemoteGATTCharacteristic | null = null;
  private statusCharacteristic: BluetoothRemoteGATTCharacteristic | null = null;

  private config: BleDeviceConfig = { ...DEFAULT_BLE_CONFIG };
  private stateChangeListeners: ((state: BleConnectionState, error?: string) => void)[] = [];
  private statusChangeListeners: ((status: BleDeviceStatus) => void)[] = [];

  constructor() {
    // Bluetooth permissions must NEVER be auto-requested in constructor.
  }

  public isSupported(): boolean {
    return typeof navigator !== 'undefined' && 'bluetooth' in navigator;
  }

  public setConfig(newConfig: Partial<BleDeviceConfig>) {
    this.config = { ...this.config, ...newConfig };
  }

  public getConfig(): BleDeviceConfig {
    return { ...this.config };
  }

  public subscribeState(listener: (state: BleConnectionState, error?: string) => void) {
    this.stateChangeListeners.push(listener);
    return () => {
      this.stateChangeListeners = this.stateChangeListeners.filter((l) => l !== listener);
    };
  }

  public subscribeStatus(listener: (status: BleDeviceStatus) => void) {
    this.statusChangeListeners.push(listener);
    return () => {
      this.statusChangeListeners = this.statusChangeListeners.filter((l) => l !== listener);
    };
  }

  private notifyState(state: BleConnectionState, error?: string) {
    this.stateChangeListeners.forEach((l) => l(state, error));
  }

  private notifyStatus(status: BleDeviceStatus) {
    this.statusChangeListeners.forEach((l) => l(status));
  }

  public getConnectedDeviceInfo(): BleDeviceInfo | null {
    if (!this.device) return null;
    return {
      id: this.device.id,
      name: this.device.name || 'ESP32 Smart Door',
      connected: this.device.gatt?.connected ?? false,
    };
  }

  /**
   * Request device & connect over Web Bluetooth.
   * MUST be called directly in response to a user click.
   */
  public async connect(): Promise<BleDeviceInfo> {
    if (!this.isSupported()) {
      const err = 'Web Bluetooth is not supported in this browser. Please use Chrome on Android or a supported Chromium browser.';
      this.notifyState('unsupported', err);
      throw new Error(err);
    }

    try {
      this.notifyState('requesting_permission');

      const options: RequestDeviceOptions = {
        filters: [
          { services: [this.config.serviceUuid] },
        ],
        optionalServices: [
          this.config.serviceUuid,
        ],
      };

      this.device = await navigator.bluetooth.requestDevice(options);

      // Listen for unexpected disconnects
      this.device.addEventListener('gattserverdisconnected', this.handleDisconnect.bind(this));

      this.notifyState('connecting');

      if (!this.device.gatt) {
        throw new Error('Device does not support GATT server');
      }

      this.server = await this.device.gatt.connect();

      // Retrieve primary smart door service
      const service = await this.server.getPrimaryService(this.config.serviceUuid);

      // Retrieve auth characteristic (write)
      this.authCharacteristic = await service.getCharacteristic(this.config.authCharUuid);

      // Retrieve status characteristic (notify/read) if available
      try {
        this.statusCharacteristic = await service.getCharacteristic(this.config.statusCharUuid);
        if (this.statusCharacteristic.properties.notify) {
          await this.statusCharacteristic.startNotifications();
          this.statusCharacteristic.addEventListener('characteristicvaluechanged', (event: Event) => {
            const target = event.target as BluetoothRemoteGATTCharacteristic;
            if (target?.value) {
              this.handleStatusNotification(target.value);
            }
          });
        }
      } catch (statusErr) {
        console.warn('Status notification characteristic not available or not notify-enabled:', statusErr);
      }

      this.notifyState('connected');

      return {
        id: this.device.id,
        name: this.device.name || 'ESP32 Smart Door',
        connected: true,
      };
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Failed to connect via Bluetooth';
      this.notifyState('failed', message);
      throw err;
    }
  }

  private handleDisconnect() {
    this.server = null;
    this.authCharacteristic = null;
    this.statusCharacteristic = null;
    this.notifyState('disconnected', 'Device disconnected');
  }

  private handleStatusNotification(dataView: DataView) {
    try {
      const decoder = new TextDecoder('utf-8');
      const text = decoder.decode(dataView);
      const parsed = JSON.parse(text);
      this.notifyStatus(parsed);
    } catch {
      // Fallback byte inspection
      const firstByte = dataView.getUint8(0);
      if (firstByte === 0x01) {
        this.notifyStatus({ state: 'granted', message: 'Access Granted by Door' });
      } else if (firstByte === 0x00) {
        this.notifyStatus({ state: 'denied', message: 'Access Denied by Door' });
      } else {
        this.notifyStatus({ state: 'verifying' });
      }
    }
  }

  /**
   * Transmit single-use authentication package to ESP32 over BLE.
   */
  public async sendAuthPackage(payload: BleAuthPayload): Promise<void> {
    if (!this.authCharacteristic || !this.server?.connected) {
      throw new Error('Device is not connected. Please connect to ESP32 before authenticating.');
    }

    try {
      this.notifyState('transferring');

      const jsonString = JSON.stringify({
        req: payload.requestId,
        tok: payload.token,
        ts: payload.timestamp,
      });

      const encoder = new TextEncoder();
      const encodedData = encoder.encode(jsonString);

      // Standard BLE MTU chunking if payload exceeds 20 bytes
      const chunkSize = 20;
      for (let offset = 0; offset < encodedData.length; offset += chunkSize) {
        const chunk = encodedData.slice(offset, offset + chunkSize);
        const char = this.authCharacteristic as unknown as {
          writeValueWithResponse?: (val: BufferSource) => Promise<void>;
          writeValueWithoutResponse?: (val: BufferSource) => Promise<void>;
          writeValue?: (val: BufferSource) => Promise<void>;
        };

        if (typeof char.writeValueWithResponse === 'function') {
          await char.writeValueWithResponse(chunk);
        } else if (typeof char.writeValueWithoutResponse === 'function') {
          await char.writeValueWithoutResponse(chunk);
        } else if (typeof char.writeValue === 'function') {
          await char.writeValue(chunk);
        }
      }

      this.notifyState('authenticating');
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Error transmitting auth packet to ESP32';
      this.notifyState('error', msg);
      throw new Error(msg);
    }
  }

  public disconnect() {
    if (this.device && this.device.gatt?.connected) {
      this.device.gatt.disconnect();
    }
    this.device = null;
    this.server = null;
    this.authCharacteristic = null;
    this.statusCharacteristic = null;
    this.notifyState('disconnected');
  }
}

export const bluetoothService = new BluetoothService();
