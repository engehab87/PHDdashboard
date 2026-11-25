# Security, Privacy and Audit Model

**Date:** 2026-11-06
**Status:** target model + implemented baseline
**Reference:** Initium Technical Proposal v1.0, section 8 (p. 23)

> **Deployment-copy note:** storage-at-rest details below describe the historical
> SQLite build. The `dashboards-azure` copy uses Azure Database for PostgreSQL;
> see `AZURE_POSTGRES_DEPLOYMENT.md`.

---

## 1. Current posture (audit finding)

| Control | Before this change | Evidence |
|---|---|---|
| Authentication | None | 64/64 routes public |
| Server authorization | None | No role/permission checks in `backend/` |
| Compound scope | None | `?compound=` trusted |
| PII masking | None | `/api/users` returns mobile/email; `/api/users/:id` returns national ID; vehicles return plates |
| Audit | Minimal | `audit_log(ts, actor, action, detail)`, actor defaults to `system` |
| Rate limiting | None | Login, AI, exports unbounded |
| CSRF | N/A | No session existed |
| Security headers | None | Express defaults |
| Secrets | Partial | HCP vault encrypted; AI key masked in API response |
| Transport | Plain HTTP | Local deployment only |
| File upload | Extension filter, 1 GB, path traversal blocked | `ingest.js:305-326` |
| ZIP bomb | **Not protected** | No entry count/size/ratio limits |
| Malware scan | None | On-premise gap |

---

## 2. Threat model (abridged)

| Threat | Impact | Control |
|---|---|---|
| Anonymous data harvesting | Full PII exfiltration | Authentication on every `/api/*` route |
| Privilege escalation via client role switch | Unauthorized actions | Server-side permission catalog |
| Cross-compound access | Privacy breach between communities | Server-resolved compound scope |
| Bulk export of PII | Mass exfiltration | `export.sensitive`, audit, rate limit |
| Destructive action by insider | Data loss | Permission + typed confirmation + audit + backup |
| Credential stuffing | Account takeover | scrypt, rate limit, generic errors |
| Session theft | Impersonation | HttpOnly/Secure/SameSite, rotation, revocation, idle timeout |
| CSRF | Unauthorized writes | Double-submit token + SameSite |
| Malicious ZIP | Disk exhaustion / traversal | Entry/size/ratio caps, path checks |
| SQL injection | Data breach | Parameterized queries (existing), scope validated against DB |
| PII in logs | Privacy breach | No PII in audit detail or AI prompts |
| Tampering with history | Fraud | Append-only audit, immutable events |

---

## 3. Authentication design

### 3.1 Local identity (now)

```
dashboard_users(
  id, email UNIQUE, display_name, role,
  status,                     -- active | disabled
  password_hash, password_salt,
  failed_attempts, locked_until,
  last_login_at, created_at, updated_at
)
user_sessions(
  id TEXT PK,                 -- uuid
  user_id, token_hash,        -- sha256 of raw token
  csrf_token,
  created_at, expires_at, last_seen_at,
  revoked_at, ip, user_agent
)
```

- Password: `scrypt(password, salt, 64)` with 16-byte salt; timing-safe compare.
- Session token: 32 random bytes (hex); only the SHA-256 hash is stored.
- Cookie: `ph_session`, `HttpOnly`, `SameSite=Lax`, `Path=/`, `Secure` when `NODE_ENV=production`.
- Bearer token supported for scripts; CSRF is not required for Bearer.
- Idle timeout 8 h, absolute 12 h, checked on every request and slid forward.
- Logout revokes the row; `revoked_at` prevents replay.
- Disabled user → all sessions rejected immediately.

### 3.2 Entra ID (future)

The same `actor` contract is produced by an OIDC callback:
`{ id, email, displayName, role, permissions, scope }`.
Role assignment maps Entra group → local role; scope stays local. The rest of the authorization layer is unchanged. See `ENTRA_ID_AND_DYNAMICS_INTEGRATION_READINESS.md`.

**Do not claim Entra is complete.** It requires an app registration, tenant consent and credentials that are not available.

---

## 4. Authorization design

