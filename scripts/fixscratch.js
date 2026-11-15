'use strict';
const { db } = require('../backend/db');
console.log('veh reset:', db.prepare("UPDATE vehicles SET last_seen='2026-09' WHERE last_seen='2026-10'").run().changes);
console.log('periods:', JSON.stringify(db.prepare('SELECT period_key FROM reporting_periods').all()));
console.log('handover09:', db.prepare('SELECT COUNT(*) c FROM handover h JOIN reporting_periods p ON p.id=h.period_id WHERE p.period_key=?').get('2026-09').c);
console.log('users:', db.prepare('SELECT COUNT(*) c FROM users').get().c, 'units:', db.prepare('SELECT COUNT(*) c FROM units').get().c);
