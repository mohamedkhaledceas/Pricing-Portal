require('dotenv').config();
const bcrypt = require('bcryptjs');
const db = require('./db');

const username = (process.env.SEED_OWNER_USERNAME || 'owner').trim().toLowerCase();
const password = process.env.SEED_OWNER_PASSWORD || 'owner123';

const existing = db.prepare('SELECT id FROM users WHERE username = ?').get(username);
if (existing) {
  console.log(`Owner user already exists: ${username}`);
  process.exit(0);
}

const passwordHash = bcrypt.hashSync(password, 12);
db.prepare(
  'INSERT INTO users (username, password_hash, role) VALUES (?, ?, ?)'
).run(username, passwordHash, 'owner');

console.log(`Created default owner account: ${username} / ${password}`);
console.log('Change the password immediately in production.');
