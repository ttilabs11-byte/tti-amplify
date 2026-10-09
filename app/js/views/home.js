// Home feed: summary, To do / Done tabs, post cards and the "what did you do?" confirm sheet.
import * as api from '../api.js';
import { h, mount, icon, ACTIONS, sheet, closeSheet, toast, busy, errorText, relDate, isFresh, haptic } from '../ui.js';
import {
  state, livePosts, setEngagement, setPending, getPending, clearPending, MIN_AWAY_MS, rerender, getPref, setPref,
} from '../store.js';

const FLAG = { react: 'reacted', comment: 'commented', repost: 'reposted' };
const RING_R = 48;
const RING_C = 2 * Math.PI * RING_R;
const STAGGER_MS = 45;

let tab = 'todo';
let sheetPostId = null;

const isDone = (postId) => Boolean(state.engagements.get(postId)?.confirmed_at);

export function renderHome(page, { focusId } = {}) {
  if (focusId) tab = isDone(focusId) ? 'done' : 'todo';
  const posts = livePosts();
  const todo = posts.filter((p) => !isDone(p.id));
  const done = posts.filter((p) => isDone(p.id));
  const list = tab === 'todo' ? todo : done;

  mount(page,
    offlineBanner(),
    hello(),
    summaryCard(posts, done.length),
    installBanner(),
    tabsRow(page, todo.length, done.length),
    h('section', { class: 'feed', 'aria-label': tab === 'todo' ? 'Posts to do' : 'Posts done' },
      list.length ? list.map(postCard) : emptyState(posts.length)),
  );
  if (focusId) flashCard(page, focusId);
}

function hello() {
  const now = new Date();
  const hour = now.getHours();
  const part = hour < 12 ? 'Good morning' : hour < 17 ? 'Good afternoon' : 'Good evening';
  const first = (state.profile?.full_name ?? '').split(' ')[0];
  const day = now.toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long' });
  return h('div', { class: 'hello' }, h('div', null, h('p', { class: 'eyebrow' }, day), h('h1', null, `${part}, ${first}`)));
}

function streakOf(posts) {
  let streak = 0;
  for (const p of posts) {
    if (!isDone(p.id)) break;
    streak += 1;
  }
  return streak;
}

function actionsOf(posts) {
  return posts.reduce((sum, p) => {
    const e = state.engagements.get(p.id);
    return sum + (e ? Number(e.reacted) + Number(e.commented) + Number(e.reposted) : 0);
  }, 0);
}

function summaryCard(posts, doneCount) {
  const total = posts.length;
  const pct = total ? Math.round((doneCount / total) * 100) : 0;
  const ring = h('div', { class: 'ring', role: 'img', 'aria-label': `${doneCount} of ${total} posts done` });
  ring.innerHTML = `<svg viewBox="0 0 112 112"><defs><linearGradient id="ringGrad" x1="0" y1="0" x2="1" y2="1">`
    + `<stop offset="0" stop-color="#FFFFFF"/><stop offset="1" stop-color="#8FA7CE"/></linearGradient></defs>`
    + `<circle class="track" cx="56" cy="56" r="${RING_R}" fill="none" stroke-width="10"/>`
    + `<circle class="bar" cx="56" cy="56" r="${RING_R}" fill="none" stroke-width="10" stroke-dasharray="${RING_C}" stroke-dashoffset="${RING_C}"/></svg>`;
  ring.append(h('div', { class: 'num' }, h('b', null, `${pct}%`), h('small', null, `${doneCount} of ${total}`)));
  const bar = ring.querySelector('.bar');
  requestAnimationFrame(() => requestAnimationFrame(() => bar.setAttribute('stroke-dashoffset', String(RING_C * (1 - pct / 100)))));

  const streak = streakOf(posts);
  const todo = total - doneCount;
  const headline = !total ? 'Nothing to do yet' : todo ? `${todo} ${todo === 1 ? 'post needs' : 'posts need'} you` : 'All caught up';
  const line = !total ? 'New posts will appear here.' : todo ? 'Early engagement lifts a post the most.' : 'Thank you for lifting every Tti post.';
  return h('section', { class: 'summary', 'aria-label': 'Your progress' }, ring,
    h('div', { class: 'summary-text' },
      h('b', { class: 'headline' }, headline),
      h('span', { class: 'line' }, line),
      h('div', { class: 'chips' },
        h('span', { class: 'chip' }, icon('flame'), `${streak} in a row`),
        h('span', { class: 'chip' }, icon('check'), `${actionsOf(posts)} ${actionsOf(posts) === 1 ? 'action' : 'actions'}`))));
}

