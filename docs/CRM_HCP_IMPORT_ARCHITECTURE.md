# CRM & HCP Import Architecture

Date: 2026-11-07.
Project: Palm Hills Community Intelligence (Node.js/Express/Azure Database for PostgreSQL via `DATABASE_URL`), port 2020.
Scope: separate CRM and compound-specific HCP manual uploads; future HCP API sync contracts. **No automated synchronization is active.**

## 1. Workflows

### CRM Upload — `POST /api/crm-uploads`
- Datasets: `ALL_USERS`, `ACTIVE_UNITS`, `UNIT_ACCESS`, `ACTIVE_GATE_PASSES`, `INVITATION_REQUESTS`, `VEHICLES` (+ `HANDOVER` ops).
- HCP datasets (`HCP_VEHICLE_ACCESS`, `HCP_*`) are rejected in the workflow (marked `validation_failed` and skipped; never ingested).
- Validation, mapping, deduplication, history and rollback are **unchanged**: same `datasets.js` classification, `normalize.js` mapping, `event_fingerprints` dedup, `*_history` + `changed_records`, `rollbackImport`.
- Flow: staged (UPLOADED) → preview files/confidence/period → confirm month (`POST /api/imports/:id/process?periodKey=YYYY-MM` conceptually `processImport`) → background worker (child process, 409 duplicate-start).

### HCP Manual Upload — `POST /api/hcp-uploads`
Mandatory sequence:
1. **Select compound** from the existing `compounds` database (ID-keyed dropdown; only scope-visible compounds listed).
2. **Select HCP export file** (.zip/.xlsx/.xls/.csv).
3. **Validate + preview** — `GET /api/imports/:id/preview` returns files/datasets/row counts/status, compound, detected period and totals. HCP datasets are ingested as HCP: `HCP_VEHICLE_ACCESS` (barrier events) and `HCP_REGISTERED_VEHICLES` (plate registry, e.g. “Registered Vehicle (1).xlsx” with `*License plate No.` / `Owner's First Name` / `Parking Lot` / `Vehicle List`; inserts new vehicle rows and skips duplicates by plate). HCP-unverified datasets recognized (`HCP_PERSON_AUTH`, `HCP_VISITOR_AUTH`, `HCP_PERSON_INFORMATION`) but not ingested (current behavior; quality flags them as unavailable — never fabricated).
4. **Confirm** (`POST /api/imports/:id/process` with explicit `periodKey` when undetected).
5. **Persist** every event with `compound_id = imports.compound_id` (the selected DB ID). Parking-Lot text is kept as `parking_lot` for provenance but is **not** used for the relationship.
6. **Results/history** in the registry (source badge + compound + status + preview/rollback).

Compound rules:
- Required on upload **and** re-checked on process (worker re-verifies the compound still exists). Missing → `400 VALIDATION_ERROR: An existing compound must be selected…`; unknown ID → `404` (never *create* a compound).
- Frontend keying is ID-only (names shown for humans, IDs persisted). `ensureCompound` is never called for HCP-manual rows.

## 2. Data architecture (additive, no duplicate entities)

`imports` gains (authoritative import-batch key):
- `source_kind` — `CRM_UPLOAD` | `HCP_MANUAL_UPLOAD` | `HCP_API_SYNC` (reserved) | legacy `NULL` (= combined monthly archive before separation).
- `compound_id` — set only for `HCP_MANUAL_UPLOAD`.
- `uploaded_by` (now populated on upload) + existing `uploaded_at`, `period_id`, `detected_period_key/reporting_period`, `file_hash`, `runner_pid`, `successful_files/failed_files/warning_count`, `log`.

`vehicles` owner linking for `HCP_REGISTERED_VEHICLES`:
- Owner name → exactly one resident with a unit row in the uploaded compound (via `user_units`); ambiguous in-compound names stay unlinked and enter `identity_maps` for review; no compound match falls back to the global single-real-user rule, then an honest stub.
- Rows are deduped by generated external id (`hcp-reg:<hash>`) and by normalized plate; no duplicate business entities, no new compounds.

`hcp_vehicle_events` gains:
- `source_kind` — `HCP_MANUAL_UPLOAD` for manual rows (NULL for legacy rows).
- `external_id` — future HCP record identifier (currently always NULL for files).

