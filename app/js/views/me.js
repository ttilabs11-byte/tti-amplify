// Teams ranking and the personal "Me" page.
import * as api from '../api.js';
import { h, mount, icon, toast, busy, errorText, initials, avatarColor } from '../ui.js';
import { state, deptName, getPref, setPref, applyTheme, rerender, myPoints, LEVELS } from '../store.js';
import { checklistList, privacySheet, CHECKLIST } from './onboarding.js';
import { install } from './home.js';
import { pushPermission, currentSubscription, enablePush, disablePush, isIos, isStandalone } from '../push.js';

const TOP_RANKS = 3;

export async function renderTeams(page) {
  page.replaceChildren(
    h('div', { class: 'hello' }, h('div', null, h('h1', null, 'Teams'),
      h('p', null, 'Share of live posts each department has engaged with.'))),
    h('div', { class: 'board' }, [0, 1, 2, 3].map(() => h('div', { class: 'skel', style: { height: '74px' } }))));
  let rows;
  try {
    rows = await api.deptBoard();
  } catch (err) {
    page.lastChild.replaceWith(h('div', { class: 'empty' }, icon('alert'), h('h3', null, 'Could not load teams'), h('p', null, errorText(err))));
    return;
  }
  const myDept = deptName(state.profile?.department_id);
  const board = rows.length
    ? rows.map((r, i) => h('div', { class: `card team${i < TOP_RANKS && Number(r.rate) > 0 ? ' top' : ''}${r.department === myDept ? ' mine' : ''}` },
      h('span', { class: 'rank' }, String(i + 1)),
      h('div', null,
        h('div', { class: 'row' }, h('b', null, r.department), r.department === myDept ? h('span', { class: 'badge admin' }, 'Your team') : null),
        h('span', { class: 'small muted' }, `${r.members} ${Number(r.members) === 1 ? 'member' : 'members'}`),
        h('div', { class: 'bar' }, h('i', { style: { width: `${Math.max(Number(r.rate), 2)}%`, 'animation-delay': `${i * 60}ms` } }))),
      h('span', { class: 'pct' }, String(r.rate), h('small', null, '%'))))
    : [h('div', { class: 'empty' }, icon('teams'), h('h3', null, 'No teams yet'), h('p', null, 'Rankings appear once colleagues join.'))];
  page.lastChild.replaceWith(h('div', { class: 'board' }, board));
  try {
    const top = await api.topAmplifiers();
    if (top.length) {
      page.append(h('div', { class: 'section-title' }, h('h2', null, 'Top amplifiers this month')),
        h('ol', { class: 'card list top-list' }, top.map((t, i) => h('li', null,
          h('span', { class: `rank-badge r${i + 1}` }, String(i + 1)),
          h('div', { class: 'grow' }, h('div', { class: 'name' }, t.first_name), h('div', { class: 'meta' }, t.department ?? '')),
          h('b', null, `${t.points} pts`)))));
    }
  } catch { /* optional section */ }
}

export function renderMe(page) {
  const p = state.profile;
  const email = state.session?.user?.email ?? '';
  const name = h('input', { id: 'me-name', class: 'input', value: p.full_name, maxlength: 80, autocomplete: 'name' });
  const dept = h('select', { id: 'me-dept', class: 'select' },
    state.departments.map((d) => h('option', { value: d.id, selected: d.id === p.department_id }, d.name)));
  const save = h('button', { class: 'btn btn-primary', type: 'button' }, 'Save changes');
  save.addEventListener('click', () => busy(save, async () => {
    const fullName = name.value.trim().replace(/\s+/g, ' ');
    if (fullName.length < 2) throw new Error('Please enter your full name.');
    state.profile = { ...state.profile, ...(await api.updateMyProfile(p.id, fullName, Number(dept.value))) };
    toast('Saved', { type: 'ok' });
    rerender();
  }).catch((err) => toast(errorText(err), { type: 'err' })));

  const theme = getPref('theme', 'auto');
  const themeSel = h('select', { id: 'me-theme', class: 'select', onChange: (e) => { setPref('theme', e.target.value); applyTheme(e.target.value); } },
    [['auto', 'Match my phone'], ['light', 'Light'], ['dark', 'Dark']].map(([v, l]) => h('option', { value: v, selected: v === theme }, l)));

  page.replaceChildren(
    h('div', { class: 'card card-pad row mt-8' },
      h('div', { class: 'avatar', style: { '--c': avatarColor(p.id), width: '56px', height: '56px', 'font-size': '18px' } }, initials(p.full_name)),
      h('div', { class: 'grow' },
        h('h1', { style: { 'font-size': '22px' } }, p.full_name),
        h('p', { class: 'muted small' }, `${deptName(p.department_id)} · ${email}`),
        p.role === 'admin' ? h('span', { class: 'badge admin mt-8' }, icon('shield'), 'Admin')
          : p.role === 'hod' ? h('span', { class: 'badge admin mt-8' }, icon('shield'), 'Head of department') : null)),
    h('div', { class: 'section-title' }, h('h2', null, 'Your details')),
    h('div', { class: 'card card-pad stack' },
      h('div', { class: 'field' }, h('label', { for: 'me-name' }, 'Full name'), name),
      h('div', { class: 'field' }, h('label', { for: 'me-dept' }, 'Department'), dept),
      save),
    pointsCard(),
    h('div', { class: 'section-title' }, h('h2', null, 'LinkedIn-ready'), h('span', { class: 'muted small', id: 'ready-count' }, readyText())),
    h('div', { class: 'card card-pad' }, checklistList(() => { const el = document.getElementById('ready-count'); if (el) el.textContent = readyText(); })),
    passwordCard(),
    h('div', { class: 'section-title' }, h('h2', null, 'Notifications')),
    notifyCard(),
    h('div', { class: 'section-title' }, h('h2', null, 'App')),
    h('div', { class: 'card card-pad stack' },
      h('div', { class: 'field' }, h('label', { for: 'me-theme' }, 'Appearance'), themeSel),
      installHelp()),
    h('button', { class: 'btn btn-soft btn-block mt-16', type: 'button', onClick: privacySheet }, icon('shield'), 'What HR sees'),
    h('div', { class: 'section-title' }, h('h2', null, 'How it works')),
    h('ol', { class: 'card card-pad stack small', style: { 'padding-left': '36px', margin: 0 } },
      h('li', null, 'Tap ', h('b', null, 'Open on LinkedIn'), ' on a post.'),
      h('li', null, 'React, comment or repost there, as the post asks.'),
      h('li', null, 'Come back. The app asks what you did. Tick it and confirm.'),
      h('li', null, 'HR sees team progress. Your ticks run on trust.')),
    h('button', { class: 'btn btn-ghost btn-block mt-24', type: 'button', onClick: signOut }, icon('logout'), 'Sign out'),
    h('p', { class: 'muted small mt-16', style: { 'text-align': 'center' } }, 'TTI Amplify · Tti Testing Laboratories'));
}

