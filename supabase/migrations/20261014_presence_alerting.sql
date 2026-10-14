-- Migration: 20261014_presence_alerting.sql
-- Adds columns to intrusion_alerts for prolonged IR presence alerting.
-- Safe to re-run (idempotent with IF NOT EXISTS / DO blocks).

-- 1. alert_type: distinguishes auth-failure alerts from prolonged-presence alerts.
--    Existing rows default to 'auth_failure' (backward compatible).
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name  = 'intrusion_alerts'
      AND column_name = 'alert_type'
  ) THEN
    ALTER TABLE public.intrusion_alerts
      ADD COLUMN alert_type TEXT NOT NULL DEFAULT 'auth_failure';
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'intrusion_alerts_alert_type_check'
  ) THEN
    ALTER TABLE public.intrusion_alerts
      ADD CONSTRAINT intrusion_alerts_alert_type_check
      CHECK (alert_type IN ('auth_failure', 'prolonged_presence'));
  END IF;
END $$;

-- 2. device_id: identifies which physical door device generated the alert.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name  = 'intrusion_alerts'
      AND column_name = 'device_id'
  ) THEN
    ALTER TABLE public.intrusion_alerts ADD COLUMN device_id TEXT;
  END IF;
END $$;

-- 3. duration_seconds: how long continuous presence was detected before alert.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name  = 'intrusion_alerts'
      AND column_name = 'duration_seconds'
  ) THEN
    ALTER TABLE public.intrusion_alerts ADD COLUMN duration_seconds INTEGER;
  END IF;
END $$;

-- 4. Index for efficient deduplication queries (recent alerts by device + type).
CREATE INDEX IF NOT EXISTS idx_intrusion_alerts_device_type_created
  ON public.intrusion_alerts(device_id, alert_type, created_at DESC);
