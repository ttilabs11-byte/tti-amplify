// Web Push. Admins: "new" alerts every device, "remind" alerts people who have not ticked.
// Cron (x-cron-secret): "auto" sends one reminder per post once it has been live for the configured hours.
import { createClient, type SupabaseClient } from "npm:@supabase/supabase-js@2.117.2";
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
interface Post { id: string; title: string; archived: boolean; last_reminded_at: string | null }

function safeEqual(a: string, b: string): boolean {
  const ea = new TextEncoder().encode(a);
  const eb = new TextEncoder().encode(b);
  if (ea.length !== eb.length) return false;
  let diff = 0;
  for (let i = 0; i < ea.length; i++) diff |= ea[i] ^ eb[i];
  return diff === 0;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return json(405, { error: "Method not allowed." });

  const db = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  if (!(await setVapid(db))) return json(500, { error: "Notifications are not set up yet." });

  const cronSecret = req.headers.get("x-cron-secret");
  if (cronSecret !== null) return runAuto(db, cronSecret);

  const token = (req.headers.get("Authorization") ?? "").replace(/^Bearer\s+/i, "");
  const { data: auth, error: authErr } = await db.auth.getUser(token);
  if (authErr || !auth.user) return json(401, { error: "Please sign in again." });
  const { data: me } = await db.from("profiles").select("role, active").eq("id", auth.user.id).maybeSingle();
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

  const post = await loadPost(db, postId);
  if (!post || post.archived) return json(400, { error: "That post is not live." });
  if (kind === "remind" && post.last_reminded_at) {
    const since = Date.now() - new Date(post.last_reminded_at).getTime();
    if (since < REMIND_GAP_MS) {
      return json(429, { error: `A reminder went out ${Math.max(1, Math.round(since / 60000))} min ago. Try again in a couple of hours.` });
    }
  }

  const recipients = await loadRecipients(db, postId, kind === "remind", auth.user.id);
  if (recipients === null) return json(500, { error: "Something went wrong. Please try again." });
  const result = await sendAll(db, recipients, payloadFor(post, kind));
  if (kind === "remind") {
    await db.from("posts").update({ last_reminded_at: new Date().toISOString() }).eq("id", postId);
    await db.from("audit_log").insert({ actor: auth.user.id, action: "post.remind", target: postId, detail: result });
  }
  return json(200, result);
});

async function setVapid(db: SupabaseClient): Promise<boolean> {
  const { data: keys, error } = await db.from("app_secrets").select("key, value").in("key", ["vapid_public", "vapid_private"]);
  const pub = keys?.find((k) => k.key === "vapid_public")?.value;
  const priv = keys?.find((k) => k.key === "vapid_private")?.value;
  if (error || !pub || !priv) {
    console.error("vapid keys missing", error);
    return false;
  }
  webpush.setVapidDetails(APP_URL, pub, priv);
  return true;
}

async function runAuto(db: SupabaseClient, given: string): Promise<Response> {
  const { data: secret } = await db.from("app_secrets").select("value").eq("key", "cron_secret").maybeSingle();
  if (!secret?.value || !safeEqual(given, secret.value)) return json(401, { error: "Unauthorised." });
  const { data: due, error } = await db.rpc("due_auto_reminders");
  if (error) {
    console.error("due_auto_reminders failed", error);
    return json(500, { error: "Could not read due posts." });
  }
  const done = [];
  for (const id of (due ?? []) as string[]) {
    const post = await loadPost(db, id);
    if (!post || post.archived) continue;
    const recent = post.last_reminded_at && Date.now() - new Date(post.last_reminded_at).getTime() < REMIND_GAP_MS;
    let result = { sent: 0, devices: 0, people: 0, removed: 0, failed: 0, skipped: true };
    if (!recent) {
      const recipients = await loadRecipients(db, id, true, null);
      if (recipients === null) continue;
      result = { ...(await sendAll(db, recipients, payloadFor(post, "remind"))), skipped: false };
    }
    const now = new Date().toISOString();
    await db.from("posts").update(recent ? { auto_reminded_at: now } : { auto_reminded_at: now, last_reminded_at: now }).eq("id", id);
    await db.from("audit_log").insert({ actor: null, action: "post.auto_remind", target: id, detail: result });
    done.push({ id, ...result });
  }
  return json(200, { processed: done.length, posts: done });
}

async function loadPost(db: SupabaseClient, id: string): Promise<Post | null> {
  const { data } = await db.from("posts").select("id, title, archived, last_reminded_at").eq("id", id).maybeSingle();
  return data as Post | null;
}

function payloadFor(post: Post, kind: string): string {
  return JSON.stringify({
    title: kind === "new" ? "New Tti post on LinkedIn" : "Your support is still needed",
    body: post.title,
    url: `${APP_URL}#/p/${post.id}`,
    tag: `post-${post.id}`,
  });
}

async function sendAll(db: SupabaseClient, recipients: Sub[], payload: string) {
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
  if (gone.length) await db.from("push_subscriptions").delete().in("endpoint", gone);
  const people = new Set(recipients.map((r) => r.user_id)).size;
  return { sent, devices: recipients.length, people, removed: gone.length, failed: recipients.length - sent - gone.length };
}

async function loadRecipients(db: SupabaseClient, postId: string, pendingOnly: boolean, senderId: string | null): Promise<Sub[] | null> {
  const { data: subs, error } = await db
    .from("push_subscriptions").select("endpoint, p256dh, auth, user_id, profiles!inner(active)").eq("profiles.active", true);
  if (error) {
    console.error("subscriptions read failed", error);
    return null;
  }
  const skip = new Set<string>(senderId ? [senderId] : []);
  if (pendingOnly) {
    const { data: done, error: doneErr } = await db
      .from("engagements").select("user_id").eq("post_id", postId).not("confirmed_at", "is", null);
    if (doneErr) {
      console.error("engagements read failed", doneErr);
      return null;
    }
    done.forEach((d) => skip.add(d.user_id as string));
  }
  return (subs as unknown as Sub[]).filter((s) => !skip.has(s.user_id));
}
