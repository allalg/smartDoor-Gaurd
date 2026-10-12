// Supabase Edge Function: issue-auth-session
// Deno TypeScript Runtime
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL") ?? "";
    const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
    const supabaseAnonKey = Deno.env.get("SUPABASE_ANON_KEY") ?? "";

    if (!supabaseUrl || !supabaseServiceKey) {
      return new Response(
        JSON.stringify({ success: false, error: "Server configuration missing" }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // 1. Authenticate caller from Authorization Bearer token (Zero-Trust)
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) {
      return new Response(
        JSON.stringify({ success: false, error: "Missing authorization token" }),
        { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const token = authHeader.replace("Bearer ", "");
    const userClient = createClient(supabaseUrl, supabaseAnonKey, {
      global: { headers: { Authorization: `Bearer ${token}` } },
    });

    const { data: { user }, error: userError } = await userClient.auth.getUser();
    if (userError || !user) {
      return new Response(
        JSON.stringify({ success: false, error: "Invalid or expired user session" }),
        { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Use admin client with service role for secure database queries
    const adminClient = createClient(supabaseUrl, supabaseServiceKey);

    // 2. Verify user account status and profile
    const { data: profile, error: profileErr } = await adminClient
      .from("profiles")
      .select("id, display_name, role, is_enabled")
      .eq("id", user.id)
      .single();

    if (profileErr || !profile) {
      return new Response(
        JSON.stringify({ success: false, error: "User profile record not found" }),
        { status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    if (!profile.is_enabled) {
      return new Response(
        JSON.stringify({ success: false, error: "User door access privileges are suspended" }),
        { status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // 3. Generate short-lived single-use OTP (6-digit cryptographically random)
    const rawOtp = crypto.getRandomValues(new Uint32Array(1))[0] % 900000 + 100000;
    const otpString = rawOtp.toString();
    const requestId = crypto.randomUUID();

    // 4. Hash the OTP with SHA-256 for secure database storage
    const encoder = new TextEncoder();
    const data = encoder.encode(otpString + requestId);
    const hashBuffer = await crypto.subtle.digest("SHA-256", data);
    const hashArray = Array.from(new Uint8Array(hashBuffer));
    const otpHash = hashArray.map((b) => b.toString(16).padStart(2, "0")).join("");

    // Expiry: 60 seconds from now
    const expiresAt = new Date(Date.now() + 60 * 1000).toISOString();

    // 5. Store session in auth_sessions table
    const { error: insertErr } = await adminClient.from("auth_sessions").insert({
      id: crypto.randomUUID(),
      request_id: requestId,
      user_id: user.id,
      otp_hash: otpHash,
      expires_at: expiresAt,
      consumed_at: null,
    });

    if (insertErr) {
      console.error("Failed to store auth_session:", insertErr);
      return new Response(
        JSON.stringify({ success: false, error: "Database error creating session" }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // 6. Return response to client
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
    const message = err instanceof Error ? err.message : "Internal server error";
    return new Response(
      JSON.stringify({ success: false, error: message }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
