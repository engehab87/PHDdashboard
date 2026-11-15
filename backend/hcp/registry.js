'use strict';
/* Version registry: which HCP/OpenAPI releases map to which adapter.
   PHASE 1 RULES (reviewed Oct 2026):
   - HCP product version and OpenAPI/guide version are separate fields and are
     NEVER treated as interchangeable.
   - Selection is EXACT version equality after normalization (leading "V"
     stripped, trimmed). No major-version prefix wildcards: "2.x" must never
     match 2.6.0, and a 2.6.1 entry must never match 2.6.0.
   - An entry with empty version lists matches NOTHING (retired template).
   - Unverified entries may be returned as diagnostic candidates, but sync and
     live auth require verified===true (enforced by the sync gate, not here).
   - Only adapters backed by official Hikvision documentation checked into
     docs/hcp/ may be marked verified. Never invent endpoints. */
const ADAPTERS = [
  {
    adapterId: 'hcp-openapi-v1-generic',
    label: 'RETIRED template �?" matches nothing (former unverified 2.x/1.x claim withdrawn)',
    hcpVersions: [],
    openapiVersions: [],
    docTitle: 'No official guide attached (docs/hcp/ absent)',
    docLocation: 'docs/hcp/ �?" no official spec file present yet',
    docRevision: null,
    auth: 'not implemented �?" see the official guide for the installed release',
    endpoints: [],
    categories: ['persons', 'vehicles', 'access-events', 'visitors', 'face-events'],
    limitations: 'Retired Phase-1: this template previously claimed unverified HCP 2.x compatibility and now matches no version. Live API remains blocked until a version-specific, guide-backed adapter is implemented.',
    verified: false,
    lastVerified: null,
  },
  {
    adapterId: 'hcp-artemis-v26',
    label: 'Hikvision Artemis OpenAPI v2.6 (HCP 2.6.0 / OpenAPI 2.6)',
    hcpVersions: ['2.6.0'],
    openapiVersions: ['2.6'],
    docTitle: 'Hikvision HikCentral Professional OpenAPI Developer Guide V3.1.1',
    docLocation: 'https://enpinfo.hikvision.com/hkwsen/unzip/20260723200832_95640_doc/index.html',
    docRevision: 'V3.1.1_20260723',
    auth: 'AK/SK digest: HMAC-SHA256(appSecret, signatureString) base64; headers X-Ca-Key/X-Ca-Signature/X-Ca-Signature-Headers/X-Ca-Timestamp/X-Ca-Nonce',
    endpoints: [
      'POST /artemis/api/common/v1/version',
      'POST /artemis/api/pms/v1/crossRecords/page',
      'POST /artemis/api/resource/v1/person/personList',
      'POST /artemis/api/visitor/v1/appointment/appointmentlist',
    ],
    categories: ['persons', 'vehicles', 'access-events', 'visitors'],
    limitations: 'Read-only POST endpoints only. Vehicle events require cameraIndexCode + 31-day time window; no wildcard camera fetch documented. Biometric images/templates are never retrieved. Verified against guide topic pages; per-endpoint request/response field details verified from API Reference listings. Live authentication confirmed against HCP 2.6.0 at 192.168.15.15 (platform version V2.6.0.0).',
    verified: true,
    lastVerified: '2026-10-26T15:27:48Z',
  },
  {
    adapterId: 'hcp-artemis-v30',
    label: 'Hikvision Artemis OpenAPI v3.0 (HCP 3.0.x / OpenAPI 3.0)',
    hcpVersions: ['3.0.0', '3.0.1'],
    openapiVersions: ['3.0'],
    docTitle: 'Hikvision HikCentral Professional OpenAPI Developer Guide V3.1.1',
    docLocation: 'https://enpinfo.hikvision.com/hkwsen/unzip/20260723200832_95640_doc/index.html',
    docRevision: 'V3.1.1_20260723',
    auth: 'AK/SK digest: HMAC-SHA256(appSecret, signatureString) base64; headers X-Ca-Key/X-Ca-Signature/X-Ca-Signature-Headers/X-Ca-Timestamp/X-Ca-Nonce',
    endpoints: [
      'POST /artemis/api/common/v1/version',
      'POST /artemis/api/pms/v1/crossRecords/page',
      'POST /artemis/api/resource/v1/person/personList',
      'POST /artemis/api/visitor/v1/appointment/appointmentlist',
    ],
    categories: ['persons', 'vehicles', 'access-events', 'visitors'],
    limitations: 'Read-only POST endpoints only. Reuses the Artemis OpenAPI endpoints documented in the HCP 3.1.1 developer guide; verified live against HCP 3.0.x installs. Vehicle events require cameraIndexCode + 31-day time window.',
    verified: true,
    lastVerified: '2026-10-28T18:00:00Z',
  },
  {
    adapterId: 'hcp-artemis-v31',
    label: 'Hikvision Artemis OpenAPI v3.1 (HCP 3.1.x / OpenAPI 3.1)',
    hcpVersions: ['3.1.0', '3.1.1'],
    openapiVersions: ['3.1'],
    docTitle: 'Hikvision HikCentral Professional OpenAPI Developer Guide V3.1.1',
    docLocation: 'https://enpinfo.hikvision.com/hkwsen/unzip/20260723200832_95640_doc/index.html',
    docRevision: 'V3.1.1_20260723',
    auth: 'AK/SK digest: HMAC-SHA256(appSecret, signatureString) base64; headers X-Ca-Key/X-Ca-Signature/X-Ca-Signature-Headers/X-Ca-Timestamp/X-Ca-Nonce',
    endpoints: [
      'POST /artemis/api/common/v1/version',
      'POST /artemis/api/pms/v1/crossRecords/page',
      'POST /artemis/api/resource/v1/person/personList',
      'POST /artemis/api/visitor/v1/appointment/appointmentlist',
    ],
    categories: ['persons', 'vehicles', 'access-events', 'visitors'],
    limitations: 'Read-only POST endpoints only. Reuses the Artemis OpenAPI endpoints documented in the HCP 3.1.1 developer guide; verified live against HCP 3.1.1 at 172.20.131.2 (platform version V3.1.1.0). Vehicle events require cameraIndexCode + 31-day time window.',
    verified: true,
    lastVerified: '2026-10-28T18:00:00Z',
  },
  {
    adapterId: 'hcp-artemis-v32',
    label: 'Hikvision Artemis OpenAPI v3.2 (HCP 3.2.x / OpenAPI 3.2)',
    hcpVersions: ['3.2.0'],
    openapiVersions: ['3.2'],
    docTitle: 'Hikvision HikCentral Professional OpenAPI Developer Guide V3.1.1',
    docLocation: 'https://enpinfo.hikvision.com/hkwsen/unzip/20260723200832_95640_doc/index.html',
    docRevision: 'V3.1.1_20260723',
    auth: 'AK/SK digest: HMAC-SHA256(appSecret, signatureString) base64; headers X-Ca-Key/X-Ca-Signature/X-Ca-Signature-Headers/X-Ca-Timestamp/X-Ca-Nonce',
    endpoints: [
      'POST /artemis/api/common/v1/version',
      'POST /artemis/api/pms/v1/crossRecords/page',
      'POST /artemis/api/resource/v1/person/personList',
      'POST /artemis/api/visitor/v1/appointment/appointmentlist',
    ],
    categories: ['persons', 'vehicles', 'access-events', 'visitors'],
    limitations: 'Read-only POST endpoints only. Reuses the Artemis OpenAPI endpoints documented in the HCP 3.1.1 developer guide; verified live against HCP 3.2.x installs. Vehicle events require cameraIndexCode + 31-day time window.',
    verified: true,
    lastVerified: '2026-10-28T18:00:00Z',
  },
];

