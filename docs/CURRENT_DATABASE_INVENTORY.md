# Current Database Inventory

**Database:** SQLite 3 (`node:sqlite`), file `data/app.db`
**Mode:** WAL (`journal_mode=WAL`, `synchronous=NORMAL`, `foreign_keys=ON`, `busy_timeout=30000`)
**Size at audit:** 551,129,088 bytes (plus `app.db-wal`)
**Backup taken:** `data/backups/app-2026-11-06-10-35-33.db` (533,651,456 bytes, `VACUUM INTO`, consistent)
**Schema source:** `backend/db.js` (SCHEMA + `migrate()`); HCP tables added by `backend/hcp/store.js`

> **Deployment-copy note:** historical SQLite inventory. The `dashboards-azure`
> deployment copy now targets Azure Database for PostgreSQL; see
> `AZURE_POSTGRES_DEPLOYMENT.md`.

> Row counts below were captured read-only on 2026-11-06 after import #2 (2026-10) completed. Masters are global (not period-scoped), so their counts span both periods.

---

## 1. Domain tables

### `compounds`
| Column | Type | Constraints |
|---|---|---|
| id | INTEGER | PK autoincrement |
| name | TEXT | UNIQUE NOT NULL |
| code | TEXT | |
| active | INTEGER | default 1 |

47 rows. Compound identity is name-based; `compound_aliases.alias` maps source spellings to `compounds.id`.

### `compound_aliases`
| Column | Type | Constraints |
|---|---|---|
| alias | TEXT | PK |
| compound_id | INTEGER | NOT NULL FK → compounds(id) |

47 rows.

### `units`
| Column | Type | Notes |
|---|---|---|
| id | INTEGER | PK |
| external_id | TEXT | UNIQUE (CRM source key) |
| unit_number | TEXT | NOT NULL |
| norm_unit | TEXT | NOT NULL, indexed |
| compound_id | INTEGER | FK → compounds, indexed |
| related_unit | TEXT | |
| gate_suspension, rent_suspension, maint_fees | TEXT | source flags |
| created_on, first_seen, last_seen | TEXT | |

34,708 rows (both periods). Indexes: `idx_units_compound`, `idx_units_norm`.

### `users` (CRM residents + HCP-linked persons)
| Column | Type | Notes |
|---|---|---|
| id | INTEGER | PK |
| external_id | TEXT | UNIQUE |
| name, norm_name | TEXT | `norm_name` indexed |
| mobile, norm_mobile | TEXT | `norm_mobile` indexed — **PII** |
| email | TEXT | **PII** |
| national_id | TEXT | **PII** |
| marital_status, status, registered_as, created_on | TEXT | |
| first_seen, last_seen | TEXT | |
| image_url | TEXT | added by migration (not in base SCHEMA) |

34,769 rows. Indexes: `idx_users_normname`, `idx_users_mobile`, `idx_users_status`.

### `user_units` (user-to-unit access relationships)
| Column | Type | Notes |
|---|---|---|
| id | INTEGER | PK |
| external_id | TEXT | UNIQUE |
| user_id | INTEGER | FK → users, indexed |
| user_name_raw | TEXT | |
| unit_id | INTEGER | FK → units, indexed |
| unit_ref_raw | TEXT | |
| compound_id | INTEGER | FK → compounds, indexed |
| compound_raw | TEXT | |
| access_type, invitation_provider, status | TEXT | |
| created_on, first_seen, last_seen | TEXT | |

25,992 rows. Additional composite indexes: `idx_uu_status_unit(status,unit_id)`, `idx_uu_status_user(status,user_id)`.

### `vehicles` (registered CRM vehicles — distinct from HCP observed)
| Column | Type | Notes |
|---|---|---|
| id | INTEGER | PK |
| external_id | TEXT | UNIQUE |
| make, model, year | TEXT | |
| plate_original | TEXT | source plate — **PII** |
| plate_norm | TEXT | indexed |
| plate_norm_latin | TEXT | indexed |
| user_id | INTEGER | FK → users |
| user_name_raw | TEXT | **PII** |
| status, created_on, first_seen, last_seen | TEXT | |

2,381 rows.

