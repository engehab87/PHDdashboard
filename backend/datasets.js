'use strict';
/* Dataset definitions: filename patterns + column signatures + column mapping.
   Detection uses columns/sheet first, filename second. Never hardcode timestamps. */

const DATASETS = {
  ALL_USERS: {
    label: 'All Users (CRM)', kind: 'crm',
    filePatterns: [/all.?users/i],
    excludePatterns: [/access|merged/i],
    requiredColumns: ['(Do Not Modify) User', 'Name', 'Mobile Number', 'User Status', 'Registered As'],
    optionalColumns: ['Email', 'National ID', 'Marital Status', 'Created On'],
    map: { id: '(Do Not Modify) User', name: 'Name', mobile: 'Mobile Number', email: 'Email', nationalId: 'National ID', marital: 'Marital Status', status: 'User Status', registeredAs: 'Registered As', createdOn: 'Created On' },
  },
  ACTIVE_UNITS: {
    label: 'Active Units (CRM)', kind: 'crm',
    filePatterns: [/active.?units/i],
    requiredColumns: ['(Do Not Modify) Unit', 'Name', 'Compound'],
    optionalColumns: ['Related Unit', 'Gate Access Suspension', 'Rent Suspension', 'Pending Maintenance Fees (Related Unit)', 'Created On'],
    map: { id: '(Do Not Modify) Unit', name: 'Name', compound: 'Compound', related: 'Related Unit', gateSusp: 'Gate Access Suspension', rentSusp: 'Rent Suspension', maint: 'Pending Maintenance Fees (Related Unit)', createdOn: 'Created On' },
  },
  UNIT_ACCESS: {
    label: 'All Units Access (CRM)', kind: 'crm',
    filePatterns: [/units.?access/i],
    requiredColumns: ['(Do Not Modify) Unit User', 'Compound (Unit) (Unit)', 'Unit', 'User', 'Access Type', 'Status'],
    optionalColumns: ['Invitation Provider', 'Created On'],
    map: { id: '(Do Not Modify) Unit User', compound: 'Compound (Unit) (Unit)', unit: 'Unit', user: 'User', accessType: 'Access Type', provider: 'Invitation Provider', status: 'Status', createdOn: 'Created On' },
  },
  ACTIVE_GATE_PASSES: {
    label: 'Active Gate Passes (CRM)', kind: 'crm',
    filePatterns: [/gate.?pass/i],
    requiredColumns: ['(Do Not Modify) Gate Pass', 'Compound Ref', 'Unit Ref.', 'User Ref.', 'Access Type', 'Entry Date'],
    optionalColumns: ['Valid Until', 'Created On'],
    map: { id: '(Do Not Modify) Gate Pass', compound: 'Compound Ref', unit: 'Unit Ref.', user: 'User Ref.', accessType: 'Access Type', entryDate: 'Entry Date', validUntil: 'Valid Until', createdOn: 'Created On' },
  },
  INVITATION_REQUESTS: {
    label: 'All Invitation Requests (CRM)', kind: 'crm',
    filePatterns: [/invitation/i],
    requiredColumns: ['(Do Not Modify) Invitation Request', 'Invitation Provider', 'Invited Member Name', 'Type', 'Status Reason'],
    optionalColumns: ['Code', 'Invitation To', 'Invited Member Mobile Number', 'Created On'],
    map: { id: '(Do Not Modify) Invitation Request', code: 'Code', provider: 'Invitation Provider', inviteTo: 'Invitation To', memberName: 'Invited Member Name', memberMobile: 'Invited Member Mobile Number', type: 'Type', status: 'Status Reason', createdOn: 'Created On' },
  },
  VEHICLES: {
    label: 'All Vehicles (CRM)', kind: 'crm',
    filePatterns: [/vehicle(?!.*entrance|.*exit|.*retrieval)/i, /all.?vehicles/i],
    requiredColumns: ['(Do Not Modify) Vehicle', 'Make', 'Model', 'Palette Code', 'Related User', 'Status Reason'],
    optionalColumns: ['Year', 'Created On'],
    map: { id: '(Do Not Modify) Vehicle', make: 'Make', model: 'Model', year: 'Year', plate: 'Palette Code', user: 'Related User', status: 'Status Reason', createdOn: 'Created On' },
  },
  HCP_VEHICLE_ACCESS: {
    label: 'HCP Vehicle Entrance/Exit', kind: 'hcp',
    filePatterns: [/entrance.*exit|retrieval/i],
    requiredColumns: ['License Plate No.', 'Enter or Exit', 'Entrance/Exit', 'Entry and Exit Method', 'Entry and Exit Result'],
    optionalColumns: ['Parking Lot', 'Entering Time', 'Departure Time', 'Reason', 'Vehicle List', 'Vehicle Owner', 'Country/Region', 'Vehicle Type', 'Vehicle Color', 'Brand'],
    map: { plate: 'License Plate No.', parkingLot: 'Parking Lot', direction: 'Enter or Exit', enterTime: 'Entering Time', exitTime: 'Departure Time', gate: 'Entrance/Exit', method: 'Entry and Exit Method', result: 'Entry and Exit Result', reason: 'Reason', vehicleList: 'Vehicle List', owner: 'Vehicle Owner', country: 'Country/Region', vtype: 'Vehicle Type', color: 'Vehicle Color', brand: 'Brand' },
  },
  HCP_REGISTERED_VEHICLES: {
    label: 'HCP Registered Vehicles', kind: 'hcp',
    filePatterns: [/registered.*vehicle/i, /vehicle.*(list|registry)/i],
    requiredColumns: ['*License plate No.', 'Vehicle List', 'Parking Lot'],
    optionalColumns: ["Owner's Last Name", "Owner's First Name", 'Phone', 'Start Time of Effective Period', 'End Time of Effective Period', 'Vehicle Type', 'Brand', 'Vehicle Color', 'Vehicle Owner ID', 'Card', 'Start Time of Parking Lot Validity Period', 'End Time of Parking Lot Validity Period'],
    map: { plate: '*License plate No.', lastName: "Owner's Last Name", firstName: "Owner's First Name", phone: 'Phone', start: 'Start Time of Effective Period', end: 'End Time of Effective Period', vtype: 'Vehicle Type', brand: 'Brand', color: 'Vehicle Color', ownerId: 'Vehicle Owner ID', card: 'Card', vehicleList: 'Vehicle List', parkingLot: 'Parking Lot', lotStart: 'Start Time of Parking Lot Validity Period', lotEnd: 'End Time of Parking Lot Validity Period' },
  },
  HCP_PERSON_AUTH: {
    label: 'HCP Person Authentication', kind: 'hcp',
    filePatterns: [/person.*auth|authentication/i],
    requiredColumns: ['Person No', 'Name'],
    optionalColumns: [],
    map: {},
  },
  HCP_VISITOR_AUTH: {
    label: 'HCP Visitor Authentication', kind: 'hcp',
    filePatterns: [/visitor/i],
    requiredColumns: ['Visitor'],
    optionalColumns: [],
    map: {},
  },
  HCP_PERSON_INFORMATION: {
    label: 'HCP Person Information', kind: 'hcp',
    filePatterns: [/person.?information/i],
    requiredColumns: ['ID', 'First Name'],
    optionalColumns: [],
    map: {},
  },
  HANDOVER: {
    label: 'Handover / Finishing / Resident', kind: 'ops',
    filePatterns: [/hand|finishing|resident/i],
    requiredColumns: ['Unit Code'],
    optionalColumns: ['Category', 'Zone', 'Handing over', 'Finishing permit', 'resident', 'Planned Delivery Date'],
    map: { unit: 'Unit Code', category: 'Category', zone: 'Zone', handover: 'Handing over', finishing: 'Finishing permit', resident: 'resident', planned: 'Planned Delivery Date' },
  },
};

