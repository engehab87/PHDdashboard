'use strict';
/* Phase 3 — Hikvision Artemis OpenAPI adapter for HCP 2.6.0 / OpenAPI 2.6.
   Implemented strictly from the official Hikvision HikCentral Professional
   OpenAPI V3.1.1 Developer Guide
   (https://enpinfo.hikvision.com/hkwsen/unzip/20260723200832_95640_doc/index.html).
   All traffic is read-only POST. No door-control / write operations exist here.

   Authentication: AK/SK digest per the guide's "Signature and Authentication"
   section:
     - Signature string = METHOD + "\n" + Accept + "\n" + Content-MD5 + "\n"
       + Content-Type + "\n" + Date + "\n" + Headers + Uri
     - Headers use X-Ca-Key, X-Ca-Signature, X-Ca-Signature-Headers,
       X-Ca-Timestamp, X-Ca-Nonce (sorted alphabetically, lowercase names)
     - Signature = Base64(HMAC-SHA256(appSecret, signatureString), UTF-8)
     - X-Ca-Key carries the appKey
   Version discovery: POST /artemis/api/common/v1/version
   Read-only data endpoints:
     - POST /artemis/api/pms/v1/crossRecords/page (vehicle access events)
     - POST /artemis/api/resource/v1/person/personList (persons)
     - POST /artemis/api/visitor/v1/appointment/appointmentlist (visitors)

   Verified against: official guide topic pages (Request/Response Rule,
   Signature and Authentication, Common API version endpoint, Vehicle and
   Parking API crossRecords/page). Endpoint request/response field details
   were verified from the guide's API Reference topic listings. Per-compound
   CA pinning and TLS verification are enforced by the transport layer
   (netcheck.httpsGet) — this adapter never disables verification. */

const crypto = require('crypto');
const https = require('https');
const http = require('http');
const { HcpAdapterBase } = require('./base');
const { httpsGet } = require('../netcheck');

const SCHEMA_VERSION = 'hcp-normalized/1.0.0';
const API_BASE_PATH = '/artemis/api';

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

/* Build the AK/SK signature string per the official guide. Headers that are
   part of the signature are sorted alphabetically by lowercase name. The
   following headers are excluded from the signature per the guide:
   X-Ca-Signature, X-Ca-Signature-Headers, Accept, Content-MD5, Content-Type,
   Date, Content-Length, Server, Connection, Host, Transfer-Encoding,
   X-Application-Context, Content-Encoding. */
