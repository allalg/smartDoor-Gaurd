import React, { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '@/context/AuthContext';
import { BluetoothConnectCard } from '@/components/BluetoothConnectCard';
import { DoorAuthModal } from '@/components/DoorAuthModal';
import { fetchUserAccessLogs } from '@/services/access-history';
import type { EntryLog } from '@/types/database';
import { formatDate, formatTimeAgo } from '@/lib/utils';
import {
  KeyRound,
  ShieldCheck,
  Music,
  History,
  CheckCircle2,
  XCircle,
  Clock,
  ArrowRight,
  Sparkles,
  ExternalLink,
  Loader2,
  RefreshCw,
} from 'lucide-react';

export const Dashboard: React.FC = () => {
  const { user, profile, music } = useAuth();

  const [isModalOpen, setIsModalOpen] = useState(false);
  const [recentLogs, setRecentLogs] = useState<EntryLog[]>([]);
  const [loadingLogs, setLoadingLogs] = useState(true);
  const [errorLogs, setErrorLogs] = useState<string | null>(null);

  const loadLogs = async () => {
    if (!user) return;
    setLoadingLogs(true);
    setErrorLogs(null);
    try {
      const { logs, error } = await fetchUserAccessLogs(user.id, 5);
      if (error) {
        setErrorLogs(error);
      } else {
        setRecentLogs(logs);
      }
    } catch (err: unknown) {
      setErrorLogs('Failed to load recent logs');
    } finally {
      setLoadingLogs(false);
    }
  };

  useEffect(() => {
    loadLogs();
  }, [user]);

  const displayName = profile?.display_name || user?.email?.split('@')[0] || 'Resident';

  return (
    <div className="space-y-6">
      {/* Welcome Banner */}
      <div className="relative overflow-hidden rounded-2xl bg-gradient-to-r from-slate-900 via-slate-900 to-slate-800/80 border border-slate-800 p-6 sm:p-8">
        <div className="relative z-10 flex flex-col md:flex-row md:items-center justify-between gap-6">
          <div className="space-y-1.5">
            <div className="flex items-center gap-2 text-xs font-medium text-emerald-400">
              <Sparkles className="h-4 w-4" />
              <span>Smart IoT Zero-Trust Node</span>
            </div>
            <h1 className="text-2xl sm:text-3xl font-bold text-white tracking-tight">
              Welcome back, {displayName}
            </h1>
            <p className="text-sm text-slate-400 max-w-xl">
              Hold your Android device near the ESP32 door lock. When prompted on the LCD, tap below to exchange secure one-time credentials.
            </p>
          </div>

          <button
            onClick={() => setIsModalOpen(true)}
            className="inline-flex items-center justify-center gap-2.5 px-6 py-3.5 rounded-xl bg-emerald-500 hover:bg-emerald-400 text-slate-950 font-bold text-sm transition-all shadow-lg shadow-emerald-500/20 hover:scale-[1.02] active:scale-[0.98] shrink-0"
          >
            <KeyRound className="h-5 w-5" />
            <span>Authenticate at Door</span>
          </button>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Left Column (2 Cols): Bluetooth Connection Card & Spotify Preference */}
        <div className="lg:col-span-2 space-y-6">
          {/* Section 4 Dedicated Web Bluetooth Card */}
          <BluetoothConnectCard />

          {/* Preferred Spotify Song Card */}
          <div className="rounded-2xl bg-slate-900/80 border border-slate-800 p-5 sm:p-6 backdrop-blur-sm">
            <div className="flex items-center justify-between mb-4">
              <div className="flex items-center gap-3">
                <div className="p-2.5 rounded-xl bg-emerald-500/10 border border-emerald-500/20 text-emerald-400">
                  <Music className="h-5 w-5" />
                </div>
                <div>
                  <h3 className="text-base font-semibold text-white">Preferred Entry Track</h3>
                  <p className="text-xs text-slate-400">Plays directly on Spotify Connect device upon verified entry</p>
                </div>
              </div>

              <Link
                to="/profile"
                className="text-xs text-emerald-400 hover:text-emerald-300 font-medium flex items-center gap-1"
              >
                <span>Edit</span>
                <ArrowRight className="h-3 w-3" />
              </Link>
            </div>

            {music?.spotify_uri ? (
              <div className="p-4 rounded-xl bg-slate-950 border border-slate-800/80 flex items-center justify-between gap-3">
                <div className="flex items-center gap-3 min-w-0">
                  {music.artwork_url ? (
                    <img
                      src={music.artwork_url}
                      alt={music.track_title || 'Album cover'}
                      className="h-11 w-11 rounded-lg object-cover border border-slate-800 shrink-0"
                    />
                  ) : (
                    <div className="h-11 w-11 rounded-lg bg-emerald-500/10 border border-emerald-500/20 flex items-center justify-center text-emerald-400 shrink-0">
                      <Music className="h-5 w-5" />
                    </div>
                  )}
                  <div className="min-w-0 space-y-0.5">
                    <div className="font-medium text-xs text-slate-100 truncate">
                      {music.track_title || 'Selected Spotify track'}
                    </div>
                    <div className="text-[11px] text-slate-400 truncate">
                      {music.artist_name ? (music.album_name ? `${music.artist_name} • ${music.album_name}` : music.artist_name) : 'Spotify Track'}
                    </div>
                  </div>
                </div>

                <a
                  href={`https://open.spotify.com/track/${music.spotify_uri.replace('spotify:track:', '')}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="p-2 rounded-lg bg-slate-900 hover:bg-slate-800 text-slate-300 hover:text-white border border-slate-700 transition-colors shrink-0"
                  title="Open in Spotify"
                >
                  <ExternalLink className="h-4 w-4" />
                </a>
              </div>
            ) : (
              <div className="p-4 rounded-xl bg-slate-950/40 border border-dashed border-slate-800 text-center space-y-2">
                <p className="text-xs text-slate-400">No favorite track selected yet.</p>
                <Link
                  to="/profile"
                  className="inline-block text-xs font-semibold text-emerald-400 hover:underline"
                >
                  Set your Spotify entrance song &rarr;
                </Link>
              </div>
            )}
          </div>
        </div>

        {/* Right Column (1 Col): Recent Access History */}
        <div className="rounded-2xl bg-slate-900/80 border border-slate-800 p-5 sm:p-6 flex flex-col justify-between backdrop-blur-sm">
          <div>
            <div className="flex items-center justify-between mb-4">
              <div className="flex items-center gap-2.5">
                <div className="p-2 rounded-lg bg-slate-800 text-slate-300">
                  <History className="h-4 w-4" />
                </div>
                <h3 className="text-base font-semibold text-white">Recent Attempts</h3>
              </div>
              <button
                onClick={loadLogs}
                title="Refresh log"
                className="p-1.5 rounded-lg text-slate-400 hover:text-slate-200 hover:bg-slate-800 transition-colors"
              >
                <RefreshCw className={`h-3.5 w-3.5 ${loadingLogs ? 'animate-spin' : ''}`} />
              </button>
            </div>

            {loadingLogs ? (
              <div className="py-8 flex flex-col items-center justify-center text-slate-500 gap-2 text-xs">
                <Loader2 className="h-5 w-5 animate-spin text-emerald-500" />
                <span>Fetching access logs...</span>
              </div>
            ) : errorLogs ? (
              <div className="p-3 rounded-xl bg-rose-500/10 border border-rose-500/20 text-xs text-rose-300">
                {errorLogs}
              </div>
            ) : recentLogs.length === 0 ? (
              <div className="py-8 text-center text-xs text-slate-500 space-y-1">
                <p>No entry events recorded.</p>
                <p className="text-[11px] text-slate-600">Events will appear here after authentication attempts.</p>
              </div>
            ) : (
              <div className="space-y-2.5">
                {recentLogs.map((log) => {
                  const isGranted = log.result === 'success' || log.result === 'granted';
                  return (
                    <div
                      key={log.id}
                      className="p-3 rounded-xl bg-slate-950/70 border border-slate-800/80 flex items-center justify-between text-xs"
                    >
                      <div className="flex items-center gap-2.5">
                        {isGranted ? (
                          <CheckCircle2 className="h-4 w-4 text-emerald-400 shrink-0" />
                        ) : (
                          <XCircle className="h-4 w-4 text-rose-400 shrink-0" />
                        )}
                        <div>
                          <div className="font-semibold text-slate-200 capitalize">
                            {isGranted ? 'Access Granted' : 'Access Denied'}
                          </div>
                          <div className="text-[10px] text-slate-500 font-mono">
                            {formatTimeAgo(log.occurred_at || log.created_at)}
                          </div>
                        </div>
                      </div>

                      <span
                        className={`text-[10px] font-mono px-2 py-0.5 rounded-full uppercase border ${
                          isGranted
                            ? 'bg-emerald-500/10 text-emerald-400 border-emerald-500/30'
                            : 'bg-rose-500/10 text-rose-400 border-rose-500/30'
                        }`}
                      >
                        {log.result}
                      </span>
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          <div className="pt-4 mt-4 border-t border-slate-800">
            <Link
              to="/access-history"
              className="flex items-center justify-center gap-2 text-xs font-medium text-slate-400 hover:text-white py-2 rounded-lg bg-slate-950/60 hover:bg-slate-800/60 transition-colors border border-slate-800/80"
            >
              <span>View Full Access History</span>
              <ArrowRight className="h-3 w-3" />
            </Link>
          </div>
        </div>
      </div>

      {/* Door Auth Modal Triggered by Prominent Button */}
      <DoorAuthModal
        isOpen={isModalOpen}
        onClose={() => setIsModalOpen(false)}
        onAuthComplete={() => {
          loadLogs();
        }}
      />
    </div>
  );
};
