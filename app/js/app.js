// Boot, routing and the app shell.
import * as api from './api.js';
import { h, icon, toast, errorText } from './ui.js';
import { state, setRenderer, loadCore, loadDepartments, isAdmin, isReporter, applyTheme, livePosts, inWindow } from './store.js';
import { renderAuth } from './views/auth.js';
import { renderHome, checkPending } from './views/home.js';
import { renderTeams, renderMe } from './views/me.js';
import { renderAdmin, cleanLinkedInUrl } from './views/admin-posts.js';
import { syncPush } from './push.js';

const root = document.getElementById('app');

// GitHub Pages cannot send X-Frame-Options or frame-ancestors, so refuse to run inside another site's frame.
if (window.top !== window.self) {
  root.replaceChildren();
  window.top.location.replace(window.self.location.href);
}

window.addEventListener('error', (e) => api.logClientError(e.message, e.error?.stack));
window.addEventListener('unhandledrejection', (e) => api.logClientError(e.reason?.message ?? String(e.reason), e.reason?.stack));
const REFRESH_AFTER_MS = 30_000;
let stopRealtime = null;
let booted = false;

const parseRoute = () => location.hash.replace(/^#\/?/, '').split('/').filter(Boolean);

const NAV = [
  { key: 'home', label: 'To do', icon: 'home', href: '#/home' },
  { key: 'teams', label: 'Teams', icon: 'teams', href: '#/teams' },
  { key: 'me', label: 'Me', icon: 'me', href: '#/me' },
  { key: 'admin', label: 'Admin', icon: 'admin', href: '#/admin', admin: true },
];

function shell(active, page) {
  const items = NAV.filter((n) => !n.admin || isReporter()).map((n) => (n.admin && !isAdmin() ? { ...n, label: 'Reports' } : n));
  const todo = livePosts().filter((p) => inWindow(p) && !state.engagements.get(p.id)?.confirmed_at).length;
  const current = (n) => (n.key === active ? 'page' : null);
  const topbar = h('header', { class: 'topbar' },
    h('a', { class: 'brand', href: '#/home', 'aria-label': 'TTI Amplify home' },
      h('img', { class: 'brand-mark', src: 'icons/mark.webp', alt: '', width: 38, height: 30 }),
      h('span', { class: 'brand-name' }, 'TTI ', h('span', null, 'Amplify'))),
    h('nav', { class: 'topnav', 'aria-label': 'Main' }, items.map((n) => h('a', { href: n.href, 'aria-current': current(n) }, n.label))),
    h('span', { class: 'spacer' }));
  const tabbar = h('nav', { class: 'tabbar', 'aria-label': 'Main' }, items.map((n) =>
    h('a', { href: n.href, 'aria-current': current(n) }, icon(n.icon), n.label,
      n.key === 'home' && todo ? h('span', { class: 'dot', 'aria-label': `${todo} to do` }, String(todo)) : null)));
  return h('div', { class: 'shell' }, topbar, h('main', { id: 'main' }, page), tabbar);
}

function blocked(message) {
  root.replaceChildren(h('div', { class: 'page', style: { 'padding-top': '80px' } },
    h('div', { class: 'empty' }, icon('lock'), h('h3', null, 'Account not available'), h('p', null, message),
      h('button', { class: 'btn btn-primary mt-16', type: 'button', onClick: () => api.signOut() }, 'Sign out'))));
}

let renderSeq = 0;

async function render() {
  const seq = ++renderSeq;
  const stale = () => seq !== renderSeq;
  if (!state.session) { renderAuth(root); return; }
  if (!state.profile) {
    try {
      state.profile = await api.getProfile(state.session.user.id);
    } catch (err) {
      if (!stale()) blocked(errorText(err));
      return;
    }
    if (stale()) return;
    if (!state.profile) { blocked('We could not find your profile. Ask HR for help.'); return; }
  }
  if (!state.profile.active) { blocked('Your access has been switched off. Ask HR if this is a mistake.'); return; }
  if (!state.loadedAt) {
    try {
      await Promise.all([loadCore(), state.departments.length ? null : loadDepartments()]);
    } catch (err) {
      if (!stale()) toast(errorText(err), { type: 'err', action: 'Retry', onAction: render, ms: 8000 });
      return;
    }
    if (stale()) return;
  }

  const [section = 'home', ...rest] = parseRoute();
  const page = h('div', { class: 'page' });
  const active = section === 'p' ? 'home' : section;
  if (section === 'admin' && !isReporter()) { location.replace('#/home'); return; }
  root.replaceChildren(shell(active, page));
  window.scrollTo({ top: 0 });

  if (section === 'teams') await renderTeams(page);
  else if (section === 'me') renderMe(page);
  else if (section === 'admin') await renderAdmin(page, rest);
  else {
    renderHome(page, { focusId: section === 'p' ? rest[0] : null });
    checkPending();
  }
}

setRenderer(() => render());

async function refreshData() {
  if (!state.session || !state.loadedAt || Date.now() - state.loadedAt < REFRESH_AFTER_MS) return;
  try {
    await loadCore();
    render();
  } catch { /* stay on cached data */ }
}

function startRealtime() {
  stopRealtime?.();
  stopRealtime = api.onPostsChange(async (payload) => {
    try {
      await loadCore();
    } catch {
      return;
    }
    const onHome = ['', 'home', 'p'].includes(parseRoute()[0] ?? '');
    const mine = payload.new?.created_by === state.profile?.id;
    if (payload.eventType === 'INSERT' && !payload.new?.archived && !mine) {
      toast(`New post: ${payload.new.title}`, { action: 'View', onAction: () => { location.hash = `#/p/${payload.new.id}`; }, ms: 7000 });
    }
    if (onHome && !document.querySelector('.sheet')) render();
  });
}

function captureShare() {
  const params = new URLSearchParams(location.search);
  if (!params.has('url') && !params.has('text')) return;
  const text = params.get('text') ?? '';
  const url = cleanLinkedInUrl(params.get('url') || text);
  const title = (params.get('title') || text.replace(/https?:\/\/\S+/g, '')).trim().replace(/\s+/g, ' ').slice(0, 120);
  try { sessionStorage.setItem('tti-amplify-share', JSON.stringify({ url, title })); } catch { /* optional */ }
  history.replaceState(null, '', `${location.pathname}#/admin/new`);
}

function watchEnvironment() {
  navigator.serviceWorker?.addEventListener('message', (e) => {
    if (e.data?.type !== 'open') return;
    const target = new URL(e.data.url, location.href);
    if (target.origin === location.origin) location.hash = target.hash || '#/home';
  });
  window.addEventListener('hashchange', render);
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState !== 'visible') return;
    checkPending();
    refreshData();
  });
  window.addEventListener('online', () => { state.online = true; render(); });
  window.addEventListener('offline', () => { state.online = false; render(); });
  window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault();
    state.installPrompt = e;
    if (state.session) render();
  });
  window.addEventListener('scroll', () => {
    document.querySelector('.topbar')?.classList.toggle('scrolled', window.scrollY > 4);
  }, { passive: true });
}

