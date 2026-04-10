# Multi-Authority Trust Stack — Design Spec

**Date:** 2026-04-02
**Source:** DID Application flow ver 1.0 A1 (meeting dates 30/3 – 2/4/2026)
**Scope:** Phase 2 — Expand from single-authority DGFT onboarding to 4-authority DIA issuance

---

## Overview

The current system issues a single `OrganizationIdentityCredential` via DGFT containing CIN, PAN, GSTN, and IE Code in one VC. The reference architecture defines four independent issuing authorities — each owns exactly one DIA (Decentralized Identity Attestation). This spec redesigns the authority layer so each of the four authorities registers independently, verifies only their domain field(s), and issues their own cryptographically-signed DIA VC.

**End state**: A corporate wallet shows 4 DIA cards — one per authority — each with its own issuer badge, anchor field, and verification status. Trust score = number of DIAs received (0–4).

---

## Stakeholders and Roles (from PDF)

### Authority Hierarchy

| Level | Actor | Role |
|---|---|---|
| 1 | **MCA** (Ministry of Corporate Affairs) | Government Authority — issues Company Registration VC (DIA1) |
| 1 | **DGFT** (Directorate General of Foreign Trade) | Government Authority — issues IEC VC (DIA2) |
| 2 | **GSTN** (Goods and Services Tax Network) | Trust Anchor / Endorser — issues GSTIN VC (DIA3) |
| 2 | **Income Tax / PAN** | Trust Anchor / Endorser — issues PAN VC (DIA4) |
| 3 | **Corporate** | Identity holder and sub-issuer for employee Sub-DIDs |
| 4 | **Employee/Member** | Holds Sub-DIDs derived from Corporate DID |

### Portal Roles (current system maps to subset)

| Role | System Role | Description |
|---|---|---|
| Authority Officer | `government_agency` | Registers with an `authority_type`, verifies and approves applications |
| Corporate Requester | (public) | Submits the onboarding application form |
| Authorized Signatory | `corporate` | Receives DIDs and VCs on approval |
| Verifier | `verifier` | Requests and verifies Verifiable Presentations |

> **Future scope:** Maker/Checker pattern, Portal Manager, DID Issuer Admin, VC Issuer Admin roles are defined in the PDF but deferred to Phase 3 (Role Hierarchy).

---

## Architecture

### Authority Type Field

Add `authority_type VARCHAR(30)` to the `users` table:

```sql
ALTER TABLE users
  ADD COLUMN authority_type VARCHAR(30)
  CHECK (authority_type IN ('mca', 'dgft', 'gstn_trust_anchor', 'pan_trust_anchor'));
```

- `NULL` for `corporate` and `verifier` roles
- Required when `role = 'government_agency'`
- Existing DGFT users migrated: `UPDATE users SET authority_type = 'dgft' WHERE role = 'government_agency'`

### Authority Routing

All authority officers use `role = 'government_agency'`. Portal URL is shared (`/authority/dashboard`). The dashboard reads `user.authority_type` to scope its view and actions.

```
MCA officer     → registers as government_agency / authority_type=mca
DGFT officer    → registers as government_agency / authority_type=dgft
GSTN officer    → registers as government_agency / authority_type=gstn_trust_anchor
PAN officer     → registers as government_agency / authority_type=pan_trust_anchor
```

---

## Data Model Changes

### 1. `users` table

```sql
ALTER TABLE users
  ADD COLUMN authority_type VARCHAR(30)
  CHECK (authority_type IN ('mca', 'dgft', 'gstn_trust_anchor', 'pan_trust_anchor'));

-- Migrate existing DGFT users
UPDATE users SET authority_type = 'dgft' WHERE role = 'government_agency';
```

### 2. `organization_applications` table

Replace `field_verifications JSONB` with `authority_verifications JSONB`:

```sql
ALTER TABLE organization_applications
  RENAME COLUMN field_verifications TO authority_verifications;

-- Reset to new structure for pending applications
UPDATE organization_applications
  SET authority_verifications = '{
    "mca":  {"status":"pending","verified_cin":false,"verified_company_name":false,"vc_id":null},
    "dgft": {"status":"pending","verified_ie_code":false,"vc_id":null},
    "gstn": {"status":"pending","verified_gstn":false,"vc_id":null},
    "pan":  {"status":"pending","verified_pan":false,"vc_id":null}
  }'::jsonb
  WHERE application_status = 'pending';
```

