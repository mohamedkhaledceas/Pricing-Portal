import { $, escapeHtml } from './dom.js';
import { paintLogo } from './theme.js';

/* This page's only job is to authenticate and hand off — it never holds
   onto the access token itself. A successful login/register just sets the
   httpOnly refresh cookie server-side and redirects to '/'; the landing
   page does its own silent-refresh-on-load (same bootstrapAuth() pattern
   used by every other page) to pull a fresh access token into its own
   memory. See CLAUDE.md: access tokens live in frontend memory only. */
async function apiPost(path, body) {
  const res = await fetch(path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    credentials: 'include',
    body: JSON.stringify(body),
  });
  const contentType = res.headers.get('content-type') || '';
  const data = contentType.includes('application/json') ? await res.json() : await res.text();
  if (!res.ok) {
    const message = (data && typeof data === 'object' && data.error) ? data.error : 'Request failed.';
    throw new Error(message);
  }
  return data;
}

async function apiGet(path) {
  const res = await fetch(path, { credentials: 'include' });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || 'Request failed.');
  return data;
}

/* Swaps a submit button's label for a spinner while an async action is in
   flight — avoids innerHTML so the (currently static) loading text never
   goes through unescaped HTML parsing. Same pattern as margin-planner_1.html's
   own setButtonLoading. */
function setButtonLoading(btn, loading, loadingText) {
  if (!btn) return;
  if (loading) {
    if (btn.dataset.originalText === undefined) btn.dataset.originalText = btn.textContent;
    btn.disabled = true;
    btn.textContent = '';
    const spin = document.createElement('span');
    spin.className = 'spinner';
    spin.setAttribute('aria-hidden', 'true');
    btn.appendChild(spin);
    btn.appendChild(document.createTextNode(loadingText || btn.dataset.originalText));
  } else {
    btn.disabled = false;
    if (btn.dataset.originalText !== undefined) btn.textContent = btn.dataset.originalText;
  }
}

const ALL_LOGIN_CARDS = ['loginForm', 'signupForm', 'signupStep2Form', 'forgotPasswordForm', 'resetPasswordForm'];

function showOnly(id) {
  ALL_LOGIN_CARDS.forEach((cardId) => { $('#' + cardId).hidden = cardId !== id; });
}
function showLoginForm() { showOnly('loginForm'); }
function showSignupForm() { showOnly('signupForm'); }
function showSignupStep2() { showOnly('signupStep2Form'); }
function showForgotPasswordForm() { showOnly('forgotPasswordForm'); }
function showResetPasswordForm() { showOnly('resetPasswordForm'); }

$('#btnShowSignup').addEventListener('click', () => {
  $('#loginError').hidden = true;
  showSignupForm();
  $('#signupFirstName').focus();
});
$('#btnShowLogin').addEventListener('click', () => {
  $('#signupError').hidden = true;
  showLoginForm();
  $('#loginEmail').focus();
});
$('#btnBackToStep1').addEventListener('click', () => {
  $('#signupStep2Error').hidden = true;
  showSignupForm();
});
$('#btnShowForgotPassword').addEventListener('click', () => {
  $('#loginError').hidden = true;
  showForgotPasswordForm();
  $('#forgotEmail').focus();
});
$('#btnBackToLoginFromForgot').addEventListener('click', () => {
  $('#forgotError').hidden = true;
  $('#forgotSuccess').hidden = true;
  showLoginForm();
  $('#loginEmail').focus();
});

$('#loginForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  const email = $('#loginEmail').value.trim();
  const password = $('#loginPassword').value;
  const errBox = $('#loginError');
  errBox.hidden = true;
  errBox.textContent = '';
  if (!email || !password) {
    errBox.textContent = 'Please enter both email and password.';
    errBox.hidden = false;
    return;
  }
  const submitBtn = $('#loginForm').querySelector('button[type=submit]');
  setButtonLoading(submitBtn, true, 'Logging in…');
  try {
    await apiPost('/api/auth/login', { email, password });
    window.location.href = '/';
  } catch (err) {
    errBox.textContent = err.message || 'Login failed.';
    errBox.hidden = false;
    setButtonLoading(submitBtn, false);
  }
});

/* ── Forgot / reset password ────────────────────────────────────────── */

