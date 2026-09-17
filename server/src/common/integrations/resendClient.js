/* The one place RESEND_API_KEY is read — a thin wrapper around Resend's
   REST API (https://resend.com/docs/api-reference/emails/send-email), same
   shape as clickupClient.js alongside it: no SDK dependency, plain fetch,
   never returns the raw key. Shared by every module that needs to send an
   email (today: none yet — this is the standalone module itself, built
   ahead of its first real caller per the user's own decision to stand this
   up before wiring it into Forgot Password/Notifications). */
const config = require('../../config');
const { AppError } = require('../errors');

const RESEND_BASE = 'https://api.resend.com';

// html or text (or both) is required by Resend's API — enforced here so a
// caller gets an immediate, clear error instead of a 422 from Resend.
async function sendEmail({ to, subject, html, text, from }) {
  if (!config.resendApiKey) {
    throw new AppError('Email is not configured — set RESEND_API_KEY.', 500);
  }
  const sender = from || config.emailFrom;
  if (!sender) {
    throw new AppError('Email is not configured — set EMAIL_FROM (or pass `from` explicitly).', 500);
  }
  if (!to || !subject || (!html && !text)) {
    throw new AppError('sendEmail requires `to`, `subject`, and at least one of `html`/`text`.', 500);
  }

  const res = await fetch(`${RESEND_BASE}/emails`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${config.resendApiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      from: sender,
      to: Array.isArray(to) ? to : [to],
      subject,
      ...(html ? { html } : {}),
      ...(text ? { text } : {}),
    }),
  });

  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new AppError(`Resend API error (${res.status}) sending to ${to}: ${body.message || JSON.stringify(body)}`, 502);
  }
  return body; // { id: '...' } on success — Resend's own message id, useful for support/log correlation
}

module.exports = { sendEmail };
