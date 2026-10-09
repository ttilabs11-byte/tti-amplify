// Web Push on this device: subscribe, unsubscribe, and keep the server record in sync.
import { sb } from './api.js';

// Public VAPID key: safe to ship. The private half stays in the database.
const VAPID_PUBLIC = 'BIZ8MIXNY0LYUhUEp0AthRlKUvrqGjwZzEeNofXNZpB8oO5JMtCWHsirh_aRRtKI2X738JoVGEFhS1Lk91ji7MM';

export const pushSupported = () => 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;
export const pushPermission = () => (pushSupported() ? Notification.permission : 'unsupported');
export const isIos = () => /iphone|ipad|ipod/i.test(navigator.userAgent);
export const isStandalone = () => matchMedia('(display-mode: standalone)').matches || navigator.standalone === true;

function keyBytes(base64url) {
  const pad = '='.repeat((4 - (base64url.length % 4)) % 4);
  const raw = atob((base64url + pad).replace(/-/g, '+').replace(/_/g, '/'));
  return Uint8Array.from(raw, (c) => c.charCodeAt(0));
}

async function registration() {
  const reg = await navigator.serviceWorker.getRegistration();
  if (!reg) throw new Error('Notifications work in the installed app or on the live site.');
  return reg;
}

export async function currentSubscription() {
  if (!pushSupported()) return null;
  const reg = await navigator.serviceWorker.getRegistration();
  return reg ? reg.pushManager.getSubscription() : null;
}

async function save(sub) {
  const { endpoint, keys } = sub.toJSON();
  const { error } = await sb.rpc('save_push_subscription', { p_endpoint: endpoint, p_p256dh: keys.p256dh, p_auth: keys.auth });
  if (error) throw new Error('Could not save this device. Please try again.');
}

export async function enablePush() {
  if (!pushSupported()) {
    throw new Error(isIos() && !isStandalone()
      ? 'On iPhone, add the app to your Home Screen first, then turn on notifications there.'
      : 'This browser does not support notifications.');
  }
  const permission = await Notification.requestPermission();
  if (permission !== 'granted') {
    throw new Error('Notifications are blocked. Allow them for this app in your phone settings, then try again.');
  }
  const reg = await registration();
  const sub = await reg.pushManager.getSubscription()
    ?? await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: keyBytes(VAPID_PUBLIC) });
  await save(sub);
  return sub;
}

export async function disablePush() {
  const sub = await currentSubscription();
  if (!sub) return;
  await sb.rpc('delete_push_subscription', { p_endpoint: sub.endpoint });
  await sub.unsubscribe();
}

/** After sign-in: re-link an existing device subscription to whoever is signed in now. */
export async function syncPush() {
  if (pushPermission() !== 'granted') return;
  const sub = await currentSubscription();
  if (sub) await save(sub);
}