function installBanner() {
  if (!state.installPrompt || getPref('installDismissed', '0') === '1') return null;
  const banner = h('div', { class: 'banner install' }, icon('phone'),
    h('div', { class: 'grow' }, h('b', null, 'Install the app'), h('small', null, 'One tap from your home screen')),
    h('button', { class: 'btn btn-primary btn-sm', type: 'button', onClick: install }, 'Install'),
    h('button', { class: 'icon-btn', type: 'button', 'aria-label': 'Not now', onClick: () => { setPref('installDismissed', '1'); banner.remove(); } }, icon('x')));
  return banner;
}

export async function install() {
  const prompt = state.installPrompt;
  if (!prompt) return;
  prompt.prompt();
  const { outcome } = await prompt.userChoice;
  state.installPrompt = null;
  if (outcome === 'accepted') toast('Installed. Find TTI Amplify on your home screen.', { type: 'ok' });
  rerender();
}

function offlineBanner() {
  if (state.online) return null;
  return h('div', { class: 'banner offline', role: 'status' }, icon('wifiOff'), "You're offline. Ticks will need a connection.");
}

function tabsRow(page, todoCount, doneCount) {
  const tabBtn = (key, label, count) => h('button', {
    class: 'tab', type: 'button', role: 'tab', 'aria-selected': String(tab === key),
    onClick: () => { tab = key; renderHome(page); },
  }, label, h('span', { class: 'count' }, String(count)));
  return h('div', { class: 'tabs', role: 'tablist', 'aria-label': 'Posts' }, tabBtn('todo', 'To do', todoCount), tabBtn('done', 'Done', doneCount));
}

function emptyState(totalPosts) {
  if (!totalPosts) {
    return h('div', { class: 'empty' }, icon('sparkle'), h('h3', null, 'No posts yet'),
      h('p', null, 'When Tti posts on LinkedIn, it appears here and in the staff WhatsApp group.'));
  }
  if (tab === 'todo') {
    return h('div', { class: 'empty' }, icon('party'), h('h3', null, "You're all caught up"),
      h('p', null, 'Thank you. New posts will appear here as soon as they go live.'));
  }
  return h('div', { class: 'empty' }, icon('react'), h('h3', null, 'Nothing ticked yet'),
    h('p', null, 'Open a post from To do, engage on LinkedIn, then confirm it here.'));
}

function postCard(post, index) {
  const eng = state.engagements.get(post.id);
  const opened = Boolean(eng);
  const confirmed = Boolean(eng?.confirmed_at);
  const asks = ACTIONS.filter((a) => post.asks.includes(a.key));
  const doneCount = asks.filter((a) => eng?.[FLAG[a.key]]).length;

  const meta = h('div', { class: 'post-meta' },
    h('span', null, relDate(post.posted_on)),
    !confirmed && isFresh(post.posted_on) ? h('span', { class: 'chip-new' }, 'New') : null,
    h('span', { class: 'grow' }),
    confirmed ? h('span', { class: 'chip-done' }, icon('check'), doneCount === asks.length ? 'Done' : `${doneCount} of ${asks.length}`) : null);

  const acts = h('div', { class: 'acts', 'aria-label': 'Asked actions' }, asks.map((a) => {
    const on = Boolean(eng?.[FLAG[a.key]]);
    return h('span', { class: `act${on ? ' on' : ''}`, dataset: { a: a.key } },
      on ? icon('check', 'tick') : icon(a.key), on ? a.past : a.label);
  }));

  const card = h('article', { class: 'post', id: `post-${post.id}`, dataset: { id: post.id }, style: { 'animation-delay': `${index * STAGGER_MS}ms` } },
    meta, h('h2', null, post.title),
    post.note ? h('div', { class: 'note' }, icon('idea'), h('span', null, post.note)) : null,
    acts, cardFoot(post, opened, confirmed));
  if (!opened) card.append(h('p', { class: 'lock-hint' }, icon('lock'), 'Open it first to unlock ticking.'));
  return card;
}

function openLink(post, label, cls) {
  return h('a', {
    class: cls, href: post.url, target: '_blank', rel: 'noopener noreferrer',
    onClick: () => handleOpen(post),
  }, label, icon('external'));
}

function cardFoot(post, opened, confirmed) {
  if (!opened) return h('div', { class: 'post-foot' }, openLink(post, 'Open on LinkedIn', 'btn btn-primary'));
  if (!confirmed) {
    return h('div', { class: 'post-foot' },
      h('button', { class: 'btn btn-primary', type: 'button', onClick: () => openConfirm(post) }, icon('check'), "I've done it"),
      openLink(post, 'Open', 'btn btn-ghost'));
  }
  return h('div', { class: 'post-foot' },
    openLink(post, 'Open post', 'btn btn-ghost btn-sm'),
    h('button', { class: 'btn btn-soft btn-sm', type: 'button', onClick: () => openConfirm(post) }, icon('edit'), 'Edit'));
}

function handleOpen(post) {
  setPending(post.id);
  api.markOpened(post.id)
    .then((row) => { setEngagement(row); })
    .catch(() => { /* retried when confirming */ });
}

