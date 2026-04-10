# Role Hierarchy + Maker/Checker Design

**Date:** 2026-04-03
**Phase:** 3A
**Status:** Approved

---

## Overview

Expand the current 3-role system (`government_agency`, `corporate`, `verifier`) to a full 10-role, 5-layer hierarchy with dual-control Maker/Checker approval on both the authority side (VC issuance) and the corporate side (VP sharing).

---

## Decisions Log

| Question | Decision |
|---|---|
| Where does Maker/Checker apply? | Both sides — authority VC issuance + corporate VP sharing |
| Role storage model | `sub_role` column alongside existing `role` column |
| MC action storage | Single `mc_actions` table with `resource_type` discriminator |
| Portal Manager scope | Full platform admin (account mgmt + stats + DID registry) |
| Implementation strategy | Option 2 — Three Layers (A: DB+Auth, B: MC Flows, C: Portal Manager) |

---

## Role Hierarchy

### Full 10-Role Stack

| Layer | `role` | `sub_role` | Who |
|---|---|---|---|
| 1 — Platform | `portal_manager` | — | Platform super-admin. DB-seeded only. |
| 2 — Authority | `government_agency` | `did_issuer_admin` | Registers authority DIDs |
| 2 — Authority | `government_agency` | `vc_issuer_admin` | Owns approval queue |
| 3 — Dual-Control | `government_agency` | `maker` | Initiates field verification |
| 3 — Dual-Control | `government_agency` | `checker` | Reviews and approves final VC |
| 4 — Corporate | `corporate` | `super_admin` | Owns org account |
| 4 — Corporate | `corporate` | `admin` | Manages org users |
| 4 — Corporate | `corporate` | `operator` | Day-to-day VC operations |
| 4 — Corporate | `corporate` | `maker` | Drafts VP for sharing |
| 4 — Corporate | `corporate` | `checker` | Reviews and signs VP |
| 5 — Verifier | `verifier` | — | Unchanged |

**Note:** `sub_role` values `maker` and `checker` are reused across layers — the enclosing `role` value distinguishes which side they operate on.

---

## Layer A — DB + Auth

### Schema Changes

**`users` table — three new columns:**

```sql
-- Add portal_manager to role CHECK
role VARCHAR(30) NOT NULL CHECK (role IN (
  'portal_manager', 'government_agency', 'corporate', 'verifier'
))

-- New sub_role column
sub_role VARCHAR(30) CHECK (sub_role IN (
  'did_issuer_admin', 'vc_issuer_admin', 'maker', 'checker',
  'super_admin', 'admin', 'operator', 'member'
))

-- New org_id column (self-referencing for corporate users)
org_id UUID REFERENCES users(id)
```

- `sub_role` is nullable — `portal_manager` and `verifier` don't use it
- `org_id` is nullable for `portal_manager`, `government_agency`, `verifier`
- For Corporate Super Admin: `org_id = self (their own id)` — set by the approve route on creation
- For Corporate team members: `org_id = super_admin.id` — set by `POST /api/corporate/team/invite`

### Route Guards

Two helpers in `src/server/index.ts`:

- `requireRole(role)` — existing helper, extended to accept `'portal_manager'`
- `requireSubRole(subRole)` — new helper, checks `req.user.sub_role === subRole`

Self-approval guard: any route that calls `mc/:id/approve` enforces `req.user.id !== mc_action.maker_id` → 403.

### Registration Flow

| User type | How created |
|---|---|
| Portal Manager | DB seed only (`src/db/seeds/portal-manager.sql`). No public registration. |
| Government Agency (any sub_role) | Created by Portal Manager via `/api/portal/authorities` POST |
| Corporate Super Admin | Auto-created on org application approval (existing flow) — **existing approve route must be updated to set `sub_role = 'super_admin'`** when inserting the new corporate user |
| Corporate sub-roles (admin/operator/maker/checker/member) | Created by Corporate Super Admin within their org |
| Verifier | Public `/register` (unchanged) |

**`RegisterPage.tsx` changes:**
- Remove `government_agency` role option (Portal Manager creates authority accounts now)
- Keep only `verifier` in the public registration role selector
- Retain corporate `/signup` banner pointing to org application flow

**`AuthContext.tsx` changes:**
- `User` interface adds `sub_role?: string | null`
- `redirectByRole` adds case: `portal_manager` → `/portal/dashboard`

---

## Layer B — Maker/Checker Flows

### `mc_actions` Table

