'use strict';
/* Authenticated encryption for VPN passwords / OpenAPI secrets at rest.
   AES-256-GCM via Node built-in crypto. Key comes ONLY from env:
     HCP_VAULT_KEY = 64 hex chars (32 bytes). Never committed, never logged.
   If missing -> fail secure: encrypt()/decrypt() throw with setup instructions.
   For automated tests only: HCP_VAULT_KEY may be set to a temp value. */
const crypto = require('crypto');

const ALG = 'aes-256-gcm';
const IV_LEN = 12;

function keyInstructions() {
  return 'Missing HCP_VAULT_KEY. Generate one with: node -e "console.log(require(\'crypto\').randomBytes(32).toString(\'hex\'))" '
    + 'then set env HCP_VAULT_KEY=<64-hex> before starting the server (local dev: set it in start.bat / PowerShell $env:HCP_VAULT_KEY=...; '
    + 'production: use the approved secret manager / service env). Secrets are NEVER stored in plaintext.';
}

function getKey() {
  const hex = (process.env.HCP_VAULT_KEY || '').trim();
  if (!/^[0-9a-fA-F]{64}$/.test(hex)) throw new Error(keyInstructions());
  return Buffer.from(hex, 'hex');
}

function vaultAvailable() {
  return /^[0-9a-fA-F]{64}$/.test((process.env.HCP_VAULT_KEY || '').trim());
}

function encrypt(plaintext) {
  if (plaintext == null || plaintext === '') return null;
  const key = getKey();
  const iv = crypto.randomBytes(IV_LEN);
  const cipher = crypto.createCipheriv(ALG, key, iv);
  const ct = Buffer.concat([cipher.update(String(plaintext), 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `v1:${iv.toString('base64')}:${tag.toString('base64')}:${ct.toString('base64')}`;
}

function decrypt(payload) {
  if (payload == null || payload === '') return null;
  const key = getKey();
  const parts = String(payload).split(':');
  if (parts.length !== 4 || parts[0] !== 'v1') throw new Error('Unknown vault payload format.');
  const [_, ivB64, tagB64, ctB64] = parts;
  const decipher = crypto.createDecipheriv(ALG, key, Buffer.from(ivB64, 'base64'));
  decipher.setAuthTag(Buffer.from(tagB64, 'base64'));
  return Buffer.concat([decipher.update(Buffer.from(ctB64, 'base64')), decipher.final()]).toString('utf8');
}

function isVaultPayload(v) {
  return typeof v === 'string' && v.startsWith('v1:');
}

module.exports = { encrypt, decrypt, vaultAvailable, keyInstructions, isVaultPayload };
