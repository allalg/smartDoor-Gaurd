import React, { useState, useEffect } from 'react';
import { useSearchParams } from 'react-router-dom';
import { fetchAllUsers, toggleUserStatus, updateUserRole, setUserApproval } from '@/services/admin';
import type { Profile, ApprovalStatus } from '@/types/database';
import { formatDate } from '@/lib/utils';
import {
  Users,
  ShieldAlert,
  UserCheck,
  UserX,
  Search,
  RefreshCw,
  Loader2,
  CheckCircle2,
  AlertCircle,
  Key,
  Clock,
  Check,
  X,
} from 'lucide-react';
import { useAuth } from '@/context/AuthContext';

export const AdminUsers: React.FC = () => {
  const { user: currentUser } = useAuth();
  const [searchParams, setSearchParams] = useSearchParams();
  const initialStatus = (searchParams.get('status') as 'all' | ApprovalStatus) || 'all';

  const [users, setUsers] = useState<Profile[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<'all' | ApprovalStatus>(initialStatus);
  const [actionLoading, setActionLoading] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<{ type: 'success' | 'error'; message: string } | null>(null);

  // Confirmation modal state
  const [confirmDialog, setConfirmDialog] = useState<{
    user: Profile;
    action: 'approve' | 'reject';
  } | null>(null);

  const loadUsers = async () => {
    setLoading(true);
    try {
      const res = await fetchAllUsers();
      if (res.error) {
        setFeedback({ type: 'error', message: res.error });
      } else {
        setUsers(res.users);
      }
    } catch {
      setFeedback({ type: 'error', message: 'Failed to fetch registered users' });
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadUsers();
  }, []);

  const handleFilterChange = (status: 'all' | ApprovalStatus) => {
    setStatusFilter(status);
    if (status === 'all') {
      searchParams.delete('status');
    } else {
      searchParams.set('status', status);
    }
    setSearchParams(searchParams, { replace: true });
  };

  const handleApprove = async (targetUser: Profile) => {
    setActionLoading(targetUser.id);
    setFeedback(null);
    setConfirmDialog(null);

    try {
      const res = await setUserApproval(targetUser.id, 'approved');
      if (res.error) {
        setFeedback({ type: 'error', message: res.error });
      } else {
        setUsers((prev) =>
          prev.map((u) =>
            u.id === targetUser.id
              ? { ...u, approval_status: 'approved', is_enabled: true }
              : u
          )
        );
        setFeedback({
          type: 'success',
          message: `Registration for ${targetUser.display_name || targetUser.id} approved. Access has been enabled.`,
        });
      }
    } catch {
      setFeedback({ type: 'error', message: 'Failed to approve user' });
    } finally {
      setActionLoading(null);
    }
  };

  const handleReject = async (targetUser: Profile) => {
    setActionLoading(targetUser.id);
    setFeedback(null);
    setConfirmDialog(null);

    try {
      const res = await setUserApproval(targetUser.id, 'rejected');
      if (res.error) {
        setFeedback({ type: 'error', message: res.error });
      } else {
        setUsers((prev) =>
          prev.map((u) =>
            u.id === targetUser.id
              ? { ...u, approval_status: 'rejected', is_enabled: false }
              : u
          )
        );
        setFeedback({
          type: 'success',
          message: `Registration for ${targetUser.display_name || targetUser.id} rejected. Account has been disabled.`,
        });
      }
    } catch {
      setFeedback({ type: 'error', message: 'Failed to reject user' });
    } finally {
      setActionLoading(null);
    }
  };

  const handleToggleStatus = async (user: Profile) => {
    setActionLoading(user.id);
    setFeedback(null);
    try {
      const newStatus = !user.is_enabled;
      const res = await toggleUserStatus(user.id, newStatus);
      if (res.error) {
        setFeedback({ type: 'error', message: res.error });
      } else {
        setUsers((prev) =>
          prev.map((u) => (u.id === user.id ? { ...u, is_enabled: newStatus } : u))
        );
        setFeedback({
          type: 'success',
          message: `User ${user.display_name || user.id} is now ${newStatus ? 'Enabled' : 'Disabled'}.`,
        });
      }
    } catch {
      setFeedback({ type: 'error', message: 'Action failed' });
    } finally {
      setActionLoading(null);
    }
  };

  const handleToggleRole = async (user: Profile) => {
    if (user.id === currentUser?.id) {
      setFeedback({ type: 'error', message: 'You cannot alter your own admin privileges.' });
      return;
    }

    setActionLoading(user.id);
    setFeedback(null);
    try {
      const newRole = user.role === 'admin' ? 'user' : 'admin';
      const res = await updateUserRole(user.id, newRole);
      if (res.error) {
        setFeedback({ type: 'error', message: res.error });
      } else {
        setUsers((prev) =>
          prev.map((u) => (u.id === user.id ? { ...u, role: newRole } : u))
        );
        setFeedback({
          type: 'success',
          message: `User role updated to ${newRole.toUpperCase()}.`,
        });
      }
    } catch {
      setFeedback({ type: 'error', message: 'Failed to update role' });
    } finally {
      setActionLoading(null);
    }
  };

  // Counts for tabs
  const pendingCount = users.filter((u) => u.approval_status === 'pending').length;
  const approvedCount = users.filter((u) => u.approval_status === 'approved').length;
  const rejectedCount = users.filter((u) => u.approval_status === 'rejected').length;

  const filteredUsers = users.filter((u) => {
    // Status filter
    if (statusFilter !== 'all' && u.approval_status !== statusFilter) {
      return false;
    }

    // Search query
    if (!search) return true;
    const q = search.toLowerCase();
    return (
      (u.display_name && u.display_name.toLowerCase().includes(q)) ||
      u.id.toLowerCase().includes(q)
    );
  });

  return (
    <div className="space-y-6">
      {/* Page Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-white tracking-tight">Resident & User Management</h1>
          <p className="text-xs text-slate-400 mt-1">
            Review registration approvals, manage door access, and configure administrator privileges
          </p>
        </div>

        <button
          onClick={loadUsers}
          className="inline-flex items-center gap-2 px-3.5 py-2 rounded-xl bg-slate-900 border border-slate-800 text-slate-300 hover:text-white hover:bg-slate-800 text-xs font-medium transition-colors"
        >
          <RefreshCw className={`h-3.5 w-3.5 ${loading ? 'animate-spin' : ''}`} />
          <span>Refresh Users</span>
        </button>
      </div>

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
            <AlertCircle className="h-4 w-4 text-rose-400 shrink-0" />
          )}
          <span>{feedback.message}</span>
        </div>
      )}

      {/* Filter Tabs & Search Bar */}
      <div className="flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-3">
        {/* Status Filter Tabs */}
        <div className="flex items-center gap-1.5 p-1 rounded-xl bg-slate-950/80 border border-slate-800 text-xs">
          <button
            onClick={() => handleFilterChange('all')}
            className={`px-3 py-1.5 rounded-lg font-medium transition-all flex items-center gap-1.5 ${
              statusFilter === 'all'
                ? 'bg-slate-800 text-white shadow-sm'
                : 'text-slate-400 hover:text-slate-200'
            }`}
          >
            <span>All</span>
            <span className="text-[10px] px-1.5 py-0.2 rounded-full bg-slate-900 text-slate-400">
              {users.length}
            </span>
          </button>

          <button
            onClick={() => handleFilterChange('pending')}
            className={`px-3 py-1.5 rounded-lg font-medium transition-all flex items-center gap-1.5 ${
              statusFilter === 'pending'
                ? 'bg-amber-500/20 text-amber-300 border border-amber-500/30 shadow-sm'
                : 'text-slate-400 hover:text-slate-200'
            }`}
          >
            <span>Pending</span>
            {pendingCount > 0 && (
              <span className="text-[10px] px-1.5 py-0.2 rounded-full bg-amber-500/30 text-amber-300 font-semibold animate-pulse">
                {pendingCount}
              </span>
            )}
          </button>

          <button
            onClick={() => handleFilterChange('approved')}
            className={`px-3 py-1.5 rounded-lg font-medium transition-all flex items-center gap-1.5 ${
              statusFilter === 'approved'
                ? 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/30 shadow-sm'
                : 'text-slate-400 hover:text-slate-200'
            }`}
          >
            <span>Approved</span>
            <span className="text-[10px] px-1.5 py-0.2 rounded-full bg-slate-900 text-slate-400">
              {approvedCount}
            </span>
          </button>

          <button
            onClick={() => handleFilterChange('rejected')}
            className={`px-3 py-1.5 rounded-lg font-medium transition-all flex items-center gap-1.5 ${
              statusFilter === 'rejected'
                ? 'bg-rose-500/20 text-rose-300 border border-rose-500/30 shadow-sm'
                : 'text-slate-400 hover:text-slate-200'
            }`}
          >
            <span>Rejected</span>
            <span className="text-[10px] px-1.5 py-0.2 rounded-full bg-slate-900 text-slate-400">
              {rejectedCount}
            </span>
          </button>
        </div>

        {/* Search Input */}
        <div className="relative flex-1 max-w-sm">
          <Search className="absolute left-3.5 top-2.5 h-4 w-4 text-slate-500" />
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search by display name or UUID..."
            className="w-full bg-slate-900/90 border border-slate-800 rounded-xl pl-10 pr-4 py-2 text-xs text-slate-200 placeholder:text-slate-600 focus:outline-none focus:border-rose-500/50"
          />
        </div>
      </div>

      {/* User Table */}
      <div className="rounded-2xl bg-slate-900/80 border border-slate-800 overflow-hidden backdrop-blur-sm">
        {loading ? (
          <div className="py-16 flex flex-col items-center justify-center text-slate-500 gap-3 text-xs">
            <Loader2 className="h-6 w-6 animate-spin text-rose-500" />
            <span>Fetching registered profiles...</span>
          </div>
        ) : filteredUsers.length === 0 ? (
          <div className="py-16 text-center text-slate-500 space-y-2">
            <Users className="h-8 w-8 mx-auto text-slate-600" />
            <p className="text-sm text-slate-400 font-medium">No users found</p>
            <p className="text-xs text-slate-500">
              {statusFilter !== 'all' ? `No users with status "${statusFilter}".` : 'No registered accounts match your query.'}
            </p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead className="bg-slate-950/80 text-slate-400 border-b border-slate-800 uppercase tracking-wider font-semibold text-[11px]">
                <tr>
                  <th className="py-3.5 px-4 sm:px-6">User / Identity</th>
                  <th className="py-3.5 px-4">Role</th>
                  <th className="py-3.5 px-4">Approval Status</th>
                  <th className="py-3.5 px-4">Door Access</th>
                  <th className="py-3.5 px-4 hidden sm:table-cell">Registered</th>
                  <th className="py-3.5 px-4 sm:px-6 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800/60 font-sans text-slate-300">
                {filteredUsers.map((u) => {
                  const isCurrent = u.id === currentUser?.id;
                  const isBusy = actionLoading === u.id;
                  const status = u.approval_status || 'pending';

                  return (
                    <tr key={u.id} className="hover:bg-slate-800/30 transition-colors">
                      <td className="py-3.5 px-4 sm:px-6">
                        <div className="flex items-center gap-3">
                          <div className="h-8 w-8 rounded-full bg-slate-800 border border-slate-700 flex items-center justify-center text-xs font-semibold text-slate-200">
                            {u.display_name ? u.display_name[0].toUpperCase() : 'U'}
                          </div>
                          <div>
                            <div className="font-semibold text-white flex items-center gap-2">
                              <span>{u.display_name || 'Unnamed Resident'}</span>
                              {isCurrent && (
                                <span className="text-[10px] bg-slate-800 text-slate-400 px-1.5 py-0.5 rounded border border-slate-700">
                                  You
                                </span>
                              )}
                            </div>
                            <div className="text-[10px] text-slate-500 font-mono">{u.id}</div>
                          </div>
                        </div>
                      </td>

                      <td className="py-3.5 px-4">
                        <span
                          className={`inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[11px] font-mono uppercase font-semibold border ${
                            u.role === 'admin'
                              ? 'bg-rose-500/10 text-rose-400 border-rose-500/30'
                              : 'bg-slate-800 text-slate-300 border-slate-700'
                          }`}
                        >
                          {u.role === 'admin' ? (
                            <ShieldAlert className="h-3 w-3" />
                          ) : (
                            <Key className="h-3 w-3" />
                          )}
                          <span>{u.role}</span>
                        </span>
                      </td>

                      <td className="py-3.5 px-4">
                        <span
                          className={`inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-[11px] font-medium border ${
                            status === 'approved'
                              ? 'bg-emerald-500/10 text-emerald-400 border-emerald-500/30'
                              : status === 'rejected'
                              ? 'bg-rose-500/10 text-rose-400 border-rose-500/30'
                              : 'bg-amber-500/10 text-amber-300 border-amber-500/30'
                          }`}
                        >
                          {status === 'approved' ? (
                            <Check className="h-3 w-3 text-emerald-400" />
                          ) : status === 'rejected' ? (
                            <X className="h-3 w-3 text-rose-400" />
                          ) : (
                            <Clock className="h-3 w-3 text-amber-400 animate-spin" />
                          )}
                          <span className="capitalize">{status}</span>
                        </span>
                      </td>

                      <td className="py-3.5 px-4">
                        <span
                          className={`inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-[11px] font-medium border ${
                            u.is_enabled
                              ? 'bg-emerald-500/10 text-emerald-400 border-emerald-500/30'
                              : 'bg-slate-800 text-slate-400 border-slate-700'
                          }`}
                        >
                          <span
                            className={`h-1.5 w-1.5 rounded-full ${
                              u.is_enabled ? 'bg-emerald-400' : 'bg-slate-500'
                            }`}
                          />
                          <span>{u.is_enabled ? 'Enabled' : 'Disabled'}</span>
                        </span>
                      </td>

                      <td className="py-3.5 px-4 hidden sm:table-cell text-slate-400 font-mono text-[11px]">
                        {formatDate(u.created_at)}
                      </td>

                      <td className="py-3.5 px-4 sm:px-6 text-right">
                        <div className="flex items-center justify-end gap-2">
                          {/* Approval Actions for Pending Users */}
                          {status === 'pending' && !isCurrent && (
                            <>
                              <button
                                onClick={() => setConfirmDialog({ user: u, action: 'approve' })}
                                disabled={isBusy}
                                className="px-2.5 py-1 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white text-[11px] font-semibold transition-colors flex items-center gap-1 shadow-sm disabled:opacity-50"
                                title="Approve registration"
                              >
                                {isBusy ? <Loader2 className="h-3 w-3 animate-spin" /> : <Check className="h-3 w-3" />}
                                <span>Approve</span>
                              </button>

                              <button
                                onClick={() => setConfirmDialog({ user: u, action: 'reject' })}
                                disabled={isBusy}
                                className="px-2.5 py-1 rounded-lg bg-rose-600/20 hover:bg-rose-600/30 text-rose-300 border border-rose-500/30 text-[11px] font-medium transition-colors flex items-center gap-1 disabled:opacity-50"
                                title="Reject registration"
                              >
                                <X className="h-3 w-3" />
                                <span>Reject</span>
                              </button>
                            </>
                          )}

                          {/* Re-approval for Rejected Users */}
                          {status === 'rejected' && !isCurrent && (
                            <button
                              onClick={() => setConfirmDialog({ user: u, action: 'approve' })}
                              disabled={isBusy}
                              className="px-2.5 py-1 rounded-lg bg-emerald-600/20 hover:bg-emerald-600/30 text-emerald-300 border border-emerald-500/30 text-[11px] font-medium transition-colors flex items-center gap-1 disabled:opacity-50"
                              title="Re-approve registration"
                            >
                              <Check className="h-3 w-3" />
                              <span>Re-approve</span>
                            </button>
                          )}

                          {/* Approved User Actions */}
                          {status === 'approved' && !isCurrent && (
                            <>
                              {/* Toggle active / suspended */}
                              <button
                                onClick={() => handleToggleStatus(u)}
                                disabled={isBusy}
                                title={u.is_enabled ? 'Suspend door access' : 'Enable door access'}
                                className={`p-1.5 rounded-lg border text-xs transition-colors ${
                                  u.is_enabled
                                    ? 'bg-rose-500/10 border-rose-500/20 text-rose-400 hover:bg-rose-500/20'
                                    : 'bg-emerald-500/10 border-emerald-500/20 text-emerald-400 hover:bg-emerald-500/20'
                                }`}
                              >
                                {u.is_enabled ? (
                                  <UserX className="h-4 w-4" />
                                ) : (
                                  <UserCheck className="h-4 w-4" />
                                )}
                              </button>

                              {/* Reject / Revoke approval */}
                              <button
                                onClick={() => setConfirmDialog({ user: u, action: 'reject' })}
                                disabled={isBusy}
                                className="px-2 py-1 rounded-lg bg-slate-800 hover:bg-rose-500/20 text-slate-400 hover:text-rose-300 border border-slate-700 text-[11px] transition-colors"
                                title="Revoke approval"
                              >
                                Revoke
                              </button>

                              {/* Role switch button */}
                              <button
                                onClick={() => handleToggleRole(u)}
                                disabled={isBusy}
                                className="px-2.5 py-1 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 text-[11px] font-medium border border-slate-700 transition-colors"
                              >
                                Make {u.role === 'admin' ? 'User' : 'Admin'}
                              </button>
                            </>
                          )}
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Confirmation Modal */}
      {confirmDialog && (
        <div className="fixed inset-0 z-50 bg-black/70 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="w-full max-w-md rounded-2xl bg-slate-900 border border-slate-800 p-6 space-y-4 shadow-2xl">
            <div className="flex items-center gap-3">
              <div
                className={`p-2.5 rounded-xl border ${
                  confirmDialog.action === 'approve'
                    ? 'bg-emerald-500/10 border-emerald-500/30 text-emerald-400'
                    : 'bg-rose-500/10 border-rose-500/30 text-rose-400'
                }`}
              >
                {confirmDialog.action === 'approve' ? (
                  <Check className="h-5 w-5" />
                ) : (
                  <X className="h-5 w-5" />
                )}
              </div>
              <div>
                <h3 className="text-base font-semibold text-white">
                  {confirmDialog.action === 'approve' ? 'Approve Registration' : 'Reject Registration'}
                </h3>
                <p className="text-xs text-slate-400">
                  User: <span className="text-slate-200 font-medium">{confirmDialog.user.display_name || confirmDialog.user.id}</span>
                </p>
              </div>
            </div>

            <p className="text-xs text-slate-300 leading-relaxed">
              {confirmDialog.action === 'approve' ? (
                <>
                  Are you sure you want to approve this registration? The account will be atomically marked as <strong className="text-emerald-400">Approved</strong> and door access will be enabled immediately.
                </>
              ) : (
                <>
                  Are you sure you want to reject this registration? The account will be marked as <strong className="text-rose-400">Rejected</strong> and all door access and login privileges will remain blocked.
                </>
              )}
            </p>

            <div className="flex items-center justify-end gap-3 pt-2">
              <button
                type="button"
                onClick={() => setConfirmDialog(null)}
                className="px-4 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-300 text-xs font-medium transition-colors border border-slate-700"
              >
                Cancel
              </button>

              <button
                type="button"
                onClick={() => {
                  if (confirmDialog.action === 'approve') {
                    handleApprove(confirmDialog.user);
                  } else {
                    handleReject(confirmDialog.user);
                  }
                }}
                className={`px-4 py-2 rounded-xl text-white text-xs font-semibold transition-colors flex items-center gap-1.5 ${
                  confirmDialog.action === 'approve'
                    ? 'bg-emerald-600 hover:bg-emerald-500 shadow-md shadow-emerald-600/20'
                    : 'bg-rose-600 hover:bg-rose-500 shadow-md shadow-rose-600/20'
                }`}
              >
                Confirm {confirmDialog.action === 'approve' ? 'Approval' : 'Rejection'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
