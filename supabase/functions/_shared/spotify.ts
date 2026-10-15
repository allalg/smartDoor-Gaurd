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
  album_uri?: string;
  artwork_url: string | null;
  duration_ms?: number;
  preview_url?: string | null;
  external_url?: string | null;
}

export interface SpotifyPlaybackState {
  is_playing: boolean;
  item_uri?: string | null;
  item_name?: string | null;
  device_id?: string | null;
  device_name?: string | null;
  device_type?: string | null;
  context_uri?: string | null;
  raw_status: number;
}

export interface PlaybackResult {
  success: boolean;
  verified: boolean;
  deviceId?: string;
  deviceName?: string;
  deviceType?: string;
  trackUri?: string;
  contextUri?: string;
  httpStatus?: number;
  responseBody?: string;
  error?: string;
  playbackState?: SpotifyPlaybackState | null;
  diagnostic?: string;
}

export interface PlayTrackOptions {
  preferredDeviceName?: string;
  albumUri?: string;
  timeoutMs?: number;
  skipStateVerification?: boolean;
}

// In-memory token cache across warm serverless invocations (refreshed when within 60s of expiration)
let inMemoryCachedToken: { token: string; expiresAt: number } | null = null;

/**
 * Validates and normalizes user input into a canonical Spotify track URI and 22-char ID.
 */
export function normalizeAndValidateTrackUri(input: string): {
  valid: boolean;
  uri: string;
  trackId: string | null;
  error?: string;
} {
  const trimmed = (input || "").trim();
  if (!trimmed) {
    return { valid: false, uri: "", trackId: null, error: "Track URI cannot be empty" };
  }

  let trackId = "";
  if (trimmed.startsWith("spotify:track:")) {
    trackId = trimmed.replace("spotify:track:", "").trim();
  } else if (trimmed.includes("open.spotify.com/track/")) {
    const match = trimmed.match(/track\/([a-zA-Z0-9]{22})/);
    if (match) trackId = match[1];
  } else if (/^[a-zA-Z0-9]{22}$/.test(trimmed)) {
    trackId = trimmed;
  }

  if (!trackId || !/^[a-zA-Z0-9]{22}$/.test(trackId)) {
    return {
      valid: false,
      uri: trimmed,
      trackId: null,
      error: `Invalid Spotify track URI format: '${trimmed}'. Expected 'spotify:track:<22-character-id>'`,
    };
  }

  return {
    valid: true,
    uri: `spotify:track:${trackId}`,
    trackId,
  };
}

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
 * Always freshly requested to avoid relying on stale cached device IDs.
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
  const nameMatched = devices.find(d => d.name && d.name.toLowerCase().includes(targetName));
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
 * Queries Spotify's current playback state via GET /v1/me/player.
 * Returns is_playing status, current item URI, and device details.
 */
export async function getSpotifyPlaybackState(
  accessToken: string,
  timeoutMs: number = 2000
): Promise<{ state: SpotifyPlaybackState | null } | { error: string }> {
  try {
    const res = await fetch("https://api.spotify.com/v1/me/player", {
      headers: {
        "Authorization": `Bearer ${accessToken}`,
      },
      signal: AbortSignal.timeout(timeoutMs),
    });

    if (res.status === 204) {
      return {
        state: {
          is_playing: false,
          item_uri: null,
          item_name: null,
          device_id: null,
          device_name: null,
          device_type: null,
          context_uri: null,
          raw_status: 204,
        },
      };
    }

    if (!res.ok) {
      const errText = await res.text().catch(() => "");
      return { error: `Failed to fetch Spotify playback state (${res.status}): ${errText}` };
    }

    const data = await res.json();
    return {
      state: {
        is_playing: Boolean(data?.is_playing),
        item_uri: data?.item?.uri || null,
        item_name: data?.item?.name || null,
        device_id: data?.device?.id || null,
        device_name: data?.device?.name || null,
        device_type: data?.device?.type || null,
        context_uri: data?.context?.uri || null,
        raw_status: 200,
      },
    };
  } catch (err: unknown) {
    return { error: err instanceof Error ? err.message : String(err) };
  }
}

/**
 * Polls Spotify playback state with bounded retry window to verify playback started.
 */
