const { AuthError } = require('../errors');

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const MIN_PASSWORD_LENGTH = 8;

/* Factory-function DI (ADR-0006): every dependency is a plain argument, so a
   unit test can pass plain mock objects for userRepository/refreshTokenRepository/
   audit/etc. without jest.mock path interception — see docs/testing.md. */
function createAuthService({
  userRepository,
  refreshTokenRepository,
  passwordResetTokenRepository,
  userModel,
  hashPassword,
  comparePassword,
  signAccessToken,
  audit,
  roles,
  sendEmail,
  logger,
}) {
  /* Every signup creates a plain default-role account — elevated roles are
     only ever granted afterward, via accountAdminService.changeRole by an
     admin/manager/operations account (or, for bootstrapping a brand-new
     deploy, create-user.js through a shell before any admin account exists
     yet). Unchanged behavior from before this module existed — only the
     default role literal changed, 'user' -> 'employee'. */
  // workDetails/transaction/createEmployeeProfile: the signup wizard's step
  // 2 (job title, department, etc.) is submitted together with step 1 in a
  // single request (see modules/auth/views/js/main.js) and must create both
  // the users row and the employees row atomically — no orphaned account if
  // the employee-side validation fails (bad department, manager mismatch,
  // etc.). createEmployeeProfile is injected rather than required directly,
  // since auth must never import employees' services (module-boundary
  // rule) — see auth/container.js's setEmployeeProvisioner and
  // modules/employees/services/rosterService.js's createForSelfRegistration
  // for the other side of this. transaction follows the exact same
  // call-time-injected pattern changePassword below already uses.
  function register({ email, password, firstName, lastName, workDetails, ip, transaction, createEmployeeProfile }) {
    const normalizedEmail = typeof email === 'string' ? email.trim().toLowerCase() : '';
    const trimmedFirstName = typeof firstName === 'string' ? firstName.trim() : '';
    const trimmedLastName = typeof lastName === 'string' ? lastName.trim() : '';

    if (!normalizedEmail || !EMAIL_RE.test(normalizedEmail)) {
      throw new AuthError('Please enter a valid email address.');
    }
    if (!trimmedFirstName || !trimmedLastName) {
      throw new AuthError('First and last name are required.');
    }
    if (!password || typeof password !== 'string' || password.length < MIN_PASSWORD_LENGTH) {
      throw new AuthError(`Password must be at least ${MIN_PASSWORD_LENGTH} characters long.`);
    }
    if (userRepository.existsByEmail(normalizedEmail)) {
      throw new AuthError('An account with this email already exists.', 409);
    }

    return transaction(() => {
      const user = userRepository.insert({
        email: normalizedEmail,
        firstName: trimmedFirstName,
        lastName: trimmedLastName,
        passwordHash: hashPassword(password),
        role: roles.EMPLOYEE,
      });

      if (createEmployeeProfile) {
        createEmployeeProfile({ userId: user.id, ...(workDetails || {}), actorId: user.id, ip });
      }

      const refreshToken = refreshTokenRepository.issue(user.id);
      audit.record({ userId: user.id, username: user.email, action: 'user.signup', entityType: 'user', entityId: String(user.id), ip });

      return { token: signAccessToken(user), user: userModel.toPublicUser(user), refreshToken };
    });
  }

  function login({ email, password, ip }) {
    if (!email || typeof email !== 'string' || !email.trim()) {
      throw new AuthError('Email is required.');
    }
    if (!password || typeof password !== 'string') {
      throw new AuthError('Password is required.');
    }

    const normalizedEmail = email.trim().toLowerCase();
    const user = userRepository.findByEmail(normalizedEmail);
    if (!user) {
      audit.record({ username: normalizedEmail, action: 'user.login_failed', entityType: 'user', ip });
      throw new AuthError('Invalid email or password.', 401);
    }

    if (!comparePassword(password, user.password_hash)) {
      audit.record({ userId: user.id, username: user.email, action: 'user.login_failed', entityType: 'user', entityId: String(user.id), ip });
      throw new AuthError('Invalid email or password.', 401);
    }

    if (!user.is_active) {
      audit.record({ userId: user.id, username: user.email, action: 'user.login_blocked_inactive', entityType: 'user', entityId: String(user.id), ip });
      throw new AuthError('This account has been deactivated.', 403);
    }

    const refreshToken = refreshTokenRepository.issue(user.id);
    audit.record({ userId: user.id, username: user.email, action: 'user.login', entityType: 'user', entityId: String(user.id), ip });

    return { token: signAccessToken(user), user: userModel.toPublicUser(user), refreshToken };
  }

  function refresh({ rawToken }) {
    const tokenRow = refreshTokenRepository.findValid(rawToken);
    let userId;

    if (tokenRow) {
      /* Simple rotation: the old refresh token is invalidated and a new one
         issued on every use. A reused (already-rotated) or previously
         logged-out token fails the findValid() lookup above — it does not
         trigger a mass revocation of the user's other sessions, which
         would be more than this internal application needs. */
      userId = tokenRow.user_id;
      refreshTokenRepository.revokeById(tokenRow.id, 'rotated');
    } else {
      /* Not currently valid — but if it was revoked moments ago, this is
         very likely a losing request in a rotation race (see
         REFRESH_REUSE_GRACE_MS in refreshTokenRepository), not a
         stale/replayed token. Let it through with a fresh pair instead of
         forcing a spurious logout; anything revoked further back still
         fails exactly as before. */
      const recentlyRevoked = refreshTokenRepository.findRecentlyRevoked(rawToken);
      if (!recentlyRevoked) {
        throw new AuthError('Your session has expired. Please log in again.', 401);
      }
      userId = recentlyRevoked.user_id;
    }

    const user = userRepository.findById(userId);
    if (!user) {
      throw new AuthError('Your session has expired. Please log in again.', 401);
    }

    const newRefreshToken = refreshTokenRepository.issue(user.id);
    return { token: signAccessToken(user), user: userModel.toPublicUser(user), refreshToken: newRefreshToken };
  }

  function logout({ rawToken, ip }) {
    const tokenRow = refreshTokenRepository.findValid(rawToken);
    refreshTokenRepository.revokeByRaw(rawToken, 'logout');
    if (tokenRow) {
      audit.record({ userId: tokenRow.user_id, action: 'user.logout', entityType: 'user', entityId: String(tokenRow.user_id), ip });
    }
  }

  function getMe(userId) {
    const user = userRepository.findById(userId);
    if (!user) throw new AuthError('User not found.', 404);
    return userModel.toPublicUser(user);
  }

  function updateProfile({ userId, firstName, lastName }) {
    const trimmedFirstName = typeof firstName === 'string' ? firstName.trim() : '';
    const trimmedLastName = typeof lastName === 'string' ? lastName.trim() : '';
    if (!trimmedFirstName || !trimmedLastName) {
      throw new AuthError('First and last name are required.');
    }
    const user = userRepository.updateProfile(userId, { firstName: trimmedFirstName, lastName: trimmedLastName });
    return userModel.toPublicUser(user);
  }

  function changePassword({ userId, currentPassword, newPassword, transaction }) {
    if (!currentPassword || typeof currentPassword !== 'string') {
      throw new AuthError('Current password is required.');
    }
    if (!newPassword || typeof newPassword !== 'string' || newPassword.length < MIN_PASSWORD_LENGTH) {
      throw new AuthError(`New password must be at least ${MIN_PASSWORD_LENGTH} characters long.`);
    }

    const user = userRepository.findById(userId);
    if (!user || !comparePassword(currentPassword, user.password_hash)) {
      throw new AuthError('Current password is incorrect.', 401);
    }

    /* Revokes this session's refresh cookie too — the still-valid access
       token keeps the current tab working until it expires, but refreshing
       or logging in again anywhere requires the new password from that
       point on. Both writes happen atomically so a crash between them can
       never leave a changed password with the old sessions still live. */
    transaction(() => {
      userRepository.updatePasswordHash(userId, hashPassword(newPassword));
      refreshTokenRepository.revokeAllForUser(userId, 'password_change');
    });
  }

  function resetPasswordEmailHtml(resetUrl) {
    return `<p>Someone requested a password reset for your CEAS Portal account.</p>
<p><a href="${resetUrl}">Click here to reset your password</a>. This link expires in 30 minutes and can only be used once.</p>
<p>If you didn't request this, you can safely ignore this email — your password hasn't been changed.</p>`;
  }

  /* Always resolves the same way regardless of whether `email` belongs to a
     real, active account — the caller (authController) returns one generic
     "if an account exists, a link was sent" message either way, so this
     can't be used to enumerate registered emails. A deactivated account is
     deliberately treated the same as a nonexistent one: it already can't
     log in with the correct password either (see login() above), so
     letting it regain access via a reset link would be inconsistent. The
     email send is awaited but its failure is only logged, never thrown —
     a Resend outage must not turn into a response that reveals "this
     address doesn't have an account" by process of elimination (fails
     fast vs. fails slow), and must not block/error the generic response
     the caller always gives. */
  async function forgotPassword({ email, baseUrl, ip }) {
    const normalizedEmail = typeof email === 'string' ? email.trim().toLowerCase() : '';
    if (!normalizedEmail || !EMAIL_RE.test(normalizedEmail)) {
      throw new AuthError('Please enter a valid email address.');
    }

    const user = userRepository.findByEmail(normalizedEmail);
    if (user && user.is_active) {
      passwordResetTokenRepository.invalidateAllForUser(user.id);
      const rawToken = passwordResetTokenRepository.issue(user.id);
      const resetUrl = `${baseUrl}/login?resetToken=${rawToken}`;
      // Audited on issuance itself, not gated on the email send succeeding
      // — issuing a live reset token is the security-relevant event; a
      // Resend outage shouldn't also mean it goes unaudited.
      audit.record({ userId: user.id, username: user.email, action: 'user.password_reset_requested', entityType: 'user', entityId: String(user.id), ip });

      // Deliberately not awaited: this function (and the fixed, generic
      // response authController.forgotPassword always sends either way)
      // must take the same amount of time whether or not `email` matched a
      // real, active account. Awaiting a real network round-trip to Resend
      // only on the "found" branch would leak exactly the signal the
      // generic response is designed to hide — just via response timing
      // instead of response content. A failed send is still logged, just
      // asynchronously.
      sendEmail({ to: user.email, subject: 'Reset your CEAS Portal password', html: resetPasswordEmailHtml(resetUrl) })
        .catch((error) => {
          logger.error('Failed to send password reset email', { userId: user.id, error: error.message });
        });
    }
  }

  function resetPassword({ rawToken, newPassword, transaction, ip }) {
    if (!newPassword || typeof newPassword !== 'string' || newPassword.length < MIN_PASSWORD_LENGTH) {
      throw new AuthError(`New password must be at least ${MIN_PASSWORD_LENGTH} characters long.`);
    }
    const tokenRow = passwordResetTokenRepository.findValid(rawToken);
    if (!tokenRow) {
      throw new AuthError('This reset link is invalid or has expired. Please request a new one.');
    }

    // Re-checked here, not just at request time in forgotPassword above —
    // the account could have been deactivated in the window between
    // issuing the token and it being used (e.g. an employee is offboarded
    // minutes after requesting a reset). Same generic error as an
    // invalid/expired token, not a distinct message, so this still can't
    // be used to learn an account's active/deactivated status.
    const user = userRepository.findById(tokenRow.user_id);
    if (!user || !user.is_active) {
      throw new AuthError('This reset link is invalid or has expired. Please request a new one.');
    }

    // Same revoke-all-sessions behavior as changePassword above, and the
    // same reason: a session that's still live on another device shouldn't
    // silently survive a password reset.
    transaction(() => {
      userRepository.updatePasswordHash(tokenRow.user_id, hashPassword(newPassword));
      passwordResetTokenRepository.markUsed(tokenRow.id);
      refreshTokenRepository.revokeAllForUser(tokenRow.user_id, 'password_reset');
    });

    audit.record({ userId: tokenRow.user_id, action: 'user.password_reset_completed', entityType: 'user', entityId: String(tokenRow.user_id), ip });
  }

  return { register, login, refresh, logout, getMe, updateProfile, changePassword, forgotPassword, resetPassword };
}

module.exports = createAuthService;
