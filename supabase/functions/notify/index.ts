// Admin-only Web Push: "new" alerts every device about a post; "remind" alerts only people who have not ticked it.
import { createClient } from "npm:@supabase/supabase-js@2";
import webpush from "npm:web-push@3.6.7";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const APP_URL = Deno.env.get("APP_URL") ?? "https://ttilabs11-byte.github.io/tti-amplify/";
const UUID_RE = /^[0-9a-f-]{36}$/i;
const REMIND_GAP_MS = 2 * 60 * 60 * 1000;
const BATCH = 25;
const TTL_SECONDS = 24 * 60 * 60;
const GONE = new Set([404, 410]);

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { ...CORS, "Content-Type": "application/json" } });

interface Sub { endpoint: string; p256dh: string; auth: string; user_id: string }

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
  const postId = String(body.post_id ?? "");
  const kind = body.kind === "remind" ? "remind" : "new";
  if (!UUID_RE.test(postId)) return json(400, { error: "Unknown post." });

  const { data: post } = await admin.from("posts").select("id, title, archived, last_reminded_at").eq("id", postId).maybeSingle();
  if (!post || post.archived) return json(400, { error: "That post is not live." });
  if (kind === "remind" && post.last_reminded_at) {
    const since = Date.now() - new Date(post.last_reminded_at).getTime();
    if (since < REMIND_GAP_MS) {
      return json(429, { error: `A reminder went out ${Math.max(1, Math.round(since / 60000))} min ago. Try again in a couple of hours.` });
    }
  }

  const { data: keys, error: keyErr } = await admin.from("app_secrets").select("key, value").in("key", ["vapid_public", "vapid_private"]);
  const pub = keys?.find((k) => k.key === "vapid_public")?.value;
  const priv = keys?.find((k) => k.key === "vapid_private")?.value;
  if (keyErr || !pub || !priv) {
    console.error("vapid keys missing", keyErr);
    return json(500, { error: "Notifications are not set up yet." });
  }
  webpush.setVapidDetails(APP_URL, pub, priv);

  const recipients = await loadRecipients(admin, postId, kind, auth.user.id);
  if (recipients === null) return json(500, { error: "Something went wrong. Please try again." });

  const payload = JSON.stringify({
    title: kind === "new" ? "New Tti post on LinkedIn" : "Your support is still needed",
    body: post.title,
    url: `${APP_URL}#/p/${post.id}`,
    tag: `post-${post.id}`,
  });

  let sent = 0;
  const gone: string[] = [];
  for (let i = 0; i < recipients.length; i += BATCH) {
    const results = await Promise.allSettled(recipients.slice(i, i + BATCH).map((s) =>
      webpush.sendNotification({ endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } }, payload,
        { TTL: TTL_SECONDS, urgency: "high" })));
    results.forEach((r, j) => {
      if (r.status === "fulfilled") sent += 1;
      else if (GONE.has((r.reason as { statusCode?: number })?.statusCode ?? 0)) gone.push(recipients[i + j].endpoint);
      else console.error("push failed", (r.reason as Error)?.message);
    });
  }
  if (gone.length) await admin.from("push_subscriptions").delete().in("endpoint", gone);
  if (kind === "remind") await admin.from("posts").update({ last_reminded_at: new Date().toISOString() }).eq("id", postId);

  const people = new Set(recipients.map((r) => r.user_id)).size;
  return json(200, { sent, devices: recipients.length, people, removed: gone.length, failed: recipients.length - sent - gone.length });
});

async function loadRecipients(admin: ReturnType<typeof createClient>, postId: string, kind: string, senderId: string): Promise<Sub[] | null> {
  const { data: subs, error } = await admin
    .from("push_subscriptions").select("endpoint, p256dh, auth, user_id, profiles!inner(active)").eq("profiles.active", true);
  if (error) {
    console.error("subscriptions read failed", error);
    return null;
  }
  let skip = new Set<string>([senderId]);
  if (kind === "remind") {
    const { data: done, error: doneErr } = await admin
      .from("engagements").select("user_id").eq("post_id", postId).not("confirmed_at", "is", null);
    if (doneErr) {
      console.error("engagements read failed", doneErr);
      return null;
    }
    skip = new Set([senderId, ...done.map((d) => d.user_id as string)]);
  }
  return (subs as unknown as Sub[]).filter((s) => !skip.has(s.user_id));
}
