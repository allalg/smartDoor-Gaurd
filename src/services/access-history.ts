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

  try {
    // Attempt join on profiles if foreign key exists, fallback to raw select
    const { data, error } = await supabase
      .from('entry_logs')
      .select(`
        id, occurred_at, user_id, device_id, result, failure_reason, request_id, created_at,
        profile:profiles(id, display_name, role)
      `)
      .order('occurred_at', { ascending: false })
      .limit(limit);

    if (error) {
      // Fallback without join in case relation alias differs
      const fallback = await supabase
        .from('entry_logs')
        .select('id, occurred_at, user_id, device_id, result, failure_reason, request_id, created_at')
        .order('occurred_at', { ascending: false })
        .limit(limit);

      if (fallback.error) {
        return { logs: [], error: fallback.error.message };
      }
      return { logs: (fallback.data as EntryLog[]) || [], error: null };
    }

    return { logs: (data as unknown as EntryLog[]) || [], error: null };
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : 'Failed to fetch admin access logs';
    return { logs: [], error: msg };
  }
}
