const { AuthError } = require('../errors');

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const MIN_PASSWORD_LENGTH = 8;

/* Factory-function DI (ADR-0006): every dependency is a plain argument, so a
   unit test can pass plain mock objects for userRepository/refreshTokenRepository/
   audit/etc. without jest.mock path interception — see docs/testing.md. */
function createAuthService({
  userRepository,
  refreshTokenRepository,
  userModel,
  hashPassword,
  comparePassword,
  signAccessToken,
  audit,
  roles,
}) {
  /* Every signup creates a plain default-role account — elevated roles are
     only ever granted afterward, via accountAdminService.changeRole by an
     admin/manager/operations account (or, for bootstrapping a brand-new
     deploy, create-user.js through a shell before any admin account exists
     yet). Unchanged behavior from before this module existed — only the
     default role literal changed, 'user' -> 'employee'. */
  function register({ email, password, firstName, lastName, ip }) {
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

    const user = userRepository.insert({
      email: normalizedEmail,
      firstName: trimmedFirstName,
      lastName: trimmedLastName,
      passwordHash: hashPassword(password),
      role: roles.EMPLOYEE,
    });

    const refreshToken = refreshTokenRepository.issue(user.id);
    audit.record({ userId: user.id, username: user.email, action: 'user.signup', entityType: 'user', entityId: String(user.id), ip });

    return { token: signAccessToken(user), user: userModel.toPublicUser(user), refreshToken };
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

  return { register, login, refresh, logout, getMe, updateProfile, changePassword };
}

module.exports = createAuthService;