async function signOut() {
  await disablePush().catch(() => {});
  await api.signOut();
}

function notifyCard() {
  const card = h('div', { class: 'card card-pad stack' });
  const draw = async () => {
    const perm = pushPermission();
    const sub = perm === 'granted' ? await currentSubscription().catch(() => null) : null;
    let text = 'Get an alert on this phone when a new post goes live.';
    let button = h('button', { class: 'btn btn-primary', type: 'button' }, icon('bell'), 'Turn on notifications');
    if (perm === 'unsupported') {
      text = isIos() && !isStandalone()
        ? 'On iPhone: tap Share in Safari, then "Add to Home Screen". Open the app from there and turn notifications on here.'
        : 'This browser does not support notifications. Try Chrome on Android.';
      button = null;
    } else if (perm === 'denied') {
      text = 'Notifications are blocked. Allow them for TTI Amplify in your phone settings, then come back here.';
      button = null;
    } else if (sub) {
      text = 'On. This phone gets an alert when a new post goes live.';
      button = h('button', { class: 'btn btn-ghost', type: 'button' }, 'Turn off on this phone');
    }
    button?.addEventListener('click', () => busy(button, async () => {
      if (sub) { await disablePush(); toast('Notifications off on this phone.'); } else { await enablePush(); toast('Notifications on. You will hear about new posts.', { type: 'ok' }); }
      await draw();
    }).catch((err) => toast(errorText(err), { type: 'err', ms: 6000 })));
    mount(card,
      h('div', { class: 'row' }, h('span', { class: `notify-dot${sub ? ' on' : ''}`, 'aria-hidden': 'true' }), h('b', null, sub ? 'On for this phone' : 'Off for this phone')),
      h('p', { class: 'small muted' }, text), button);
  };
  draw();
  return card;
}

const readyText = () => `${(state.profile?.checklist ?? []).length} of ${CHECKLIST.length} done`;

function pointsCard() {
  const p = myPoints();
  const cur = LEVELS.find((l) => l.name === p.level).min;
  const next = LEVELS.find((l) => l.name === p.next)?.min;
  const pct = next ? Math.round(((p.total - cur) / (next - cur)) * 100) : 100;
  return h('div', { class: 'card card-pad stack-s mt-16 points-card' },
    h('div', { class: 'row' }, h('span', { class: 'level-badge' }, icon('trophy')),
      h('div', { class: 'grow' }, h('b', { class: 'level-name' }, p.level), h('p', { class: 'small muted' }, `${p.total} points all time · ${p.month} this month`))),
    h('div', { class: 'progress', role: 'img', 'aria-label': `${pct}% of the way to the next level` }, h('i', { style: { width: `${pct}%`, background: 'var(--primary)' } })),
    h('p', { class: 'hint' }, p.next ? `${p.toNext} points to ${p.next}. Comments and reposts earn 3, reactions 1.` : 'Top level. Thank you for lifting Tti.'));
}

function passwordCard() {
  const input = h('input', { id: 'me-pass', class: 'input', type: 'password', autocomplete: 'new-password', minlength: 8, maxlength: 72, placeholder: 'New password, 8+ characters' });
  const btn = h('button', { class: 'btn btn-ghost', type: 'button' }, icon('key'), 'Change password');
  btn.addEventListener('click', () => busy(btn, async () => {
    await api.changePassword(input.value);
    input.value = '';
    toast('Password changed', { type: 'ok' });
  }).catch((err) => toast(errorText(err), { type: 'err' })));
  return h('div', { class: 'card card-pad stack mt-16' },
    h('div', { class: 'field' }, h('label', { for: 'me-pass' }, 'Password'), input), btn);
}

function installHelp() {
  const standalone = matchMedia('(display-mode: standalone)').matches || navigator.standalone;
  if (standalone) return h('p', { class: 'small muted row' }, icon('check'), 'Installed on this device.');
  if (state.installPrompt) return h('button', { class: 'btn btn-soft', type: 'button', onClick: install }, icon('phone'), 'Install on this device');
  const ios = /iphone|ipad|ipod/i.test(navigator.userAgent);
  return h('p', { class: 'small muted' }, ios
    ? 'To install on iPhone: tap Share in Safari, then "Add to Home Screen".'
    : 'To install: open the browser menu (⋮), then "Install app" or "Add to Home screen".');
}
