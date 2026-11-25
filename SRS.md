# Software Requirements Specification (SRS) — Palm Hills Community Operations Intelligence Platform
Version 1.0.0 | 10-Oct-2026 | Reference dataset: September 2026

> Source of truth: code in `D:\xampp\htdocs\dashboard\` — `backend/` (8 modules), `frontend/` (SPA), `scripts/` (11), `tests/` (3), `README.md`, `KPI_DEFINITIONS.md`, `DATA_DICTIONARY.md`, `package.json`.

---
## Table of Contents
1. Introduction
2. Overall Description
3. User Classes & Roles
4. Operating Environment & Tech Stack
5. Functional Requirements (per feature)
6. Monthly Import Engine (Phase 2)
7. Data Requirements & Data Dictionary
8. Database Design
9. KPI Definitions (normative)
10. Business Rules
11. External Interface Requirements (UI + API)
12. Non-Functional Requirements
13. Security & Privacy
14. Deployment, Installation, Configuration
15. Test & Acceptance Criteria
16. Out of Scope / Known Limitations
17. Glossary
Appendix A — Full REST API Catalog
Appendix B — Frontend Route Catalog
Appendix C — Future Extensions

---
## 1. Introduction

### 1.1 Purpose
Replace the manual monthly Excel reporting process for Palm Hills communities with a single internal platform that: ingests a monthly ZIP of CRM + Hikvision HCP Excel exports, auto-classifies files, validates and merges them idempotently, resolves identities, computes auditable KPIs, exposes operational drill-downs, data-quality review, manual matching, management reports, and a grounded read-only AI analyst.

### 1.2 Scope
In scope: master data (units, users, user-unit relations, vehicles), period events (HCP vehicle access, invitations, gate passes, handover), dashboards, comparisons, trends, search/filter/export, quality, matching, imports management, snapshots, audit, settings, AI Q&A, Excel/print reports.
Out of scope: sales/listing analytics, payment/finance, access-control actuation, mobile app, multi-tenant auth (see §16).

### 1.3 Definitions
- **CRM**: Microsoft Dynamics-style exports (GUID `(Do Not Modify)` + `Row Checksum` + `Modified On`).
- **HCP**: Hikvision Central Platform exports (vehicle entry/exit; person/visitor auth absent).
- **Period**: reporting month `YYYY-MM`, detected from HCP timestamps + user confirmation (CRM files are point-in-time snapshots).
- **Master**: cumulative UPSERT entities (users, units, vehicles, user_units). **Event**: immutable period-scoped rows with deterministic fingerprints.
- **PASS**: `Entry and Exit Result = Pass` (auto-open barrier). **Coverage**: units with ≥1 Active user relation.

### 1.4 References
`README.md`, `KPI_DEFINITIONS.md`, `DATA_DICTIONARY.md`, `backend/*.js`, `frontend/*.js`, `package.json` (`palm-hills-community-intelligence@1.0.0`).

### 1.5 Overview
Backend computes everything; frontend never computes KPIs. Raw preserved (`raw_rows` + archived ZIPs). Re-upload safe (fingerprints + `EXACT_DUPLICATE_FILE`). AI verbalizes only pre-computed DB results.

---
## 2. Overall Description

### 2.1 Product perspective
Node.js + Express app with static SPA, backed by Azure Database for PostgreSQL. No CDN or frontend build step. XAMPP Apache on `:80` may serve `frontend/` statically; canonical runtime is Node on `:2020` serving both API and frontend. The DB layer (`backend/db.js`) preserves the original synchronous API over a PostgreSQL worker.

### 2.2 Major functions (summary)
1. Upload → classify → validate → process → snapshot monthly ZIPs.
2. Executive dashboard (11 KPI cards + 8 charts + warnings).
3. Compound comparison + trends across periods.
4. Entity browsers (units/users/vehicles/gate passes/invitations/access) with filters, detail pages, exports.
5. Data-quality report + reconciliation + score.
6. Identity matching review (confirm/reject, persists across months).
7. AI analyst (rule-grounded, optional LLM verbalizer).
8. Excel export + 7-sheet management report + print/PDF.
9. Imports history, reprocess, rollback, month delete, full reset, snapshots, audit, settings.

### 2.3 Constraints
- Offline-safe frontend: no CDN, hand-rolled SVG charts, dependency-free SPA.
- `pg` client (Node 22+ required for `node:sqlite` only in the one-time migration script); no native builds.
- Upload cap 1 GB; JSON body 2 MB; list pages cap 5000 rows; duplicates/changes cap 500; exports cap 200k (all) / 5k (view).
- No hardcoded compounds/statuses/types/gates/filenames — all discovered dynamically.

### 2.4 Assumptions
- Filenames don't matter; detection is column-based (`datasets.js` 85% columns + 15% filename).
- HCP timestamps are Cairo wall time, kept as-is.
- `parking_lot_compound` mapping in Settings defaults unmapped lots to Badya.
- September 2026 fixture (exported 02-Oct-2026) is the reference test dataset.

---
## 3. User Classes & Roles
No login/roles in v1 (internal trusted network). Implicit audiences:
- **Operations viewer** (Management View): dashboard, compounds, trends, reports, KPIs, AI.
- **Operations analyst** (Operations View = all above + units/users/vehicles/access/gatepasses/invitations/visitors/face/quality/matching/imports/settings).
- **Administrator** (same app, gated by confirmations): rollback import, delete month, full DB reset.
Destructive actions require explicit `confirm:true` (+ period echo / `RESET ALL DATA` phrase).

---
## 4. Operating Environment & Tech Stack
- OS: Windows (primary), any Node 22+ host. Runtime: Node `24.21.0` observed, npm `11.19.0`.
- Backend deps: `express@4.19.2`, `multer`, `xlsx` (SheetJS), `adm-zip`, `pg`. DB: Azure Database for PostgreSQL via `DATABASE_URL` (or `PG*` vars), `PORT` override (default 2020).
- Frontend: `frontend/index.html` shell + `app.js` (core: nav, charts, tables, API client) + `app-pages.js` (pages) + `styles.css` (dark/light themes via `localStorage ph_theme`, ops/mgmt mode via `ph_mode`).
- Entry: `server.js` shim (`chdir + require backend/server.js`); `start.bat` (checks node, `npm install` if needed, opens browser, `node server.js`); `index.php` / root `index.html` redirect to `frontend/` with note to run backend.
- CORS `*`; `API_BASE` = `''` on `:2020`, else `http://localhost:2020`.

---
## 5. Functional Requirements (per feature)

### FR-1 Executive Dashboard (`#/`, `GET /api/dashboard`)
- Inputs: global `period` (defaults latest), `compound` (defaults `all`).
- Outputs: `period`, 11 clickable KPI cards (drill → entity page), 6 charts (Users-by-Type bar, Inv-by-Status donut, Access-by-Day line, Access-by-Gate bar, GP-by-Type donut, Entry-vs-Exit donut), warnings (truncation, quality), footnote "face unavailable", empty-state link to Imports when no period.
- REQ: UI shall not compute; server `computeDashboard()` is normative (§9).

### FR-2 Compound Comparison (`#/compounds`, `GET /api/compare`)
- Sortable table: Compound | ActiveUnits | UnitsWithUsers | Coverage% | ActiveUsers | UniqueVehicles | AutoOpenings | GatePasses | Invitations. Compound links to `#/units?compound=`.
- Portfolio totals = sum + unassigned (`compound_id IS NULL`) shown in totals but no breakdown (reconciled in tests).

### FR-3 Trends (`#/trends`, `GET /api/trends?metric=&compound=`)
- Metric select: `active_units, users_active, hcp_unique, hcp_auto_open, invitations_total, gatepass_total`. Line chart + Period/Value/Change% table. Single-month → info message. Reads `period_metrics` snapshots.

### FR-4 Units (`#/units`, `#/unit/:id`)
- List: search (unit/related), compound filter, preset tabs All / with_users / without_users, sort asc/desc, pagination (25/50/100), export view/all. Counts pre-aggregated (no per-row correlated scan of 100k gate_passes).
- Detail: header + kv (compound, related, gate/rent suspension, fees), tabs Users (with access type/status), Vehicles (via unit users), Passes (agg by access_type with first/last), Invitations (by provider name), Handover rows.
- APIs: `GET /api/units`, `GET /api/units/:id`.

### FR-5 Users (`#/users`, `#/user/:id`)
- List: search (name/mobile/email), status filter (dynamic: Active/Under Review/Deactivated/Rejected), type filter (`registered_as`: Owner/Family/Tenant/Helper/REF…), compound filter (via relations), export.
- Detail: avatar, kv (mobile/email/status/registered/national ID), counts (gatePasses, hcpLinked), Units panel (unit_number/compound/access/status), Vehicles panel.
- APIs: `GET /api/users`, `GET /api/users/:id`.

### FR-6 Vehicles (`#/vehicles`, `#/vehicle/:id`)
- List: search (plate/make/model), status filter (`Approved By PHD/Under Review/Deactivated/Rejected`), HCP-events column (two sargable equality probes on `plate_norm` + `plate_norm_latin`, no OR scan), export.
- Detail: owner link or `unverified` badge, owner mobile/national ID/status, counts (entries/exits/auto), last 200 HCP events (Time/Dir/Gate/Result/Method/Reason).
- APIs: `GET /api/vehicles`, `GET /api/vehicles/:id`.

### FR-7 Vehicle Access / HCP (`#/access`, `GET /api/access|/hourly|/heatmap`)
- Filters: plate/owner search, direction (ENTRY/EXIT), result (PASS/NOT_PASSED), gate (populated from dashboard), compound, date from/to. Hourly bar (24h), Day×Hour heatmap (alpha-shaded table), paged table (Plate/Dir/Enter/Exit/Gate/Method/Result/Reason/VehicleList/Owner/MatchedOwner/Type/Color/Brand), export.
- No unit link exists in HCP file — shall not be inferred.

### FR-8 Gate Passes (`#/gatepasses`, `GET /api/gatepasses`)
- Filters: user/unit search, compound, type (Guest/Beach/Commercial Entity), date from/to. Table User/Unit/Compound/Type/Entry/ValidUntil, export. Documented visitor-activity proxy (no HCP visitor file).

### FR-9 Invitations (`#/invitations`, `GET /api/invitations`)
- Filters: member/provider/code search, status (dynamic: Completed/Confirmed/Deactivated/Requested/Rejected…), type (New/Existing User). Table Code/Provider/InviteTo/Member/Mobile/Type/Status/Created, export. Shall not invent `Generated/Used` statuses.

### FR-10 Visitors (`#/visitors`)
- Info alert (HCP visitor auth missing) + proxy note + `gpByType` donut + gatepasses browse table. No fabricated visitor counts.

### FR-11 Face Recognition (`#/face`)
- Warning "unavailable — vehicle-only data". Expected-datasets table (all Missing). Refuses estimates; requires `HCP_PERSON_AUTH`.

### FR-12 AI Analyst (`#/ai`, `POST /api/ai/ask`)
- Chat UI: seeded examples, Enter support, user bubbles, Thinking indicator, escaped answer + optional table (first 30 rows) + `How was this calculated?` (definition/explanation), persists `compound/metric` context.
- Intent routing order (§10): quality → face → visitor → compare/rank → coverage → active units → users → barrier → vehicles/access → invitations → top units → handover → trend → summary/fallback. Every quantitative answer from KPI layer + `Source: <Period> data.` Fallback lists capabilities.
- Optional LLM: only when `settings.ai_provider != local` + key set; POSTs `{temperature:0}` with "Verbalize ONLY…" system prompt, 20s abort; on failure returns local. Key masked (`***set***`), server-side only. Read-only (`SELECT` via KPI layer).

### FR-13 Reports (`#/reports`, `GET /api/report.xlsx`, `GET /api/export`)
- Compound select; Download Excel (7 sheets: Executive Summary, Compound Comparison, Users by Type, Inv by Status, GP by Type, Access by Day, Data Quality, KPI Definitions); Print/PDF view (renders KPI cards + charts, `window.print()`, `.no-print` toolbar).
- Per-table exports: `Export current view (scope=view, 5k)` + `Export all matching (scope=all, 200k)` as direct links, honoring active filters.

### FR-14 Data Quality (`#/quality`, `GET /api/quality`)
- Score `max(0,100-errors*10-warnings*2)`; reconciliation table (File/Dataset/Status/Source/Processed/Rejected/Duplicates from latest import log); file issues (missing EXPECTED → warning; missing HCP person/visitor → info; failed/error → error; unknown/0-rows/100k-truncation → warning); 13 record checks with 20-row samples (users no name, placeholder mobiles, stub users info, null user/unit relations, units no compound/dup norm_unit, gatepass no compound/unit period-scoped, HCP null plate info, UNMATCHED warn / POSSIBLE info, CRM vehicles never seen in HCP info via both plate forms).

### FR-15 Identity Matching (`#/matching`, `GET+POST /api/matching`)
- Header counts matched/possible/unmatched; combined Possible (warn) + Unmatched (err) list: hcpName + top-5 CRM candidates (name/mobile/status/type/units/compounds) + Confirm / Reject buttons. Confirm upserts `identity_maps(MANUAL,1.0,MATCHED)` + backfills `hcp.owner_user_id`; Reject sets `UNMATCHED`. Mappings persist across months. Note: re-upload repair via `repairVehicleOwnerLinks`.

### FR-16 Monthly Import (`#/imports?tab=upload|history|detail|duplicates|changed|snapshots|months`)
- Upload tab: drop zone + file picker (`.zip,.xlsx,.xls,.csv`), `POST /api/uploads` → detection table (File/Dataset/Confidence/Rows/Status + conflict warning) + month input + Validate→Process→Calculate + log link. On process: `POST /process` (202 async), progress bar, poll `GET /api/imports/:id` 1.5s, redirect on terminal.
- History: File/Period/Status/OK/Failed/Warnings/Uploaded + Summary + Reprocess (idempotent note) + Rollback (`{confirm:true}` → `removedEvents`).
- Detail: New/Updated/Unchanged masters + New events/handovers + dups skipped + warnings + Files + Duplicates/Changed links + Import Log (Time/Level/Phase/Message, scroll).
- Duplicates: dataset filter (8 types) + File/Dataset/Record/Reason/Original/Action. Changed: entity filter (user/unit/vehicle/user_unit) + Entity/Record/Field/Previous/Current.
- Snapshots: Period/Import/Created/View → master_counts. Months: Period/Name/Files/Source + Replace/Delete (both require typing `period_key` + confirm → `POST /periods/:key/delete`).
- See §6 for engine guarantees.

### FR-17 KPI Definitions (`#/kpis`, `GET /api/kpi-definitions`)
- Table KPI/Definition/Formula/Sources from `DEFINITIONS` (21 entries). Clicking dashboard cards drills to records.

### FR-18 Settings (`#/settings`, `GET+PUT /api/settings`, `GET /api/audit`, `POST /api/admin/reset`)
- Source mappings: `parking_lot_compound` JSON textarea. AI: provider select (local/openai-compatible), endpoint, model, key (masked). Save `PUT` (key only if changed). Audit table (200 rows, Time/Actor/Action/Detail, scroll). Danger Zone: full reset requires typing `RESET ALL DATA` + confirm → alert + redirect. Month management lives under Imports→Months.

### FR-19 Periods/Compounds/Meta (`GET /api/periods|/compounds|/health`)
- Periods with file counts, compounds list, health `{ok,version}`. Global period/compound selects drive all pages; `N period(s) loaded` badge; global search (debounced 250ms + Enter, dropdown).

---
## 6. Monthly Import Engine (Phase 2) — normative
Location: `backend/ingest.js` (1208 lines) + `datasets.js` + `normalize.js` + `db.js`.

1. **Accept**: only `.zip/.xlsx/.xls/.csv`; Multer dest `data/uploads`, 1 GB cap. Reject path-traversal (`..`, leading `/`, `C:`, NUL); skip non-Excel in ZIP; never modify original ZIP.
2. **Fingerprint**: SHA-256 per file; `EXACT_DUPLICATE_FILE` if hash already `PROCESSED*` → skip.
3. **Classify**: per file scan first 15 rows for header (skip `hidden*` sheets); `confidence = colScore*0.85 + nameHit*0.15`, cap 0.4 if excluded (`/access|merged/` etc.); threshold ≥0.6 else `UNKNOWN` + top-3 candidates. `HANDOVER` header auto-detected (first data sheet).
4. **Detect period**: votes from HCP sample times (≤4000); conflict if runnerUp >15%.
5. **Stage**: create `imports(UPLOADED)` + `raw_files/source_files/analyses`; return `{importId, files, detected}`.
6. **Validate**: schema check (missing required cols → `validation_failed`); constants `EXPORT_LIMITS=[100000]` → `truncated` warning (lower bound); `PROCESSING_VERSION=2.0.0`.
7. **Process** (`processImport`, async 202, `setImmediate`, progress + `isCancelled`, per-file atomic `rollbackFile`): two-pass, no destructive period wipe.
   - Masters UPSERT by `external_id` (GUID): diff `USER/UNIT/VEH/UU_FIELDS` → `changed_records` per field + `*_history(CREATED/UPDATED/REPAIRED)` + `last_seen=periodKey`; `bulkTouch` for unchanged.
   - Events immutable + fingerprinted: `hcpEventHash(plate|times|gate|dir|method|result|ownerNorm)`, `handoverEventHash(...)`, `crmEventHash(prefix,externalId)`; within-file `seen` Set + `event_fingerprints(unique type+system+hash)`; cumulative/overlapping exports insert only new rows.
   - Resolvers: `ensureCompound` (dynamic), `resolveUser/resolveUnit` (normalized name/unit+compound; stub-create honest stubs), `resolveVehicleOwner` genuine rule (exactly 1 real CRM user → link; 0 → stub; >1 → NULL + `identity_maps NAME_AMBIGUOUS/POSSIBLE_MATCH` + `ambiguousOwners` stat).
   - HCP mapping: `direction=/exit/i?EXIT:ENTRY`; `result=/pass/i && !/not/i?PASS:NOT_PASSED`; `compound=parking_lot_compound[lot]||Badya`.
   - `autoMatch`: `NAME_EXACT_SINGLE(0.9,MATCHED)` / `MULTI(0.8,POSSIBLE)` / `NO_MATCH(0,UNMATCHED)`; counts `crmVehiclesSeenInHcp` via both plate forms.
   - `snapshotMetrics` per scope `[null,...compounds]` → `period_metrics`; `writeSnapshot` → `period_snapshots`; refresh KPIs + matching.
8. **Summary**: `getImportSummary` (new/updated/unchanged/duplicates per dataset, warnings, files/sources/log).
9. **Idempotency**: reprocess same ZIP → zero new records; `backfillEventFingerprints` for legacy rows.
10. **Undo**: `rollbackImport` (only `COMPLETED*/FAILED`; deletes events by `import_id`, restores masters if current==new, deletes `CREATED` masters with no later history); `deletePeriodData(YYYY-MM)` (deletes period events/fingerprints/raw/metrics/snapshots, marks imports `DELETED`, audit kept, masters preserved + repaired by re-upload); `resetDatabase` (refuses if active `PROCESSING/VALIDATING/UPLOADED/ANALYZING/staged/processing`; wipes all except `settings`, clears `import_*` dirs).
11. **Reprocess/Cancel**: `POST /reprocess` idempotent; `POST /cancel` blocks terminal states.

---
## 7. Data Requirements & Data Dictionary
Reference: `DATA_DICTIONARY.md` (September 2026, exported 02-Oct-2026). CRM = snapshots (Created On 2024→02-Oct-2026); month from HCP `03-Sep-2026→02-Oct-2026`.

| Dataset | File → Sheet (rows) | Key columns / notes |
|---|---|---|
| ACTIVE_UNITS | `Active Units …` → `Active Units` (25,395) | GUID PK; Name not unique (×3, `old phases fake unit` ×4); 46 compounds +71 blanks (Badya 12,136; PHNC 4,327); Related Unit usually =Name |
| ALL_USERS | `All Users …` → `All Users` (19,136) | GUID PK; 439 blank names (`mohamed`×107); placeholder mobiles `+20/+201/0/0000`→NULL; 459 blank emails (dups ×11); 2,223 blank NID; Status Active 15,048/Deactivated 1,922/Under Review 1,335/Rejected 831; Registered As Family 11,551/Owner 6,389/Tenant 796/Helper 336… |
| UNIT_ACCESS | `All Units Access …` → `All Units Access` (25,445) | User/Unit are names (match normalized); 158 blank users/10 units/80 compounds; Access Type Family 14,269/Owner 9,768…; Status Active 21,987/Inactive 3,458; 45 compounds (Hacienda Bay 13,264 top) |
| VEHICLES | `All Vehicles …` → `All Vehicles` (2,059) | GUID PK; free-text Make/Model/Year; Palette Code Arabic (→`plate_norm`+`latin`, orig preserved); Related User name (stub if unknown); Status Approved 1,357/Under Review 319/Deactivated 230/Rejected 153 |
| INVITATION_REQUESTS | `All Invitation Requests …` → sheet (23,681) | No compound (via provider/member→user→compound); Code blank 3,815 (`12345678`×156); InviteTo blank 17,498; Type New 20,267/Existing 2,363; Status Completed 12,357/Confirmed 5,715/Deactivated 4,176… |
| ACTIVE_GATE_PASSES | `Active Gate Passes …` → sheet (**100,000 = cap ⚠**) | Compound Ref 13 vals (Hacienda Bay 68,267; White 24,080; 62 blank); Unit/User Ref 504 blank; Access Type Guest 78,425/Beach 21,071/Commercial 442; cumulative dates 2025→Oct-2026 |
| HCP_VEHICLE_ACCESS | `Entrance and Exit Retrieval …` → sheet (**100,000 = cap ⚠**) | Plates 22,125 distinct (`Unknown`×21,958); Lot Main Gate 74,058…→compound via setting; Exit 53,297/Entering 46,703; strings `YYYY/MM/DD HH:mm:ss`; Gates G3_1/G2/V1A_CH/G1…; Method `Barrier Not Open` 98,905/Auto 1,095; Result Not Passed 98,905/Pass 1,095; Owner only 1,098 non-blank (73 distinct); Card/thumbs blank; pivot `Sheet1` ignored; **no unit link** |
| HANDOVER | `Handing over…_9377.xlsx` (1,846) | Alexandria scope; `Unit Code` ALX-*, Category/Zone, Handover serial/blank, Finishing `DONE`×384, resident `DONE`×50, Planned serial |
| Auxiliary (not ingested) | Merged Units, Person Information template (empty), Property/Resale listings, prior dashboard .xlsx, Features Guide | Reference/context only |
| Absent (flagged, never fabricated) | `HCP_PERSON_AUTH`, `HCP_VISITOR_AUTH`, `HCP_PERSON_INFORMATION` | Face/visitor-auth unavailable |

September 2026 results (actual): Active units 30,151 (25,395 CRM + refs) · 8,117 with users · coverage 26.92% | Active users 15,048 (Owners 6,687·Family 11,758·Tenants 796·Helpers 336…) | Vehicles 2,059 | HCP 100,000⚠·21,968 unique | Auto 1,095 ev·75 uniq | Invitations 23,681 (Completed 12,357·Confirmed 5,715·Deactivated 4,176…) | Passes 100,000⚠ (Guest 78,425·Beach 21,071·Commercial 442) | Face unavailable.

---
## 8. Database Design
Engine: PostgreSQL, FK ON. `migrate()` idempotent + information_schema column guards. Seed `settings(processing_version, timezone=Africa/Cairo, parking_lot_compound, ai_provider=local, ai_api_key, ai_model)`.

Core tables: `reporting_periods`, `imports`, `raw_files`, `raw_rows`, `source_files`, `compounds`, `compound_aliases`, `units(id,external_id UNIQUE,norm_unit,unit_number,compound_id,related_unit,…)`, `users(id,external_id UNIQUE,norm_name,norm_mobile,status,registered_as,…)`, `user_units`, `vehicles(plate_norm,plate_norm_latin)`, `invitations`, `gate_passes`, `hcp_vehicle_events(event_hash,import_id,plate_normalized(_latin),direction,result,gate,compound_id,owner_*)`, `handover(event_hash,import_id)`, `identity_maps(source_kind,source_key,crm_user_id,match_method,confidence,status)`, `period_metrics(period_id,metric_key,compound_id,value_num)`, `period_snapshots`, `audit_log`, `settings`, `import_log`, `event_fingerprints(unique type+system+hash)`, `user/unit/vehicle/user_unit_history`, `duplicate_records`, `changed_records`.
Indexes: units/users/uu/vehicles plates/inv status/gp/hcp/owner/latin/source hash/event hash/history/import (see `db.js` ~399 lines).

---
## 9. KPI Definitions (normative — `backend/kpis.js`, 21 entries)
UI never computes. Card click drills to records.

| KPI | Formula | Sources |
|---|---|---|
| Active Units | `COUNT(DISTINCT units.id)` | ACTIVE_UNITS |
| Units With Registered Users | `COUNT(DISTINCT uu.unit_id WHERE uu.status='Active')` | UNIT_ACCESS |
| Coverage % | `with/active*100` (2dp) | above |
| Active Registered Users | portfolio `COUNT users.status='Active'`; compound distinct users Active + Active relation | ALL_USERS+UNIT_ACCESS |
| Users by Type | `GROUP BY registered_as` (portfolio) / `access_type` (compound) | ALL_USERS |
| Registered Vehicles | `COUNT(vehicles.id)` (compound=0, no link) | VEHICLES |
| Vehicle Access Events | `COUNT(hcp.id)` (not unique) | HCP_VEHICLE_ACCESS |
| Unique Vehicles | `COUNT(DISTINCT plate_normalized)` | HCP |
| Auto Openings | `COUNT WHERE result='PASS'` | HCP |
| Unique Auto | `COUNT(DISTINCT plate WHERE PASS)` | HCP |
| Invitations | `GROUP BY status,type` (compound via provider/member→user→compound in-memory) | INVITATION_REQUESTS |
| Gate Passes | `GROUP BY access_type` (visitor proxy) | ACTIVE_GATE_PASSES |
| Face | unavailable (n/a) | — |
| Handover/Finishing/Resident | counts (Alexandria file) | HANDOVER |

Charts: usersByType, usersByStatus, invByStatus, gpByType, accessByDay, accessByGate, entryExit, topCompounds (by distinct plates, lim 10). Warnings: 100k truncation (lower bound), stale/deleted period fallback to latest, empty when no period.

---
## 10. Business Rules
- Never mix: registered vehicles ≠ observed; active ≠ registered users; events ≠ unique vehicles; face events ≠ people; invitations ≠ visitors.
- `compound_id NULL` in portfolio totals only.
- Exactly-100,000-row files → truncated warning, totals are lower bounds.
- Identity: exact normalized-name single hit → MATCHED 0.9; multi → POSSIBLE 0.8; none → UNMATCHED 0; plates on Arabic or Latin form; manual persists.
- Normalization (`normalize.js`): plates (strip spaces/dashes/dots/slashes, Arabic→Latin map, `Unknown`→null), phones (E.164-like, Egyptian `1x`→`20…`, placeholders→null but keep display), names (lower/trim/collapse), compounds/units (trim/UPPER), dates (Excel serial 20000–80000 UTC, `YYYY/MM/DD`, `M/D/YYYY`, `Date.parse`).
- AI quotes definitions + period; quantitative only from KPI queries; face/visitor refusals honest.
- Performance: pre-aggregated unit counts; two-probe HCP vehicle count (no OR scan).
- Mutations only via import/matching/settings flows; AI read-only.

---
## 11. External Interface Requirements (UI + API)
UI: responsive SPA, sidebar + topbar (period/compound selects, Operations/Management toggle hiding `.ops-only`, dark/light toggle, global search), toolbars per page, SVG bar/line/donut/heatmap, paged tables with pager + limit + retry + export links, progress bar + polling for imports, chat, printable report, confirm/prompt guards. No auth screen.

API: Express JSON (2 MB), CORS `*`, Multer 1 GB, static `frontend/`. See Appendix A for full endpoint list with methods/params. Errors JSON `{error}`; 202 for async process; 404 for missing entity/period; 400 for bad confirm/phrase.

---
## 12. Non-Functional Requirements
- Performance: Sept import ~5 min normal (batched events); dashboard/compare/quality <2s warm (see `repcheck.js`); paged lists indexed; 60s client abort.
- Reliability: WAL + FK; per-file atomic rollback; idempotent reprocess; fingerprints prevent double-count; snapshots incremental.
- Maintainability: adding dataset = entry in `datasets.js` + branch in `ingestFile()` + tables in `db.js` + KPIs in `kpis.js` + docs.
- Portability: Node 22+, no native modules, no CDN, `DATABASE_URL`/`PORT` env.
- Usability: honest empty states (face/visitors/trends), dismissible warnings per session, `How was this calculated?` on AI.
- Auditability: `audit_log` (imports/matching/exports/reports/settings/AI), `import_log` per phase, `changed/duplicate_records`, `*_history`, `period_snapshots`.

---
## 13. Security & Privacy
- No auth layer (trusted intranet) — must add authN/Z + HTTPS + rate-limit before internet exposure.
- Protections present: basename-only ZIP extraction, upload type/size limits, parameterized queries, no secrets in frontend, `ai_api_key` masked, confirm/phrase gates on destructive ops, detail truncation in audit.
- PII: names/mobiles/emails/NIDs/plates stored; exports contain PII — restrict distribution; consider masking in future.

---
## 14. Deployment, Installation, Configuration
1. Install Node.js 22+ → double-click `start.bat` (auto `npm install`, opens `http://localhost:2020`) or `npm install && node server.js`.
2. If empty: `npm run import` (needs `C:/Users/…/Downloads/*.xlsx` Sept files) or use Monthly Import upload.
3. Verify: `npm test` (ingest/kpi/phase2), `node scripts/apicheck.js|check.js|filtercheck.js|staticcheck.js`.
4. XAMPP: Apache `:80` serves static; API must run on `:2020` (frontend auto-selects). `EADDRINUSE` → `taskkill /F /IM node.exe`.
5. Config: `settings` table (`parking_lot_compound` JSON, `ai_provider/endpoint/model/key`, `timezone`); env `PORT`, `DATABASE_URL` (use a disposable PostgreSQL database for tests).
6. Data dirs: `data/raw/`, `data/uploads/`, `data/backups/`; PostgreSQL is remote. Reports on demand. `server.log/.err`, `start.bat` included.

