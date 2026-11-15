'use strict';
/* AK/SK signature per Hikvision OpenAPI Developer Guide V3.1.1.

   Signature string = METHOD + "\n" + Accept + "\n" + Content-MD5 + "\n"
                    + Content-Type + "\n" + Date + "\n" + SignedHeaders + Uri
   Signature = Base64(HMAC-SHA256(appSecret, signatureString), UTF-8)

   Headers excluded from signature:
   X-Ca-Signature, X-Ca-Signature-Headers, Accept, Content-MD5, Content-Type,
   Date, Content-Length, Server, Connection, Host, Transfer-Encoding,
   X-Application-Context, Content-Encoding.
*/

const crypto = require('crypto');

const EXCLUDED_FROM_SIGNATURE = new Set([
  'x-ca-signature',
  'x-ca-signature-headers',
  'accept',
  'content-md5',
  'content-type',
  'date',
  'content-length',
  'server',
  'connection',
  'host',
  'transfer-encoding',
  'x-application-context',
  'content-encoding',
]);

function isoDate() {
  return new Date().toUTCString();
}

function uuidv4() {
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    const v = c === 'x' ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

/* Build the signature string. `signedHeaders` are the custom header names to
   include (already lowercased). They are sorted alphabetically. */
function buildSignatureString({ method, uri, headers, signedHeaders }) {
  const lines = [];
  lines.push(method.toUpperCase());
  lines.push(String(headers.accept || '*/*'));
  lines.push(String(headers['content-md5'] || ''));
  lines.push(String(headers['content-type'] || ''));
  lines.push(String(headers.date || ''));

  const signed = (signedHeaders || []).slice().sort((a, b) => a.localeCompare(b));
  for (const name of signed) {
    const value = String(headers[name] || '').trim();
    lines.push(`${name}:${value}`);
  }

  lines.push(uri);
  return lines.join('\n');
}

function signRequest({ secret, signatureString }) {
  const hmac = crypto.createHmac('sha256', Buffer.from(secret, 'utf8'));
  const digest = hmac.update(Buffer.from(signatureString, 'utf8')).digest();
  return Buffer.from(digest).toString('base64');
}

/* Produce the full set of signed request headers for a HCP OpenAPI call. */
function signRequestHeaders({ method, uri, body, appKey, appSecret, signedHeaders = [] }) {
  const timestamp = Date.now().toString();
  const nonce = uuidv4();
  const date = isoDate();

  const contentType = 'application/json;charset=UTF-8';
  const accept = 'application/json';
  const bodyStr = body ? JSON.stringify(body) : '';
  const contentMd5 = bodyStr
    ? Buffer.from(crypto.createHash('md5').update(bodyStr, 'utf8').digest()).toString('base64')
    : '';

  const headers = {
    accept,
    'content-md5': contentMd5,
    'content-type': contentType,
    date,
    'x-ca-key': appKey,
    'x-ca-timestamp': timestamp,
    'x-ca-nonce': nonce,
  };

  // Add signed headers to the header map so they appear in x-ca-signature-headers
  for (const h of signedHeaders) {
    if (!(h in headers)) headers[h] = '';
  }
  headers['x-ca-signature-headers'] = signedHeaders.slice().sort().join(',');

  const signatureString = buildSignatureString({
    method,
    uri: uri || '',
    headers,
    signedHeaders,
  });
  const signature = signRequest({ secret: appSecret, signatureString });
  headers['x-ca-signature'] = signature;

  return headers;
}

module.exports = {
  buildSignatureString,
  signRequest,
  signRequestHeaders,
  isoDate,
  uuidv4,
};
