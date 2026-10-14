// Supabase Edge Function: report-presence-alert
// Called by ESP32 firmware when the IR sensor detects continuous
// presence at the door for more than 60 seconds.
// Deno TypeScript Runtime
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-device-secret",
};

serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  if (req.method !== "POST") {
    return new Response(
      JSON.stringify({ success: false, error: "Method not allowed" }),
      {
        status: 405,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      }
    );
  }

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL") ?? "";
    const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
    const doorDeviceSecret = Deno.env.get("DOOR_DEVICE_SECRET");

    // 1. Fail closed if critical secrets are missing
    if (!supabaseUrl || !supabaseServiceKey) {
      console.error(
        "[report-presence-alert] Server configuration missing Supabase credentials"
      );
      return new Response(
        JSON.stringify({
          success: false,
          error: "Server configuration error",
        }),
        {
          status: 500,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        }
      );
    }

    if (!doorDeviceSecret || doorDeviceSecret.trim().length === 0) {
      console.error(
        "[report-presence-alert] Server configuration missing DOOR_DEVICE_SECRET"
      );
      return new Response(
        JSON.stringify({
          success: false,
          error: "Server configuration error",
        }),
        {
          status: 500,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        }
      );
    }

    // 2. Authenticate the ESP32 device (reuses existing DOOR_DEVICE_SECRET pattern)
    const deviceSecretHeader = req.headers.get("x-device-secret");
    if (!deviceSecretHeader || deviceSecretHeader !== doorDeviceSecret) {
      console.warn(
        "[report-presence-alert] Unauthorized device presence report attempt"
      );
      return new Response(
        JSON.stringify({ success: false, error: "Unauthorized device" }),
        {
          status: 403,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        }
      );
    }

    // 3. Parse and validate request body
    let body: Record<string, unknown>;
    try {
      body = await req.json();
    } catch {
      return new Response(
        JSON.stringify({ success: false, error: "Invalid JSON payload" }),
        {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        }
      );
    }

    const { device_id, duration_seconds } = body;

    if (
      typeof device_id !== "string" ||
      device_id.trim().length === 0 ||
      device_id.length > 64
    ) {
      return new Response(
        JSON.stringify({
          success: false,
          error: "Invalid or missing device_id",
        }),
        {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        }
      );
    }

    if (
      typeof duration_seconds !== "number" ||
      duration_seconds < 60 ||
      duration_seconds > 86400
    ) {
      return new Response(
        JSON.stringify({
          success: false,
          error: "Invalid duration_seconds (must be 60–86400)",
        }),
        {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        }
      );
    }

    const cleanDeviceId = device_id.trim().slice(0, 64);
    const adminClient = createClient(supabaseUrl, supabaseServiceKey);

    // 4. Deduplication: reject if a prolonged_presence alert was already created
    //    for this device within the last 120 seconds (prevents duplicates from
    //    firmware retries or connectivity hiccups).
    const dedupeWindow = new Date(Date.now() - 120_000).toISOString();
    const { data: recentAlert, error: dedupeErr } = await adminClient
      .from("intrusion_alerts")
      .select("id, created_at")
      .eq("device_id", cleanDeviceId)
      .eq("alert_type", "prolonged_presence")
      .gte("created_at", dedupeWindow)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (dedupeErr) {
      console.error(
        "[report-presence-alert] Deduplication query error:",
        dedupeErr.message
      );
      // Proceed rather than miss a real alert
    }

    if (recentAlert) {
      console.log(
        `[report-presence-alert] Duplicate suppressed for ${cleanDeviceId} (existing: ${recentAlert.id})`
      );
      return new Response(
        JSON.stringify({
          success: true,
          duplicate: true,
          existing_alert_id: recentAlert.id,
        }),
        {
          status: 200,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        }
      );
    }

    // 5. Determine severity based on presence duration
    const severity =
      duration_seconds >= 300
        ? "critical"
        : duration_seconds >= 120
          ? "high"
          : "medium";

    // 6. Insert the alert using server-side timestamp
    const nowIso = new Date().toISOString();
    const { data: insertedAlert, error: insertErr } = await adminClient
      .from("intrusion_alerts")
      .insert({
        id: crypto.randomUUID(),
        entry_log_id: null, // No associated auth attempt
        severity,
        message: `Prolonged presence detected at ${cleanDeviceId} for ${Math.round(duration_seconds)}s`,
        notification_status: "pending",
        acknowledged_at: null,
        alert_type: "prolonged_presence",
        device_id: cleanDeviceId,
        duration_seconds: Math.round(duration_seconds),
        created_at: nowIso,
      })
      .select("id")
      .single();

    if (insertErr) {
      console.error(
        "[report-presence-alert] Insert error:",
        insertErr.message
      );
      return new Response(
        JSON.stringify({ success: false, error: "Failed to record alert" }),
        {
          status: 500,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        }
      );
    }

    console.log(
      `[report-presence-alert] Alert created: ${insertedAlert.id} for ${cleanDeviceId} (${Math.round(duration_seconds)}s, severity: ${severity})`
    );

    return new Response(
      JSON.stringify({ success: true, alert_id: insertedAlert.id }),
      {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      }
    );
  } catch (err: unknown) {
    console.error("[report-presence-alert] Unexpected server error:", err);
    return new Response(
      JSON.stringify({ success: false, error: "Internal server error" }),
      {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      }
    );
  }
});
