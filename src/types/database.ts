export type UserRole = 'user' | 'admin';

export interface Profile {
  id: string; // references auth.users.id
  display_name: string | null;
  role: UserRole;
  is_enabled: boolean;
  created_at: string;
}

export interface UserMusic {
  user_id: string; // references auth.users.id
  spotify_uri: string | null;
  updated_at: string;
}

export interface AuthSession {
  id: string;
  request_id: string;
  user_id: string;
  otp_hash: string;
  expires_at: string;
  consumed_at: string | null;
  created_at: string;
}

export type EntryResult = 'granted' | 'denied' | 'pending' | 'timeout';

export interface EntryLog {
  id: string;
  occurred_at: string;
  user_id: string | null;
  device_id: string;
  result: EntryResult;
  failure_reason: string | null;
  request_id: string | null;
  created_at: string;
  // Joined profile for display in admin/logs
  profile?: Profile | null;
}

export type AlertSeverity = 'low' | 'medium' | 'high' | 'critical';
export type NotificationStatus = 'pending' | 'sent' | 'failed' | 'acknowledged';

export interface IntrusionAlert {
  id: string;
  entry_log_id: string | null;
  severity: AlertSeverity;
  message: string;
  notification_status: NotificationStatus;
  acknowledged_at: string | null;
  created_at: string;
  // Joined entry log for alert details
  entry_log?: EntryLog | null;
}

// Edge Function payload contracts
export interface IssueAuthSessionResponse {
  success: boolean;
  request_id: string;
  token: string; // The single-use OTP or auth token issued to device
  expires_in_seconds: number;
  user_display_name?: string;
  error?: string;
}

export interface VerifyDoorAuthRequest {
  request_id: string;
  token: string;
  device_id: string;
  device_signature?: string;
}

export interface VerifyDoorAuthResponse {
  verified: boolean;
  decision: 'granted' | 'denied';
  user_id?: string;
  display_name?: string;
  spotify_uri?: string | null;
  music_triggered?: boolean;
  reason?: string;
}