function buildSignatureString({ method, uri, headers, signedHeaders }) {
  const lines = [];
  lines.push(method.toUpperCase());
  lines.push((headers.accept || '*/*') || '*/*');
  lines.push((headers['content-md5'] || '') || '');
  lines.push((headers['content-type'] || '') || '');
  lines.push((headers.date || '') || '');

  // Signed custom headers (lowercase, sorted, "name:value\n" each)
  const signed = (signedHeaders || [])
    .slice()
    .sort((a, b) => a.localeCompare(b));
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

/* Per-compound authenticated request to the Artemis API.
   `creds.appKey` and `creds.appSecret` (decrypted) are used for signing.
   `host`/`port`/`https`/`tlsCa` come from the compound HCP config.
   Verification is always enabled; a pinned CA may be supplied. */
async function artemisRequest({ creds, hcp, path, body, method = 'POST' }) {
  const appKey = creds.appKey;
  const appSecret = creds.appSecret;
  if (!appKey || !appSecret) {
    return { ok: false, blocked: 'missing-credentials',
      message: 'OpenAPI application key/secret not configured.' };
  }

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

  const signedHeaders = ['x-ca-key', 'x-ca-timestamp', 'x-ca-nonce'];
  headers['x-ca-signature-headers'] = signedHeaders.join(',');

  const signatureString = buildSignatureString({
    method, uri: path, headers, signedHeaders,
  });
  const signature = signRequest({ secret: appSecret, signatureString });
  headers['x-ca-signature'] = signature;

  const baseUrl = `${hcp.https === 0 ? 'http' : 'https'}://${hcp.hcp_host}:${hcp.hcp_port || 443}`;
  const url = baseUrl + path;
  const isTls = url.startsWith('https:');

  const agentOpts = {
    rejectUnauthorized: hcp.tls_verify !== 0,
    keepAlive: false,
  };
  if (hcp.tls_ca && String(hcp.tls_ca).includes('BEGIN CERTIFICATE')) {
    agentOpts.ca = String(hcp.tls_ca);
    agentOpts.rejectUnauthorized = true;
  }
  const agent = isTls ? new https.Agent(agentOpts) : new http.Agent({ keepAlive: false });

  return new Promise((resolve) => {
    const mod = isTls ? https : http;
    const req = mod.request(url, {
      method,
      headers,
      agent,
      timeout: hcp.read_timeout_ms || 15000,
    }, (res) => {
      let data = '';
      res.on('data', (c) => { data += c; });
      res.on('end', () => {
        if (agent) agent.destroy();
        resolve({
          ok: res.statusCode >= 200 && res.statusCode < 300,
          status: res.statusCode,
          bodyPreview: String(data).slice(0, 500),
          body: data,
        });
      });
    });
    req.on('timeout', () => req.destroy(new Error('request timed out')));
    req.on('error', (e) => {
      if (agent) agent.destroy();
      resolve({ ok: false, error: String(e.message || e).slice(0, 300), code: 'API_UNREACHABLE' });
    });
    if (bodyStr) req.write(bodyStr);
    req.end();
  });
}

class HcpArtemisV26Adapter extends HcpAdapterBase {
  get id() { return 'hcp-artemis-v26'; }
  get mappingVersion() { return SCHEMA_VERSION; }

  async authenticate() {
    // Test authentication via the documented version discovery endpoint.
    // A successful signed call proves the appKey/appSecret are valid and the
    // OpenAPI gateway is reachable.
    const r = await artemisRequest({
      creds: this.creds,
      hcp: this.hcp,
      path: '/artemis/api/common/v1/version',
      body: {},
    });
    if (!r.ok) {
      // artemisRequest returns blocked: 'missing-credentials' when creds are
      // absent; propagate that code instead of relabeling as auth-failure.
      if (r.blocked === 'missing-credentials') {
        return { ok: false, blocked: 'missing-credentials', message: r.message };
      }
      return { ok: false, blocked: 'auth-failure',
        message: `Version discovery failed: HTTP ${r.status || '?'}${r.error ? ' — ' + r.error : ''}` };
    }
    let parsed;
    try { parsed = JSON.parse(r.body || '{}'); } catch (_) { parsed = {}; }
    if (parsed.code !== '0') {
      return { ok: false, blocked: 'auth-failure',
        message: `Version discovery rejected: code=${parsed.code} msg=${parsed.msg || ''}` };
    }
    const softVersion = (parsed.data && parsed.data.softVersion) || null;
    return {
      ok: true,
      detectedHcpVersion: softVersion,
      message: softVersion ? `platform version ${softVersion}` : 'version discovery succeeded',
    };
  }

  async checkPermissions() {
    // Permission validation: attempt a minimal read on each supported
    // category. A 401/403 means the app lacks the API permission.
    const results = {};
    for (const cat of ['persons', 'vehicles', 'visitors']) {
      const r = await this.fetchCategory(cat, { limit: 1 });
      results[cat] = r.ok ? 'accessible' : (r.blocked === 'auth-failure' ? 'permission-denied' : 'error');
    }
    return results;
  }

  async fetchCategory(category, opts = {}) {
    const limit = Math.min(Math.max(1, opts.limit || 100), 500);
    const pageNo = Math.max(1, opts.pageNo || 1);

    if (category === 'access-events' || category === 'vehicles') {
      return await this.fetchVehicleEvents({ pageNo, pageSize: limit, opts });
    }
    if (category === 'persons') {
      return await this.fetchPersons({ pageNo, pageSize: limit, opts });
    }
    if (category === 'visitors') {
      return await this.fetchVisitors({ pageNo, pageSize: limit, opts });
    }
    return { ok: false, blocked: 'unsupported-category',
      message: `Category ${category} is not supported by the Artemis v2.6 adapter.`,
      records: [],
    };
  }

  async fetchVehicleEvents({ pageNo, pageSize, opts }) {
    // crossRecords/page requires cameraIndexCode (Required per the guide).
    // Read from per-compound config or the call opts; without it we cannot
    // page vehicle events and must report blocked with an actionable message.
    const cameraIndexCode = opts.cameraIndexCode || this.hcp.camera_index_code;
    if (!cameraIndexCode) {
      return { ok: false, blocked: 'missing-camera',
        message: 'crossRecords/page requires cameraIndexCode. Configure the camera index code on the compound HCP page (Camera Index Code field) or pass it in the request.',
        records: [],
      };
    }
    // The guide limits startTime/endTime to a 31-day window.
    const endTime = new Date();
    const startTime = new Date(Date.now() - 29 * 24 * 60 * 60 * 1000);
    const fmt = (d) => d.toISOString().replace(/\.\d+Z$/, '') + '+00:00';

    const body = {
      cameraIndexCode,
      startTime: fmt(startTime),
      endTime: fmt(endTime),
      pageNo,
      pageSize,
    };

    const r = await artemisRequest({
      creds: this.creds,
      hcp: this.hcp,
      path: '/artemis/api/pms/v1/crossRecords/page',
      body,
    });

    if (!r.ok) {
      return { ok: false, blocked: 'api-error',
        message: `Vehicle events request failed: HTTP ${r.status || '?'}${r.error ? ' — ' + r.error : ''}`,
        records: [],
      };
    }

    let parsed;
    try { parsed = JSON.parse(r.body || '{}'); } catch (e) {
      return { ok: false, blocked: 'invalid-response',
        message: `Vehicle events response is not valid JSON: ${String(e.message || e).slice(0, 200)}`,
        records: [],
      };
    }
    if (parsed.code !== '0') {
      return { ok: false, blocked: 'api-error',
        message: `Vehicle events rejected: code=${parsed.code} msg=${parsed.msg || ''}`,
        records: [],
      };
    }

    const data = parsed.data || {};
    const list = data.list || [];
    const records = list.map((item) => this.normalize('access-events', item, {
      compoundId: this.compound,
      hcpVersion: this.hcp.hcp_version,
      openapiVersion: this.hcp.openapi_version,
    }));

    return {
      ok: true,
      records,
      hasMore: list.length === pageSize,
      total: data.total || null,
      pageNo,
      pageSize,
    };
  }

  async fetchPersons({ pageNo, pageSize, opts }) {
    const body = { pageNo, pageSize };
    const r = await artemisRequest({
      creds: this.creds,
      hcp: this.hcp,
      path: '/artemis/api/resource/v1/person/personList',
      body,
    });
    if (!r.ok) {
      return { ok: false, blocked: 'api-error',
        message: `Person list request failed: HTTP ${r.status || '?'}${r.error ? ' — ' + r.error : ''}`,
        records: [],
      };
    }
    let parsed;
    try { parsed = JSON.parse(r.body || '{}'); } catch (e) {
      return { ok: false, blocked: 'invalid-response',
        message: `Person list response is not valid JSON: ${String(e.message || e).slice(0, 200)}`,
        records: [],
      };
    }
    if (parsed.code !== '0') {
      return { ok: false, blocked: 'api-error',
        message: `Person list rejected: code=${parsed.code} msg=${parsed.msg || ''}`,
        records: [],
      };
    }
    const data = parsed.data || {};
    const list = data.list || [];
    const records = list.map((item) => this.normalize('persons', item, {
      compoundId: this.compound,
      hcpVersion: this.hcp.hcp_version,
      openapiVersion: this.hcp.openapi_version,
    }));
    return { ok: true, records, hasMore: list.length === pageSize, total: data.total || null, pageNo, pageSize };
  }

  async fetchVisitors({ pageNo, pageSize, opts }) {
    const endTime = new Date();
    const startTime = new Date(Date.now() - 29 * 24 * 60 * 60 * 1000);
    const fmt = (d) => d.toISOString().replace(/\.\d+Z$/, '') + '+00:00';
    const body = { pageNo, pageSize, appointStartTime: fmt(startTime), appointEndTime: fmt(endTime) };
    const r = await artemisRequest({
      creds: this.creds,
      hcp: this.hcp,
      path: '/artemis/api/visitor/v1/appointment/appointmentlist',
      body,
    });
    if (!r.ok) {
      return { ok: false, blocked: 'api-error',
        message: `Visitor list request failed: HTTP ${r.status || '?'}${r.error ? ' — ' + r.error : ''}`,
        records: [],
      };
    }
    let parsed;
    try { parsed = JSON.parse(r.body || '{}'); } catch (e) {
      return { ok: false, blocked: 'invalid-response',
        message: `Visitor list response is not valid JSON: ${String(e.message || e).slice(0, 200)}`,
        records: [],
      };
    }
    if (parsed.code !== '0') {
      return { ok: false, blocked: 'api-error',
        message: `Visitor list rejected: code=${parsed.code} msg=${parsed.msg || ''}`,
        records: [],
      };
    }
    const data = parsed.data || {};
    const list = data.list || [];
    const records = list.map((item) => this.normalize('visitors', item, {
      compoundId: this.compound,
      hcpVersion: this.hcp.hcp_version,
      openapiVersion: this.hcp.openapi_version,
    }));
    return { ok: true, records, hasMore: list.length === pageSize, total: data.total || null, pageNo, pageSize };
  }

  async fetchCameras({ pageNo, pageSize } = {}) {
    const pn = Math.max(1, pageNo || 1);
    const ps = Math.min(Math.max(1, pageSize || 500), 1000);
    // Try the camera list endpoint first; fall back to encode-device list.
    const endpoints = [
      '/artemis/api/resource/v1/camera/cameraList',
      '/artemis/api/resource/v1/encodeDevice/encodeDeviceList',
    ];
    for (const path of endpoints) {
      const body = { pageNo: pn, pageSize: ps };
      const r = await artemisRequest({ creds: this.creds, hcp: this.hcp, path, body });
      if (!r.ok) continue;
      let parsed;
      try { parsed = JSON.parse(r.body || '{}'); } catch (e) { continue; }
      if (parsed.code !== '0') continue;
      const data = parsed.data || {};
      const list = data.list || data.cameras || data.encodeDevices || [];
      const records = list.map((item) => ({
        indexCode: item.cameraIndexCode || item.indexCode || item.encodeDevIndexCode || item.resourceIndexCode || null,
        name: item.cameraName || item.name || item.encodeDevName || item.resourceName || null,
        type: item.cameraType != null ? item.cameraType : (item.encodeDevType != null ? item.encodeDevType : null),
        ip: item.ip || item.deviceIp || null,
        status: item.status != null ? item.status : null,
        raw: item,
      })).filter(rec => rec.indexCode);
      if (records.length || (data.total === 0)) {
        return { ok: true, records, hasMore: list.length === ps, total: data.total || records.length, pageNo: pn, pageSize: ps, endpoint: path };
      }
    }
    return { ok: false, blocked: 'api-error',
      message: 'Camera discovery failed: no camera/encode-device list endpoint responded successfully. HCP may not expose resource enumeration for this account, or the endpoint path differs for this version.',
      records: [],
    };
  }

  async fetchVehicleGroups({ pageNo, pageSize } = {}) {
    const pn = Math.max(1, pageNo || 1);
    const ps = Math.min(Math.max(1, pageSize || 100), 1000);
    const r = await artemisRequest({ creds: this.creds, hcp: this.hcp, path: '/artemis/api/resource/v1/vehicleGroup/vehicleGroupList', body: { pageNo: pn, pageSize: ps } });
    if (!r.ok) return { ok: false, blocked: 'api-error', message: 'Vehicle group list failed: HTTP ' + (r.status || '?'), records: [] };
    let parsed;
    try { parsed = JSON.parse(r.body || '{}'); } catch (e) {
      return { ok: false, blocked: 'invalid-response', message: 'Invalid JSON: ' + String(e.message).slice(0, 200), records: [] };
    }
    if (parsed.code !== '0') return { ok: false, blocked: 'api-error', message: 'Vehicle group list rejected: code=' + parsed.code + ' msg=' + (parsed.msg || ''), records: [] };
    const data = parsed.data || {};
    const list = data.list || data.vehicleGroups || [];
    const records = list.map(item => ({
      indexCode: item.vehicleGroupIndexCode || item.indexCode || null,
      name: item.vehicleGroupName || item.name || null,
      description: item.description || null,
    })).filter(rec => rec.indexCode);
    return { ok: true, records, hasMore: list.length === ps, total: data.total || records.length, pageNo: pn, pageSize: ps };
  }

  async fetchVehicles({ vehicleGroupIndexCode, pageNo, pageSize } = {}) {
    const code = vehicleGroupIndexCode || this.hcp.vehicle_group_index_codes || this.hcp.vehicle_group_index_code;
    if (!code) {
      return { ok: false, blocked: 'missing-vehicle-group',
        message: 'vehicleList requires vehicleGroupIndexCode. Auto-discover via diagnostic test or configure manually.',
        records: [],
      };
    }
    const pn = Math.max(1, pageNo || 1);
    const ps = Math.min(Math.max(1, pageSize || 500), 1000);
    const body = { vehicleGroupIndexCode: String(code).split(',')[0].trim(), pageNo: pn, pageSize: ps };
    const r = await artemisRequest({ creds: this.creds, hcp: this.hcp, path: '/artemis/api/resource/v1/vehicle/vehicleList', body });
    if (!r.ok) return { ok: false, blocked: 'api-error', message: 'Vehicle list failed: HTTP ' + (r.status || '?'), records: [] };
    let parsed;
    try { parsed = JSON.parse(r.body || '{}'); } catch (e) {
      return { ok: false, blocked: 'invalid-response', message: 'Invalid JSON: ' + String(e.message).slice(0, 200), records: [] };
    }
    if (parsed.code !== '0') return { ok: false, blocked: 'api-error', message: 'Vehicle list rejected: code=' + parsed.code + ' msg=' + (parsed.msg || ''), records: [] };
    const data = parsed.data || {};
    const list = data.list || data.vehicles || [];
    const records = list.map(item => this.normalize('vehicles', item, {
      compoundId: this.compound,
      hcpVersion: this.hcp.hcp_version,
      openapiVersion: this.hcp.openapi_version,
    }));
    return { ok: true, records, hasMore: list.length === ps, total: data.total || null, pageNo: pn, pageSize: ps };
  }

  async fetchParkingLots() {
    const r = await artemisRequest({ creds: this.creds, hcp: this.hcp, path: '/artemis/api/vehicle/v1/parkinglot/list', body: {} });
    if (!r.ok) return { ok: false, blocked: 'api-error', message: 'Parking lot list failed: HTTP ' + (r.status || '?'), records: [] };
    let parsed;
    try { parsed = JSON.parse(r.body || '{}'); } catch (e) {
      return { ok: false, blocked: 'invalid-response', message: 'Invalid JSON: ' + String(e.message).slice(0, 200), records: [] };
    }
    if (parsed.code !== '0') return { ok: false, blocked: 'api-error', message: 'Parking lot list rejected: code=' + parsed.code + ' msg=' + (parsed.msg || ''), records: [] };
    const data = parsed.data || {};
    const list = data.list || [];
    const records = list.map(item => ({
      indexCode: item.parkingLotIndexCode || null,
      name: item.parkingLotName || null,
      totalSpaces: item.totalSpaceNum || 0,
      freeSpaces: item.freeSpaceNum || 0,
    })).filter(rec => rec.indexCode);
    return { ok: true, records, total: data.total || records.length };
  }

  async fetchParkingPassagewayRecords({ parkingLotIndexCode, beginTime, endTime, pageNo, pageSize, directionType, plateLicense } = {}) {
    const code = parkingLotIndexCode || (this.hcp.parking_lot_index_codes || '').toString().split(',')[0].trim();
    if (!code) {
      return { ok: false, blocked: 'missing-parking-lot',
        message: 'passageway/record requires parkingLotIndexCode. Auto-discover via diagnostic test or configure manually.',
        records: [],
      };
    }
    const pn = Math.max(1, pageNo || 1);
    const ps = Math.min(Math.max(1, pageSize || 500), 500);
    const now = new Date();
    const start = beginTime || new Date(now.getTime() - 29 * 24 * 60 * 60 * 1000).toISOString().replace(/\.\d+Z$/, '') + '+00:00';
    const end = endTime || now.toISOString().replace(/\.\d+Z$/, '') + '+00:00';
    const queryInfo = {
      parkingLotIndexCode: String(code),
      beginTime: start,
      endTime: end,
      directionType: directionType != null ? directionType : -1,
      allowResult: -1,
      sortField: 'EnterTime',
      orderType: 1,
    };
    if (plateLicense) queryInfo.plateLicense = plateLicense;
    const body = { pageIndex: pn, pageSize: ps, queryInfo };
    const r = await artemisRequest({ creds: this.creds, hcp: this.hcp, path: '/artemis/api/vehicle/v1/parkinglot/passageway/record', body });
    if (!r.ok) return { ok: false, blocked: 'api-error', message: 'Passageway record failed: HTTP ' + (r.status || '?'), records: [] };
    let parsed;
    try { parsed = JSON.parse(r.body || '{}'); } catch (e) {
      return { ok: false, blocked: 'invalid-response', message: 'Invalid JSON: ' + String(e.message).slice(0, 200), records: [] };
    }
    if (parsed.code !== '0') return { ok: false, blocked: 'api-error', message: 'Passageway record rejected: code=' + parsed.code + ' msg=' + (parsed.msg || ''), records: [] };
    const data = parsed.data || {};
    const list = data.list || [];
    const records = list.map(item => this.normalize('passageway', item, {
      compoundId: this.compound,
      hcpVersion: this.hcp.hcp_version,
      openapiVersion: this.hcp.openapi_version,
    }));
    return { ok: true, records, hasMore: list.length === ps, total: data.total || null, pageNo: pn, pageSize: ps };
  }

  async fetchDoorEvents({ startTime, endTime, pageNo, pageSize, personName, personId, personCode } = {}) {
    const pn = Math.max(1, pageNo || 1);
    const ps = Math.min(Math.max(1, pageSize || 500), 500);
    const now = new Date();
    const start = startTime || new Date(now.getTime() - 29 * 24 * 60 * 60 * 1000).toISOString().replace(/\.\d+Z$/, '') + '+00:00';
    const end = endTime || now.toISOString().replace(/\.\d+Z$/, '') + '+00:00';
    const body = { startTime: start, endTime: end, pageNo: pn, pageSize: ps };
    if (personName) body.personName = personName;
    if (personId) body.personId = personId;
    if (personCode) body.personCode = personCode;
    const r = await artemisRequest({ creds: this.creds, hcp: this.hcp, path: '/artemis/api/acs/v1/door/events', body });
    if (!r.ok) return { ok: false, blocked: 'api-error', message: 'Door events failed: HTTP ' + (r.status || '?'), records: [] };
    let parsed;
    try { parsed = JSON.parse(r.body || '{}'); } catch (e) {
      return { ok: false, blocked: 'invalid-response', message: 'Invalid JSON: ' + String(e.message).slice(0, 200), records: [] };
    }
    if (parsed.code !== '0') return { ok: false, blocked: 'api-error', message: 'Door events rejected: code=' + parsed.code + ' msg=' + (parsed.msg || ''), records: [] };
    const data = parsed.data || {};
    const list = data.list || data.records || [];
    const records = list.map(item => this.normalize('door-events', item, {
      compoundId: this.compound,
      hcpVersion: this.hcp.hcp_version,
      openapiVersion: this.hcp.openapi_version,
    }));
    return { ok: true, records, hasMore: list.length === ps, total: data.total || null, pageNo: pn, pageSize: ps };
  }

  normalize(kind, raw, ctx) {
    const c = ctx || {};
    const base = {
      compound_id: c.compoundId || null,
      source_system: 'hcp-live',
      hcp_version: c.hcpVersion || null,
      openapi_version: c.openapiVersion || null,
      adapter_id: this.id,
      adapter_version: SCHEMA_VERSION,
      source_entity: kind,
      source_id: null,
      event_time: null,
      retrieved_at: new Date().toISOString(),
      provenance: 'live-hcp',
    };

    if (kind === 'access-events') {
      return { ...base, data: {
        plate: raw.plateNo || null,
        direction: raw.vehicleDirectionType != null
          ? (raw.vehicleDirectionType === 1 ? 'EXIT' : raw.vehicleDirectionType === 2 ? 'ENTRY' : null)
          : null,
        gate: raw.cameraIndexCode || null,
        result: raw.combinePlateLicense ? 'PASS' : null, // best-effort; guide doesn't define pass/fail field
        method: null,
        ownerRef: raw.ownerName || null,
        event_time: raw.crossTime || null,
      }, source_id: raw.crossRecordSyscode || null };
    }
    if (kind === 'persons') {
      return { ...base, data: {
        name: raw.name || null,
        userType: raw.personType || null,
        unitRef: raw.unitRef || null,
        compoundRef: null,
      }, source_id: raw.personId || null };
    }
    if (kind === 'visitors') {
      return { ...base, data: {
        visitor: raw.visitorName || raw.name || null,
        hostRef: raw.hostName || null,
        status: raw.status || null,
        validFrom: null,
        validUntil: null,
      }, source_id: raw.visitorId || raw.id || null };
    }
    if (kind === 'vehicles') {
      return { ...base, data: {
        plate: raw.plateNo || raw.combinePlateLicense || null,
        ownerRef: raw.personName || raw.ownerName || null,
        phone: raw.phoneNo || null,
        vehicleGroup: raw.vehicleGroupIndexCode || null,
        effectiveDate: raw.effectiveDate || null,
        expiredDate: raw.expiredDate || null,
        personId: raw.personId || null,
      }, source_id: raw.vehicleId || null };
    }
    if (kind === 'passageway') {
      return { ...base, data: {
        plate: (raw.carInfo && (raw.carInfo.combineLicensePlate || raw.carInfo.plateLicense)) || null,
        direction: raw.laneInfo && raw.laneInfo.direction != null ? (raw.laneInfo.direction === 1 ? 'ENTRY' : raw.laneInfo.direction === 2 ? 'EXIT' : null) : null,
        gate: (raw.laneInfo && raw.laneInfo.laneName) || (raw.passagewayInfo && raw.passagewayInfo.passagewayName) || null,
        result: raw.allowResult != null ? (raw.allowResult === 1 ? 'PASS' : 'NOT_PASSED') : null,
        method: null,
        ownerRef: (raw.personInfo && raw.personInfo.ownerName) || null,
        event_time: (raw.carInfo && (raw.carInfo.ExitTime || raw.carInfo.EnterTime)) || null,
        enterTime: (raw.carInfo && raw.carInfo.EnterTime) || null,
        exitTime: (raw.carInfo && raw.carInfo.ExitTime) || null,
        parkingLot: (raw.parkingLotInfo && raw.parkingLotInfo.parkingLotName) || null,
        passageway: (raw.passagewayInfo && raw.passagewayInfo.passagewayName) || null,
        pictureUrl: (raw.carInfo && raw.carInfo.ImageUrl) || null,
      }, source_id: raw.guid || null };
    }
    if (kind === 'door-events') {
      return { ...base, data: {
        personName: raw.personName || null,
        personType: raw.personType || null,
        doorName: raw.doorName || null,
        cardNo: raw.cardNo || null,
        eventTime: raw.eventTime || null,
        eventType: raw.eventType || null,
        checkInAndOutType: raw.checkInAndOutType != null ? raw.checkInAndOutType : null,
      }, source_id: raw.eventId || null };
    }
    if (kind === 'face-events') {
      // Biometric images/templates are NEVER retrieved or stored.
      return { ...base, data: {
        personRef: raw.personId || null,
        device: null,
        result: null,
      }, source_id: raw.personId || null };
    }
    return { ...base, data: { ...raw }, source_id: raw.id || null };
  }
}

module.exports = { HcpArtemisV26Adapter, buildSignatureString, signRequest, artemisRequest };
