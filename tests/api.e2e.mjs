// API + security E2E for TTI Amplify v2 against the live Supabase project, using throwaway accounts.
// Run:  AMPLIFY_STAFF_CODE=... AMPLIFY_ADMIN_CODE=... node tests/api.e2e.mjs
// Afterwards delete the test data (accounts end in @example.com, posts start with "[TEST]"); see README.
import { randomBytes } from 'node:crypto';

const BASE = 'https://fuhnyjmbjzjflxylxakw.supabase.co';
const KEY = 'sb_publishable_X6ElDgI9IkOuELXgmDGKFw_v-J35WNq';
const STAFF = process.env.AMPLIFY_STAFF_CODE;
const ADMIN = process.env.AMPLIFY_ADMIN_CODE;
if (!STAFF || !ADMIN) throw new Error('Set AMPLIFY_STAFF_CODE and AMPLIFY_ADMIN_CODE.');
const DEPT_A = 6;
const DEPT_B = 7;

let failed = 0;
const check = (name, ok, detail = '') => {
  if (!ok) failed += 1;
  console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${ok ? '' : `  [${detail}]`}`);
};

async function call(method, path, body, token, extra = {}) {
  const isBlob = body instanceof Blob;
  const res = await fetch(BASE + path, {
    method,
    headers: { apikey: KEY, Authorization: `Bearer ${token ?? KEY}`, Prefer: 'return=representation',
      ...(body === undefined ? {} : { 'Content-Type': isBlob ? body.type : 'application/json' }), ...extra },
    body: body === undefined ? undefined : isBlob ? body : JSON.stringify(body),
  });
  const text = await res.text();
  let data;
  try { data = text ? JSON.parse(text) : null; } catch { data = text; }
  return [res.status, data];
}
const show = (s, d) => `${s} ${JSON.stringify(d)?.slice(0, 200)}`;

async function account(name, code, dept) {
  const email = `amplify.v2.${randomBytes(4).toString('hex')}@example.com`;
  const password = randomBytes(12).toString('base64url');
  const [s, d] = await call('POST', '/functions/v1/signup', { full_name: name, email, password, department_id: dept, code });
  if (s !== 201) throw new Error(`signup ${name}: ${show(s, d)}`);
  const [, t] = await call('POST', '/auth/v1/token?grant_type=password', { email, password });
  return { token: t.access_token, id: t.user.id };
}

const admin = await account('V2 Admin', ADMIN, DEPT_B);
const hod = await account('V2 Hod', STAFF, DEPT_A);
const memA = await account('V2 Member A', STAFF, DEPT_A);
const memB = await account('V2 Member B', STAFF, DEPT_B);
check('test accounts signed in', Boolean(admin.token && hod.token && memA.token && memB.token));

let [s, d] = await call('POST', '/functions/v1/admin', { action: 'set_role', user_id: hod.id, role: 'hod' }, memA.token);
check('member cannot set roles', s === 403, show(s, d));
[s, d] = await call('POST', '/functions/v1/admin', { action: 'set_role', user_id: hod.id, role: 'hod' }, admin.token);
check('admin makes a HOD', s === 200, show(s, d));

// Posts: starters, image path, duplicate guard ------------------------------------------
const url = `https://www.linkedin.com/feed/update/urn:li:activity:${Date.now()}`;
[s, d] = await call('POST', '/rest/v1/posts', { url, title: '[TEST] v2 post', starters: ['Proud of this team.', 'Great work, all.'] }, admin.token);
const postId = d?.[0]?.id;
check('admin creates post with starters', s === 201 && d[0].starters.length === 2, show(s, d));
[s, d] = await call('POST', '/rest/v1/posts', { url: `${url}9`, title: '[TEST] bad', starters: Array(6).fill('x') }, admin.token);
check('more than 5 starters rejected', s === 400, show(s, d));
[s, d] = await call('POST', '/rest/v1/posts', { url: `${url}8`, title: '[TEST] bad', image_path: '../etc/passwd.webp' }, admin.token);
check('bad image path rejected', s === 400, show(s, d));
[s, d] = await call('POST', '/rest/v1/posts', { url, title: '[TEST] dup' }, admin.token);
check('duplicate live URL rejected', s === 409, show(s, d));
[s, d] = await call('POST', '/rest/v1/posts', { url: `${url}7`, title: '[TEST] hod' }, hod.token);
check('HOD cannot create posts', s >= 400, show(s, d));
[s, d] = await call('PATCH', `/rest/v1/posts?id=eq.${postId}`, { li_impressions: 1234, li_recorded_at: new Date().toISOString() }, hod.token);
check('HOD cannot record LinkedIn results', s >= 400 || (Array.isArray(d) && d.length === 0), show(s, d));
[s, d] = await call('PATCH', `/rest/v1/posts?id=eq.${postId}`, { li_impressions: 1234, li_recorded_at: new Date().toISOString() }, admin.token);
check('admin records LinkedIn results', s === 200 && d[0].li_impressions === 1234, show(s, d));

// Engagement and HOD scoping ----------------------------------------------------------------
for (const m of [memA, memB]) {
  await call('POST', '/rest/v1/rpc/mark_opened', { p_post: postId }, m.token);
  [s, d] = await call('POST', '/rest/v1/rpc/confirm_engagement', { p_post: postId, p_reacted: true, p_commented: true, p_reposted: false }, m.token);
}
check('members confirm engagement', s < 300, show(s, d));
[s, d] = await call('POST', '/rest/v1/rpc/admin_people', {}, hod.token);
const deptAIds = new Set((d ?? []).map((p) => p.user_id));
check('HOD sees only own department', s === 200 && d.every((p) => p.department_id === DEPT_A) && deptAIds.has(memA.id) && !deptAIds.has(memB.id), show(s, d));
[s, d] = await call('POST', '/rest/v1/rpc/admin_post_report', { p_post: postId }, hod.token);
check('HOD report scoped to own department', s === 200 && d.length === deptAIds.size && !d.some((r) => r.user_id === memB.id), show(s, d));
[s, d] = await call('POST', '/rest/v1/rpc/admin_people', {}, admin.token);
check('admin sees everyone, with points', s === 200 && d.length >= 4 && d.find((p) => p.user_id === memA.id)?.points === 4, show(s, d));
[s, d] = await call('POST', '/rest/v1/rpc/admin_people', {}, memA.token);
check('member gets no people', s >= 400 || (Array.isArray(d) && d.length === 0), show(s, d));
[s, d] = await call('POST', '/rest/v1/rpc/insights', {}, hod.token);
check('HOD insights scoped to own department', s === 200 && d?.trend?.find((t) => t.id === postId)?.members === deptAIds.size, show(s, d));
[s, d] = await call('POST', '/rest/v1/rpc/insights', {}, memA.token);
check('member gets no insights', s >= 400 || d === null, show(s, d));
[s, d] = await call('POST', '/functions/v1/notify', { post_id: postId, kind: 'remind' }, hod.token);
check('HOD cannot send push', s === 403, show(s, d));

// Settings, top amplifiers, audit -------------------------------------------------------------
[s, d] = await call('POST', '/rest/v1/rpc/top_amplifiers', {}, memA.token);
check('top amplifiers hidden from staff by default', s === 200 && d.length === 0, show(s, d));
[s, d] = await call('PATCH', '/rest/v1/app_settings?key=eq.show_top', { value: true }, memA.token);
check('member cannot change settings', s >= 400 || (Array.isArray(d) && d.length === 0), show(s, d));
[s, d] = await call('PATCH', '/rest/v1/app_settings?key=eq.show_top', { value: true }, hod.token);
check('HOD cannot change settings', s >= 400 || (Array.isArray(d) && d.length === 0), show(s, d));
[s, d] = await call('PATCH', '/rest/v1/app_settings?key=eq.active_days', { value: 5 }, admin.token);
check('invalid setting value rejected', s === 400, show(s, d));
[s, d] = await call('PATCH', '/rest/v1/app_settings?key=eq.show_top', { value: true }, admin.token);
check('admin turns on top amplifiers', s === 200 && d[0]?.value === true, show(s, d));
[s, d] = await call('POST', '/rest/v1/rpc/top_amplifiers', {}, memA.token);
check('staff now see first names only', s === 200 && d.length >= 2 && d.every((r) => !String(r.first_name).includes(' ')), show(s, d));
[s, d] = await call('PATCH', '/rest/v1/app_settings?key=eq.show_top', { value: false }, admin.token);
check('admin turns it back off', s === 200, show(s, d));
[s, d] = await call('GET', '/rest/v1/audit_log?select=action,target&order=at.desc&limit=20', undefined, admin.token);
const actions = new Set((d ?? []).map((r) => r.action));
check('audit records post, role and setting changes', s === 200 && ['post.create', 'person.role', 'settings.update'].every((a) => actions.has(a)), show(s, d));
[s, d] = await call('GET', '/rest/v1/audit_log?select=action', undefined, hod.token);
check('HOD cannot read audit log', s >= 400 || (Array.isArray(d) && d.length === 0), show(s, d));

// Storage, cron, error log -------------------------------------------------------------------------
const webp = new Blob([randomBytes(64)], { type: 'image/webp' });
const objPath = `${randomBytes(8).toString('hex')}-test.webp`;
[s, d] = await call('POST', `/storage/v1/object/post-images/${objPath}`, webp, memA.token);
check('member cannot upload images', s >= 400, show(s, d));
[s, d] = await call('POST', `/storage/v1/object/post-images/${objPath}`, new Blob(['x'], { type: 'text/html' }), admin.token);
check('non-webp upload rejected', s >= 400, show(s, d));
[s, d] = await call('POST', `/storage/v1/object/post-images/${objPath}`, webp, admin.token);
check('admin uploads webp', s === 200, show(s, d));
[s, d] = await call('DELETE', `/storage/v1/object/post-images/${objPath}`, undefined, admin.token);
check('admin deletes test image', s === 200, show(s, d));
[s, d] = await call('POST', '/functions/v1/notify', {}, KEY, { 'x-cron-secret': 'wrong-secret' });
check('cron path refuses a wrong secret', s === 401, show(s, d));
[s, d] = await call('POST', '/rest/v1/rpc/due_auto_reminders', {}, admin.token);
check('due_auto_reminders not callable by users', s >= 400, show(s, d));
[s, d] = await call('POST', '/rest/v1/rpc/log_client_error', { p_message: '[TEST] error', p_stack: null, p_url: '#/test', p_ua: 'e2e' }, memA.token);
check('member can log a client error', s < 300, show(s, d));
[s, d] = await call('GET', '/rest/v1/client_errors?select=message', undefined, memA.token);
check('member cannot read error log', s >= 400 || (Array.isArray(d) && d.length === 0), show(s, d));

console.log(`\n${failed ? `${failed} FAILED` : 'ALL PASSED'}`);
process.exitCode = failed ? 1 : 0;
