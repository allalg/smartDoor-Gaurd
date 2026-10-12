import React, { useState, useEffect } from 'react';
import { useAuth } from '@/context/AuthContext';
import { updateUserProfile } from '@/services/auth';
import {
  parseSpotifyInput,
  saveUserMusicPreference,
  clearUserMusicPreference,
} from '@/services/music';
import {
  User,
  Mail,
  Music,
  CheckCircle2,
  AlertCircle,
  Trash2,
  ExternalLink,
  Save,
  Loader2,
  Shield,
} from 'lucide-react';

export const Profile: React.FC = () => {
  const { user, profile, music, refreshProfile, refreshMusic } = useAuth();

  const [displayName, setDisplayName] = useState('');
  const [spotifyInput, setSpotifyInput] = useState('');
  const [profileSaving, setProfileSaving] = useState(false);
  const [musicSaving, setMusicSaving] = useState(false);
  const [profileSuccess, setProfileSuccess] = useState<string | null>(null);
  const [profileError, setProfileError] = useState<string | null>(null);
  const [musicSuccess, setMusicSuccess] = useState<string | null>(null);
  const [musicError, setMusicError] = useState<string | null>(null);

  // Sync state from profile & music
  useEffect(() => {
    if (profile?.display_name) {
      setDisplayName(profile.display_name);
    }
    if (music?.spotify_uri) {
      setSpotifyInput(music.spotify_uri);
    }
  }, [profile, music]);

  const handleUpdateProfile = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!user) return;
    setProfileError(null);
    setProfileSuccess(null);
    setProfileSaving(true);

    try {
      const res = await updateUserProfile(user.id, displayName);
      if (res.error) {
        setProfileError(res.error);
      } else {
        setProfileSuccess('Profile display name updated successfully');
        await refreshProfile();
        setTimeout(() => setProfileSuccess(null), 4000);
      }
    } catch (err: unknown) {
      setProfileError('Failed to update profile');
    } finally {
      setProfileSaving(false);
    }
  };

  const handleSaveMusic = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!user) return;
    setMusicError(null);
    setMusicSuccess(null);

    // Validation
    const parsed = parseSpotifyInput(spotifyInput);
    if (!parsed.isValid) {
      setMusicError(parsed.error || 'Invalid Spotify link or URI');
      return;
    }

    setMusicSaving(true);
    try {
      const res = await saveUserMusicPreference(user.id, parsed.uri);
      if (res.error) {
        setMusicError(res.error);
      } else {
        setMusicSuccess('Preferred song saved! ESP32 triggers this via IFTTT on entry.');
        setSpotifyInput(parsed.uri);
        await refreshMusic();
        setTimeout(() => setMusicSuccess(null), 4000);
      }
    } catch (err: unknown) {
      setMusicError('Failed to save music preference');
    } finally {
      setMusicSaving(false);
    }
  };

  const handleClearMusic = async () => {
    if (!user) return;
    setMusicError(null);
    setMusicSuccess(null);
    setMusicSaving(true);

    try {
      const res = await clearUserMusicPreference(user.id);
      if (res.error) {
        setMusicError(res.error);
      } else {
        setSpotifyInput('');
        setMusicSuccess('Preferred song cleared.');
        await refreshMusic();
        setTimeout(() => setMusicSuccess(null), 4000);
      }
    } catch (err: unknown) {
      setMusicError('Failed to clear song');
    } finally {
      setMusicSaving(false);
    }
  };

  return (
    <div className="max-w-3xl space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-white tracking-tight">Account Profile & Preferences</h1>
        <p className="text-xs text-slate-400 mt-1">Manage your identity credentials and IoT automation triggers</p>
      </div>

      {/* Profile Details Card */}
      <div className="rounded-2xl bg-slate-900/80 border border-slate-800 p-6 backdrop-blur-sm">
        <div className="flex items-center gap-3 mb-6">
          <div className="p-2.5 rounded-xl bg-slate-800 text-slate-300">
            <User className="h-5 w-5" />
          </div>
          <div>
            <h2 className="text-base font-semibold text-white">Resident Identity</h2>
            <p className="text-xs text-slate-400">Stored in the <code>profiles</code> table</p>
          </div>
        </div>

        {profileSuccess && (
          <div className="mb-5 p-3 rounded-xl bg-emerald-500/10 border border-emerald-500/20 text-xs text-emerald-300 flex items-center gap-2">
            <CheckCircle2 className="h-4 w-4 text-emerald-400 shrink-0" />
            <span>{profileSuccess}</span>
          </div>
        )}

        {profileError && (
          <div className="mb-5 p-3 rounded-xl bg-rose-500/10 border border-rose-500/20 text-xs text-rose-300 flex items-center gap-2">
            <AlertCircle className="h-4 w-4 text-rose-400 shrink-0" />
            <span>{profileError}</span>
          </div>
        )}

        <form onSubmit={handleUpdateProfile} className="space-y-4">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-medium text-slate-400 mb-1.5">Read-Only Email</label>
              <div className="relative">
                <Mail className="absolute left-3.5 top-3 h-4 w-4 text-slate-600" />
                <input
                  type="email"
                  value={user?.email || ''}
                  disabled
                  className="w-full bg-slate-950/60 border border-slate-800/80 rounded-xl pl-10 pr-3.5 py-2.5 text-sm text-slate-400 cursor-not-allowed font-mono text-xs"
                />
              </div>
              <p className="text-[10px] text-slate-600 mt-1">Managed via Supabase Auth</p>
            </div>

            <div>
              <label className="block text-xs font-medium text-slate-300 mb-1.5">Display Name</label>
              <input
                type="text"
                value={displayName}
                onChange={(e) => setDisplayName(e.target.value)}
                placeholder="Your full name"
                className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3.5 py-2.5 text-sm text-slate-100 focus:outline-none focus:border-emerald-500/60 focus:ring-1 focus:ring-emerald-500/40"
                required
              />
              <p className="text-[10px] text-slate-500 mt-1">Displayed on the door LCD upon entrance</p>
            </div>
          </div>

          <div className="flex justify-end pt-2">
            <button
              type="submit"
              disabled={profileSaving}
              className="py-2.5 px-5 rounded-xl bg-slate-800 hover:bg-slate-700 disabled:opacity-50 text-white font-medium text-xs transition-colors border border-slate-700 flex items-center gap-2"
            >
              {profileSaving ? (
                <>
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  <span>Saving...</span>
                </>
              ) : (
                <>
                  <Save className="h-3.5 w-3.5 text-emerald-400" />
                  <span>Save Name</span>
                </>
              )}
            </button>
          </div>
        </form>
      </div>

      {/* Spotify Integration Card */}
      <div className="rounded-2xl bg-slate-900/80 border border-slate-800 p-6 backdrop-blur-sm">
        <div className="flex items-center justify-between mb-6">
          <div className="flex items-center gap-3">
            <div className="p-2.5 rounded-xl bg-emerald-500/10 border border-emerald-500/20 text-emerald-400">
              <Music className="h-5 w-5" />
            </div>
            <div>
              <h2 className="text-base font-semibold text-white">Spotify Entry Soundtrack</h2>
              <p className="text-xs text-slate-400">Stored in the <code>user_music</code> table</p>
            </div>
          </div>

          {music?.spotify_uri && (
            <span className="text-[11px] font-mono font-medium px-2.5 py-1 rounded-full bg-emerald-500/10 text-emerald-300 border border-emerald-500/20">
              Song Active
            </span>
          )}
        </div>

        {musicSuccess && (
          <div className="mb-5 p-3 rounded-xl bg-emerald-500/10 border border-emerald-500/20 text-xs text-emerald-300 flex items-center gap-2">
            <CheckCircle2 className="h-4 w-4 text-emerald-400 shrink-0" />
            <span>{musicSuccess}</span>
          </div>
        )}

        {musicError && (
          <div className="mb-5 p-3 rounded-xl bg-rose-500/10 border border-rose-500/20 text-xs text-rose-300 flex items-center gap-2">
            <AlertCircle className="h-4 w-4 text-rose-400 shrink-0" />
            <span>{musicError}</span>
          </div>
        )}

        <form onSubmit={handleSaveMusic} className="space-y-4">
          <div>
            <label className="block text-xs font-medium text-slate-300 mb-1.5">
              Spotify Track URL or URI
            </label>
            <input
              type="text"
              value={spotifyInput}
              onChange={(e) => setSpotifyInput(e.target.value)}
              placeholder="e.g. spotify:track:4cOdK2wGLETKBW3PvgPWqT or https://open.spotify.com/track/..."
              className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3.5 py-2.5 text-xs text-slate-100 font-mono placeholder:font-sans placeholder:text-slate-600 focus:outline-none focus:border-emerald-500/60 focus:ring-1 focus:ring-emerald-500/40"
            />
            <p className="text-[11px] text-slate-500 mt-1.5">
              Copy any Spotify track link or URI from the Spotify app. When the ESP32 verifies your physical entry, our backend triggers your song via IFTTT.
            </p>
          </div>

          {/* Current saved song preview */}
          {music?.spotify_uri && (
            <div className="p-3.5 rounded-xl bg-slate-950 border border-slate-800 flex items-center justify-between text-xs">
              <div className="space-y-0.5">
                <span className="text-[11px] text-slate-400">Current Saved Preference:</span>
                <div className="font-mono text-emerald-400 text-xs">{music.spotify_uri}</div>
              </div>
              <a
                href={`https://open.spotify.com/track/${music.spotify_uri.replace('spotify:track:', '')}`}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-slate-900 hover:bg-slate-800 text-slate-300 hover:text-white border border-slate-700 text-xs transition-colors"
              >
                <span>Preview</span>
                <ExternalLink className="h-3 w-3" />
              </a>
            </div>
          )}

          <div className="flex items-center justify-between pt-2">
            {music?.spotify_uri ? (
              <button
                type="button"
                onClick={handleClearMusic}
                disabled={musicSaving}
                className="py-2.5 px-4 rounded-xl bg-rose-500/10 hover:bg-rose-500/20 text-rose-300 border border-rose-500/20 font-medium text-xs transition-colors flex items-center gap-1.5"
              >
                <Trash2 className="h-3.5 w-3.5" />
                <span>Clear Song</span>
              </button>
            ) : <div />}

            <button
              type="submit"
              disabled={musicSaving}
              className="py-2.5 px-5 rounded-xl bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 text-white font-medium text-xs transition-colors shadow-md shadow-emerald-600/20 flex items-center gap-2"
            >
              {musicSaving ? (
                <>
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  <span>Saving Preference...</span>
                </>
              ) : (
                <>
                  <Save className="h-3.5 w-3.5" />
                  <span>Save Song Preference</span>
                </>
              )}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};
