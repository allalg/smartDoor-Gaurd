import { supabase, isSupabaseConfigured } from '@/lib/supabase';
import type { Profile, UserMusic } from '@/types/database';
import { fetchSpotifyTrackDetails, saveUserMusicPreference } from './music';

export interface AuthResponse<T = unknown> {
  data: T | null;
  error: string | null;
}

export async function fetchUserProfile(userId: string): Promise<Profile | null> {
  if (!isSupabaseConfigured) return null;
  try {
    const { data, error } = await supabase
      .from('profiles')
      .select('id, display_name, role, is_enabled, approval_status, created_at')
      .eq('id', userId)
      .maybeSingle();

    if (error) {
      // Schema transition fallback: If approval_status column does not exist yet (code 42703)
      if (error.code === '42703' || error.message?.toLowerCase().includes('approval_status')) {
        console.warn('[auth] approval_status column not yet migrated in database, falling back to legacy profiles schema.');
        const fallback = await supabase
          .from('profiles')
          .select('id, display_name, role, is_enabled, created_at')
          .eq('id', userId)
          .maybeSingle();

        if (!fallback.error && fallback.data) {
          return {
            ...fallback.data,
            approval_status: fallback.data.is_enabled ? 'approved' : 'pending',
          } as Profile;
        }
      }

      console.error('Error fetching profile:', error.message);
      return null;
    }

    if (!data) {
      console.warn('[auth] Profile record not found for user ID:', userId);
      return null;
    }

    // Default null/undefined approval_status to enabled state
    const profile = data as Profile;
    if (!profile.approval_status) {
      profile.approval_status = profile.is_enabled ? 'approved' : 'pending';
    }

    return profile;
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
      .select('user_id, spotify_uri, track_title, artist_name, album_name, artwork_url, updated_at')
      .eq('user_id', userId)
      .maybeSingle();

    if (error) {
      console.error('Error fetching user music:', error.message);
      return null;
    }

    if (!data) return null;

    const musicRecord = data as UserMusic;

    // Requirement 8: For existing records whose metadata is missing, implement a safe fallback:
    // Retrieve track metadata from Spotify API via backend Edge Function and backfill user_music
    if (musicRecord.spotify_uri && (!musicRecord.track_title || !musicRecord.artist_name)) {
      try {
        const { track } = await fetchSpotifyTrackDetails(musicRecord.spotify_uri);
        if (track) {
          musicRecord.track_title = track.title;
          musicRecord.artist_name = track.artist_name;
          musicRecord.album_name = track.album_name;
          musicRecord.artwork_url = track.artwork_url;

          // Asynchronously persist hydrated metadata back to database
          saveUserMusicPreference(userId, musicRecord.spotify_uri, {
            track_title: track.title,
            artist_name: track.artist_name,
            album_name: track.album_name,
            artwork_url: track.artwork_url,
          }).catch((err) => console.warn('Non-fatal metadata backfill error:', err));
        }
      } catch (hydrationErr) {
        console.warn('Failed to hydrate legacy track metadata:', hydrationErr);
      }
    }

    return musicRecord;
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
      .update({
        display_name: displayName.trim(),
      })
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
