import { $ } from './dom.js';
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

function showLoginForm() {
  $('#signupForm').hidden = true;
  $('#loginForm').hidden = false;
}
function showSignupForm() {
  $('#loginForm').hidden = true;
  $('#signupForm').hidden = false;
}

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

$('#signupForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  const firstName = $('#signupFirstName').value.trim();
  const lastName = $('#signupLastName').value.trim();
  const email = $('#signupEmail').value.trim();
  const password = $('#signupPassword').value;
  const passwordConfirm = $('#signupPasswordConfirm').value;
  const errBox = $('#signupError');
  errBox.hidden = true;
  errBox.textContent = '';
  if (!firstName || !lastName || !email || !password || !passwordConfirm) {
    errBox.textContent = 'Please fill in every field.';
    errBox.hidden = false;
    return;
  }
  if (password.length < 8) {
    errBox.textContent = 'Password must be at least 8 characters long.';
    errBox.hidden = false;
    return;
  }
  if (password !== passwordConfirm) {
    errBox.textContent = 'Passwords do not match.';
    errBox.hidden = false;
    return;
  }
  const submitBtn = $('#signupForm').querySelector('button[type=submit]');
  setButtonLoading(submitBtn, true, 'Creating account…');
  try {
    await apiPost('/api/auth/register', { email, password, firstName, lastName });
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
  if (window.matchMedia) {
    window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', paintLogo);
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
