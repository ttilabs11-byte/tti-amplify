// Admin: post list, add/edit post, per-post report.
import * as api from '../api.js';
import { h, mount, icon, ACTIONS, sheet, closeSheet, toast, busy, errorText, relDate, initials, avatarColor, copyText } from '../ui.js';
import { state, livePosts, postLink, isAdmin, deptName } from '../store.js';
import { renderPeople, renderSettings } from './admin-people.js';
import { renderInsights } from './insights.js';

const FLAG = { react: 'reacted', comment: 'commented', repost: 'reposted' };
const VERB = { react: 'react to', comment: 'comment on', repost: 'repost' };
const MAX_STARTERS = 5;
const MAX_STARTER_LEN = 280;
let listFilter = 'live';
let reportFilter = 'all';

export async function renderAdmin(page, parts) {
  page.classList.add('wide');
  const admin = isAdmin();
  const sub = parts[0] ?? 'posts';
  const sections = [['posts', 'Posts', '#/admin'], ['insights', 'Insights', '#/admin/insights'], ['people', 'People', '#/admin/people'],
    admin ? ['settings', 'Invite & settings', '#/admin/settings'] : null].filter(Boolean);
  const nav = h('nav', { class: 'subnav', 'aria-label': 'Admin sections' },
    sections.map(([key, label, href]) => h('a', { href, 'aria-current': (sub === key || (key === 'posts' && ['new', 'edit', 'post'].includes(sub))) ? 'page' : null }, label)));
  const body = h('div');
  const intro = admin ? 'Posts, people and invites.' : `Read-only reports for ${deptName(state.profile?.department_id)}.`;
  page.replaceChildren(h('div', { class: 'hello' }, h('div', null, h('h1', null, admin ? 'Admin' : 'Reports'), h('p', null, intro))), nav, body);
  if (!admin && ['new', 'edit', 'settings'].includes(sub)) return renderPostList(body);
  if (sub === 'new') return renderEditor(body, null);
  if (sub === 'edit') return renderEditor(body, parts[1]);
  if (sub === 'post') return renderReport(body, parts[1]);
  if (sub === 'insights') return renderInsights(body);
  if (sub === 'people') return renderPeople(body);
  if (sub === 'settings') return renderSettings(body);
  return renderPostList(body);
}

const skeleton = (n, height) => h('div', { class: 'admin-grid' }, Array.from({ length: n }, () => h('div', { class: 'skel', style: { height } })));
const failBox = (err) => h('div', { class: 'empty' }, icon('alert'), h('h3', null, 'Could not load'), h('p', null, errorText(err)));

// Post list ---------------------------------------------------------------------------

async function renderPostList(body) {
  body.replaceChildren(skeleton(4, '120px'));
  let stats;
  try {
    stats = await api.adminPostStats();
  } catch (err) {
    body.replaceChildren(failBox(err));
    return;
  }
  const byId = new Map(stats.map((s) => [s.post_id, s]));
  const members = Number(stats[0]?.members ?? 0);
  const live = livePosts();
  const rates = live.map((p) => (members ? Number(byId.get(p.id)?.engaged ?? 0) / members : 0));
  const avg = rates.length ? Math.round((rates.reduce((a, b) => a + b, 0) / rates.length) * 100) : 0;
  const shown = state.posts.filter((p) => (listFilter === 'live' ? !p.archived : p.archived));

  const chip = (key, label) => h('button', { class: 'tab', type: 'button', 'aria-selected': String(listFilter === key), onClick: () => { listFilter = key; renderPostList(body); } }, label);
  const admin = isAdmin();
  body.replaceChildren(
    h('div', { class: 'kpis' },
      kpi(String(live.length), 'Live posts'), kpi(String(members), 'Members'), kpi(`${avg}%`, 'Avg. done')),
    h('div', { class: 'section-title' },
      admin ? h('div', { class: 'filters', role: 'tablist' }, chip('live', 'Live'), chip('archived', 'Archived')) : h('h2', null, 'Live posts'),
      h('div', { class: 'row' },
        h('button', { class: 'btn btn-ghost btn-sm', type: 'button', onClick: monthSheet }, icon('download'), 'Month CSV'),
        admin ? h('a', { class: 'btn btn-primary btn-sm', href: '#/admin/new' }, icon('plus'), 'Add post') : null)),
    shown.length
      ? h('div', { class: 'admin-grid two' }, shown.map((p) => postRow(p, byId.get(p.id), members)))
      : h('div', { class: 'empty' }, icon('sparkle'), h('h3', null, listFilter === 'live' ? 'No live posts' : 'Nothing archived'),
        h('p', null, listFilter === 'live' ? 'Add the first post. Paste its LinkedIn link, or share it to this app from LinkedIn.' : 'Archived posts leave the staff feed but keep their records.')));
}

