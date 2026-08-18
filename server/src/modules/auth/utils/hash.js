const bcrypt = require('bcryptjs');

const SALT_ROUNDS = 12;

function hashPassword(plainPassword) {
  return bcrypt.hashSync(plainPassword, SALT_ROUNDS);
}

function comparePassword(plainPassword, passwordHash) {
  return bcrypt.compareSync(plainPassword, passwordHash);
}

module.exports = { hashPassword, comparePassword };
