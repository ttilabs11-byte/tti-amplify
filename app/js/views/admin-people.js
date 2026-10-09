// Admin: people (roles, access, password resets), invite codes and departments.
import * as api from '../api.js';
import { h, icon, sheet, closeSheet, toast, busy, errorText, initials, avatarColor, copyText } from '../ui.js';
import { state, loadDepartments, APP_URL } from '../store.js';
import { downloadCsv } from './admin-posts.js';

const CODE_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
const PASS_ALPHABET = 'abcdefghjkmnpqrstuvwxyzABCDEFGHJKMNPQRSTUVWXYZ23456789';

function randomString(alphabet, length) {
  const bytes = crypto.getRandomValues(new Uint32Array(length));
  return Array.from(bytes, (b) => alphabet[b % alphabet.length]).join('');
}

const failBox = (err) => h('div', { class: 'empty' }, icon('alert'), h('h3', null, 'Could not load'), h('p', null, errorText(err)));

// People ---------------------------------------------------------------------------------

export async function renderPeople(body) {
  body.replaceChildren(h('div', { class: 'skel', style: { height: '320px' } }));
  let people;
  try {
    people = await api.adminPeople();
  } catch (err) {
    body.replaceChildren(failBox(err));
    return;
  }
  let query = '';
  let dept = '';
  const listHost = h('div');
  const count = h('span', { class: 'muted small' });
  const draw = () => {
    const q = query.toLowerCase();
    const shown = people.filter((p) => (!dept || String(p.department_id) === dept)
      && (!q || `${p.full_name} ${p.email} ${p.department ?? ''}`.toLowerCase().includes(q)));
    count.textContent = `${shown.length} of ${people.length}`;
    listHost.replaceChildren(shown.length
      ? h('ul', { class: 'card list' }, shown.map((p) => h('li', null, personRow(p, () => personSheet(p, () => renderPeople(body))))))
      : h('div', { class: 'empty' }, icon('search'), h('h3', null, 'No matches')));
  };

  const search = h('input', { class: 'input', type: 'search', placeholder: 'Search name, email or team', 'aria-label': 'Search people' });
  search.addEventListener('input', () => { query = search.value.trim(); draw(); });
  const deptSel = h('select', { class: 'select', 'aria-label': 'Filter by department' },
    h('option', { value: '' }, 'All departments'), state.departments.map((d) => h('option', { value: d.id }, d.name)));
  deptSel.addEventListener('change', () => { dept = deptSel.value; draw(); });

  body.replaceChildren(
    h('div', { class: 'admin-grid two' }, h('div', { class: 'search' }, icon('search'), search), deptSel),
    h('div', { class: 'section-title' }, count,
      h('button', { class: 'btn btn-ghost btn-sm', type: 'button', onClick: () => exportPeople(people) }, icon('download'), 'Export CSV')),
    listHost);
  draw();
}

function personRow(p, onOpen) {
  const last = p.last_confirmed ? new Date(p.last_confirmed).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' }) : 'never';
  return h('button', { class: 'rowbtn', type: 'button', onClick: onOpen },
    h('span', { class: 'avatar', style: { '--c': avatarColor(p.user_id) } }, initials(p.full_name)),
    h('div', { class: 'grow' },
      h('div', { class: 'row', style: { gap: '6px' } }, h('span', { class: 'name' }, p.full_name),
        p.role === 'admin' ? h('span', { class: 'badge admin' }, 'Admin') : null,
        !p.active ? h('span', { class: 'badge off' }, 'Off') : null),
      h('div', { class: 'meta' }, `${p.department ?? 'No department'} · ${p.engaged} ${Number(p.engaged) === 1 ? "post" : "posts"} · last ${last}${Number(p.push_devices) ? ' · alerts on' : ''}`)),
    icon('chevronRight'));
}