const kpi = (value, label) => h('div', { class: 'kpi' }, h('b', null, value), h('span', null, label));

function postRow(post, stat, members) {
  const engaged = Number(stat?.engaged ?? 0);
  const opened = Number(stat?.opened ?? 0);
  const pct = members ? Math.round((engaged / members) * 100) : 0;
  const openedPct = members ? Math.round(((opened - engaged) / members) * 100) : 0;
  return h('a', { class: 'card apost', href: `#/admin/post/${post.id}`, style: { 'text-decoration': 'none', color: 'inherit' } },
    h('div', { class: 'row small muted' }, h('span', null, relDate(post.posted_on)), h('span', { class: 'grow' }),
      h('span', { class: 'mini-acts', 'aria-label': `Asks: ${post.asks.join(', ')}` }, ACTIONS.filter((a) => post.asks.includes(a.key)).map((a) => h('span', null, icon(a.key))))),
    h('h3', null, post.title),
    h('div', { class: 'progress', role: 'img', 'aria-label': `${pct}% engaged` },
      h('i', { style: { width: `${pct}%` } }), h('i', { class: 'opened', style: { width: `${Math.max(openedPct, 0)}%` } })),
    h('div', { class: 'row' }, h('span', { class: 'meta' }, `${engaged} of ${members} engaged · ${Math.max(opened - engaged, 0)} opened only`),
      h('span', { class: 'pct' }, `${pct}%`)));
}

// Editor --------------------------------------------------------------------------------

