-- Supabase Database Schema & RLS Policies Reference
-- For IoT-Based Smart Door Authentication System

-- 1. Profiles Table
CREATE TABLE IF NOT EXISTS public.profiles (
  id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  display_name TEXT,
  role TEXT NOT NULL DEFAULT 'user' CHECK (role IN ('user', 'admin')),
  is_enabled BOOLEAN NOT NULL DEFAULT FALSE,
  approval_status TEXT NOT NULL DEFAULT 'pending' CHECK (approval_status IN ('pending', 'approved', 'rejected')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now())
);

CREATE INDEX IF NOT EXISTS idx_profiles_approval_status ON public.profiles(approval_status);

-- 2. User Music Preferences Table
CREATE TABLE IF NOT EXISTS public.user_music (
  user_id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  spotify_uri TEXT,
  track_title TEXT,
  artist_name TEXT,
  album_name TEXT,
  artwork_url TEXT,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now())
);

-- 2b. Shared Spotify Account credentials table (Direct Web API backend integration)
CREATE TABLE IF NOT EXISTS public.spotify_shared_account (
  id INT PRIMARY KEY DEFAULT 1,
  refresh_token TEXT NOT NULL,
  scope TEXT,
  spotify_user_id TEXT,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now())
);

-- 2c. Temporary Spotify OAuth states table (CSRF protection)
CREATE TABLE IF NOT EXISTS public.spotify_oauth_states (
  state_token TEXT PRIMARY KEY,
  expires_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now())
);

-- 3. Authentication Sessions Table (Short-lived single-use tokens)
CREATE TABLE IF NOT EXISTS public.auth_sessions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  request_id TEXT NOT NULL UNIQUE,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  otp_hash TEXT NOT NULL,
  expires_at TIMESTAMPTZ NOT NULL,
  consumed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now())
);

-- 4. Entry Logs Table
CREATE TABLE IF NOT EXISTS public.entry_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  occurred_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now()),
  user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  device_id TEXT NOT NULL,
  result TEXT NOT NULL CHECK (result = ANY (ARRAY['success'::text, 'failure'::text])),
  failure_reason TEXT,
  request_id TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now())
);

-- 5. Intrusion Alerts Table
CREATE TABLE IF NOT EXISTS public.intrusion_alerts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  entry_log_id UUID REFERENCES public.entry_logs(id) ON DELETE SET NULL,
  severity TEXT NOT NULL CHECK (severity IN ('low', 'medium', 'high', 'critical')),
  message TEXT NOT NULL,
  notification_status TEXT NOT NULL DEFAULT 'pending' CHECK (notification_status IN ('pending', 'sent', 'failed', 'acknowledged')),
  acknowledged_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now())
);

-- ROW LEVEL SECURITY (RLS) POLICIES

ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.user_music ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.auth_sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.entry_logs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.intrusion_alerts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.spotify_shared_account ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.spotify_oauth_states ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON public.spotify_shared_account FROM PUBLIC, anon, authenticated;
GRANT ALL ON public.spotify_shared_account TO service_role;

REVOKE ALL ON public.spotify_oauth_states FROM PUBLIC, anon, authenticated;
GRANT ALL ON public.spotify_oauth_states TO service_role;

-- Helper function to check if current user is an admin
CREATE OR REPLACE FUNCTION public.is_admin()
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  RETURN EXISTS (
    SELECT 1 FROM public.profiles
    WHERE id = auth.uid() AND role = 'admin'
  );
END;
$$;

REVOKE ALL ON FUNCTION public.is_admin() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.is_admin() TO authenticated, service_role;

-- Profiles Policies
CREATE POLICY "Users can view own profile or admins view all"
  ON public.profiles FOR SELECT
  USING (auth.uid() = id OR public.is_admin());

CREATE POLICY "Users can update own display_name"
  ON public.profiles FOR UPDATE
  USING (auth.uid() = id)
  WITH CHECK (auth.uid() = id);

