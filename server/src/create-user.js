require('dotenv').config();
const bcrypt = require('bcryptjs');
const db = require('./db');

const [, , usernameArg, passwordArg, roleArg] = process.argv;

if (!usernameArg || !passwordArg) {
  console.error('Usage: node src/create-user.js <username> <password> [role: user|owner]');
  process.exit(1);
}

const username = usernameArg.trim().toLowerCase();
const password = passwordArg;

if (!username) {
  console.error('Username cannot be empty.');
  process.exit(1);
}

if (password.length < 6) {
  console.error('Password must be at least 6 characters long.');
  process.exit(1);
}

let role = 'user';
if (roleArg !== undefined) {
  if (roleArg !== 'user' && roleArg !== 'owner') {
    console.error(`Invalid role "${roleArg}". Must be "user" or "owner".`);
    process.exit(1);
  }
  role = roleArg;
}

const existing = db.prepare('SELECT id FROM users WHERE username = ?').get(username);
if (existing) {
  console.error(`A user named "${username}" already exists.`);
  process.exit(1);
}

const passwordHash = bcrypt.hashSync(password, 12);
db.prepare('INSERT INTO users (username, password_hash, role) VALUES (?, ?, ?)').run(username, passwordHash, role);

console.log(`Created ${role} account: ${username}`);