async function verifyPlaybackPlaying(
  accessToken: string,
  expectedTrackUri: string,
  maxAttempts: number = 2,
  delayMs: number = 350
): Promise<{ verified: boolean; state: SpotifyPlaybackState | null; error?: string }> {
  let lastState: SpotifyPlaybackState | null = null;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    const stateRes = await getSpotifyPlaybackState(accessToken, 1500);
    if ("error" in stateRes) {
      return { verified: false, state: null, error: stateRes.error };
    }

    lastState = stateRes.state;
    if (lastState && lastState.is_playing && lastState.item_uri === expectedTrackUri) {
      return { verified: true, state: lastState };
    }

    if (attempt < maxAttempts) {
      await new Promise((r) => setTimeout(r, delayMs));
    }
  }

  return { verified: false, state: lastState };
}

/**
 * Starts track playback directly via the Spotify Web API.
 * 
 * Diagnostic and execution steps:
 * 1. Validates selected track URI format (^spotify:track:[a-zA-Z0-9]{22}$).
 * 2. Fetches fresh device list on each attempt (eliminating stale device IDs).
 * 3. Sends PUT /v1/me/player/play?device_id={device_id} with sanitized diagnostic logging.
 * 4. Queries current playback state to verify is_playing and item match.
 * 5. If playback does not start, tests album-context alternative { context_uri, offset: { uri } }.
 * 6. Preserves original Spotify errors and state without falsely reporting success.
 */
