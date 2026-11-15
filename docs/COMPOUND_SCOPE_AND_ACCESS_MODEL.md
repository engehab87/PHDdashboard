# Compound Scope and Access Model

**Date:** 2026-11-06
**Status:** implemented design baseline
**Related:** `RBAC_REQUIREMENTS_AND_MATRIX.md`, `SECURITY_PRIVACY_AND_AUDIT.md`

---

## 1. Why scope must be server-side

Today the frontend sends `?compound=<name>` and the backend trusts it. Any client can request any compound, or `all`, and receives every record. Client-side selectors are a usability feature, not a control.

The target model: the server resolves the authenticated user's **allowed compound set** from the database and intersects it with every request. A request for a compound outside the set is rejected with `403`, never silently filtered.

---

## 2. Scope data model

```
dashboard_users(id, email, display_name, role, status, password_hash, password_salt, ...)
user_sessions(id, user_id, token_hash, created_at, expires_at, last_seen_at, revoked_at, ip, user_agent)
user_compound_scopes(user_id, compound_id)   -- one row per allowed compound
```

- `scope.all` capability (Top Management, Admin, Super Admin) → no `user_compound_scopes` rows needed.
- Scoped roles (Community Manager, Community Admin) → one or more rows.
- Zero rows and no `scope.all` → **deny** all scoped endpoints.
- Scope changes take effect on the next request; active sessions do not cache the set.

`compounds` is the source of truth for compound ids and names. `compound_aliases` resolves source spellings to a compound id.

---

## 3. Resolution algorithm

```
authenticate(request):
  token := cookie ph_session OR Authorization: Bearer
  session := SELECT ... WHERE token_hash = sha256(token) AND revoked_at IS NULL AND expires_at > now
  if none -> 401
  actor.role, actor.permissions := catalog[role]
  actor.scope := scope.all ? {all:true} : {all:false, ids:[...user_compound_scopes]}

authorize(request, permission):
  if !actor -> 401
  if !actor.permissions.has(permission) -> 403 + audit DENIED

applyScope(request, requestedCompound):
  if requestedCompound and requestedCompound != 'all':
      cid := compoundIdOf(requestedCompound)
      if cid == null -> 404 (unknown compound)
      if !scope.all and cid not in scope.ids -> 403 + audit DENIED
      return {compoundId: cid}
  if scope.all -> {all:true}
  if scope.ids.length == 0 -> 403
  return {all:false, ids:scope.ids}
```

All data queries then receive either one compound id, an explicit id list, or unrestricted access. The SQL layer must never build a query from user-supplied compound text without this check.

---

## 4. Query patterns

| Data set | Scope column | Notes |
|---|---|---|
| `units` | `compound_id` | Direct |
| `user_units` | `compound_id` | Direct |
| `gate_passes` | `compound_id` | Direct |
| `hcp_vehicle_events` | `compound_id` | Direct |
| `vehicles` | via `user_id → user_units.compound_id` | Vehicles have no compound column in the current schema (see defect D1) |
| `users` | via `user_units.compound_id` | A resident can belong to more than one compound |
| `invitations` | no compound column; attributed via provider/member name → user → compound | Attribution is heuristic and must be labeled |
| `handover` | via `unit_id → units.compound_id` | Direct join |
| `period_metrics` | `compound_id` | Direct |

### D1 — vehicles have no compound column

`/api/vehicles/stats` already references `v.compound_id`, which does not exist in the schema. The query fails or falls back depending on the branch. This is a live defect found during the audit.

**Correction:** derive the compound through the owning user's active `user_units` row, or add a denormalized `vehicle.compound_id` populated during ingestion with the owner's primary compound. Until then, vehicle-scoped access must filter with an `EXISTS` subquery and must not trust a `compound` parameter.

---

## 5. Unassigned data

1,708 units (4.9% of 34,708) have no `compound_id`. They are real records and must remain visible to portfolio-wide roles as **Unassigned**.

Rules:
- `scope.all` roles see assigned compounds **plus** Unassigned.
- Scoped roles do not see Unassigned unless explicitly granted a special scope entry.
- Portfolio totals must reconcile: `total = Σ assigned + Unassigned`. Verified for units on 2026-10: `34,708 = 33,000 + 1,708`.
- Compound comparison must include an **Unassigned** row so the sum equals the executive overview (currently missing — gap G1).
- HCP events with `compound_id IS NULL` are included in the Unassigned row for portfolio totals.

---

## 6. Period scope versus compound scope

These are independent axes:

| Axis | Source | Enforcement |
|---|---|---|
| Period | `?period=YYYY-MM` | Must exist; a deleted or unpublished period is not selectable |
| Compound | `?compound=<name|all>` | Must be inside the actor's scope |

A scoped user may see their compound for every period, but only periods that exist. Period **locking** is a separate governance gap (see `DATA_INTEGRITY_AND_KPI_GOVERNANCE.md`).

---

## 7. Presentation modes (not permissions)

| Mode | Effect | Never affects |
|---|---|---|
| Management | Executive layout, comparison/trends emphasis, aggregate wording | API results, permitted routes, PII |
| Operations | Operational tables, default filters, detail drawers | API results, permitted routes, PII |

The mode is stored per user (`localStorage` now, user preference later). Switching mode re-renders the shell; it does not call an authorization endpoint and cannot widen scope.

---

## 8. Frontend behavior on scope errors

- `403` → show a clear "Outside your assigned communities" state; do not silently fall back to `all`.
- `401` → clear the session and show sign-in.
- The compound selector lists only compounds returned by `GET /api/compounds` (already scoped), plus "All my communities" when the user has more than one.
- The URL carries `compound` and `period`; reloading restores the same scoped view.

---

## 9. Audit requirements for scope

Every denial records:
- `actor` (user id + email), `actor_role`
- `action` (e.g. `data.read.denied`)
- `target_type` / `target_id` (compound id or route)
- `result = DENIED`
- `correlation_id`, `ip`, timestamp
- `detail` with the requested compound/period (no PII payload)

Every successful scoped export records the resolved scope, row count and whether unmasked fields were included.

---

## 10. Acceptance criteria

1. A Community Manager assigned to compound A receives `403` for `?compound=B`.
2. `GET /api/compounds` returns only A (and Unassigned only if granted).
3. `GET /api/dashboard` without a compound returns aggregate for A only.
4. `GET /api/users` returns only residents linked to A.
5. `GET /api/vehicles` returns only vehicles owned by residents linked to A.
6. `GET /api/export?entity=units` contains only A rows and is audited.
7. A user with no scope rows receives `403`, not an empty result.
8. A scope change is effective on the next request without re-login.
