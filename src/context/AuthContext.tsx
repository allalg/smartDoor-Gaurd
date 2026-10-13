import React, { createContext, useContext, useEffect, useState, useMemo } from 'react';
import type { User, Session } from '@supabase/supabase-js';
import { supabase, isSupabaseConfigured } from '@/lib/supabase';
import type { Profile, UserMusic, UserRole, ApprovalStatus } from '@/types/database';
import { fetchUserProfile, fetchUserMusicPreference } from '@/services/auth';

interface AuthContextType {
  user: User | null;
  session: Session | null;
  profile: Profile | null;
  music: UserMusic | null;
  role: UserRole;
  isAdmin: boolean;
  isEnabled: boolean;
  approvalStatus: ApprovalStatus;
  isApproved: boolean;
  isPendingApproval: boolean;
  isRejected: boolean;
  loading: boolean;
  isConfigured: boolean;
  error: string | null;
  signIn: (email: string, password: string) => Promise<{ success: boolean; error: string | null; profile?: Profile | null }>;
  signUp: (email: string, password: string, displayName: string) => Promise<{ success: boolean; error: string | null; unconfirmed?: boolean }>;
  signOut: () => Promise<void>;
  refreshProfile: () => Promise<void>;
  refreshMusic: () => Promise<void>;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export const AuthProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [user, setUser] = useState<User | null>(null);
  const [session, setSession] = useState<Session | null>(null);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [music, setMusic] = useState<UserMusic | null>(null);
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);

  const loadUserData = async (currentUser: User): Promise<Profile | null> => {
    try {
      const [fetchedProfile, fetchedMusic] = await Promise.all([
        fetchUserProfile(currentUser.id),
        fetchUserMusicPreference(currentUser.id),
      ]);
      setProfile(fetchedProfile);
      setMusic(fetchedMusic);
      return fetchedProfile;
    } catch (err) {
      console.error('Failed to load user profile or music preferences:', err);
      return null;
    }
  };

  useEffect(() => {
    if (!isSupabaseConfigured) {
      setLoading(false);
      return;
    }

    // Check active session
    supabase.auth.getSession().then(({ data: { session } }) => {
      setSession(session);
      setUser(session?.user ?? null);
      if (session?.user) {
        loadUserData(session.user).finally(() => setLoading(false));
      } else {
        setLoading(false);
      }
    });

    const { data: { subscription } } = supabase.auth.onAuthStateChange(async (_event, newSession) => {
      setSession(newSession);
      setUser(newSession?.user ?? null);

      if (newSession?.user) {
        await loadUserData(newSession.user);
      } else {
        setProfile(null);
        setMusic(null);
      }
      setLoading(false);
    });

    return () => {
      subscription.unsubscribe();
    };
  }, []);

  const refreshProfile = async () => {
    if (user) {
      const p = await fetchUserProfile(user.id);
      setProfile(p);
    }
  };

  const refreshMusic = async () => {
    if (user) {
      const m = await fetchUserMusicPreference(user.id);
      setMusic(m);
    }
  };

  const signIn = async (email: string, password: string) => {
    setError(null);
    if (!isSupabaseConfigured) {
      return { success: false, error: 'Supabase credentials are not configured in .env' };
    }

    try {
      const { data, error: authError } = await supabase.auth.signInWithPassword({
        email: email.trim(),
        password,
      });

      if (authError) {
        return { success: false, error: authError.message };
      }

      let userProfile: Profile | null = null;
      if (data.user) {
        userProfile = await loadUserData(data.user);
      }

      return { success: true, error: null, profile: userProfile };
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Login failed';
      return { success: false, error: msg };
    }
  };

  const signUp = async (email: string, password: string, displayName: string) => {
    setError(null);
    if (!isSupabaseConfigured) {
      return { success: false, error: 'Supabase credentials are not configured in .env' };
    }

    try {
      const { data, error: authError } = await supabase.auth.signUp({
        email: email.trim(),
        password,
        options: {
          data: {
            display_name: displayName.trim(),
          },
        },
      });

      if (authError) {
        return { success: false, error: authError.message };
      }

      // If Supabase has email confirmation enabled, session will be null
      const unconfirmed = !data.session;
      return { success: true, error: null, unconfirmed };
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Signup failed';
      return { success: false, error: msg };
    }
  };

  const signOut = async () => {
    if (isSupabaseConfigured) {
      await supabase.auth.signOut();
    }
    setUser(null);
    setSession(null);
    setProfile(null);
    setMusic(null);
  };

  const role: UserRole = profile?.role ?? 'user';
  const isAdmin = role === 'admin';
  const isEnabled = profile?.is_enabled ?? false;
  const approvalStatus: ApprovalStatus = profile?.approval_status ?? (profile?.is_enabled ? 'approved' : 'pending');
  const isApproved = approvalStatus === 'approved' && isEnabled;
  const isPendingApproval = approvalStatus === 'pending';
  const isRejected = approvalStatus === 'rejected';

  const value = useMemo(
    () => ({
      user,
      session,
      profile,
      music,
      role,
      isAdmin,
      isEnabled,
      approvalStatus,
      isApproved,
      isPendingApproval,
      isRejected,
      loading,
      isConfigured: isSupabaseConfigured,
      error,
      signIn,
      signUp,
      signOut,
      refreshProfile,
      refreshMusic,
    }),
    [user, session, profile, music, role, isAdmin, isEnabled, approvalStatus, isApproved, isPendingApproval, isRejected, loading, error]
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
};

export const useAuth = () => {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
};
