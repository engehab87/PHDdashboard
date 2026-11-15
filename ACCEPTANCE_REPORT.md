# Final Acceptance Report — Palm Hills Dashboard (Phase 1)

**Verdict: CONDITIONAL PASS** for local-credential deployment; Entra ID / Dynamics / Azure cutover remain future work.

Derived strictly from `docs/TEST_AND_ACCEPTANCE_REPORT.md` and its evidence files; no additional claims are made here.

---

## Proven facts

1. Security: 23/23 acceptance scenarios pass (anonymous, RBAC denials, compound scope, PII masking in list/detail/export, CSRF, rate limits, audit, session revoke). Evidence: `docs/evidence/security-acceptance-2026-11-07T09-13-07-726Z.json`.
2. Real import #2 completed as **2026-10** with warnings; a later idempotent reprocessing (#4) left master records unchanged (units 34,708; users 34,769; vehicles 2,381).
3. Scoped list queries that took 44–137s now take ~0.1s after the IN-subquery rewrite in `backend/server.js`; browser-verified paging for Residents (1,239 Badya), Invitations (207), Units (12,382), Vehicles (14).
4. Settings page reads/writes real `GET/PUT /api/settings` and is audit-logged; HCP pages show real backend state only; AI analyst answers from `/api/ai/ask` with real scope/role context.
5. Unit tests: 101/113 pass; the 12 failures are pre-existing test/registry drift (documented, untouched by this change).

## Explicitly NOT accepted as complete

- Entra ID, Dynamics 365/Dataverse, Azure hosting, Azure SQL cutover.
- Live HCP synchronization (imported files only).
- Snapshot-based dashboard KPIs (live-master drift documented).
- Business decisions B3–B6 (pending).

## Conditions

1. Rotate/delete `data/bootstrap-admin.txt` before production.
2. Keep a DB backup before any destructive operation.
3. Re-run `node scripts/security-acceptance.js` after any backend security change and keep the JSON evidence under `docs/evidence/`.
4. Update the 12 stale unit-test expectations before Phase 2; do not mark the verified `hcp-artemis-v26` adapter unverified.
