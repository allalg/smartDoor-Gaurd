import React, { useState, useEffect } from 'react';
import { fetchIntrusionAlerts, acknowledgeAlert } from '@/services/admin';
import { supabase, isSupabaseConfigured } from '@/lib/supabase';
import type { IntrusionAlert, AlertSeverity, AlertType } from '@/types/database';
import { formatDate, formatTimeAgo } from '@/lib/utils';
import {
  AlertTriangle,
  CheckCircle,
  Bell,
  BellRing,
  RefreshCw,
  Loader2,
  ShieldAlert,
  Clock,
  Radio,
  CheckCheck,
  Eye,
  Filter,
} from 'lucide-react';

export const AdminAlerts: React.FC = () => {
  const [alerts, setAlerts] = useState<IntrusionAlert[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [acknowledgingId, setAcknowledgingId] = useState<string | null>(null);
  const [filterType, setFilterType] = useState<'all' | 'prolonged_presence' | 'auth_failure'>('all');
  const [filterStatus, setFilterStatus] = useState<'all' | 'unacknowledged' | 'acknowledged'>('all');
  const [notificationsAllowed, setNotificationsAllowed] = useState(
    typeof window !== 'undefined' && 'Notification' in window && Notification.permission === 'granted'
  );

  const requestNotificationPermission = async () => {
    if (typeof window !== 'undefined' && 'Notification' in window) {
      const permission = await Notification.requestPermission();
      setNotificationsAllowed(permission === 'granted');
    }
  };

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
        .channel('admin-alerts-live')
        .on(
          'postgres_changes',
          { event: 'INSERT', schema: 'public', table: 'intrusion_alerts' },
          (payload) => {
            const newAlert = payload.new as IntrusionAlert;
            setAlerts((prev) => [newAlert, ...prev.filter((a) => a.id !== newAlert.id)]);

            // Trigger desktop notification if permitted
            if (typeof window !== 'undefined' && 'Notification' in window && Notification.permission === 'granted') {
              try {
                new Notification('SmartDoor Security Alert', {
                  body: newAlert.message || 'New intrusion alert detected',
                  icon: '/favicon.ico',
                });
              } catch (nErr) {
                console.warn('Desktop notification failed:', nErr);
              }
            }
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

  const unacknowledgedCount = alerts.filter((a) => !a.acknowledged_at).length;

  const filteredAlerts = alerts.filter((alert) => {
    if (filterStatus === 'unacknowledged' && alert.acknowledged_at) return false;
    if (filterStatus === 'acknowledged' && !alert.acknowledged_at) return false;
    if (filterType === 'prolonged_presence' && alert.alert_type !== 'prolonged_presence') return false;
    if (filterType === 'auth_failure' && alert.alert_type === 'prolonged_presence') return false;
    return true;
  });

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <div className="flex items-center gap-2 flex-wrap">
            <h1 className="text-2xl font-bold text-white tracking-tight">Intrusion & Security Alerts</h1>
            <span className="flex items-center gap-1 text-[10px] text-emerald-400 bg-emerald-500/10 px-2 py-0.5 rounded-full border border-emerald-500/20 font-mono">
              <span className="h-1.5 w-1.5 rounded-full bg-emerald-400 animate-pulse" />
              Realtime Active
            </span>
            {unacknowledgedCount > 0 && (
              <span className="text-[10px] text-rose-400 bg-rose-500/10 px-2 py-0.5 rounded-full border border-rose-500/20 font-mono animate-pulse">
                {unacknowledgedCount} Action Required
              </span>
            )}
          </div>
          <p className="text-xs text-slate-400 mt-1">
            Suspicious door activity, prolonged loitering/presence, and tamper alerts from <code>intrusion_alerts</code>
          </p>
        </div>

        <div className="flex items-center gap-2 flex-wrap">
          {!notificationsAllowed && typeof window !== 'undefined' && 'Notification' in window && (
            <button
              onClick={requestNotificationPermission}
              className="inline-flex items-center gap-1.5 px-3 py-2 rounded-xl bg-slate-900 border border-slate-800 text-amber-300 hover:bg-slate-800 text-xs font-medium transition-colors"
              title="Enable desktop notifications"
            >
              <Bell className="h-3.5 w-3.5" />
              <span>Enable Alerts</span>
            </button>
          )}

          <button
            onClick={loadAlerts}
            className="inline-flex items-center gap-2 px-3.5 py-2 rounded-xl bg-slate-900 border border-slate-800 text-slate-300 hover:text-white hover:bg-slate-800 text-xs font-medium transition-colors"
          >
            <RefreshCw className={`h-3.5 w-3.5 ${loading ? 'animate-spin' : ''}`} />
            <span>Refresh Alerts</span>
          </button>
        </div>
      </div>

      {error && (
        <div className="p-3.5 rounded-xl bg-rose-500/10 border border-rose-500/20 text-xs text-rose-300">
          {error}
        </div>
      )}

      {/* Filter Bar */}
      <div className="flex flex-col sm:flex-row items-center justify-between gap-3 bg-slate-900/60 border border-slate-800 p-2.5 rounded-2xl">
        <div className="flex items-center gap-1 text-xs w-full sm:w-auto">
          <button
            onClick={() => setFilterStatus('all')}
            className={`px-3 py-1.5 rounded-xl font-medium transition-colors ${
              filterStatus === 'all' ? 'bg-slate-800 text-white' : 'text-slate-400 hover:text-slate-200'
            }`}
          >
            All Statuses
          </button>
          <button
            onClick={() => setFilterStatus('unacknowledged')}
            className={`px-3 py-1.5 rounded-xl font-medium transition-colors ${
              filterStatus === 'unacknowledged'
                ? 'bg-amber-500/20 text-amber-300'
                : 'text-slate-400 hover:text-slate-200'
            }`}
          >
            Action Required
          </button>
          <button
            onClick={() => setFilterStatus('acknowledged')}
            className={`px-3 py-1.5 rounded-xl font-medium transition-colors ${
              filterStatus === 'acknowledged'
                ? 'bg-emerald-500/20 text-emerald-300'
                : 'text-slate-400 hover:text-slate-200'
            }`}
          >
            Acknowledged
          </button>
        </div>

        <div className="flex items-center gap-1 text-xs w-full sm:w-auto">
          <button
            onClick={() => setFilterType('all')}
            className={`px-3 py-1.5 rounded-xl font-medium transition-colors ${
              filterType === 'all' ? 'bg-slate-800 text-white' : 'text-slate-400 hover:text-slate-200'
            }`}
          >
            All Types
          </button>
          <button
            onClick={() => setFilterType('prolonged_presence')}
            className={`px-3 py-1.5 rounded-xl font-medium transition-colors ${
              filterType === 'prolonged_presence'
                ? 'bg-purple-500/20 text-purple-300'
                : 'text-slate-400 hover:text-slate-200'
            }`}
          >
            Prolonged Presence
          </button>
          <button
            onClick={() => setFilterType('auth_failure')}
            className={`px-3 py-1.5 rounded-xl font-medium transition-colors ${
              filterType === 'auth_failure'
                ? 'bg-rose-500/20 text-rose-300'
                : 'text-slate-400 hover:text-slate-200'
            }`}
          >
            Auth Failures
          </button>
        </div>
      </div>

      {/* Alerts Stream */}
      <div className="rounded-2xl bg-slate-900/80 border border-slate-800 overflow-hidden backdrop-blur-sm">
        {loading ? (
          <div className="py-16 flex flex-col items-center justify-center text-slate-500 gap-3 text-xs">
            <Loader2 className="h-6 w-6 animate-spin text-amber-500" />
            <span>Scanning intrusion alert repository...</span>
          </div>
        ) : filteredAlerts.length === 0 ? (
          <div className="py-16 text-center text-slate-500 space-y-2">
            <CheckCheck className="h-8 w-8 mx-auto text-emerald-400" />
            <p className="text-sm text-slate-300 font-medium">All Clear — No Matching Alerts</p>
            <p className="text-xs text-slate-500">Security subsystem reports normal operation across all door terminals.</p>
          </div>
        ) : (
          <div className="divide-y divide-slate-800/60">
            {filteredAlerts.map((alert) => {
              const isAcknowledged = Boolean(alert.acknowledged_at);
              const isBusy = acknowledgingId === alert.id;
              const isPresenceAlert = alert.alert_type === 'prolonged_presence';

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
                      {isPresenceAlert ? (
                        <Eye className="h-5 w-5 text-purple-400" />
                      ) : (
                        <AlertTriangle className="h-5 w-5" />
                      )}
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

                        {isPresenceAlert ? (
                          <span className="text-[10px] uppercase font-mono px-2 py-0.5 rounded-full border bg-purple-500/10 text-purple-300 border-purple-500/30 flex items-center gap-1">
                            <Eye className="h-3 w-3" />
                            Prolonged Presence
                          </span>
                        ) : (
                          <span className="text-[10px] uppercase font-mono px-2 py-0.5 rounded-full border bg-slate-800 text-slate-300 border-slate-700">
                            Auth Failure
                          </span>
                        )}

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

                        <span className="text-[11px] text-slate-400 font-mono">
                          Device: {alert.device_id || alert.entry_log?.device_id || 'esp32_door_01'}
                        </span>

                        {alert.duration_seconds != null && (
                          <span className="text-[11px] text-purple-400 font-mono">
                            Duration: {alert.duration_seconds}s presence
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
