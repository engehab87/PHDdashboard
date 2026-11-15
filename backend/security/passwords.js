'use strict';
/* Password hashing (scrypt) and token helpers. No plaintext password is ever stored or logged. */
const crypto = require('crypto');

const KEYLEN = 64;
const SCRYPT = { N: 16384, r: 8, p: 1, maxmem: 64 * 1024 * 1024 };

function hashPassword(password, salt) {
  const s = salt || crypto.randomBytes(16).toString('hex');
  const hash = crypto.scryptSync(String(password), s, KEYLEN, SCRYPT).toString('hex');
  return { hash, salt: s };
}

function verifyPassword(password, salt, expectedHash) {
  try {
    const actual = crypto.scryptSync(String(password), String(salt), KEYLEN, SCRYPT);
    const expected = Buffer.from(String(expectedHash), 'hex');
    if (expected.length !== actual.length) return false;
    return crypto.timingSafeEqual(actual, expected);
  } catch (_) {
    return false;
  }
}

function newToken(bytes = 32) {
  return crypto.randomBytes(bytes).toString('hex');
}

function sha256(value) {
  return crypto.createHash('sha256').update(String(value)).digest('hex');
}

module.exports = { hashPassword, verifyPassword, newToken, sha256 };
