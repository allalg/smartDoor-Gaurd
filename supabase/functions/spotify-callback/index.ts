import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "npm:@supabase/supabase-js@2.48.1";

function renderHtml(title: string, message: string): Response {
  const html = `<!doctype html>
  <html>
    <head>
      <meta name="viewport" content="width=device-width, initial-scale=1">
      <title>SmartDoor Guard — Spotify</title>
    </head>
    <body style="font-family:system-ui;max-width:600px;margin:60px auto;padding:24px">
      <h2>${title}</h2>
      <p>${message}</p>
      <p>You can close this page.</p>
    </body>
  </html>`;
  return new Response(html, {
    status: title.includes("Error") || title.includes("connection") ? (title.includes("successful") ? 200 : 400) : 200,
    headers: { "Content-Type": "text/html; charset=utf-8" },
  });
}

serve(async (req: Request) => {
  const url = new URL(req.url);
  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");
  const error = url.searchParams.get("error");

  if (error) {
    return renderHtml("Spotify authorization error", `Spotify returned error: ${error}`);
  }

  if (!code || !state) {
    return renderHtml("Spotify connection", "Missing authorization code or state.");
  }

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL") ?? "";
    const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
    const clientId = Deno.env.get("SPOTIFY_CLIENT_ID") ?? "";
    const clientSecret = Deno.env.get("SPOTIFY_CLIENT_SECRET") ?? "";
    const redirectUri = Deno.env.get("SPOTIFY_REDIRECT_URI") ?? "";

    const adminClient = createClient(supabaseUrl, supabaseServiceKey);

    // 1. Verify state token from database and ensure it hasn't expired
    const { data: stateData, error: stateErr } = await adminClient
      .from("spotify_oauth_states")
      .select("state_token, expires_at")
      .eq("state_token", state)
      .maybeSingle();

    if (stateErr || !stateData) {
      return renderHtml("Invalid state", "The OAuth state was invalid or has already been used.");
    }

    // Check expiration
    if (new Date(stateData.expires_at) < new Date()) {
      await adminClient.from("spotify_oauth_states").delete().eq("state_token", state);
      return renderHtml("State expired", "The OAuth state has expired. Please try connecting again.");
    }

    // Delete state token to prevent replay
    await adminClient.from("spotify_oauth_states").delete().eq("state_token", state);

    // 2. Exchange code for access & refresh token
    const basicAuth = btoa(`${clientId}:${clientSecret}`);
    const bodyParams = new URLSearchParams({
      grant_type: "authorization_code",
      code,
      redirect_uri: redirectUri,
    });

    const tokenRes = await fetch("https://accounts.spotify.com/api/token", {
      method: "POST",
      headers: {
        "Authorization": `Basic ${basicAuth}`,
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: bodyParams.toString(),
    });

    if (!tokenRes.ok) {
      const errBody = await tokenRes.text().catch(() => "");
      return renderHtml("Token exchange failed", `Spotify token exchange rejected with status ${tokenRes.status}`);
    }

    const tokenJson = await tokenRes.json();
    const refreshToken = tokenJson.refresh_token;
    const scope = tokenJson.scope;

    if (!refreshToken) {
      return renderHtml("Missing refresh token", "Spotify did not return a refresh token.");
    }

    // 3. Optionally fetch Spotify profile to get user ID
    let spotifyUserId: string | null = null;
    if (tokenJson.access_token) {
      try {
        const userRes = await fetch("https://api.spotify.com/v1/me", {
          headers: { "Authorization": `Bearer ${tokenJson.access_token}` },
        });
        if (userRes.ok) {
          const userData = await userRes.json();
          spotifyUserId = userData.id || null;
        }
      } catch {
        // non-fatal
      }
    }

    // 4. Save to spotify_shared_account (dynamically preserves existing row id, whether numeric 1 or text)
    const { data: existingAccount } = await adminClient
      .from("spotify_shared_account")
      .select("id")
      .limit(1)
      .maybeSingle();

    const targetId = existingAccount ? existingAccount.id : 1;

    const { error: upsertErr } = await adminClient
      .from("spotify_shared_account")
      .upsert({
        id: targetId,
        refresh_token: refreshToken,
        scope: scope || null,
        spotify_user_id: spotifyUserId,
        updated_at: new Date().toISOString(),
      });

    if (upsertErr) {
      return renderHtml("Database error", "Failed to save the Spotify refresh token to database.");
    }

    return renderHtml("Spotify connection successful!", "Your Spotify shared account is now linked. Entry music playback is ready.");
  } catch (err: unknown) {
    return renderHtml("Internal error", err instanceof Error ? err.message : "An unexpected error occurred.");
  }
});