function personSheet(p, refresh) {
  const self = p.user_id === state.profile.id;
  const result = h('div');

  const reset = h('button', { class: 'btn btn-soft btn-block', type: 'button' }, icon('key'), 'Reset password');
  reset.addEventListener('click', () => busy(reset, async () => {
    const temp = `${randomString(PASS_ALPHABET, 10)}`;
    await api.adminAction('reset_password', { user_id: p.user_id, password: temp });
    result.replaceChildren(h('div', { class: 'stack-s' },
      h('span', { class: 'label' }, 'New password. Share it with them privately:'),
      h('div', { class: 'code-box' }, h('code', null, temp),
        h('button', { class: 'icon-btn', type: 'button', 'aria-label': 'Copy password', onClick: () => copyText(temp, 'Password copied') }, icon('copy'))),
      h('span', { class: 'hint' }, 'They can change it later under Me.')));
  }).catch((err) => toast(errorText(err), { type: 'err' })));

  const role = h('button', { class: 'btn btn-ghost btn-block', type: 'button', disabled: self }, icon('shield'), p.role === 'admin' ? 'Remove admin rights' : 'Make admin');
  role.addEventListener('click', () => busy(role, async () => {
    await api.adminAction('set_role', { user_id: p.user_id, role: p.role === 'admin' ? 'member' : 'admin' });
    toast(p.role === 'admin' ? 'Admin rights removed.' : `${p.full_name} is now an admin.`, { type: 'ok' });
    closeSheet();
    refresh();
  }).catch((err) => toast(errorText(err), { type: 'err' })));

  let armed = false;
  const access = h('button', { class: `btn btn-block ${p.active ? 'btn-danger' : 'btn-soft'}`, type: 'button', disabled: self }, p.active ? 'Switch off access' : 'Restore access');
  access.addEventListener('click', () => {
    if (p.active && !armed) { armed = true; access.textContent = 'Tap again to switch off'; return; }
    busy(access, async () => {
      await api.adminAction('set_active', { user_id: p.user_id, active: !p.active });
      toast(p.active ? 'Access switched off.' : 'Access restored.', { type: 'ok' });
      closeSheet();
      refresh();
    }).catch((err) => toast(errorText(err), { type: 'err' }));
  });

  sheet(h('div', { class: 'stack' },
    h('div', { class: 'row' },
      h('span', { class: 'avatar', style: { '--c': avatarColor(p.user_id), width: '52px', height: '52px' } }, initials(p.full_name)),
      h('div', { class: 'grow' }, h('h2', { style: { 'font-size': '21px' } }, p.full_name), h('p', { class: 'muted small' }, p.email))),
    h('div', { class: 'kpis' },
      h('div', { class: 'kpi' }, h('b', null, String(p.engaged)), h('span', null, 'Posts')),
      h('div', { class: 'kpi' }, h('b', null, String(p.actions)), h('span', null, 'Actions')),
      h('div', { class: 'kpi' }, h('b', { style: { 'font-size': '16px' } }, p.department ?? '—'), h('span', null, 'Team'))),
    reset, result, role, access,
    self ? h('p', { class: 'hint' }, "You can't change your own role or access.") : null),
  { label: `Manage ${p.full_name}` });
}

function exportPeople(people) {
  downloadCsv(`amplify-people-${new Date().toISOString().slice(0, 10)}.csv`,
    ['Name', 'Email', 'Department', 'Role', 'Active', 'Joined', 'Posts engaged', 'Actions', 'Last confirmed'],
    people.map((p) => [p.full_name, p.email, p.department ?? '', p.role, p.active ? 'yes' : 'no', p.created_at.slice(0, 10), p.engaged, p.actions, p.last_confirmed ?? '']));
}

// Settings --------------------------------------------------------------------------------

export async function renderSettings(body) {
  body.replaceChildren(h('div', { class: 'skel', style: { height: '260px' } }));
  let codes;
  try {
    codes = await api.adminAction('get_codes');
  } catch (err) {
    body.replaceChildren(failBox(err));
    return;
  }
  const invite = inviteText(codes.staff_code);
  body.replaceChildren(h('div', { class: 'admin-grid two' },
    h('section', { class: 'card card-pad stack' },
      h('h2', { style: { 'font-size': '20px' } }, 'Invite staff'),
      h('p', { class: 'small muted' }, 'Anyone with this code can create a staff account. Post it in the staff WhatsApp group.'),
      codeBox(codes.staff_code, false),
      h('a', { class: 'btn btn-wa btn-block', href: `https://wa.me/?text=${encodeURIComponent(invite)}`, target: '_blank', rel: 'noopener noreferrer' }, icon('send'), 'Send invite on WhatsApp'),
      h('div', { class: 'row' },
        h('button', { class: 'btn btn-ghost', type: 'button', style: { flex: 1 }, onClick: () => copyText(invite, 'Invite copied') }, icon('copy'), 'Copy'),
        regenButton('staff', body, 'New code'))),
    h('section', { class: 'card card-pad stack' },
      h('h2', { style: { 'font-size': '20px' } }, 'Admin code'),
      h('p', { class: 'small muted' }, 'Signing up with this code creates an admin. Share it only with HR and HODs who manage posts.'),
      codeBox(codes.admin_code, true),
      regenButton('admin', body, 'New admin code')),
    departmentsCard()));
}

