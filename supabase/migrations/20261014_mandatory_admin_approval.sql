-- Migration: 20261014_mandatory_admin_approval.sql
-- Description:
-- 1. Add approval_status to profiles ('pending', 'approved', 'rejected')
-- 2. Backfill existing accounts (active admins & enabled users -> 'approved')
-- 3. Update handle_new_user trigger: new signups are 'user', is_enabled=false, approval_status='pending'
-- 4. Update protect_profile_columns trigger to protect approval_status from direct client modification
-- 5. Update admin_update_user RPC to support approval_status atomically

-- Step 1: Add approval_status column with constraint
ALTER TABLE public.profiles
ADD COLUMN IF NOT EXISTS approval_status TEXT NOT NULL DEFAULT 'pending'
CHECK (approval_status IN ('pending', 'approved', 'rejected'));

CREATE INDEX IF NOT EXISTS idx_profiles_approval_status ON public.profiles(approval_status);

-- Step 2: Backfill existing legitimate accounts carefully
-- All administrators become 'approved'
UPDATE public.profiles
SET approval_status = 'approved'
WHERE role = 'admin';

-- All existing enabled users become 'approved'
UPDATE public.profiles
SET approval_status = 'approved'
WHERE is_enabled = TRUE AND role = 'user';

-- Any existing disabled users remain 'rejected' or 'pending'
UPDATE public.profiles
SET approval_status = 'rejected'
WHERE is_enabled = FALSE AND role = 'user' AND approval_status = 'pending';

-- Step 3: Update profile creation trigger for new signups
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

-- Step 4: Protect privileged columns (role, is_enabled, approval_status)
CREATE OR REPLACE FUNCTION public.protect_profile_columns()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
BEGIN
  IF NEW.role IS DISTINCT FROM OLD.role
     OR NEW.is_enabled IS DISTINCT FROM OLD.is_enabled
     OR NEW.approval_status IS DISTINCT FROM OLD.approval_status
  THEN
    IF pg_catalog.current_setting(
      'app.allow_profile_role_update',
      TRUE
    ) IS DISTINCT FROM 'true'
    THEN
      RAISE EXCEPTION
        'Direct modification of role, approval status, and account status is prohibited. Use admin_update_user.';
    END IF;
  END IF;

  RETURN NEW;
END;
$function$;

-- Step 5: Updated admin_update_user function supporting approval_status
CREATE OR REPLACE FUNCTION public.admin_update_user(
  p_caller_id UUID,
  p_target_id UUID,
  p_new_role TEXT DEFAULT NULL,
  p_new_is_enabled BOOLEAN DEFAULT NULL,
  p_new_approval_status TEXT DEFAULT NULL
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
  v_effective_is_enabled BOOLEAN;
BEGIN
  -- Serialize administrator changes to protect the last active admin.
  PERFORM pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtext('admin_update_user_lock')
  );

  -- Validate caller: must be an active, approved administrator
  SELECT id, role, is_enabled, approval_status
  INTO v_caller
  FROM public.profiles
  WHERE id = p_caller_id;

  IF NOT FOUND
     OR v_caller.role IS DISTINCT FROM 'admin'
     OR v_caller.is_enabled IS DISTINCT FROM TRUE
     OR v_caller.approval_status IS DISTINCT FROM 'approved'
  THEN
    RETURN QUERY
      SELECT FALSE, 'Unauthorized: Caller is not an active approved administrator'::TEXT;
    RETURN;
  END IF;

  -- Validate target.
  SELECT id, role, is_enabled, approval_status
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

  -- Validate requested approval_status before performing any updates.
  IF p_new_approval_status IS NOT NULL
     AND p_new_approval_status NOT IN ('pending', 'approved', 'rejected')
  THEN
    RETURN QUERY
      SELECT FALSE, 'Invalid approval status: must be pending, approved, or rejected'::TEXT;
    RETURN;
  END IF;

  -- Prevent self-demotion, self-disablement, or self-approval alteration.
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

    IF p_new_approval_status IS NOT NULL AND p_new_approval_status <> 'approved' THEN
      RETURN QUERY
        SELECT FALSE, 'Administrators cannot alter their own approval status'::TEXT;
      RETURN;
    END IF;
  END IF;

  -- Compute effective enabled status:
  -- If p_new_approval_status = 'approved' and p_new_is_enabled is not specified, enable the user.
  -- If p_new_approval_status = 'rejected' and p_new_is_enabled is not specified, disable the user.
  v_effective_is_enabled := p_new_is_enabled;
  IF v_effective_is_enabled IS NULL THEN
    IF p_new_approval_status = 'approved' THEN
      v_effective_is_enabled := TRUE;
    ELSIF p_new_approval_status = 'rejected' THEN
      v_effective_is_enabled := FALSE;
    END IF;
  END IF;

  -- Protect the last active administrator.
  IF v_target.role = 'admin'
     AND v_target.is_enabled IS TRUE
     AND v_target.approval_status = 'approved'
     AND (
       (p_new_role IS NOT NULL AND p_new_role <> 'admin')
       OR v_effective_is_enabled IS FALSE
       OR (p_new_approval_status IS NOT NULL AND p_new_approval_status <> 'approved')
     )
  THEN
    SELECT pg_catalog.count(*)
    INTO v_active_admins
    FROM public.profiles
    WHERE role = 'admin'
      AND is_enabled IS TRUE
      AND approval_status = 'approved';

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

  IF v_effective_is_enabled IS NOT NULL THEN
    UPDATE public.profiles
    SET is_enabled = v_effective_is_enabled
    WHERE id = p_target_id;
  END IF;

  IF p_new_approval_status IS NOT NULL THEN
    UPDATE public.profiles
    SET approval_status = p_new_approval_status
    WHERE id = p_target_id;
  END IF;

  RETURN QUERY
    SELECT TRUE, 'User profile updated successfully'::TEXT;
END;
$function$;

-- Provide 4-argument wrapper for backward compatibility
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
BEGIN
  RETURN QUERY
    SELECT * FROM public.admin_update_user(
      p_caller_id,
      p_target_id,
      p_new_role,
      p_new_is_enabled,
      NULL
    );
END;
$function$;

REVOKE ALL
ON FUNCTION public.admin_update_user(UUID, UUID, TEXT, BOOLEAN, TEXT)
FROM PUBLIC, anon, authenticated;

GRANT EXECUTE
ON FUNCTION public.admin_update_user(UUID, UUID, TEXT, BOOLEAN, TEXT)
TO service_role;

REVOKE ALL
ON FUNCTION public.admin_update_user(UUID, UUID, TEXT, BOOLEAN)
FROM PUBLIC, anon, authenticated;

GRANT EXECUTE
ON FUNCTION public.admin_update_user(UUID, UUID, TEXT, BOOLEAN)
TO service_role;
