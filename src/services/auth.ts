import { supabase, isSupabaseConfigured } from '@/lib/supabase';
import type { Profile, UserMusic } from '@/types/database';

export interface AuthResponse<T = unknown> {
  data: T | null;
  error: string | null;
}

export async function fetchUserProfile(userId: string): Promise<Profile | null> {
  if (!isSupabaseConfigured) return null;
  try {
    const { data, error } = await supabase
      .from('profiles')
      .select('id, display_name, role, is_enabled, created_at')
      .eq('id', userId)
      .maybeSingle();

    if (error) {
      console.error('Error fetching profile:', error.message);
      return null;
    }
    return data as Profile;
  } catch (err: unknown) {
    console.error('Unexpected error fetching profile:', err);
    return null;
  }
}

export async function fetchUserMusicPreference(userId: string): Promise<UserMusic | null> {
  if (!isSupabaseConfigured) return null;
  try {
    const { data, error } = await supabase
      .from('user_music')
      .select('user_id, spotify_uri, updated_at')
      .eq('user_id', userId)
      .maybeSingle();

    if (error) {
      console.error('Error fetching user music:', error.message);
      return null;
    }
    return data as UserMusic;
  } catch (err: unknown) {
    console.error('Unexpected error fetching user music:', err);
    return null;
  }
}

export async function updateUserProfile(
  userId: string,
  displayName: string
): Promise<AuthResponse<Profile>> {
  if (!isSupabaseConfigured) {
    return { data: null, error: 'Supabase credentials are not configured.' };
  }

  try {
    const { data, error } = await supabase
      .from('profiles')
      .update({ display_name: displayName.trim() })
      .eq('id', userId)
      .select()
      .single();

    if (error) {
      return { data: null, error: error.message };
    }
    return { data: data as Profile, error: null };
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : 'Failed to update profile';
    return { data: null, error: msg };
  }
}