function inviteText(code) {
  return `Join TTI Amplify, our app for supporting Tti's LinkedIn posts.\n\n1. Open ${APP_URL}\n2. Create your account with company code: ${code}\n3. Install it when your phone offers.\n\nIt takes a minute. Thank you!`;
}

function codeBox(code, secret) {
  let shown = !secret;
  const codeEl = h('code', null, shown ? code : '••••••••••••');
  const eye = secret ? h('button', { class: 'icon-btn', type: 'button', 'aria-label': 'Show code' }, icon('eye')) : null;
  eye?.addEventListener('click', () => {
    shown = !shown;
    codeEl.textContent = shown ? code : '••••••••••••';
    eye.replaceChildren(icon(shown ? 'eyeOff' : 'eye'));
    eye.setAttribute('aria-label', shown ? 'Hide code' : 'Show code');
  });
  return h('div', { class: 'code-box' }, codeEl, eye,
    h('button', { class: 'icon-btn', type: 'button', 'aria-label': 'Copy code', onClick: () => copyText(code, 'Code copied') }, icon('copy')));
}

function regenButton(which, body, label) {
  let armed = false;
  const btn = h('button', { class: 'btn btn-ghost', type: 'button', style: { flex: 1 } }, icon('refresh'), label);
  btn.addEventListener('click', () => {
    if (!armed) { armed = true; btn.textContent = 'Tap again to replace'; return; }
    const value = which === 'staff' ? `TTI-${randomString(CODE_ALPHABET, 6)}` : `ADM-${randomString(CODE_ALPHABET, 12)}`;
    busy(btn, () => api.adminAction('set_code', { which, value }))
      .then(() => { toast('New code saved. Existing accounts are not affected.', { type: 'ok' }); renderSettings(body); })
      .catch((err) => toast(errorText(err), { type: 'err' }));
  });
  return btn;
}

function departmentsCard() {
  const list = h('ul', { class: 'list' });
  const draw = () => list.replaceChildren(...state.departments.map((d) => {
    const input = h('input', { class: 'input', value: d.name, maxlength: 60, 'aria-label': `Rename ${d.name}` });
    const save = h('button', { class: 'btn btn-soft btn-sm', type: 'button' }, 'Save');
    save.addEventListener('click', () => busy(save, async () => {
      const name = input.value.trim();
      if (!name || name === d.name) return;
      await api.renameDepartment(d.id, name);
      await loadDepartments();
      toast('Renamed', { type: 'ok' });
      draw();
    }).catch((err) => toast(errorText(err), { type: 'err' })));
    return h('li', { style: { padding: '8px 0' } }, input, save);
  }));
  draw();
  const add = h('input', { class: 'input', placeholder: 'New department', maxlength: 60, 'aria-label': 'New department name' });
  const addBtn = h('button', { class: 'btn btn-primary btn-sm', type: 'button' }, icon('plus'), 'Add');
  addBtn.addEventListener('click', () => busy(addBtn, async () => {
    const name = add.value.trim();
    if (!name) return;
    const maxSort = Math.max(0, ...state.departments.map((d) => d.sort));
    await api.addDepartment(name, maxSort + 1);
    await loadDepartments();
    add.value = '';
    toast('Department added', { type: 'ok' });
    draw();
  }).catch((err) => toast(errorText(err), { type: 'err' })));
  return h('section', { class: 'card card-pad stack' },
    h('h2', { style: { 'font-size': '20px' } }, 'Departments'),
    h('p', { class: 'small muted' }, 'Shown in the sign-up form and team rankings.'),
    list, h('div', { class: 'row' }, add, addBtn));
}
