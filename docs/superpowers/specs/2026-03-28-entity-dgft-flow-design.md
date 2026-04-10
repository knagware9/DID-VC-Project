# Identity and Trust Stack — Entity Registration & DGFT Authorization Flow

**Date:** 2026-03-28
**Scope:** Phase 1 of the Identity and Trust Stack PDF workflow (slides 1–15)
**Standards:** W3C DID Core 1.0, W3C Verifiable Credentials Data Model 1.1

---

## Context

The current DID-VC platform allows any user to self-register as `corporate`, `government_agency`, or `verifier`. This does not match the required Identity and Trust Stack workflow, which mandates that corporate entities (importers/exporters) must:

1. Submit a formal application with Indian regulatory identifiers (CIN, PAN, GSTN, IE Code).
2. Have DGFT (Director General of Foreign Trade) verify each identifier and approve the entity.
3. Receive login credentials by email only after DGFT approval.
4. On first login, see a Corporate Wallet containing their verified identity credentials as W3C VCs.

This design covers the full entity registration + DGFT authorization + Corporate Wallet display flow.

---

## Architecture

### Approach: Approach B — Replace corporate registration + upgrade DGFT dashboard

- The `corporate` option is removed from the existing `/register` page (DGFT and Verifier still self-register there).
- New public `/signup` page replaces corporate self-registration with a proper multi-step application form.
- The existing `GovtIssuerDashboard` is replaced by a new `AuthorityDashboard` that handles org applications.
- A separate `/authority-login` page is added for DGFT users (cleaner separation, matches PDF).
- Corporate Wallet is added as a new tab in `CorporateDashboard`.

---

## Data Model

### New Table: `organization_applications`

```sql
CREATE TABLE IF NOT EXISTS organization_applications (
  id                      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  -- Organization info
  org_name                VARCHAR(255) NOT NULL,
  email                   VARCHAR(255) NOT NULL,
  org_logo_url            TEXT,
  -- Individual (Director) details
  director_full_name      VARCHAR(255) NOT NULL,
  aadhaar_number          VARCHAR(12) NOT NULL,
  dob                     DATE NOT NULL,
  gender                  VARCHAR(20) NOT NULL,
  state                   VARCHAR(100) NOT NULL,
  pincode                 VARCHAR(10) NOT NULL,
  -- Company details
  company_name            VARCHAR(255) NOT NULL,
  cin                     VARCHAR(21) NOT NULL,   -- L51100GJ1993PLC019067
  company_status          VARCHAR(50) NOT NULL,
  company_category        VARCHAR(100) NOT NULL,
  date_of_incorporation   DATE NOT NULL,
  pan_number              VARCHAR(10) NOT NULL,   -- ABCDE1234F
  gstn                    VARCHAR(15) NOT NULL,   -- 27ABCDE1234F2Z5
  ie_code                 VARCHAR(10) NOT NULL,   -- ABCDE1234F
  -- Director details
  director_name           VARCHAR(255) NOT NULL,
  din                     VARCHAR(20) NOT NULL,
  designation             VARCHAR(100) NOT NULL,
  signing_authority_level VARCHAR(100) DEFAULT 'Single Signatory',
  -- DGFT verification state
  field_verifications     JSONB NOT NULL DEFAULT '{"cin":false,"pan":false,"gstn":false,"ie_code":false}',
  -- Application lifecycle
  application_status      VARCHAR(20) NOT NULL DEFAULT 'pending'
                          CHECK (application_status IN ('pending', 'approved', 'rejected')),
  rejection_reason        TEXT,
  user_id                 UUID REFERENCES users(id),  -- populated on approval
  created_at              TIMESTAMPTZ DEFAULT NOW(),
  updated_at              TIMESTAMPTZ DEFAULT NOW()
);
```

### W3C Verifiable Credential — `OrganizationIdentityCredential`

Issued by DGFT upon approval and stored in the existing `credentials` table as `vc_json`:

```json
{
  "@context": [
    "https://www.w3.org/2018/credentials/v1"
  ],
  "id": "urn:uuid:{uuid}",
  "type": ["VerifiableCredential", "OrganizationIdentityCredential"],
  "issuer": "did:web:didvc.platform:dgft",
  "issuanceDate": "2026-03-11T00:00:00Z",
  "credentialSubject": {
    "id": "{corporate_DID}",
    "companyName": "LNT Exim Private Limited",
    "cin": "L51100GJ1993PLC019067",
    "pan": "ABCDE1234F",
    "gstn": "27ABCDE1234F2Z5",
    "ieCode": "ABCDE1234F",
    "digitalIdentityAnchor": "ABCDE1234F"
  },
  "proof": {
    "type": "EcdsaSecp256k1Signature2019",
    "created": "2026-03-11T00:00:00Z",
    "verificationMethod": "did:web:didvc.platform:dgft#keys-1",
    "proofPurpose": "assertionMethod",
    "jws": "..."
  }
}
```

