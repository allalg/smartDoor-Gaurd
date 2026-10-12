import { supabase, isSupabaseConfigured } from '@/lib/supabase';
import type { Profile, IntrusionAlert, EntryLog } from '@/types/database';

export interface AdminMetrics {
  totalUsers: number;
  successfulEntries: number;
  failedEntries: number;
  unacknowledgedAlerts: number;
  recentEvents: EntryLog[];
}

export async function fetchAdminMetrics(): Promise<{ metrics: AdminMetrics; error: string | null }> {
  const defaultMetrics: AdminMetrics = {
    totalUsers: 0,
    successfulEntries: 0,
    failedEntries: 0,
    unacknowledgedAlerts: 0,
    recentEvents: [],
  };

  if (!isSupabaseConfigured) {
    return { metrics: defaultMetrics, error: 'Supabase credentials not configured' };
  }

  try {
    // 1. Total users count
    const { count: usersCount, error: usersErr } = await supabase
      .from('profiles')
      .select('*', { count: 'exact', head: true });

    if (usersErr) console.warn('Count users error:', usersErr.message);

    // 2. Successful entries count
    const { count: successCount, error: successErr } = await supabase
      .from('entry_logs')
      .select('*', { count: 'exact', head: true })
      .eq('result', 'granted');

    if (successErr) console.warn('Success entries count error:', successErr.message);

    // 3. Failed entries count
    const { count: failedCount, error: failErr } = await supabase
      .from('entry_logs')
      .select('*', { count: 'exact', head: true })
      .eq('result', 'denied');

    if (failErr) console.warn('Failed entries count error:', failErr.message);

    // 4. Unacknowledged alerts count
    const { count: alertsCount, error: alertsErr } = await supabase
      .from('intrusion_alerts')
      .select('*', { count: 'exact', head: true })
      .is('acknowledged_at', null);

    if (alertsErr) console.warn('Alerts count error:', alertsErr.message);

    // 5. Recent events
    const { data: recent, error: recentErr } = await supabase
      .from('entry_logs')
      .select('id, occurred_at, user_id, device_id, result, failure_reason, request_id, created_at')
      .order('occurred_at', { ascending: false })
      .limit(8);

    if (recentErr) console.warn('Recent events error:', recentErr.message);

    return {
      metrics: {
        totalUsers: usersCount ?? 0,
        successfulEntries: successCount ?? 0,
        failedEntries: failedCount ?? 0,
        unacknowledgedAlerts: alertsCount ?? 0,
        recentEvents: (recent as EntryLog[]) || [],
      },
      error: null,
    };
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : 'Failed to fetch admin metrics';
    return { metrics: defaultMetrics, error: msg };
  }
}

export async function fetchAllUsers(): Promise<{ users: Profile[]; error: string | null }> {
  if (!isSupabaseConfigured) {
    return { users: [], error: 'Supabase not configured' };
  }

  try {
    const { data, error } = await supabase
      .from('profiles')
      .select('id, display_name, role, is_enabled, created_at')
      .order('created_at', { ascending: false });

    if (error) return { users: [], error: error.message };
    return { users: (data as Profile[]) || [], error: null };
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : 'Failed to fetch user list';
    return { users: [], error: msg };
  }
}

export async function toggleUserStatus(
  userId: string,
  isEnabled: boolean
): Promise<{ success: boolean; error: string | null }> {
  if (!isSupabaseConfigured) return { success: false, error: 'Supabase not configured' };

  try {
    const { error } = await supabase
      .from('profiles')
      .update({ is_enabled: isEnabled })
      .eq('id', userId);

    if (error) return { success: false, error: error.message };
    return { success: true, error: null };
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : 'Failed to update user status';
    return { success: false, error: msg };
  }
}

export async function updateUserRole(
  userId: string,
  role: 'user' | 'admin'
): Promise<{ success: boolean; error: string | null }> {
  if (!isSupabaseConfigured) return { success: false, error: 'Supabase not configured' };

  try {
    const { error } = await supabase
      .from('profiles')
      .update({ role })
      .eq('id', userId);

    if (error) return { success: false, error: error.message };
    return { success: true, error: null };
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : 'Failed to change role';
    return { success: false, error: msg };
  }
}

export async function fetchIntrusionAlerts(): Promise<{ alerts: IntrusionAlert[]; error: string | null }> {
  if (!isSupabaseConfigured) {
    return { alerts: [], error: 'Supabase not configured' };
  }

  try {
    const { data, error } = await supabase
      .from('intrusion_alerts')
      .select(`
        id, entry_log_id, severity, message, notification_status, acknowledged_at, created_at,
        entry_log:entry_logs(id, occurred_at, user_id, device_id, result, failure_reason)
      `)
      .order('created_at', { ascending: false });

    if (error) {
      // Fallback without relation
      const fallback = await supabase
        .from('intrusion_alerts')
        .select('id, entry_log_id, severity, message, notification_status, acknowledged_at, created_at')
        .order('created_at', { ascending: false });

      if (fallback.error) return { alerts: [], error: fallback.error.message };
      return { alerts: (fallback.data as IntrusionAlert[]) || [], error: null };
    }

    return { alerts: (data as unknown as IntrusionAlert[]) || [], error: null };
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : 'Failed to fetch intrusion alerts';
    return { alerts: [], error: msg };
  }
}

export async function acknowledgeAlert(
  alertId: string
): Promise<{ success: boolean; error: string | null }> {
  if (!isSupabaseConfigured) return { success: false, error: 'Supabase not configured' };

  try {
    const { error } = await supabase
      .from('intrusion_alerts')
      .update({
        acknowledged_at: new Date().toISOString(),
        notification_status: 'acknowledged',
      })
      .eq('id', alertId);

    if (error) return { success: false, error: error.message };
    return { success: true, error: null };
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : 'Failed to acknowledge alert';
    return { success: false, error: msg };
  }
}
