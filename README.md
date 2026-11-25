# Palm Hills — Community Operations Intelligence

Internal platform replacing the manual monthly reporting process. Upload a monthly ZIP of CRM + Hikvision HCP Excel exports → automatic classification, validation, identity resolution, KPI dashboards, data-quality review, management reports, and a grounded AI analyst.

**Reference dataset:** September 2026 (real exports, exported 02-Oct-2026). See `DATA_DICTIONARY.md`.

## Architecture

- **Backend:** Node.js + Express, PostgreSQL (`pg`), SheetJS ingestion
- **Frontend:** dependency-free SPA (offline-safe, hand-rolled SVG charts — no CDN)
- **Database:** Azure Database for PostgreSQL via `DATABASE_URL`; no local database server/install
- **AI:** local grounded analyst by default; optional OpenAI-compatible provider only verbalizes pre-computed DB results (key stored server-side)

## Installation & start (Windows)

1. Install Node.js 22.9+ from https://nodejs.org/
2. Set `DATABASE_URL` to the Azure PostgreSQL connection string (see `AZURE_POSTGRES_DEPLOYMENT.md`)
3. Double-click **`start.bat`** (installs dependencies on first run, opens http://localhost:2020)
4. Or manually: `npm install`, `node --env-file-if-exists=.env -e "require('./backend/db').migrate()"`, then `npm start`

## Monthly upload workflow (Phase 2 engine)

1. Open **Monthly Import** → drag the month's `.zip` (`Sep2026.zip`, `Oct2026.zip`…; filenames don't matter, detection is column-based). Single `.xlsx`/`.xls`/`.csv` files are also accepted
2. ZIP is validated (path-traversal entries rejected), extracted without modifying the original, and every file gets a SHA-256 fingerprint — re-uploading an identical file reports `EXACT_DUPLICATE_FILE` and skips it
3. Review auto-detected datasets + reporting month, then **Validate → Process → Calculate** with live progress and a per-phase import log
4. **Master data** (users, units, vehicles, user-unit relations) uses UPSERT: new / updated / unchanged counts, per-field change log (**Changed Records**) and history tables (`user_history`, `unit_history`, …) for current vs historical state
5. **Events** (HCP access, invitations, gate passes, handover) are immutable with deterministic fingerprints (`event_fingerprints`, unique on type+system+hash) — cumulative/overlapping exports only insert genuinely new rows
6. Every import ends with an **Import Summary** (new/updated/unchanged/duplicates per dataset), a **monthly snapshot** (`period_snapshots`), refreshed KPIs and identity matching
7. **Reprocess** is idempotent (same ZIP twice = zero new records); admin **Rollback** (`POST /api/imports/:id/rollback` with `{"confirm":true}`) reverses one import without touching other months
8. Dashboard always queries the unified accumulated database; month reports filter by reporting period
9. **Months tab**: delete a whole reporting month (events, fingerprints, snapshots, metrics) to upload it again after a mistake — imports are marked DELETED, audit kept, masters preserved and repaired by re-upload via UPSERT. Dashboard truncation warnings (e.g. 100,000-row export caps) are informational and can be dismissed per session

## September 2026 results (actual, from the real files)

## September 2026 results (actual, from the real files)

| Metric | Value |
|---|---|
| Active units | 30,151 (25,395 CRM + refs) · 8,117 with users · coverage 26.92% |
| Active users | 15,048 (Owners 6,687 · Family 11,758 · Tenants 796 · Helpers 336 …) |
| Registered vehicles | 2,059 |
| HCP vehicle events | 100,000 ⚠ (export limit) · 21,968 unique plates |
| Automatic openings | 1,095 events · 75 unique vehicles |
| Invitations | 23,681 (Completed 12,357 · Confirmed 5,715 · Deactivated 4,176 …) |
| Gate passes | 100,000 ⚠ (Guest 78,425 · Beach 21,071 · Commercial 442) |
| Face recognition | unavailable — no HCP person file provided (not estimated) |

## Project layout

```
backend/  db.js  datasets.js  normalize.js  ingest.js  kpis.js  quality.js
          matching (in ingest.js)  ai.js  server.js (API + static)
frontend/ index.html  styles.css  app.js  app-pages.js
scripts/  import-sep2026.js (CLI fixture load)  *.js (checks)
tests/    ingest.test.js  kpi.test.js   (`npm test`, needs September loaded)
data/     raw/  uploads/  backups/   reports are generated on demand (DB is remote PostgreSQL)
```

## Key design decisions

- **Raw preserved** (`raw_rows` + archived ZIPs); normalized state upserted by CRM GUID; event tables are period-scoped and idempotent per re-import
- **No hardcoded compounds, statuses, types, gates, filenames** — discovered dynamically; `parking_lot_compound` and AI settings live in Settings
- **Identity resolution:** exact normalized name (single hit → auto-match; multi → manual review), Arabic/Latin plate forms, manual mappings persist in `identity_maps` across months
- **AI is read-only** (`SELECT` only, via the KPI layer) with `How was this calculated?` on every answer and conversation context
- **Security:** basename-only ZIP extraction, upload size/type limits, parameterized queries, no secrets in frontend, `ai_api_key` masked

## Adding a new Excel dataset

1. Add an entry in `backend/datasets.js` (`filePatterns`, `requiredColumns`, `map`)
2. Add a branch in `ingestFile()` + target table(s) in `backend/db.js`
3. Add KPIs in `backend/kpis.js` and document them in `KPI_DEFINITIONS.md`

## Troubleshooting

- `EADDRINUSE`: another instance is running — `taskkill /F /IM node.exe`, then `node server.js`
- Slow first import (~5 min for September): normal; progress is shown. Event data is batched; snapshots are incremental afterwards
- `No previous-period comparison available`: upload a second month to enable trends
- Face/Visitors pages show honest empty states until the corresponding HCP exports are provided
