import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "npm:@supabase/supabase-js@2.48.1";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-setup-secret",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: corsHeaders });
  }

  if (req.method !== "POST") {
    return new Response("Method not allowed", { status: 405, headers: corsHeaders });
  }

  try {
    const setupSecret = Deno.env.get("SPOTIFY_SETUP_SECRET");
    const incomingSecret = req.headers.get("x-setup-secret") || req.headers.get("authorization")?.replace("Bearer ", "");

    if (!setupSecret || incomingSecret !== setupSecret) {
      return new Response(
        JSON.stringify({ error: "Unauthorized" }),
        { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const clientId = Deno.env.get("SPOTIFY_CLIENT_ID");
    const redirectUri = Deno.env.get("SPOTIFY_REDIRECT_URI");
    const supabaseUrl = Deno.env.get("SUPABASE_URL") ?? "";
    const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";

    if (!clientId || !redirectUri || !supabaseUrl || !supabaseServiceKey) {
      return new Response(
        JSON.stringify({ error: "Server missing Spotify or Supabase credentials" }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Generate random state token
    const stateToken = crypto.randomUUID();
    const expiresAt = new Date(Date.now() + 10 * 60 * 1000).toISOString();

    const adminClient = createClient(supabaseUrl, supabaseServiceKey);
    const { error: stateError } = await adminClient.from("spotify_oauth_states").insert({
      state_token: stateToken,
      expires_at: expiresAt,
    });

    if (stateError) {
      return new Response(
        JSON.stringify({ error: "Failed to persist OAuth state" }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const scope = [
      "user-read-playback-state",
      "user-modify-playback-state",
      "user-read-currently-playing",
    ].join(" ");

    const params = new URLSearchParams({
      response_type: "code",
      client_id: clientId,
      scope,
      redirect_uri: redirectUri,
      state: stateToken,
    });

    const authUrl = `https://accounts.spotify.com/authorize?${params.toString()}`;

    return new Response(
      JSON.stringify({ authUrl, stateToken }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (err: unknown) {
    return new Response(
      JSON.stringify({ error: err instanceof Error ? err.message : "Internal error" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