export function cleanLinkedInUrl(raw) {
  const match = String(raw ?? '').match(/https?:\/\/(?:[a-z0-9-]+\.)?linkedin\.com\/[^\s"'<>]+/i);
  if (!match) return '';
  try {
    const url = new URL(match[0].replace(/^http:/i, 'https:'));
    url.search = '';
    url.hash = '';
    return url.href;
  } catch {
    return '';
  }
}

function takeShareDraft() {
  try {
    const draft = JSON.parse(sessionStorage.getItem('tti-amplify-share') ?? 'null');
    sessionStorage.removeItem('tti-amplify-share');
    return draft;
  } catch {
    return null;
  }
}

function renderEditor(body, id) {
  const existing = id ? state.posts.find((p) => p.id === id) : null;
  if (id && !existing) { body.replaceChildren(failBox(new Error('Post not found.'))); return; }
  const draft = existing ? null : takeShareDraft();
  const asks = new Set(existing?.asks ?? ['react', 'comment', 'repost']);
  const today = new Date().toISOString().slice(0, 10);

  const url = h('input', { id: 'e-url', class: 'input', type: 'url', inputmode: 'url', required: true, value: existing?.url ?? draft?.url ?? '', placeholder: 'https://www.linkedin.com/posts/…' });
  const title = h('input', { id: 'e-title', class: 'input', required: true, maxlength: 140, value: existing?.title ?? draft?.title ?? '', placeholder: 'e.g. Our new textile testing lab opens' });
  const note = h('textarea', { id: 'e-note', class: 'textarea', maxlength: 400, placeholder: 'Optional. e.g. Comment on why accreditation matters to our clients.' });
  note.value = existing?.note ?? '';
  const date = h('input', { id: 'e-date', class: 'input', type: 'date', value: existing?.posted_on ?? today, max: today });
  const starters = h('textarea', { id: 'e-starters', class: 'textarea', rows: 4, placeholder: 'One per line, up to 5. e.g. Proud of the team behind this. Accreditation is what our clients rely on.' });
  starters.value = (existing?.starters ?? []).join('\n');
  const image = imagePicker(existing?.image_path ?? null);
  const paste = h('button', { class: 'btn btn-soft btn-sm', type: 'button' }, icon('copy'), 'Paste');
  paste.addEventListener('click', async () => {
    try {
      const clean = cleanLinkedInUrl(await navigator.clipboard.readText());
      if (clean) url.value = clean; else toast('No LinkedIn link on the clipboard.', { type: 'err' });
    } catch { toast('Paste is blocked here. Long-press the box to paste.', { type: 'err' }); }
  });

  const toggles = h('div', { class: 'toggles' }, ACTIONS.map((a) => {
    const t = h('button', { class: 'toggle', type: 'button', dataset: { a: a.key }, 'aria-pressed': String(asks.has(a.key)) }, icon(a.key), a.label);
    t.addEventListener('click', () => {
      if (asks.has(a.key) && asks.size === 1) { toast('Ask for at least one action.'); return; }
      if (asks.has(a.key)) asks.delete(a.key); else asks.add(a.key);
      t.setAttribute('aria-pressed', String(asks.has(a.key)));
    });
    return t;
  }));

  const save = h('button', { class: 'btn btn-primary', type: 'button' }, existing ? 'Save changes' : 'Publish to staff');
  save.addEventListener('click', () => busy(save, async () => {
    const cleanUrl = cleanLinkedInUrl(url.value);
    if (!cleanUrl) throw new Error('Paste the full linkedin.com link of the post.');
    if (title.value.trim().length < 3) throw new Error('Give the post a short title (3+ characters).');
    const lines = starters.value.split('\n').map((s) => s.trim()).filter(Boolean);
    if (lines.length > MAX_STARTERS) throw new Error(`Keep comment starters to ${MAX_STARTERS} lines.`);
    if (lines.some((s) => s.length > MAX_STARTER_LEN)) throw new Error(`Keep each comment starter under ${MAX_STARTER_LEN} characters.`);
    const row = {
      url: cleanUrl, title: title.value.trim(), note: note.value.trim() || null,
      asks: ACTIONS.map((a) => a.key).filter((k) => asks.has(k)), posted_on: date.value || today,
      starters: lines, image_path: image.path(),
    };
    const saved = existing ? await api.updatePost(existing.id, row) : await api.createPost({ ...row, created_by: state.profile.id });
    state.posts = existing ? state.posts.map((p) => (p.id === saved.id ? saved : p)) : [saved, ...state.posts];
    if (existing) { toast('Saved', { type: 'ok' }); location.hash = `#/admin/post/${saved.id}`; return; }
    location.hash = `#/admin/post/${saved.id}`;
    announceSheet(saved);
  }).catch((err) => toast(errorText(err), { type: 'err' })));

  const archive = existing ? h('button', { class: `btn ${existing.archived ? 'btn-soft' : 'btn-danger'}`, type: 'button' },
    icon('archive'), existing.archived ? 'Restore to feed' : 'Archive') : null;
  archive?.addEventListener('click', () => busy(archive, async () => {
    const saved = await api.updatePost(existing.id, { archived: !existing.archived });
    state.posts = state.posts.map((p) => (p.id === saved.id ? saved : p));
    toast(saved.archived ? 'Archived. Staff no longer see it.' : 'Back in the staff feed.', { type: 'ok' });
    location.hash = '#/admin';
  }).catch((err) => toast(errorText(err), { type: 'err' })));

  body.replaceChildren(h('div', { class: 'card card-pad stack', style: { 'max-width': '680px' } },
    h('h2', { style: { 'font-size': '22px' } }, existing ? 'Edit post' : 'Add a post'),
    !existing ? h('p', { class: 'small muted' }, 'Tip: on Android, open the post in LinkedIn, tap Share, then choose TTI Amplify. The link fills in for you.') : null,
    h('div', { class: 'field' }, h('div', { class: 'row' }, h('label', { for: 'e-url', class: 'label grow' }, 'LinkedIn post link'), paste), url),
    h('div', { class: 'field' }, h('label', { for: 'e-title' }, 'Title staff will see'), title),
    h('div', { class: 'field' }, h('label', { for: 'e-note' }, 'Guidance for staff (optional)'), note),
    h('div', { class: 'field' }, h('span', { class: 'label' }, 'Post image (optional)'), image.el),
    h('div', { class: 'field' }, h('span', { class: 'label' }, 'Ask staff to'), toggles),
    h('div', { class: 'field' }, h('label', { for: 'e-starters' }, 'Comment starters (optional)'), starters,
      h('span', { class: 'hint' }, 'Each person sees a different one and is asked to make it their own. Identical comments look fake on LinkedIn.')),
    h('div', { class: 'field' }, h('label', { for: 'e-date' }, 'Posted on'), date),
    h('div', { class: 'row-wrap mt-8' }, save, archive, h('a', { class: 'btn btn-ghost', href: existing ? `#/admin/post/${existing.id}` : '#/admin' }, 'Cancel'))));
  (existing ? title : url.value ? title : url).focus({ preventScroll: true });
}

// ponytail: a replaced or abandoned upload stays in storage (webp, ≤ ~150 KB); sweep the bucket if it ever matters.
function imagePicker(initial) {
  let path = initial;
  const el = h('div', { class: 'img-pick' });
  const file = h('input', { type: 'file', accept: 'image/*', hidden: true });
  const draw = () => mount(el, file,
    path ? h('img', { class: 'post-img', src: api.imageUrl(path), alt: '', width: 1200, height: 628 }) : null,
    h('div', { class: 'row' },
      h('button', { class: 'btn btn-soft btn-sm', type: 'button', onClick: () => file.click() }, icon('plus'), path ? 'Replace image' : 'Add image'),
      path ? h('button', { class: 'btn btn-ghost btn-sm', type: 'button', onClick: () => { path = null; draw(); } }, 'Remove') : null,
      path ? null : h('span', { class: 'hint' }, 'A screenshot of the post helps staff recognise it.')));
  file.addEventListener('change', () => {
    const chosen = file.files?.[0];
    file.value = '';
    if (!chosen) return;
    const btn = el.querySelector('.btn');
    busy(btn, async () => { path = await api.uploadPostImage(chosen); draw(); })
      .catch((err) => toast(errorText(err), { type: 'err' }));
  });
  draw();
  return { el, path: () => path };
}

function askSentence(asks) {
  const verbs = ACTIONS.filter((a) => asks.includes(a.key)).map((a) => VERB[a.key]);
  if (verbs.length < 2) return verbs[0] ?? 'react to';
  return `${verbs.slice(0, -1).join(', ')} and ${verbs.at(-1)}`;
}

export function announceText(post) {
  return `New on Tti's LinkedIn: "${post.title}"\n\nPlease ${askSentence(post.asks)} it, then tick it off in TTI Amplify:\n${postLink(post.id)}`;
}

const waHref = (text) => `https://wa.me/?text=${encodeURIComponent(text)}`;

function announceSheet(post) {
  const text = announceText(post);
  sheet(h('div', { class: 'stack' },
    h('div', null, h('h2', null, 'Post is live'), h('p', { class: 'sub' }, 'Staff see it in their feed now.')),
    pushStatus(post),
    h('p', { class: 'sub' }, 'Also tell them on WhatsApp:'),
    h('pre', { class: 'code-box small', style: { 'white-space': 'pre-wrap', margin: 0, 'font-family': 'inherit' } }, text),
    h('a', { class: 'btn btn-wa btn-block', href: waHref(text), target: '_blank', rel: 'noopener noreferrer' }, icon('send'), 'Send to WhatsApp'),
    h('div', { class: 'row' },
      h('button', { class: 'btn btn-ghost', type: 'button', style: { flex: 1 }, onClick: () => copyText(text, 'Message copied') }, icon('copy'), 'Copy'),
      h('button', { class: 'btn btn-soft', type: 'button', style: { flex: 1 }, onClick: () => closeSheet() }, 'Done'))),
  { label: 'Announce the post' });
}

function pushStatus(post) {
  const line = h('p', { class: 'honour', role: 'status' }, icon('bell'), 'Sending phone notifications…');
  api.notify(post.id, 'new')
    .then((r) => line.replaceChildren(icon('bell'), r.devices
      ? `Notification sent to ${r.people} ${r.people === 1 ? 'person' : 'people'} on ${r.sent} ${r.sent === 1 ? 'phone' : 'phones'}.`
      : 'No one has notifications on yet. WhatsApp is the way for now.'))
    .catch((err) => line.replaceChildren(icon('alert'), `Notifications not sent: ${errorText(err)}`));
  return line;
}

const REMIND_GAP_MS = 2 * 60 * 60 * 1000;

function pushRemindButton(post) {
  const since = post.last_reminded_at ? Date.now() - new Date(post.last_reminded_at).getTime() : Infinity;
  if (since < REMIND_GAP_MS) {
    return h('button', { class: 'btn btn-soft btn-sm', type: 'button', disabled: true, 'aria-disabled': 'true' },
      icon('bell'), `Reminded ${Math.max(1, Math.round(since / 60000))} min ago`);
  }
  const btn = h('button', { class: 'btn btn-soft btn-sm', type: 'button' }, icon('bell'), 'Push reminder');
  btn.addEventListener('click', () => busy(btn, async () => {
    const r = await api.notify(post.id, 'remind');
    const now = new Date().toISOString();
    state.posts = state.posts.map((p) => (p.id === post.id ? { ...p, last_reminded_at: now } : p));
    toast(r.devices
      ? `Reminder sent to ${r.people} ${r.people === 1 ? 'person' : 'people'} who haven't ticked yet.`
      : 'No pending person has notifications on. Use the WhatsApp reminder.', { type: r.devices ? 'ok' : 'info', ms: 6000 });
    btn.replaceWith(pushRemindButton({ ...post, last_reminded_at: now }));
  }).catch((err) => toast(errorText(err), { type: 'err' })));
  return btn;
}

// Report -----------------------------------------------------------------------------------

async function renderReport(body, id) {
  const post = state.posts.find((p) => p.id === id);
  if (!post) { body.replaceChildren(failBox(new Error('Post not found.'))); return; }
  body.replaceChildren(skeleton(3, '110px'));
  let rows;
  try {
    rows = await api.adminPostReport(id);
  } catch (err) {
    body.replaceChildren(failBox(err));
    return;
  }
  const done = rows.filter((r) => r.confirmed_at);
  const openedOnly = rows.filter((r) => r.opened_at && !r.confirmed_at);
  const pct = rows.length ? Math.round((done.length / rows.length) * 100) : 0;
  const listHost = h('div');
  const drawList = () => listHost.replaceChildren(peopleList(rows, post));

  const chip = (key, label, n) => h('button', { class: 'tab', type: 'button', 'aria-selected': String(reportFilter === key),
    onClick: (e) => { reportFilter = key; e.currentTarget.parentElement.querySelectorAll('.tab').forEach((t) => t.setAttribute('aria-selected', String(t === e.currentTarget))); drawList(); } },
  label, h('span', { class: 'count' }, String(n)));

  const admin = isAdmin();
  body.replaceChildren(
    h('a', { class: 'btn btn-ghost btn-sm', href: '#/admin' }, icon('chevronLeft'), 'All posts'),
    h('div', { class: 'card card-pad stack mt-16' },
      h('div', { class: 'row small muted' }, h('span', null, relDate(post.posted_on)), post.archived ? h('span', { class: 'badge off' }, 'Archived') : null),
      h('h2', { style: { 'font-size': '24px' } }, post.title),
      post.note ? h('p', { class: 'muted' }, post.note) : null,
      h('div', { class: 'row-wrap' },
        h('a', { class: 'btn btn-soft btn-sm', href: post.url, target: '_blank', rel: 'noopener noreferrer' }, icon('external'), 'Open post'),
        admin ? h('a', { class: 'btn btn-ghost btn-sm', href: `#/admin/edit/${post.id}` }, icon('edit'), 'Edit') : null,
        admin ? h('a', { class: 'btn btn-wa btn-sm', href: waHref(announceText(post)), target: '_blank', rel: 'noopener noreferrer' }, icon('send'), 'Announce') : null,
        h('a', { class: 'btn btn-wa btn-sm', href: waHref(reminderText(post, rows)), target: '_blank', rel: 'noopener noreferrer' }, icon('send'), 'WhatsApp remind'),
        admin && !post.archived ? pushRemindButton(post) : null,
        h('button', { class: 'btn btn-ghost btn-sm', type: 'button', onClick: () => exportCsv(post, rows) }, icon('download'), 'CSV'))),
    h('div', { class: 'kpis mt-16' }, kpi(`${pct}%`, 'Engaged'), kpi(`${done.length}/${rows.length}`, 'Done'), kpi(String(openedOnly.length), 'Opened only')),
    resultsCard(post, admin),
    h('div', { class: 'admin-grid two mt-16' },
      h('div', { class: 'card card-pad' }, h('h3', { style: { 'font-size': '17px', 'margin-bottom': '14px' } }, 'By department'), deptBars(rows)),
      h('div', { class: 'card card-pad' }, h('h3', { style: { 'font-size': '17px', 'margin-bottom': '14px' } }, 'Actions logged'), actionBars(post, rows))),
    h('div', { class: 'section-title' }, h('h2', null, 'People'),
      h('div', { class: 'filters', role: 'tablist' }, chip('all', 'All', rows.length), chip('done', 'Done', done.length), chip('pending', 'Pending', rows.length - done.length))),
    listHost);
  drawList();
}

function groupByDept(rows) {
  const groups = new Map();
  for (const r of rows) {
    const key = r.department ?? 'No department';
    const g = groups.get(key) ?? { total: 0, done: 0 };
    groups.set(key, { total: g.total + 1, done: g.done + (r.confirmed_at ? 1 : 0) });
  }
  return [...groups.entries()];
}

function deptBars(rows) {
  const groups = groupByDept(rows).sort((a, b) => b[1].done / b[1].total - a[1].done / a[1].total);
  if (!groups.length) return h('p', { class: 'muted small' }, 'No members yet.');
  return h('div', { class: 'dept-bars' }, groups.map(([name, g]) => {
    const pct = Math.round((g.done / g.total) * 100);
    return h('div', { class: 'dept-bar' }, h('span', null, name),
      h('div', { class: 'progress' }, h('i', { style: { width: `${pct}%` } })), h('b', null, `${g.done}/${g.total}`));
  }));
}

function actionBars(post, rows) {
  const total = rows.length || 1;
  return h('div', { class: 'dept-bars' }, ACTIONS.filter((a) => post.asks.includes(a.key)).map((a) => {
    const n = rows.filter((r) => r[FLAG[a.key]]).length;
    return h('div', { class: 'dept-bar' }, h('span', { class: 'row' }, a.past),
      h('div', { class: 'progress' }, h('i', { style: { width: `${Math.round((n / total) * 100)}%`, background: `var(--act-${a.key})` } })),
      h('b', null, String(n)));
  }));
}

function peopleList(rows, post) {
  const shown = rows.filter((r) => (reportFilter === 'done' ? r.confirmed_at : reportFilter === 'pending' ? !r.confirmed_at : true));
  if (!shown.length) return h('div', { class: 'empty' }, icon('teams'), h('h3', null, reportFilter === 'pending' ? 'Everyone is done' : 'No one here yet'));
  const asks = ACTIONS.filter((a) => post.asks.includes(a.key));
  return h('ul', { class: 'card list' }, shown.map((r) => h('li', null,
    h('span', { class: 'avatar', style: { '--c': avatarColor(r.user_id) } }, initials(r.full_name)),
    h('div', { class: 'grow' }, h('div', { class: 'name' }, r.full_name),
      h('div', { class: 'meta' }, `${r.department ?? 'No department'} · ${r.confirmed_at ? `ticked ${timeAgo(r.confirmed_at)}` : r.opened_at ? 'opened, not ticked' : 'not opened'}`)),
    h('span', { class: 'mini-acts' }, asks.map((a) => h('span', { class: r[FLAG[a.key]] ? 'on' : '', style: { '--c': `var(--act-${a.key})` }, title: a.past }, icon(a.key)))))));
}

function timeAgo(iso) {
  const mins = Math.round((Date.now() - new Date(iso).getTime()) / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins} min ago`;
  const hours = Math.round(mins / 60);
  if (hours < 24) return `${hours} h ago`;
  return new Date(iso).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });
}

function reminderText(post, rows) {
  const pending = groupByDept(rows).map(([name, g]) => [name, g.total - g.done]).filter(([, n]) => n > 0);
  const total = pending.reduce((s, [, n]) => s + n, 0);
  const lines = pending.map(([name, n]) => `• ${name}: ${n}`).join('\n');
  return `Gentle reminder: our LinkedIn post "${post.title}" still needs ${total} of us.\n\nPending by team:\n${lines}\n\nOpen it in TTI Amplify:\n${postLink(post.id)}`;
}

const LI_FIELDS = [['li_impressions', 'Impressions'], ['li_reactions', 'Reactions'], ['li_comments', 'Comments'], ['li_reposts', 'Reposts']];

function resultsCard(post, admin) {
  const title = h('h3', { style: { 'font-size': '17px' } }, 'LinkedIn results');
  const when = post.li_recorded_at ? `Recorded ${relDate(post.li_recorded_at.slice(0, 10)).replace(/^(Today|Yesterday)/, (w) => w.toLowerCase())}.` : 'Not recorded yet.';
  if (!admin) {
    if (!post.li_recorded_at) return null;
    return h('div', { class: 'card card-pad stack-s mt-16' }, title,
      h('div', { class: 'kpis kpis-4' }, LI_FIELDS.map(([k, label]) => kpi(Number(post[k] ?? 0).toLocaleString('en-GB'), label))),
      h('p', { class: 'hint' }, when));
  }
  const inputs = LI_FIELDS.map(([k, label]) => [k, h('input', { id: `li-${k}`, class: 'input', type: 'number', min: 0, step: 1, inputmode: 'numeric', value: post[k] ?? '', 'aria-label': label })]);
  const save = h('button', { class: 'btn btn-soft btn-sm', type: 'button' }, 'Save results');
  save.addEventListener('click', () => busy(save, async () => {
    const patch = Object.fromEntries(inputs.map(([k, el]) => [k, el.value === '' ? null : Math.max(0, Math.trunc(Number(el.value)))]));
    if (Object.values(patch).some((v) => Number.isNaN(v))) throw new Error('Use whole numbers only.');
    const saved = await api.updatePost(post.id, { ...patch, li_recorded_at: new Date().toISOString() });
    state.posts = state.posts.map((p) => (p.id === saved.id ? saved : p));
    toast('Results saved', { type: 'ok' });
  }).catch((err) => toast(errorText(err), { type: 'err' })));
  return h('div', { class: 'card card-pad stack-s mt-16' }, title,
    h('p', { class: 'hint' }, `Copy these from the Tti page's post analytics about a week after posting. ${when}`),
    h('div', { class: 'li-grid' }, inputs.map(([k, el], i) => h('div', { class: 'field' }, h('label', { for: `li-${k}` }, LI_FIELDS[i][1]), el))),
    h('div', null, save));
}

function monthSheet() {
  const month = h('input', { id: 'csv-month', class: 'input', type: 'month', value: new Date().toISOString().slice(0, 7) });
  const go = h('button', { class: 'btn btn-primary btn-block', type: 'button' }, icon('download'), 'Download');
  go.addEventListener('click', () => busy(go, async () => {
    await exportMonth(month.value);
    closeSheet();
  }).catch((err) => toast(errorText(err), { type: 'err' })));
  sheet(h('div', { class: 'stack' },
    h('div', null, h('h2', null, 'Monthly CSV'), h('p', { class: 'sub' }, 'One row per person, one column per post that month. Opens in Excel.')),
    h('div', { class: 'field' }, h('label', { for: 'csv-month' }, 'Month'), month), go),
  { label: 'Monthly CSV' });
}

const LETTER = { reacted: 'R', commented: 'C', reposted: 'P' };

async function exportMonth(month) {
  if (!/^\d{4}-\d{2}$/.test(month)) throw new Error('Choose a month.');
  const posts = state.posts.filter((p) => p.posted_on.startsWith(month)).sort((a, b) => a.posted_on.localeCompare(b.posted_on));
  if (!posts.length) throw new Error('No posts in that month.');
  const reports = await Promise.all(posts.map((p) => api.adminPostReport(p.id)));
  const people = new Map();
  reports.forEach((rows, i) => rows.forEach((r) => {
    const person = people.get(r.user_id) ?? { name: r.full_name, dept: r.department, cells: Array(posts.length).fill('') };
    const acts = Object.keys(LETTER).filter((k) => r[k]).map((k) => LETTER[k]).join(' ');
    person.cells[i] = r.confirmed_at ? acts || 'done' : r.opened_at ? 'opened' : '';
    people.set(r.user_id, person);
  }));
  const rows = [...people.values()].sort((a, b) => (a.dept ?? '').localeCompare(b.dept ?? '') || a.name.localeCompare(b.name))
    .map((p) => [p.name, p.dept ?? '', ...p.cells, String(p.cells.filter((c) => c && c !== 'opened').length)]);
  downloadCsv(`amplify-${month}.csv`, ['Name', 'Department', ...posts.map((p) => `${p.posted_on} ${p.title}`), 'Posts done'], rows);
  toast('R = reacted, C = commented, P = reposted.', { ms: 6000 });
}

function csvCell(value) {
  let s = value == null ? '' : String(value);
  if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export function downloadCsv(filename, header, rows) {
  const csv = [header, ...rows].map((r) => r.map(csvCell).join(',')).join('\r\n');
  const url = URL.createObjectURL(new Blob([`﻿${csv}`], { type: 'text/csv;charset=utf-8' }));
  const a = h('a', { href: url, download: filename });
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function exportCsv(post, rows) {
  const slug = post.title.toLowerCase().replace(/[^a-z0-9]+/g, '-').slice(0, 40);
  downloadCsv(`amplify-${post.posted_on}-${slug}.csv`,
    ['Name', 'Department', 'Opened', 'Reacted', 'Commented', 'Reposted', 'Confirmed'],
    rows.map((r) => [r.full_name, r.department, r.opened_at ?? '', r.reacted ? 'yes' : 'no', r.commented ? 'yes' : 'no', r.reposted ? 'yes' : 'no', r.confirmed_at ?? '']));
}