function flashCard(page, postId) {
  requestAnimationFrame(() => {
    const el = page.querySelector(`#post-${CSS.escape(postId)}`);
    if (!el) return;
    el.scrollIntoView({ behavior: 'smooth', block: 'center' });
    el.classList.add('flash');
    setTimeout(() => el.classList.remove('flash'), 2400);
  });
}

// Return-from-LinkedIn ---------------------------------------------------------------

export function checkPending() {
  const pending = getPending();
  if (!pending || sheetPostId || Date.now() - pending.at < MIN_AWAY_MS) return;
  const post = livePosts().find((p) => p.id === pending.postId);
  if (!post) { clearPending(); return; }
  openConfirm(post, { welcome: true });
}

export function openConfirm(post, { welcome = false } = {}) {
  const eng = state.engagements.get(post.id);
  const asks = ACTIONS.filter((a) => post.asks.includes(a.key));
  const picked = new Set(asks.filter((a) => eng?.[FLAG[a.key]]).map((a) => a.key));
  const wasConfirmed = Boolean(eng?.confirmed_at);

  const save = h('button', { class: 'btn btn-primary', type: 'button' });
  const updateSave = () => {
    const n = picked.size;
    const confirmLabel = wasConfirmed ? 'Save changes' : `Confirm ${n} ${n === 1 ? 'action' : 'actions'}`;
    save.textContent = n ? confirmLabel : wasConfirmed ? 'Clear my ticks' : 'Pick what you did';
    if (!n && !wasConfirmed) save.setAttribute('aria-disabled', 'true');
    else save.removeAttribute('aria-disabled');
  };

  const choices = h('div', { class: 'choices', role: 'group', 'aria-label': 'What you did' }, asks.map((a) => {
    const btn = h('button', { class: 'choice', type: 'button', dataset: { a: a.key }, 'aria-pressed': String(picked.has(a.key)) },
      h('span', { class: 'ic' }, icon(a.key)),
      h('span', null, h('b', null, `I ${a.past.toLowerCase()}`), h('small', null, a.hint)),
      h('span', { class: 'box' }, icon('check')));
    btn.addEventListener('click', () => {
      if (picked.has(a.key)) picked.delete(a.key); else picked.add(a.key);
      btn.setAttribute('aria-pressed', String(picked.has(a.key)));
      haptic(8);
      updateSave();
    });
    return btn;
  }));

  updateSave();
  save.addEventListener('click', () => busy(save, () => submit(post, picked, wasConfirmed)).catch((err) => toast(errorText(err), { type: 'err' })));

  sheetPostId = post.id;
  sheet(h('div', null,
    h('div', { class: 'sheet-head' }, h('div', null,
      h('h2', null, welcome ? 'Welcome back' : 'What did you do?'),
      h('p', { class: 'sub' }, welcome ? 'Tick what you did on this post:' : 'Update your ticks for this post:'),
      h('p', { class: 'sub' }, h('b', null, post.title)))),
    choices,
    h('p', { class: 'honour' }, icon('shield'), 'Ticking confirms you really did it on LinkedIn. It runs on trust, so please be honest.'),
    h('div', { class: 'sheet-actions' },
      h('button', { class: 'btn btn-ghost', type: 'button', onClick: () => closeSheet() }, wasConfirmed ? 'Cancel' : 'Not yet'), save)),
  { label: 'Confirm what you did', onClose: () => { sheetPostId = null; clearPending(); } });
}

async function submit(post, picked, wasConfirmed) {
  if (!state.engagements.has(post.id)) setEngagement(await api.markOpened(post.id));
  const row = await api.confirmEngagement(post.id, {
    react: picked.has('react'), comment: picked.has('comment'), repost: picked.has('repost'),
  });
  setEngagement(row);
  closeSheet();
  haptic(18);
  const remaining = livePosts().filter((p) => !isDone(p.id)).length;
  if (!picked.size) toast('Ticks cleared.');
  else if (!remaining) toast("That's every post. Thank you!", { type: 'ok' });
  else toast(wasConfirmed ? 'Updated. Thank you.' : 'Logged. Thank you for lifting Tti.', { type: 'ok' });
  rerender();
  celebrate();
}

function celebrate() {
  const ring = document.querySelector('.summary .ring');
  if (!ring || matchMedia('(prefers-reduced-motion: reduce)').matches) return;
  const colors = ['#FFFFFF', '#9FBCEB', '#6189B5', '#8FA7CE'];
  const burst = h('div', { class: 'burst', 'aria-hidden': 'true' });
  for (let i = 0; i < 14; i++) {
    burst.append(h('i', { style: { '--r': `${(360 / 14) * i}deg`, '--d': `${64 + (i % 3) * 14}px`, '--c': colors[i % colors.length] } }));
  }
  ring.append(burst);
  setTimeout(() => burst.remove(), 1000);
}