---
## 15. Test & Acceptance Criteria
- `npm test`: `ingest.test.js` (8: classification by columns, Arabic plate/phone/serial/name — no DB) + `kpi.test.js` (11: needs Sept loaded — period present, DEFINITIONS, with<relations, coverage formula, registered vs observed, 2×100k truncation, compare totals, quality HCP_PERSON_AUTH, AI grounded/barrier/face-refusal/visitor-proxy/follow-up) + `phase2.test.js` (11: temp DB — hash determinism, Sept masters/events/snapshot/history, dup-ZIP 8× skip + zero new, Oct UPSERT/history, reprocess idempotent, rollback restore, delete+re-upload, traversal block, owner genuine rule, reset preserves settings).
- Scripts: `apicheck` (smoke + 4 AI Qs + exports), `filtercheck` (filtered lists + xlsx parse), `staticcheck` (static + page markers), `uploadtest` (e2e ZIP + mystery.csv ignored + Oct scratch cleanup), `check/repcheck/airepro/backfill/fixscratch/repair-vehicle-owners`.
- Acceptance: upload Sept ZIP → dashboard matches §7 values; re-upload → zero new; Oct cumulative → UPSERT counts; rollback/delete/reset behave per §6; AI face Q refuses with no numbers; exports open in Excel.

