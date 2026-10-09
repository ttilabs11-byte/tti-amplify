// Admin: post list, add/edit post, per-post report.
import * as api from '../api.js';
import { h, icon, ACTIONS, sheet, closeSheet, toast, busy, errorText, relDate, initials, avatarColor, copyText } from '../ui.js';
import { state, livePosts, postLink } from '../store.js';
import { renderPeople, renderSettings } from './admin-people.js';

const FLAG = { react: 'reacted', comment: 'commented', repost: 'reposted' };
const VERB = { react: 'react to', comment: 'comment on', repost: 'repost' };
let listFilter = 'live';
let reportFilter = 'all';

export async function renderAdmin(page, parts) {
  page.classList.add('wide');
  const sub = parts[0] ?? 'posts';
  const nav = h('nav', { class: 'subnav', 'aria-label': 'Admin sections' },
    [['posts', 'Posts', '#/admin'], ['people', 'People', '#/admin/people'], ['settings', 'Invite & settings', '#/admin/settings']]
      .map(([key, label, href]) => h('a', { href, 'aria-current': (sub === key || (key === 'posts' && ['new', 'edit', 'post'].includes(sub))) ? 'page' : null }, label)));
  const body = h('div');
  page.replaceChildren(h('div', { class: 'hello' }, h('div', null, h('h1', null, 'Admin'), h('p', null, 'Posts, people and invites.'))), nav, body);
  if (sub === 'new') return renderEditor(body, null);
  if (sub === 'edit') return renderEditor(body, parts[1]);
  if (sub === 'post') return renderReport(body, parts[1]);
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
  body.replaceChildren(
    h('div', { class: 'kpis' },
      kpi(String(live.length), 'Live posts'), kpi(String(members), 'Members'), kpi(`${avg}%`, 'Avg. done')),
    h('div', { class: 'section-title' },
      h('div', { class: 'filters', role: 'tablist' }, chip('live', 'Live'), chip('archived', 'Archived')),
      h('a', { class: 'btn btn-primary btn-sm', href: '#/admin/new' }, icon('plus'), 'Add post')),
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
    const row = {
      url: cleanUrl, title: title.value.trim(), note: note.value.trim() || null,
      asks: ACTIONS.map((a) => a.key).filter((k) => asks.has(k)), posted_on: date.value || today,
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
    h('div', { class: 'field' }, h('span', { class: 'label' }, 'Ask staff to'), toggles),
    h('div', { class: 'field' }, h('label', { for: 'e-date' }, 'Posted on'), date),
    h('div', { class: 'row-wrap mt-8' }, save, archive, h('a', { class: 'btn btn-ghost', href: existing ? `#/admin/post/${existing.id}` : '#/admin' }, 'Cancel'))));
  (existing ? title : url.value ? title : url).focus({ preventScroll: true });
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
    h('div', null, h('h2', null, 'Post is live'), h('p', { class: 'sub' }, 'Staff see it in their feed now. Tell them on WhatsApp:')),
    h('pre', { class: 'code-box small', style: { 'white-space': 'pre-wrap', margin: 0, 'font-family': 'inherit' } }, text),
    h('a', { class: 'btn btn-wa btn-block', href: waHref(text), target: '_blank', rel: 'noopener noreferrer' }, icon('send'), 'Send to WhatsApp'),
    h('div', { class: 'row' },
      h('button', { class: 'btn btn-ghost', type: 'button', style: { flex: 1 }, onClick: () => copyText(text, 'Message copied') }, icon('copy'), 'Copy'),
      h('button', { class: 'btn btn-soft', type: 'button', style: { flex: 1 }, onClick: () => closeSheet() }, 'Done'))),
  { label: 'Announce the post' });
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

  body.replaceChildren(
    h('a', { class: 'btn btn-ghost btn-sm', href: '#/admin' }, icon('chevronLeft'), 'All posts'),
    h('div', { class: 'card card-pad stack mt-16' },
      h('div', { class: 'row small muted' }, h('span', null, relDate(post.posted_on)), post.archived ? h('span', { class: 'badge off' }, 'Archived') : null),
      h('h2', { style: { 'font-size': '24px' } }, post.title),
      post.note ? h('p', { class: 'muted' }, post.note) : null,
      h('div', { class: 'row-wrap' },
        h('a', { class: 'btn btn-soft btn-sm', href: post.url, target: '_blank', rel: 'noopener noreferrer' }, icon('external'), 'Open post'),
        h('a', { class: 'btn btn-ghost btn-sm', href: `#/admin/edit/${post.id}` }, icon('edit'), 'Edit'),
        h('a', { class: 'btn btn-wa btn-sm', href: waHref(announceText(post)), target: '_blank', rel: 'noopener noreferrer' }, icon('send'), 'Announce'),
        h('a', { class: 'btn btn-wa btn-sm', href: waHref(reminderText(post, rows)), target: '_blank', rel: 'noopener noreferrer' }, icon('send'), 'Remind'),
        h('button', { class: 'btn btn-ghost btn-sm', type: 'button', onClick: () => exportCsv(post, rows) }, icon('download'), 'CSV'))),
    h('div', { class: 'kpis mt-16' }, kpi(`${pct}%`, 'Engaged'), kpi(`${done.length}/${rows.length}`, 'Done'), kpi(String(openedOnly.length), 'Opened only')),
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