$('#forgotPasswordForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  const email = $('#forgotEmail').value.trim();
  const errBox = $('#forgotError');
  const successBox = $('#forgotSuccess');
  errBox.hidden = true;
  successBox.hidden = true;
  if (!email) {
    errBox.textContent = 'Please enter your email.';
    errBox.hidden = false;
    return;
  }
  const submitBtn = $('#forgotPasswordForm').querySelector('button[type=submit]');
  setButtonLoading(submitBtn, true, 'Sending…');
  try {
    // Backend always resolves the same way regardless of whether this
    // email actually matches an account — see authService.forgotPassword's
    // own comment. The message shown here is exactly what it returns, so
    // this page never has to (and never could) distinguish the two cases.
    const res = await apiPost('/api/auth/forgot-password', { email });
    successBox.textContent = res.message || 'If an account exists for that email, a password reset link has been sent.';
    successBox.hidden = false;
    $('#forgotPasswordForm').reset();
  } catch (err) {
    // Only reachable for a real request-level failure (rate-limited,
    // network, validation) — never "email not found," which the backend
    // never distinguishes in the first place.
    errBox.textContent = err.message || 'Something went wrong. Please try again.';
    errBox.hidden = false;
  } finally {
    setButtonLoading(submitBtn, false);
  }
});

function resetPasswordHint() {
  const pw = $('#resetNewPassword').value;
  const { level, label } = passwordStrength(pw);
  const cssClass = level ? 'field-hint-' + level : '';
  const el = document.getElementById('hint-resetNewPassword');
  el.textContent = label;
  el.className = 'field-hint' + (cssClass ? ' ' + cssClass : '');
}
$('#resetNewPassword').addEventListener('input', resetPasswordHint);
$('#resetNewPasswordConfirm').addEventListener('input', () => setHint('resetNewPasswordConfirm', '', ''));

let pendingResetToken = null;

$('#resetPasswordForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  const errBox = $('#resetError');
  const successBox = $('#resetSuccess');
  errBox.hidden = true;
  successBox.hidden = true;

  const newPassword = $('#resetNewPassword').value;
  const newPasswordConfirm = $('#resetNewPasswordConfirm').value;
  if (newPassword.length < 8) {
    errBox.textContent = 'Password must be at least 8 characters long.';
    errBox.hidden = false;
    return;
  }
  if (newPassword !== newPasswordConfirm) {
    setHint('resetNewPasswordConfirm', 'Passwords do not match.', 'field-hint-error');
    return;
  }
  setHint('resetNewPasswordConfirm', '', '');

  const submitBtn = $('#resetPasswordForm').querySelector('button[type=submit]');
  setButtonLoading(submitBtn, true, 'Resetting…');
  try {
    await apiPost('/api/auth/reset-password', { token: pendingResetToken, newPassword });
    successBox.textContent = 'Password changed. Redirecting to log in…';
    successBox.hidden = false;
    $('#resetPasswordForm').reset();
    setTimeout(() => { window.location.href = '/login'; }, 1500);
  } catch (err) {
    errBox.textContent = err.message || 'This reset link is invalid or has expired. Please request a new one.';
    errBox.hidden = false;
    setButtonLoading(submitBtn, false);
  }
});

/* ── Live per-field validation (signup step 1) ──────────────────────── */

function setHint(id, message, cssClass) {
  const el = document.getElementById('hint-' + id);
  if (!el) return;
  el.textContent = message || '';
  el.hidden = !message;
  el.className = 'field-hint' + (cssClass ? ' ' + cssClass : '');
}

function passwordStrength(pw) {
  if (!pw) return { level: null, label: 'At least 8 characters' };
  if (pw.length < 8) return { level: 'weak', label: `Too short — ${8 - pw.length} more character${8 - pw.length === 1 ? '' : 's'} needed` };
  let classes = 0;
  if (/[a-z]/.test(pw)) classes++;
  if (/[A-Z]/.test(pw)) classes++;
  if (/[0-9]/.test(pw)) classes++;
  if (/[^A-Za-z0-9]/.test(pw)) classes++;
  if (pw.length >= 12 && classes >= 3) return { level: 'strong', label: 'Strong' };
  if (classes >= 2) return { level: 'medium', label: 'Medium — add a symbol or more length for "strong"' };
  return { level: 'weak', label: 'Weak — mix upper/lowercase, numbers, or symbols' };
}