CREATE POLICY "Admins can update any profile"
  ON public.profiles FOR UPDATE
  USING (public.is_admin());

-- User Music Policies
CREATE POLICY "Users can read own music preference"
  ON public.user_music FOR SELECT
  USING (auth.uid() = user_id OR public.is_admin());

CREATE POLICY "Users can insert or update own music preference"
  ON public.user_music FOR ALL
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

-- Auth Sessions Policies (Strict zero-trust: managed by Edge Functions)
CREATE POLICY "Admins can view auth sessions"
  ON public.auth_sessions FOR SELECT
  USING (public.is_admin());

-- Entry Logs Policies
CREATE POLICY "Users can view their own entry logs"
  ON public.entry_logs FOR SELECT
  USING (auth.uid() = user_id OR public.is_admin());

-- Intrusion Alerts Policies
CREATE POLICY "Only admins can view and acknowledge intrusion alerts"
  ON public.intrusion_alerts FOR ALL
  USING (public.is_admin());

-- Trigger for Auto-Creating Profile on Signup
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  INSERT INTO public.profiles (id, display_name, role, is_enabled, approval_status)
  VALUES (
    new.id,
    COALESCE(new.raw_user_meta_data->>'display_name', pg_catalog.split_part(new.email, '@', 1)),
    'user',
    FALSE,
    'pending'
  );
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE PROCEDURE public.handle_new_user();

-- Enable Realtime for intrusion_alerts and entry_logs
ALTER PUBLICATION supabase_realtime ADD TABLE public.intrusion_alerts;
ALTER PUBLICATION supabase_realtime ADD TABLE public.entry_logs;

