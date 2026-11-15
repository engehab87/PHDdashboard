'use strict';
/* Normalize raw HCP OpenAPI responses into the canonical schema used by the
   cloud database. Mirrors the normalization in the main dashboard
   (backend/hcp/adapters/artemis-v26.js) so both systems share the same
   field mapping.

   Biometric images/templates are NEVER extracted or stored.
*/

function normalizeBase({ compoundId, sourceEntity, sourceId, hcpVersion, openapiVersion, eventTime, data }) {
  return {
    compoundId,
    sourceSystem: 'hcp-live',
    hcpVersion: hcpVersion || null,
    openapiVersion: openapiVersion || null,
    adapterId: 'hcp-artemis-v26',
    adapterVersion: 'hcp-normalized/1.0.0',
    sourceEntity,
    sourceId: sourceId || null,
    eventTime: eventTime || null,
    retrievedAt: new Date().toISOString(),
    provenance: 'live-hcp',
    data: data || {},
  };
}

/* Normalize a vehicle access event from crossRecords/page.
   vehicleDirectionType: 1 = EXIT, 2 = ENTRY
*/
function normalizeAccessEvent(raw, ctx) {
  const directionMap = { 1: 'EXIT', 2: 'ENTRY' };
  const direction = raw.vehicleDirectionType != null
    ? (directionMap[raw.vehicleDirectionType] || null)
    : null;

  return normalizeBase({
    ...ctx,
    sourceEntity: 'access-events',
    sourceId: raw.crossRecordSyscode || null,
    eventTime: raw.crossTime || null,
    data: {
      plate: raw.plateNo || null,
      direction,
      gate: raw.cameraIndexCode || null,
      result: raw.combinePlateLicense ? 'PASS' : null,
      method: null,
      ownerRef: raw.ownerName || null,
    },
  });
}

/* Normalize a person from personList */
function normalizePerson(raw, ctx) {
  return normalizeBase({
    ...ctx,
    sourceEntity: 'persons',
    sourceId: raw.personId || null,
    data: {
      name: raw.name || null,
      userType: raw.personType || null,
      unitRef: raw.unitRef || null,
      compoundRef: null,
    },
  });
}

/* Normalize a visitor from appointmentlist */
function normalizeVisitor(raw, ctx) {
  return normalizeBase({
    ...ctx,
    sourceEntity: 'visitors',
    sourceId: raw.visitorId || raw.id || null,
    data: {
      visitor: raw.visitorName || raw.name || null,
      hostRef: raw.hostName || null,
      status: raw.status || null,
      validFrom: null,
      validUntil: null,
    },
  });
}

function normalize(kind, raw, ctx) {
  switch (kind) {
    case 'access-events':
    case 'vehicles':
      return normalizeAccessEvent(raw, ctx);
    case 'persons':
      return normalizePerson(raw, ctx);
    case 'visitors':
      return normalizeVisitor(raw, ctx);
    default:
      return normalizeBase({
        ...ctx,
        sourceEntity: kind,
        sourceId: raw.id || null,
        data: raw,
      });
  }
}

function normalizeBatch(kind, raws, ctx) {
  return raws.map((raw) => normalize(kind, raw, ctx));
}

module.exports = {
  normalize,
  normalizeBatch,
  normalizeAccessEvent,
  normalizePerson,
  normalizeVisitor,
  normalizeBase,
};