`digitalIdentityAnchor` is set to the IE Code value — this field marks the IE Code as the Digital Identity Anchor (DIA) for trade operations.

---

## Backend Routes

### New Routes (server/index.ts)

```
POST /api/organizations/apply
  Public. Body: { org_name, email, org_logo_url?, director_full_name, aadhaar_number,
                  dob, gender, state, pincode, company_name, cin, company_status,
                  company_category, date_of_incorporation, pan_number, gstn, ie_code,
                  director_name, din, designation, signing_authority_level? }
  Response: { success: true, applicationId }

GET  /api/authority/organizations?status=pending|approved|rejected
  Auth: government_agency role.
  Response: { organizations: [...], stats: { pending, approved, rejected, total } }

GET  /api/authority/organizations/:id
  Auth: government_agency role.
  Response: { organization: {...full fields including field_verifications} }

POST /api/authority/organizations/:id/verify-field
  Auth: government_agency role.
  Body: { field: 'cin'|'pan'|'gstn'|'ie_code', verified: boolean }
  Response: { success: true, field_verifications: {...} }

POST /api/authority/organizations/:id/approve
  Auth: government_agency role.
  Requires: all 4 field_verifications must be true.
  Actions:
    1. Creates users record (role: corporate, temp password generated)
    2. Creates parent DID for the new corporate user
    3. Issues OrganizationIdentityVC (DGFT signs, stores in credentials table)
    4. Sends approval email with login credentials (temp password: `crypto.randomBytes(8).toString('hex')`, 16 chars; uses nodemailer or logs to console in demo mode)
    5. Updates application_status = 'approved', sets user_id
    6. Anchors VC hash on Polygon (async)
  Response: { success: true, userId, did, vcId }

POST /api/authority/organizations/:id/reject
  Auth: government_agency role.
  Body: { reason: string }
  Response: { success: true }
```

### Modified Routes

- `POST /api/auth/register` — remove `corporate` from allowed roles (keep `government_agency`, `verifier`)

---

## Frontend Changes

### Critical Files to Modify

| File | Change |
|---|---|
| `src/frontend/App.tsx` | Add routes: `/signup`, `/authority-login`, `/authority/dashboard`; remove corporate from register; redirect `/issuer/dashboard` to `/authority/dashboard` |
| `src/frontend/pages/RegisterPage.tsx` | Remove `corporate` role option |
| `src/frontend/pages/GovtIssuerDashboard.tsx` | Replace file content: export `AuthorityDashboard` directly (file kept to avoid import breakage) |
| `src/frontend/pages/CorporateDashboard.tsx` | Add `corp-wallet` tab to `Tab` type; add wallet loading logic and render section |

### New Files to Create

| File | Purpose |
|---|---|
| `src/frontend/pages/OrganizationApplyPage.tsx` | Public multi-step application form |
| `src/frontend/pages/AuthorityLoginPage.tsx` | DGFT-specific login page |
| `src/frontend/pages/AuthorityDashboard.tsx` | Full DGFT authority portal (replaces GovtIssuerDashboard) |

---

## UI Component Details

### OrganizationApplyPage (`/signup`)

Three sections in a single scrollable form:

**Section 1 — Organization Information**
- Organization Name* (text)
- Email* (email)
- Organization Logo (file, optional)

**Section 2 — Individual Details**
- Full Name* (text)
- Aadhaar Number* (text, 12-digit hint)
- Date of Birth* (date, dd-mm-yyyy)
- Gender* (select: Male/Female/Other)
- State* (text)
- Pincode* (text)

**Section 3 — Company Details**
- Company Name* (text)
- CIN* (text, placeholder: `L51100GJ1993PLC019067`)
- Company Status* (select: Active/Inactive)
- Company Category* (select: Private Limited/Public Limited/LLP/etc.)
- Date of Incorporation* (date)
- PAN Number* (text, placeholder: `ABCDE1234F`) — replaces "Authorized Capital"
- GSTN* (text, placeholder: `27ABCDE1234F2Z5`) — replaces "Paid Up Capital"
- IE Code* (text, placeholder: `ABCDE1234F`) — new field
- Director Name* (text)
- DIN* (text, Director ID Number)
- Designation* (text)

Format hint displayed below each regulatory field showing expected format.

Submit → `POST /api/organizations/apply` → success banner.

### AuthorityLoginPage (`/authority-login`)

- Header: "Token Layer — Authority Login Portal"
- DGFT badge prefixed to email input (visual, not functional — same auth endpoint)
- Password field
- Sign In button → POST `/api/auth/login` with role check → redirect to `/authority/dashboard`

### AuthorityDashboard (`/authority/dashboard`)

**Layout:** Left sidebar + main content (matches PDF slides 6–10)

**Left sidebar:**
- Dashboard (active: stats page)
- Pending Requests

**Dashboard view (stats):**
- 4 stat cards: Pending Requests, Approved, Rejected, Total Organizations
- Profile Information: Name, Email, Role, Status