-- Atomic OTP Consumption Function (Preserves RETURNS UUID signature)
CREATE OR REPLACE FUNCTION public.consume_door_auth_session(
  p_request_id TEXT,
  p_otp_hash TEXT
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_session RECORD;
  v_now TIMESTAMPTZ := pg_catalog.timezone('utc'::pg_catalog.text, pg_catalog.now());
BEGIN
  IF p_request_id IS NULL OR p_otp_hash IS NULL OR pg_catalog.length(pg_catalog.btrim(p_request_id)) = 0 OR pg_catalog.length(pg_catalog.btrim(p_otp_hash)) = 0 THEN
    RETURN NULL;
  END IF;

  SELECT s.id, s.user_id, s.expires_at, s.consumed_at, s.otp_hash
  INTO v_session
  FROM public.auth_sessions s
  WHERE s.request_id = p_request_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN NULL;
  END IF;

  IF v_session.otp_hash <> p_otp_hash THEN
    RETURN NULL;
  END IF;

  IF v_session.consumed_at IS NOT NULL THEN
    RETURN NULL;
  END IF;

  IF v_session.expires_at <= v_now THEN
    RETURN NULL;
  END IF;

  UPDATE public.auth_sessions
  SET consumed_at = v_now
  WHERE id = v_session.id;

  RETURN v_session.user_id;
END;
$$;

REVOKE ALL ON FUNCTION public.consume_door_auth_session(TEXT, TEXT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.consume_door_auth_session(TEXT, TEXT) TO service_role;

-- Administrator Protection and Atomic Role/Status Update Function
CREATE OR REPLACE FUNCTION public.admin_update_user(
  p_caller_id UUID,
  p_target_id UUID,
  p_new_role TEXT DEFAULT NULL,
  p_new_is_enabled BOOLEAN DEFAULT NULL
)
RETURNS TABLE (
  success BOOLEAN,
  message TEXT
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_caller RECORD;
  v_target RECORD;
  v_active_admins INT;
BEGIN
  -- Acquire transaction-level advisory lock to serialize concurrent administrative updates
  PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtext('admin_update_user_lock'));

  SELECT id, role, is_enabled INTO v_caller
  FROM public.profiles
  WHERE id = p_caller_id;

  IF NOT FOUND OR v_caller.role <> 'admin' OR v_caller.is_enabled <> TRUE THEN
    RETURN QUERY SELECT FALSE, 'Unauthorized: Caller is not an active administrator'::TEXT;
    RETURN;
  END IF;

  SELECT id, role, is_enabled INTO v_target
  FROM public.profiles
  WHERE id = p_target_id;

  IF NOT FOUND THEN
    RETURN QUERY SELECT FALSE, 'Target user not found'::TEXT;
    RETURN;
  END IF;

  IF p_caller_id = p_target_id THEN
    IF (p_new_role IS NOT NULL AND p_new_role <> 'admin') THEN
      RETURN QUERY SELECT FALSE, 'Administrators cannot demote themselves'::TEXT;
      RETURN;
    END IF;
    IF (p_new_is_enabled IS NOT NULL AND p_new_is_enabled = FALSE) THEN
      RETURN QUERY SELECT FALSE, 'Administrators cannot disable their own account'::TEXT;
      RETURN;
    END IF;
  END IF;

  IF v_target.role = 'admin' AND v_target.is_enabled = TRUE THEN
    IF (p_new_role IS NOT NULL AND p_new_role <> 'admin') OR (p_new_is_enabled IS NOT NULL AND p_new_is_enabled = FALSE) THEN
      SELECT pg_catalog.count(*) INTO v_active_admins
      FROM public.profiles
      WHERE role = 'admin' AND is_enabled = TRUE;

      IF v_active_admins <= 1 THEN
        RETURN QUERY SELECT FALSE, 'Cannot demote or disable the last active administrator'::TEXT;
        RETURN;
      END IF;
    END IF;
  END IF;

  IF p_new_role IS NOT NULL THEN
    IF p_new_role NOT IN ('user', 'admin') THEN
      RETURN QUERY SELECT FALSE, 'Invalid role: must be user or admin'::TEXT;
      RETURN;
    END IF;
  END IF;

  PERFORM pg_catalog.set_config('app.allow_profile_role_update', 'true', true);

  IF p_new_role IS NOT NULL THEN
    UPDATE public.profiles SET role = p_new_role WHERE id = p_target_id;
  END IF;

  IF p_new_is_enabled IS NOT NULL THEN
    UPDATE public.profiles SET is_enabled = p_new_is_enabled WHERE id = p_target_id;
  END IF;

  RETURN QUERY SELECT TRUE, 'User profile updated successfully'::TEXT;
END;
$$;

REVOKE ALL ON FUNCTION public.admin_update_user(UUID, UUID, TEXT, BOOLEAN) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.admin_update_user(UUID, UUID, TEXT, BOOLEAN) TO service_role;

-- Prevent Privilege Escalation via Client Direct Updates on Profiles
CREATE OR REPLACE FUNCTION public.protect_profile_columns()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_allowed TEXT;
BEGIN
  IF (NEW.role IS DISTINCT FROM OLD.role) OR (NEW.is_enabled IS DISTINCT FROM OLD.is_enabled) THEN
    v_allowed := pg_catalog.current_setting('app.allow_profile_role_update', true);

    IF v_allowed IS DISTINCT FROM 'true' THEN
      IF (auth.role() = 'service_role' OR current_user IN ('postgres', 'supabase_admin')) AND auth.uid() IS NULL THEN
        RETURN NEW;
      END IF;

      RAISE EXCEPTION 'Direct modification of role and account status is prohibited. Use admin_update_user.';
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.protect_profile_columns() FROM PUBLIC;

DROP TRIGGER IF EXISTS tr_protect_profile_columns ON public.profiles;
CREATE TRIGGER tr_protect_profile_columns
  BEFORE UPDATE ON public.profiles
  FOR EACH ROW
  EXECUTE FUNCTION public.protect_profile_columns();
