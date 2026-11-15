# Changelog

All dates UTC, 2026-11-10 unless noted. No git repository — this file is the change record.

## 2026-11-10 — Vehicle Access (HCP) page rebuilt as the executive design console
- `frontend/app-pages.js`: replaced the legacy `'vehicle-access'` renderer with the executive Vehicle Access (HCP) console design (executive header with breadcrumb, H1, "Live Stream Active" pill, role switcher, `HCP Artemis v4.8` badge; primary filter bar with plate search, compound, direction, result, gate, from/to dates, Apply/Reset; analytics grid with "By Hour" 24-bar distribution and Hour×Day heatmap; high-density records table with plate/compound/direction/enter/exit/gate/result/reason/owner columns, export buttons, rows selector and paging; realtime HCP Live Access Events bottom panel). All markup is wired to real APIs: `/api/access` (paged, with from/to), `/api/access/hourly`, `/api/access/heatmap`, `PalmApp.loadHcpLiveEvents`, `PalmApp.exportEntity('access', …)`.
- `frontend/index.html`: added the design token layer — Tailwind CDN (`https://cdn.tailwindcss.com`) with `tailwind.config` mapping the Palm Hills executive palette, typography, radii and shadows; base `@layer base` style block.
- `backend/security/middleware.js`: extended the Content-Security-Policy `script-src`/`style-src` to allow the Tailwind CDN so the design token layer loads.
- `backend/server.js`: added `h.plate_normalized_latin` to the `/api/access` SELECT so the plate column can show both the raw and normalized-latin plate.
- `frontend/app.js`: added `accessFrom`/`accessTo` state, `loadAccessHourly`/`loadAccessHeatmap`, `setAccessFrom`/`setAccessTo`, `applyAccessFilters`, `resetAccessFilters`, `accessListParams`, `setAccessPageSize`, `gotoAccessPrev`/`gotoAccessNext` handlers for the new console.
- Verified in-browser: page renders with "Live Stream Active", "By Hour", "Heatmap (Hour × Day)", records table, exports, paging and the HCP Live Access Events panel; no console errors from the design (only the pre-existing `/api/insights` 401 for non-overview contexts). Server health 200 on port 2020; `/api/access` returns 79,537 rows for 2026-10, hourly returns 24 buckets, heatmap returns 765 cells.
- Unit tests: 101/113 pass; the 12 failures are pre-existing HCP adapter-registry/TLS/KPI drift, unchanged by this change.

## 2026-11-09 — Resident is the single identity reference for unit, compound and vehicle links
- Added `users.canonical_user_id` / `users.is_canonical` (with canonical/marker indices). Boot migration makes a pre-conversion backup, then relinks `user_units`, `vehicles`, `gate_passes`, HCP event owners and identity maps from import-created stubs to the one real external CRM resident when a normalized name has exactly one real identity. Ambiguous multiple-real groups stay untouched.
- Future name-to-user resolution prefers the canonical resident, so uploaded unit access, owner cards and vehicles all resolve through the same resident record. HCP registered-vehicle imports now use the uploaded compound preference when resolving owners.
- A canonical resident consolidation merged duplicate stubs into the real CRM resident for a Hacienda Bay unit owner (vehicle plate redacted); the vehicle therefore resolves through that resident to Hacienda Bay, not Badya. Verified: 13,479 duplicate stubs consolidated and 96,202 active/history-free linkage updates recorded; targeted tests 13/13 and security harness 23/23.

