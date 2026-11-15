# Data Model Migration: SQLite → Azure SQL

**Date:** 2026-11-06
**Status:** future-state plan — **not executed**
**Note:** the running application uses **SQLite**, not MySQL. A MySQL-compatibility note is included because the original brief assumed MySQL.

---

## 1. Why migrate

| Driver | Detail |
|---|---|
| Concurrency | SQLite has a single writer; imports and interactive reads contend |
| Scale | 551 MB, 599k raw rows, 275k fingerprints; growth is linear per month |
| Managed operations | Azure SQL provides HA, PITR, geo-backup, monitoring |
| Security | Azure AD auth, TDE, row-level security, auditing |
| Platform target | Proposal specifies Azure SQL |

**No migration should start before Phase 1 acceptance.** SQLite is adequate for the current two-period prototype.

---

## 2. Inventory summary

- 48 tables (domain, governance, HCP).
- No stored procedures, triggers, views or functions.
- No unsupported exotic types; heavy use of `TEXT` for dates/JSON.
- JSON blobs: `imports.progress`, `period_snapshots.metrics/master_counts`, `settings.value`, `raw_rows.row_json`.
- `AUTOINCREMENT` primary keys throughout.
- WAL mode, foreign keys ON.
- `INSERT OR REPLACE` / `ON CONFLICT` upserts.
- `GROUP_CONCAT`, `substr`, `datetime('now')`, `COALESCE`.

---

## 3. Type mapping

| SQLite | Azure SQL | Notes |
|---|---|---|
| `INTEGER PRIMARY KEY AUTOINCREMENT` | `INT IDENTITY(1,1) PRIMARY KEY` | Preserve ids with `SET IDENTITY_INSERT` during load |
| `INTEGER` (FK/boolean) | `INT` / `BIT` | Booleans: `active` |
| `TEXT` (names, codes) | `NVARCHAR(n)` | Choose lengths from profiling; `NVARCHAR(MAX)` only for JSON |
| `TEXT` ISO timestamp | `DATETIME2(3)` | Store UTC; convert display in app |
| `TEXT` date | `DATE` | `period_start`, `period_end`, `entry_date` |
| `REAL` | `FLOAT` or `DECIMAL(18,4)` | KPI values: `DECIMAL(18,4)` |
| JSON text | `NVARCHAR(MAX)` + `JSON_VALUE`/`OPENJSON` | Or normalize |
| `UNIQUE` index | `UNIQUE` constraint | Keep names |
| Expression/partial index | Standard index where possible | Review each |
| `GROUP_CONCAT` | `STRING_AGG` | Different separator syntax |
| `datetime('now')` | `SYSUTCDATETIME()` | |
| `INSERT OR REPLACE` | `MERGE` or `UPDATE ... IF @@ROWCOUNT=0 INSERT` | Prefer explicit upsert |
| `ON CONFLICT ... DO UPDATE` | `MERGE` | Watch concurrency |
| WAL | Not applicable | Use read-committed snapshot |

---

## 4. Table-by-table plan

### 4.1 Reference and masters

| Table | Rows | Target | Notes |
|---|---:|---|---|
| `compounds` | 47 | `dbo.Compound` | `name NVARCHAR(200) UNIQUE` |
| `compound_aliases` | 47 | `dbo.CompoundAlias` | PK `alias` |
| `units` | 34,708 | `dbo.Unit` | `norm_unit NVARCHAR(50)`, index |
| `users` | 34,769 | `dbo.Resident` | PII columns; consider Always Encrypted / dynamic data masking |
| `user_units` | 25,992 | `dbo.ResidentUnit` | Composite indexes |
| `vehicles` | 2,381 | `dbo.Vehicle` | Plate indexes |
| `handover` | 1,846 | `dbo.Handover` | |

### 4.2 Period and events

| Table | Rows | Target | Notes |
|---|---:|---|---|
| `reporting_periods` | 2 | `dbo.ReportingPeriod` | `period_key CHAR(7) UNIQUE` |
| `invitations` | 24,185 | `dbo.Invitation` | `period_id` FK |
| `gate_passes` | 101,347 | `dbo.GatePass` | Partition candidate by period |
| `hcp_vehicle_events` | 147,500 | `dbo.HcpVehicleEvent` | `event_hash` unique; partition by period |
| `period_metrics` | 1,045 | `dbo.PeriodMetric` | PK `(period_id, metric_key, compound_id)` |
| `period_snapshots` | 2 | `dbo.PeriodSnapshot` | `metrics NVARCHAR(MAX)` JSON |

### 4.3 Import and governance

