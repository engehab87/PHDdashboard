'use strict';
/* HCP OpenAPI client for Hikvision HikCentral Professional (Artemis v2.6).

   Implements read-only POST calls with AK/SK signature per the official
   Hikvision OpenAPI Developer Guide V3.1.1. TLS verification is always
   enforced; an optional per-agent pinned CA may be supplied.
*/

const https = require('https');
const http = require('http');
const { signRequestHeaders } = require('./auth');
const log = require('./logger');

/* Make a signed POST request to a HCP OpenAPI endpoint.
   Returns { ok, status, body, parsed, error, code }.
   `path` must include the leading slash, e.g. '/artemis/api/common/v1/version'.
*/
function hcpRequest({ config, path, body }) {
  return new Promise((resolve) => {
    const { host, port, https: useHttps, tlsVerify, tlsCa, readTimeoutMs, appKey, appSecret } = config.hcp;

    const protocol = useHttps ? 'https:' : 'http:';
    const baseUrl = `${protocol}//${host}:${port}`;
    const url = baseUrl + path;
    const isTls = url.startsWith('https:');

    // Signed headers: the custom x-ca-* headers are part of the signature.
    const signedHeaders = ['x-ca-key', 'x-ca-timestamp', 'x-ca-nonce'];
    const headers = signRequestHeaders({
      method: 'POST',
      uri: path,
      body,
      appKey,
      appSecret,
      signedHeaders,
    });

    const agentOpts = {
      rejectUnauthorized: tlsVerify,
      keepAlive: false,
    };
    if (tlsCa) {
      agentOpts.ca = tlsCa;
      agentOpts.rejectUnauthorized = true;
    }
    const agent = isTls ? new https.Agent(agentOpts) : new http.Agent({ keepAlive: false });

    const mod = isTls ? https : http;
    const req = mod.request(url, {
      method: 'POST',
      headers,
      agent,
      timeout: readTimeoutMs,
    }, (res) => {
      let data = '';
      res.on('data', (c) => { data += c; });
      res.on('end', () => {
        if (agent) agent.destroy();
        let parsed = null;
        try { parsed = JSON.parse(data || '{}'); } catch (_) { /* keep parsed null */ }
        resolve({
          ok: res.statusCode >= 200 && res.statusCode < 300,
          status: res.statusCode,
          body: data,
          parsed,
          error: null,
        });
      });
    });

    req.on('timeout', () => {
      req.destroy(new Error('request timed out'));
      resolve({ ok: false, status: null, body: '', parsed: null, error: 'request timed out', code: 'API_TIMEOUT' });
    });
    req.on('error', (e) => {
      if (agent) agent.destroy();
      resolve({ ok: false, status: null, body: '', parsed: null, error: String(e.message || e), code: 'API_UNREACHABLE' });
    });
    if (body) req.write(JSON.stringify(body));
    req.end();
  });
}

/* POST /artemis/api/common/v1/version — version discovery / auth test */
async function version({ config }) {
  const r = await hcpRequest({ config, path: '/artemis/api/common/v1/version', body: {} });
  if (!r.ok) {
    return { ok: false, blocked: 'auth-failure', message: `Version discovery failed: HTTP ${r.status || '?'}${r.error ? ' — ' + r.error : ''}` };
  }
  const parsed = r.parsed || {};
  if (parsed.code !== '0') {
    return { ok: false, blocked: 'auth-failure', message: `Version discovery rejected: code=${parsed.code} msg=${parsed.msg || ''}` };
  }
  const softVersion = (parsed.data && parsed.data.softVersion) || null;
  return { ok: true, detectedHcpVersion: softVersion, message: softVersion ? `platform version ${softVersion}` : 'version discovery succeeded' };
}