## 2026-11-09 — Registered-vehicle (HCP) sheets now read instead of staging empty
- `backend/datasets.js`: added `HCP_REGISTERED_VEHICLES` (`*License plate No.` / `Vehicle List` / `Parking Lot`), fixing the attached “Registered Vehicle (1).xlsx” which classified as `UNKNOWN` (confidence 0.15, row_count 0, imports #5–#7 skipped it).
- `backend/ingest.js`: ingests that dataset into `vehicles` (owner resolution by first+last name, status from effective validity dates, dedup by generated external id and normalized plate; existing plates skipped, no duplicate business entities); validation re-classifies `UNKNOWN` staged rows at processing time, so an already-staged import recovers without re-uploading.
- Compound linkage: owner name prefers a resident with a unit in the uploaded compound (158/177 single-in-compound for Badya); ambiguous stays unlinked + `identity_maps` review row.
- Hot fixes: `noteDup` FK failure on duplicate plates (a vehicle external_id string was written into `duplicate_records.original_import_id`) — pre-existing plates now skip cleanly; staged reclassification now uses the correct sheet for the schema check (was validating against the null sheet → “missing columns”).
- Verified: hermetic `tests/crm-hcp-import.test.js` 12/12, security harness 23/23 (`security-acceptance-2026-11-09T17-39-51-743Z.json`).

## 2026-11-07 — Separated CRM / compound-specific HCP uploads (see `docs/CRM_HCP_IMPORT_ARCHITECTURE.md`)

### Added
- `POST /api/crm-uploads` (CRM_UPLOAD) and `POST /api/hcp-uploads` (HCP_MANUAL_UPLOAD, **compoundId mandatory**, ID-keyed, scope-checked), plus `GET /api/imports/:id/preview`. Legacy `POST /api/uploads` preserved (source_kind NULL = legacy monthly).
- `imports.source_kind / compound_id / uploaded_by` (populated), `hcp_vehicle_events.source_kind / external_id`, `idx_imports_source`. No new compounds, no duplicate business entities.
- CRM workflow rejects HCP files; HCP workflow rejects CRM masters and forces the selected `compound_id` on every event (worker re-validates existence).
- Frontend `#/monthly-imports` split into CRM and HCP cards with mandatory compound dropdown (scope-listed), staged preview before confirm, and a source-badged registry.
- Future-API contract: shared `event_hash` identity, `source_system hcp-manual` vs reserved `hcp-api`, `external_id`; manual rows never auto-overwritten. **No sync activated.**
- Tests: `tests/crm-hcp-import.test.js` 8/8 (hermetic). `npm test` now includes it. Security harness 23/23 (`docs/evidence/security-acceptance-2026-11-07T10-41-17-833Z.json`). Browser: Community Manager 403 on `#/monthly-imports`; Community Admin sees Badya-only dropdown, upload disabled until selected.

## 2026-11-07 — Scoped-list performance fix + honest UI + acceptance evidence

### Fixed (critical)
- `backend/server.js`: rewrote `userLinkScope` and `invitationScope` from per-row `EXISTS` to indexed IN-subqueries. Scoped list queries went from 44–137s to ~0.1s (residents, vehicles, invitations). Health timeout caused by blocked queries is resolved.
- `backend/server.js`: `/api/users` compounds/units columns now filter to the requested/assigned compound scope; pagination total uses separate count parameters (scoped Badya total = 1,239, previously miscounted after the rewrite).
- `backend/server.js`: `/api/users/:id` units query filters to the actor's scope.
- `backend/server.js`: `/api/health` enriches `startedAt`, `uptimeSeconds`, `lastImport`, `activeImports`, `latestPeriod`, `latestSnapshot`.
- `backend/ingest.js`: ZIP decompression limits (`ZIP_LIMITS`: 500 entries, 512 MiB/entry, 2 GiB total, 512-char names) enforced.

### Changed (honest UI)
- `frontend/app-pages.js`: `hcp-connectivity` rewritten to read-only real backend data; `hcp-live` renamed “HCP Access Events” (no “Live Socket Streaming” claim); `ai-analyst` fixed seeded fake chat, hardcoded portfolio context and dead input; identity matching lists reviewable candidates with confirm/reject; overview warnings, face-recognition and empty states de-faked; settings page replaced with real `GET/PUT /api/settings` with permission-gated fields.
- `frontend/app.js`: added `loadHcp*` loaders, `checkHcpConnection`, `loadPagedList`/`loadMoreList`/`pagerHtml`, `openResident`, `saveSettingsForm`, `askAiFromInput`, `resolveIdentity`; nav label `HCP Live Data` → `HCP Access Events`.

### Verified
- Security harness 23/23 (`docs/evidence/security-acceptance-2026-11-07T09-13-07-726Z.json`).
- Browser as Super Admin and Community Manager (Badya): scoped nav, 403s, paging, drawer, settings save + audit (`settings.update` #513).
- Imports: #2 `COMPLETED_WITH_WARNINGS` (2026-10); #4 reprocess idempotent (masters unchanged).
- `npm test`: 88/100 (12 pre-existing failures documented in `docs/TEST_AND_ACCEPTANCE_REPORT.md`).

## 2026-11-06 — Import pipeline + RBAC baseline + audit docs
- Import failure fixed: month confirmation UI (CRM-only ZIPs have no HCP timestamps), child-process runner, PID tracking, 409/404 handling, restart recovery.
- Security modules (`backend/security/`), scoping, PII masking, export caps, local auth implemented.
- Audit docs written under `docs/`.