- One middleware resolves the actor before any `/api` handler.
- Each route declares a permission. Missing permission ⇒ `403`.
- A central `auditDenied()` records the denial.
- Unknown route under `/api` ⇒ `404` (not a permission bypass).
- Destructive endpoints additionally require the typed confirmation already implemented; confirmation is not a substitute for permission.

---

## 5. PII classification and masking

### 5.1 Classification

| Field | Table(s) | Tier | Masked form |
|---|---|---|---|
| `mobile`, `norm_mobile`, `owner_mobile`, `member_mobile`, `phone` | users, vehicles, HCP | 1 | `••••••1234` (last 4) |
| `email`, `owner_email` | users, owners | 1 | `a•••@domain.com` |
| `national_id`, `owner_national_id`, `nin` | users, owners | 1 | `••••••••••••••` (fully) |
| `plate`, `plate_original`, `plate_normalized*`, `plate_norm*` | vehicles, HCP events | 2 | `AB•••23` (first 2 + last 2) |
| `owner_raw` | HCP events | 2 | `Ahmed •••` (first word only) |
| `name`, `member_name`, `user_name_raw`, `resident` | users, invitations, gate passes, HCP | 3 | Retained for operational roles *within scope*; Top Management never receives resident-level rows |
| `owner_matched` | HCP events | 3 | Retained; already a CRM-resolved owner name, not raw operator text |

Tier 1 and Tier 2 are masked unless the actor holds `pii.unmask`. Tier 3 names are retained for operational roles because they are required to perform the work, but only inside the actor's compound scope; Top Management has no resident-level permission at all, so those endpoints return 403 before masking is relevant.

### 5.2 Masking rules

- Masking happens **once, at the API boundary**, in `backend/security/pii.js` via `installResponseMasker`. It wraps `res.json` for every actor without `pii.unmask`, recursively masking arrays and nested objects (depth guard 12) without mutating the source rows.
- Field matching is by lower-cased key name. Adding a new PII-bearing column requires adding its key to `TIER1_KEYS` or `TIER2_KEYS`; otherwise it passes through.
- Search on masked fields is not supported for masked users (searching `0123` would leak presence). Either search is disabled or the result is masked; the current implementation masks the output.
- Exports call `maskRows(rows)` before building the workbook unless the actor holds **both** `pii.export` and `pii.unmask`. Export row counts, scope and unmasked flag are written to the audit log.
- A single XLSX build is hard-capped at **10,000 rows** for `scope=all` and **5,000 rows** for a scoped export. The response sets `X-Export-Row-Count` and `X-Export-Truncated: true` when the cap is hit, so the UI can warn instead of silently truncating. This cap exists because an uncapped 200k-row workbook previously exhausted process memory.
- AI prompts receive aggregates only; no Tier 1/2 fields. The deterministic engine already does this and must remain true if an external provider is enabled.

### 5.3 Masking matrix

| Role | mobile/email | national ID | plates | `owner_raw` | resident names |
|---|---|---|---|---|---|
| Top Management | masked | masked | masked | masked | not accessible (403) |
| Community Manager | masked | masked | masked | masked | in scope |
| Community Admin | masked | masked | masked | masked | in scope |
| Admin | raw | raw | raw | raw | raw |
| Super Admin | raw | raw | raw | raw | raw |

> Policy B2 may widen Community Admin to unmasked within scope. Until approved, the matrix masks.

---

## 6. Audit model

### 6.1 Extended schema

```sql
ALTER TABLE audit_log ADD COLUMN actor_role   TEXT;
ALTER TABLE audit_log ADD COLUMN target_type  TEXT;
ALTER TABLE audit_log ADD COLUMN target_id    TEXT;
ALTER TABLE audit_log ADD COLUMN result       TEXT DEFAULT 'OK';  -- OK | DENIED | ERROR
ALTER TABLE audit_log ADD COLUMN correlation_id TEXT;
ALTER TABLE audit_log ADD COLUMN ip           TEXT;
ALTER TABLE audit_log ADD COLUMN before_json  TEXT;
ALTER TABLE audit_log ADD COLUMN after_json   TEXT;
```

