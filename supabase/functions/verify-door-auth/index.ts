// Supabase Edge Function: verify-door-auth
// Invoked by the ESP32 microcontroller over Wi-Fi
// Deno TypeScript Runtime
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { playTrackDirect } from "../_shared/spotify.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-device-secret",
};

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const OTP_REGEX = /^\d{6}$/;

/**
 * Computes an HMAC-SHA256 hex digest matching issue-auth-session.
 */
async function computeOtpHmac(secret: string, message: string): Promise<string> {
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey(
    "raw",
    enc.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );
  const signature = await crypto.subtle.sign("HMAC", key, enc.encode(message));
  return Array.from(new Uint8Array(signature))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  if (req.method !== "POST") {
    return new Response(
      JSON.stringify({ verified: false, decision: "denied", reason: "Method not allowed" }),
      { status: 405, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }

  const nowIso = new Date().toISOString();

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL") ?? "";
    const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
    const doorDeviceSecret = Deno.env.get("DOOR_DEVICE_SECRET");
    const otpHmacSecret = Deno.env.get("OTP_HMAC_SECRET");

    // 1. Fail closed if critical environment secrets are missing (NO insecure fallback defaults!)
    if (!supabaseUrl || !supabaseServiceKey) {
      console.error("[verify-door-auth] Server configuration missing Supabase credentials");
      return new Response(
        JSON.stringify({ verified: false, decision: "denied", reason: "Server configuration error" }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    if (!doorDeviceSecret || doorDeviceSecret.trim().length === 0) {
      console.error("[verify-door-auth] Server configuration missing DOOR_DEVICE_SECRET");
      return new Response(
        JSON.stringify({ verified: false, decision: "denied", reason: "Server configuration error" }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    if (!otpHmacSecret || otpHmacSecret.trim().length === 0) {
      console.error("[verify-door-auth] Server configuration missing OTP_HMAC_SECRET");
      return new Response(
        JSON.stringify({ verified: false, decision: "denied", reason: "Server configuration error" }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const adminClient = createClient(supabaseUrl, supabaseServiceKey);

    // 2. Authenticate ESP32 Device Credential (Zero-Trust hardware authentication)
    const deviceSecretHeader = req.headers.get("x-device-secret");
    if (!deviceSecretHeader || deviceSecretHeader !== doorDeviceSecret) {
      console.warn("[verify-door-auth] Unauthorized door device verification attempt");
      return new Response(
        JSON.stringify({ verified: false, decision: "denied", reason: "Unauthorized door device" }),
        { status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // 3. Parse and validate request body
    let body: Record<string, unknown>;
    try {
      body = await req.json();
    } catch {
      return new Response(
        JSON.stringify({ verified: false, decision: "denied", reason: "Invalid JSON payload" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const { request_id, token, device_id } = body;

    // Validate request_id format
    if (typeof request_id !== "string" || !UUID_REGEX.test(request_id.trim())) {
      return new Response(
        JSON.stringify({ verified: false, decision: "denied", reason: "Invalid or missing request_id" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Validate 6-digit OTP token
    const tokenStr = typeof token === "number" ? token.toString() : typeof token === "string" ? token.trim() : "";
    if (!OTP_REGEX.test(tokenStr)) {
      return new Response(
        JSON.stringify({ verified: false, decision: "denied", reason: "Invalid OTP format: must be 6 digits" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const cleanDeviceId = typeof device_id === "string" && device_id.trim().length > 0
      ? device_id.trim().slice(0, 64)
      : "esp32_door_01";
    const cleanRequestId = request_id.trim();

    // 4. Calculate HMAC-SHA256 of the submitted OTP + request_id
    const tokenHmacHash = await computeOtpHmac(otpHmacSecret, tokenStr + cleanRequestId);

    // 5. Call the atomic PostgreSQL function consume_door_auth_session (strictly RETURNS UUID on success, NULL on failure)
    const { data: rpcData, error: rpcErr } = await adminClient.rpc("consume_door_auth_session", {
      p_request_id: cleanRequestId,
      p_otp_hash: tokenHmacHash,
    });

    if (rpcErr) {
      console.error("[verify-door-auth] Database error in consume_door_auth_session:", rpcErr.message);
      return new Response(
        JSON.stringify({ verified: false, decision: "denied", reason: "Database verification error" }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Strict validation: rpcData must be a valid UUID string
    const resolvedUserId: string | null = (typeof rpcData === "string" && UUID_REGEX.test(rpcData.trim()))
      ? rpcData.trim()
      : null;

    // 6. Handle atomic consumption failures (invalid, expired, replay, or unverified)
    if (!resolvedUserId) {
      // Perform forensic lookup on auth_sessions to determine specific failure cause
      const { data: sessionData, error: sessionErr } = await adminClient
        .from("auth_sessions")
        .select("user_id, expires_at, consumed_at, otp_hash")
        .eq("request_id", cleanRequestId)
        .maybeSingle();

      let failureReason = "Invalid authentication session";
      let isReplay = false;
      let failedUserId: string | null = null;
      let shouldLogIntrusionAlert = false;

      if (sessionErr) {
        console.error("[verify-door-auth] Error performing forensic session lookup:", sessionErr.message);
        failureReason = "Authentication session verification failed";
        // Do not misclassify a database query error as an intrusion alert
        shouldLogIntrusionAlert = false;
      } else if (sessionData) {
        failedUserId = sessionData.user_id;
        if (sessionData.otp_hash !== tokenHmacHash) {
          failureReason = "Invalid authentication token";
          shouldLogIntrusionAlert = true;
        } else if (sessionData.consumed_at !== null) {
          failureReason = "Replay detected: Token already consumed";
          isReplay = true;
          shouldLogIntrusionAlert = true;
        } else if (sessionData.expires_at && new Date(sessionData.expires_at) <= new Date()) {
          failureReason = "Authentication token expired";
          shouldLogIntrusionAlert = false;
        }
      } else {
        failureReason = "Invalid authentication session";
        shouldLogIntrusionAlert = true;
      }

      console.warn(`[verify-door-auth] Auth denied: ${failureReason} (req: ${cleanRequestId})`);

      // Record denied attempt in entry_logs
      const { data: entryLog, error: logErr } = await adminClient
        .from("entry_logs")
        .insert({
          id: crypto.randomUUID(),
          occurred_at: nowIso,
          user_id: failedUserId,
          device_id: cleanDeviceId,
          result: "failure",
          failure_reason: failureReason,
          request_id: cleanRequestId,
          created_at: nowIso,
        })
        .select("id")
        .single();

      if (logErr) {
        console.error("[verify-door-auth] Error recording failed entry_log:", logErr.message);
      }

      // Record security intrusion alert only when an active attack (replay or forged token) is detected
      if (shouldLogIntrusionAlert) {
        const { error: alertErr } = await adminClient.from("intrusion_alerts").insert({
          id: crypto.randomUUID(),
          entry_log_id: entryLog?.id ?? null,
          severity: isReplay ? "critical" : "high",
          message: `${failureReason} on device ${cleanDeviceId}`,
          notification_status: "pending",
          acknowledged_at: null,
          created_at: nowIso,
        });

        if (alertErr) {
          console.error("[verify-door-auth] Error recording intrusion_alert:", alertErr.message);
        }
      }

      return new Response(
        JSON.stringify({
          verified: false,
          decision: "denied",
          reason: failureReason,
        }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // 7. Verify that the associated profile exists and is enabled
    const { data: userProfile, error: profileErr } = await adminClient
      .from("profiles")
      .select("id, display_name, role, is_enabled, approval_status")
      .eq("id", resolvedUserId)
      .single();

    if (profileErr || !userProfile) {
      console.error("[verify-door-auth] Error finding user profile for verified session:", profileErr?.message);
      await adminClient.from("entry_logs").insert({
        id: crypto.randomUUID(),
        occurred_at: nowIso,
        user_id: resolvedUserId,
        device_id: cleanDeviceId,
        result: "failure",
        failure_reason: "Profile not found or inaccessible",
        request_id: cleanRequestId,
        created_at: nowIso,
      });

      return new Response(
        JSON.stringify({ verified: false, decision: "denied", reason: "Profile not found" }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    if (!userProfile.is_enabled || userProfile.approval_status !== "approved") {
      const failureReason = userProfile.approval_status === "pending"
        ? "Account awaiting administrator approval"
        : userProfile.approval_status === "rejected"
        ? "Account registration rejected"
        : "Account suspended by administrator";

      console.warn(`[verify-door-auth] Unapproved/disabled account attempted entry: ${userProfile.id} (${failureReason})`);
      await adminClient.from("entry_logs").insert({
        id: crypto.randomUUID(),
        occurred_at: nowIso,
        user_id: userProfile.id,
        device_id: cleanDeviceId,
        result: "failure",
        failure_reason: failureReason,
        request_id: cleanRequestId,
        created_at: nowIso,
      });

      return new Response(
        JSON.stringify({ verified: false, decision: "denied", reason: failureReason }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // 8. Log granted access
    const { error: logGrantErr } = await adminClient.from("entry_logs").insert({
      id: crypto.randomUUID(),
      occurred_at: nowIso,
      user_id: userProfile.id,
      device_id: cleanDeviceId,
      result: "success",
      failure_reason: null,
      request_id: cleanRequestId,
      created_at: nowIso,
    });

    if (logGrantErr) {
      console.error("[verify-door-auth] Error logging granted entry:", logGrantErr.message);
    }

    // 9. Fetch preferred Spotify soundtrack from user_music
    const { data: musicData, error: musicErr } = await adminClient
      .from("user_music")
      .select("spotify_uri")
      .eq("user_id", userProfile.id)
      .maybeSingle();

    if (musicErr) {
      console.warn("[verify-door-auth] Error querying user_music:", musicErr.message);
    }

    let musicTriggered = false;

    // 10. Direct Spotify playback via Spotify Web API (completely fail-safe, isolated from physical unlock)
    if (musicData?.spotify_uri && musicData.spotify_uri.startsWith("spotify:track:")) {
      try {
        console.log(`[verify-door-auth] Triggering direct Spotify playback for user: ${userProfile.id}`);
        const playbackRes = await playTrackDirect(adminClient, musicData.spotify_uri, {
          timeoutMs: 2500, // 2.5s bounded timeout ensures ESP32 unlock response is never delayed
        });
        musicTriggered = playbackRes.success;
        if (!playbackRes.success) {
          console.warn("[verify-door-auth] Direct Spotify playback not started:", playbackRes.error);
        } else {
          console.log(`[verify-door-auth] Direct Spotify playback initiated on: ${playbackRes.deviceName || playbackRes.deviceId}`);
        }
      } catch (playbackErr) {
        // Music failure or timeout must NEVER delay or prevent physical door access
        console.warn("[verify-door-auth] Non-fatal Spotify playback error or timeout:", playbackErr instanceof Error ? playbackErr.message : playbackErr);
        musicTriggered = false;
      }
    }

    // 11. Return explicit granted decision to ESP32
    return new Response(
      JSON.stringify({
        verified: true,
        decision: "granted",
        user_id: userProfile.id,
        display_name: userProfile.display_name || "Resident",
        spotify_uri: musicData?.spotify_uri || null,
        music_triggered: musicTriggered,
      }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (err: unknown) {
    console.error("[verify-door-auth] Unexpected server error:", err);
    // Never leak stack traces or internal secrets to ESP32
    return new Response(
      JSON.stringify({ verified: false, decision: "denied", reason: "Internal server error" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