function updatePasswordHint() {
  const pw = $('#signupPassword').value;
  const { level, label } = passwordStrength(pw);
  const cssClass = level ? 'field-hint-' + level : '';
  const el = document.getElementById('hint-signupPassword');
  el.textContent = label;
  el.className = 'field-hint' + (cssClass ? ' ' + cssClass : '');
  return level === 'medium' || level === 'strong';
}

$('#signupFirstName').addEventListener('input', () => setHint('signupFirstName', '', ''));
$('#signupLastName').addEventListener('input', () => setHint('signupLastName', '', ''));
$('#signupEmail').addEventListener('input', () => setHint('signupEmail', '', ''));
$('#signupPassword').addEventListener('input', updatePasswordHint);
$('#signupPasswordConfirm').addEventListener('input', () => setHint('signupPasswordConfirm', '', ''));
updatePasswordHint();

function validateStep1() {
  const firstName = $('#signupFirstName').value.trim();
  const lastName = $('#signupLastName').value.trim();
  const email = $('#signupEmail').value.trim();
  const password = $('#signupPassword').value;
  const passwordConfirm = $('#signupPasswordConfirm').value;

  let ok = true;
  if (!firstName) { setHint('signupFirstName', 'First name is required.', 'field-hint-error'); ok = false; }
  if (!lastName) { setHint('signupLastName', 'Last name is required.', 'field-hint-error'); ok = false; }
  if (!email) { setHint('signupEmail', 'Email is required.', 'field-hint-error'); ok = false; }
  if (password.length < 8) { ok = false; } // password hint already shows "too short" live
  if (!passwordConfirm) { setHint('signupPasswordConfirm', 'Please confirm your password.', 'field-hint-error'); ok = false; }
  else if (password !== passwordConfirm) { setHint('signupPasswordConfirm', 'Passwords do not match.', 'field-hint-error'); ok = false; }

  return ok ? { firstName, lastName, email, password } : null;
}

let step1Values = null;

$('#signupForm').addEventListener('submit', (e) => {
  e.preventDefault();
  const errBox = $('#signupError');
  errBox.hidden = true;
  errBox.textContent = '';
  const values = validateStep1();
  if (!values) {
    errBox.textContent = 'Please fix the highlighted fields.';
    errBox.hidden = false;
    return;
  }
  step1Values = values;
  showSignupStep2();
});

/* ── Signup step 2 (work details) ───────────────────────────────────── */

const STEP2_REQUIRED_FIELDS = [
  'step2JobTitle', 'step2Department', 'step2EmploymentType',
  'step2JoiningDate', 'step2WorkLocation',
];

async function populateStep2Dropdowns() {
  const oc = window.OrgConstants;
  const jobTitleSelect = $('#step2JobTitle');
  oc.JOB_TITLES.forEach((title) => {
    const opt = document.createElement('option');
    opt.value = title;
    opt.textContent = title;
    jobTitleSelect.appendChild(opt);
  });
  const departments = await window.Departments.load(apiGet);
  const deptSelect = $('#step2Department');
  departments.filter((d) => d.active).forEach((d) => {
    const opt = document.createElement('option');
    opt.value = d.code;
    opt.textContent = d.label;
    deptSelect.appendChild(opt);
  });
  const empSelect = $('#step2EmploymentType');
  oc.EMPLOYMENT_TYPES.forEach((t) => {
    const opt = document.createElement('option');
    opt.value = t;
    opt.textContent = oc.EMPLOYMENT_TYPE_LABELS[t];
    empSelect.appendChild(opt);
  });
  const locSelect = $('#step2WorkLocation');
  oc.WORK_LOCATIONS.forEach((l) => {
    const opt = document.createElement('option');
    opt.value = l;
    opt.textContent = oc.WORK_LOCATION_LABELS[l];
    locSelect.appendChild(opt);
  });
}

