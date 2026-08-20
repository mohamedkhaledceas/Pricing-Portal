require('dotenv').config();
const crypto = require('crypto');
const bcrypt = require('bcryptjs');
const db = require('./db');

const email = (process.env.SEED_OWNER_USERNAME || 'owner').trim().toLowerCase();
const password = process.env.SEED_OWNER_PASSWORD || 'owner123';

const existing = db.prepare('SELECT id FROM users WHERE email = ?').get(email);
if (existing) {
  console.log(`Admin user already exists: ${email}`);
  process.exit(0);
}

const passwordHash = bcrypt.hashSync(password, 12);
db.prepare(
  'INSERT INTO users (email, password_hash, role, uuid) VALUES (?, ?, ?, ?)'
).run(email, passwordHash, 'admin', crypto.randomUUID());

console.log(`Created default admin account: ${email} / ${password}`);
console.log('Change the password immediately in production.');
