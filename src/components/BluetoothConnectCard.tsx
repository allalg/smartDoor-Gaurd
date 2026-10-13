import React, { useState, useEffect } from 'react';
import {
  bluetoothService,
  DEFAULT_BLE_CONFIG,
} from '@/services/bluetooth';
import type {
  BleConnectionState,
  BleDeviceInfo,
  BleDeviceConfig,
  BleDeviceStatus,
} from '@/types/bluetooth';
import {
  Bluetooth,
  BluetoothConnected,
  AlertCircle,
  Settings,
  RefreshCw,
  Cpu,
} from 'lucide-react';

interface BluetoothConnectCardProps {
  onDeviceConnected?: (info: BleDeviceInfo) => void;
  onDeviceDisconnected?: () => void;
}

export const BluetoothConnectCard: React.FC<BluetoothConnectCardProps> = ({
  onDeviceConnected,
  onDeviceDisconnected,
}) => {
  const [isSupported, setIsSupported] = useState<boolean>(true);
  const [connectionState, setConnectionState] = useState<BleConnectionState>('disconnected');
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [deviceInfo, setDeviceInfo] = useState<BleDeviceInfo | null>(null);
  const [deviceStatus, setDeviceStatus] = useState<BleDeviceStatus | null>(null);
  const [showConfig, setShowConfig] = useState<boolean>(false);
  const [config, setConfig] = useState<BleDeviceConfig>(bluetoothService.getConfig());

  useEffect(() => {
    const supported = bluetoothService.isSupported();
    setIsSupported(supported);
    if (!supported) {
      setConnectionState('unsupported');
    }

    // Subscribe to BLE state changes
    const unsubState = bluetoothService.subscribeState((state, error) => {
      setConnectionState(state);
      if (error) {
        setErrorMessage(error);
      } else if (state === 'connected' || state === 'disconnected') {
        setErrorMessage(null);
      }

      if (state === 'connected') {
        const info = bluetoothService.getConnectedDeviceInfo();
        setDeviceInfo(info);
        if (info && onDeviceConnected) onDeviceConnected(info);
      } else if (state === 'disconnected') {
        setDeviceInfo(null);
        setDeviceStatus(null);
        if (onDeviceDisconnected) onDeviceDisconnected();
      }
    });

    const unsubStatus = bluetoothService.subscribeStatus((status) => {
      setDeviceStatus(status);
    });

    return () => {
      unsubState();
      unsubStatus();
    };
  }, [onDeviceConnected, onDeviceDisconnected]);

  const handleConnect = async () => {
    setErrorMessage(null);
    try {
      const info = await bluetoothService.connect();
      setDeviceInfo(info);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Bluetooth connection cancelled or failed';
      // User cancelled picker is normal browser interaction
      if (msg.includes('cancelled') || msg.includes('User cancelled')) {
        setErrorMessage('Device selection was cancelled.');
      } else {
        setErrorMessage(msg);
      }
    }
  };

  const handleDisconnect = () => {
    bluetoothService.disconnect();
    setDeviceInfo(null);
    setConnectionState('disconnected');
  };

  const handleSaveConfig = (e: React.FormEvent) => {
    e.preventDefault();
    bluetoothService.setConfig(config);
    setShowConfig(false);
  };

  return (
    <div className="rounded-2xl bg-slate-900/80 border border-slate-800 p-5 sm:p-6 backdrop-blur-sm">
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-3">
          <div
            className={`p-2.5 rounded-xl border ${
              connectionState === 'connected'
                ? 'bg-emerald-500/10 border-emerald-500/30 text-emerald-400'
                : connectionState === 'connecting' || connectionState === 'requesting_permission'
                ? 'bg-amber-500/10 border-amber-500/30 text-amber-400'
                : 'bg-slate-800 border-slate-700 text-slate-400'
            }`}
          >
            {connectionState === 'connected' ? (
              <BluetoothConnected className="h-5 w-5" />
            ) : (
              <Bluetooth className="h-5 w-5" />
            )}
          </div>
          <div>
            <h3 className="text-base font-semibold text-white flex items-center gap-2">
              Door BLE Terminal
              {connectionState === 'connected' && (
                <span className="text-[10px] font-mono font-medium px-2 py-0.5 rounded-full bg-emerald-500/20 text-emerald-300 border border-emerald-500/30">
                  ONLINE
                </span>
              )}
            </h3>
            <p className="text-xs text-slate-400">Web Bluetooth interface for ESP32 proximity authentication</p>
          </div>
        </div>

        <button
          onClick={() => setShowConfig(!showConfig)}
          title="BLE UUID Configuration"
          className="p-2 rounded-lg text-slate-400 hover:text-slate-200 hover:bg-slate-800 transition-colors border border-transparent hover:border-slate-700"
        >
          <Settings className="h-4 w-4" />
        </button>
      </div>

      {/* Browser Compatibility Notice */}
      {!isSupported && (
        <div className="mb-4 p-3.5 rounded-xl bg-amber-500/10 border border-amber-500/20 text-xs text-amber-300 flex items-start gap-2.5">
          <AlertCircle className="h-4 w-4 text-amber-400 shrink-0 mt-0.5" />
          <div className="space-y-1">
            <p className="font-semibold text-amber-200">Web Bluetooth Unavailable</p>
            <p className="text-amber-300/90 leading-relaxed">
              This browser does not support the Web Bluetooth API. For door proximity operations, please open this application in <strong>Google Chrome on Android</strong> or a supported Chromium desktop browser with Bluetooth enabled.
            </p>
          </div>
        </div>
      )}

      {/* Error Message */}
      {errorMessage && (
        <div className="mb-4 p-3 rounded-xl bg-rose-500/10 border border-rose-500/20 text-xs text-rose-300 flex items-start gap-2">
          <AlertCircle className="h-4 w-4 text-rose-400 shrink-0 mt-0.5" />
          <div className="flex-1">
            <span className="font-medium text-rose-200">Bluetooth Error:</span> {errorMessage}
          </div>
        </div>
      )}

      {/* Config Drawer */}
      {showConfig && (
        <form onSubmit={handleSaveConfig} className="mb-5 p-4 rounded-xl bg-slate-950/80 border border-slate-800 text-xs space-y-3">
          <div className="font-medium text-slate-200 flex items-center justify-between">
            <span>ESP32 GATT UUID Configuration</span>
            <span className="text-[10px] text-slate-500">Configurable for hardware firmware</span>
          </div>

          <div>
            <label className="block text-slate-400 mb-1">Service UUID</label>
            <input
              type="text"
              value={config.serviceUuid}
              onChange={(e) => setConfig({ ...config, serviceUuid: e.target.value })}
              className="w-full bg-slate-900 border border-slate-800 rounded-lg px-3 py-1.5 text-slate-200 font-mono text-[11px] focus:outline-none focus:border-emerald-500/50"
              required
            />
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label className="block text-slate-400 mb-1">Auth Characteristic (Write)</label>
              <input
                type="text"
                value={config.authCharUuid}
                onChange={(e) => setConfig({ ...config, authCharUuid: e.target.value })}
                className="w-full bg-slate-900 border border-slate-800 rounded-lg px-3 py-1.5 text-slate-200 font-mono text-[11px] focus:outline-none focus:border-emerald-500/50"
                required
              />
            </div>
            <div>
              <label className="block text-slate-400 mb-1">Status Characteristic (Notify/Read)</label>
              <input
                type="text"
                value={config.statusCharUuid}
                onChange={(e) => setConfig({ ...config, statusCharUuid: e.target.value })}
                className="w-full bg-slate-900 border border-slate-800 rounded-lg px-3 py-1.5 text-slate-200 font-mono text-[11px] focus:outline-none focus:border-emerald-500/50"
                required
              />
            </div>
          </div>

          <div>
            <label className="block text-slate-400 mb-1">Device Name Prefix Filter</label>
            <input
              type="text"
              value={config.namePrefix}
              onChange={(e) => setConfig({ ...config, namePrefix: e.target.value })}
              placeholder="e.g. SmartDoor"
              className="w-full bg-slate-900 border border-slate-800 rounded-lg px-3 py-1.5 text-slate-200 font-mono text-[11px] focus:outline-none focus:border-emerald-500/50"
            />
          </div>

          <div className="flex justify-end gap-2 pt-2">
            <button
              type="button"
              onClick={() => {
                setConfig({ ...DEFAULT_BLE_CONFIG });
              }}
              className="px-3 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 text-xs"
            >
              Reset Defaults
            </button>
            <button
              type="submit"
              className="px-3 py-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-medium"
            >
              Apply UUIDs
            </button>
          </div>
        </form>
      )}

      {/* Connected Device Info */}
      {deviceInfo && connectionState === 'connected' ? (
        <div className="space-y-4">
          <div className="p-3.5 rounded-xl bg-slate-950/60 border border-slate-800/80 flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="p-2 rounded-lg bg-emerald-500/10 text-emerald-400">
                <Cpu className="h-4 w-4" />
              </div>
              <div>
                <div className="text-sm font-semibold text-white">{deviceInfo.name}</div>
                <div className="text-[11px] text-slate-500 font-mono">ID: {deviceInfo.id}</div>
              </div>
            </div>

            <button
              onClick={handleDisconnect}
              className="px-3 py-1.5 rounded-lg bg-slate-800 hover:bg-rose-500/20 text-slate-300 hover:text-rose-300 text-xs font-medium transition-colors border border-slate-700 hover:border-rose-500/30"
            >
              Disconnect
            </button>
          </div>

          {/* Live Device Status from Notification Characteristic */}
          {deviceStatus && (
            <div className="p-3 rounded-xl bg-slate-950/40 border border-slate-800/60 flex items-center justify-between text-xs">
              <span className="text-slate-400">ESP32 Status:</span>
              <span className="font-mono text-emerald-400 capitalize">
                {deviceStatus.message || deviceStatus.state}
              </span>
            </div>
          )}
        </div>
      ) : (
        <div className="flex flex-col sm:flex-row items-center gap-3">
          <button
            onClick={handleConnect}
            disabled={!isSupported || connectionState === 'connecting' || connectionState === 'requesting_permission'}
            className="w-full sm:w-auto flex-1 flex items-center justify-center gap-2 py-3 px-5 rounded-xl bg-slate-800 hover:bg-slate-700 disabled:opacity-50 text-white font-medium text-sm transition-all border border-slate-700 shadow-sm"
          >
            {connectionState === 'connecting' || connectionState === 'requesting_permission' ? (
              <>
                <RefreshCw className="h-4 w-4 animate-spin text-amber-400" />
                <span>Pairing with ESP32...</span>
              </>
            ) : (
              <>
                <Bluetooth className="h-4 w-4 text-emerald-400" />
                <span>Connect to Door Device</span>
              </>
            )}
          </button>

          {connectionState === 'failed' && (
            <button
              onClick={handleConnect}
              className="py-3 px-4 rounded-xl bg-rose-500/10 hover:bg-rose-500/20 text-rose-300 border border-rose-500/30 text-xs font-medium transition-colors"
            >
              Retry Connection
            </button>
          )}
        </div>
      )}
    </div>
  );
};