```sql
CREATE TABLE IF NOT EXISTS mc_actions (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  resource_type    VARCHAR(20) NOT NULL CHECK (resource_type IN ('vc_issuance', 'vp_share')),
  resource_id      UUID NOT NULL,
  org_id           UUID REFERENCES users(id),
  maker_id         UUID NOT NULL REFERENCES users(id),
  checker_id       UUID REFERENCES users(id),
  status           VARCHAR(20) NOT NULL DEFAULT 'pending'
                   CHECK (status IN ('pending', 'approved', 'rejected')),
  payload          JSONB NOT NULL DEFAULT '{}',
  rejection_reason TEXT,
  created_at       TIMESTAMPTZ DEFAULT NOW(),
  updated_at       TIMESTAMPTZ DEFAULT NOW()
);
```

### API Routes

```
POST /api/mc/submit                  requireAuth + requireSubRole('maker')
POST /api/mc/:id/approve             requireAuth + requireSubRole('checker') + self-approval guard
POST /api/mc/:id/reject              requireAuth + requireSubRole('checker')
GET  /api/mc/queue?resource_type=…   requireAuth (returns queue scoped to user's role+org)
```

Queue scoping rules:
- `government_agency` maker/checker sees only their authority's `vc_issuance` actions. Because `mc_actions` has no `authority_type` column, the backend joins to `users` on `maker_id` to get `authority_type`, then filters to rows where that value matches `req.user.authority_type`.
- `corporate` maker/checker sees only their org's `vp_share` actions, filtered by `mc_actions.org_id = req.user.id` (the corporate user IS the org in this schema).

### Authority VC Issuance Flow (replaces current verify-field + approve)

1. **Maker** opens org application detail → checks all required fields → clicks "Submit for Approval"
2. Backend: `POST /api/mc/submit` — inserts `mc_actions` row with `resource_type: 'vc_issuance'`, `resource_id: org_application.id`, payload snapshot of verified fields
3. **Checker** sees pending item in queue → reviews payload → clicks "Approve" or "Reject"
4. On approve: backend calls existing VC issuance logic (build DIA VC, store credential, anchor on Polygon, update `authority_verifications`)
5. On reject: `mc_actions.status = 'rejected'`, `rejection_reason` stored; application returns to Maker's view with reason shown

**What changes in `AuthorityDashboard.tsx`:**
- Maker view: verify-field checkboxes + "Submit for Checker Approval" button (replaces direct "Approve" button)
- Checker view: new "Pending Approvals" tab showing `mc_actions` queue with payload detail modal
- VC Issuer Admin view: sees all actions from their authority (stats + full queue)

### Corporate VP Draft/Sign Flow

1. **Maker** goes to Corp Wallet tab → selects one or more DIA credentials → fills in recipient (verifier) → clicks "Create VP Draft"
2. Backend: `POST /api/mc/submit` with `resource_type: 'vp_share'`, payload = `{ vc_ids: [...], verifier_id, note }`; inserts row in `vp_requests` (status: `draft`)
3. **Checker** sees pending item in their queue → reviews selected credentials + recipient → clicks "Sign & Send" or "Reject"
4. On approve: backend assembles W3C VP JSON from selected VCs, signs with org's parent DID, updates `vp_requests.status = 'sent'`, `vp_json` stored
5. On reject: `mc_actions.status = 'rejected'`, draft discarded

### `vp_requests` Table

```sql
CREATE TABLE IF NOT EXISTS vp_requests (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  holder_org_id  UUID REFERENCES users(id),
  verifier_id    UUID REFERENCES users(id),
  vc_ids         JSONB NOT NULL DEFAULT '[]',
  vp_json        JSONB,
  status         VARCHAR(20) NOT NULL DEFAULT 'draft'
                 CHECK (status IN ('draft', 'sent', 'rejected')),
  note           TEXT,
  created_at     TIMESTAMPTZ DEFAULT NOW(),
  updated_at     TIMESTAMPTZ DEFAULT NOW()
);
```

**What changes in `CorporateDashboard.tsx`:**
- Maker view (sub_role = maker): "Create VP Draft" button in Corp Wallet tab — credential selector + recipient picker
- Checker view (sub_role = checker): new "Pending VP Approvals" tab showing `mc_actions` queue with VP detail modal
- Super Admin / Admin view: new "Team" tab — list org members, invite (create) new member with email + sub_role

---

## Layer C — Portal Manager

### Backend Routes

All guarded by `requireRole('portal_manager')`.

```
GET   /api/portal/stats                 — platform-wide counts
GET   /api/portal/authorities           — list all government_agency users
POST  /api/portal/authorities           — create new authority account
PATCH /api/portal/authorities/:id       — activate / deactivate account
GET   /api/portal/dids                  — all registered DIDs (paginated)
GET   /api/portal/organizations         — all org applications (all statuses)
```

**Corporate team management route** (guarded by `requireRole('corporate')` + `requireSubRole('super_admin')`):
```
GET  /api/corporate/team          — list all users where org_id matches req.user.id
POST /api/corporate/team/invite   — create new team member (email, name, sub_role)
```