---
## 16. Out of Scope / Known Limitations
- No login/roles/audit-actor identity; no HTTPS enforcement; no rate limiting.
- Face/visitor-auth analytics impossible until HCP person/visitor files provided (empty states intentional).
- HCP has no unit link — unit attribution for vehicle activity not possible.
- 100k export caps → lower-bound totals; `DEFINITIONS` has duplicate `hcp_events` id (cosmetic); `quality.js` reconciliation reads lowercase `completed` vs uppercase `COMPLETED` (often empty — fix to case-insensitive).
- Sales listings, prior manual merge/dashboard .xlsx, Features Guide are context only.
- Postgres swap, multi-user concurrency hardening, PII masking, scheduled ingestion are future work.

---
## 17. Glossary
ACTIVE_UNITS, ALL_USERS, UNIT_ACCESS, VEHICLES, INVITATION_REQUESTS, ACTIVE_GATE_PASSES, HCP_VEHICLE_ACCESS, HANDOVER, HCP_PERSON_AUTH/VISITOR_AUTH/PERSON_INFORMATION, UPSERT, fingerprint, stub user/unit, `POSSIBLE_MATCH/MATCHED/UNMATCHED`, snapshot, truncation, coverage, PASS/NOT_PASSED.

---
## Appendix A — Full REST API Catalog
`GET /api/health`, `GET /api/periods`, `GET /api/compounds`, `GET /api/kpi-definitions`, `GET /api/dashboard?period&compound`, `GET /api/compare?period`, `GET /api/units?compound&search&preset&sort&page&limit`, `GET /api/units/:id`, `GET /api/users?status&type&compound&search&page&limit`, `GET /api/users/:id`, `GET /api/vehicles?status&search&page&limit`, `GET /api/vehicles/:id`, `GET /api/gatepasses?compound&type&search&from&to&period&page&limit`, `GET /api/invitations?status&type&search&period&page&limit`, `GET /api/access?direction&result&gate&compound&search&from&to&period&page&limit`, `GET /api/access/hourly?period`, `GET /api/access/heatmap?period`, `GET /api/trends?metric&compound`, `GET /api/quality?period`, `GET /api/matching?period`, `POST /api/matching{ hcpName,userId,action }`, `GET /api/insights?period`, `POST /api/ai/ask{ question,periodKey,context }`, `GET /api/export?entity&scope&period+filters`, `GET /api/report.xlsx?period&compound`, `POST /api/uploads(zip)`, `GET /api/imports`, `GET /api/imports/:id`, `GET /api/imports/:id/summary|/log|/duplicates?dataset|/changes?entity`, `POST /api/imports/:id/process{ periodKey,overrides }`, `POST /api/imports/:id/reprocess`, `POST /api/imports/:id/cancel`, `POST /api/imports/:id/rollback{ confirm:true }`, `POST /api/periods/:period/delete{ confirm:true,period }`, `POST /api/admin/reset{ confirm:true,phrase:'RESET ALL DATA' }`, `GET /api/snapshots`, `GET /api/snapshots/:period`, `GET /api/settings`, `PUT /api/settings`, `GET /api/audit`, `GET /`.

## Appendix B — Frontend Route Catalog
`#/` dashboard, `#/compounds`, `#/trends`, `#/units` + `#/unit/:id`, `#/users` + `#/user/:id`, `#/vehicles` + `#/vehicle/:id`, `#/access`, `#/gatepasses`, `#/invitations`, `#/visitors`, `#/face` (ops), `#/ai`, `#/reports`, `#/quality` (ops), `#/matching` (ops), `#/imports?tab=upload|history|detail|duplicates|changed|snapshots|months` (ops), `#/kpis`, `#/settings` (ops). Management View hides `.ops-only`.

## Appendix C — Future Extensions
AuthN/Z + roles, HTTPS + hardening, Postgres migration, PII masking/retention, scheduled/CDC ingestion, HCP person/visitor + face analytics, unit-linked vehicle attribution (needs source change), push alerts, i18n/Arabic RTL, mobile app, e2e tests in CI.