The legacy `audit(action, detail, actor)` signature remains for existing call sites.

### 6.2 Events that must be recorded

| Category | Examples |
|---|---|
| Authentication | login success/failure, logout, session revoke |
| Authorization | every denial (401/403) with route and requested scope |
| Data access | sensitive export, unmasked export, AI question |
| Data change | resident image update, identity decision, settings change |
| Import lifecycle | upload, process, reprocess, cancel, rollback, recovery |
| Destructive | period delete, full reset |
| Administration | user create/disable, role change, scope change |

### 6.3 Audit properties

- Append-only: no update/delete API exists.
- `actor` is the authenticated user id/email; `system` only for startup jobs.
- `correlation_id` is generated per request (`X-Correlation-Id` echoed back).
- `before_json`/`after_json` are stored only for configuration/settings changes, never for bulk PII.
- Retention: 24 months minimum for access/authorization events; legal hold on destructive actions.
- Audit views are themselves permissioned (`audit.view`) and scoped for Community Admin (only events about their compounds where applicable).

---

## 7. Transport and platform hardening

| Control | Now | Production target |
|---|---|---|
| HTTPS | No (localhost) | TLS 1.2+, HSTS, redirect HTTP |
| Security headers | Add `X-Content-Type-Options`, `X-Frame-Options`, `Referrer-Policy`, `Content-Security-Policy` | Tune CSP for fonts/icons |
| Reverse proxy | None | Azure Front Door / App Gateway with WAF |
| Rate limiting | In-process limiter on auth/AI/export/upload | Distributed limiter (Redis) |
| Secrets | `.env` + HCP AES-GCM vault | Azure Key Vault, managed identity |
| Backups | Manual `scripts/backup-db.js` | Automated daily + PITR |
| Logging | stdout | Structured JSON, correlation IDs, SIEM |
| Dependency scanning | None | `npm audit` in CI, Dependabot |
| Malware scan | None | Defender for Storage / ClamAV on upload |

---

## 8. Upload safety

Existing:
- Extension allowlist (`.zip`, `.xlsx`, `.xls`, `.csv`).
- 1 GB multer limit.
- Path traversal rejection for ZIP entries (absolute, drive letter, `..`, NUL).
- Per-file hash and staging isolation.

Required additions (gap G2):
- Maximum entry count (e.g. 1,000).
- Maximum uncompressed size per entry (e.g. 250 MB) and total (e.g. 2 GB).
- Compression ratio cap (e.g. 100:1).
- Reject encrypted archives.
- Malware scan hook before extraction.
- Delete staged uploads after a retention window.

---

## 9. Privacy posture

| Item | Status |
|---|---|
| Data minimisation | Lists return only displayed columns; however exports include `SELECT *` (fix) |
| Purpose limitation | Operational dashboards; documented |
| Retention | Not enforced; `raw_rows` (599k), history tables and uploads need a policy |
| Right of access / erasure | Not implemented; requires a runbook over masters, history and raw rows |
| Encryption at rest | Filesystem only (SQLite unencrypted); HCP secrets encrypted |
| Cross-border | Local hosting; Azure region to be agreed |
| DPIA | Not performed; recommended before production PII processing |
| PII in AI | Aggregates only |
| PII in audit | Detail strings must be reviewed; `changed_records`/history still contain raw PII |

---

## 10. Security acceptance checklist

- [ ] Anonymous access to every non-public route returns `401`.
- [ ] Each role receives only its matrix permissions (`403` otherwise).
- [ ] Cross-compound access returns `403`.
- [ ] Tier 1/2 PII masked for roles without `pii.unmask`.
- [ ] Sensitive exports require `export.sensitive` and are audited.
- [ ] Sessions expire, are revocable and are invalidated on disable.
- [ ] CSRF header required for cookie-authenticated writes.
- [ ] Login and AI/export/upload endpoints are rate-limited.
- [ ] Security headers present.
- [ ] ZIP limits enforced.
- [ ] Audit contains actor, role, action, target, result, correlation ID, IP.
- [ ] No secret is returned in plaintext.
- [ ] Backups are taken before destructive operations.
