// App state shared by the views, plus the "pending confirm" record that survives the LinkedIn hop.
import * as api from './api.js';

export const state = {
  session: null,
  profile: null,
  departments: [],
  posts: [],
  engagements: new Map(),
  settings: { active_days: 14, remind_after_hours: 4, quiet_hours: true, show_top: false },
  installPrompt: null,
  online: navigator.onLine,
  loadedAt: 0,
};

let renderer = () => {};
export const setRenderer = (fn) => { renderer = fn; };
export const rerender = () => renderer();

export const isAdmin = () => state.profile?.role === 'admin' && state.profile?.active;
export const isHod = () => state.profile?.role === 'hod' && state.profile?.active;
export const isReporter = () => isAdmin() || isHod();

// Points and levels -------------------------------------------------------------------
export const POINTS = { react: 1, comment: 3, repost: 3 };
export const LEVELS = [
  { name: 'Starter', min: 0 }, { name: 'Supporter', min: 10 }, { name: 'Amplifier', min: 40 },
  { name: 'Champion', min: 100 }, { name: 'Ambassador', min: 250 },
];
export const pointsOf = (e) => (e ? Number(e.reacted) * POINTS.react + Number(e.commented) * POINTS.comment + Number(e.reposted) * POINTS.repost : 0);

export function myPoints() {
  const monthStart = new Date();
  monthStart.setDate(1);
  monthStart.setHours(0, 0, 0, 0);
  let total = 0;
  let month = 0;
  for (const e of state.engagements.values()) {
    if (!e.confirmed_at) continue;
    const pts = pointsOf(e);
    total += pts;
    if (new Date(e.confirmed_at) >= monthStart) month += pts;
  }
  const levelIndex = LEVELS.findLastIndex((l) => total >= l.min);
  const next = LEVELS[levelIndex + 1] ?? null;
  return { total, month, level: LEVELS[levelIndex].name, next: next?.name ?? null, toNext: next ? next.min - total : 0 };
}

/** Posts inside the active window count; older unticked posts stop nagging. */
const DAY_MS = 86_400_000;
export function inWindow(post) {
  const days = Number(state.settings.active_days) || 14;
  return Date.now() - new Date(`${post.posted_on}T00:00:00`).getTime() < days * DAY_MS;
}
export const livePosts = () => state.posts.filter((p) => !p.archived);
export const deptName = (id) => state.departments.find((d) => d.id === id)?.name ?? 'No department';

export async function loadDepartments() {
  state.departments = await api.getDepartments();
  return state.departments;
}

export async function loadCore() {
  const userId = state.session.user.id;
  const [posts, engagements, settings] = await Promise.all([api.getPosts(), api.getMyEngagements(userId), api.getSettings()]);
  state.posts = posts;
  state.settings = { ...state.settings, ...settings };
  state.engagements = new Map(engagements.map((e) => [e.post_id, e]));
  state.loadedAt = Date.now();
}

export function setEngagement(row) {
  const next = new Map(state.engagements);
  next.set(row.post_id, row);
  state.engagements = next;
}

// Pending confirm --------------------------------------------------------------------

const PENDING_KEY = 'tti-amplify-pending';
const PENDING_TTL_MS = 2 * 60 * 60 * 1000;
export const MIN_AWAY_MS = 2500;

export function setPending(postId) {
  try { localStorage.setItem(PENDING_KEY, JSON.stringify({ postId, at: Date.now(), user: state.profile?.id })); } catch { /* storage optional */ }
}

export function getPending() {
  try {
    const raw = JSON.parse(localStorage.getItem(PENDING_KEY) ?? 'null');
    // Tied to the user so a shared phone never asks the next person about someone else's open.
    if (!raw?.postId || raw.user !== state.profile?.id || Date.now() - raw.at > PENDING_TTL_MS) return null;
    return raw;
  } catch {
    return null;
  }
}

export function clearPending() {
  try { localStorage.removeItem(PENDING_KEY); } catch { /* storage optional */ }
}

// Preferences -----------------------------------------------------------------------

export function getPref(key, fallback) {
  try { return localStorage.getItem(`tti-amplify-${key}`) ?? fallback; } catch { return fallback; }
}

export function setPref(key, value) {
  try { localStorage.setItem(`tti-amplify-${key}`, value); } catch { /* storage optional */ }
}

export function applyTheme(theme = getPref('theme', 'auto')) {
  const rootEl = document.documentElement;
  if (theme === 'auto') delete rootEl.dataset.theme;
  else rootEl.dataset.theme = theme;
}

export const APP_URL = new URL('./', location.href).href;
export const postLink = (id) => `${APP_URL}#/p/${id}`;
