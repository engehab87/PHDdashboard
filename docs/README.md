# Palm Hills Dashboard — docs

Current stack: Node.js/Express/SQLite (`data/app.db`), port 2020. Future state (React 19 / ASP.NET Core / Azure SQL / Entra ID / Dynamics) is not yet built.

## Start here

1. `docs/TEST_AND_ACCEPTANCE_REPORT.md` — the acceptance verdict, evidence, and what is NOT complete.
2. `docs/TECHNICAL_PROPOSAL_GAP_ANALYSIS.md` — gap analysis against the Initium proposal.
3. `docs/RBAC_REQUIREMENTS_AND_MATRIX.md` — five roles, permissions, and policy defaults (B1/B2).
4. `CHANGELOG.md` (repo root) — per-change record.

## Architecture & inventories

- `CURRENT_STATE_ARCHITECTURE.md`, `CURRENT_DATABASE_INVENTORY.md`, `CURRENT_API_INVENTORY.md`, `CURRENT_MODULE_INVENTORY.md`.
- `COMPOUND_SCOPE_AND_ACCESS_MODEL.md` — how scopes are enforced (Management/Operations are presentation modes only, never permissions).
- `SECURITY_PRIVACY_AND_AUDIT.md` — PII tiers, masking, export caps, audit.
- `DATA_INTEGRITY_AND_KPI_GOVERNANCE.md` — KPI sources, snapshot drift, idempotency.
- `API_AND_INTEGRATION_CONTRACT.md` — public API contract.
- `DATA_MODEL_MIGRATION_SQLITE_TO_AZURE_SQL.md`, `ENTRA_ID_AND_DYNAMICS_INTEGRATION_READINESS.md`, `PHASE2_READINESS.md`, `IMPLEMENTATION_ROADMAP.md`, `MODULE_ACCEPTANCE_MATRIX.md`.

## Evidence

- `docs/evidence/security-acceptance-*.json` — RBAC/PII/audit harness outputs (latest: `security-acceptance-2026-11-09T20-00-50-245Z.json`, 23/23).
- Reproduce: `node scripts/security-acceptance.js` (live server + real DB; creates/disables `qa.*` test users; never performs destructive resets).

## Root documents

- `README.md`, `SETUP-README.md` (setup/run), `SRS.md`, `DATA_DICTIONARY.md`, `KPI_DEFINITIONS.md`, `HCP_API_SPECS.md`, `HCP_INTEGRATION.md` (HikCentral Phase 2 — not verified live).