`application_status` CHECK constraint updated:

```sql
ALTER TABLE organization_applications
  DROP CONSTRAINT organization_applications_application_status_check,
  ADD CONSTRAINT organization_applications_application_status_check
    CHECK (application_status IN ('pending', 'partial', 'complete', 'rejected'));
```

Status transitions:
- `pending` → initial state, no authority has approved
- `partial` → ≥1 authority approved (some DIAs issued, corporate account may already be created)
- `complete` → all 4 authorities approved (all DIAs issued)
- `rejected` → any authority rejected

> **Corporate user creation** happens on the FIRST authority approval (moves to `partial`). Subsequent approvals just add VCs to the existing user.

### 3. New W3C VC Types

Four new credential types replacing `OrganizationIdentityCredential`:

#### DIA1 — `CompanyRegistrationCredential` (issued by MCA)
```json
{
  "@context": ["https://www.w3.org/2018/credentials/v1"],
  "type": ["VerifiableCredential", "CompanyRegistrationCredential"],
  "issuer": "<mca_officer_did>",
  "credentialSubject": {
    "id": "<corporate_did>",
    "companyName": "...",
    "cin": "...",
    "companyStatus": "Active",
    "companyCategory": "Private Limited",
    "dateOfIncorporation": "...",
    "directorName": "...",
    "din": "...",
    "digitalIdentityAnchor": "<cin>"
  },
  "proof": { "type": "EcdsaSecp256k1Signature2019", ... }
}
```

#### DIA2 — `IECCredential` (issued by DGFT)
```json
{
  "type": ["VerifiableCredential", "IECCredential"],
  "issuer": "<dgft_officer_did>",
  "credentialSubject": {
    "id": "<corporate_did>",
    "companyName": "...",
    "ieCode": "...",
    "digitalIdentityAnchor": "<ieCode>"
  }
}
```

#### DIA3 — `GSTINCredential` (issued by GSTN Trust Anchor)
```json
{
  "type": ["VerifiableCredential", "GSTINCredential"],
  "issuer": "<gstn_officer_did>",
  "credentialSubject": {
    "id": "<corporate_did>",
    "companyName": "...",
    "gstin": "...",
    "digitalIdentityAnchor": "<gstin>"
  }
}
```

#### DIA4 — `PANCredential` (issued by Income Tax Trust Anchor)
```json
{
  "type": ["VerifiableCredential", "PANCredential"],
  "issuer": "<pan_officer_did>",
  "credentialSubject": {
    "id": "<corporate_did>",
    "companyName": "...",
    "pan": "...",
    "digitalIdentityAnchor": "<pan>"
  }
}
```

---

## Backend Route Changes

### Updated: POST /api/auth/register

Add `authority_type` field to registration body. Required when `role = 'government_agency'`:

```typescript
// Validation addition:
if (role === 'government_agency' && !authority_type) {
  return res.status(400).json({ error: 'authority_type is required for government_agency role' });
}
const validAuthorityTypes = ['mca', 'dgft', 'gstn_trust_anchor', 'pan_trust_anchor'];
if (authority_type && !validAuthorityTypes.includes(authority_type)) {
  return res.status(400).json({ error: 'Invalid authority_type' });
}
// Insert includes authority_type column
```

### Updated: GET /api/authority/organizations

Now scopes results to calling authority's pending slot:

```typescript
// Filter: applications where authority_verifications[authority_type].status = 'pending'
const rows = await query(
  `SELECT * FROM organization_applications
   WHERE authority_verifications->$1->>'status' = $2
   ORDER BY created_at DESC`,
  [authorityType, status || 'pending']
);
```

Stats scoped per authority:
```typescript
const stats = await query(
  `SELECT
    COUNT(*) FILTER (WHERE authority_verifications->$1->>'status'='pending') AS pending,
    COUNT(*) FILTER (WHERE authority_verifications->$1->>'status'='approved') AS approved,
    COUNT(*) FILTER (WHERE authority_verifications->$1->>'status'='rejected') AS rejected,
    COUNT(*) AS total
   FROM organization_applications`,
  [authorityType]
);
```

### Updated: POST /api/authority/organizations/:id/verify-field

Validates field belongs to calling authority's domain:

