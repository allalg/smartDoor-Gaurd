-- Migration: 20261013_spotify_direct_integration.sql
-- Description: Safe, non-destructive schema additions and reconciliation for Spotify Web API integration
-- Preserves existing table structure, row data, and tokens in public.spotify_shared_account.

DO $$
BEGIN
  -- 1. Create spotify_shared_account only if it does not already exist
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.tables 
    WHERE table_schema = 'public' AND table_name = 'spotify_shared_account'
  ) THEN
    CREATE TABLE public.spotify_shared_account (
      id INT PRIMARY KEY DEFAULT 1,
      refresh_token TEXT NOT NULL,
      scope TEXT,
      spotify_user_id TEXT,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now())
    );
  END IF;

  -- 2. Create spotify_oauth_states if not exists
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.tables 
    WHERE table_schema = 'public' AND table_name = 'spotify_oauth_states'
  ) THEN
    CREATE TABLE public.spotify_oauth_states (
      state_token TEXT PRIMARY KEY,
      expires_at TIMESTAMPTZ NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now())
    );
  END IF;
END $$;

-- 3. Ensure Row Level Security and private grants
ALTER TABLE public.spotify_shared_account ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.spotify_shared_account FROM PUBLIC, anon, authenticated;
GRANT ALL ON public.spotify_shared_account TO service_role;

ALTER TABLE public.spotify_oauth_states ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.spotify_oauth_states FROM PUBLIC, anon, authenticated;
GRANT ALL ON public.spotify_oauth_states TO service_role;

-- 4. Extend user_music with track display metadata columns
ALTER TABLE public.user_music
  ADD COLUMN IF NOT EXISTS track_title TEXT,
  ADD COLUMN IF NOT EXISTS artist_name TEXT,
  ADD COLUMN IF NOT EXISTS album_name TEXT,
  ADD COLUMN IF NOT EXISTS artwork_url TEXT;