`event_fingerprints` is the shared identity/evolution store:
- `event_hash` (deterministic HCP event hash) is **source-agnostic** — one hash identifies one barrier event whether it arrived by file or (future) API.
- `source_system`: `crm` (handover/invitation/gate-pass) | `hcp` (legacy) | `hcp-manual` (new) | `hcp-api` (future).
- `source_event_id` carries the external ID once API sync exists; `first_seen_import_id` preserves batch lineage.
- `idx_imports_source (source_kind, compound_id)` for registry filtering.

No new compounds, no duplicate users/units/vehicles: CRM masters UPSERT by `external_id`/normalized keys; HCP events INSERT only on new hashes.

## 3. Normalized processing contract (manual = API)

Both manual and future API ingest the same event tuple:
`{ period_id, plate_normalized, enter/exit ISO, gate, direction, method, result, owner, compound_id, source_kind, external_id, event_hash }`
with `hcpEventHash = HCP(plate, enter, exit, gate, direction, method, result, owner)`.
Dedup: `seen ∪ event_fingerprints` (manual/API don’t collide). Owner linking uses the same identity maps (`hcp_owner` exact-name single-hit). Period attribution is event-date based.

## 4. Security

- Route rules: `POST /api/crm-uploads` + `POST /api/hcp-uploads` → `import.manage`; `GET /api/imports/:id/preview` → `import.view` (`backend/security/catalog.js`).
- Compound authorization is **backend-only**: upload, detail, preview and process all call `canAccessCompound`. Scoped actors (e.g. Community Admin on Badya) can upload only Badya HCP files and cannot confirm out-of-scope imports (403).
- `GET /api/imports` filters HCP-manual/API rows to scope for scoped actors; CRM/legacy rows stay visible (documented limitation: a CRM import is portfolio-wide, so scope alone cannot partition it).
- CSRF, audit (`import.upload` / `import.crm_upload` / `import.hcp_upload` / `import.process_requested`), rate limits and ZIP limits unchanged.

## 5. Manual → API transition rules (future; not active)

1. API rows write `source_kind=HCP_API_SYNC`, `external_id=<HCP source_event_id>`, `source_system=hcp-api`, `compound_id=<selected mapping>`.
2. Identity = `event_hash`; `external_id` is a secondary dedup key **within the same compound** (cross-compound duplicates are `DUPLICATE` warnings, never merged).
3. Manual rows are never overwritten: an API event matching a manual hash is skipped as duplicate and the manual row keeps `source_kind=HCP_MANUAL_UPLOAD` (provenance preserved). No auto-migration of manual → API.
4. A compound switches to API as a unit (per compound-id); never mix manual and API rows with different linkage rules for the same period beyond fingerprint dedup.
5. Until then, `HCP_API_SYNC` rows must not be created by hand; the enum exists only as a contract reservation.

## 6. Testing

- Hermetic: `node --test tests/crm-hcp-import.test.js` (temp DB; 12/12 pass) — workflow classification, mandatory/unknown compound, compound-ID + source-kind persistence, CRM↔HCP rejection, fingerprint dedup, no-new-compound, rollback preserving workflow history, HCP registered-vehicle classification + ingestion, compound-preferred owner linking, duplicate-plate skip without FK failure, reclassification of staged UNKNOWN rows at processing time.
- Regression: `npm test` — same 12 pre-existing drift failures as before (see `docs/TEST_AND_ACCEPTANCE_REPORT.md`); `phase2`/`ingest` fully pass.
- Security: `node scripts/security-acceptance.js` 23/23; browser: Community Manager gets 403 on `#/monthly-imports`, Community Admin sees Badya-only compound dropdown with upload disabled until selected.

## 7. Remaining risks

- Legacy combined monthly uploads still use `POST /api/uploads` (source_kind NULL); the UI now prefers the two dedicated cards, but operators can still stage mixed ZIPs — they process with legacy Parking-Lot mapping (documented).
- CRM imports remain portfolio-wide; compound-scoped HCP gating is exact, CRM gating is workflow-level only.
- Dashboard KPIs still read live masters (snapshot drift documented separately).
- HCP person/visitor auth datasets are previewed but not ingested; face-recognition negatives remain honest.
