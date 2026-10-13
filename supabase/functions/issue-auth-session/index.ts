// Supabase Edge Function: issue-auth-session
// Deno TypeScript Runtime
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

/**
 * Computes an HMAC-SHA256 hex digest for a given message using a server secret.
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
      JSON.stringify({ success: false, error: "Method not allowed" }),
      { status: 405, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL") ?? "";
    const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
    const supabaseAnonKey = Deno.env.get("SUPABASE_ANON_KEY") ?? "";
    const otpHmacSecret = Deno.env.get("OTP_HMAC_SECRET");

    // Fail closed if critical environment variables are missing
    if (!supabaseUrl || !supabaseServiceKey || !supabaseAnonKey) {
      console.error("[issue-auth-session] Server configuration missing Supabase credentials");
      return new Response(
        JSON.stringify({ success: false, error: "Internal server error" }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    if (!otpHmacSecret || otpHmacSecret.trim().length === 0) {
      console.error("[issue-auth-session] Server configuration missing OTP_HMAC_SECRET");
      return new Response(
        JSON.stringify({ success: false, error: "Internal server error" }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // 1. Authenticate caller from Authorization Bearer token (Zero-Trust)
    const authHeader = req.headers.get("Authorization");
    if (!authHeader || !authHeader.startsWith("Bearer ")) {
      return new Response(
        JSON.stringify({ success: false, error: "Missing or invalid authorization header" }),
        { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const token = authHeader.replace("Bearer ", "").trim();
    const userClient = createClient(supabaseUrl, supabaseAnonKey, {
      global: { headers: { Authorization: `Bearer ${token}` } },
    });

    const { data: { user }, error: userError } = await userClient.auth.getUser();
    if (userError || !user) {
      console.warn("[issue-auth-session] User authentication failed:", userError?.message);
      return new Response(
        JSON.stringify({ success: false, error: "Invalid or expired user session" }),
        { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Service-role admin client for database validation and session creation
    const adminClient = createClient(supabaseUrl, supabaseServiceKey);

    // 2. Verify caller profile and account status — fail closed on any DB error
    const { data: profile, error: profileErr } = await adminClient
      .from("profiles")
      .select("id, display_name, role, is_enabled, approval_status")
      .eq("id", user.id)
      .single();

    if (profileErr) {
      console.error("[issue-auth-session] Database error reading profile for user", user.id, profileErr.message);
      return new Response(
        JSON.stringify({ success: false, error: "Failed to verify account permissions" }),
        { status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    if (!profile) {
      console.warn("[issue-auth-session] Profile record not found for user", user.id);
      return new Response(
        JSON.stringify({ success: false, error: "User profile record not found" }),
        { status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    if (!profile.is_enabled || profile.approval_status !== "approved") {
      console.warn("[issue-auth-session] Unauthorized access attempt by user", user.id, "status:", profile.approval_status, "enabled:", profile.is_enabled);
      const errorMsg = profile.approval_status === "pending"
        ? "Your account is awaiting administrator approval."
        : profile.approval_status === "rejected"
        ? "Your account registration was not approved."
        : "User door access privileges are suspended.";

      return new Response(
        JSON.stringify({ success: false, error: errorMsg }),
        { status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // 3. Generate a cryptographically secure 6-digit OTP (100000 - 999999)
    const randomBuffer = new Uint32Array(1);
    crypto.getRandomValues(randomBuffer);
    const otpValue = 100000 + (randomBuffer[0] % 900000);
    const otpString = otpValue.toString();
    const requestId = crypto.randomUUID();

    // 4. Calculate HMAC-SHA256 using server-side secret
    const otpHmacHash = await computeOtpHmac(otpHmacSecret, otpString + requestId);

    // 60-second TTL
    const expiresAt = new Date(Date.now() + 60 * 1000).toISOString();

    // 5. Store session in auth_sessions table
    const { error: insertErr } = await adminClient.from("auth_sessions").insert({
      id: crypto.randomUUID(),
      request_id: requestId,
      user_id: user.id,
      otp_hash: otpHmacHash,
      expires_at: expiresAt,
      consumed_at: null,
    });

    if (insertErr) {
      console.error("[issue-auth-session] Database error storing auth_session:", insertErr.message);
      return new Response(
        JSON.stringify({ success: false, error: "Failed to initialize door session" }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // 6. Return response preserving required frontend contract
    return new Response(
      JSON.stringify({
        success: true,
        request_id: requestId,
        token: otpString,
        expires_in_seconds: 60,
        user_display_name: profile.display_name,
      }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (err: unknown) {
    console.error("[issue-auth-session] Unexpected error:", err);
    return new Response(
      JSON.stringify({ success: false, error: "Internal server error" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
