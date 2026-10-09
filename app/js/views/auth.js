// Welcome, sign in and create account.
import * as api from '../api.js';
import { h, icon, arcs, busy, errorText } from '../ui.js';
import { state, loadDepartments } from '../store.js';
import { privacySheet } from './onboarding.js';

let mode = 'join';

export function renderAuth(root) {
  const card = h('div', { class: 'auth-card' });
  const draw = () => card.replaceChildren(tabs(draw), mode === 'join' ? joinForm() : signInForm());
  draw();
  root.replaceChildren(h('div', { class: 'auth' },
    h('header', { class: 'auth-hero' },
      arcs(),
      h('img', { class: 'logo', src: 'icons/logo-ondark.png', alt: 'Tti Testing Laboratories', width: 900, height: 198 }),
      h('h1', null, 'Every post, ', h('em', null, 'amplified.')),
      h('p', null, 'Open each Tti LinkedIn post, react, comment or repost, then tick it off here.')),
    h('main', { class: 'auth-main' }, h('div', null, card,
      h('p', { class: 'auth-foot' }, 'Your ticks are on trust. ',
        h('button', { class: 'linklike', type: 'button', onClick: privacySheet }, 'What HR sees'))))));
}

function tabs(draw) {
  const tab = (key, label) => h('button', {
    type: 'button', role: 'tab', 'aria-selected': String(mode === key),
    onClick: () => { mode = key; draw(); },
  }, label);
  return h('div', { class: 'seg', role: 'tablist', 'aria-label': 'Account' }, tab('join', 'Create account'), tab('signin', 'Sign in'));
}

function errorBox() {
  const box = h('div', { class: 'form-error', role: 'alert', hidden: true });
  box.show = (msg) => { box.replaceChildren(icon('alert'), h('span', null, msg)); box.hidden = false; };
  box.clear = () => { box.hidden = true; };
  return box;
}

function passwordField(id, autocomplete) {
  const input = h('input', { id, class: 'input', type: 'password', name: 'password', autocomplete, required: true, minlength: 8, maxlength: 72 });
  const toggle = h('button', { type: 'button', class: 'icon-btn', 'aria-label': 'Show password' }, icon('eye'));
  toggle.addEventListener('click', () => {
    const show = input.type === 'password';
    input.type = show ? 'text' : 'password';
    toggle.setAttribute('aria-label', show ? 'Hide password' : 'Show password');
    toggle.replaceChildren(icon(show ? 'eyeOff' : 'eye'));
  });
  return h('div', { class: 'input-wrap' }, input, toggle);
}

function joinForm() {
  const err = errorBox();
  const submit = h('button', { class: 'btn btn-primary btn-block', type: 'submit' }, 'Create my account');
  const deptSelect = h('select', { id: 'j-dept', class: 'select', name: 'department', required: true },
    h('option', { value: '', disabled: true, selected: true }, state.departments.length ? 'Choose your department' : 'Loading…'),
    state.departments.map((d) => h('option', { value: d.id }, d.name)));
  if (!state.departments.length) {
    loadDepartments().then((list) => {
      deptSelect.firstChild.textContent = 'Choose your department';
      deptSelect.append(...list.map((d) => h('option', { value: d.id }, d.name)));
    }).catch(() => { deptSelect.firstChild.textContent = 'Could not load. Reload the page.'; });
  }
  const form = h('form', { class: 'stack', novalidate: true },
    h('div', { class: 'field' }, h('label', { for: 'j-name' }, 'Full name'),
      h('input', { id: 'j-name', class: 'input', name: 'name', autocomplete: 'name', required: true, maxlength: 80, placeholder: 'As colleagues know you' })),
    h('div', { class: 'field' }, h('label', { for: 'j-dept' }, 'Department'), deptSelect),
    h('div', { class: 'field' }, h('label', { for: 'j-email' }, 'Email'),
      h('input', { id: 'j-email', class: 'input', type: 'email', name: 'email', autocomplete: 'email', inputmode: 'email', required: true, placeholder: 'you@example.com' }),
      h('span', { class: 'hint' }, 'Work or personal. You sign in with it.')),
    h('div', { class: 'field' }, h('label', { for: 'j-pass' }, 'Password'), passwordField('j-pass', 'new-password'),
      h('span', { class: 'hint' }, 'At least 8 characters.')),
    h('div', { class: 'field' }, h('label', { for: 'j-code' }, 'Company code'),
      h('input', { id: 'j-code', class: 'input', name: 'code', autocomplete: 'off', autocapitalize: 'characters', required: true, placeholder: 'TTI-XXXXXX', spellcheck: 'false' }),
      h('span', { class: 'hint' }, 'HR shares it in the staff WhatsApp group.')),
    err, submit);

  form.addEventListener('submit', (e) => {
    e.preventDefault();
    err.clear();
    const f = new FormData(form);
    const payload = {
      fullName: String(f.get('name') ?? '').trim(),
      departmentId: Number(f.get('department')),
      email: String(f.get('email') ?? '').trim(),
      password: String(f.get('password') ?? ''),
      code: String(f.get('code') ?? '').trim(),
    };
    const problem = validateJoin(payload);
    if (problem) return err.show(problem);
    busy(submit, () => api.signUp(payload)).catch((ex) => err.show(errorText(ex)));
  });
  return form;
}

function validateJoin(p) {
  if (p.fullName.length < 2) return 'Please enter your full name.';
  if (!p.departmentId) return 'Please choose your department.';
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(p.email)) return 'Please enter a valid email address.';
  if (p.password.length < 8) return 'Password must be at least 8 characters.';
  if (!p.code) return 'Please enter the company code.';
  return '';
}

function signInForm() {
  const err = errorBox();
  const submit = h('button', { class: 'btn btn-primary btn-block', type: 'submit' }, 'Sign in');
  const form = h('form', { class: 'stack', novalidate: true },
    h('div', { class: 'field' }, h('label', { for: 's-email' }, 'Email'),
      h('input', { id: 's-email', class: 'input', type: 'email', name: 'email', autocomplete: 'username', inputmode: 'email', required: true })),
    h('div', { class: 'field' }, h('label', { for: 's-pass' }, 'Password'), passwordField('s-pass', 'current-password')),
    err, submit,
    h('p', { class: 'hint' }, 'Forgot your password? Ask HR or an admin to reset it for you.'));
  form.addEventListener('submit', (e) => {
    e.preventDefault();
    err.clear();
    const f = new FormData(form);
    const email = String(f.get('email') ?? '').trim();
    const password = String(f.get('password') ?? '');
    if (!email || !password) return err.show('Enter your email and password.');
    busy(submit, () => api.signIn(email, password)).catch((ex) => err.show(errorText(ex)));
  });
  return form;
}
