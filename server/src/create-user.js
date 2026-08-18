require('dotenv').config();
const bcrypt = require('bcryptjs');
const db = require('./db');
const { ALL_ROLES, ROLES } = require('./common/constants/roles');

const VALID_ROLES = ALL_ROLES;

const [, , emailArg, passwordArg, roleArg] = process.argv;

if (!emailArg || !passwordArg) {
  console.error(`Usage: node src/create-user.js <email> <password> [role: ${VALID_ROLES.join('|')}]`);
  process.exit(1);
}

const email = emailArg.trim().toLowerCase();
const password = passwordArg;

if (!email) {
  console.error('Email cannot be empty.');
  process.exit(1);
}

if (password.length < 6) {
  console.error('Password must be at least 6 characters long.');
  process.exit(1);
}

let role = ROLES.EMPLOYEE;
if (roleArg !== undefined) {
  if (!VALID_ROLES.includes(roleArg)) {
    console.error(`Invalid role "${roleArg}". Must be one of: ${VALID_ROLES.join(', ')}.`);
    process.exit(1);
  }
  role = roleArg;
}

const existing = db.prepare('SELECT id FROM users WHERE email = ?').get(email);
if (existing) {
  console.error(`A user with email "${email}" already exists.`);
  process.exit(1);
}

const passwordHash = bcrypt.hashSync(password, 12);
db.prepare('INSERT INTO users (email, password_hash, role) VALUES (?, ?, ?)').run(email, passwordHash, role);

console.log(`Created ${role} account: ${email}`);