export async function playTrackDirect(
  adminClient: SupabaseClient,
  trackUri: string,
  options?: PlayTrackOptions
): Promise<PlaybackResult> {
  const timeoutMs = options?.timeoutMs ?? 3000;

  // 1. Validate & normalize track URI
  const validation = normalizeAndValidateTrackUri(trackUri);
  if (!validation.valid || !validation.uri) {
    console.warn(`[spotify] Invalid track URI provided: ${validation.error}`);
    return {
      success: false,
      verified: false,
      error: validation.error || "Invalid track URI",
    };
  }
  const cleanTrackUri = validation.uri;

  // 2. Refresh / retrieve access token
  const tokenResult = await getSharedSpotifyAccessToken(adminClient);
  if ("error" in tokenResult) {
    console.error(`[spotify] Token retrieval error: ${tokenResult.error}`);
    return { success: false, verified: false, error: tokenResult.error };
  }
  const { accessToken } = tokenResult;

  // 3. Fresh device discovery (never cached to prevent stale device IDs)
  const devicesResult = await getSpotifyDevices(accessToken);
  if ("error" in devicesResult) {
    console.warn(`[spotify] Device discovery failed: ${devicesResult.error}`);
    return { success: false, verified: false, error: devicesResult.error };
  }

  const { devices } = devicesResult;
  if (!devices || devices.length === 0) {
    console.warn("[spotify] No Spotify Connect devices found on shared account");
    return { success: false, verified: false, error: "No Spotify Connect devices found on shared account" };
  }

  const targetDevice = selectTargetDevice(devices, options?.preferredDeviceName);
  if (!targetDevice) {
    console.warn("[spotify] No usable or unrestricted Spotify Connect device found in device list");
    return { success: false, verified: false, error: "No usable or unrestricted Spotify Connect device found" };
  }

  // 4. Primary Playback Request: PUT /v1/me/player/play?device_id={device_id} with { uris: [trackUri] }
  const playUrl = `https://api.spotify.com/v1/me/player/play?device_id=${encodeURIComponent(targetDevice.id)}`;
  const sanitizedTarget = `${targetDevice.name} (${targetDevice.type || "Unknown"}) [id: ${targetDevice.id}]`;

  console.log(`[spotify] Sending PUT /v1/me/player/play to target device: ${sanitizedTarget}, track: ${cleanTrackUri}`);

  let playRes: Response | null = null;
  let playStatus = 0;
  let responseBody = "";

  try {
    playRes = await fetch(playUrl, {
      method: "PUT",
      headers: {
        "Authorization": `Bearer ${accessToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        uris: [cleanTrackUri],
      }),
      signal: AbortSignal.timeout(Math.min(timeoutMs, 2000)),
    });
    playStatus = playRes.status;
    responseBody = await playRes.text().catch(() => "");
  } catch (err: unknown) {
    console.warn(`[spotify] Network error on primary play request: ${err instanceof Error ? err.message : err}`);
    playStatus = 0;
    responseBody = err instanceof Error ? err.message : String(err);
  }

  // Sanitized diagnostic logging (Never log tokens)
  console.log(`[spotify] Primary play response status: ${playStatus}, body: "${responseBody.slice(0, 256)}", target: ${sanitizedTarget}`);

  const isHttpSuccess = playStatus === 204 || playStatus === 200 || playStatus === 202;

  // 5. Verify playback state if HTTP succeeded
  if (isHttpSuccess && !options?.skipStateVerification) {
    const verifyRes = await verifyPlaybackPlaying(accessToken, cleanTrackUri, 2, 350);
    if (verifyRes.verified) {
      console.log(`[spotify] Playback successfully verified: "${cleanTrackUri}" is playing on ${targetDevice.name}`);
      return {
        success: true,
        verified: true,
        deviceId: targetDevice.id,
        deviceName: targetDevice.name,
        deviceType: targetDevice.type,
        trackUri: cleanTrackUri,
        httpStatus: playStatus,
        playbackState: verifyRes.state,
      };
    }

    console.warn(
      `[spotify] Primary request accepted (HTTP ${playStatus}) but verification failed on ${targetDevice.name}. ` +
      `is_playing: ${verifyRes.state?.is_playing ?? false}, current_item: ${verifyRes.state?.item_uri ?? "none"}. ` +
      `Attempting album-context fallback workaround.`
    );
  }

  // 6. Alternative request using album context if primary failed or didn't start playing
  let albumUri = options?.albumUri;
  if (!albumUri || !albumUri.startsWith("spotify:album:")) {
    try {
      const details = await getSpotifyTrackDetails(adminClient, cleanTrackUri);
      if ("track" in details && details.track.album_uri && details.track.album_uri.startsWith("spotify:album:")) {
        albumUri = details.track.album_uri;
      }
    } catch {
      // Non-fatal if track lookup fails
    }
  }

  if (albumUri && albumUri.startsWith("spotify:album:")) {
    console.log(`[spotify] Attempting alternative playback with album context: ${albumUri}, offset.uri: ${cleanTrackUri} on ${sanitizedTarget}`);
    try {
      const altRes = await fetch(playUrl, {
        method: "PUT",
        headers: {
          "Authorization": `Bearer ${accessToken}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          context_uri: albumUri,
          offset: {
            uri: cleanTrackUri,
          },
        }),
        signal: AbortSignal.timeout(Math.min(timeoutMs, 2000)),
      });

      const altStatus = altRes.status;
      const altBody = await altRes.text().catch(() => "");
      console.log(`[spotify] Alternative album-context response status: ${altStatus}, body: "${altBody.slice(0, 256)}", target: ${sanitizedTarget}`);

      if (altStatus === 204 || altStatus === 200 || altStatus === 202) {
        if (!options?.skipStateVerification) {
          const altVerify = await verifyPlaybackPlaying(accessToken, cleanTrackUri, 2, 350);
          if (altVerify.verified) {
            console.log(`[spotify] Alternative album-context playback verified: "${cleanTrackUri}" is playing on ${targetDevice.name}`);
            return {
              success: true,
              verified: true,
              deviceId: targetDevice.id,
              deviceName: targetDevice.name,
              deviceType: targetDevice.type,
              trackUri: cleanTrackUri,
              contextUri: albumUri,
              httpStatus: altStatus,
              playbackState: altVerify.state,
            };
          }
        } else {
          return {
            success: true,
            verified: false,
            deviceId: targetDevice.id,
            deviceName: targetDevice.name,
            deviceType: targetDevice.type,
            trackUri: cleanTrackUri,
            contextUri: albumUri,
            httpStatus: altStatus,
          };
        }
      }
    } catch (altErr: unknown) {
      console.warn(`[spotify] Alternative album-context attempt failed: ${altErr instanceof Error ? altErr.message : altErr}`);
    }
  }

  // 7. If playback still could not be verified, preserve exact diagnostic failure information (Never falsely report success)
  const finalError = !isHttpSuccess
    ? `Spotify playback rejected (${playStatus}): ${responseBody}`
    : `Spotify accepted playback request (HTTP ${playStatus}) but song did not start playing on target device (${targetDevice.name})`;

  console.warn(`[spotify] Playback verification unsuccessful: ${finalError}`);

  return {
    success: false,
    verified: false,
    deviceId: targetDevice.id,
    deviceName: targetDevice.name,
    deviceType: targetDevice.type,
    trackUri: cleanTrackUri,
    httpStatus: playStatus,
    responseBody: responseBody.slice(0, 512),
    error: finalError,
  };
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
      album_uri: t.album?.uri || "",
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
  const validation = normalizeAndValidateTrackUri(trackUriOrId);
  if (!validation.valid || !validation.trackId) {
    return { error: validation.error || "Missing track identifier" };
  }

  const trackId = validation.trackId;

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
      album_uri: t.album?.uri || "",
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
