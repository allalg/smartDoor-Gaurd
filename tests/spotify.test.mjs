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
