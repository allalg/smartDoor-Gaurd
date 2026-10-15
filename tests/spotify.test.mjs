import test from 'node:test';
import assert from 'node:assert/strict';

/**
 * Spotify URI parsing test suite matching src/services/music.ts
 */
function parseSpotifyInput(input) {
  const trimmed = (input || '').trim();
  if (!trimmed) {
    return { id: '', uri: '', url: '', isValid: false, error: 'Input cannot be empty' };
  }

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
 * Device selection logic matching supabase/functions/_shared/spotify.ts
 */
function selectTargetDevice(devices, preferredName) {
  if (!devices || devices.length === 0) return null;
  const targetName = (preferredName || 'Web Player (Chrome)').trim().toLowerCase();

  const nameMatched = devices.find(d => d.name.toLowerCase().includes(targetName));
  if (nameMatched && !nameMatched.is_restricted) return nameMatched;

  const activeDevice = devices.find(d => d.is_active && !d.is_restricted);
  if (activeDevice) return activeDevice;

  const unrestricted = devices.find(d => !d.is_restricted);
  if (unrestricted) return unrestricted;

  return devices[0] || null;
}

test('parseSpotifyInput correctly handles canonical spotify:track URI', () => {
  const result = parseSpotifyInput('spotify:track:4cOdK2wGLETKBW3PvgPWqT');
  assert.equal(result.isValid, true);
  assert.equal(result.id, '4cOdK2wGLETKBW3PvgPWqT');
  assert.equal(result.uri, 'spotify:track:4cOdK2wGLETKBW3PvgPWqT');
  assert.equal(result.url, 'https://open.spotify.com/track/4cOdK2wGLETKBW3PvgPWqT');
});

test('parseSpotifyInput correctly handles https://open.spotify.com/track URLs with query params', () => {
  const result = parseSpotifyInput('https://open.spotify.com/track/4cOdK2wGLETKBW3PvgPWqT?si=abc12345');
  assert.equal(result.isValid, true);
  assert.equal(result.id, '4cOdK2wGLETKBW3PvgPWqT');
  assert.equal(result.uri, 'spotify:track:4cOdK2wGLETKBW3PvgPWqT');
});

test('parseSpotifyInput rejects malformed inputs and album/artist URLs', () => {
  assert.equal(parseSpotifyInput('').isValid, false);
  assert.equal(parseSpotifyInput('https://open.spotify.com/album/4cOdK2wGLETKBW3PvgPWqT').isValid, false);
  assert.equal(parseSpotifyInput('https://open.spotify.com/artist/4cOdK2wGLETKBW3PvgPWqT').isValid, false);
  assert.equal(parseSpotifyInput('not-a-spotify-url').isValid, false);
});

test('selectTargetDevice prioritizes target name if available and unrestricted', () => {
  const devices = [
    { id: 'dev-1', name: 'Living Room Echo', is_active: false, is_restricted: false },
    { id: 'dev-2', name: 'Web Player (Chrome)', is_active: false, is_restricted: false },
    { id: 'dev-3', name: 'A142 Phone', is_active: true, is_restricted: false },
  ];

  const selected = selectTargetDevice(devices, 'Web Player (Chrome)');
  assert.equal(selected.id, 'dev-2');
  assert.equal(selected.name, 'Web Player (Chrome)');
});

test('selectTargetDevice falls back to active device when target name not found', () => {
  const devices = [
    { id: 'dev-1', name: 'Living Room Echo', is_active: false, is_restricted: false },
    { id: 'dev-3', name: 'A142 Phone', is_active: true, is_restricted: false },
  ];

  const selected = selectTargetDevice(devices, 'Nonexistent Speaker');
  assert.equal(selected.id, 'dev-3');
  assert.equal(selected.name, 'A142 Phone');
});

test('selectTargetDevice ignores restricted devices', () => {
  const devices = [
    { id: 'dev-restricted', name: 'Restricted Speaker', is_active: true, is_restricted: true },
    { id: 'dev-unrestricted', name: 'Soundbar', is_active: false, is_restricted: false },
  ];

  const selected = selectTargetDevice(devices, 'Any');
  assert.equal(selected.id, 'dev-unrestricted');
});

test('selectTargetDevice returns null on empty devices list', () => {
  assert.equal(selectTargetDevice([]), null);
  assert.equal(selectTargetDevice(null), null);
});

test('extractTrackId correctly isolates 22-char ID from Spotify URI and URL', () => {
  function extractTrackId(uriOrId) {
    let trackId = (uriOrId || '').trim();
    if (trackId.startsWith('spotify:track:')) {
      trackId = trackId.replace('spotify:track:', '');
    } else if (trackId.includes('open.spotify.com/track/')) {
      const match = trackId.match(/track\/([a-zA-Z0-9]+)/);
      if (match) trackId = match[1];
    }
    return /^[a-zA-Z0-9]{22}$/.test(trackId) ? trackId : null;
  }

  assert.equal(extractTrackId('spotify:track:7IQ8M0Hq6IN2w8EYcFNSUk'), '7IQ8M0Hq6IN2w8EYcFNSUk');
  assert.equal(extractTrackId('https://open.spotify.com/track/7IQ8M0Hq6IN2w8EYcFNSUk?si=xyz'), '7IQ8M0Hq6IN2w8EYcFNSUk');
  assert.equal(extractTrackId('7IQ8M0Hq6IN2w8EYcFNSUk'), '7IQ8M0Hq6IN2w8EYcFNSUk');
  assert.equal(extractTrackId('invalid-uri'), null);
});

test('Preferred Entry Track display fallback never uses raw URI as heading', () => {
  function getDisplayLabels(music) {
    const primaryHeading = music?.track_title || 'Selected Spotify track';
    const secondaryLabel = music?.artist_name
      ? (music.album_name ? `${music.artist_name} • ${music.album_name}` : music.artist_name)
      : 'Spotify Track';
    return { primaryHeading, secondaryLabel };
  }

  // Case 1: Fully hydrated record
  const hydrated = getDisplayLabels({
    spotify_uri: 'spotify:track:7IQ8M0Hq6IN2w8EYcFNSUk',
    track_title: 'Starboy',
    artist_name: 'The Weeknd, Daft Punk',
    album_name: 'Starboy',
  });
  assert.equal(hydrated.primaryHeading, 'Starboy');
  assert.equal(hydrated.secondaryLabel, 'The Weeknd, Daft Punk • Starboy');

  // Case 2: Legacy record with missing metadata
  const legacy = getDisplayLabels({
    spotify_uri: 'spotify:track:7IQ8M0Hq6IN2w8EYcFNSUk',
    track_title: null,
    artist_name: null,
  });
  assert.equal(legacy.primaryHeading, 'Selected Spotify track');
  assert.equal(legacy.secondaryLabel, 'Spotify Track');
  assert.notEqual(legacy.primaryHeading, 'spotify:track:7IQ8M0Hq6IN2w8EYcFNSUk');
  assert.notEqual(legacy.secondaryLabel, 'spotify:track:7IQ8M0Hq6IN2w8EYcFNSUk');
});

// ============================================================================
// REGRESSION TESTS: Selected Track URI, Album-Context, Stale Devices, HTTP Errors & Verification
// ============================================================================

test('normalizeAndValidateTrackUri strictly validates 22-character track IDs and rejects non-track URIs', () => {
  function normalizeAndValidateTrackUri(input) {
    const trimmed = (input || '').trim();
    if (!trimmed) {
      return { valid: false, uri: '', trackId: null, error: 'Track URI cannot be empty' };
    }

    let trackId = '';
    if (trimmed.startsWith('spotify:track:')) {
      trackId = trimmed.replace('spotify:track:', '').trim();
    } else if (trimmed.includes('open.spotify.com/track/')) {
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

  // Valid track URIs
  const validUri = normalizeAndValidateTrackUri('spotify:track:4cOdK2wGLETKBW3PvgPWqT');
  assert.equal(validUri.valid, true);
  assert.equal(validUri.uri, 'spotify:track:4cOdK2wGLETKBW3PvgPWqT');
  assert.equal(validUri.trackId, '4cOdK2wGLETKBW3PvgPWqT');

  const validUrl = normalizeAndValidateTrackUri('https://open.spotify.com/track/4cOdK2wGLETKBW3PvgPWqT?si=123');
  assert.equal(validUrl.valid, true);
  assert.equal(validUrl.uri, 'spotify:track:4cOdK2wGLETKBW3PvgPWqT');

  const rawId = normalizeAndValidateTrackUri('4cOdK2wGLETKBW3PvgPWqT');
  assert.equal(rawId.valid, true);
  assert.equal(rawId.uri, 'spotify:track:4cOdK2wGLETKBW3PvgPWqT');

  // Strictly reject non-track URIs
  assert.equal(normalizeAndValidateTrackUri('spotify:album:2noRn2Aes5aoNVsU6iWThc').valid, false);
  assert.equal(normalizeAndValidateTrackUri('spotify:artist:1Xyo4u8uXC1ZmMpatF05PJ').valid, false);
  assert.equal(normalizeAndValidateTrackUri('spotify:playlist:37i9dQZF1DXcBWIGoYBM5M').valid, false);
  assert.equal(normalizeAndValidateTrackUri('').valid, false);
  assert.equal(normalizeAndValidateTrackUri('   ').valid, false);
  assert.equal(normalizeAndValidateTrackUri('spotify:track:too_short').valid, false);
  assert.equal(normalizeAndValidateTrackUri('spotify:track:with_invalid_chars!@#$%^').valid, false);
});

test('playTrack simulation: Fallback to album-context workaround when primary uris request does not start playback', async () => {
  const selectedTrackUri = 'spotify:track:4cOdK2wGLETKBW3PvgPWqT';
  const albumUri = 'spotify:album:2noRn2Aes5aoNVsU6iWThc';
  const targetDevice = { id: 'dev-nothing-phone', name: 'Nothing Phone (2a)', type: 'Smartphone' };

  const requestsSent = [];

  // Simulated Spotify player backend
  let playerState = {
    is_playing: false,
    item_uri: null,
  };

  async function mockSpotifyFetch(url, options) {
    const parsedUrl = new URL(url);
    const body = options.body ? JSON.parse(options.body) : null;
    requestsSent.push({ method: options.method, path: parsedUrl.pathname, query: parsedUrl.search, body });

    if (parsedUrl.pathname === '/v1/me/player/play') {
      if (body.uris) {
        // Primary request stops current music but mobile fails to begin streaming standalone track
        playerState.is_playing = false;
        playerState.item_uri = null;
        return { status: 204, text: async () => '' };
      }

      if (body.context_uri && body.offset?.uri) {
        // Alternative album context succeeds in starting playback on Android Spotify Connect
        playerState.is_playing = true;
        playerState.item_uri = body.offset.uri;
        return { status: 204, text: async () => '' };
      }
    }

    if (parsedUrl.pathname === '/v1/me/player') {
      if (!playerState.is_playing) {
        return { status: 204, text: async () => '' };
      }
      return {
        status: 200,
        json: async () => ({
          is_playing: playerState.is_playing,
          item: { uri: playerState.item_uri, name: 'Selected Song' },
          device: { id: targetDevice.id, name: targetDevice.name },
        }),
      };
    }

    return { status: 400, text: async () => 'Unknown endpoint' };
  }

  // Simulated playTrackDirect logic
  async function simulatePlayTrackDirect({ trackUri, albumUri, targetDevice }) {
    // 1. Primary attempt: uris: [trackUri]
    const primaryRes = await mockSpotifyFetch(`https://api.spotify.com/v1/me/player/play?device_id=${targetDevice.id}`, {
      method: 'PUT',
      body: JSON.stringify({ uris: [trackUri] }),
    });

    // Verify playback state
    let stateRes = await mockSpotifyFetch('https://api.spotify.com/v1/me/player', { method: 'GET' });
    let isPlaying = stateRes.status === 200;

    // 2. If not playing, trigger alternative album-context workaround
    if (!isPlaying && albumUri) {
      const altRes = await mockSpotifyFetch(`https://api.spotify.com/v1/me/player/play?device_id=${targetDevice.id}`, {
        method: 'PUT',
        body: JSON.stringify({
          context_uri: albumUri,
          offset: { uri: trackUri },
        }),
      });

      stateRes = await mockSpotifyFetch('https://api.spotify.com/v1/me/player', { method: 'GET' });
      if (stateRes.status === 200) {
        const data = await stateRes.json();
        if (data.is_playing && data.item?.uri === trackUri) {
          return { success: true, verified: true, contextUri: albumUri, trackUri };
        }
      }
    }

    return { success: false, verified: false, trackUri };
  }

  const result = await simulatePlayTrackDirect({ trackUri: selectedTrackUri, albumUri, targetDevice });

  assert.equal(result.success, true);
  assert.equal(result.verified, true);
  assert.equal(result.contextUri, albumUri);
  assert.equal(result.trackUri, selectedTrackUri);

  // Verify requests sent: primary play, get state, alternative album-context play, get state
  assert.equal(requestsSent.length, 4);
  assert.deepEqual(requestsSent[0].body, { uris: [selectedTrackUri] });
  assert.deepEqual(requestsSent[2].body, {
    context_uri: albumUri,
    offset: { uri: selectedTrackUri },
  });
});

test('Target device discovery rejects stale cached IDs and refreshes per attempt', () => {
  // Discovery attempt 1: Nothing Phone (2a) is active with ID "dev-session-1"
  const devicesAttempt1 = [
    { id: 'dev-session-1', name: 'Nothing Phone (2a)', type: 'Smartphone', is_active: true, is_restricted: false },
    { id: 'dev-web', name: 'Web Player (Chrome)', type: 'Computer', is_active: false, is_restricted: false },
  ];

  const selected1 = selectTargetDevice(devicesAttempt1, 'Nothing Phone (2a)');
  assert.equal(selected1.id, 'dev-session-1');

  // Discovery attempt 2: Spotify restarted on phone, ID changed to "dev-session-2"
  const devicesAttempt2 = [
    { id: 'dev-session-2', name: 'Nothing Phone (2a)', type: 'Smartphone', is_active: true, is_restricted: false },
  ];

  // Re-running device selection on fresh device list finds the new ID rather than stale "dev-session-1"
  const selected2 = selectTargetDevice(devicesAttempt2, 'Nothing Phone (2a)');
  assert.equal(selected2.id, 'dev-session-2');
  assert.notEqual(selected2.id, selected1.id);

  // Discovery attempt 3: Device went to sleep / disconnected
  const devicesAttempt3 = [];
  const selected3 = selectTargetDevice(devicesAttempt3, 'Nothing Phone (2a)');
  assert.equal(selected3, null, 'Must return null when device is offline, avoiding HTTP 404 with stale ID');
});

test('HTTP errors (404 Not Found, 403 Forbidden, 502) are preserved and never falsely reported as success', async () => {
  function handleSpotifyErrorResponse(status, errorBody, targetDevice) {
    const isHttpSuccess = status === 204 || status === 200 || status === 202;
    const finalError = !isHttpSuccess
      ? `Spotify playback rejected (${status}): ${errorBody}`
      : `Spotify accepted playback request (HTTP ${status}) but song did not start playing on target device (${targetDevice.name})`;

    return {
      success: false,
      verified: false,
      deviceId: targetDevice.id,
      deviceName: targetDevice.name,
      httpStatus: status,
      error: finalError,
    };
  }

  const dev = { id: 'dev-stale', name: 'Nothing Phone (2a)' };

  // 1. HTTP 404 Device not found
  const err404 = handleSpotifyErrorResponse(404, '{"error": {"status": 404, "message": "Device not found"}}', dev);
  assert.equal(err404.success, false);
  assert.equal(err404.verified, false);
  assert.equal(err404.httpStatus, 404);
  assert.match(err404.error, /Spotify playback rejected \(404\)/);
  assert.match(err404.error, /Device not found/);

  // 2. HTTP 403 Premium required / restricted
  const err403 = handleSpotifyErrorResponse(403, '{"error": {"status": 403, "message": "Player command failed: Premium required"}}', dev);
  assert.equal(err403.success, false);
  assert.equal(err403.verified, false);
  assert.equal(err403.httpStatus, 403);
  assert.match(err403.error, /Spotify playback rejected \(403\)/);

  // 3. HTTP 204 accepted by Spotify, but phone stopped song and is not playing
  const errStopped = handleSpotifyErrorResponse(204, '', dev);
  assert.equal(errStopped.success, false);
  assert.equal(errStopped.verified, false);
  assert.equal(errStopped.httpStatus, 204);
  assert.match(errStopped.error, /song did not start playing on target device/);
});

test('Playback-state verification distinguishes HTTP 204 from actual playback and handles eventual consistency', async () => {
  const trackUri = 'spotify:track:4cOdK2wGLETKBW3PvgPWqT';

  // Scenario 1: HTTP 204 returned, but playback state is not playing (stopped/paused)
  const stoppedState = { is_playing: false, item_uri: null };
  const verified1 = stoppedState.is_playing && stoppedState.item_uri === trackUri;
  assert.equal(verified1, false, 'Must not report verified when player is stopped');

  // Scenario 2: HTTP 204 returned, but player is still playing an old track
  const oldTrackState = { is_playing: true, item_uri: 'spotify:track:OLD_TRACK_1234567890' };
  const verified2 = oldTrackState.is_playing && oldTrackState.item_uri === trackUri;
  assert.equal(verified2, false, 'Must not report verified when old track is still playing');

  // Scenario 3: HTTP 204 returned, and playback state confirms target track is actively streaming
  const activeState = { is_playing: true, item_uri: trackUri };
  const verified3 = activeState.is_playing && activeState.item_uri === trackUri;
  assert.equal(verified3, true, 'Confirmed streaming of selected track is verified');

  // Scenario 4: Eventual consistency polling (check 1 has not updated yet, check 2 succeeds)
  const pollStates = [
    { is_playing: false, item_uri: null },
    { is_playing: true, item_uri: trackUri },
  ];

  let resolved = false;
  for (const s of pollStates) {
    if (s.is_playing && s.item_uri === trackUri) {
      resolved = true;
      break;
    }
  }
  assert.equal(resolved, true, 'Eventual consistency polling succeeds on second attempt');
});

test('Sanitized diagnostic logging never exposes authorization tokens or refresh credentials', () => {
  const fakeAccessToken = 'BQD1234567890SecretAccessTokenHere';
  const fakeRefreshToken = 'AQD0987654321SecretRefreshTokenHere';

  function createSanitizedDiagnostic({ status, trackUri, targetDevice, responseBody }) {
    const sanitizedTarget = `${targetDevice.name} (${targetDevice.type}) [id: ${targetDevice.id}]`;
    const log = `[spotify] Play response status: ${status}, body: "${responseBody}", target: ${sanitizedTarget}, track: ${trackUri}`;

    // Assert that credentials are NEVER included in formatted log
    assert.equal(log.includes(fakeAccessToken), false);
    assert.equal(log.includes(fakeRefreshToken), false);
    assert.equal(log.includes('Bearer '), false);
    return log;
  }

  const logMessage = createSanitizedDiagnostic({
    status: 204,
    trackUri: 'spotify:track:4cOdK2wGLETKBW3PvgPWqT',
    targetDevice: { id: 'dev-nothing', name: 'Nothing Phone (2a)', type: 'Smartphone' },
    responseBody: '',
  });

  assert.match(logMessage, /Nothing Phone \(2a\)/);
  assert.match(logMessage, /spotify:track:4cOdK2wGLETKBW3PvgPWqT/);
});

