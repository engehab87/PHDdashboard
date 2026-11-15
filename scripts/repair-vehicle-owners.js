'use strict';
/* One-time repair: re-evaluate every vehicle owner link under the genuine rule
   (exactly one real CRM user with that name -> link; otherwise unlink, keep raw
   name, flag for review). Safe to re-run. */
process.chdir(__dirname + '/..');
const { migrate } = require('../backend/db');
const { repairVehicleOwnerLinks } = require('../backend/ingest');
migrate();
const res = repairVehicleOwnerLinks('repair-script');
console.log(JSON.stringify(res, null, 1));