`imports`, `raw_files`, `raw_rows`, `source_files`, `import_log`, `duplicate_records`, `changed_records`, `event_fingerprints`, `identity_maps`, `audit_log`, `settings`, `*_history`.

- `raw_rows` (599k, JSON) is the heaviest table. Consider Azure Blob for raw payloads and keep metadata in SQL.
- `audit_log` → append-only table with clustered index on `(ts, id)`, retention policy, and Azure SQL auditing.
- `settings` → `dbo.Setting(key NVARCHAR(100) PK, value NVARCHAR(MAX))`; secrets move to Key Vault references.

### 4.4 HCP tables

All 13 HCP tables map directly. Encrypted credential columns (`app_secret`, `vpn_password`) should move from app-level AES-GCM to Key Vault references; retain the current ciphertext only if a key-rotation plan exists.

---

## 5. Migration approach

### Phase A — Prepare (no production impact)
1. Freeze schema changes; tag a baseline.
2. Profile every column for max length, nullability, distinct values.
3. Write DDL (`sql/azure-sql-schema.sql`) and a data-mapping document.
4. Build a staging Azure SQL database.
5. Write and test a loader (Node `mssql` or Azure Data Factory).

### Phase B — Trial migration
1. Restore the latest SQLite backup to a scratch copy.
2. Load into staging with `IDENTITY_INSERT`.
3. Reset identity seeds (`DBCC CHECKIDENT`).
4. Recreate indexes/constraints after load (faster than during).
5. Run row-count reconciliation per table.
6. Run checksum queries on key aggregates (units, users, events, KPI values).
7. Run the application test suite against staging.

### Phase C — Cutover
1. Announce a freeze window.
2. Stop imports; drain workers.
3. Take a final `VACUUM INTO` backup.
4. Delta-load rows changed since the trial (by `last_seen`/`changed_at`/import id).
5. Switch `DB_DRIVER` to the Azure SQL adapter.
6. Smoke test all 64 routes with each role.
7. Keep SQLite read-only for 30 days as a fallback.

### Phase D — Decommission
1. Export a final archive.
2. Retain backups per policy.
3. Remove SQLite-specific code paths.

---

## 6. Application changes

| Area | Change |
|---|---|
| DB layer | Replace `node:sqlite` `DatabaseSync` with an async client; all call sites become `await` |
| Parameter syntax | `?` → `@p1` named parameters or a small adapter |
| Upserts | `ON CONFLICT` → `MERGE` helpers |
| `S()` helper | Async aggregate wrapper |
| Transactions | Explicit `BEGIN/COMMIT/ROLLBACK` with retry on deadlock |
| JSON | Parse in app or use `JSON_VALUE` |
| Pagination | `OFFSET/FETCH` |
| Case sensitivity | SQLite `LIKE` is case-insensitive for ASCII; SQL Server collation must match |
| Date handling | UTC everywhere; no string comparisons on formatted dates |
| Tests | Use a disposable Azure SQL database or LocalDB |

This is a substantial refactor; it belongs to WP-6, not Phase 1.

---

## 7. MySQL compatibility note

If MySQL were the target instead of Azure SQL:

| SQLite | MySQL 8 |
|---|---|
| `AUTOINCREMENT` | `AUTO_INCREMENT` |
| `TEXT` | `VARCHAR`/`TEXT` with `utf8mb4` |
| `INSERT OR REPLACE` | `REPLACE INTO` or `ON DUPLICATE KEY UPDATE` |
| `GROUP_CONCAT` | `GROUP_CONCAT` (same) |
| `datetime('now')` | `UTC_TIMESTAMP()` |
| JSON | Native `JSON` type |
| Partial indexes | Not supported; use generated columns |
| WAL | InnoDB redo/undo |

The current schema is portable to MySQL with modest effort, but Azure SQL remains the proposal target.

---

## 8. Risks

| Risk | Mitigation |
|---|---|
| Data loss during cutover | Final backup + delta load + 30-day read-only fallback |
| Identity gaps | `IDENTITY_INSERT` + `CHECKIDENT` verification |
| Performance regressions | Index review + query plan comparison |
| PII exposure in staging | Mask/anonymize non-production copies |
| Extended downtime | Trial rehearsals with a measured cutover window |
| Cost | Right-size tier; archive raw payloads to Blob |

---

## 9. Exit criteria

- [ ] Row counts match per table.
- [ ] Key aggregate checksums match.
- [ ] All test suites pass against Azure SQL.
- [ ] Every role/scope scenario passes.
- [ ] Backups and PITR verified.
- [ ] Performance within proposal NFRs.
- [ ] Rollback to SQLite rehearsed.