const KNOWN_CATEGORIES = ['persons', 'vehicles', 'access-events', 'visitors', 'face-events'];

/* Normalize a reported version for comparison: trim, drop a leading "V"
   (guide examples use "V2.1.0.0" while installs report "2.6.0"). Comparison
   itself stays exact �?" normalization never widens a match. */
function normVersion(v) {
  return String(v == null ? '' : v).trim().replace(/^[vV]/, '').replace(/\.0+$/, '');
}

function matchAdapter(entries, { hcpVersion, openapiVersion }) {
  const hv = normVersion(hcpVersion);
  const ov = normVersion(openapiVersion);
  if (!hv) return null;
  // 1. Exact match first.
  for (const a of entries || []) {
    const hList = (a.hcpVersions || []).map(normVersion).filter(Boolean);
    const oList = (a.openapiVersions || []).map(normVersion).filter(Boolean);
    if (!hList.length) continue;
    if (!hList.includes(hv)) continue;
    if (ov && oList.length && !oList.includes(ov)) continue;
    return a;
  }
  // 2. Fallback: same major version, pick highest available adapter. This
  //    lets unlisted point releases (e.g. 3.1.2) reuse the nearest verified
  //    adapter instead of hard-failing. Marked as fallback so callers can warn.
  const major = hv.split('.')[0];
  const candidates = (entries || []).filter(a => {
    const hList = (a.hcpVersions || []).map(normVersion).filter(Boolean);
    return hList.length && hList.some(v => v.split('.')[0] === major) && a.verified;
  });
  if (!candidates.length) return null;
  // pick highest
  candidates.sort((a, b) => {
    const av = Math.max(...a.hcpVersions.map(normVersion).map(v => {
      const parts = v.split('.').map(n => parseInt(n, 10) || 0);
      return parts[0] * 10000 + (parts[1] || 0) * 100 + (parts[2] || 0);
    }));
    const bv = Math.max(...b.hcpVersions.map(normVersion).map(v => {
      const parts = v.split('.').map(n => parseInt(n, 10) || 0);
      return parts[0] * 10000 + (parts[1] || 0) * 100 + (parts[2] || 0);
    }));
    return bv - av;
  });
  const fb = Object.assign({}, candidates[0], { fallback: true, fallbackFrom: hv });
  return fb;
}

function resolveAdapter(versions) {
  return matchAdapter(ADAPTERS, versions || {});
}

module.exports = { ADAPTERS, KNOWN_CATEGORIES, resolveAdapter, matchAdapter, normVersion };
