# Corporate Registration — Signatory + Maker-Checker Flow Redesign

**Date:** 2026-04-16  
**Status:** Approved

---

## Overview

Redesigns the corporate registration approval pipeline to remove the Portal Manager step and introduce a three-stage approval chain:

1. **Corporate Authorized Signatory** — a corporate-side approver who verifies the application and submits it to the DID Issuer
2. **DID Issuer Maker** — a government agency team member who receives and verifies the application
3. **DID Issuer Checker** — a government agency team member who issues the corporate DID + VCs

After issuance, the **Corporate Super Admin** logs in and uses the existing team management screen to add Maker and Checker members to the corporate org.

---

## 1. New Registration Flow

```
Corporate submits form
  → signatory account auto-created (temp password logged)
  → application status: pending

Authorized Signatory logs in, reviews, approves
  → application status: signatory_approved

DID Issuer Maker sees application, sends to checker
  → application status: maker_reviewed, maker_id set

DID Issuer Checker issues DID + VCs
  → super_admin + requester accounts created
  → signatory.org_id patched to superAdminId
  → application status: issued
```

**Rejection** is possible at any stage (signatory, maker, or checker). Sets `status = 'rejected'`, `rejection_reason` stored.

---

## 2. Data Model

### 2a. New columns on `organization_applications`

```sql
ALTER TABLE organization_applications ADD COLUMN IF NOT EXISTS signatory_name    VARCHAR(255);
ALTER TABLE organization_applications ADD COLUMN IF NOT EXISTS signatory_email   VARCHAR(255);
ALTER TABLE organization_applications ADD COLUMN IF NOT EXISTS signatory_user_id UUID REFERENCES users(id) ON DELETE SET NULL;
ALTER TABLE organization_applications ADD COLUMN IF NOT EXISTS maker_id          UUID REFERENCES users(id) ON DELETE SET NULL;
ALTER TABLE organization_applications ADD COLUMN IF NOT EXISTS checker_id        UUID REFERENCES users(id) ON DELETE SET NULL;
```

`assigned_issuer_id` already exists — now set at **registration time** by the corporate (not by Portal Manager).

### 2b. Widen `application_status` CHECK constraint

```sql
DO $$ BEGIN
  ALTER TABLE organization_applications DROP CONSTRAINT IF EXISTS chk_org_app_status;
  ALTER TABLE organization_applications ADD CONSTRAINT chk_org_app_status
    CHECK (application_status IN (
      'pending', 'partial', 'complete',
      'signatory_approved', 'maker_reviewed',
      'activated', 'issued', 'rejected'
    ));
END $$;
```

`activated` is kept for backward compatibility but no longer used in this flow.

### 2c. New indexes

```sql
CREATE INDEX IF NOT EXISTS idx_org_app_signatory ON organization_applications(signatory_user_id);
CREATE INDEX IF NOT EXISTS idx_org_app_maker     ON organization_applications(maker_id);
CREATE INDEX IF NOT EXISTS idx_org_app_checker   ON organization_applications(checker_id);
```

### 2d. Account creation timeline

| When | Accounts created | Notes |
|------|-----------------|-------|
| Registration submitted | `signatory` (`corporate / authorized_signatory`) | `org_id = NULL` initially |
| Checker issues DID | `super_admin` (`corporate / super_admin`), `requester` (`corporate / requester`) | Signatory `org_id` patched to `superAdminId` |

---

## 3. API Changes

### 3a. Updated: `POST /api/organizations/apply`