```typescript
const fieldsByAuthority: Record<string, string[]> = {
  mca:                ['cin', 'company_name'],
  dgft:               ['ie_code'],
  gstn_trust_anchor:  ['gstn'],
  pan_trust_anchor:   ['pan'],
};
const allowed = fieldsByAuthority[authorityType] || [];
if (!allowed.includes(field)) {
  return res.status(400).json({ error: `Field '${field}' is not in ${authorityType} scope` });
}
// Update authority_verifications[authorityType][`verified_${field}`] = verified
await query(
  `UPDATE organization_applications
   SET authority_verifications = jsonb_set(
     authority_verifications,
     $1,
     $2
   ), updated_at = NOW()
   WHERE id = $3`,
  [`{${authorityType},verified_${field}}`, JSON.stringify(verified), req.params.id]
);
```

### Updated: POST /api/authority/organizations/:id/approve

Each authority approves independently. Issues only their DIA VC.

```typescript
// Check all this authority's fields are verified
const authVerif = org.authority_verifications[authorityType];
const allVerified = Object.entries(authVerif)
  .filter(([k]) => k.startsWith('verified_'))
  .every(([, v]) => v === true);
if (!allVerified) {
  return res.status(400).json({ error: `All ${authorityType} fields must be verified before approval` });
}

// Create corporate user only on FIRST authority approval
let userId = org.user_id;
let didData: { did: string; id: string } | null = null;
if (!userId) {
  // First approval — create user + DID
  const tempPassword = crypto.randomBytes(8).toString('hex');
  const passwordHash = await hashPassword(tempPassword);
  const userResult = await query(
    'INSERT INTO users (email, password_hash, role, name) VALUES ($1, $2, $3, $4) RETURNING id',
    [org.email, passwordHash, 'corporate', org.company_name]
  );
  userId = userResult.rows[0].id;
  const slug = org.company_name.toLowerCase().replace(/[^a-z0-9]/g, '-');
  didData = await createAndStoreDID(userId, 'parent', undefined, slug);
  // Log temp password
  console.log(`[APPROVAL EMAIL] To: ${org.email} | Temp Password: ${tempPassword}`);
} else {
  // Subsequent approval — look up existing DID
  const didResult = await query('SELECT did_string AS did, id FROM dids WHERE user_id = $1 AND did_type = $2', [userId, 'parent']);
  didData = didResult.rows[0];
}

// Build DIA VC for this authority
const vc = buildDIAVC(authorityType, org, issuerDid, didData.did);

// Store VC
const credResult = await query(
  'INSERT INTO credentials (vc_json, holder_did_id, issuer_did_id, credential_type, issued_at, expires_at) VALUES ($1,$2,$3,$4,$5,$6) RETURNING id',
  [JSON.stringify(vc), holderDidId, issuerDid.id, diaCredentialType(authorityType), now, expiresAt]
);

// Update authority slot + application status
const allApproved = checkAllAuthoritiesApproved(updatedVerifications);
const newStatus = allApproved ? 'complete' : 'partial';
await query(
  `UPDATE organization_applications
   SET authority_verifications = jsonb_set(
     jsonb_set(authority_verifications, $1, $2),
     $3, $4
   ), application_status = $5, user_id = $6, updated_at = NOW()
   WHERE id = $7`,
  [
    `{${authorityType},status}`, '"approved"',
    `{${authorityType},vc_id}`, JSON.stringify(credResult.rows[0].id),
    newStatus, userId, req.params.id
  ]
);

// Polygon anchor (async)
polygonService.anchorVC(credResult.rows[0].id, vc, issuerDid.did_string, didData.did, diaCredentialType(authorityType), expiresAt)
  .catch(err => console.error('[Polygon] VC anchor failed:', err.message));

res.json({ success: true, userId, did: didData.did, vcId: credResult.rows[0].id });
```

#### Helper: `buildDIAVC(authorityType, org, issuerDid, holderDid)`