`POST /api/corporate/team/invite` body:
```json
{ "email": "maker@acme.com", "name": "Priya Sharma", "sub_role": "maker" }
```
Backend creates user with `role = 'corporate'`, `sub_role` as given, auto-generated temp password (console-logged). The new user's `org_id` is set to `req.user.id` (the Super Admin's user ID) so queue scoping works correctly.

**`users` table — add `org_id` column** to support team scoping:
```sql
org_id UUID REFERENCES users(id)  -- null for portal_manager, government_agency, verifier
                                   -- for corporate sub-role users: points to the Super Admin's user id
```
The Super Admin's own `org_id` is set to their own `id` on creation (self-referencing). All team members they create get `org_id = super_admin.id`.

`POST /api/portal/authorities` body:
```json
{
  "email": "maker@mca.gov.in",
  "name": "Rajesh Kumar",
  "authority_type": "mca",
  "sub_role": "maker",
  "temp_password": "auto-generated"
}
```

### `PortalManagerDashboard.tsx` — 4 Tabs

**Tab 1 — Overview**
- Stat cards: Total Organizations · Active DIDs · Total VCs Issued · Pending MC Actions · Approved This Month · Rejected This Month
- Data from `GET /api/portal/stats`

**Tab 2 — Authority Accounts**
- Table columns: Name · Email · Authority Type · Sub Role · Status (Active/Inactive) · Created
- "Create Account" button → inline form (email, name, authority_type, sub_role selector, auto-generated temp password shown once)
- Deactivate toggle per row (`PATCH /api/portal/authorities/:id`)

**Tab 3 — DID Registry**
- Table columns: DID String · Type (parent/sub) · Owner Name · Role · Created At
- Read-only. Paginated (20 per page).
- Data from `GET /api/portal/dids`

**Tab 4 — Organizations**
- Table columns: Company Name · CIN · Status · Applied Date · Approvals (0–4 badge)
- Filter by status (pending / partial / complete / rejected)
- Row click opens read-only detail modal (same fields as AuthorityDashboard modal)
- Data from `GET /api/portal/organizations`

### Login + Routing

- Portal Manager logs in at existing `/login` page (no separate portal)
- `redirectByRole` sends `portal_manager` → `/portal/dashboard`
- `App.tsx` adds route: `<Route path="/portal/dashboard" element={<ProtectedRouteWrapper requiredRole="portal_manager"><PortalManagerDashboard /></ProtectedRouteWrapper>} />`

### Seed File

`src/db/seeds/portal-manager.sql` — generate the hash at migration time:

```bash
# Generate hash (run once, paste result into SQL below)
node -e "const b=require('bcryptjs'); b.hash('PortalManager@2026',10).then(h=>console.log(h))"
```

```sql
INSERT INTO users (email, password_hash, role, name)
VALUES (
  'portal@didvc.platform',
  '$2a$10$<paste generated hash here>',
  'portal_manager',
  'DID-VC Portal Manager'
) ON CONFLICT (email) DO NOTHING;
```

The plan step that applies this seed must run the hash generation command first and substitute the result inline before executing the SQL.

---

## File Map

| File | Action | Responsibility |
|---|---|---|
| `src/db/schema.sql` | Modify | Add `sub_role` column + `portal_manager` role value |
| `src/db/seeds/portal-manager.sql` | Create | Seed Portal Manager user |
| `src/server/index.ts` | Modify | `requireSubRole` helper; all MC routes; all portal routes; corporate team routes; update register + authority approve routes |
| `src/frontend/App.tsx` | Modify | Add `/portal/dashboard` route; update `RegisterPage` to verifier-only |
| `src/frontend/contexts/AuthContext.tsx` | Modify | Add `sub_role` to `User`; update `redirectByRole` |
| `src/frontend/pages/RegisterPage.tsx` | Modify | Remove `government_agency` role option |
| `src/frontend/pages/AuthorityDashboard.tsx` | Modify | Sub-role aware views (Maker / Checker / VC Issuer Admin) |
| `src/frontend/pages/CorporateDashboard.tsx` | Modify | Sub-role aware views (Maker / Checker / Super Admin / Admin) + VP draft flow |
| `src/frontend/pages/PortalManagerDashboard.tsx` | Create | Full Portal Manager UI (4 tabs) |

---

## Error Handling

- Self-approval: `maker_id === req.user.id` on approve route → 403 `"A Maker cannot approve their own action"`
- Checker approves already-approved action → 400 `"Action is already approved"`
- Maker submits duplicate for same resource → 400 `"A pending action already exists for this resource"`
- Portal Manager creates authority with duplicate email → 400 (existing unique constraint on `users.email`)

---

## Out of Scope (Phase 3A)

- Email notifications for Maker/Checker queue items (console log only, as per existing pattern)
- MFA enforcement per sub_role (future)
- Sub-DID issuance to Corporate Members (Phase 3B prerequisite)
- Inter-corporate VP sharing UI (Phase 3B)