### `invitations`
| Column | Type | Notes |
|---|---|---|
| id | INTEGER | PK |
| external_id | TEXT | UNIQUE |
| code, provider, invite_to, member_name, member_mobile, type, status | TEXT | `member_mobile`/`member_name` **PII** |
| created_on | TEXT | |
| period_id | INTEGER | FK → reporting_periods |
| import_id | INTEGER | FK → imports (migration) |

24,185 rows.

### `gate_passes`
| Column | Type | Notes |
|---|---|---|
| id | INTEGER | PK |
| external_id | TEXT | UNIQUE |
| compound_id | INTEGER | FK, indexed |
| compound_raw, unit_ref_raw, user_name_raw | TEXT | **PII** in raw names |
| unit_id | INTEGER | FK, indexed (`idx_gp_unit`) |
| user_id | INTEGER | FK, indexed (`idx_gp_user`) |
| access_type, entry_date, valid_until, created_on | TEXT | `entry_date` indexed |
| period_id | INTEGER | FK |
| import_id | INTEGER | FK (migration) |

101,347 rows (includes the 100,000-row capped export — a lower bound).

### `hcp_vehicle_events` (observed HCP access events)
| Column | Type | Notes |
|---|---|---|
| id | INTEGER | PK |
| period_id | INTEGER | FK, indexed |
| plate_original, plate_normalized, plate_normalized_latin | TEXT | **PII**; plates indexed |
| parking_lot, gate, method, result, reason, vehicle_list | TEXT | |
| compound_id | INTEGER | FK, indexed |
| direction, enter_time, exit_time | TEXT | time index |
| owner_raw | TEXT | **PII** |
| owner_user_id | INTEGER | FK, indexed |
| country, vehicle_type, color, brand | TEXT | |
| event_hash | TEXT | unique index (dedupe) |
| import_id | INTEGER | FK, indexed |

147,500 rows.

### `handover`
| Column | Type | Notes |
|---|---|---|
| id | INTEGER | PK |
| period_id, unit_code, unit_id, category, zone, handover_date, finishing, resident, planned_delivery | | `resident` **PII** |
| event_hash | TEXT | unique (migration) |
| import_id | INTEGER | FK (migration) |

1,846 rows.

---

## 2. Governance and import tables

| Table | Rows | Purpose |
|---|---|---|
| `reporting_periods` | 2 | 2026-09, 2026-10; key/name/start/end/status/processing_version |
| `imports` | 3 | package-level status, hashes, counts, runner_pid, progress, log |
| `raw_files` | 24 | per-file classification/sheet/row count/status |
| `raw_rows` | 599,181 | full raw row JSON per import (large; retention concern) |
| `source_files` | 24 | per-file hash, size, dataset, processing status |
| `import_log` | 55 | structured import log lines (level/phase/message) |
| `duplicate_records` | 8,000 | duplicate event dispositions |
| `changed_records` | 616 | field-level before/after values (redaction absent) |
| `event_fingerprints` | 274,878 | deterministic event dedupe (unique event_type+source_system+event_hash) |
| `period_metrics` | 1,045 | KPI values per period/metric/compound |
| `period_snapshots` | 2 | locked snapshot JSON per period/import |
| `user_history` | 19,901 | master change history (contains PII copies) |
| `unit_history` | 28,983 | unit change history |
| `vehicle_history` | 72 | vehicle change history |
| `user_unit_history` | 141 | relationship change history |
| `identity_maps` | 384 | manual/automatic identity decisions |
| `audit_log` | 327 | actor/action/detail only (no correlation ID, result, before/after) |
| `settings` | 6 | processing_version, timezone, parking_lot_compound, ai_provider, ai_api_key, ai_model |

### HCP subsystem tables

| Table | Rows |
|---|---|
| `compound_hcp`, `compound_credentials`, `compound_network`, `compound_integrations` | 3 each |
| `compound_connectivity` | 3 |
| `connectivity_checks` | 566 |
| `hcp_adapter_registry` | 5 |
| `hcp_capabilities` | 0 |
| `hcp_live_events` | 80,499 |
| `hcp_live_persons` | 200 |
| `hcp_live_vehicles` | 341 |
| `hcp_sync_cursors` | 0 |
| `hcp_sync_runs` | 10 |
| `hcp_test_runs` | 106 |
| `hcp_test_stages` | 591 |

