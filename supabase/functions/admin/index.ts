// Admin-only actions that need the service role: codes, password resets, roles, access.
import { createClient } from "npm:@supabase/supabase-js@2";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const CODE_RE = /^[A-Z0-9-]{6,32}$/;
const UUID_RE = /^[0-9a-f-]{36}$/i;
const BAN_FOREVER = "876000h";

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { ...CORS, "Content-Type": "application/json" } });

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return json(405, { error: "Method not allowed." });

  const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const token = (req.headers.get("Authorization") ?? "").replace(/^Bearer\s+/i, "");
  const { data: auth, error: authErr } = await admin.auth.getUser(token);
  if (authErr || !auth.user) return json(401, { error: "Please sign in again." });
  const { data: me } = await admin.from("profiles").select("role, active").eq("id", auth.user.id).maybeSingle();
  if (!me || me.role !== "admin" || !me.active) return json(403, { error: "Admins only." });

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return json(400, { error: "Invalid request." });
  }
  const action = String(body.action ?? "");
  const userId = String(body.user_id ?? "");
  const needsUser = ["reset_password", "set_role", "set_active"].includes(action);
  if (needsUser && !UUID_RE.test(userId)) return json(400, { error: "Unknown person." });
  if (needsUser && userId === auth.user.id && action !== "reset_password") {
    return json(400, { error: "You can't change your own access." });
  }

  switch (action) {
    case "get_codes": {
      const { data, error } = await admin.from("app_secrets").select("key, value");
      if (error) return fail("get_codes", error);
      return json(200, Object.fromEntries(data.map((r) => [r.key, r.value])));
    }
    case "set_code": {
      const key = body.which === "admin" ? "admin_code" : body.which === "staff" ? "staff_code" : "";
      const value = String(body.value ?? "").trim().toUpperCase();
      if (!key || !CODE_RE.test(value)) return json(400, { error: "Use 6 to 32 letters, numbers or dashes." });
      const { error } = await admin.from("app_secrets").upsert({ key, value });
      if (error) return fail("set_code", error);
      return json(200, { ok: true });
    }
    case "reset_password": {
      const password = String(body.password ?? "");
      if (password.length < 8 || password.length > 72) return json(400, { error: "Password must be 8 to 72 characters." });
      const { error } = await admin.auth.admin.updateUserById(userId, { password });
      if (error) return fail("reset_password", error);
      return json(200, { ok: true });
    }
    case "set_role": {
      const role = body.role === "admin" ? "admin" : "member";
      const { error } = await admin.from("profiles").update({ role }).eq("id", userId);
      if (error) return fail("set_role", error);
      return json(200, { ok: true });
    }
    case "set_active": {
      const active = body.active === true;
      const { error: banErr } = await admin.auth.admin.updateUserById(userId, {
        ban_duration: active ? "none" : BAN_FOREVER,
      });
      if (banErr) return fail("set_active ban", banErr);
      const { error } = await admin.from("profiles").update({ active }).eq("id", userId);
      if (error) return fail("set_active", error);
      return json(200, { ok: true });
    }
    default:
      return json(400, { error: "Unknown action." });
  }
});

function fail(where: string, error: unknown) {
  console.error(where, error);
  return json(500, { error: "Something went wrong. Please try again." });
}
