// Data access. Every call returns plain data or throws an Error with a friendly message.

export const SUPABASE_URL = 'https://fuhnyjmbjzjflxylxakw.supabase.co';
// Publishable key: safe to ship. Row Level Security and server-side checks protect the data.
const SUPABASE_KEY = 'sb_publishable_X6ElDgI9IkOuELXgmDGKFw_v-J35WNq';

export const sb = window.supabase.createClient(SUPABASE_URL, SUPABASE_KEY, {
  auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: false, storageKey: 'tti-amplify-auth' },
});

const FRIENDLY = [
  [/Invalid login credentials/i, 'Email or password is not right.'],
  [/Email not confirmed/i, 'This account is not confirmed yet. Ask HR for help.'],
  [/banned|User is banned/i, 'This account has been switched off. Ask HR for help.'],
  [/Failed to fetch|NetworkError|Load failed/i, 'Could not reach the server. Check your connection.'],
  [/JWT expired|invalid JWT|not authenticated/i, 'Your session ended. Please sign in again.'],
  [/violates check constraint "posts_url_check"/i, 'Use the full linkedin.com link of the post.'],
  [/violates check constraint "posts_title_check"/i, 'The title needs 3 to 140 characters.'],
  [/duplicate key value.*departments_name_key/i, 'That department already exists.'],
];

function friendly(error) {
  const raw = error?.message ?? String(error ?? '');
  for (const [pattern, text] of FRIENDLY) if (pattern.test(raw)) return new Error(text);
  return new Error(raw || 'Something went wrong. Please try again.');
}

async function run(query) {
  const { data, error } = await query;
  if (error) throw friendly(error);
  return data;
}

async function invoke(name, body) {
  const { data, error } = await sb.functions.invoke(name, { body });
  if (!error) return data;
  let message = error.message;
  try {
    const payload = await error.context?.json?.();
    if (payload?.error) message = payload.error;
  } catch { /* keep the generic message */ }
  throw friendly({ message });
}

// Auth --------------------------------------------------------------------------

export const getSession = async () => (await sb.auth.getSession()).data.session;
export const onAuthChange = (cb) => sb.auth.onAuthStateChange((_event, session) => cb(session));

export async function signIn(email, password) {
  return run(sb.auth.signInWithPassword({ email: email.trim().toLowerCase(), password }));
}

export async function signUp({ fullName, email, password, departmentId, code }) {
  await invoke('signup', { full_name: fullName, email, password, department_id: departmentId, code });
  return signIn(email, password);
}

export const signOut = () => sb.auth.signOut();

export async function changePassword(password) {
  if (password.length < 8 || password.length > 72) throw new Error('Password must be 8 to 72 characters.');
  return run(sb.auth.updateUser({ password }));
}

// Shared data -----------------------------------------------------------------------

export const getDepartments = () => run(sb.from('departments').select('id, name, sort').order('sort').order('name'));

export async function getProfile(userId) {
  return run(sb.from('profiles').select('id, full_name, department_id, role, active').eq('id', userId).maybeSingle());
}

export const updateMyProfile = (userId, fullName, departmentId) =>
  run(sb.from('profiles').update({ full_name: fullName, department_id: departmentId }).eq('id', userId).select().single());

export const getPosts = () =>
  run(sb.from('posts').select('id, url, title, note, asks, posted_on, archived, created_at, last_reminded_at')
    .order('posted_on', { ascending: false }).order('created_at', { ascending: false }).limit(200));

export const getMyEngagements = (userId) =>
  run(sb.from('engagements').select('post_id, opened_at, reacted, commented, reposted, confirmed_at').eq('user_id', userId));

export const markOpened = (postId) => run(sb.rpc('mark_opened', { p_post: postId }));

export const confirmEngagement = (postId, { react, comment, repost }) =>
  run(sb.rpc('confirm_engagement', { p_post: postId, p_reacted: react, p_commented: comment, p_reposted: repost }));

export const deptBoard = () => run(sb.rpc('dept_board'));

export function onPostsChange(cb) {
  const channel = sb.channel('posts-live')
    .on('postgres_changes', { event: '*', schema: 'public', table: 'posts' }, (payload) => cb(payload))
    .subscribe();
  return () => sb.removeChannel(channel);
}

// Admin ------------------------------------------------------------------------------

export const adminPostStats = () => run(sb.rpc('admin_post_stats'));
export const adminPostReport = (postId) => run(sb.rpc('admin_post_report', { p_post: postId }));
export const adminPeople = () => run(sb.rpc('admin_people'));

export const createPost = (post) => run(sb.from('posts').insert(post).select().single());
export const updatePost = (id, patch) => run(sb.from('posts').update(patch).eq('id', id).select().single());

export const addDepartment = (name, sort) => run(sb.from('departments').insert({ name, sort }).select().single());
export const renameDepartment = (id, name) => run(sb.from('departments').update({ name }).eq('id', id));

export const adminAction = (action, payload = {}) => invoke('admin', { action, ...payload });
export const notify = (postId, kind) => invoke('notify', { post_id: postId, kind });