async function refreshManagerOptions() {
  const department = $('#step2Department').value;
  const managerSelect = $('#step2Manager');
  const info = $('#hint-step2ManagerInfo');
  managerSelect.innerHTML = '';
  if (!department) {
    managerSelect.disabled = true;
    managerSelect.innerHTML = '<option value="">— Select a department first —</option>';
    info.textContent = 'Choose a department first';
    return;
  }
  managerSelect.disabled = true;
  managerSelect.innerHTML = '<option value="">Loading…</option>';
  try {
    const res = await apiGet(`/api/employees/team-heads?department=${encodeURIComponent(department)}`);
    const heads = res.employees || [];
    if (!heads.length) {
      managerSelect.innerHTML = '<option value="">— No team head assigned yet —</option>';
      info.textContent = 'No team head assigned yet for this department — you can leave this blank';
      managerSelect.disabled = true;
      return;
    }
    managerSelect.innerHTML = '<option value="">— Select —</option>'
      + heads.map((h) => `<option value="${escapeHtml(h.id)}">${escapeHtml(h.firstName)} ${escapeHtml(h.lastName)}</option>`).join('');
    managerSelect.disabled = false;
    info.textContent = 'Team head for the department you selected';
  } catch (err) {
    managerSelect.innerHTML = '<option value="">— Unable to load —</option>';
    info.textContent = 'Could not load managers for this department — you can leave this blank';
  }
}

$('#step2Department').addEventListener('change', refreshManagerOptions);
STEP2_REQUIRED_FIELDS.forEach((id) => {
  $('#' + id).addEventListener('input', () => setHint(id, '', ''));
  $('#' + id).addEventListener('change', () => setHint(id, '', ''));
});

function validateStep2() {
  let ok = true;
  const values = {};
  STEP2_REQUIRED_FIELDS.forEach((id) => {
    const value = $('#' + id).value.trim();
    if (!value) {
      setHint(id, 'This field is required.', 'field-hint-error');
      ok = false;
    }
    values[id] = value;
  });
  return ok ? values : null;
}

$('#signupStep2Form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const errBox = $('#signupStep2Error');
  errBox.hidden = true;
  errBox.textContent = '';
  if (!step1Values) {
    // Shouldn't happen (step 2 is only reachable after step 1 validates),
    // but a page reload while on step 2 would lose the in-memory values —
    // send back to step 1 rather than submit an incomplete registration.
    showSignupForm();
    return;
  }
  const values = validateStep2();
  if (!values) {
    errBox.textContent = 'Please fix the highlighted fields.';
    errBox.hidden = false;
    return;
  }
  const managerEmployeeId = $('#step2Manager').value ? Number($('#step2Manager').value) : undefined;

  const submitBtn = $('#signupStep2Form').querySelector('button[type=submit]');
  setButtonLoading(submitBtn, true, 'Creating account…');
  try {
    await apiPost('/api/auth/register', {
      ...step1Values,
      workDetails: {
        jobTitle: values.step2JobTitle,
        department: values.step2Department,
        employmentType: values.step2EmploymentType,
        joiningDate: values.step2JoiningDate,
        workLocation: values.step2WorkLocation,
        managerEmployeeId,
      },
    });
    window.location.href = '/';
  } catch (err) {
    errBox.textContent = err.message || 'Sign up failed.';
    errBox.hidden = false;
    setButtonLoading(submitBtn, false);
  }
});

$('#brandLogo').addEventListener('click', () => { window.location.href = '/'; });

(async function init() {
  paintLogo();
  await populateStep2Dropdowns();
  if (window.matchMedia) {
    window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', paintLogo);
  }

  /* A reset-password link (?resetToken=...) takes priority over everything
     else on this page, including the already-authenticated auto-redirect
     right below — the token's own validity is what actually gates the
     reset, not whether this browser happens to still have a live session
     (e.g. testing the link in the same browser that requested it). The
     token is read once into memory and stripped from the visible URL
     immediately so it doesn't linger in browser history/back-forward
     cache/screen-share once the page has it. */
  const resetTokenFromUrl = new URLSearchParams(window.location.search).get('resetToken');
  if (resetTokenFromUrl) {
    pendingResetToken = resetTokenFromUrl;
    window.history.replaceState({}, '', '/login');
    showResetPasswordForm();
    $('#resetNewPassword').focus();
    return;
  }

  /* Already-authenticated visitors (a valid refresh cookie still on file)
     skip the form entirely rather than being asked to log in again. A
     definitive 401 means there's really no session; anything else (rate
     limiting, a 5xx, a dropped connection) gets one retry before falling
     back to showing the form, so a transient hiccup doesn't force a
     needless re-login. */
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const res = await fetch('/api/auth/refresh', { method: 'POST', credentials: 'include' });
      if (res.ok) {
        window.location.href = '/';
        return;
      }
      if (res.status === 401) break;
    } catch (err) { /* fall through to retry / show the form below */ }
    if (attempt === 0) await new Promise((resolve) => setTimeout(resolve, 1000));
  }
})();
