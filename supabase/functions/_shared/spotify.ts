import { createClient, SupabaseClient } from "npm:@supabase/supabase-js@2.48.1";

export interface SpotifyDevice {
  id: string;
  is_active: boolean;
  is_restricted: boolean;
  name: string;
  type: string;
  volume_percent: number | null;
}

export interface SpotifyTrack {
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

export interface PlaybackResult {
  success: boolean;
  deviceId?: string;
  deviceName?: string;
  error?: string;
}

// In-memory token cache across warm serverless invocations (refreshed when within 60s of expiration)
let inMemoryCachedToken: { token: string; expiresAt: number } | null = null;

/**
 * Retrieves an active access token using the shared Spotify account's refresh token.
 * Leverages in-memory caching during warm serverless invocations to avoid redundant RTTs.
 * Automatically saves rotated refresh tokens to `spotify_shared_account`.
 */
export async function getSharedSpotifyAccessToken(
  adminClient: SupabaseClient
): Promise<{ accessToken: string } | { error: string }> {
  // Return warm cached token if valid for at least 60 more seconds
  if (inMemoryCachedToken && Date.now() < inMemoryCachedToken.expiresAt - 60_000) {
    return { accessToken: inMemoryCachedToken.token };
  }

  const clientId = Deno.env.get("SPOTIFY_CLIENT_ID");
  const clientSecret = Deno.env.get("SPOTIFY_CLIENT_SECRET");

  if (!clientId || !clientSecret) {
    return { error: "Missing SPOTIFY_CLIENT_ID or SPOTIFY_CLIENT_SECRET environment variables" };
  }

  // 1. Fetch current shared refresh token (supports both numeric id 1 and text id)
  const { data: account, error: accountErr } = await adminClient
    .from("spotify_shared_account")
    .select("id, refresh_token")
    .order("updated_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (accountErr || !account || !account.refresh_token) {
    return { error: `Failed to retrieve Spotify refresh token: ${accountErr?.message || "No shared account record found"}` };
  }

  // 2. Exchange refresh token for fresh access token with bounded 2s timeout
  const basicAuth = btoa(`${clientId}:${clientSecret}`);
  const tokenParams = new URLSearchParams({
    grant_type: "refresh_token",
    refresh_token: account.refresh_token,
  });

  try {
    const tokenRes = await fetch("https://accounts.spotify.com/api/token", {
      method: "POST",
      headers: {
        "Authorization": `Basic ${basicAuth}`,
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: tokenParams.toString(),
      signal: AbortSignal.timeout(2000),
    });

    if (!tokenRes.ok) {
      const errorBody = await tokenRes.text().catch(() => "");
      return { error: `Spotify token refresh failed with status ${tokenRes.status}: ${errorBody}` };
    }

    const tokenData = await tokenRes.json();
    const accessToken = tokenData.access_token;

    if (!accessToken) {
      return { error: "Spotify response did not include access_token" };
    }

    const expiresInSec = typeof tokenData.expires_in === "number" ? tokenData.expires_in : 3600;
    inMemoryCachedToken = {
      token: accessToken,
      expiresAt: Date.now() + expiresInSec * 1000,
    };

    // 3. If Spotify rotated the refresh token, persist it immediately
    if (tokenData.refresh_token && tokenData.refresh_token !== account.refresh_token) {
      const { error: updateErr } = await adminClient
        .from("spotify_shared_account")
        .update({
          refresh_token: tokenData.refresh_token,
          updated_at: new Date().toISOString(),
        })
        .eq("id", account.id);

      if (updateErr) {
        console.warn("[spotify] Warning: failed to persist rotated refresh token:", updateErr.message);
      }
    }

    return { accessToken };
  } catch (err: unknown) {
    return { error: err instanceof Error ? err.message : "Token refresh timed out" };
  }
}

/**
 * Discovers available Spotify Connect devices on the shared Spotify account.
 */
export async function getSpotifyDevices(
  accessToken: string
): Promise<{ devices: SpotifyDevice[] } | { error: string }> {
  try {
    const res = await fetch("https://api.spotify.com/v1/me/player/devices", {
      headers: {
        "Authorization": `Bearer ${accessToken}`,
      },
      signal: AbortSignal.timeout(2000),
    });

    if (!res.ok) {
      const errText = await res.text().catch(() => "");
      return { error: `Failed to fetch Spotify devices (${res.status}): ${errText}` };
    }

    const data = await res.json();
    return { devices: (data.devices || []) as SpotifyDevice[] };
  } catch (err) {
    return { error: err instanceof Error ? err.message : String(err) };
  }
}

/**
 * Intelligently targets a playback device:
 * 1. Matches configured preferred name (or SPOTIFY_DEVICE_NAME env var, or 'Web Player (Chrome)')
 * 2. Currently active device
 * 3. First non-restricted device
 * 4. First available device
 */
export function selectTargetDevice(
  devices: SpotifyDevice[],
  preferredName?: string
): SpotifyDevice | null {
  if (!devices || devices.length === 0) return null;

  const targetName = (preferredName || Deno.env.get("SPOTIFY_DEVICE_NAME") || "Web Player (Chrome)").trim().toLowerCase();

  // 1. Exact or partial name match
  const nameMatched = devices.find(d => d.name.toLowerCase().includes(targetName));
  if (nameMatched && !nameMatched.is_restricted) return nameMatched;

  // 2. Currently active device
  const activeDevice = devices.find(d => d.is_active && !d.is_restricted);
  if (activeDevice) return activeDevice;

  // 3. First unrestricted device
  const unrestricted = devices.find(d => !d.is_restricted);
  if (unrestricted) return unrestricted;

  // 4. Any device fallback
  return devices[0] || null;
}

/**
 * Starts track playback directly via the Spotify Web API.
 */
export async function playTrackDirect(
  adminClient: SupabaseClient,
  trackUri: string,
  options?: { preferredDeviceName?: string; timeoutMs?: number }
): Promise<PlaybackResult> {
  const timeoutMs = options?.timeoutMs ?? 2500;

  // Validate track URI
  if (!trackUri || !trackUri.startsWith("spotify:track:")) {
    return { success: false, error: "Invalid track URI. Expected format 'spotify:track:<id>'" };
  }

  // 1. Refresh access token
  const tokenResult = await getSharedSpotifyAccessToken(adminClient);
  if ("error" in tokenResult) {
    return { success: false, error: tokenResult.error };
  }
  const { accessToken } = tokenResult;

  // 2. Discover available devices
  const devicesResult = await getSpotifyDevices(accessToken);
  if ("error" in devicesResult) {
    return { success: false, error: devicesResult.error };
  }

  const { devices } = devicesResult;
  if (!devices || devices.length === 0) {
    return { success: false, error: "No Spotify Connect devices found on shared account" };
  }

  const targetDevice = selectTargetDevice(devices, options?.preferredDeviceName);
  if (!targetDevice) {
    return { success: false, error: "No usable or unrestricted Spotify Connect device found" };
  }

  // 3. Send playback request to Spotify Web API
  try {
    const playUrl = `https://api.spotify.com/v1/me/player/play?device_id=${encodeURIComponent(targetDevice.id)}`;
    const playRes = await fetch(playUrl, {
      method: "PUT",
      headers: {
        "Authorization": `Bearer ${accessToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        uris: [trackUri],
      }),
      signal: AbortSignal.timeout(timeoutMs),
    });

    // 204 No Content is standard Spotify success response for /player/play; 200/202 also treated as success
    if (playRes.status === 204 || playRes.status === 200 || playRes.status === 202) {
      return {
        success: true,
        deviceId: targetDevice.id,
        deviceName: targetDevice.name,
      };
    }

    const errorBody = await playRes.text().catch(() => "");
    return {
      success: false,
      deviceId: targetDevice.id,
      deviceName: targetDevice.name,
      error: `Spotify playback rejected (${playRes.status}): ${errorBody}`,
    };
  } catch (err: unknown) {
    return {
      success: false,
      deviceId: targetDevice.id,
      deviceName: targetDevice.name,
      error: err instanceof Error ? err.message : "Playback request failed or timed out",
    };
  }
}

/**
 * Searches the Spotify track catalog.
 */
export async function searchSpotifyTracks(
  adminClient: SupabaseClient,
  query: string,
  limit: number = 10
): Promise<{ tracks: SpotifyTrack[] } | { error: string }> {
  const trimmed = query.trim();
  if (!trimmed) {
    return { tracks: [] };
  }

  const tokenResult = await getSharedSpotifyAccessToken(adminClient);
  if ("error" in tokenResult) {
    return { error: tokenResult.error };
  }
  const { accessToken } = tokenResult;

  try {
    const searchUrl = `https://api.spotify.com/v1/search?q=${encodeURIComponent(trimmed)}&type=track&limit=${Math.min(limit, 20)}`;
    const res = await fetch(searchUrl, {
      headers: {
        "Authorization": `Bearer ${accessToken}`,
      },
      signal: AbortSignal.timeout(3000),
    });

    if (!res.ok) {
      const errText = await res.text().catch(() => "");
      return { error: `Spotify search failed (${res.status}): ${errText}` };
    }

    const data = await res.json();
    const rawTracks = data?.tracks?.items || [];

    const tracks: SpotifyTrack[] = rawTracks.map((t: any) => ({
      id: t.id,
      uri: t.uri,
      title: t.name,
      artist_name: (t.artists || []).map((a: any) => a.name).join(", "),
      album_name: t.album?.name || "",
      artwork_url: t.album?.images?.[0]?.url || t.album?.images?.[1]?.url || null,
      duration_ms: t.duration_ms,
      preview_url: t.preview_url,
      external_url: t.external_urls?.spotify,
    }));

    return { tracks };
  } catch (err: unknown) {
    return { error: err instanceof Error ? err.message : "Failed to execute search" };
  }
}

/**
 * Retrieves track metadata for a single Spotify track by URI or ID.
 */
export async function getSpotifyTrackDetails(
  adminClient: SupabaseClient,
  trackUriOrId: string
): Promise<{ track: SpotifyTrack } | { error: string }> {
  const trimmed = trackUriOrId.trim();
  if (!trimmed) {
    return { error: "Missing track identifier" };
  }

  // Extract track ID from URI (spotify:track:...) or URL (https://open.spotify.com/track/...) or raw ID
  let trackId = trimmed;
  if (trackId.startsWith("spotify:track:")) {
    trackId = trackId.replace("spotify:track:", "");
  } else if (trackId.includes("open.spotify.com/track/")) {
    const match = trackId.match(/track\/([a-zA-Z0-9]+)/);
    if (match) trackId = match[1];
  }

  // Validate Spotify track ID format (22 characters)
  if (!/^[a-zA-Z0-9]{22}$/.test(trackId)) {
    return { error: `Invalid Spotify track ID format: '${trackId}'` };
  }

  const tokenResult = await getSharedSpotifyAccessToken(adminClient);
  if ("error" in tokenResult) {
    return { error: tokenResult.error };
  }
  const { accessToken } = tokenResult;

  try {
    const trackUrl = `https://api.spotify.com/v1/tracks/${encodeURIComponent(trackId)}`;
    const res = await fetch(trackUrl, {
      headers: {
        "Authorization": `Bearer ${accessToken}`,
      },
      signal: AbortSignal.timeout(3000),
    });

    if (!res.ok) {
      const errText = await res.text().catch(() => "");
      return { error: `Spotify track lookup failed (${res.status}): ${errText}` };
    }

    const t = await res.json();
    const track: SpotifyTrack = {
      id: t.id,
      uri: t.uri,
      title: t.name,
      artist_name: (t.artists || []).map((a: any) => a.name).join(", "),
      album_name: t.album?.name || "",
      artwork_url: t.album?.images?.[0]?.url || t.album?.images?.[1]?.url || null,
      duration_ms: t.duration_ms,
      preview_url: t.preview_url,
      external_url: t.external_urls?.spotify,
    };

    return { track };
  } catch (err: unknown) {
    return { error: err instanceof Error ? err.message : "Failed to fetch track details" };
  }
}

