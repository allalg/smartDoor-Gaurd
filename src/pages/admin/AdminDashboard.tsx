import React, { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { fetchAdminMetrics, type AdminMetrics } from '@/services/admin';
import { formatDate, formatTimeAgo } from '@/lib/utils';
import {
  Users,
  ShieldCheck,
  ShieldAlert,
  AlertTriangle,
  ArrowUpRight,
  RefreshCw,
  Loader2,
  TrendingUp,
  Cpu,
  CheckCircle2,
  XCircle,
} from 'lucide-react';

export const AdminDashboard: React.FC = () => {
  const [metrics, setMetrics] = useState<AdminMetrics>({
    totalUsers: 0,
    successfulEntries: 0,
    failedEntries: 0,
    unacknowledgedAlerts: 0,
    recentEvents: [],
  });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const loadData = async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetchAdminMetrics();
      if (res.error) {
        setError(res.error);
      } else {
        setMetrics(res.metrics);
      }
    } catch (err: unknown) {
      setError('Failed to load administration metrics');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadData();
  }, []);

  const totalAttempts = metrics.successfulEntries + metrics.failedEntries;
  const successRate = totalAttempts > 0 ? Math.round((metrics.successfulEntries / totalAttempts) * 100) : 100;

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-white tracking-tight">Security Command Center</h1>
          <p className="text-xs text-slate-400 mt-1">Real-time facility telemetry, user privileges, and intrusion monitoring</p>
        </div>

        <button
          onClick={loadData}
          className="inline-flex items-center gap-2 px-3.5 py-2 rounded-xl bg-slate-900 border border-slate-800 text-slate-300 hover:text-white hover:bg-slate-800 text-xs font-medium transition-colors"
        >
          <RefreshCw className={`h-3.5 w-3.5 ${loading ? 'animate-spin' : ''}`} />
          <span>Refresh Telemetry</span>
        </button>
      </div>

      {error && (
        <div className="p-3.5 rounded-xl bg-rose-500/10 border border-rose-500/20 text-xs text-rose-300">
          {error}
        </div>
      )}

      {/* Metric Stat Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        {/* Total Users */}
        <Link
          to="/admin/users"
          className="p-5 rounded-2xl bg-slate-900/80 border border-slate-800 hover:border-slate-700 transition-all group backdrop-blur-sm"
        >
          <div className="flex items-center justify-between mb-3">
            <span className="text-xs font-medium text-slate-400">Total Registered</span>
            <div className="p-2 rounded-xl bg-slate-800 text-slate-300 group-hover:bg-slate-700 transition-colors">
              <Users className="h-4 w-4" />
            </div>
          </div>
          <div className="text-2xl font-bold text-white">{metrics.totalUsers}</div>
          <div className="text-[11px] text-slate-500 mt-1 flex items-center gap-1">
            <span>Manage accounts</span>
            <ArrowUpRight className="h-3 w-3" />
          </div>
        </Link>

        {/* Granted Access */}
        <Link
          to="/admin/access-logs"
          className="p-5 rounded-2xl bg-slate-900/80 border border-slate-800 hover:border-emerald-500/30 transition-all group backdrop-blur-sm"
        >
          <div className="flex items-center justify-between mb-3">
            <span className="text-xs font-medium text-slate-400">Granted Entrances</span>
            <div className="p-2 rounded-xl bg-emerald-500/10 border border-emerald-500/20 text-emerald-400">
              <ShieldCheck className="h-4 w-4" />
            </div>
          </div>
          <div className="text-2xl font-bold text-emerald-400">{metrics.successfulEntries}</div>
          <div className="text-[11px] text-slate-500 mt-1">
            {successRate}% verification rate
          </div>
        </Link>

        {/* Failed / Denied */}
        <Link
          to="/admin/access-logs"
          className="p-5 rounded-2xl bg-slate-900/80 border border-slate-800 hover:border-rose-500/30 transition-all group backdrop-blur-sm"
        >
          <div className="flex items-center justify-between mb-3">
            <span className="text-xs font-medium text-slate-400">Denied Attempts</span>
            <div className="p-2 rounded-xl bg-rose-500/10 border border-rose-500/20 text-rose-400">
              <ShieldAlert className="h-4 w-4" />
            </div>
          </div>
          <div className="text-2xl font-bold text-rose-400">{metrics.failedEntries}</div>
          <div className="text-[11px] text-slate-500 mt-1">
            Blocked & buzzer sounded
          </div>
        </Link>

        {/* Intrusion Alerts */}
        <Link
          to="/admin/alerts"
          className="p-5 rounded-2xl bg-slate-900/80 border border-slate-800 hover:border-amber-500/30 transition-all group backdrop-blur-sm"
        >
          <div className="flex items-center justify-between mb-3">
            <span className="text-xs font-medium text-slate-400">Security Alerts</span>
            <div className={`p-2 rounded-xl border ${
              metrics.unacknowledgedAlerts > 0
                ? 'bg-amber-500/20 border-amber-500/40 text-amber-400 animate-pulse'
                : 'bg-slate-800 border-slate-700 text-slate-400'
            }`}>
              <AlertTriangle className="h-4 w-4" />
            </div>
          </div>
          <div className="text-2xl font-bold text-amber-400">{metrics.unacknowledgedAlerts}</div>
          <div className="text-[11px] text-slate-500 mt-1 flex items-center gap-1">
            <span>Unacknowledged</span>
            <ArrowUpRight className="h-3 w-3" />
          </div>
        </Link>
      </div>

      {/* Visual Analytics & Recent Events Row */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Visual Ratio Card */}
        <div className="rounded-2xl bg-slate-900/80 border border-slate-800 p-6 backdrop-blur-sm flex flex-col justify-between">
          <div>
            <div className="flex items-center gap-2.5 mb-4">
              <div className="p-2 rounded-xl bg-slate-800 text-slate-300">
                <TrendingUp className="h-4 w-4" />
              </div>
              <div>
                <h3 className="text-sm font-semibold text-white">Access Ratio Breakdown</h3>
                <p className="text-[11px] text-slate-400">Granted vs Denied distribution</p>
              </div>
            </div>

            <div className="space-y-4 my-6">
              {/* Progress bar */}
              <div className="space-y-2">
                <div className="flex justify-between text-xs font-mono">
                  <span className="text-emerald-400">Granted: {metrics.successfulEntries}</span>
                  <span className="text-rose-400">Denied: {metrics.failedEntries}</span>
                </div>
                <div className="h-3 w-full bg-slate-950 rounded-full overflow-hidden flex">
                  <div
                    style={{ width: `${totalAttempts > 0 ? (metrics.successfulEntries / totalAttempts) * 100 : 50}%` }}
                    className="bg-emerald-500 h-full"
                  />
                  <div
                    style={{ width: `${totalAttempts > 0 ? (metrics.failedEntries / totalAttempts) * 100 : 50}%` }}
                    className="bg-rose-500 h-full"
                  />
                </div>
              </div>

              <div className="p-3.5 rounded-xl bg-slate-950/60 border border-slate-800/80 text-xs text-slate-400 space-y-1">
                <div className="text-slate-300 font-medium">IoT Safeguard Status</div>
                <p className="text-[11px] text-slate-500 leading-relaxed">
                  Single-use OTP validation with 60-second timeouts prevents replay vulnerabilities and token theft across Bluetooth transfers.
                </p>
              </div>
            </div>
          </div>

          <div className="pt-4 border-t border-slate-800 text-center">
            <span className="text-xs font-mono text-slate-400">Total System Invocations: {totalAttempts}</span>
          </div>
        </div>

        {/* Recent Events List (2 Cols) */}
        <div className="lg:col-span-2 rounded-2xl bg-slate-900/80 border border-slate-800 p-6 backdrop-blur-sm">
          <div className="flex items-center justify-between mb-4">
            <div>
              <h3 className="text-base font-semibold text-white">Recent Security Logs</h3>
              <p className="text-xs text-slate-400">Directly from <code>entry_logs</code> table</p>
            </div>
            <Link
              to="/admin/access-logs"
              className="text-xs text-slate-400 hover:text-white flex items-center gap-1 font-medium"
            >
              <span>View All</span>
              <ArrowUpRight className="h-3.5 w-3.5" />
            </Link>
          </div>

          {metrics.recentEvents.length === 0 ? (
            <div className="py-12 text-center text-xs text-slate-500">
              No recent entries recorded.
            </div>
          ) : (
            <div className="divide-y divide-slate-800/60 font-mono text-xs">
              {metrics.recentEvents.map((event) => {
                const isGranted = event.result === 'granted';
                return (
                  <div key={event.id} className="py-3 flex items-center justify-between gap-4">
                    <div className="flex items-center gap-3">
                      {isGranted ? (
                        <CheckCircle2 className="h-4 w-4 text-emerald-400 shrink-0" />
                      ) : (
                        <XCircle className="h-4 w-4 text-rose-400 shrink-0" />
                      )}
                      <div>
                        <div className="text-slate-200 font-sans font-medium">
                          {isGranted ? 'Access Granted' : 'Access Denied'}
                          {event.failure_reason && (
                            <span className="text-rose-400 text-xs ml-2 font-normal">
                              ({event.failure_reason})
                            </span>
                          )}
                        </div>
                        <div className="text-[10px] text-slate-500">
                          Device: {event.device_id || 'esp32_door_01'} &bull; {formatTimeAgo(event.occurred_at || event.created_at)}
                        </div>
                      </div>
                    </div>

                    <span
                      className={`text-[10px] px-2 py-0.5 rounded-full border uppercase ${
                        isGranted
                          ? 'bg-emerald-500/10 text-emerald-400 border-emerald-500/30'
                          : 'bg-rose-500/10 text-rose-400 border-rose-500/30'
                      }`}
                    >
                      {event.result}
                    </span>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
