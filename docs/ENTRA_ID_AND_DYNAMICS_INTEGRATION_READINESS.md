# Entra ID and Dynamics 365 Integration Readiness

**Date:** 2026-11-06
**Status:** readiness assessment — **nothing here is implemented or verified**

> **Do not claim Microsoft Entra ID or Dynamics 365 integration is complete.** Both require a Microsoft tenant, app registration, consent and credentials that are not available in this environment.

---

## 1. Microsoft Entra ID

### 1.1 Target flow

```
Browser → /api/auth/entra/login → Microsoft identity platform (OIDC)
        → /api/auth/entra/callback (authorization code)
        → validate id_token (issuer, audience, nonce, signature via JWKS)
        → map Entra groups/claims to local role
        → resolve local compound scope
        → create local session (same session layer as local auth)
```

### 1.2 Required configuration

| Item | Value (to be supplied) |
|---|---|
| Tenant ID | Palm Hills tenant |
| Client ID | App registration |
| Client secret / certificate | Key Vault reference |
| Redirect URI | `https://<host>/api/auth/entra/callback` |
| Scopes | `openid profile email` |
| Group claims | Role groups mapped to the five roles |
| Token validation | Issuer, audience, expiry, nonce, signature |

### 1.3 Role mapping (proposed)

| Entra group | Local role |
|---|---|
| `PH-Community-SuperAdmins` | Super Admin |
| `PH-Community-Admins` | Admin |
| `PH-Community-CommunityAdmins` | Community Admin |
| `PH-Community-CommunityManagers` | Community Manager |
| `PH-Community-TopManagement` | Top Management |

Compound scope is **not** taken from Entra; it stays in `user_compound_scopes` and is managed by a Super Admin. This avoids leaking community membership through directory groups.

### 1.4 Implementation tasks

1. Add `openid-client` (or MSAL Node) and a JWKS cache.
2. Add `dashboard_users.auth_source` (`local|entra`) and `entra_object_id` (unique).
3. Implement login/callback/logout routes and state/nonce/PKCE.
4. Map claims → role; reject unknown groups (deny by default).
5. Create/update the local user on first sign-in; never auto-grant scope.
6. Keep local break-glass Super Admin (credentials in Key Vault).
7. Audit every sign-in, mapping failure and role change.
8. Set `Secure`, `HttpOnly`, `SameSite=Lax` cookies; enforce HTTPS.
9. Add token revocation handling and session invalidation on disable.
10. Test with a real tenant before any completion claim.

### 1.5 Acceptance evidence required

- [ ] Successful interactive sign-in against the Palm Hills tenant.
- [ ] Unknown user/group denied with an audit event.
- [ ] Group → role mapping verified for all five roles.
- [ ] Expired/revoked token rejected.
- [ ] Logout clears both Entra and local sessions.
- [ ] No client secret in source or browser.
- [ ] Screenshot/log of a real sign-in (redacted).

### 1.6 Current blockers

| Blocker | Owner |
|---|---|
| Tenant ID and app registration | Palm Hills IT |
| Admin consent for Graph/OpenID | Palm Hills IT |
| Group IDs and membership model | Palm Hills HR/IT |
| Redirect hostname and TLS certificate | Infrastructure |
| Break-glass account ownership | Security |

**Until all blockers are cleared, the implemented local session is the authentication mechanism, and Entra remains future state.**

---

## 2. Dynamics 365 / Dataverse

### 2.1 Target use

- Reference data (compounds, units, residents) could be reconciled against Dataverse.
- The proposal's Phase 1 is file-based; direct integration is not required.
- Any direct integration must be **read-only** against source systems (the proposal forbids modifying CRM/HCP source records).

### 2.2 Required configuration

| Item | Value (to be supplied) |
|---|---|
| Environment URL | `https://<org>.crm.dynamics.com` |
| Tenant ID | Palm Hills tenant |
| Application (client) ID | App registration |
| Client secret/certificate | Key Vault |
| Dataverse application user | With read-only role |
| Entities/views | To be confirmed by business |
| Network access | Allowlist / private endpoint |

### 2.3 Design constraints

1. Read-only. No create/update/delete calls to Dynamics.
2. Incremental sync by `modifiedon`, with a stored watermark.
3. Idempotent upserts keyed by the Dataverse GUID.
4. Field mapping documented and versioned.
5. PII handling identical to file ingestion (masking, audit, retention).
6. Failures go to a dead-letter table with retry; they never block dashboards.
7. Direct integration must never replace the monthly file reconciliation without business approval.

### 2.4 Current state

- No Dataverse client, credential, mapping or sync code exists.
- No environment access has been attempted.
- No data has been read from Dynamics.

**Status: NOT IMPLEMENTED. Do not represent this as delivered.**

---

## 3. Azure hosting (future)

| Component | Target |
|---|---|
| Compute | Azure App Service or Container Apps |
| Database | Azure SQL (see migration document) |
| Secrets | Key Vault + managed identity |
| Storage | Blob Storage for uploads/raw extracts |
| Edge | Front Door / App Gateway with WAF |
| Identity | Entra ID |
| Monitoring | Application Insights + Log Analytics |
| Backups | Automated + PITR |
| Network | Private endpoints, egress control |

Required before go-live: TLS, HSTS, WAF rules, private networking, Key Vault, managed identity, backup/restore rehearsal, DR plan, cost approval.

---

## 4. Claims discipline

The following wording is approved:

> "The platform is architected for Microsoft Entra ID sign-in and Azure SQL. A local, server-side session and RBAC layer is implemented and verified today. Entra ID, Dynamics 365 and Azure hosting require tenant credentials and approvals and have **not** been implemented or verified."

Any statement that Entra/Dynamics/Azure is "done" without the acceptance evidence above is inaccurate.
