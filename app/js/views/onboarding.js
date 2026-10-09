// First-run welcome (3 steps) and the LinkedIn-readiness checklist, which also lives under Me.
import * as api from '../api.js';
import { h, mount, icon, sheet, closeSheet, toast, busy, errorText } from '../ui.js';
import { state } from '../store.js';
import { pushPermission, enablePush } from '../push.js';

const COMPANY_SEARCH = 'https://www.linkedin.com/search/results/companies/?keywords=Tti%20Testing%20Laboratories';
export const CHECKLIST = [
  { key: 'follow', label: 'Follow Tti on LinkedIn', why: 'Company posts reach followers first.', href: COMPANY_SEARCH },
  { key: 'employer', label: 'Show Tti Testing Laboratories as your current job', why: 'Employees get LinkedIn’s "Notify employees" alerts.' },
  { key: 'photo', label: 'Add a profile photo', why: 'Comments with a real face get far more trust.' },
];

let shownThisSession = false;

async function saveChecklist(next) {
  const saved = await api.updateOnboarding(state.profile.id, { checklist: [...next] });
  state.profile = { ...state.profile, ...saved };
}

export function checklistList(onChange) {
  const ticked = new Set(state.profile?.checklist ?? []);
  return h('div', { class: 'checklist' }, CHECKLIST.map((item) => {
    const btn = h('button', { class: 'check-item', type: 'button', 'aria-pressed': String(ticked.has(item.key)) },
      h('span', { class: 'box' }, icon('check')),
      h('span', { class: 'grow' }, h('b', null, item.label), h('small', null, item.why)));
    btn.addEventListener('click', async () => {
      if (ticked.has(item.key)) ticked.delete(item.key); else ticked.add(item.key);
      btn.setAttribute('aria-pressed', String(ticked.has(item.key)));
      try {
        await saveChecklist(ticked);
        onChange?.(ticked);
      } catch (err) {
        toast(errorText(err), { type: 'err' });
      }
    });
    const row = h('div', { class: 'check-row' }, btn);
    if (item.href) row.append(h('a', { class: 'btn btn-ghost btn-sm', href: item.href, target: '_blank', rel: 'noopener noreferrer' }, 'Open', icon('external')));
    return row;
  }));
}

export function maybeOnboard() {
  if (shownThisSession || !state.profile || state.profile.onboarded_at || document.querySelector('.sheet')) return;
  shownThisSession = true;
  let step = 0;
  const body = h('div', { class: 'onboard' });
  const finish = async () => {
    try {
      const saved = await api.updateOnboarding(state.profile.id, { onboarded_at: new Date().toISOString() });
      state.profile = { ...state.profile, ...saved };
    } catch { /* shown again next session */ }
  };

  const steps = [
    () => [h('h2', null, 'Welcome to TTI Amplify'),
      h('p', { class: 'sub' }, 'Our LinkedIn posts travel much further when colleagues engage. It takes a minute a post.'),
      h('ol', { class: 'how' },
        h('li', null, icon('external'), h('span', null, h('b', null, 'Open'), ' the post on LinkedIn from here.')),
        h('li', null, icon('comment'), h('span', null, h('b', null, 'Engage'), ': react, comment or repost. A personal comment helps most.')),
        h('li', null, icon('check'), h('span', null, h('b', null, 'Tick'), ' what you did when you come back. It runs on trust.')))],
    () => [h('h2', null, 'Get LinkedIn-ready'),
      h('p', { class: 'sub' }, 'Three quick things that make your engagement count. Tick them as you go.'),
      checklistList()],
    () => [h('h2', null, 'Never miss a post'),
      h('p', { class: 'sub' }, 'Get a notification the moment a new post goes live. Early engagement counts most.'),
      pushPermission() === 'default'
        ? (() => {
          const b = h('button', { class: 'btn btn-primary btn-block', type: 'button' }, icon('bell'), 'Turn on notifications');
          b.addEventListener('click', () => busy(b, async () => {
            await enablePush();
            toast('Notifications on.', { type: 'ok' });
            b.replaceWith(h('p', { class: 'honour' }, icon('check'), 'Notifications are on for this phone.'));
          }).catch((err) => toast(errorText(err), { type: 'err', ms: 6000 })));
          return b;
        })()
        : h('p', { class: 'honour' }, icon('info'), pushPermission() === 'granted' ? 'Notifications are on for this phone.' : 'You can manage notifications later under Me.')],
  ];

  const draw = () => {
    const last = step === steps.length - 1;
    mount(body,
      h('div', { class: 'dots', 'aria-hidden': 'true' }, steps.map((_, i) => h('i', { class: i === step ? 'on' : '' }))),
      ...steps[step](),
      h('div', { class: 'sheet-actions mt-16' },
        h('button', { class: 'btn btn-ghost', type: 'button', onClick: () => (step ? (step -= 1, draw()) : closeSheet()) }, step ? 'Back' : 'Skip'),
        h('button', { class: 'btn btn-primary', type: 'button', onClick: () => (last ? closeSheet() : (step += 1, draw())) }, last ? "Let's go" : 'Next')));
  };
  draw();
  sheet(body, { label: 'Welcome', onClose: finish });
}

export function privacySheet() {
  sheet(h('div', { class: 'stack' },
    h('h2', null, 'What HR sees'),
    h('p', { class: 'sub' }, 'TTI Amplify records only what you tell it, on trust.'),
    h('ul', { class: 'privacy' },
      h('li', null, icon('check'), h('span', null, h('b', null, 'Recorded: '), 'when you open a post from the app, and the actions you tick.')),
      h('li', null, icon('shield'), h('span', null, h('b', null, 'Who sees it: '), 'admins see everyone\u2019s ticks; heads of department see only their own team.')),
      h('li', null, icon('teams'), h('span', null, h('b', null, 'Colleagues see: '), 'team percentages only. A "top 5 this month" list appears only if HR switches it on.')),
      h('li', null, icon('lock'), h('span', null, h('b', null, 'Never recorded: '), 'your LinkedIn account, password, feed or messages. The app cannot see LinkedIn at all.'))),
    h('button', { class: 'btn btn-primary btn-block', type: 'button', onClick: () => closeSheet() }, 'Got it')),
  { label: 'What HR sees' });
}
