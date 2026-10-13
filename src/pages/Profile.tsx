import React, { useState, useEffect } from 'react';
import { useAuth } from '@/context/AuthContext';
import { updateUserProfile } from '@/services/auth';
import { SpotifySongPicker } from '@/components/SpotifySongPicker';
import {
  User,
  Mail,
  CheckCircle2,
  AlertCircle,
  Save,
  Loader2,
  Shield,
} from 'lucide-react';

export const Profile: React.FC = () => {
  const { user, profile, refreshProfile } = useAuth();

  const [displayName, setDisplayName] = useState('');
  const [profileSaving, setProfileSaving] = useState(false);
  const [profileSuccess, setProfileSuccess] = useState<string | null>(null);
  const [profileError, setProfileError] = useState<string | null>(null);

  // Sync state from profile
  useEffect(() => {
    if (profile?.display_name) {
      setDisplayName(profile.display_name);
    }
  }, [profile]);

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
    } catch {
      setProfileError('Failed to update profile');
    } finally {
      setProfileSaving(false);
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
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-medium text-slate-300 mb-1.5">
                Display Name
              </label>
              <div className="relative">
                <input
                  type="text"
                  value={displayName}
                  onChange={(e) => setDisplayName(e.target.value)}
                  placeholder="e.g. John Doe"
                  className="w-full bg-slate-950 border border-slate-800 rounded-xl pl-9 pr-3.5 py-2.5 text-xs text-slate-100 placeholder:text-slate-600 focus:outline-none focus:border-indigo-500/60 focus:ring-1 focus:ring-indigo-500/40"
                />
                <User className="h-4 w-4 text-slate-500 absolute left-3 top-3" />
              </div>
            </div>

            <div>
              <label className="block text-xs font-medium text-slate-300 mb-1.5">
                Email Address
              </label>
              <div className="relative">
                <input
                  type="email"
                  disabled
                  value={user?.email || ''}
                  className="w-full bg-slate-950/60 border border-slate-800 rounded-xl pl-9 pr-3.5 py-2.5 text-xs text-slate-400 cursor-not-allowed opacity-80"
                />
                <Mail className="h-4 w-4 text-slate-500 absolute left-3 top-3" />
              </div>
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4 pt-1">
            <div>
              <label className="block text-xs font-medium text-slate-400 mb-1">
                Account Role
              </label>
              <div className="flex items-center gap-2 text-xs font-medium text-slate-200">
                <Shield className="h-3.5 w-3.5 text-indigo-400" />
                <span className="capitalize">{profile?.role || 'user'}</span>
              </div>
            </div>

            <div>
              <label className="block text-xs font-medium text-slate-400 mb-1">
                Account Status
              </label>
              <div className="flex items-center gap-2 text-xs font-medium text-emerald-400">
                <span className="h-2 w-2 rounded-full bg-emerald-400" />
                <span>{profile?.is_enabled ? 'Active / Authorized' : 'Disabled'}</span>
              </div>
            </div>
          </div>

          <div className="flex justify-end pt-2">
            <button
              type="submit"
              disabled={profileSaving}
              className="py-2.5 px-5 rounded-xl bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 text-white font-medium text-xs transition-colors shadow-md shadow-indigo-600/20 flex items-center gap-2"
            >
              {profileSaving ? (
                <>
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  <span>Saving Changes...</span>
                </>
              ) : (
                <>
                  <Save className="h-3.5 w-3.5" />
                  <span>Update Profile</span>
                </>
              )}
            </button>
          </div>
        </form>
      </div>

      {/* Spotify Integration Component */}
      <SpotifySongPicker />
    </div>
  );
};
