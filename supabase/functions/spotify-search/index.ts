import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "npm:@supabase/supabase-js@2.48.1";
import { searchSpotifyTracks, getSpotifyTrackDetails } from "../_shared/spotify.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
};

serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL") ?? "";
    const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
    const supabaseAnonKey = Deno.env.get("SUPABASE_ANON_KEY") ?? "";

    if (!supabaseUrl || !supabaseServiceKey) {
      return new Response(
        JSON.stringify({ error: "Server configuration missing Supabase credentials" }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // 1. Authenticate the caller using Supabase Auth JWT
    const authHeader = req.headers.get("Authorization");
    if (!authHeader || !authHeader.startsWith("Bearer ")) {
      return new Response(
        JSON.stringify({ error: "Missing or invalid authorization header" }),
        { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const token = authHeader.replace("Bearer ", "").trim();
    const authClient = createClient(supabaseUrl, supabaseAnonKey || supabaseServiceKey, {
      auth: { persistSession: false },
    });

    const { data: { user }, error: authError } = await authClient.auth.getUser(token);
    if (authError || !user) {
      return new Response(
        JSON.stringify({ error: "Unauthorized caller" }),
        { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // 2. Parse request payload
    let query = "";
    let trackIdentifier = "";

    const url = new URL(req.url);
    if (url.searchParams.has("uri")) trackIdentifier = url.searchParams.get("uri") || "";
    if (url.searchParams.has("track_id")) trackIdentifier = url.searchParams.get("track_id") || "";
    if (url.searchParams.has("q")) query = url.searchParams.get("q") || "";

    if (req.method === "POST") {
      try {
        const body = await req.json();
        if (body.uri) trackIdentifier = body.uri;
        if (body.track_id) trackIdentifier = body.track_id;
        if (body.q || body.query) query = body.q || body.query;
      } catch {
        // ignore JSON parse error
      }
    }

    const adminClient = createClient(supabaseUrl, supabaseServiceKey, {
      auth: { persistSession: false },
    });

    // 3. Handle single track metadata lookup (e.g. for legacy records or manual URI entry)
    if (trackIdentifier && trackIdentifier.trim().length > 0) {
      const detailsResult = await getSpotifyTrackDetails(adminClient, trackIdentifier.trim());
      if ("error" in detailsResult) {
        console.warn("[spotify-search] Track details error:", detailsResult.error);
        return new Response(
          JSON.stringify({ error: detailsResult.error, track: null }),
          { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      return new Response(
        JSON.stringify({ track: detailsResult.track, tracks: [detailsResult.track] }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // 4. Handle catalog search
    if (!query || query.trim().length === 0) {
      return new Response(
        JSON.stringify({ tracks: [] }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Check if query is actually a direct track URI or ID
    if (query.trim().startsWith("spotify:track:") || query.trim().includes("open.spotify.com/track/")) {
      const detailsResult = await getSpotifyTrackDetails(adminClient, query.trim());
      if (!("error" in detailsResult)) {
        return new Response(
          JSON.stringify({ track: detailsResult.track, tracks: [detailsResult.track] }),
          { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }
    }

    const result = await searchSpotifyTracks(adminClient, query.trim(), 10);
    if ("error" in result) {
      console.warn("[spotify-search] Search error:", result.error);
      return new Response(
        JSON.stringify({ error: result.error, tracks: [] }),
        { status: 502, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    return new Response(
      JSON.stringify({ tracks: result.tracks }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (err: unknown) {
    console.error("[spotify-search] Unexpected error:", err);
    return new Response(
      JSON.stringify({ error: "Internal server error" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