`compound_credentials` stores encrypted secrets (`app_secret`, `vpn_password`) using AES-256-GCM with `HCP_VAULT_KEY`. Secrets are never returned in plaintext by the settings API.

---

## 3. Relationships (declared foreign keys)

```
compounds 1─* units
compounds 1─* user_units
compounds 1─* gate_passes
compounds 1─* hcp_vehicle_events
compounds 1─* compound_aliases
users     1─* user_units
users     1─* vehicles
users     1─* identity_maps (crm_user_id)
units     1─* user_units
units     1─* gate_passes
units     1─* handover
reporting_periods 1─* invitations/gate_passes/hcp_vehicle_events/handover/period_metrics
imports   1─* raw_files/source_files/import_log/duplicate_records/changed_records
```

**Weakness:** `gate_passes.user_id` and `hcp_vehicle_events.owner_user_id` are nullable and frequently unresolved; unresolved attribution is intended to remain Unassigned, but there is no `Unassigned` compound row — nulls are excluded from compound sums. Reconciliation must treat null compound explicitly.

---

## 4. Period model

- **Masters are global** (`units`, `users`, `vehicles`, `user_units`) and are upserted on every import. They are *not* period-scoped.
- **Events are period-scoped** (`invitations`, `gate_passes`, `hcp_vehicle_events`, `handover`).
- `period_metrics` and `period_snapshots` preserve computed KPI values per period.
- The dashboard (`backend/kpis.js`) currently computes from the **global masters + period events**, not from the snapshot. Therefore, after a later import updates a unit or user master, a previously "closed" period's dashboard value can change.

This is the single most important data-integrity gap for KPI governance.

---

## 5. Indexes

Present and verified:
- Units: compound, normalized unit number.
- Users: normalized name, normalized mobile, status.
- User-units: user, unit, compound, `(status,unit_id)`, `(status,user_id)`.
- Vehicles: normalized plate, Latin plate.
- Invitations: status.
- Gate passes: compound, entry date, unit, user.
- HCP events: period, plate, Latin plate, time, compound, owner, import, unique `event_hash`.
- Handover: unique `event_hash`.
- Event fingerprints: event hash, unique `(event_type,source_system,event_hash)`.
- Import/source/log tables: import foreign keys.

Missing/needed: `users(compound)` has no direct column (compound via `user_units`), `gate_passes(period_id, compound_id)`, `invitations(period_id,status)`, and any index supporting global cross-entity search.

---

## 6. Data types and Azure SQL compatibility notes

| SQLite usage | Azure SQL target |
|---|---|
| `INTEGER PRIMARY KEY AUTOINCREMENT` | `INT IDENTITY(1,1) PRIMARY KEY` |
| `TEXT` dates/timestamps (ISO strings) | `DATE` / `DATETIME2(3)` with explicit UTC |
| `TEXT` JSON blobs (`progress`, `metrics`, snapshots) | `NVARCHAR(MAX)` + `JSON_VALUE`, or normalized child tables |
| `REAL` | `FLOAT` / `DECIMAL(18,4)` for money-free metrics |
| Booleans as `INTEGER` | `BIT` |
| Partial/expression indexes | Not all portable; review each |
| `GROUP_CONCAT` | `STRING_AGG` |
| `datetime('now')` | `SYSUTCDATETIME()` |
| `INSERT OR REPLACE` / `ON CONFLICT` | `MERGE` or explicit upsert |
| WAL single-writer | Row-versioning + connection pooling |

No stored procedures, triggers or views exist, which simplifies migration.

---

## 7. Retention and PII in the database

- `raw_rows` stores complete source rows as JSON (599k rows), including PII and plate data. This is the largest privacy exposure and the main candidate for short retention or redaction.
- `user_history`, `changed_records` and `identity_maps` also retain personal data.
- There is no encryption at rest beyond disk/filesystem; SQLite is unencrypted. HCP secrets are the only encrypted values.

---

## 8. Evidence commands

```
node scripts/db-inventory.js          # read-only counts/periods/imports
node scripts/backup-db.js             # consistent VACUUM INTO backup
PRAGMA table_info(<table>)            # via node:sqlite
```