**New required fields:**
- `signatory_name` — Authorized Signatory full name
- `signatory_email` — Authorized Signatory email
- `assigned_issuer_id` — DID Issuer org ID selected by corporate (UUID of the DID Issuer org's super_admin)

**New logic on submit:**
1. Validate `signatory_name`, `signatory_email`, `assigned_issuer_id` as required
2. Validate `assigned_issuer_id` is a valid `government_agency` + `super_admin` user with `org_id = id`
3. Generate temp password for signatory
4. `INSERT INTO users (email, password_hash, role='corporate', name=signatory_name, sub_role='authorized_signatory', org_id=NULL)`
5. Store `signatory_user_id` on the application record
6. `console.log('[SUBMITTED] signatory: ${email} | password: ${tempPass}')`

**Response:**
```json
{ "success": true, "applicationId": "uuid", "signatory_temp_password": "..." }
```

### 3b. Updated: `GET /api/public/did-issuers`

Change query to return DID Issuer **organisations** (not individual `did_issuer_admin` users):

```sql
SELECT id, name, email
FROM users
WHERE role = 'government_agency'
  AND sub_role = 'super_admin'
  AND org_id = id
ORDER BY name
```

### 3c. New: `GET /api/corporate/signatory/applications`

Auth: `requireRole('corporate')` + inline `sub_role = 'authorized_signatory'` check.

```sql
SELECT oa.*, u.name AS assigned_issuer_name
FROM organization_applications oa
LEFT JOIN users u ON u.id = oa.assigned_issuer_id
WHERE oa.signatory_user_id = $1
  AND oa.application_status = 'pending'
ORDER BY oa.created_at DESC
```

Returns full application including `documents` JSONB.

### 3d. New: `POST /api/corporate/signatory/applications/:id/approve`

Auth: `corporate` + `authorized_signatory` sub_role.

- Validates `signatory_user_id = user.id` and `application_status = 'pending'`
- `UPDATE organization_applications SET application_status = 'signatory_approved' WHERE id = $1`

### 3e. New: `POST /api/corporate/signatory/applications/:id/reject`

Auth: `corporate` + `authorized_signatory` sub_role.

Body: `{ rejection_reason?: string }`

- Validates `signatory_user_id = user.id` and `application_status = 'pending'`
- `UPDATE organization_applications SET application_status = 'rejected', rejection_reason = $1 WHERE id = $2`

### 3f. New: `POST /api/did-issuer/corporate-applications/:id/maker-review`

Auth: `requireRole('government_agency')` + inline `sub_role = 'maker'` check.

- Validates `assigned_issuer_id = user.org_id` and `application_status = 'signatory_approved'`
- `UPDATE organization_applications SET application_status = 'maker_reviewed', maker_id = $1 WHERE id = $2`

### 3g. Updated: `GET /api/did-issuer/corporate-applications`

Auth: `government_agency`. Returns applications filtered by `assigned_issuer_id = user.org_id`. Role-aware status filter:

| Sub-role | Status filter |
|----------|--------------|
| `maker` | `signatory_approved` |
| `checker` / `super_admin` | `maker_reviewed` |

### 3h. Updated: `POST /api/did-issuer/corporate-applications/:id/issue`

Auth: `government_agency` + (`checker` or `super_admin`) sub_role.

Additional step after creating super_admin user:
```typescript
// Patch signatory's org_id now that super_admin exists
await query(
  `UPDATE users SET org_id = $1 WHERE id = $2`,
  [superAdminId, app.signatory_user_id]
);
```

Also sets `checker_id = user.id` on the application.

### 3i. Removed endpoints

- `POST /api/portal/corporate-applications/:id/activate`
- `POST /api/portal/corporate-applications/:id/reject`

---

## 4. Frontend Changes

### 4a. `OrganizationApplyPage.tsx` — 5-step wizard

**Step 2 — Key People:** Add Authorized Signatory panel alongside Super Admin + Requester:

```
👤 Super Admin        (name, email) — required
📋 Corporate Requester (name, email) — required
✍️ Authorized Signatory (name, email) — required
```

**Step 3 — Select DID Issuer (new step):**

```
Which DID Issuer will issue your corporate DID?
[Dropdown populated from GET /api/public/did-issuers]
```

Steps 4 (Documents) and 5 (Review & Submit) shift by one. Review summary includes signatory name and selected DID Issuer name.

**Submit response:** Show `signatory_temp_password` in the confirmation screen alongside `applicationId`.

### 4b. New: `SignatoryDashboard.tsx`

Rendered when `role = 'corporate'` and `sub_role = 'authorized_signatory'`.

Sections:
- **Application header** — company name, CIN, submitted date, selected DID Issuer name
- **Key People** — super_admin name/email, requester name/email (read-only)
- **Documents** — list of documents with vc_type, reference number, file download link
- **Amber warning box** — "Approving this will submit the application to [DID Issuer Name] for DID issuance"
- **Actions** — "✓ Approve & Submit to DID Issuer" + "✗ Reject" (prompt for reason)

If no pending application: show "No pending applications assigned to you."

### 4c. `AuthorityDashboard.tsx` — Corp Applications tab (role-aware)

The existing tab now shows different content based on `user.sub_role`:

**Maker view** (sub_role = `maker`):
- Lists `signatory_approved` apps assigned to their org
- Each card: company name, CIN, signatory name, submitted date
- Documents expandable (with file links)
- DID preview: `did:web:didvc.platform:{slug}`
- Button: "Send to Checker →" → `POST .../maker-review`

**Checker / Super Admin view** (sub_role = `checker` or `super_admin`):
- Lists `maker_reviewed` apps assigned to their org
- Each card: same info + "Reviewed by: [maker name]"
- Per-document VC checkboxes (pre-checked)
- Amber warning box (existing)
- Button: "🔑 Issue DID + Credentials →" (existing handler, no change)

The single `loadCorpApplications()` call already passes through the auth token — the backend returns the right filtered list based on sub_role.

### 4d. `AppShell.tsx` — Signatory routing

Add `authorized_signatory` to the role-path map so signatory users are routed to `SignatoryDashboard` on login:

```typescript
// In the post-login redirect logic:
if (user.role === 'corporate' && user.sub_role === 'authorized_signatory') {
  navigate('/corporate/signatory');
}
```

Add route: `{ path: '/corporate/signatory', element: <SignatoryDashboard /> }`.

No sidebar needed for signatory — single-purpose page.

### 4e. `PortalManagerDashboard.tsx`

Remove the Corp Applications tab and its associated state/handlers (`corpApps`, `availableIssuers`, `selectedIssuer`, `expandedApp`, `appMsg`, `handleActivate`, `handleRejectApp`). Remove `'applications'` from the `Tab` union type. Remove the nav item from `AppShell.tsx`.

---

## 5. Files to Modify

| File | Change |
|------|--------|
| `src/db/schema.sql` | Add 5 new columns, widen status CHECK, add indexes |
| `src/server/index.ts` | Update apply endpoint; update did-issuers query; add 3 new endpoints (signatory GET/approve/reject, maker-review); update GET did-issuer apps (role-aware); update issue endpoint (patch signatory org_id, restrict to checker) |
| `src/frontend/pages/OrganizationApplyPage.tsx` | 5-step wizard — add signatory panel to Step 2, new Step 3 for DID Issuer, update review |
| `src/frontend/pages/AuthorityDashboard.tsx` | Corp Applications tab role-aware (maker vs checker view), add maker-review handler |
| `src/frontend/pages/PortalManagerDashboard.tsx` | Remove Corp Applications tab, state, handlers |
| `src/frontend/pages/SignatoryDashboard.tsx` | **New file** — signatory review + approve/reject |
| `src/frontend/components/AppShell.tsx` | Add signatory route/redirect; remove portal_manager Corp Applications nav item |
| `src/frontend/App.tsx` (or router file) | Add `/corporate/signatory` route |

---

## 6. Security

- Signatory endpoints: `requireRole('corporate')` + inline `sub_role = 'authorized_signatory'` + `signatory_user_id = user.id` check (own applications only)
- Maker endpoint: `requireRole('government_agency')` + `sub_role = 'maker'` + `assigned_issuer_id = user.org_id` check
- Checker/issue endpoint: `requireRole('government_agency')` + (`sub_role = 'checker'` OR `sub_role = 'super_admin'`) + `assigned_issuer_id = user.org_id`
- Signatory temp password: logged to server console only, returned in apply response for display to submitter

---

## 7. Post-Issuance: Corporate Super Admin Adds Maker/Checker

This is handled by the **existing** team management feature in the Corporate dashboard. The super_admin logs in after receiving their temp password, navigates to the Team tab, and adds users with `maker` or `checker` sub_roles. No new code required.