/* POST /artemis/api/pms/v1/crossRecords/page — vehicle access events.
   Requires cameraIndexCode. Enforces 31-day window. Max 500/page.
*/
async function vehicleEvents({ config, pageNo = 1, pageSize = 500, lookbackDays = 30, cameraIndexCode }) {
  const cam = cameraIndexCode || config.hcp.cameraIndexCode;
  if (!cam) {
    return { ok: false, blocked: 'missing-camera', message: 'crossRecords/page requires cameraIndexCode. Configure HCP_CAMERA_INDEX_CODE.', records: [] };
  }

  const endTime = new Date();
  const startTime = new Date(Date.now() - lookbackDays * 24 * 60 * 60 * 1000);
  const fmt = (d) => d.toISOString().replace(/\.\d+Z$/, '') + '+00:00';

  const body = {
    cameraIndexCode: String(cam),
    startTime: fmt(startTime),
    endTime: fmt(endTime),
    pageNo: Math.max(1, pageNo),
    pageSize: Math.min(Math.max(1, pageSize), 500),
  };

  const r = await hcpRequest({ config, path: '/artemis/api/pms/v1/crossRecords/page', body });
  if (!r.ok) {
    return { ok: false, blocked: 'api-error', message: `Vehicle events request failed: HTTP ${r.status || '?'}${r.error ? ' — ' + r.error : ''}`, records: [] };
  }
  const parsed = r.parsed || {};
  if (parsed.code !== '0') {
    return { ok: false, blocked: 'api-error', message: `Vehicle events rejected: code=${parsed.code} msg=${parsed.msg || ''}`, records: [] };
  }

  const data = parsed.data || {};
  const list = data.list || [];
  return {
    ok: true,
    records: list,
    hasMore: list.length === body.pageSize,
    total: data.total || null,
    pageNo: body.pageNo,
    pageSize: body.pageSize,
  };
}

/* POST /artemis/api/resource/v1/person/personList — persons */
async function persons({ config, pageNo = 1, pageSize = 500 }) {
  const body = { pageNo: Math.max(1, pageNo), pageSize: Math.min(Math.max(1, pageSize), 500) };
  const r = await hcpRequest({ config, path: '/artemis/api/resource/v1/person/personList', body });
  if (!r.ok) {
    return { ok: false, blocked: 'api-error', message: `Person list request failed: HTTP ${r.status || '?'}${r.error ? ' — ' + r.error : ''}`, records: [] };
  }
  const parsed = r.parsed || {};
  if (parsed.code !== '0') {
    return { ok: false, blocked: 'api-error', message: `Person list rejected: code=${parsed.code} msg=${parsed.msg || ''}`, records: [] };
  }
  const data = parsed.data || {};
  const list = data.list || [];
  return { ok: true, records: list, hasMore: list.length === body.pageSize, total: data.total || null, pageNo: body.pageNo, pageSize: body.pageSize };
}

/* POST /artemis/api/visitor/v1/appointment/appointmentlist — visitors */
async function visitors({ config, pageNo = 1, pageSize = 500 }) {
  const body = { pageNo: Math.max(1, pageNo), pageSize: Math.min(Math.max(1, pageSize), 500) };
  const r = await hcpRequest({ config, path: '/artemis/api/visitor/v1/appointment/appointmentlist', body });
  if (!r.ok) {
    return { ok: false, blocked: 'api-error', message: `Visitor list request failed: HTTP ${r.status || '?'}${r.error ? ' — ' + r.error : ''}`, records: [] };
  }
  const parsed = r.parsed || {};
  if (parsed.code !== '0') {
    return { ok: false, blocked: 'api-error', message: `Visitor list rejected: code=${parsed.code} msg=${parsed.msg || ''}`, records: [] };
  }
  const data = parsed.data || {};
  const list = data.list || [];
  return { ok: true, records: list, hasMore: list.length === body.pageSize, total: data.total || null, pageNo: body.pageNo, pageSize: body.pageSize };
}

module.exports = {
  hcpRequest,
  version,
  vehicleEvents,
  persons,
  visitors,
};
