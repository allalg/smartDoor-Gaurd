import React, { useState, useEffect } from 'react';
import { fetchAllUsers, toggleUserStatus, updateUserRole } from '@/services/admin';
import type { Profile } from '@/types/database';
import { formatDate, formatTimeAgo } from '@/lib/utils';
import {
  Users,
  Shield,
  ShieldAlert,
  UserCheck,
  UserX,
  Search,
  RefreshCw,
  Loader2,
  CheckCircle2,
  AlertCircle,
  Key,
} from 'lucide-react';
import { useAuth } from '@/context/AuthContext';

export const AdminUsers: React.FC = () => {
  const { user: currentUser } = useAuth();
  const [users, setUsers] = useState<Profile[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [actionLoading, setActionLoading] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<{ type: 'success' | 'error'; message: string } | null>(null);

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
    } catch (err: unknown) {
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

  const filteredUsers = users.filter((u) => {
    const q = search.toLowerCase();
    return (
      (u.display_name && u.display_name.toLowerCase().includes(q)) ||
      u.id.toLowerCase().includes(q)
    );
  });

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-white tracking-tight">Resident & User Management</h1>
          <p className="text-xs text-slate-400 mt-1">
            Manage door access status and administrative roles in the <code>profiles</code> table
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

      {/* Filter / Search Bar */}
      <div className="flex items-center gap-3">
        <div className="relative flex-1">
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
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead className="bg-slate-950/80 text-slate-400 border-b border-slate-800 uppercase tracking-wider font-semibold text-[11px]">
                <tr>
                  <th className="py-3.5 px-4 sm:px-6">User / Identity</th>
                  <th className="py-3.5 px-4">Role</th>
                  <th className="py-3.5 px-4">Access Status</th>
                  <th className="py-3.5 px-4 hidden sm:table-cell">Registered</th>
                  <th className="py-3.5 px-4 sm:px-6 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800/60 font-sans text-slate-300">
                {filteredUsers.map((u) => {
                  const isCurrent = u.id === currentUser?.id;
                  const isBusy = actionLoading === u.id;

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
                            u.is_enabled
                              ? 'bg-emerald-500/10 text-emerald-400 border-emerald-500/30'
                              : 'bg-rose-500/10 text-rose-400 border-rose-500/30'
                          }`}
                        >
                          <span
                            className={`h-1.5 w-1.5 rounded-full ${
                              u.is_enabled ? 'bg-emerald-400' : 'bg-rose-400'
                            }`}
                          />
                          <span>{u.is_enabled ? 'Authorized' : 'Suspended'}</span>
                        </span>
                      </td>

                      <td className="py-3.5 px-4 hidden sm:table-cell text-slate-400 font-mono text-[11px]">
                        {formatDate(u.created_at)}
                      </td>

                      <td className="py-3.5 px-4 sm:px-6 text-right">
                        <div className="flex items-center justify-end gap-2">
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

                          {/* Role switch button */}
                          {!isCurrent && (
                            <button
                              onClick={() => handleToggleRole(u)}
                              disabled={isBusy}
                              className="px-2.5 py-1 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 text-[11px] font-medium border border-slate-700 transition-colors"
                            >
                              Make {u.role === 'admin' ? 'User' : 'Admin'}
                            </button>
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
    </div>
  );
};
