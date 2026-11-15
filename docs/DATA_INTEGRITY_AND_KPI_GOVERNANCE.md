# Data Integrity and KPI Governance

**Date:** 2026-11-06
**Status:** audit findings + target model
**Reference:** Initium Technical Proposal v1.0, sections 5–6, 11

---

## 1. Verified data state (2026-10 import)

| Dataset | Global rows | Period 2026-10 | Notes |
|---|---:|---:|---|
| units | 34,708 | (global master) | 33,000 assigned + 1,708 Unassigned |
| users | 34,769 | (global master) | |
| user_units | 25,992 | (global master) | |
| vehicles | 2,381 | (global master) | |
| invitations | 24,185 | 504 | Period attribution by event date |
| gate_passes | 101,347 | 1,347 | 100,000-row export cap in 2026-09 |
| hcp_vehicle_events | 147,500 | 0 | CRM-only package; no HCP file |
| handover | 1,846 | 0 | |
| period_snapshots | 2 | 1 | Snapshot id 2, 2026-11-06 10:41 |
| period_metrics | 1,045 | 528 | Portfolio + per-compound |

Import #2: `COMPLETED_WITH_WARNINGS`, 6/6 files, 0 failures, 1 warning, `2026-10`, period id 2.

**Reconciliation verified:** units `34,708 = 33,000 (assigned) + 1,708 (Unassigned)`.

**Period attribution is event-date based, not import-date based.** Re-importing an archive assigns each event to the period containing its own timestamp. This is correct for immutable events, but it means an import of 24,185 invitations only adds 504 to 2026-10 because the other rows already existed under 2026-09. This behaviour must be documented for users, otherwise a period row count looks "wrong".

---

## 2. Critical defect: KPI drift

`computeDashboard()` in `backend/kpis.js` reads live master tables:

```
active_units  = COUNT(*) FROM units
units_with    = COUNT(*) FROM user_units WHERE status='Active'
users_active  = COUNT(*) FROM users ...
vehicles      = COUNT(*) FROM vehicles
```

`period_snapshots` is written on import but **never read by the dashboard**. Consequences:

1. Reprocessing a later month updates global masters and silently changes an earlier month's KPI.
2. A snapshot can disagree with the dashboard for the same period.
3. Acceptance evidence (`period_metrics`) is not what the UI shows.

**Target rule:** a period with a published snapshot is read from the snapshot. Live computation applies only to the current, unpublished period. The response must state `source: "snapshot" | "live"`.

**Implementation options**
- A. Read portfolio KPIs from `period_metrics` and per-compound rows; charts still need live queries or chart snapshots.
- B. Store the full dashboard JSON in `period_snapshots.metrics` and serve it verbatim. Today the column stores the metrics array, not the full response.
- C. Keep live charts and replace only card values with snapshot values (fastest, but inconsistent).

Recommended: B for cards/charts/top compounds, with a `processing_version` and `kpi_version` recorded. This requires a schema/version bump and reprocessing both periods.

**Until implemented, the dashboard must display a warning:** "Values computed live from current masters; may differ from the locked snapshot."

---

## 3. Reconciliation rules

Every portfolio figure must satisfy:

```
portfolio = Σ(scoped compounds) + Unassigned
```

| KPI | Reconciled today? | Action |
|---|---|---|
| active_units | Yes (verified) | Add Unassigned row to comparison |
| units_with_users | Not tested | Add test |
| users_active | Not tested (users can span compounds) | Define: distinct user; document double-counting across compounds |
| hcp_events | Yes (single period) | Add Unassigned row |
| gate_passes | Not tested | Add Unassigned row |
| invitations | Attribution is heuristic | Label as attributed; do not claim exact |
| vehicles | No compound column | Derive via owner; document |

**Unassigned handling:** the dashboard currently returns `compound: 'all'` and includes Unassigned implicitly; the comparison omits it. Add an explicit `Unassigned` row in `compareCompounds` so totals are visually verifiable.

---

## 4. Event immutability and idempotency

Verified:
- `hcp_vehicle_events.event_hash` unique index.
- `handover.event_hash` unique.
- `event_fingerprints(event_type, source_system, event_hash)` unique.
- Reprocessing import #1 produced `new=0`, `unchanged`/`dups` for every file, identical totals.

Rules:
1. Events are append-only; corrections are new events or an explicit restatement, never in-place edits.
2. Master records are upserted with field-level history (`user_history`, `unit_history`, `vehicle_history`, `user_unit_history`, `changed_records`).
3. An import can be rolled back only if it is the latest import for its period and no dependent period exists. Guard by permission and active job.
4. Rollback must write an audit record with before/after counts.

---

## 5. Period lifecycle (target)

```
STAGED → VALIDATING → PROCESSING → COMPLETED | COMPLETED_WITH_WARNINGS | FAILED
                                      ↓
                                  PUBLISHED (locked)
                                      ↓
                              SUPERSEDED (restated)
```

Current: no `PUBLISHED`/`SUPERSEDED` state. All periods are always selectable; a failed or processing import can be selected.

Required:
- Period `status`: `open | published | superseded | deleted`.
- Only published periods are selectable for executive reporting.
- A restatement creates a new snapshot and keeps the old one with `superseded_by`.
- Deleting a period requires `period.delete`, typed confirmation, a backup, and must refuse when an import is running.

---

## 6. Data quality model

Current `quality.js` reports:
- File-level: row counts, truncation (exactly 100,000), classification confidence, missing files.
- Record-level: completeness, duplicate detection, referential integrity, suspicious values.
- A single score is displayed.

Gaps:
- Not nine dimensions with published weights.
- Samples may include PII and are not masked.
- No owner, threshold or remediation workflow.
- No suppression / false-positive marking.

Target dimensions (Phase 2, policy B5):
completeness, validity, uniqueness, consistency, timeliness, referential integrity, conformity, accuracy, coverage.

Each dimension: weight, threshold, score, issue count, sample (masked), owner, last run.

---

## 7. Truncation and honesty rules

- An export that returns exactly 100,000 rows is treated as **potentially truncated**. It is a lower bound, not a total.
- The UI must label such figures "≥ 100,000 (export cap reached)" wherever they appear, including lists and exports.
- Never fabricate a replacement value.
- Missing datasets (face recognition, visitor authentication) remain explicit unavailable states.

---

## 8. Backup and recovery

| Item | State |
|---|---|
| Consistent backup | `scripts/backup-db.js` (`VACUUM INTO`) |
| Latest backup | `data/backups/app-2026-11-06-10-35-33.db` (533,651,456 bytes) |
| Schedule | Manual only (gap) |
| Restore rehearsal | Not performed (gap) |
| WAL | Enabled; backup includes WAL content |
| Retention | Not defined |

Required:
1. Daily automated backup with 30-day retention.
2. Pre-destructive-operation backup enforced in code.
3. Documented restore runbook with a rehearsal on a copy.
4. Integrity check (`PRAGMA integrity_check`) after restore.

---

## 9. Acceptance criteria

1. Units, users, events reconcile to source totals within documented attribution rules.
2. Portfolio = Σ compounds + Unassigned, proven by an automated test.
3. A published period returns identical KPI values before and after a later import.
4. Reprocessing an archive produces zero new events and identical totals.
5. An interrupted import is recovered as FAILED and can be retried safely.
6. Truncated datasets are labeled everywhere.
7. No destructive action is possible without permission, confirmation and a backup.
