-- Migration: 20261014_admin_profiles_rls_and_rpc.sql
-- Enables active administrators to securely view all profiles (including pending signups)
-- while strictly preventing ordinary users from viewing other residents' profiles.

-- 1. Helper function: is_admin() checks for an active, approved administrator
CREATE OR REPLACE FUNCTION public.is_admin()
RETURNS BOOLEAN
LANGUAGE sql
SECURITY DEFINER
SET search_path = ''
STABLE
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.profiles
    WHERE id = auth.uid()
      AND role = 'admin'
      AND is_enabled = TRUE
      AND approval_status = 'approved'
  );
$$;

REVOKE ALL ON FUNCTION public.is_admin() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.is_admin() TO authenticated, service_role;

-- 2. Update Row Level Security (RLS) on public.profiles
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can view own profile or admins view all" ON public.profiles;
DROP POLICY IF EXISTS "Users can view own profile" ON public.profiles;

CREATE POLICY "Users can view own profile or admins view all"
  ON public.profiles FOR SELECT
  TO authenticated
  USING (
    auth.uid() = id
    OR
    public.is_admin()
  );

-- 3. Dedicated administrative RPC function for user directory retrieval
CREATE OR REPLACE FUNCTION public.admin_get_users(p_caller_id UUID)
RETURNS TABLE (
  id UUID,
  display_name TEXT,
  role TEXT,
  is_enabled BOOLEAN,
  approval_status TEXT,
  created_at TIMESTAMPTZ
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM public.profiles
    WHERE id = p_caller_id
      AND role = 'admin'
      AND is_enabled = TRUE
      AND approval_status = 'approved'
  ) THEN
    RAISE EXCEPTION 'Unauthorized: Caller is not an active administrator';
  END IF;

  RETURN QUERY
  SELECT p.id, p.display_name, p.role, p.is_enabled, p.approval_status, p.created_at
  FROM public.profiles p
  ORDER BY p.created_at DESC;
END;
$$;

REVOKE ALL ON FUNCTION public.admin_get_users(UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_get_users(UUID) TO authenticated, service_role;
