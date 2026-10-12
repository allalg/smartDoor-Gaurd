import React, { useState, useEffect } from 'react';
import { fetchIntrusionAlerts, acknowledgeAlert } from '@/services/admin';
import { supabase, isSupabaseConfigured } from '@/lib/supabase';
import type { IntrusionAlert, AlertSeverity } from '@/types/database';
import { formatDate, formatTimeAgo } from '@/lib/utils';
import {
  AlertTriangle,
  CheckCircle,
  Bell,
  RefreshCw,
  Loader2,
  ShieldAlert,
  Clock,
  Radio,
  CheckCheck,
} from 'lucide-react';

export const AdminAlerts: React.FC = () => {
  const [alerts, setAlerts] = useState<IntrusionAlert[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [acknowledgingId, setAcknowledgingId] = useState<string | null>(null);

  const loadAlerts = async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetchIntrusionAlerts();
      if (res.error) {
        setError(res.error);
      } else {
        setAlerts(res.alerts);
      }
    } catch {
      setError('Failed to fetch intrusion alerts');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadAlerts();

    // Supabase Realtime subscription for intrusion alerts
    if (isSupabaseConfigured) {
      const channel = supabase
        .channel('schema-db-changes')
        .on(
          'postgres_changes',
          { event: 'INSERT', schema: 'public', table: 'intrusion_alerts' },
          (payload) => {
            console.log('Realtime alert received:', payload);
            setAlerts((prev) => [payload.new as IntrusionAlert, ...prev]);
          }
        )
        .subscribe();

      return () => {
        supabase.removeChannel(channel);
      };
    }
  }, []);

  const handleAcknowledge = async (id: string) => {
    setAcknowledgingId(id);
    try {
      const res = await acknowledgeAlert(id);
      if (!res.error) {
        setAlerts((prev) =>
          prev.map((a) =>
            a.id === id
              ? {
                  ...a,
                  acknowledged_at: new Date().toISOString(),
                  notification_status: 'acknowledged',
                }
              : a
          )
        );
      }
    } finally {
      setAcknowledgingId(null);
    }
  };

  const getSeverityStyle = (severity: AlertSeverity) => {
    switch (severity) {
      case 'critical':
        return 'bg-rose-500/20 text-rose-300 border-rose-500/40';
      case 'high':
        return 'bg-amber-500/20 text-amber-300 border-amber-500/40';
      case 'medium':
        return 'bg-yellow-500/10 text-yellow-300 border-yellow-500/30';
      default:
        return 'bg-slate-800 text-slate-300 border-slate-700';
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <div className="flex items-center gap-2">
            <h1 className="text-2xl font-bold text-white tracking-tight">Intrusion & Security Alerts</h1>
            <span className="flex items-center gap-1 text-[10px] text-emerald-400 bg-emerald-500/10 px-2 py-0.5 rounded-full border border-emerald-500/20 font-mono">
              <span className="h-1.5 w-1.5 rounded-full bg-emerald-400 animate-pulse" />
              Realtime Active
            </span>
          </div>
          <p className="text-xs text-slate-400 mt-1">
            Suspicious door activity, failed OTP injections, and tamper alerts from <code>intrusion_alerts</code>
          </p>
        </div>

        <button
          onClick={loadAlerts}
          className="inline-flex items-center gap-2 px-3.5 py-2 rounded-xl bg-slate-900 border border-slate-800 text-slate-300 hover:text-white hover:bg-slate-800 text-xs font-medium transition-colors"
        >
          <RefreshCw className={`h-3.5 w-3.5 ${loading ? 'animate-spin' : ''}`} />
          <span>Refresh Alerts</span>
        </button>
      </div>

      {error && (
        <div className="p-3.5 rounded-xl bg-rose-500/10 border border-rose-500/20 text-xs text-rose-300">
          {error}
        </div>
      )}

      {/* Alerts Stream */}
      <div className="rounded-2xl bg-slate-900/80 border border-slate-800 overflow-hidden backdrop-blur-sm">
        {loading ? (
          <div className="py-16 flex flex-col items-center justify-center text-slate-500 gap-3 text-xs">
            <Loader2 className="h-6 w-6 animate-spin text-amber-500" />
            <span>Scanning intrusion alert repository...</span>
          </div>
        ) : alerts.length === 0 ? (
          <div className="py-16 text-center text-slate-500 space-y-2">
            <CheckCheck className="h-8 w-8 mx-auto text-emerald-400" />
            <p className="text-sm text-slate-300 font-medium">All Clear — No Active Alerts</p>
            <p className="text-xs text-slate-500">Security subsystem reports normal operation across all door terminals.</p>
          </div>
        ) : (
          <div className="divide-y divide-slate-800/60">
            {alerts.map((alert) => {
              const isAcknowledged = Boolean(alert.acknowledged_at);
              const isBusy = acknowledgingId === alert.id;

              return (
                <div
                  key={alert.id}
                  className={`p-4 sm:p-5 flex flex-col sm:flex-row sm:items-center justify-between gap-4 transition-colors ${
                    isAcknowledged ? 'bg-slate-950/40 opacity-75' : 'bg-slate-900/60'
                  }`}
                >
                  <div className="flex items-start gap-3.5">
                    <div
                      className={`p-2.5 rounded-xl border mt-0.5 ${getSeverityStyle(
                        alert.severity
                      )}`}
                    >
                      <AlertTriangle className="h-5 w-5" />
                    </div>

                    <div className="space-y-1">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="font-semibold text-white text-sm">
                          {alert.message}
                        </span>
                        <span
                          className={`text-[10px] uppercase font-mono px-2 py-0.5 rounded-full border ${getSeverityStyle(
                            alert.severity
                          )}`}
                        >
                          {alert.severity}
                        </span>
                        {isAcknowledged ? (
                          <span className="text-[10px] text-emerald-400 bg-emerald-500/10 px-2 py-0.5 rounded-full border border-emerald-500/20">
                            Acknowledged
                          </span>
                        ) : (
                          <span className="text-[10px] text-amber-400 bg-amber-500/10 px-2 py-0.5 rounded-full border border-amber-500/20 animate-pulse">
                            Action Required
                          </span>
                        )}
                      </div>

                      <div className="text-xs text-slate-400 flex items-center gap-3 flex-wrap">
                        <span className="flex items-center gap-1 font-mono text-[11px] text-slate-500">
                          <Clock className="h-3 w-3" />
                          {formatDate(alert.created_at)} ({formatTimeAgo(alert.created_at)})
                        </span>
                        {alert.entry_log && (
                          <span className="text-[11px] text-slate-500 font-mono">
                            Device: {alert.entry_log.device_id || 'esp32_door_01'}
                          </span>
                        )}
                      </div>
                    </div>
                  </div>

                  <div className="flex items-center gap-2 sm:self-center shrink-0">
                    {!isAcknowledged ? (
                      <button
                        onClick={() => handleAcknowledge(alert.id)}
                        disabled={isBusy}
                        className="py-2 px-3.5 rounded-xl bg-amber-500/20 hover:bg-amber-500/30 text-amber-300 border border-amber-500/30 text-xs font-semibold transition-colors flex items-center gap-1.5"
                      >
                        {isBusy ? (
                          <Loader2 className="h-3.5 w-3.5 animate-spin" />
                        ) : (
                          <CheckCircle className="h-3.5 w-3.5" />
                        )}
                        <span>Acknowledge</span>
                      </button>
                    ) : (
                      <span className="text-xs text-slate-500 font-mono">
                        Ack: {formatDate(alert.acknowledged_at)}
                      </span>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
};
