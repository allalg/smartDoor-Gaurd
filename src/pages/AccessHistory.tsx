import React, { useState, useEffect } from 'react';
import { useAuth } from '@/context/AuthContext';
import { fetchUserAccessLogs } from '@/services/access-history';
import type { EntryLog, EntryResult } from '@/types/database';
import { formatDate, formatTimeAgo } from '@/lib/utils';
import {
  History,
  CheckCircle2,
  XCircle,
  Clock,
  Filter,
  RefreshCw,
  Loader2,
  Cpu,
  Hash,
} from 'lucide-react';

export const AccessHistory: React.FC = () => {
  const { user } = useAuth();
  const [logs, setLogs] = useState<EntryLog[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState<'all' | 'granted' | 'denied'>('all');

  const loadLogs = async () => {
    if (!user) return;
    setLoading(true);
    setError(null);
    try {
      const { logs, error } = await fetchUserAccessLogs(user.id, 50);
      if (error) {
        setError(error);
      } else {
        setLogs(logs);
      }
    } catch (err: unknown) {
      setError('Failed to load access logs');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadLogs();
  }, [user]);

  const filteredLogs = logs.filter((log) => {
    if (filter === 'all') return true;
    if (filter === 'granted') return log.result === 'granted' || log.result === 'success';
    if (filter === 'denied') return log.result === 'denied' || log.result === 'failure';
    return log.result === filter;
  });

  return (
    <div className="space-y-6">
      {/* Page Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-white tracking-tight">Access History</h1>
          <p className="text-xs text-slate-400 mt-1">Review your personal door authentication logs and timestamps</p>
        </div>

        <div className="flex items-center gap-3">
          {/* Result Filter Tabs */}
          <div className="flex items-center bg-slate-900 border border-slate-800 p-1 rounded-xl text-xs">
            <button
              onClick={() => setFilter('all')}
              className={`px-3 py-1.5 rounded-lg font-medium transition-colors ${
                filter === 'all'
                  ? 'bg-slate-800 text-white'
                  : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              All ({logs.length})
            </button>
            <button
              onClick={() => setFilter('granted')}
              className={`px-3 py-1.5 rounded-lg font-medium transition-colors ${
                filter === 'granted'
                  ? 'bg-emerald-500/20 text-emerald-300'
                  : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              Granted
            </button>
            <button
              onClick={() => setFilter('denied')}
              className={`px-3 py-1.5 rounded-lg font-medium transition-colors ${
                filter === 'denied'
                  ? 'bg-rose-500/20 text-rose-300'
                  : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              Denied
            </button>
          </div>

          <button
            onClick={loadLogs}
            title="Refresh history"
            className="p-2.5 rounded-xl bg-slate-900 border border-slate-800 text-slate-400 hover:text-white hover:bg-slate-800 transition-colors"
          >
            <RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} />
          </button>
        </div>
      </div>

      {/* Logs Table / Cards */}
      <div className="rounded-2xl bg-slate-900/80 border border-slate-800 overflow-hidden backdrop-blur-sm">
        {loading ? (
          <div className="py-16 flex flex-col items-center justify-center text-slate-500 gap-3 text-xs">
            <Loader2 className="h-6 w-6 animate-spin text-emerald-500" />
            <span>Retrieving access records from Supabase...</span>
          </div>
        ) : error ? (
          <div className="p-8 text-center text-xs text-rose-300 space-y-2">
            <p className="font-semibold">{error}</p>
            <button
              onClick={loadLogs}
              className="text-emerald-400 hover:underline inline-block mt-2"
            >
              Try Again
            </button>
          </div>
        ) : filteredLogs.length === 0 ? (
          <div className="py-16 text-center text-slate-500 space-y-2">
            <History className="h-8 w-8 mx-auto text-slate-600" />
            <p className="text-sm text-slate-400 font-medium">No records found</p>
            <p className="text-xs text-slate-600">No events matching the selected filter.</p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead className="bg-slate-950/80 text-slate-400 border-b border-slate-800 uppercase tracking-wider font-semibold text-[11px]">
                <tr>
                  <th className="py-3.5 px-4 sm:px-6">Status</th>
                  <th className="py-3.5 px-4">Time & Date</th>
                  <th className="py-3.5 px-4">Device ID</th>
                  <th className="py-3.5 px-4 hidden md:table-cell">Request ID</th>
                  <th className="py-3.5 px-4 sm:px-6">Details</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800/60 font-mono text-slate-300">
                {filteredLogs.map((log) => {
                  const isGranted = log.result === 'granted' || log.result === 'success';
                  return (
                    <tr key={log.id} className="hover:bg-slate-800/30 transition-colors">
                      <td className="py-3.5 px-4 sm:px-6">
                        <span
                          className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[11px] font-semibold border ${
                            isGranted
                              ? 'bg-emerald-500/10 text-emerald-400 border-emerald-500/30'
                              : 'bg-rose-500/10 text-rose-400 border-rose-500/30'
                          }`}
                        >
                          {isGranted ? (
                            <CheckCircle2 className="h-3.5 w-3.5" />
                          ) : (
                            <XCircle className="h-3.5 w-3.5" />
                          )}
                          <span className="capitalize">{log.result}</span>
                        </span>
                      </td>

                      <td className="py-3.5 px-4">
                        <div className="text-slate-200 text-xs font-sans font-medium">
                          {formatDate(log.occurred_at || log.created_at)}
                        </div>
                        <div className="text-[10px] text-slate-500 font-mono">
                          {formatTimeAgo(log.occurred_at || log.created_at)}
                        </div>
                      </td>

                      <td className="py-3.5 px-4">
                        <div className="flex items-center gap-1.5 text-slate-300 text-xs">
                          <Cpu className="h-3.5 w-3.5 text-slate-500" />
                          <span>{log.device_id || 'esp32_door_01'}</span>
                        </div>
                      </td>

                      <td className="py-3.5 px-4 hidden md:table-cell text-slate-400 text-[11px]">
                        {log.request_id ? (
                          <span className="bg-slate-950 px-2 py-0.5 rounded border border-slate-800">
                            {log.request_id}
                          </span>
                        ) : (
                          <span className="text-slate-600">—</span>
                        )}
                      </td>

                      <td className="py-3.5 px-4 sm:px-6 font-sans">
                        {log.failure_reason ? (
                          <span className="text-rose-400 text-xs">{log.failure_reason}</span>
                        ) : isGranted ? (
                          <span className="text-emerald-400/90 text-xs">Door unlatched (Solenoid)</span>
                        ) : (
                          <span className="text-slate-500 text-xs">—</span>
                        )}
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