function scoreColumns(header, required) {
  const set = new Set(header.map(h => String(h).trim()));
  let hit = 0;
  for (const c of required) if (set.has(c)) hit++;
  return hit / required.length;
}

function classifyFile(filename, sheets) {
  // sheets: [{name, header[]}]
  const results = [];
  for (const [key, def] of Object.entries(DATASETS)) {
    let colScore = 0, sheetName = null, header = null;
    for (const s of sheets) {
      if (/^hidden/i.test(s.name)) continue;
      const sc = scoreColumns(s.header || [], def.requiredColumns);
      if (sc > colScore) { colScore = sc; sheetName = s.name; header = s.header; }
    }
    const nameHit = def.filePatterns.some(rx => rx.test(filename || ''));
    const excluded = (def.excludePatterns || []).some(rx => rx.test(filename || ''));
    let confidence = colScore * 0.85 + (nameHit ? 0.15 : 0);
    if (excluded) confidence = Math.min(confidence, 0.4);
    results.push({ dataset: key, label: def.label, confidence, colScore, nameHit, excluded, sheetName, header });
  }
  results.sort((a, b) => b.confidence - a.confidence);
  const best = results[0];
  if (best.confidence >= 0.6) return { ...best, status: 'identified' };
  return { dataset: 'UNKNOWN', label: 'Unknown Dataset', confidence: best.confidence, status: 'unknown', candidates: results.slice(0, 3), sheetName: best.sheetName, header: best.header };
}

module.exports = { DATASETS, classifyFile, scoreColumns };
