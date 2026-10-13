import React, { useState, useEffect, useRef } from 'react';
import {
  Music,
  Search,
  CheckCircle2,
  AlertCircle,
  Loader2,
  Trash2,
  ExternalLink,
  Play,
  Pause,
  Sparkles,
  Link2,
} from 'lucide-react';
import { useAuth } from '@/context/AuthContext';
import {
  searchSpotifyTracks,
  saveUserMusicPreference,
  clearUserMusicPreference,
  parseSpotifyInput,
  SpotifySearchResultTrack,
} from '@/services/music';

interface SpotifySongPickerProps {
  onSuccess?: () => void;
}

export const SpotifySongPicker: React.FC<SpotifySongPickerProps> = ({ onSuccess }) => {
  const { user, music, refreshMusic } = useAuth();

  const [searchQuery, setSearchQuery] = useState('');
  const [isSearching, setIsSearching] = useState(false);
  const [searchResults, setSearchResults] = useState<SpotifySearchResultTrack[]>([]);
  const [hasSearched, setHasSearched] = useState(false);

  const [savingTrackUri, setSavingTrackUri] = useState<string | null>(null);
  const [isClearing, setIsClearing] = useState(false);

  const [notification, setNotification] = useState<{ type: 'success' | 'error'; message: string } | null>(null);

  // Audio preview playback
  const [playingPreviewUrl, setPlayingPreviewUrl] = useState<string | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);

  // Manual URI fallback mode toggle
  const [showManualInput, setShowManualInput] = useState(false);
  const [manualInput, setManualInput] = useState('');

  useEffect(() => {
    return () => {
      if (audioRef.current) {
        audioRef.current.pause();
        audioRef.current = null;
      }
    };
  }, []);

  const showToast = (type: 'success' | 'error', message: string) => {
    setNotification({ type, message });
    setTimeout(() => {
      setNotification((curr) => (curr?.message === message ? null : curr));
    }, 4500);
  };

  const handleSearch = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    const query = searchQuery.trim();
    if (!query) {
      setSearchResults([]);
      setHasSearched(false);
      return;
    }

    setIsSearching(true);
    setHasSearched(true);
    try {
      const { tracks, error } = await searchSpotifyTracks(query);
      if (error) {
        showToast('error', error);
        setSearchResults([]);
      } else {
        setSearchResults(tracks);
      }
    } catch {
      showToast('error', 'Search failed. Please verify your connection.');
      setSearchResults([]);
    } finally {
      setIsSearching(false);
    }
  };

  const handleSelectTrack = async (track: SpotifySearchResultTrack) => {
    if (!user) return;
    setSavingTrackUri(track.uri);

    // Stop any playing preview
    if (audioRef.current) {
      audioRef.current.pause();
      setPlayingPreviewUrl(null);
    }

    try {
      const res = await saveUserMusicPreference(user.id, track.uri, {
        track_title: track.title,
        artist_name: track.artist_name,
        album_name: track.album_name,
        artwork_url: track.artwork_url,
      });

      if (res.error) {
        showToast('error', res.error);
      } else {
        showToast('success', `Saved "${track.title}"! Plays on the Spotify device on verified entry.`);
        await refreshMusic();
        if (onSuccess) onSuccess();
      }
    } catch {
      showToast('error', 'Failed to save entry track preference');
    } finally {
      setSavingTrackUri(null);
    }
  };

  const handleManualSave = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!user) return;

    const parsed = parseSpotifyInput(manualInput);
    if (!parsed.isValid) {
      showToast('error', parsed.error || 'Invalid Spotify track link or URI');
      return;
    }

    setSavingTrackUri(parsed.uri);
    try {
      const res = await saveUserMusicPreference(user.id, parsed.uri);
      if (res.error) {
        showToast('error', res.error);
      } else {
        showToast('success', 'Spotify track saved! Plays on verified entry.');
        setManualInput('');
        setShowManualInput(false);
        await refreshMusic();
        if (onSuccess) onSuccess();
      }
    } catch {
      showToast('error', 'Failed to save music preference');
    } finally {
      setSavingTrackUri(null);
    }
  };

  const handleClearSong = async () => {
    if (!user) return;
    setIsClearing(true);

    try {
      const res = await clearUserMusicPreference(user.id);
      if (res.error) {
        showToast('error', res.error);
      } else {
        showToast('success', 'Entry soundtrack removed.');
        await refreshMusic();
        if (onSuccess) onSuccess();
      }
    } catch {
      showToast('error', 'Failed to remove song');
    } finally {
      setIsClearing(false);
    }
  };

  const togglePreview = (url: string | null | undefined) => {
    if (!url) return;

    if (playingPreviewUrl === url) {
      if (audioRef.current) {
        audioRef.current.pause();
      }
      setPlayingPreviewUrl(null);
    } else {
      if (audioRef.current) {
        audioRef.current.pause();
      }
      const audio = new Audio(url);
      audio.onended = () => setPlayingPreviewUrl(null);
      audio.play().catch(() => setPlayingPreviewUrl(null));
      audioRef.current = audio;
      setPlayingPreviewUrl(url);
    }
  };

  const currentUri = music?.spotify_uri;
  const currentTitle = music?.track_title;
  const currentArtist = music?.artist_name;
  const currentAlbum = music?.album_name;
  const currentArtwork = music?.artwork_url;

  return (
    <div className="rounded-2xl bg-slate-900/80 border border-slate-800 p-6 backdrop-blur-sm space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <div className="flex items-center gap-3">
          <div className="p-2.5 rounded-xl bg-emerald-500/10 border border-emerald-500/20 text-emerald-400">
            <Music className="h-5 w-5" />
          </div>
          <div>
            <h2 className="text-base font-semibold text-white">Spotify Entry Soundtrack</h2>
            <p className="text-xs text-slate-400">
              Plays directly via Spotify Web API whenever you authenticate at the door
            </p>
          </div>
        </div>

        {currentUri && (
          <span className="self-start sm:self-center text-[11px] font-mono font-medium px-2.5 py-1 rounded-full bg-emerald-500/10 text-emerald-300 border border-emerald-500/20 flex items-center gap-1.5">
            <span className="h-1.5 w-1.5 rounded-full bg-emerald-400 animate-pulse" />
            Active Soundtrack
          </span>
        )}
      </div>

      {/* Notifications */}
      {notification && (
        <div
          className={`p-3.5 rounded-xl border text-xs flex items-center gap-2.5 transition-all ${
            notification.type === 'success'
              ? 'bg-emerald-500/10 border-emerald-500/20 text-emerald-300'
              : 'bg-rose-500/10 border-rose-500/20 text-rose-300'
          }`}
        >
          {notification.type === 'success' ? (
            <CheckCircle2 className="h-4 w-4 text-emerald-400 shrink-0" />
          ) : (
            <AlertCircle className="h-4 w-4 text-rose-400 shrink-0" />
          )}
          <span>{notification.message}</span>
        </div>
      )}

      {/* Active Track Banner */}
      {currentUri ? (
        <div className="p-4 rounded-xl bg-slate-950 border border-emerald-500/30 shadow-sm relative overflow-hidden">
          <div className="absolute top-0 right-0 w-32 h-32 bg-emerald-500/5 rounded-full blur-2xl pointer-events-none" />

          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 relative z-10">
            <div className="flex items-center gap-3.5 min-w-0">
              {currentArtwork ? (
                <img
                  src={currentArtwork}
                  alt={currentTitle || 'Track cover'}
                  className="h-14 w-14 rounded-lg object-cover border border-slate-800 shadow-md shrink-0"
                />
              ) : (
                <div className="h-14 w-14 rounded-lg bg-emerald-500/10 border border-emerald-500/20 flex items-center justify-center text-emerald-400 shrink-0">
                  <Music className="h-6 w-6" />
                </div>
              )}

              <div className="min-w-0">
                <div className="text-[11px] font-medium text-emerald-400 uppercase tracking-wider">
                  Currently Saved Song
                </div>
                <div className="font-medium text-slate-100 text-sm truncate">
                  {currentTitle || 'Selected Spotify track'}
                </div>
                <div className="text-xs text-slate-400 truncate">
                  {currentArtist ? (currentAlbum ? `${currentArtist} • ${currentAlbum}` : currentArtist) : 'Spotify Track'}
                </div>
                <div className="font-mono text-[10px] text-slate-500 truncate mt-0.5">
                  {currentUri}
                </div>
              </div>
            </div>

            <div className="flex items-center gap-2 self-end sm:self-center shrink-0">
              <a
                href={`https://open.spotify.com/track/${currentUri.replace('spotify:track:', '')}`}
                target="_blank"
                rel="noopener noreferrer"
                className="px-3 py-1.5 rounded-lg bg-slate-900 hover:bg-slate-800 text-slate-300 hover:text-white border border-slate-700 text-xs transition-colors flex items-center gap-1.5"
                title="View on Spotify"
              >
                <span>Spotify</span>
                <ExternalLink className="h-3 w-3" />
              </a>

              <button
                type="button"
                onClick={handleClearSong}
                disabled={isClearing}
                className="px-3 py-1.5 rounded-lg bg-rose-500/10 hover:bg-rose-500/20 text-rose-300 border border-rose-500/20 text-xs font-medium transition-colors flex items-center gap-1.5 disabled:opacity-50"
              >
                {isClearing ? (
                  <Loader2 className="h-3 w-3 animate-spin" />
                ) : (
                  <Trash2 className="h-3 w-3" />
                )}
                <span>Remove</span>
              </button>
            </div>
          </div>
        </div>
      ) : (
        <div className="p-4 rounded-xl bg-slate-950/60 border border-dashed border-slate-800 text-center space-y-1">
          <p className="text-xs font-medium text-slate-300">No entry soundtrack selected</p>
          <p className="text-[11px] text-slate-500">
            Search for a track below to automatically play when your ESP32 door auth completes.
          </p>
        </div>
      )}

      {/* Song Search Form */}
      <div className="space-y-3">
        <div className="flex items-center justify-between">
          <label className="block text-xs font-medium text-slate-300">
            Search Spotify Tracks
          </label>
          <button
            type="button"
            onClick={() => setShowManualInput(!showManualInput)}
            className="text-[11px] text-slate-400 hover:text-emerald-400 transition-colors flex items-center gap-1"
          >
            <Link2 className="h-3 w-3" />
            <span>{showManualInput ? 'Hide manual link' : 'Paste URI or link manually'}</span>
          </button>
        </div>

        {showManualInput ? (
          <form onSubmit={handleManualSave} className="p-4 rounded-xl bg-slate-950 border border-slate-800 space-y-3">
            <div className="flex gap-2">
              <input
                type="text"
                value={manualInput}
                onChange={(e) => setManualInput(e.target.value)}
                placeholder="spotify:track:... or https://open.spotify.com/track/..."
                className="flex-1 bg-slate-900 border border-slate-800 rounded-xl px-3.5 py-2 text-xs text-slate-100 font-mono placeholder:font-sans placeholder:text-slate-600 focus:outline-none focus:border-emerald-500/60"
              />
              <button
                type="submit"
                disabled={Boolean(savingTrackUri) || !manualInput.trim()}
                className="px-4 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 text-white font-medium text-xs transition-colors shadow-sm flex items-center gap-1.5 shrink-0"
              >
                {savingTrackUri ? <Loader2 className="h-3 w-3 animate-spin" /> : <Sparkles className="h-3 w-3" />}
                <span>Save</span>
              </button>
            </div>
            <p className="text-[11px] text-slate-500">
              Directly input any Spotify track URI or web link if not found in catalog search.
            </p>
          </form>
        ) : (
          <form onSubmit={handleSearch} className="flex gap-2">
            <div className="relative flex-1">
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Search by song title, artist, or album..."
                className="w-full bg-slate-950 border border-slate-800 rounded-xl pl-9 pr-3.5 py-2.5 text-xs text-slate-100 placeholder:text-slate-600 focus:outline-none focus:border-emerald-500/60 focus:ring-1 focus:ring-emerald-500/40"
              />
              <Search className="h-4 w-4 text-slate-500 absolute left-3 top-3 pointer-events-none" />
            </div>

            <button
              type="submit"
              disabled={isSearching || !searchQuery.trim()}
              className="py-2.5 px-5 rounded-xl bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 text-white font-medium text-xs transition-colors shadow-md shadow-emerald-600/20 flex items-center gap-2 shrink-0"
            >
              {isSearching ? (
                <>
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  <span>Searching...</span>
                </>
              ) : (
                <>
                  <Search className="h-3.5 w-3.5" />
                  <span>Search</span>
                </>
              )}
            </button>
          </form>
        )}
      </div>

      {/* Search Results */}
      {isSearching && (
        <div className="p-8 text-center space-y-2">
          <Loader2 className="h-6 w-6 text-emerald-400 animate-spin mx-auto" />
          <p className="text-xs text-slate-400">Searching Spotify catalog...</p>
        </div>
      )}

      {!isSearching && hasSearched && searchResults.length === 0 && (
        <div className="p-6 rounded-xl bg-slate-950/40 border border-slate-800/80 text-center space-y-1">
          <p className="text-xs font-medium text-slate-300">No tracks found</p>
          <p className="text-[11px] text-slate-500">
            No matching tracks found for "{searchQuery}". Try different keywords or paste the Spotify link directly.
          </p>
        </div>
      )}

      {!isSearching && searchResults.length > 0 && (
        <div className="space-y-2.5 pt-1">
          <div className="text-xs font-medium text-slate-400 flex items-center justify-between">
            <span>Spotify Results ({searchResults.length})</span>
            <span className="text-[11px] text-slate-500">Click Select to save as your entry soundtrack</span>
          </div>

          <div className="space-y-2 max-h-96 overflow-y-auto pr-1">
            {searchResults.map((track) => {
              const isSelected = currentUri === track.uri;
              const isSavingThis = savingTrackUri === track.uri;
              const isPlayingThis = playingPreviewUrl === track.preview_url;

              return (
                <div
                  key={track.id}
                  className={`p-3 rounded-xl border transition-all flex items-center justify-between gap-3 ${
                    isSelected
                      ? 'bg-emerald-500/10 border-emerald-500/40'
                      : 'bg-slate-950/80 hover:bg-slate-950 border-slate-800/80 hover:border-slate-700'
                  }`}
                >
                  <div className="flex items-center gap-3 min-w-0">
                    {track.artwork_url ? (
                      <img
                        src={track.artwork_url}
                        alt={track.title}
                        className="h-12 w-12 rounded-lg object-cover border border-slate-800 shrink-0"
                      />
                    ) : (
                      <div className="h-12 w-12 rounded-lg bg-slate-900 border border-slate-800 flex items-center justify-center text-slate-500 shrink-0">
                        <Music className="h-5 w-5" />
                      </div>
                    )}

                    <div className="min-w-0">
                      <div className="font-medium text-xs text-slate-100 truncate">
                        {track.title}
                      </div>
                      <div className="text-[11px] text-slate-400 truncate">
                        {track.artist_name} {track.album_name ? `• ${track.album_name}` : ''}
                      </div>
                      <div className="text-[10px] font-mono text-slate-500 truncate mt-0.5">
                        {track.uri}
                      </div>
                    </div>
                  </div>

                  <div className="flex items-center gap-2 shrink-0">
                    {/* Audio Preview if available */}
                    {track.preview_url && (
                      <button
                        type="button"
                        onClick={() => togglePreview(track.preview_url)}
                        className={`p-2 rounded-lg border text-xs transition-colors ${
                          isPlayingThis
                            ? 'bg-emerald-500 text-slate-950 border-emerald-400'
                            : 'bg-slate-900 hover:bg-slate-800 text-slate-300 border-slate-700'
                        }`}
                        title={isPlayingThis ? 'Pause preview' : 'Play 30s preview'}
                      >
                        {isPlayingThis ? <Pause className="h-3.5 w-3.5" /> : <Play className="h-3.5 w-3.5" />}
                      </button>
                    )}

                    {/* Select / Active Button */}
                    <button
                      type="button"
                      onClick={() => handleSelectTrack(track)}
                      disabled={isSelected || Boolean(savingTrackUri)}
                      className={`px-3.5 py-1.5 rounded-lg text-xs font-medium transition-colors flex items-center gap-1.5 ${
                        isSelected
                          ? 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/30 cursor-default'
                          : 'bg-slate-800 hover:bg-emerald-600 hover:text-white text-slate-200 border border-slate-700'
                      }`}
                    >
                      {isSavingThis ? (
                        <>
                          <Loader2 className="h-3 w-3 animate-spin" />
                          <span>Saving...</span>
                        </>
                      ) : isSelected ? (
                        <>
                          <CheckCircle2 className="h-3 w-3 text-emerald-400" />
                          <span>Selected</span>
                        </>
                      ) : (
                        <span>Select</span>
                      )}
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
};