async function boot() {
  applyTheme();
  captureShare();
  watchEnvironment();
  const local = ['localhost', '127.0.0.1'].includes(location.hostname);
  if ('serviceWorker' in navigator && !local) navigator.serviceWorker.register('sw.js').catch(() => {});
  const departments = loadDepartments().catch(() => {});
  state.session = await api.getSession();
  if (!state.session) await departments;
  api.onAuthChange((session) => {
    const changedUser = session?.user?.id !== state.session?.user?.id;
    state.session = session;
    if (!booted || !changedUser) return;
    state.profile = null;
    state.loadedAt = 0;
    state.posts = [];
    state.engagements = new Map();
    if (session) startRealtime(); else stopRealtime?.();
    // Defer: Supabase calls inside the auth callback can deadlock the auth lock.
    setTimeout(() => { render(); if (session) syncPush().catch(() => {}); }, 0);
  });
  booted = true;
  if (state.session) { startRealtime(); syncPush().catch(() => {}); }
  await render();
}

boot().catch((err) => {
  root.replaceChildren(h('div', { class: 'page', style: { 'padding-top': '80px' } },
    h('div', { class: 'empty' }, icon('alert'), h('h3', null, 'TTI Amplify could not start'), h('p', null, errorText(err)),
      h('button', { class: 'btn btn-primary mt-16', type: 'button', onClick: () => location.reload() }, 'Reload'))));
});
