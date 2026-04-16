# Corporate Registration & Home Page Redesign

**Date:** 2026-04-16  
**Status:** Approved

---

## Overview

Two connected features:

1. **Home page redesign** — dark marketing-style landing page that prominently features the DID Issuer network, explains the process, and drives corporate self-registration
2. **Corporate registration flow** — extend the existing `/signup` + `organization_applications` table with a 4-step wizard (company info → key people → documents + file upload → review), a two-stage back-office approval (Portal Manager activates → DID Issuer issues DID + VCs), and automatic VC issuance to the corporate wallet on approval

---

## 1. Data Model

### Extend `organization_applications`

Add columns via `ALTER TABLE IF NOT EXISTS … ADD COLUMN IF NOT EXISTS`:

```sql
-- Key people
ALTER TABLE organization_applications ADD COLUMN IF NOT EXISTS super_admin_name    VARCHAR(255);
ALTER TABLE organization_applications ADD COLUMN IF NOT EXISTS super_admin_email   VARCHAR(255);
ALTER TABLE organization_applications ADD COLUMN IF NOT EXISTS requester_name      VARCHAR(255);
ALTER TABLE organization_applications ADD COLUMN IF NOT EXISTS requester_email     VARCHAR(255);

-- Documents (array of {type, reference_number, file_path, vc_type})
ALTER TABLE organization_applications ADD COLUMN IF NOT EXISTS documents           JSONB NOT NULL DEFAULT '[]';

-- Workflow
ALTER TABLE organization_applications ADD COLUMN IF NOT EXISTS assigned_issuer_id UUID REFERENCES users(id);
ALTER TABLE organization_applications ADD COLUMN IF NOT EXISTS corporate_user_id   UUID REFERENCES users(id);
ALTER TABLE organization_applications ADD COLUMN IF NOT EXISTS rejection_reason    TEXT;
ALTER TABLE organization_applications ADD COLUMN IF NOT EXISTS created_at          TIMESTAMPTZ DEFAULT NOW();
```

**`application_status` values** (existing column, no schema change needed):
- `pending` — submitted, awaiting Portal Manager
- `activated` — Portal Manager approved, assigned to DID Issuer, awaiting issuance
- `issued` — DID Issuer issued DID + VCs, corporate user accounts created
- `rejected` — Portal Manager or DID Issuer rejected

**`documents` JSONB shape:**
```json
[
  {
    "type": "MCARegistration",
    "vc_type": "MCARegistration",
    "reference_number": "U72900MH2020PTC123456",
    "file_path": "uploads/corporate-docs/1713200000-cert.pdf",
    "required": true
  },
  {
    "type": "GSTINCredential",
    "vc_type": "GSTINCredential",
    "reference_number": "27AABCU9603R1Z5",
    "file_path": null,
    "required": false
  }
]
```

**Supported document types → VC types:**

| Document | `vc_type` | Required |
|----------|-----------|----------|
| MCA Registration Certificate | `MCARegistration` | Yes |
| GSTIN Certificate | `GSTINCredential` | No |
| IEC (Import Export Code) | `IECCredential` | No |
| PAN | `PANCredential` | No |

---

## 2. File Upload

Add `multer` for multipart form handling:

```bash
npm install multer @types/multer
```

- Upload destination: `uploads/corporate-docs/` (created at startup if missing)
- File naming: `${Date.now()}-${originalname}` (no spaces)
- Allowed types: PDF, JPG, PNG (max 5 MB per file)
- Serve static: `app.use('/uploads', express.static('uploads'))`

---

## 3. API Changes

### 3a. Public: `GET /api/public/did-issuers`
Returns all active DID issuers for the landing page issuer strip and the Portal Manager assignment dropdown.

```typescript
SELECT u.id, u.name, u.email
FROM users u
WHERE u.role = 'government_agency'
  AND u.sub_role = 'did_issuer_admin'
ORDER BY u.name
```

No auth required.

### 3b. Update: `POST /api/organizations/apply`
Change to `multipart/form-data` (multer middleware). Accept new fields alongside existing ones:

- `super_admin_name`, `super_admin_email` — required
- `requester_name`, `requester_email` — required
- `documents` — JSON string array (serialised `documents` array without `file_path`)
- `doc_MCARegistration`, `doc_GSTINCredential`, `doc_IECCredential`, `doc_PANCredential` — optional file fields

**Logic:**
1. Validate required fields (existing) + new required fields
2. Parse `documents` JSON, attach `file_path` from uploaded files
3. INSERT with new columns; existing columns that are no longer required (aadhaar, din, etc.) may be empty strings (keep schema compatibility)

### 3c. New: `GET /api/portal/corporate-applications`
Auth: portal_manager role. Returns applications with `application_status IN ('pending','activated','issued','rejected')`, joined with assigned issuer name.

