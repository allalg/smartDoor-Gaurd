import React, { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { fetchAdminMetrics, fetchAllUsers, setUserApproval, type AdminMetrics } from '@/services/admin';
import type { Profile } from '@/types/database';
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
  Clock,
  Check,
  X,
  UserCheck,
} from 'lucide-react';

export const AdminDashboard: React.FC = () => {
  const [metrics, setMetrics] = useState<AdminMetrics>({
    totalUsers: 0,
    pendingApprovals: 0,
    successfulEntries: 0,
    failedEntries: 0,
    unacknowledgedAlerts: 0,
    recentEvents: [],
  });
  const [pendingSignups, setPendingSignups] = useState<Profile[]>([]);
  const [loading, setLoading] = useState(true);
  const [actionLoading, setActionLoading] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<{ type: 'success' | 'error'; message: string } | null>(null);

  const loadData = async () => {
    setLoading(true);
    setError(null);
    try {
      const [metricsRes, usersRes] = await Promise.all([
        fetchAdminMetrics(),
        fetchAllUsers(),
      ]);

      const pending = usersRes.users
        ? usersRes.users.filter((u) => u.approval_status === 'pending')
        : [];
      setPendingSignups(pending);

      if (metricsRes.error) {
        setError(metricsRes.error);
      } else {
        const syncedMetrics = { ...metricsRes.metrics };
        if (usersRes.users && usersRes.users.length > 0) {
          syncedMetrics.totalUsers = Math.max(syncedMetrics.totalUsers, usersRes.users.length);
          syncedMetrics.pendingApprovals = pending.length;
        }
        setMetrics(syncedMetrics);
      }
    } catch {
      setError('Failed to load administration metrics');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadData();
  }, []);

  const handleApprove = async (user: Profile) => {
    setActionLoading(user.id);
    setFeedback(null);
    try {
      const res = await setUserApproval(user.id, 'approved');
      if (res.error) {
        setFeedback({ type: 'error', message: res.error });
      } else {
        setFeedback({
          type: 'success',
          message: `Approved ${user.display_name || user.id}. Account is now authorized for door entry.`,
        });
        setPendingSignups((prev) => prev.filter((p) => p.id !== user.id));
        setMetrics((prev) => ({
          ...prev,
          pendingApprovals: Math.max(0, prev.pendingApprovals - 1),
        }));
      }
    } catch {
      setFeedback({ type: 'error', message: 'Failed to approve user' });
    } finally {
      setActionLoading(null);
    }
  };

  const handleReject = async (user: Profile) => {
    setActionLoading(user.id);
    setFeedback(null);
    try {
      const res = await setUserApproval(user.id, 'rejected');
      if (res.error) {
        setFeedback({ type: 'error', message: res.error });
      } else {
        setFeedback({
          type: 'success',
          message: `Rejected registration for ${user.display_name || user.id}. Account remains disabled.`,
        });
        setPendingSignups((prev) => prev.filter((p) => p.id !== user.id));
        setMetrics((prev) => ({
          ...prev,
          pendingApprovals: Math.max(0, prev.pendingApprovals - 1),
        }));
      }
    } catch {
      setFeedback({ type: 'error', message: 'Failed to reject user' });
    } finally {
      setActionLoading(null);
    }
  };

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

      {feedback && (
        <div
          className={`p-3.5 rounded-xl border text-xs flex items-center gap-2.5 ${
            feedback.type === 'success'
              ? 'bg-emerald-500/10 border-emerald-500/30 text-emerald-300'
              : 'bg-rose-500/10 border-rose-500/30 text-rose-300'
          }`}
        >
          {feedback.type === 'success' ? (
            <CheckCircle2 className="h-4 w-4 text-emerald-400 shrink-0" />
          ) : (
            <AlertTriangle className="h-4 w-4 text-rose-400 shrink-0" />
          )}
          <span>{feedback.message}</span>
        </div>
      )}

      {/* Metric Stat Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-4">
        {/* Total Users */}
        <Link
          to="/admin/users"
          className="p-5 rounded-2xl bg-slate-900/80 border border-slate-800 hover:border-slate-700 transition-all group backdrop-blur-sm"
        >
          <div className="flex items-center justify-between mb-3">
            <span className="text-xs font-medium text-slate-400">Total Users</span>
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

        {/* Pending Approvals Card */}
        <Link
          to="/admin/users?status=pending"
          className={`p-5 rounded-2xl border transition-all group backdrop-blur-sm ${
            metrics.pendingApprovals > 0
              ? 'bg-amber-950/20 border-amber-500/40 hover:border-amber-400/60 shadow-lg shadow-amber-950/20'
              : 'bg-slate-900/80 border-slate-800 hover:border-slate-700'
          }`}
        >
          <div className="flex items-center justify-between mb-3">
            <span className="text-xs font-medium text-slate-400">Pending Signups</span>
            <div className={`p-2 rounded-xl border ${
              metrics.pendingApprovals > 0
                ? 'bg-amber-500/20 border-amber-500/30 text-amber-300 animate-pulse'
                : 'bg-slate-800 border-slate-700 text-slate-400'
            }`}>
              <Clock className="h-4 w-4" />
            </div>
          </div>
          <div className={`text-2xl font-bold ${metrics.pendingApprovals > 0 ? 'text-amber-300' : 'text-slate-300'}`}>
            {metrics.pendingApprovals}
          </div>
          <div className="text-[11px] text-slate-500 mt-1 flex items-center gap-1">
            <span>{metrics.pendingApprovals > 0 ? 'Review approvals' : 'All approved'}</span>
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

      {/* Pending Signups Section (Review Required) */}
      <div className="rounded-2xl bg-slate-900/80 border border-slate-800 p-6 backdrop-blur-sm">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 mb-4">
          <div className="flex items-center gap-2.5">
            <div className={`p-2 rounded-xl border ${
              pendingSignups.length > 0
                ? 'bg-amber-500/10 border-amber-500/30 text-amber-400'
                : 'bg-slate-800 border-slate-700 text-slate-400'
            }`}>
              <UserCheck className="h-4 w-4" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h3 className="text-base font-semibold text-white">Pending Resident Signups</h3>
                {pendingSignups.length > 0 && (
                  <span className="px-2 py-0.5 rounded-full text-[11px] font-semibold bg-amber-500/20 text-amber-300 border border-amber-500/30">
                    {pendingSignups.length} awaiting review
                  </span>
                )}
              </div>
              <p className="text-xs text-slate-400">
                Mandatory administrator approval queue before door access is granted
              </p>
            </div>
          </div>

          <Link
            to="/admin/users?status=pending"
            className="text-xs text-emerald-400 hover:text-emerald-300 flex items-center gap-1 font-medium"
          >
            <span>View Full User Directory</span>
            <ArrowUpRight className="h-3.5 w-3.5" />
          </Link>
        </div>

        {pendingSignups.length === 0 ? (
          <div className="py-8 px-4 rounded-xl bg-slate-950/40 border border-dashed border-slate-800 text-center space-y-1">
            <CheckCircle2 className="h-5 w-5 text-emerald-400 mx-auto" />
            <p className="text-xs font-medium text-slate-300">All signups have been reviewed</p>
            <p className="text-[11px] text-slate-500">
              New resident registrations will appear here automatically for administrator authorization.
            </p>
          </div>
        ) : (
          <div className="divide-y divide-slate-800/60 font-sans text-xs">
            {pendingSignups.map((applicant) => {
              const isBusy = actionLoading === applicant.id;

              return (
                <div key={applicant.id} className="py-3 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                  <div className="flex items-center gap-3">
                    <div className="h-9 w-9 rounded-full bg-slate-800 border border-slate-700 flex items-center justify-center text-xs font-semibold text-slate-200 shrink-0">
                      {applicant.display_name ? applicant.display_name[0].toUpperCase() : 'U'}
                    </div>
                    <div>
                      <div className="font-semibold text-white text-sm">
                        {applicant.display_name || 'Unnamed Resident'}
                      </div>
                      <div className="text-[10px] text-slate-500 font-mono flex items-center gap-2">
                        <span>UUID: {applicant.id}</span>
                        <span>&bull;</span>
                        <span>Registered {formatTimeAgo(applicant.created_at)}</span>
                      </div>
                    </div>
                  </div>

                  <div className="flex items-center gap-2 self-end sm:self-center">
                    <button
                      onClick={() => handleApprove(applicant)}
                      disabled={isBusy}
                      className="px-3 py-1.5 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-semibold transition-all flex items-center gap-1.5 shadow-sm shadow-emerald-600/20 disabled:opacity-50"
                      title="Approve applicant"
                    >
                      {isBusy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Check className="h-3.5 w-3.5" />}
                      <span>Approve</span>
                    </button>

                    <button
                      onClick={() => handleReject(applicant)}
                      disabled={isBusy}
                      className="px-3 py-1.5 rounded-xl bg-rose-600/20 hover:bg-rose-600/30 text-rose-300 border border-rose-500/30 text-xs font-medium transition-colors flex items-center gap-1.5 disabled:opacity-50"
                      title="Reject applicant"
                    >
                      <X className="h-3.5 w-3.5" />
                      <span>Reject</span>
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        )}
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
                <p className="text-xs text-slate-400">Authorized vs Denied</p>
              </div>
            </div>

            <div className="space-y-3 font-mono text-xs">
              <div>
                <div className="flex justify-between text-slate-300 mb-1">
                  <span>Authorized ({successRate}%)</span>
                  <span>{metrics.successfulEntries}</span>
                </div>
                <div className="w-full h-2 rounded-full bg-slate-800 overflow-hidden">
                  <div
                    className="h-full bg-emerald-500 transition-all duration-500"
                    style={{ width: `${successRate}%` }}
                  />
                </div>
              </div>

              <div>
                <div className="flex justify-between text-slate-300 mb-1">
                  <span>Denied ({100 - successRate}%)</span>
                  <span>{metrics.failedEntries}</span>
                </div>
                <div className="w-full h-2 rounded-full bg-slate-800 overflow-hidden">
                  <div
                    className="h-full bg-rose-500 transition-all duration-500"
                    style={{ width: `${100 - successRate}%` }}
                  />
                </div>
              </div>
            </div>

            <div className="mt-6 p-3.5 rounded-xl bg-slate-950 border border-slate-800 text-xs flex items-start gap-2.5">
              <Cpu className="h-4 w-4 text-emerald-400 shrink-0 mt-0.5" />
              <div>
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
                const isGranted = event.result === 'success' || event.result === 'granted';
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
