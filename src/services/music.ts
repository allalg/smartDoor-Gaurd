import { supabase, isSupabaseConfigured } from '@/lib/supabase';
import type { UserMusic } from '@/types/database';

export interface SpotifyTrackInfo {
  id: string;
  uri: string;
  url: string;
  isValid: boolean;
  error?: string;
}

/**
 * Validates and normalizes user input into a canonical Spotify track URI and URL.
 * Supports:
 * - spotify:track:4cOdK2wGLETKBW3PvgPWqT
 * - https://open.spotify.com/track/4cOdK2wGLETKBW3PvgPWqT?si=...
 * - open.spotify.com/track/4cOdK2wGLETKBW3PvgPWqT
 */
export function parseSpotifyInput(input: string): SpotifyTrackInfo {
  const trimmed = input.trim();
  if (!trimmed) {
    return { id: '', uri: '', url: '', isValid: false, error: 'Input cannot be empty' };
  }

  // Check for spotify:track:ID
  const uriMatch = trimmed.match(/^spotify:track:([a-zA-Z0-9]{22})$/i);
  if (uriMatch) {
    const id = uriMatch[1];
    return {
      id,
      uri: `spotify:track:${id}`,
      url: `https://open.spotify.com/track/${id}`,
      isValid: true,
    };
  }

  // Check for open.spotify.com/track/ID
  const urlMatch = trimmed.match(/(?:https?:\/\/)?open\.spotify\.com\/track\/([a-zA-Z0-9]{22})(?:\?.*)?$/i);
  if (urlMatch) {
    const id = urlMatch[1];
    return {
      id,
      uri: `spotify:track:${id}`,
      url: `https://open.spotify.com/track/${id}`,
      isValid: true,
    };
  }

  return {
    id: '',
    uri: '',
    url: '',
    isValid: false,
    error: 'Please enter a valid Spotify track URL or URI (e.g., https://open.spotify.com/track/...)',
  };
}

export async function saveUserMusicPreference(
  userId: string,
  spotifyUri: string | null
): Promise<{ success: boolean; data: UserMusic | null; error: string | null }> {
  if (!isSupabaseConfigured) {
    return { success: false, data: null, error: 'Supabase credentials are not configured.' };
  }

  try {
    const payload = {
      user_id: userId,
      spotify_uri: spotifyUri,
      updated_at: new Date().toISOString(),
    };

    const { data, error } = await supabase
      .from('user_music')
      .upsert(payload, { onConflict: 'user_id' })
      .select()
      .single();

    if (error) {
      return { success: false, data: null, error: error.message };
    }

    return { success: true, data: data as UserMusic, error: null };
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : 'Failed to save music preference';
    return { success: false, data: null, error: msg };
  }
}

export async function clearUserMusicPreference(
  userId: string
): Promise<{ success: boolean; error: string | null }> {
  return saveUserMusicPreference(userId, null);
}
