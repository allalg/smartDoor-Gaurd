import React, { useState, useEffect } from 'react';
import { fetchAllAccessLogs } from '@/services/access-history';
import type { EntryLog } from '@/types/database';
import { formatDate, formatTimeAgo } from '@/lib/utils';
import {
  ScrollText,
  CheckCircle2,
  XCircle,
  Search,
  RefreshCw,
  Loader2,
  Cpu,
  User,
  Filter,
} from 'lucide-react';

export const AdminAccessLogs: React.FC = () => {
  const [logs, setLogs] = useState<EntryLog[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [filter, setFilter] = useState<'all' | 'granted' | 'denied'>('all');

  const loadLogs = async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetchAllAccessLogs(100);
      if (res.error) {
        setError(res.error);
      } else {
        setLogs(res.logs);
      }
    } catch {
      setError('Failed to fetch access logs');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadLogs();
  }, []);

  const filteredLogs = logs.filter((log) => {
    if (filter !== 'all' && log.result !== filter) return false;
    if (!search) return true;

    const q = search.toLowerCase();
    const reqMatch = log.request_id?.toLowerCase().includes(q);
    const userMatch = log.user_id?.toLowerCase().includes(q);
    const nameMatch = log.profile?.display_name?.toLowerCase().includes(q);
    const devMatch = log.device_id?.toLowerCase().includes(q);

    return reqMatch || userMatch || nameMatch || devMatch;
  });

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-white tracking-tight">Audit Access Logs</h1>
          <p className="text-xs text-slate-400 mt-1">
            Complete physical access audit trail stored in the <code>entry_logs</code> table
          </p>
        </div>

        <button
          onClick={loadLogs}
          className="inline-flex items-center gap-2 px-3.5 py-2 rounded-xl bg-slate-900 border border-slate-800 text-slate-300 hover:text-white hover:bg-slate-800 text-xs font-medium transition-colors"
        >
          <RefreshCw className={`h-3.5 w-3.5 ${loading ? 'animate-spin' : ''}`} />
          <span>Refresh Logs</span>
        </button>
      </div>

      {/* Search and Filters */}
      <div className="flex flex-col sm:flex-row items-center gap-3">
        <div className="relative flex-1 w-full">
          <Search className="absolute left-3.5 top-2.5 h-4 w-4 text-slate-500" />
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search by Request ID, User ID, name, or Device..."
            className="w-full bg-slate-900/90 border border-slate-800 rounded-xl pl-10 pr-4 py-2 text-xs text-slate-200 placeholder:text-slate-600 focus:outline-none focus:border-rose-500/50"
          />
        </div>

        <div className="flex items-center bg-slate-900 border border-slate-800 p-1 rounded-xl text-xs w-full sm:w-auto">
          <button
            onClick={() => setFilter('all')}
            className={`px-3 py-1.5 rounded-lg font-medium transition-colors ${
              filter === 'all' ? 'bg-slate-800 text-white' : 'text-slate-400 hover:text-slate-200'
            }`}
          >
            All
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
      </div>

      {/* Logs Table */}
      <div className="rounded-2xl bg-slate-900/80 border border-slate-800 overflow-hidden backdrop-blur-sm">
        {loading ? (
          <div className="py-16 flex flex-col items-center justify-center text-slate-500 gap-3 text-xs">
            <Loader2 className="h-6 w-6 animate-spin text-rose-500" />
            <span>Fetching security access logs...</span>
          </div>
        ) : error ? (
          <div className="p-8 text-center text-xs text-rose-300">{error}</div>
        ) : filteredLogs.length === 0 ? (
          <div className="py-16 text-center text-slate-500 space-y-2">
            <ScrollText className="h-8 w-8 mx-auto text-slate-600" />
            <p className="text-sm text-slate-400 font-medium">No access events found</p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead className="bg-slate-950/80 text-slate-400 border-b border-slate-800 uppercase tracking-wider font-semibold text-[11px]">
                <tr>
                  <th className="py-3.5 px-4 sm:px-6">Result</th>
                  <th className="py-3.5 px-4">Timestamp</th>
                  <th className="py-3.5 px-4">User Identity</th>
                  <th className="py-3.5 px-4">Device ID</th>
                  <th className="py-3.5 px-4 hidden lg:table-cell">Request ID</th>
                  <th className="py-3.5 px-4 sm:px-6">Failure Reason / Notes</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800/60 font-mono text-slate-300">
                {filteredLogs.map((log) => {
                  const isGranted = log.result === 'granted';
                  return (
                    <tr key={log.id} className="hover:bg-slate-800/30 transition-colors">
                      <td className="py-3.5 px-4 sm:px-6">
                        <span
                          className={`inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-[11px] font-semibold border ${
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
                        <div className="text-slate-200 text-xs font-sans">
                          {formatDate(log.occurred_at || log.created_at)}
                        </div>
                        <div className="text-[10px] text-slate-500">
                          {formatTimeAgo(log.occurred_at || log.created_at)}
                        </div>
                      </td>

                      <td className="py-3.5 px-4">
                        <div className="flex items-center gap-2">
                          <User className="h-3.5 w-3.5 text-slate-500" />
                          <span className="text-white font-sans font-medium text-xs">
                            {log.profile?.display_name || (log.user_id ? log.user_id.substring(0, 8) + '...' : 'Anonymous / RFID')}
                          </span>
                        </div>
                      </td>

                      <td className="py-3.5 px-4">
                        <div className="flex items-center gap-1.5 text-slate-300">
                          <Cpu className="h-3.5 w-3.5 text-slate-500" />
                          <span>{log.device_id || 'esp32_door_01'}</span>
                        </div>
                      </td>

                      <td className="py-3.5 px-4 hidden lg:table-cell text-slate-400 text-[11px]">
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
                          <span className="text-rose-400 text-xs font-medium">{log.failure_reason}</span>
                        ) : isGranted ? (
                          <span className="text-emerald-400/90 text-xs">Authenticated (Solenoid pulsed)</span>
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