### 3d. New: `POST /api/portal/corporate-applications/:id/activate`
Auth: portal_manager role.

Body: `{ assigned_issuer_id: string }`

- Validates issuer is a `did_issuer_admin`
- Sets `application_status = 'activated'`, `assigned_issuer_id`

### 3e. New: `POST /api/portal/corporate-applications/:id/reject`
Auth: portal_manager role.

Body: `{ rejection_reason?: string }`

Sets `application_status = 'rejected'`, `rejection_reason`.

### 3f. New: `GET /api/did-issuer/corporate-applications`
Auth: government_agency + did_issuer_admin. Returns applications where `assigned_issuer_id = user.id` and `application_status = 'activated'`.

### 3g. New: `POST /api/did-issuer/corporate-applications/:id/issue`
Auth: government_agency + did_issuer_admin. The core issuance action.

Body: `{ vc_types: string[] }` — which VCs to issue (subset of the documents' vc_types)

**Steps (in a DB transaction):**
1. Load application; verify `application_status = 'activated'` and `assigned_issuer_id = user.id`
2. Create super_admin user: `INSERT INTO users (email, password_hash, role, name, sub_role) VALUES (super_admin_email, hash, 'corporate', company_name, 'super_admin')` — generate temp password
3. Set `org_id = superAdminId` on super_admin (self-owns the org scope — mirrors existing corporate user pattern)
4. Create corporate parent DID via `createAndStoreDID(superAdminId, 'parent', undefined, slug)`
5. Create requester user: `INSERT INTO users (..., sub_role='requester', org_id=superAdminId)`
6. For each `vc_type` in `vc_types`:
   - Build VC JSON using existing `buildDIAVC` pattern (or equivalent), issuer = DID Issuer's DID, holder = corporate parent DID
   - `INSERT INTO credentials (vc_json, holder_did_id, issuer_did_id, credential_type, issued_at, expires_at)` — `issued_at = NOW()`, `expires_at = NOW() + INTERVAL '1 year'` (same pattern as existing credential issuance)
7. Set `application_status = 'issued'`, `corporate_user_id = superAdminId`
8. Log temp passwords (email integration future scope): `console.log([ISSUED] super_admin: email | password: xxx | requester: email | password: xxx)`

---

## 4. Frontend Changes

### 4a. `src/frontend/pages/Dashboard.tsx` — Landing Page Redesign

Replace the current 3-card layout with a full marketing page:

**Sections (top to bottom):**

1. **Top nav bar** — dark (`#0f172a`): logo left, "Login" link + "Register Corporate →" button right
2. **Hero section** — dark gradient (`#1e3a5f` → `#0f172a`):
   - Small label: "INDIA'S DECENTRALISED IDENTITY NETWORK"
   - Headline: "Verifiable Credentials for Indian Enterprises"
   - Subline: "Issue · Verify · Share"
   - CTA button → navigates to `/signup` (the existing `OrganizationApplyPage` route)
3. **DID Issuers strip** — light (`#f8fafc`): "Trusted DID Issuers" label, then issuer name pills loaded from `GET /api/public/did-issuers`
4. **How it works** — white: 4 icon-steps: Register → Portal Review → Get DID → Get VCs
5. **Role cards** — light: three cards (Corporate, Govt Issuer, Verifier) with brief descriptions
6. **Footer** — dark: platform name

### 4b. `src/frontend/pages/OrganizationApplyPage.tsx` — 4-Step Wizard

Replace the current flat form with a 4-step wizard. Progress bar (4 segments) at top. All existing fields preserved but reorganised.

**Step 1 — Company Information:**
- Company Name (`org_name`) *
- CIN (`cin`) *
- PAN (`pan_number`) *
- GSTIN (`gstn`) optional
- Registered Address: State (`state`) *, Pincode (`pincode`) *
- Date of Incorporation (`date_of_incorporation`) *

**Step 2 — Key People:**
- Super Admin panel (blue): Full Name (`super_admin_name`) *, Email (`super_admin_email`) *
- Corporate Requester panel (green): Full Name (`requester_name`) *, Email (`requester_email`) *
- Director Info (collapsed/secondary): `director_full_name`, `din`, `designation` (kept for existing schema compatibility)

**Step 3 — Supporting Documents:**
- Four document blocks: MCA Registration (required), GSTIN Certificate, IEC Certificate, PAN Card
- Each block: reference number text field + drag-and-drop file upload (PDF/image, max 5 MB)
- MCA block shows "REQUIRED" badge; others show "OPTIONAL"
- Note: "Each uploaded document generates one Verifiable Credential on approval"

**Step 4 — Review & Submit:**
- Summary cards: company details, key people, documents with file names and VC types to be issued
- Amber info box: "After submission: Portal Manager reviews → DID Issuer issues your corporate DID + credentials → login details sent by email"
- Submit calls `POST /api/organizations/apply` as `multipart/form-data`
- On success: show confirmation screen (application ID, "We'll email you when your DID is ready")

### 4c. `src/frontend/pages/PortalManagerDashboard.tsx` — Applications Tab

Add a new "Applications" tab (`tab === 'applications'`):

- Nav item: `{ tab: 'applications', label: 'Corp Applications', icon: '🏢' }`
- Loads from `GET /api/portal/corporate-applications`
- Each card shows: company name, CIN, super_admin email, requester email, submitted date, status badge
- Expandable: documents list with file download links (`/uploads/corporate-docs/…`)
- For `pending` applications:
  - Dropdown to assign DID Issuer (populated from `GET /api/public/did-issuers`)
  - "✓ Activate & Assign" button → `POST /api/portal/corporate-applications/:id/activate`
  - "✗ Reject" button → `POST /api/portal/corporate-applications/:id/reject`
- For `activated`/`issued`/`rejected`: read-only status display

### 4d. `src/frontend/pages/AuthorityDashboard.tsx` — Corporate Applications Tab

For users with `role = 'government_agency'` and `sub_role = 'did_issuer_admin'`, add a "Corporate Applications" tab:

- Nav item: `{ tab: 'corp-applications', label: 'Corp Applications', icon: '🏢' }`  
- Loads from `GET /api/did-issuer/corporate-applications`
- Each card shows: company name, CIN, super_admin email, documents
- Documents panel: each document row shows vc_type, reference number, file link, checkbox (pre-checked)
- DID preview: `did:web:didvc.platform:{slug}` (computed from company name)
- Amber warning box: "Clicking Issue will create corporate accounts, DID, and selected VCs, and log temp passwords"
- "🔑 Issue DID + Credentials →" button → `POST /api/did-issuer/corporate-applications/:id/issue`
- On success: card shows "ISSUED" badge with timestamp

### 4e. `src/frontend/components/AppShell.tsx` — Nav item for did_issuer_admin

When the logged-in user has `role === 'government_agency'` and `sub_role === 'did_issuer_admin'`, add a "Corp Applications" nav item that routes to `AuthorityDashboard` with `tab='corp-applications'`. This ensures the tab is reachable from the sidebar without requiring the user to know to click a tab.

No separate route needed — `AuthorityDashboard` already handles tab switching via props or state; the nav item simply deep-links to that tab by passing `?tab=corp-applications` or equivalent (match the existing tab switching pattern in the codebase).

---

## 5. VC Storage (Corporate Wallet + My Credentials)

VCs issued via `POST /api/did-issuer/corporate-applications/:id/issue` are stored in the `credentials` table with:
- `holder_did_id` = corporate parent DID id
- `issuer_did_id` = DID Issuer's parent DID id

Since the super_admin user owns the corporate parent DID (`dids.user_id = super_admin.id`), these credentials automatically appear in:
- **Corporate Wallet** tab (`GET /api/credentials/my` filtered to parent DID) 
- **My Credentials** tab (same endpoint, same DID)

No additional plumbing needed — the existing credential query already picks them up.

---

## 6. Security

- `POST /api/organizations/apply` — public (no auth), rate-limit by IP (existing pattern)
- `GET /api/public/did-issuers` — public, read-only
- Portal Manager endpoints — `requireRole('portal_manager')`
- DID Issuer endpoints — `requireRole('government_agency')` + `sub_role = 'did_issuer_admin'` check
- Uploaded files served at `/uploads/…` — accessible only via direct URL (no directory listing); Portal Manager and DID Issuer see the links from the application records
- Temp passwords logged to server console only (`console.log`) — email delivery is future scope

---

## 7. Files to Modify

| File | Change |
|------|--------|
| `src/db/schema.sql` | ADD COLUMN migrations for `organization_applications` |
| `src/server/index.ts` | Add multer setup, 5 new endpoints, update `POST /api/organizations/apply`, add `GET /api/public/did-issuers` |
| `src/frontend/pages/Dashboard.tsx` | Full landing page redesign |
| `src/frontend/pages/OrganizationApplyPage.tsx` | Replace flat form with 4-step wizard |
| `src/frontend/pages/PortalManagerDashboard.tsx` | Add Corp Applications tab |
| `src/frontend/pages/AuthorityDashboard.tsx` | Add Corp Applications tab for did_issuer_admin |
| `src/frontend/components/AppShell.tsx` | Add Corp Applications nav item for did_issuer_admin |
| `package.json` | Add `multer` + `@types/multer` |
