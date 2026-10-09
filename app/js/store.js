// App state shared by the views, plus the "pending confirm" record that survives the LinkedIn hop.
import * as api from './api.js';

export const state = {
  session: null,
  profile: null,
  departments: [],
  posts: [],
  engagements: new Map(),
  installPrompt: null,
  online: navigator.onLine,
  loadedAt: 0,
};

let renderer = () => {};
export const setRenderer = (fn) => { renderer = fn; };
export const rerender = () => renderer();

export const isAdmin = () => state.profile?.role === 'admin' && state.profile?.active;
export const livePosts = () => state.posts.filter((p) => !p.archived);
export const deptName = (id) => state.departments.find((d) => d.id === id)?.name ?? 'No department';

export async function loadDepartments() {
  state.departments = await api.getDepartments();
  return state.departments;
}

export async function loadCore() {
  const userId = state.session.user.id;
  const [posts, engagements] = await Promise.all([api.getPosts(), api.getMyEngagements(userId)]);
  state.posts = posts;
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
  try { localStorage.setItem(PENDING_KEY, JSON.stringify({ postId, at: Date.now() })); } catch { /* storage optional */ }
}

export function getPending() {
  try {
    const raw = JSON.parse(localStorage.getItem(PENDING_KEY) ?? 'null');
    if (!raw?.postId || Date.now() - raw.at > PENDING_TTL_MS) return null;
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
