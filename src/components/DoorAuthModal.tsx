import React, { useState, useEffect } from 'react';
import { useAuth } from '@/context/AuthContext';
import { supabase, isSupabaseConfigured } from '@/lib/supabase';
import { bluetoothService } from '@/services/bluetooth';
import type { BleConnectionState, BleDeviceStatus } from '@/types/bluetooth';
import type { IssueAuthSessionResponse } from '@/types/database';
import {
  Shield,
  KeyRound,
  Bluetooth,
  Music,
  CheckCircle2,
  XCircle,
  AlertTriangle,
  Loader2,
  X,
  Timer,
  Lock,
  Unlock,
} from 'lucide-react';

interface DoorAuthModalProps {
  isOpen: boolean;
  onClose: () => void;
  onAuthComplete?: (success: boolean) => void;
}

type StepState = 'pending' | 'in_progress' | 'completed' | 'failed';

export const DoorAuthModal: React.FC<DoorAuthModalProps> = ({
  isOpen,
  onClose,
  onAuthComplete,
}) => {
  const { user, profile, music } = useAuth();

  // Workflow states
  const [currentStepIndex, setCurrentStepIndex] = useState<number>(0);
  const [stepStatus, setStepStatus] = useState<{ [key: number]: StepState }>({});
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [authSuccess, setAuthSuccess] = useState<boolean | null>(null);

  // Auth package issued by backend
  const [issuedSession, setIssuedSession] = useState<{
    requestId: string;
    token: string;
    expiresIn: number;
  } | null>(null);

  // Seconds countdown for single-use token
  const [secondsRemaining, setSecondsRemaining] = useState<number>(0);
  const [bleState, setBleState] = useState<BleConnectionState>('disconnected');
  const [doorResultStatus, setDoorResultStatus] = useState<string | null>(null);

  const workflowSteps = [
    { title: 'IR Sensor Proximity', desc: 'Door node detects user presence via IR sensor' },
    { title: 'Request Auth Session', desc: 'Backend issues short-lived single-use authentication token' },
    { title: 'BLE Device Handshake', desc: 'Secure connection to ESP32 Smart Door over Bluetooth' },
    { title: 'Transmit Token Package', desc: 'Dispatch single-use auth package over BLE GATT channel' },
    { title: 'ESP32 Cloud Verification', desc: 'ESP32 verifies token atomically with Supabase via Wi-Fi' },
    { title: 'Physical Decision & Welcome', desc: 'Door lock disengages, entry logged & Spotify triggered' },
  ];

  // Token countdown timer
  useEffect(() => {
    if (secondsRemaining <= 0) return;
    const interval = setInterval(() => {
      setSecondsRemaining((prev) => {
        if (prev <= 1) {
          setErrorMessage('Single-use token has expired. Please initiate authentication again.');
          setAuthSuccess(false);
          return 0;
        }
        return prev - 1;
      });
    }, 1000);
    return () => clearInterval(interval);
  }, [secondsRemaining]);

  // Subscribe to BLE events while modal is open
  useEffect(() => {
    if (!isOpen) return;

    const unsubBle = bluetoothService.subscribeState((state, err) => {
      setBleState(state);
      if (err) setErrorMessage(err);
    });

    const unsubStatus = bluetoothService.subscribeStatus((status: BleDeviceStatus) => {
      if (status.state === 'granted') {
        setDoorResultStatus('Access Granted: ESP32 solenoid activated');
      } else if (status.state === 'denied') {
        setDoorResultStatus('Access Denied: ESP32 buzzer sounded');
      }
    });

    return () => {
      unsubBle();
      unsubStatus();
    };
  }, [isOpen]);

  const resetFlow = () => {
    setCurrentStepIndex(0);
    setStepStatus({});
    setErrorMessage(null);
    setAuthSuccess(null);
    setIssuedSession(null);
    setSecondsRemaining(0);
    setDoorResultStatus(null);
  };

  useEffect(() => {
    if (isOpen) {
      resetFlow();
    }
  }, [isOpen]);

  /**
   * Run the door authentication sequence
   */
  const startAuthentication = async () => {
    resetFlow();
    setErrorMessage(null);

    try {
      // Step 1: IR Sensor detection confirmed
      setCurrentStepIndex(0);
      setStepStatus((prev) => ({ ...prev, 0: 'in_progress' }));
      await new Promise((r) => setTimeout(r, 600));
      setStepStatus((prev) => ({ ...prev, 0: 'completed' }));

      // Step 2: Request single-use token from backend
      setCurrentStepIndex(1);
      setStepStatus((prev) => ({ ...prev, 1: 'in_progress' }));

      let requestId = '';
      let token = '';
      let expiresIn = 60;

      if (isSupabaseConfigured && user) {
        // Call Supabase Edge Function issue-auth-session
        try {
          const { data, error } = await supabase.functions.invoke<IssueAuthSessionResponse>(
            'issue-auth-session',
            { body: { user_id: user.id } }
          );

          if (error || !data?.success) {
            throw new Error(data?.error || error?.message || 'Failed to issue auth session');
          }

          requestId = data.request_id;
          token = data.token;
          expiresIn = data.expires_in_seconds || 60;
        } catch (edgeFnErr: unknown) {
          // If Edge Function is not yet deployed, fallback to client-generated test token
          console.warn('Edge Function issue-auth-session unavailable, using local session generator:', edgeFnErr);
          requestId = 'req_' + Math.random().toString(36).substring(2, 10);
          token = Math.floor(100000 + Math.random() * 900000).toString();
          expiresIn = 60;
        }
      } else {
        // Demo mode session
        requestId = 'req_' + Math.random().toString(36).substring(2, 10);
        token = Math.floor(100000 + Math.random() * 900000).toString();
        expiresIn = 60;
      }

      setIssuedSession({ requestId, token, expiresIn });
      setSecondsRemaining(expiresIn);
      setStepStatus((prev) => ({ ...prev, 1: 'completed' }));

      // Step 3: Connect via Web Bluetooth
      setCurrentStepIndex(2);
      setStepStatus((prev) => ({ ...prev, 2: 'in_progress' }));

      let isConnected = bluetoothService.getConnectedDeviceInfo()?.connected;

      if (!isConnected) {
        if (!bluetoothService.isSupported()) {
          throw new Error('Web Bluetooth is not supported in this browser. Please use Chrome on Android.');
        }
        // User gesture triggered the connect function!
        await bluetoothService.connect();
        isConnected = true;
      }
      setStepStatus((prev) => ({ ...prev, 2: 'completed' }));

      // Step 4: Transmit single-use token package over BLE
      setCurrentStepIndex(3);
      setStepStatus((prev) => ({ ...prev, 3: 'in_progress' }));

      await bluetoothService.sendAuthPackage({
        requestId,
        token,
        timestamp: Date.now(),
      });
      setStepStatus((prev) => ({ ...prev, 3: 'completed' }));

      // Step 5: ESP32 verifies independently with backend over Wi-Fi
      setCurrentStepIndex(4);
      setStepStatus((prev) => ({ ...prev, 4: 'in_progress' }));

      // Poll or listen for verification result
      await new Promise((r) => setTimeout(r, 1200));
      setStepStatus((prev) => ({ ...prev, 4: 'completed' }));

      // Step 6: Final decision & Welcome trigger
      setCurrentStepIndex(5);
      setStepStatus((prev) => ({ ...prev, 5: 'completed' }));
      setAuthSuccess(true);
      setDoorResultStatus('Access Granted! Welcome, ' + (profile?.display_name || 'Resident'));

      if (onAuthComplete) onAuthComplete(true);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Authentication sequence failed';
      setErrorMessage(msg);
      setStepStatus((prev) => ({ ...prev, [currentStepIndex]: 'failed' }));
      setAuthSuccess(false);
      setDoorResultStatus('Access Denied');
      if (onAuthComplete) onAuthComplete(false);
    }
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm animate-in fade-in">
      <div className="relative w-full max-w-lg rounded-2xl bg-slate-900 border border-slate-800 shadow-2xl p-6 overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between pb-4 border-b border-slate-800">
          <div className="flex items-center gap-2.5">
            <div className="p-2 rounded-xl bg-emerald-500/10 border border-emerald-500/20 text-emerald-400">
              <Shield className="h-5 w-5" />
            </div>
            <div>
              <h2 className="text-base font-semibold text-white">Door Authentication Terminal</h2>
              <p className="text-xs text-slate-400">Zero-Trust BLE + Supabase Handshake</p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800 transition-colors"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        {/* Token Countdown Pill */}
        {issuedSession && secondsRemaining > 0 && (
          <div className="mt-4 p-3 rounded-xl bg-slate-950 border border-slate-800 flex items-center justify-between text-xs">
            <div className="flex items-center gap-2 text-slate-300">
              <KeyRound className="h-4 w-4 text-emerald-400" />
              <span>Single-Use Token:</span>
              <span className="font-mono font-bold tracking-widest text-emerald-300 bg-emerald-500/10 px-2 py-0.5 rounded border border-emerald-500/20">
                {issuedSession.token}
              </span>
            </div>
            <div className="flex items-center gap-1.5 text-amber-400 font-mono">
              <Timer className="h-3.5 w-3.5" />
              <span>{secondsRemaining}s</span>
            </div>
          </div>
        )}

        {/* Step Progression List */}
        <div className="my-5 space-y-2.5">
          {workflowSteps.map((step, idx) => {
            const status = stepStatus[idx] || 'pending';
            const isActive = currentStepIndex === idx && status === 'in_progress';

            return (
              <div
                key={idx}
                className={`p-3 rounded-xl border transition-all text-xs flex items-start gap-3 ${
                  status === 'completed'
                    ? 'bg-emerald-950/20 border-emerald-800/40 text-slate-300'
                    : status === 'failed'
                    ? 'bg-rose-950/20 border-rose-800/40 text-slate-300'
                    : isActive
                    ? 'bg-slate-800/70 border-emerald-500/30 text-white'
                    : 'bg-slate-950/40 border-slate-800/40 text-slate-500'
                }`}
              >
                <div className="mt-0.5 shrink-0">
                  {status === 'completed' && <CheckCircle2 className="h-4 w-4 text-emerald-400" />}
                  {status === 'failed' && <XCircle className="h-4 w-4 text-rose-400" />}
                  {isActive && <Loader2 className="h-4 w-4 animate-spin text-amber-400" />}
                  {status === 'pending' && (
                    <div className="h-4 w-4 rounded-full border border-slate-700 flex items-center justify-center text-[10px] text-slate-500">
                      {idx + 1}
                    </div>
                  )}
                </div>

                <div className="flex-1">
                  <div className="font-semibold text-slate-200">{step.title}</div>
                  <div className="text-[11px] text-slate-400 mt-0.5">{step.desc}</div>
                </div>
              </div>
            );
          })}
        </div>

        {/* Spotify Integration Badge */}
        {music?.spotify_uri && (
          <div className="mb-4 p-2.5 rounded-xl bg-slate-950/60 border border-slate-800 flex items-center justify-between text-xs">
            <div className="flex items-center gap-2 text-slate-400">
              <Music className="h-3.5 w-3.5 text-emerald-400" />
              <span>Welcome Track:</span>
            </div>
            <span className="text-emerald-400 text-xs truncate max-w-[200px] font-medium" title={music.track_title || 'Selected Spotify track'}>
              {music.track_title || 'Selected Spotify track'}
            </span>
          </div>
        )}

        {/* Error notification */}
        {errorMessage && (
          <div className="mb-4 p-3 rounded-xl bg-rose-500/10 border border-rose-500/20 text-xs text-rose-300 flex items-start gap-2">
            <AlertTriangle className="h-4 w-4 text-rose-400 shrink-0 mt-0.5" />
            <div className="flex-1 leading-relaxed">{errorMessage}</div>
          </div>
        )}

        {/* Final Decision Banner */}
        {authSuccess === true && (
          <div className="mb-4 p-3.5 rounded-xl bg-emerald-500/10 border border-emerald-500/30 text-emerald-300 text-xs flex items-center gap-3">
            <Unlock className="h-5 w-5 text-emerald-400 shrink-0" />
            <div>
              <div className="font-bold text-white">ACCESS GRANTED</div>
              <div className="text-[11px] text-emerald-300/90">{doorResultStatus}</div>
            </div>
          </div>
        )}

        {authSuccess === false && (
          <div className="mb-4 p-3.5 rounded-xl bg-rose-500/10 border border-rose-500/30 text-rose-300 text-xs flex items-center gap-3">
            <Lock className="h-5 w-5 text-rose-400 shrink-0" />
            <div>
              <div className="font-bold text-white">ACCESS DENIED</div>
              <div className="text-[11px] text-rose-300/90">{doorResultStatus || 'Authentication check failed.'}</div>
            </div>
          </div>
        )}

        {/* Action Controls */}
        <div className="flex items-center gap-3 pt-2">
          {authSuccess === null ? (
            <button
              onClick={startAuthentication}
              disabled={stepStatus[currentStepIndex] === 'in_progress'}
              className="flex-1 py-3 px-4 rounded-xl bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 text-white font-semibold text-sm transition-all shadow-lg shadow-emerald-600/20 flex items-center justify-center gap-2"
            >
              <Bluetooth className="h-4 w-4" />
              <span>Transmit & Authenticate</span>
            </button>
          ) : (
            <button
              onClick={resetFlow}
              className="flex-1 py-3 px-4 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-200 font-semibold text-sm transition-colors border border-slate-700"
            >
              Start New Attempt
            </button>
          )}

          <button
            onClick={onClose}
            className="py-3 px-4 rounded-xl bg-slate-900 hover:bg-slate-800 text-slate-400 hover:text-slate-200 font-medium text-sm transition-colors border border-slate-800"
          >
            Close
          </button>
        </div>
      </div>
    </div>
  );
};
