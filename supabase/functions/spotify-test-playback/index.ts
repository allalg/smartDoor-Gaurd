import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "npm:@supabase/supabase-js@2.48.1";
import { playTrackDirect } from "../_shared/spotify.ts";

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

    const body = await req.json().catch(() => ({}));
    let trackUri = body.uri || body.track_uri || body.spotify_uri || "";
    const preferredDevice = body.deviceName || body.device_name;

    // Normalize URL if someone passed https://open.spotify.com/track/ID
    if (trackUri.includes("open.spotify.com/track/")) {
      const match = trackUri.match(/track\/([a-zA-Z0-9]+)/);
      if (match) {
        trackUri = `spotify:track:${match[1]}`;
      }
    }

    if (!trackUri) {
      return new Response(
        JSON.stringify({ error: "Missing required 'uri' field (e.g. 'spotify:track:4cOdK2wGLETKBW3PvgPWqT')" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL") ?? "";
    const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
    const adminClient = createClient(supabaseUrl, supabaseServiceKey);

    const playbackResult = await playTrackDirect(adminClient, trackUri, {
      preferredDeviceName: preferredDevice,
      timeoutMs: 4000,
    });

    return new Response(
      JSON.stringify(playbackResult),
      {
        status: playbackResult.success ? 200 : 502,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      }
    );
  } catch (err: unknown) {
    return new Response(
      JSON.stringify({ error: err instanceof Error ? err.message : "Internal error" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
