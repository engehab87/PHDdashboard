'use strict';
/* Generic HCP OpenAPI adapter — DOCS-PENDING skeleton.
   Implements the pipeline honestly: authenticate() and fetchCategory() refuse
   to guess endpoints and return { blocked: 'pending-docs', ... } until the
   official Hikvision guide for this compound's version is attached.
   What IS real today: normalize() mapping for HCP-shaped payloads (used by
   tests with fixtures), pagination helper, retry helper. */
const { HcpAdapterBase } = require('./base');

const SCHEMA_VERSION = 'hcp-normalized/1.0.0';

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

async function withRetry(fn, { tries = 3, baseMs = 500 } = {}) {
  let last;
  for (let i = 0; i < tries; i++) {
    try { return await fn(i); }
    catch (e) {
      last = e;
      const status = e && e.status;
      if (status === 429 || (status >= 500 && status < 600)) { await sleep(baseMs * Math.pow(2, i)); continue; }
      throw e;
    }
  }
  throw last;
}

function paginateParams(pageNo, pageSize) {
  return { pageNo: Math.max(1, pageNo || 1), pageSize: Math.min(1000, pageSize || 100) };
}

class GenericAdapter extends HcpAdapterBase {
  get id() { return 'hcp-openapi-v1-generic'; }
  get mappingVersion() { return SCHEMA_VERSION; }

  async authenticate() {
    // No documented auth flow verified — refuse to fabricate signatures.
    return { ok: false, blocked: 'pending-docs',
      message: 'Authentication flow not verified: attach the official Hikvision OpenAPI guide for this HCP version (docs/hcp/) before enabling live auth.' };
  }
  async checkPermissions() {
    return { ok: false, blocked: 'pending-docs', message: 'Permission check requires documented endpoints.' };
  }
  async fetchCategory() {
    return { ok: false, blocked: 'pending-docs', records: [], message: 'Live fetch blocked: no verified endpoints for this version yet.' };
  }

  /* normalize(kind, raw, ctx) -> normalized record. Pure function, unit-tested
     with documentation-derived fixtures. Never fabricates missing values. */
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
      source_id: raw && (raw.id || raw.personId || raw.eventId || raw.plateNo || raw.code || null),
      event_time: raw && (raw.eventTime || raw.enterTime || raw.createTime || null),
      retrieved_at: new Date().toISOString(),
      provenance: 'live-hcp',
    };
    if (kind === 'persons') {
      return { ...base, data: {
        name: raw.name || null, userType: raw.userType || raw.personType || null,
        unitRef: raw.unitRef || raw.roomNo || null, compoundRef: raw.compoundRef || null,
      }};
    }
    if (kind === 'vehicles' || kind === 'access-events') {
      return { ...base, data: {
        plate: raw.plateNo || raw.plate || null, direction: raw.direction || null,
        gate: raw.gate || raw.doorName || null, result: raw.result || null,
        method: raw.method || raw.openType || null, ownerRef: raw.owner || raw.personName || null,
      }};
    }
    if (kind === 'visitors') {
      return { ...base, data: {
        visitor: raw.visitorName || raw.name || null, hostRef: raw.host || raw.hostName || null,
        status: raw.status || null, validFrom: raw.validFrom || null, validUntil: raw.validUntil || null,
      }};
    }
    if (kind === 'face-events') {
      // Biometric images/templates are NEVER retrieved or stored.
      return { ...base, data: {
        personRef: raw.personId || raw.personName || null, device: raw.device || raw.doorName || null,
        result: raw.result || null,
      }};
    }
    return { ...base, data: { ...raw } };
  }
}

module.exports = { GenericAdapter, withRetry, paginateParams, SCHEMA_VERSION };