```typescript
function buildDIAVC(authorityType: string, org: any, issuerDid: any, holderDid: string) {
  const vcId = crypto.randomUUID();
  const now = new Date();
  const base = {
    '@context': ['https://www.w3.org/2018/credentials/v1'],
    id: `urn:uuid:${vcId}`,
    issuer: issuerDid.did_string,
    issuanceDate: now.toISOString(),
    proof: {
      type: 'EcdsaSecp256k1Signature2019',
      created: now.toISOString(),
      verificationMethod: `${issuerDid.did_string}#keys-1`,
      proofPurpose: 'assertionMethod',
      jws: crypto.createHmac('sha256', issuerDid.private_key_encrypted)
        .update(JSON.stringify({ id: `urn:uuid:${vcId}`, holderDid }))
        .digest('hex'),
    },
  };
  const subjectMap: Record<string, object> = {
    mca: {
      type: ['VerifiableCredential', 'CompanyRegistrationCredential'],
      credentialSubject: {
        id: holderDid, companyName: org.company_name, cin: org.cin,
        companyStatus: org.company_status, companyCategory: org.company_category,
        dateOfIncorporation: org.date_of_incorporation,
        directorName: org.director_name, din: org.din, digitalIdentityAnchor: org.cin,
      },
    },
    dgft: {
      type: ['VerifiableCredential', 'IECCredential'],
      credentialSubject: { id: holderDid, companyName: org.company_name, ieCode: org.ie_code, digitalIdentityAnchor: org.ie_code },
    },
    gstn_trust_anchor: {
      type: ['VerifiableCredential', 'GSTINCredential'],
      credentialSubject: { id: holderDid, companyName: org.company_name, gstin: org.gstn, digitalIdentityAnchor: org.gstn },
    },
    pan_trust_anchor: {
      type: ['VerifiableCredential', 'PANCredential'],
      credentialSubject: { id: holderDid, companyName: org.company_name, pan: org.pan_number, digitalIdentityAnchor: org.pan_number },
    },
  };
  return { ...base, ...subjectMap[authorityType] };
}