**Pending Requests view:**
- Search bar (by organization name)
- Stats row: Total Pending, This Week, Awaiting Action
- Table columns: Organization | Director | CIN | Applied Date | Authority (DGFT badge) | Status | Actions
- Actions: Approve / Reject / View Details buttons

**View Details Modal:**
- Section: Individual Details (Full Name, Aadhaar Number, DOB, Gender, State, Pincode)
- Section: Company Details (Company Name, CIN, Status, Category, Date of Incorporation, PAN, GSTN — with "Authorized Capital" label removed)
- Section: Director Details (Director Name, DIN, Designation, Signing Authority Level)
- Section: Application Status (status badge, Created Date, Updated Date)
- Section: Authority Approvals — **only DGFT row** (no MCA, no UIDAI)
- Section: DGFT Verification Checkboxes:
  - `[ ] CIN (L51100GJ1993PLC019067)` → on check: shows "Verified" green badge
  - `[ ] PAN Number (ABCDE1234F)` → on check: shows "Verified" green badge
  - `[ ] GSTN (27ABCDE1234F2Z5)` → on check: shows "Verified" green badge
  - `[ ] IE Code (ABCDE1234F)` → on check: shows "Verified" green badge
  - Each checkbox click → `POST /api/authority/organizations/:id/verify-field`
- Approve button: **disabled** until all 4 checkboxes checked
- Reject button: always enabled (opens reason input)

**On Approve Success:**
- "Organization Approved!" modal (slide 10):
  - Company name
  - Green checkmark
  - "Credentials sent to registered corporate email"
  - "API Key and Access Token generated"
  - "Portal access enabled"
  - Done button

### CorporateDashboard — "Corp Wallet" Tab

New tab added to existing `Tab` type: `'corp-wallet'`

On load: fetch credentials filtered by `credential_type = 'OrganizationIdentityCredential'` (matches the `credential_type` column set when the credential is stored in the `credentials` table during DGFT approval)

Display: Verified Credential section with 4 row cards (matching PDF slide 15):

```
┌─────────────────── Verified Credential ──────────────────┐
│ CIN   - L51100GJ1993PLC019067                           │
│ PAN   - ABCDE1234F                                      │
│ GSTN  - 27ABCDE1234F2Z5                                 │
│ IE Code ABCDE1234F                     [DIA]            │
└──────────────────────────────────────────────────────────┘
```

Each row shows the field name, value, and a "Verified Credential" badge.
IE Code row additionally shows a red "DIA" badge (Digital Identity Anchor).

---

## Error Handling

- Duplicate CIN on application: `400 { error: 'An application with this CIN already exists' }`
- Approve without all 4 checked: `400 { error: 'All 4 fields must be verified before approval' }`
- DGFT issues VC using their own DID private key (existing `createAndStoreDID` + signing logic)
- Email send failure on approval: log error, do not fail the approval (credentials shown in success modal)

---

## Verification (Test Plan)

1. **Org application submit:** Navigate to `/signup`, fill all fields, submit → see success message. Check `organization_applications` table has one `pending` row.
2. **DGFT login:** Go to `/authority-login`, log in as DGFT user → redirected to `/authority/dashboard`. Stats card shows 1 Pending.
3. **View Details:** Click "View Details" on the application → modal opens with all fields. Checkboxes show unchecked. Approve button is disabled.
4. **Field verification:** Check all 4 checkboxes one by one → each shows "Verified" badge. After all 4 checked, Approve button becomes enabled.
5. **Approve:** Click Approve → "Organization Approved!" modal. Check `users` table has new corporate user. Check `credentials` table has `OrganizationIdentityVC`. Check email sent (mailinator/logs).
6. **Corporate login:** Use credentials from email to log in at `/login` → directed to `CorporateDashboard`.
7. **Corp Wallet:** Click "Corp Wallet" tab → displays CIN, PAN, GSTN, IE Code cards with Verified Credential badges. IE Code shows DIA badge.
8. **W3C VC format:** View raw credential JSON → confirms `@context`, `type`, `issuer`, `credentialSubject.id`, `proof` fields present.

---

## Files Modified / Created Summary

```
MODIFIED:
  src/db/schema.sql                          — add organization_applications table
  src/server/index.ts                        — add 5 new routes, modify /api/auth/register
  src/frontend/App.tsx                       — add /signup, /authority-login, /authority/dashboard routes
  src/frontend/pages/RegisterPage.tsx        — remove 'corporate' role option
  src/frontend/pages/GovtIssuerDashboard.tsx — replace with redirect or full redesign
  src/frontend/pages/CorporateDashboard.tsx  — add corp-wallet tab

CREATED:
  src/frontend/pages/OrganizationApplyPage.tsx
  src/frontend/pages/AuthorityLoginPage.tsx
  src/frontend/pages/AuthorityDashboard.tsx
```
