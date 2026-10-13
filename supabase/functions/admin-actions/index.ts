// Supabase Edge Function: admin-actions
// Performs server-authorized administrative operations
// Deno TypeScript Runtime
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const allowedOrigins = new Set([
  "http://localhost:5173",
  "http://localhost:4173",
  "http://localhost:3000",
  Deno.env.get("FRONTEND_ORIGIN") ?? "",
].filter(Boolean));

function getCorsHeaders(req: Request): Record<string, string> {
  const origin = req.headers.get("Origin") || "*";

  return {
    "Access-Control-Allow-Origin": origin,
    "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Vary": "Origin",
  };
}

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const ALLOWED_ROLES = ["user", "admin"] as const;

serve(async (req: Request) => {
  const corsHeaders = getCorsHeaders(req);

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

    if (!supabaseUrl || !supabaseServiceKey || !supabaseAnonKey) {
      console.error("[admin-actions] Server configuration missing Supabase credentials");
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
      console.warn("[admin-actions] Authentication error:", userError?.message);
      return new Response(
        JSON.stringify({ success: false, error: "Invalid or expired credentials" }),
        { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const adminClient = createClient(supabaseUrl, supabaseServiceKey);

    // 2. Enforce admin role and enabled account status on backend
    const { data: callerProfile, error: callerErr } = await adminClient
      .from("profiles")
      .select("id, role, is_enabled, approval_status")
      .eq("id", user.id)
      .single();

    if (callerErr || !callerProfile) {
      console.error("[admin-actions] Database error verifying caller profile:", callerErr?.message);
      return new Response(
        JSON.stringify({ success: false, error: "Failed to verify caller authorization" }),
        { status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    if (!callerProfile.is_enabled || (callerProfile.approval_status && callerProfile.approval_status !== "approved")) {
      console.warn("[admin-actions] Disabled or unapproved user attempted admin action:", user.id);
      return new Response(
        JSON.stringify({ success: false, error: "Account access is suspended or awaiting approval" }),
        { status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    if (callerProfile.role !== "admin") {
      console.warn("[admin-actions] Non-admin user attempted admin action:", user.id);
      return new Response(
        JSON.stringify({ success: false, error: "Forbidden: Administrator role required" }),
        { status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // 3. Parse and validate JSON request body
    let body: Record<string, unknown>;
    try {
      body = await req.json();
    } catch {
      return new Response(
        JSON.stringify({ success: false, error: "Invalid JSON request payload" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const { action } = body;
    if (typeof action !== "string") {
      return new Response(
        JSON.stringify({ success: false, error: "Missing or invalid action field" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    switch (action) {
      case "list_users": {
        // Enforced: Caller is already verified as an active, approved administrator
        const { data: users, error: usersErr } = await adminClient
          .from("profiles")
          .select("id, display_name, role, is_enabled, approval_status, created_at")
          .order("created_at", { ascending: false });

        if (usersErr) {
          console.error("[admin-actions] Error fetching users:", usersErr.message);
          return new Response(
            JSON.stringify({ success: false, error: "Database error fetching user directory" }),
            { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
          );
        }

        return new Response(
          JSON.stringify({ success: true, users: users || [] }),
          { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      case "update_user_role": {
        const { targetUserId, newRole } = body;

        if (typeof targetUserId !== "string" || !UUID_REGEX.test(targetUserId.trim())) {
          return new Response(
            JSON.stringify({ success: false, error: "Invalid or missing targetUserId UUID" }),
            { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
          );
        }

        if (typeof newRole !== "string" || !ALLOWED_ROLES.includes(newRole as (typeof ALLOWED_ROLES)[number])) {
          return new Response(
            JSON.stringify({ success: false, error: "Invalid role: must be 'user' or 'admin'" }),
            { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
          );
        }

        const cleanTargetId = targetUserId.trim();

        // Prevent self-demotion
        if (cleanTargetId === user.id && newRole !== "admin") {
          return new Response(
            JSON.stringify({ success: false, error: "Administrators cannot demote their own account" }),
            { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
          );
        }

        // Call atomic RPC with row locking for last-admin protection
        const { data: rpcData, error: rpcErr } = await adminClient.rpc("admin_update_user", {
          p_caller_id: user.id,
          p_target_id: cleanTargetId,
          p_new_role: newRole,
        });

        if (rpcErr) {
          console.error("[admin-actions] Error in admin_update_user RPC:", rpcErr.message);
          return new Response(
            JSON.stringify({ success: false, error: "Database error updating user role" }),
            { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
          );
        }

        const rpcResult = Array.isArray(rpcData) ? rpcData[0] : rpcData;
        if (!rpcResult?.success) {
          return new Response(
            JSON.stringify({ success: false, error: rpcResult?.message || "Failed to update role" }),
            { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
          );
        }

        return new Response(
          JSON.stringify({ success: true, message: `Updated user role to ${newRole}` }),
          { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      case "toggle_user_status": {
        const { targetUserId, newStatus } = body;

        if (typeof targetUserId !== "string" || !UUID_REGEX.test(targetUserId.trim())) {
          return new Response(
            JSON.stringify({ success: false, error: "Invalid or missing targetUserId UUID" }),
            { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
          );
        }

        if (typeof newStatus !== "boolean") {
          return new Response(
            JSON.stringify({ success: false, error: "Missing or invalid newStatus (boolean required)" }),
            { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
          );
        }

        const cleanTargetId = targetUserId.trim();

        // Prevent self-disabling
        if (cleanTargetId === user.id && newStatus === false) {
          return new Response(
            JSON.stringify({ success: false, error: "Administrators cannot disable their own account" }),
            { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
          );
        }

        // Call atomic RPC with row locking for last-admin protection
        const { data: rpcData, error: rpcErr } = await adminClient.rpc("admin_update_user", {
          p_caller_id: user.id,
          p_target_id: cleanTargetId,
          p_new_is_enabled: newStatus,
        });

        if (rpcErr) {
          console.error("[admin-actions] Error in admin_update_user RPC:", rpcErr.message);
          return new Response(
            JSON.stringify({ success: false, error: "Database error updating user status" }),
            { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
          );
        }

        const rpcResult = Array.isArray(rpcData) ? rpcData[0] : rpcData;
        if (!rpcResult?.success) {
          return new Response(
            JSON.stringify({ success: false, error: rpcResult?.message || "Failed to update status" }),
            { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
          );
        }

        return new Response(
          JSON.stringify({ success: true, message: `User status set to ${newStatus}` }),
          { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      case "set_user_approval": {
        const { targetUserId, approvalStatus } = body;

        if (typeof targetUserId !== "string" || !UUID_REGEX.test(targetUserId.trim())) {
          return new Response(
            JSON.stringify({ success: false, error: "Invalid or missing targetUserId UUID" }),
            { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
          );
        }

        if (typeof approvalStatus !== "string" || !["approved", "rejected", "pending"].includes(approvalStatus)) {
          return new Response(
            JSON.stringify({ success: false, error: "Invalid approvalStatus: must be 'approved', 'rejected', or 'pending'" }),
            { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
          );
        }

        const cleanTargetId = targetUserId.trim();

        // Prevent self-approval or self-rejection
        if (cleanTargetId === user.id) {
          return new Response(
            JSON.stringify({ success: false, error: "Administrators cannot alter their own approval status" }),
            { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
          );
        }

        const targetIsEnabled = approvalStatus === "approved" ? true : false;

        // Call atomic RPC with row locking for last-admin protection
        const { data: rpcData, error: rpcErr } = await adminClient.rpc("admin_update_user", {
          p_caller_id: user.id,
          p_target_id: cleanTargetId,
          p_new_role: null,
          p_new_is_enabled: targetIsEnabled,
          p_new_approval_status: approvalStatus,
        });

        if (rpcErr) {
          console.error("[admin-actions] Error in admin_update_user RPC:", rpcErr.message);
          return new Response(
            JSON.stringify({ success: false, error: "Database error updating approval status" }),
            { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
          );
        }

        const rpcResult = Array.isArray(rpcData) ? rpcData[0] : rpcData;
        if (!rpcResult?.success) {
          return new Response(
            JSON.stringify({ success: false, error: rpcResult?.message || "Failed to update approval status" }),
            { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
          );
        }

        return new Response(
          JSON.stringify({
            success: true,
            message: `User has been ${approvalStatus === "approved" ? "approved and activated" : "rejected"}.`,
          }),
          { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      case "acknowledge_alert": {
        const { alertId } = body;

        if (typeof alertId !== "string" || !UUID_REGEX.test(alertId.trim())) {
          return new Response(
            JSON.stringify({ success: false, error: "Invalid or missing alertId UUID" }),
            { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
          );
        }

        const cleanAlertId = alertId.trim();

        // Verify alert exists first
        const { data: existingAlert, error: findErr } = await adminClient
          .from("intrusion_alerts")
          .select("id, acknowledged_at, notification_status")
          .eq("id", cleanAlertId)
          .maybeSingle();

        if (findErr) {
          console.error("[admin-actions] Database error finding intrusion alert:", findErr.message);
          return new Response(
            JSON.stringify({ success: false, error: "Database error finding alert" }),
            { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
          );
        }

        if (!existingAlert) {
          return new Response(
            JSON.stringify({ success: false, error: "Intrusion alert not found" }),
            { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } }
          );
        }

        const { error: updateErr } = await adminClient
          .from("intrusion_alerts")
          .update({
            acknowledged_at: new Date().toISOString(),
            notification_status: "acknowledged",
          })
          .eq("id", cleanAlertId);

        if (updateErr) {
          console.error("[admin-actions] Database error updating intrusion alert:", updateErr.message);
          return new Response(
            JSON.stringify({ success: false, error: "Failed to acknowledge alert" }),
            { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
          );
        }

        return new Response(
          JSON.stringify({ success: true, message: "Alert acknowledged" }),
          { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      default:
        return new Response(
          JSON.stringify({ success: false, error: `Unsupported administrative action: '${action}'` }),
          { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
    }
  } catch (err: unknown) {
    console.error("[admin-actions] Unexpected server error:", err);
    return new Response(
      JSON.stringify({ success: false, error: "Internal server error" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