function diaCredentialType(authorityType: string): string {
  const map: Record<string, string> = {
    mca: 'CompanyRegistrationCredential',
    dgft: 'IECCredential',
    gstn_trust_anchor: 'GSTINCredential',
    pan_trust_anchor: 'PANCredential',
  };
  return map[authorityType];
}
```

---

## Frontend Changes

### RegisterPage.tsx

Add authority type selector, shown only when `government_agency` role is selected:

```tsx
{form.role === 'government_agency' && (
  <div className="form-group">
    <label>Authority Type *</label>
    <select className="form-control" value={form.authority_type}
      onChange={e => setForm(f => ({ ...f, authority_type: e.target.value }))} required>
      <option value="">Select authority</option>
      <option value="mca">MCA — Ministry of Corporate Affairs</option>
      <option value="dgft">DGFT — Directorate General of Foreign Trade</option>
      <option value="gstn_trust_anchor">GSTN — GST Trust Anchor</option>
      <option value="pan_trust_anchor">Income Tax — PAN Trust Anchor</option>
    </select>
  </div>
)}
```

### AuthorityDashboard.tsx

**Authority badge** — replace hardcoded "DGFT" with dynamic label:

```typescript
const AUTHORITY_META: Record<string, { label: string; color: string }> = {
  mca:                { label: 'MCA',         color: '#1a73e8' },
  dgft:               { label: 'DGFT',        color: '#667eea' },
  gstn_trust_anchor:  { label: 'GSTN',        color: '#28a745' },
  pan_trust_anchor:   { label: 'Income Tax',  color: '#e67e22' },
};
const meta = AUTHORITY_META[user?.authority_type || 'dgft'];
```

**Verification checkboxes** — replaced with authority-scoped fields:

```typescript
const AUTHORITY_FIELDS: Record<string, { key: string; label: string; valueKey: string }[]> = {
  mca: [
    { key: 'cin',          label: 'CIN',                  valueKey: 'cin' },
    { key: 'company_name', label: 'Company Name',         valueKey: 'company_name' },
  ],
  dgft: [
    { key: 'ie_code', label: 'IE Code', valueKey: 'ie_code' },
  ],
  gstn_trust_anchor: [
    { key: 'gstn', label: 'GSTN', valueKey: 'gstn' },
  ],
  pan_trust_anchor: [
    { key: 'pan', label: 'PAN Number', valueKey: 'pan_number' },
  ],
};
```

**Approve button** — enabled when all fields in `authority_verifications[authority_type].verified_*` are `true`.

**Pending list status badge** — reads `org.authority_verifications[authority_type].status` instead of `org.application_status`.

### CorporateDashboard.tsx — Corp Wallet Tab

Replace single card with 4 DIA cards in a 2×2 grid:

```typescript
const DIA_CONFIG = [
  { type: 'CompanyRegistrationCredential', label: 'Company Registration', authority: 'MCA',         badge: '#1a73e8', diaLabel: 'DIA1', anchorKey: 'cin' },
  { type: 'IECCredential',                 label: 'IEC Credential',       authority: 'DGFT',        badge: '#667eea', diaLabel: 'DIA2', anchorKey: 'ieCode' },
  { type: 'GSTINCredential',               label: 'GSTIN Credential',     authority: 'GSTN',        badge: '#28a745', diaLabel: 'DIA3', anchorKey: 'gstin' },
  { type: 'PANCredential',                 label: 'PAN Credential',       authority: 'Income Tax',  badge: '#e67e22', diaLabel: 'DIA4', anchorKey: 'pan' },
];
```

**Trust score** at top:
```typescript
const trustScore = DIA_CONFIG.filter(d => walletVCs[d.type]).length;
// "Fully Verified" if trustScore === 4
// "Partial Trust (N/4)" if 1–3
// "Unverified" if 0
```

**Wallet data loading** — `loadAll()` corp-wallet branch fetches all 4 credential types:
```typescript
const data = await api.getMyCredentials(token);
const creds = data.credentials || [];
const vcMap: Record<string, any> = {};
DIA_CONFIG.forEach(d => {
  const found = creds.find((c: any) => c.credential_type === d.type);
  if (found) vcMap[d.type] = found.vc_json;
});
setWalletVCs(vcMap);
```

State changes: `walletVC: any | null` → `walletVCs: Record<string, any>`.

**Backward compatibility** — if an old `OrganizationIdentityCredential` exists and no new DIAs do yet, display a legacy card with a soft migration notice.

---

## Files Modified / Created

| File | Change |
|---|---|
| `src/db/schema.sql` | Add `authority_type` column; rename `field_verifications` → `authority_verifications`; update CHECK constraint |
| `src/server/index.ts` | Update `/api/auth/register`, `/api/authority/organizations`, `/api/authority/organizations/:id/verify-field`, `/api/authority/organizations/:id/approve`; add `buildDIAVC()` helper |
| `src/frontend/pages/RegisterPage.tsx` | Add authority type dropdown for government_agency |
| `src/frontend/pages/AuthorityDashboard.tsx` | Dynamic authority badge, scoped verification fields, scoped pending status |
| `src/frontend/pages/CorporateDashboard.tsx` | Replace `walletVC` with `walletVCs` map; 4 DIA cards with trust score |

---

## Migration Plan (Existing Data)

1. `ALTER TABLE users ADD COLUMN authority_type ...`
2. `UPDATE users SET authority_type = 'dgft' WHERE role = 'government_agency'`
3. `ALTER TABLE organization_applications RENAME COLUMN field_verifications TO authority_verifications`
4. `UPDATE organization_applications SET authority_verifications = ...` (new JSONB structure for pending apps)
5. Update CHECK constraint on `application_status` to include `'partial'` and `'complete'`
6. Existing `OrganizationIdentityCredential` VCs are left in DB — Corp Wallet shows legacy card

---

## Rejection Handling

`POST /api/authority/organizations/:id/reject` is updated to be authority-scoped:

- Sets `authority_verifications[authorityType].status = 'rejected'`
- Does **not** change the overall `application_status` to `'rejected'` — other authorities can still approve
- Overall `application_status` stays `'pending'` or `'partial'` after a partial rejection
- The authority dashboard shows a rejected slot in red for that authority; other authorities still see "Pending"

This allows a corporate to resubmit or appeal for one authority independently without losing approvals from other authorities.

---

## Verification Test Plan

1. Register as MCA officer → verify `authority_type = 'mca'` in DB
2. Register as GSTN Trust Anchor → verify `authority_type = 'gstn_trust_anchor'`
3. Submit org application
4. MCA officer logs in → sees only CIN/Company Name checkboxes → approves → `CompanyRegistrationCredential` issued → application moves to `partial`
5. Corporate user already exists — DGFT officer approves → `IECCredential` issued
6. GSTN approves → `GSTINCredential` issued
7. PAN approves → `PANCredential` issued → application moves to `complete`
8. Corporate login → Corp Wallet shows 4 DIA cards, trust score 4/4 "Fully Verified"
9. DGFT officer cannot verify CIN field (scoped rejection test)
10. Old `OrganizationIdentityCredential` shows as legacy card in Corp Wallet
