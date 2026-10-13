-- Migration: 20261012_security_fixes.sql
-- Description:
-- 1. Atomic OTP consumption with UUID request ID validation
-- 2. Last-active-administrator protection
-- 3. Protection against direct role/status modification

-- ============================================================
-- 1. Atomic Door Authentication Session Consumption
-- Preserves existing signature: (TEXT, TEXT) RETURNS UUID
-- ============================================================

CREATE OR REPLACE FUNCTION public.consume_door_auth_session(
  p_request_id TEXT,
  p_otp_hash TEXT
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_user_id UUID;
  v_request_id UUID;
BEGIN
  -- Reject missing inputs.
  IF p_request_id IS NULL
     OR p_otp_hash IS NULL
     OR pg_catalog.btrim(p_otp_hash) = ''
  THEN
    RETURN NULL;
  END IF;

  -- Safely validate and convert the UUID request ID.
  BEGIN
    v_request_id := p_request_id::UUID;
  EXCEPTION
    WHEN invalid_text_representation THEN
      RETURN NULL;
  END;

  -- Atomic one-time consumption. Concurrent attempts cannot
  -- both consume the same unconsumed session.
  UPDATE public.auth_sessions
  SET consumed_at = pg_catalog.now()
  WHERE request_id = v_request_id::TEXT
    AND otp_hash = p_otp_hash
    AND expires_at > pg_catalog.now()
    AND consumed_at IS NULL
  RETURNING user_id INTO v_user_id;

  RETURN v_user_id;
END;
$function$;

REVOKE ALL
ON FUNCTION public.consume_door_auth_session(TEXT, TEXT)
FROM PUBLIC, anon, authenticated;

GRANT EXECUTE
ON FUNCTION public.consume_door_auth_session(TEXT, TEXT)
TO service_role;


-- ============================================================
-- 2. Administrator Role/Status Update
-- Preserves the existing function signature and return contract.
-- ============================================================

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
AS $function$
DECLARE
  v_caller RECORD;
  v_target RECORD;
  v_active_admins BIGINT;
BEGIN
  -- Serialize administrator changes to protect the last active admin.
  PERFORM pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtext('admin_update_user_lock')
  );

  -- Validate caller.
  SELECT id, role, is_enabled
  INTO v_caller
  FROM public.profiles
  WHERE id = p_caller_id;

  IF NOT FOUND
     OR v_caller.role IS DISTINCT FROM 'admin'
     OR v_caller.is_enabled IS DISTINCT FROM TRUE
  THEN
    RETURN QUERY
      SELECT FALSE, 'Unauthorized: Caller is not an active administrator'::TEXT;
    RETURN;
  END IF;

  -- Validate target.
  SELECT id, role, is_enabled
  INTO v_target
  FROM public.profiles
  WHERE id = p_target_id;

  IF NOT FOUND THEN
    RETURN QUERY
      SELECT FALSE, 'Target user not found'::TEXT;
    RETURN;
  END IF;

  -- Validate requested role before performing any updates.
  IF p_new_role IS NOT NULL
     AND p_new_role NOT IN ('user', 'admin')
  THEN
    RETURN QUERY
      SELECT FALSE, 'Invalid role: must be user or admin'::TEXT;
    RETURN;
  END IF;

  -- Prevent self-demotion or self-disablement.
  IF p_caller_id = p_target_id THEN
    IF p_new_role IS NOT NULL AND p_new_role <> 'admin' THEN
      RETURN QUERY
        SELECT FALSE, 'Administrators cannot demote themselves'::TEXT;
      RETURN;
    END IF;

    IF p_new_is_enabled IS FALSE THEN
      RETURN QUERY
        SELECT FALSE, 'Administrators cannot disable their own account'::TEXT;
      RETURN;
    END IF;
  END IF;

  -- Protect the last active administrator.
  IF v_target.role = 'admin'
     AND v_target.is_enabled IS TRUE
     AND (
       (p_new_role IS NOT NULL AND p_new_role <> 'admin')
       OR p_new_is_enabled IS FALSE
     )
  THEN
    SELECT pg_catalog.count(*)
    INTO v_active_admins
    FROM public.profiles
    WHERE role = 'admin'
      AND is_enabled IS TRUE;

    IF v_active_admins <= 1 THEN
      RETURN QUERY
        SELECT FALSE, 'Cannot demote or disable the last active administrator'::TEXT;
      RETURN;
    END IF;
  END IF;

  -- Transaction-local authorization flag for the profile trigger.
  PERFORM pg_catalog.set_config(
    'app.allow_profile_role_update',
    'true',
    TRUE
  );

  IF p_new_role IS NOT NULL THEN
    UPDATE public.profiles
    SET role = p_new_role
    WHERE id = p_target_id;
  END IF;

  IF p_new_is_enabled IS NOT NULL THEN
    UPDATE public.profiles
    SET is_enabled = p_new_is_enabled
    WHERE id = p_target_id;
  END IF;

  RETURN QUERY
    SELECT TRUE, 'User profile updated successfully'::TEXT;
END;
$function$;

REVOKE ALL
ON FUNCTION public.admin_update_user(UUID, UUID, TEXT, BOOLEAN)
FROM PUBLIC, anon, authenticated;

GRANT EXECUTE
ON FUNCTION public.admin_update_user(UUID, UUID, TEXT, BOOLEAN)
TO service_role;


-- ============================================================
-- 3. Protect Privileged Profile Columns
-- ============================================================

CREATE OR REPLACE FUNCTION public.protect_profile_columns()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
BEGIN
  IF NEW.role IS DISTINCT FROM OLD.role
     OR NEW.is_enabled IS DISTINCT FROM OLD.is_enabled
  THEN
    IF pg_catalog.current_setting(
      'app.allow_profile_role_update',
      TRUE
    ) IS DISTINCT FROM 'true'
    THEN
      RAISE EXCEPTION
        'Direct modification of role and account status is prohibited. Use admin_update_user.';
    END IF;
  END IF;

  RETURN NEW;
END;
$function$;

REVOKE ALL
ON FUNCTION public.protect_profile_columns()
FROM PUBLIC, anon, authenticated;

-- Install the trigger without changing existing profile policies.
DROP TRIGGER IF EXISTS tr_protect_profile_columns
ON public.profiles;

CREATE TRIGGER tr_protect_profile_columns
BEFORE UPDATE ON public.profiles
FOR EACH ROW
EXECUTE FUNCTION public.protect_profile_columns();