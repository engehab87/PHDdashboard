# KPI Definitions — exact calculation rules

All KPIs are computed server-side (`backend/kpis.js`). UI never computes. Clicking a card drills into underlying records.

| KPI | Definition | Formula | Sources |
|---|---|---|---|
| Active Units | Distinct units in the CRM Active Units snapshot | `COUNT(DISTINCT units.id)` | ACTIVE_UNITS |
| Units With Registered Users | Distinct units with ≥1 **Active** user-unit relationship. Counts **units, not users** | `COUNT(DISTINCT user_units.unit_id WHERE status='Active')` | UNIT_ACCESS |
| Registration Coverage % | Share of active units with ≥1 active registered user | `units_with_users / active_units × 100` | ACTIVE_UNITS + UNIT_ACCESS |
| Active Registered Users | Portfolio: users with status Active. Per compound: distinct users with Active status **and** an Active relationship in that compound | `COUNT(DISTINCT user_id)` | ALL_USERS + UNIT_ACCESS |
| Users by Registered Type | Active users grouped by CRM `Registered As` (dynamic values) | `GROUP BY registered_as` | ALL_USERS |
| Registered Vehicles | Vehicles in CRM export. **Never mixed** with observed access | `COUNT(vehicles.id)` | VEHICLES |
| Vehicle Access Events (Total) | Every HCP entry/exit record. **Not** unique vehicles | `COUNT(hcp_vehicle_events.id)` | HCP_VEHICLE_ACCESS |
| Unique Vehicles Accessing | Distinct normalized plates observed | `COUNT(DISTINCT plate_normalized)` | HCP_VEHICLE_ACCESS |
| Automatic Barrier Openings | Events with result PASS (`Vehicle in List: Auto-Open Barrier`) | `COUNT WHERE result='PASS'` | HCP_VEHICLE_ACCESS |
| Unique Auto Vehicles | Distinct plates with ≥1 automatic opening | `COUNT(DISTINCT plate_normalized WHERE result='PASS')` | HCP_VEHICLE_ACCESS |
| Invitations | Requests grouped by **source** status/type (Completed, Confirmed, Deactivated, Requested, Rejected…, New/Existing User). `Generated/Used` are not CRM statuses and are not reported | `GROUP BY status, type` | INVITATION_REQUESTS |
| Gate Passes (visitor proxy) | Passes by access type (Guest, Beach, Commercial Entity). Used as the documented visitor-activity proxy because no HCP visitor file was provided | `GROUP BY access_type` | ACTIVE_GATE_PASSES |
| Face Recognition | **Unavailable** — requires HCP person/visitor authentication (absent). Never estimated | n/a | — |
| Handover / Finishing / Resident | Units tracked, handed-over (date present), finishing DONE, resident DONE (Alexandria-scope file) | counts | HANDOVER |

## Business rules enforced

- Registered vehicles ≠ vehicles observed accessing. Active users ≠ registered users. Access events ≠ unique vehicles. Face events ≠ unique people. Invitations ≠ visitors.
- Units with `compound_id IS NULL` appear in portfolio totals but in no compound breakdown (reconciled in tests).
- Files returning exactly **100,000 rows** are flagged as possibly truncated; totals are treated as lower bounds.
- Identity matching: exact normalized-name single hit → MATCHED (0.9); multiple hits → POSSIBLE_MATCH for manual review; none → UNMATCHED. Plates match on normalized Arabic or Latin form.
- AI answers quote these definitions and their source period; quantitative statements always come from the queries above.
