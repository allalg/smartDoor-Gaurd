// Supabase Edge Function: verify-door-auth
// Invoked by the ESP32 microcontroller over Wi-Fi
// Deno TypeScript Runtime
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-device-secret",
};

serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL") ?? "";
    const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
    const expectedDeviceSecret = Deno.env.get("DOOR_DEVICE_SECRET") ?? "esp32-door-default-secret";
    const iftttKey = Deno.env.get("IFTTT_WEBHOOK_KEY") ?? "";
    const iftttEvent = Deno.env.get("IFTTT_EVENT_NAME") ?? "door_entry_spotify";

    if (!supabaseUrl || !supabaseServiceKey) {
      return new Response(
        JSON.stringify({ verified: false, decision: "denied", reason: "Server configuration missing" }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const adminClient = createClient(supabaseUrl, supabaseServiceKey);

    // 1. Authenticate ESP32 Device Credential (Zero-Trust hardware check)
    const deviceSecretHeader = req.headers.get("x-device-secret");
    if (!deviceSecretHeader || deviceSecretHeader !== expectedDeviceSecret) {
      console.warn("Unauthorized device verification attempt");
      return new Response(
        JSON.stringify({ verified: false, decision: "denied", reason: "Unauthorized door device" }),
        { status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // 2. Parse request payload
    const body = await req.json().catch(() => ({}));
    const { request_id, token, device_id = "esp32_door_01" } = body;

    if (!request_id || !token) {
      return new Response(
        JSON.stringify({ verified: false, decision: "denied", reason: "Missing request_id or token" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // 3. Compute SHA-256 hash of provided token
    const encoder = new TextEncoder();
    const data = encoder.encode(token.toString() + request_id);
    const hashBuffer = await crypto.subtle.digest("SHA-256", data);
    const hashArray = Array.from(new Uint8Array(hashBuffer));
    const tokenHash = hashArray.map((b) => b.toString(16).padStart(2, "0")).join("");

    const nowIso = new Date().toISOString();

    // 4. Atomically find and consume matching session
    // Ensures single-use and protects against replay attacks
    const { data: sessionData, error: sessionErr } = await adminClient
      .from("auth_sessions")
      .select("id, user_id, expires_at, consumed_at")
      .eq("request_id", request_id)
      .eq("otp_hash", tokenHash)
      .maybeSingle();

    const isExpired = sessionData?.expires_at ? new Date(sessionData.expires_at) < new Date() : true;
    const isAlreadyConsumed = Boolean(sessionData?.consumed_at);

    if (sessionErr || !sessionData || isExpired || isAlreadyConsumed) {
      const failureReason = !sessionData
        ? "Invalid authentication token"
        : isAlreadyConsumed
        ? "Replay detected: Token already consumed"
        : "Authentication token expired";

      // 4a. Log failed attempt in entry_logs
      const { data: entryLog } = await adminClient
        .from("entry_logs")
        .insert({
          id: crypto.randomUUID(),
          occurred_at: nowIso,
          user_id: sessionData?.user_id ?? null,
          device_id: device_id,
          result: "denied",
          failure_reason: failureReason,
          request_id: request_id,
          created_at: nowIso,
        })
        .select()
        .single();

      // 4b. Record security intrusion alert
      await adminClient.from("intrusion_alerts").insert({
        id: crypto.randomUUID(),
        entry_log_id: entryLog?.id ?? null,
        severity: isAlreadyConsumed ? "critical" : "high",
        message: `${failureReason} on device ${device_id}`,
        notification_status: "pending",
        acknowledged_at: null,
        created_at: nowIso,
      });

      return new Response(
        JSON.stringify({
          verified: false,
          decision: "denied",
          reason: failureReason,
        }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // 5. Consume session atomically
    await adminClient
      .from("auth_sessions")
      .update({ consumed_at: nowIso })
      .eq("id", sessionData.id);

    // 6. Verify user status
    const { data: userProfile } = await adminClient
      .from("profiles")
      .select("id, display_name, role, is_enabled")
      .eq("id", sessionData.user_id)
      .single();

    if (!userProfile?.is_enabled) {
      await adminClient.from("entry_logs").insert({
        id: crypto.randomUUID(),
        occurred_at: nowIso,
        user_id: sessionData.user_id,
        device_id: device_id,
        result: "denied",
        failure_reason: "Account suspended by administrator",
        request_id: request_id,
        created_at: nowIso,
      });

      return new Response(
        JSON.stringify({
          verified: false,
          decision: "denied",
          reason: "User account suspended",
        }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // 7. Successful verification: Record in entry_logs
    await adminClient.from("entry_logs").insert({
      id: crypto.randomUUID(),
      occurred_at: nowIso,
      user_id: sessionData.user_id,
      device_id: device_id,
      result: "granted",
      failure_reason: null,
      request_id: request_id,
      created_at: nowIso,
    });

    // 8. Fetch user's preferred Spotify soundtrack from user_music
    const { data: musicData } = await adminClient
      .from("user_music")
      .select("spotify_uri")
      .eq("user_id", sessionData.user_id)
      .maybeSingle();

    let musicTriggered = false;

    // 9. Trigger Spotify playback via IFTTT webhook
    if (musicData?.spotify_uri && iftttKey) {
      try {
        const iftttUrl = `https://maker.ifttt.com/trigger/${iftttEvent}/with/key/${iftttKey}`;
        const iftttRes = await fetch(iftttUrl, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            value1: userProfile.display_name || "Resident",
            value2: musicData.spotify_uri,
            value3: device_id,
          }),
        });
        musicTriggered = iftttRes.ok;
      } catch (musicErr) {
        console.error("IFTTT webhook trigger error:", musicErr);
      }
    }

    // 10. Return access granted to ESP32
    return new Response(
      JSON.stringify({
        verified: true,
        decision: "granted",
        user_id: sessionData.user_id,
        display_name: userProfile.display_name || "Resident",
        spotify_uri: musicData?.spotify_uri || null,
        music_triggered: musicTriggered,
      }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Internal server error";
    return new Response(
      JSON.stringify({ verified: false, decision: "denied", reason: message }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
