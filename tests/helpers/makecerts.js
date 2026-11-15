'use strict';
/* Test-only X.509 lab. Builds a private test CA, server certificates, and a
   decoy CA in pure Node crypto (no openssl/keytool dependency) so TLS-policy
   tests run hermetically offline.
   These fixtures exist ONLY in memory for automated tests. They are not real
   credentials and must never leave the test process. */
const crypto = require('crypto');

function lenBuf(n) {
  if (n < 128) return Buffer.from([n]);
  const bytes = [];
  let x = n;
  while (x > 0) { bytes.unshift(x & 0xff); x >>>= 8; }
  return Buffer.from([0x80 | bytes.length, ...bytes]);
}
function tlv(tag, ...parts) {
  const body = Buffer.concat(parts);
  return Buffer.concat([Buffer.from([tag]), lenBuf(body.length), body]);
}
const SEQ = (...p) => tlv(0x30, ...p);
const SET = (...p) => tlv(0x31, ...p);
const EXP = (n, ...p) => tlv(0xa0 | n, ...p);
function INT(buf) {
  let b = Buffer.isBuffer(buf) ? Buffer.from(buf) : Buffer.from(buf);
  if (b.length === 0) b = Buffer.from([0]);
  if (b[0] & 0x80) b = Buffer.concat([Buffer.from([0x00]), b]);
  return tlv(0x02, b);
}
const INTN = (n) => INT(Buffer.from([n & 0x7f])); // small positive integers only
const NULL_DER = Buffer.from([0x05, 0x00]);
function OID(s) {
  const a = s.split('.').map(Number);
  const out = [a[0] * 40 + a[1]];
  for (const v of a.slice(2)) {
    const st = [];
    let x = v;
    do { st.unshift(x & 0x7f); x >>= 7; } while (x > 0);
    for (let i = 0; i < st.length - 1; i++) st[i] |= 0x80;
    out.push(...st);
  }
  return tlv(0x06, Buffer.from(out));
}
const UTF8 = (s) => tlv(0x0c, Buffer.from(s, 'utf8'));
const UTCT = (s) => tlv(0x17, Buffer.from(s, 'ascii'));
const OCT = (b) => tlv(0x04, b);
const BITSTR = (bytes, unused = 0) => tlv(0x03, Buffer.concat([Buffer.from([unused]), Buffer.from(bytes)]));
const BOOL = (v) => tlv(0x01, Buffer.from([v ? 0xff : 0x00]));

const b64u = (s) => Buffer.from(String(s).replace(/-/g, '+').replace(/_/g, '/'), 'base64');

function rsaSpki(pubKey) {
  const jwk = pubKey.export({ format: 'jwk' });
  const rsaPub = SEQ(INT(b64u(jwk.n)), INT(b64u(jwk.e)));
  return SEQ(SEQ(OID('1.2.840.113549.1.1.1'), NULL_DER), BITSTR(rsaPub, 0));
}
const dn = (cn) => SEQ(SET(SEQ(OID('2.5.4.3'), UTF8(cn))));
const SIG_ALG = () => SEQ(OID('1.2.840.113549.1.1.11'), NULL_DER); // sha256WithRSAEncryption
const VALIDITY = SEQ(UTCT('200101000000Z'), UTCT('350101000000Z'));

// keyUsage bits: digitalSignature(0) keyEncipherment(2) | keyCertSign(5) cRLSign(6)
const kuServer = () => SEQ(OID('2.5.29.15'), OCT(BITSTR(Buffer.from([0xa0]), 5)));
const kuCA = () => SEQ(OID('2.5.29.15'), OCT(BITSTR(Buffer.from([0x86]), 1)));
const bcCA = () => SEQ(OID('2.5.29.19'), BOOL(true), OCT(SEQ(BOOL(true))));

function sanExt(dnsNames, ips) {
  const parts = [];
  for (const d of dnsNames) parts.push(tlv(0x82, Buffer.from(d, 'ascii')));
  for (const ip of ips) parts.push(tlv(0x87, Buffer.from(String(ip).split('.').map(Number))));
  return SEQ(OID('2.5.29.17'), OCT(SEQ(...parts)));
}

function makeCert({ subjectCN, issuerCN, subjectKey, issuerKey, serial, dns = [], ips = [], ca = false }) {
  const exts = ca ? [bcCA(), kuCA()] : [kuServer(), ...((dns.length || ips.length) ? [sanExt(dns, ips)] : [])];
  const tbs = SEQ(
    EXP(0, INTN(2)),
    INTN(serial),
    SIG_ALG(),
    dn(issuerCN),
    VALIDITY,
    dn(subjectCN),
    rsaSpki(subjectKey),
    EXP(3, SEQ(...exts))
  );
  const sig = crypto.sign('sha256', tbs, issuerKey);
  const cert = SEQ(tbs, SIG_ALG(), BITSTR(sig, 0));
  return '-----BEGIN CERTIFICATE-----\n' + cert.toString('base64').match(/.{1,64}/g).join('\n') + '\n-----END CERTIFICATE-----\n';
}

function makeLab() {
  const ca = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });
  const decoy = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });
  const srv = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });
  const other = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });
  const pemKey = (k) => k.export({ format: 'pem', type: 'pkcs8' });
  return {
    caCert: makeCert({ subjectCN: 'PH Test Lab CA', issuerCN: 'PH Test Lab CA', subjectKey: ca.publicKey, issuerKey: ca.privateKey, serial: 1, ca: true }),
    decoyCaCert: makeCert({ subjectCN: 'PH Decoy CA', issuerCN: 'PH Decoy CA', subjectKey: decoy.publicKey, issuerKey: decoy.privateKey, serial: 2, ca: true }),
    serverCert: makeCert({ subjectCN: 'localhost', issuerCN: 'PH Test Lab CA', subjectKey: srv.publicKey, issuerKey: ca.privateKey, serial: 3, dns: ['localhost'], ips: ['127.0.0.1'] }),
    serverKey: pemKey(srv.privateKey),
    mismatchCert: makeCert({ subjectCN: 'other.invalid', issuerCN: 'PH Test Lab CA', subjectKey: other.publicKey, issuerKey: ca.privateKey, serial: 4, dns: ['other.invalid'] }),
    mismatchKey: pemKey(other.privateKey),
  };
}

module.exports = { makeLab };
