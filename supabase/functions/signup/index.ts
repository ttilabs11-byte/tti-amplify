// Creates a pre-confirmed account after checking the company code server-side.
import { createClient } from "npm:@supabase/supabase-js@2.117.2";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
const MAX_FAILED_PER_HOUR = 20;
// Backstop across all IPs, so rotating spoofed addresses cannot brute-force the code.
const MAX_FAILED_GLOBAL_PER_HOUR = 300;
const HOUR_MS = 3_600_000;

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { ...CORS, "Content-Type": "application/json" } });

function safeEqual(a: string, b: string): boolean {
  const ea = new TextEncoder().encode(a);
  const eb = new TextEncoder().encode(b);
  if (ea.length !== eb.length) return false;
  let diff = 0;
  for (let i = 0; i < ea.length; i++) diff |= ea[i] ^ eb[i];
  return diff === 0;
}

function validate(body: Record<string, unknown>) {
  const fullName = String(body.full_name ?? "").trim().replace(/\s+/g, " ");
  const email = String(body.email ?? "").trim().toLowerCase();
  const password = String(body.password ?? "");
  const code = String(body.code ?? "").trim().toUpperCase();
  const departmentId = Number(body.department_id);
  if (fullName.length < 2 || fullName.length > 80) return { error: "Please enter your full name." };
  if (!EMAIL_RE.test(email) || email.length > 254) return { error: "Please enter a valid email address." };
  if (password.length < 8 || password.length > 72) return { error: "Password must be 8 to 72 characters." };
  if (!Number.isInteger(departmentId) || departmentId <= 0) return { error: "Please choose your department." };
  if (!code) return { error: "Please enter the company code." };
  return { fullName, email, password, code, departmentId };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return json(405, { error: "Method not allowed." });

  const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return json(400, { error: "Invalid request." });
  }
  const input = validate(body);
  if ("error" in input) return json(400, input);

  // Offices share one public IP, so only failed code attempts count towards the limit.
  // The proxy-set address comes first; the left end of x-forwarded-for is client-controlled.
  const forwarded = (req.headers.get("x-forwarded-for") ?? "").split(",").map((s) => s.trim()).filter(Boolean);
  const ip = req.headers.get("cf-connecting-ip") ?? req.headers.get("x-real-ip") ?? forwarded.at(-1) ?? "unknown";
  const since = new Date(Date.now() - HOUR_MS).toISOString();
  const [mine, all] = await Promise.all([
    admin.from("signup_attempts").select("id", { count: "exact", head: true }).eq("ip", ip).gte("at", since),
    admin.from("signup_attempts").select("id", { count: "exact", head: true }).gte("at", since),
  ]);
  if (mine.error || all.error) {
    console.error("rate-limit check failed", mine.error ?? all.error);
    return json(500, { error: "Something went wrong. Please try again." });
  }
  if ((mine.count ?? 0) >= MAX_FAILED_PER_HOUR || (all.count ?? 0) >= MAX_FAILED_GLOBAL_PER_HOUR) {
    return json(429, { error: "Too many attempts. Please wait an hour and try again." });
  }

  const { data: secrets, error: secErr } = await admin.from("app_secrets").select("key, value").in("key", ["staff_code", "admin_code"]);
  if (secErr || !secrets) {
    console.error("secrets read failed", secErr);
    return json(500, { error: "Something went wrong. Please try again." });
  }
  const codeOf = (key: string) => secrets.find((s) => s.key === key)?.value ?? "";
  let role: "member" | "admin" | null = null;
  if (safeEqual(input.code, codeOf("staff_code"))) role = "member";
  else if (safeEqual(input.code, codeOf("admin_code"))) role = "admin";
  if (!role) {
    await admin.from("signup_attempts").insert({ ip });
    await admin.from("signup_attempts").delete().lt("at", new Date(Date.now() - 24 * HOUR_MS).toISOString());
    return json(403, { error: "That company code isn't right. Ask HR for the current code." });
  }

  const { data: dept } = await admin.from("departments").select("id").eq("id", input.departmentId).maybeSingle();
  if (!dept) return json(400, { error: "Please choose your department." });

  const { data: created, error: createErr } = await admin.auth.admin.createUser({
    email: input.email,
    password: input.password,
    email_confirm: true,
    user_metadata: { full_name: input.fullName },
  });
  if (createErr || !created.user) {
    const exists = /already|registered|exists/i.test(createErr?.message ?? "");
    if (exists) return json(409, { error: "An account with this email already exists. Sign in instead." });
    console.error("createUser failed", createErr);
    return json(500, { error: "Could not create the account. Please try again." });
  }

  const { error: profErr } = await admin.from("profiles").insert({
    id: created.user.id,
    full_name: input.fullName,
    department_id: input.departmentId,
    role,
  });
  if (profErr) {
    console.error("profile insert failed", profErr);
    await admin.auth.admin.deleteUser(created.user.id);
    return json(500, { error: "Could not create the account. Please try again." });
  }

  return json(201, { ok: true, role });
});
