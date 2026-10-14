import { supabase, isSupabaseConfigured } from '@/lib/supabase';
import type { EntryLog } from '@/types/database';

export async function fetchUserAccessLogs(
  userId: string,
  limit = 20
): Promise<{ logs: EntryLog[]; error: string | null }> {
  if (!isSupabaseConfigured) {
    return { logs: [], error: 'Supabase credentials not configured' };
  }

  try {
    const { data, error } = await supabase
      .from('entry_logs')
      .select('id, occurred_at, user_id, device_id, result, failure_reason, request_id, created_at')
      .eq('user_id', userId)
      .order('occurred_at', { ascending: false })
      .limit(limit);

    if (error) {
      return { logs: [], error: error.message };
    }

    return { logs: (data as EntryLog[]) || [], error: null };
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : 'Failed to fetch access logs';
    return { logs: [], error: msg };
  }
}

export async function fetchAllAccessLogs(
  limit = 100
): Promise<{ logs: EntryLog[]; error: string | null }> {
  if (!isSupabaseConfigured) {
    return { logs: [], error: 'Supabase credentials not configured' };
  }

  // 1. Try secure admin-actions Edge Function
  try {
    const { data: fnData, error: fnError } = await supabase.functions.invoke<{
      success: boolean;
      logs?: EntryLog[];
      error?: string;
    }>('admin-actions', {
      body: { action: 'list_access_logs', limit },
    });

    if (!fnError && fnData?.success && Array.isArray(fnData.logs)) {
      return { logs: fnData.logs, error: null };
    }
  } catch (fnErr) {
    console.warn('[access-history] admin-actions list_access_logs failed, falling back to direct query:', fnErr);
  }

  // 2. Direct client database query with separate profile hydration
  try {
    const { data, error } = await supabase
      .from('entry_logs')
      .select('id, occurred_at, user_id, device_id, result, failure_reason, request_id, created_at')
      .order('occurred_at', { ascending: false })
      .limit(limit);

    if (error) {
      return { logs: [], error: error.message };
    }

    const rawLogs = (data as EntryLog[]) || [];
    const userIds = Array.from(new Set(rawLogs.map((l) => l.user_id).filter(Boolean))) as string[];

    if (userIds.length > 0) {
      const { data: profiles } = await supabase
        .from('profiles')
        .select('id, display_name, role')
        .in('id', userIds);

      if (profiles && profiles.length > 0) {
        const profileMap = new Map(profiles.map((p) => [p.id, p]));
        const hydratedLogs = rawLogs.map((log) => ({
          ...log,
          profile: log.user_id ? profileMap.get(log.user_id) || null : null,
        }));
        return { logs: hydratedLogs, error: null };
      }
    }

    return { logs: rawLogs, error: null };
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : 'Failed to fetch admin access logs';
    return { logs: [], error: msg };
  }
}
