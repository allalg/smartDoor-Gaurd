import { supabase, isSupabaseConfigured } from '@/lib/supabase';
import type { UserMusic } from '@/types/database';

export interface SpotifyTrackInfo {
  id: string;
  uri: string;
  url: string;
  isValid: boolean;
  error?: string;
}

export interface SpotifySearchResultTrack {
  id: string;
  uri: string;
  title: string;
  artist_name: string;
  album_name: string;
  artwork_url: string | null;
  duration_ms?: number;
  preview_url?: string | null;
  external_url?: string | null;
}

export interface TrackMetadata {
  track_title?: string | null;
  artist_name?: string | null;
  album_name?: string | null;
  artwork_url?: string | null;
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

/**
 * Searches Spotify's catalog via the backend Edge Function `spotify-search`.
 * Never exposes Spotify Client Secret or refresh token in the browser.
 */
export async function searchSpotifyTracks(
  query: string
): Promise<{ tracks: SpotifySearchResultTrack[]; error: string | null }> {
  if (!query || query.trim().length === 0) {
    return { tracks: [], error: null };
  }

  if (!isSupabaseConfigured) {
    return { tracks: [], error: 'Supabase credentials are not configured.' };
  }

  try {
    const { data, error } = await supabase.functions.invoke('spotify-search', {
      body: { q: query.trim() },
    });

    if (error) {
      return { tracks: [], error: error.message || 'Spotify search request failed' };
    }

    if (data?.error) {
      return { tracks: [], error: data.error };
    }

    return { tracks: data?.tracks || [], error: null };
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : 'Unable to connect to Spotify search';
    return { tracks: [], error: msg };
  }
}

/**
 * Fetches detailed metadata for a single Spotify track by URI or ID from backend Edge Function.
 */
export async function fetchSpotifyTrackDetails(
  uriOrId: string
): Promise<{ track: SpotifySearchResultTrack | null; error: string | null }> {
  const trimmed = uriOrId.trim();
  if (!trimmed) {
    return { track: null, error: 'Track identifier cannot be empty' };
  }

  if (!isSupabaseConfigured) {
    return { track: null, error: 'Supabase credentials are not configured.' };
  }

  try {
    const { data, error } = await supabase.functions.invoke('spotify-search', {
      body: { uri: trimmed },
    });

    if (error) {
      return { track: null, error: error.message || 'Spotify track lookup failed' };
    }

    if (data?.error) {
      return { track: null, error: data.error };
    }

    if (data?.track) {
      return { track: data.track, error: null };
    }

    return { track: null, error: 'Track not found' };
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : 'Unable to fetch track details';
    return { track: null, error: msg };
  }
}

/**
 * Saves a user's preferred entry song together with display metadata.
 * Automatically fetches metadata if omitted and a track URI is provided.
 */
export async function saveUserMusicPreference(
  userId: string,
  spotifyUri: string | null,
  metadata?: TrackMetadata
): Promise<{ success: boolean; data: UserMusic | null; error: string | null }> {
  if (!isSupabaseConfigured) {
    return { success: false, data: null, error: 'Supabase credentials are not configured.' };
  }

  try {
    let resolvedMetadata = metadata;

    // Automatically hydrate metadata from Spotify API if not supplied
    if (spotifyUri && (!resolvedMetadata || !resolvedMetadata.track_title)) {
      try {
        const { track } = await fetchSpotifyTrackDetails(spotifyUri);
        if (track) {
          resolvedMetadata = {
            track_title: track.title,
            artist_name: track.artist_name,
            album_name: track.album_name,
            artwork_url: track.artwork_url,
          };
        }
      } catch {
        // Fall back gracefully to saving without metadata if Spotify is unreachable
      }
    }

    const payload = {
      user_id: userId,
      spotify_uri: spotifyUri,
      track_title: resolvedMetadata?.track_title ?? null,
      artist_name: resolvedMetadata?.artist_name ?? null,
      album_name: resolvedMetadata?.album_name ?? null,
      artwork_url: resolvedMetadata?.artwork_url ?? null,
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

/**
 * Clears the user's preferred entry song and metadata.
 */
export async function clearUserMusicPreference(
  userId: string
): Promise<{ success: boolean; error: string | null }> {
  return saveUserMusicPreference(userId, null, {
    track_title: null,
    artist_name: null,
    album_name: null,
    artwork_url: null,
  });
}
