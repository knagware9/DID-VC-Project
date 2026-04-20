# Corporate DID Request Flow — Design Spec

## Goal

Implement two unified DID request flows that both land in the Corporate Authorized Signatory's "Sign & Submit — DID Requests" tab, then proceed through the DID Issuer Maker → Checker pipeline, ending with the AS sharing the issued DID to the Corporate Super Admin wallet.

## Two Sources, One Pipeline

### Flow 1 — Initial Corporate Onboarding (Home Page)

```
Home page "Register your Corporate" form
  → POST /api/organizations/apply
      creates: organization_application record
      creates: AS user (temp password shown on success screen)
      creates: did_request (corp_status='checker_approved', status='draft')
  
Corporate AS logs in → CorporateDashboard → "Sign & Submit" tab
  sees: "🏢 Corporate Registration — {company_name}" card
  clicks "Sign & Submit"
  → POST /api/corporate/did-requests/:id/signatory-approve
      creates: super_admin + requester user accounts (temp passwords returned)
      updates: did_request.org_id = superAdminId
      patches:  AS user's own org_id = superAdminId
      updates:  org_application.application_status = 'signatory_approved'
      sets:     did_request.status = 'pending'
      shows:    temp password panel to AS

DID Issuer Maker → "DID Requests" tab
  sees: pending request
  → POST /api/authority/did-requests/:id/approve
      creates MC action → forwarded to Checker queue

DID Issuer Checker → "Checker Queue" tab
  → POST /api/authority/did-requests/:id/issue
      if request_data.application_id exists:
        loads org_application documents
        creates corporate parent DID (did_type='parent', user_id=superAdminId)
        issues VCs: MCARegistration, GSTINCredential, IECCredential, PANCredential
        updates org_application.application_status = 'issued'
      sets: did_request.status='approved', created_did_id, as_notified_at=NOW()

Corporate AS → "Issued DIDs" tab  (existing query finds it automatically)
  → POST /api/corporate/signatory/issued-dids/:id/share

Corporate Super Admin wallet → sees DID + VCs
```

### Flow 2 — Ongoing DID Request (Corporate Requester, post-onboarding)

```
Corporate Requester logs in → CorporateDashboard → "Request DID" tab
  fills form: purpose, org name, issuer
  → POST /api/corporate/did-requests
      CHANGE: corp_status = 'checker_approved'  (was 'submitted' — bypasses Corp Maker/Checker)
      status = 'draft'

Corporate AS → "Sign & Submit" tab  (same tab, sees immediately)
  sees: "🔑 DID Request — {purpose}" card
  clicks "Sign & Submit"
  → POST /api/corporate/did-requests/:id/signatory-approve
      (no application_id in request_data — standard path)
      sets: did_request.status='pending', corp_status='signatory_approved'

DID Issuer Maker → Checker → DID issued  (same as Flow 1 from here)

Corporate AS → shares → Super Admin wallet
```

---

## Architecture

### Data model (no schema changes)

`did_requests` table drives both flows end-to-end:

| Field | Flow 1 initial value | Flow 2 initial value |
|---|---|---|
| `requester_user_id` | signatoryUserId | corporateRequesterId |
| `org_id` | signatoryUserId (placeholder) | superAdminId (real) |
| `status` | `'draft'` | `'draft'` |
| `corp_status` | `'checker_approved'` | `'checker_approved'` |
| `corp_signatory_id` | signatoryUserId | null |
| `issuer_user_id` | assignedIssuerId | selected issuerId |
| `request_data` | `{ application_id, company_name, cin }` | `{ orgName, purpose, ... }` |

Status transitions (same for both flows after AS approves):
```
draft → pending (AS approves) → approved (Checker issues)
corp_status: checker_approved → signatory_approved
```

### Detection of Flow 1 vs Flow 2

`request_data.application_id` present = Flow 1 (org registration). Used in:
- `signatory-approve`: trigger account creation
- `authority/did-requests/:id/issue`: trigger VC issuance

---

## Files Changed

### `src/server/index.ts` — 4 endpoint changes

**1. `POST /api/organizations/apply`**

After the existing INSERT into `organization_applications` and signatory user creation, add:

```typescript
// Create did_request so it appears in AS's Sign & Submit tab
const didReqResult = await query(
  `INSERT INTO did_requests
     (requester_user_id, org_id, status, corp_status, corp_signatory_id,
      issuer_user_id, purpose, request_data)
   VALUES ($1,$1,'draft','checker_approved',$1,$2,'Corporate DID Registration',$3)
   RETURNING id`,
  [
    signatoryUserId,
    assignedIssuerId,
    JSON.stringify({ application_id: orgAppId, company_name: companyName, cin }),
  ]
);
```

Return `did_request_id` alongside `applicationId` and `signatory_temp_password`.

**2. `POST /api/corporate/did-requests`**

Change the `initialCorpStatus` for requesters from `'submitted'` to `'checker_approved'`:

```typescript
// BEFORE:
const initialCorpStatus = isRequester ? 'submitted' : (isSuperAdmin ? 'checker_approved' : null);

// AFTER:
const initialCorpStatus = (isRequester || isSuperAdmin) ? 'checker_approved' : null;
```

Update the success message returned to the requester:
```
'DID request submitted — awaiting Authorised Signatory approval'
```

**3. `POST /api/corporate/did-requests/:id/signatory-approve`**

After the existing `corp_status = 'checker_approved'` check, add Flow 1 detection block:

```typescript
const dr = drResult.rows[0];
const rd = typeof dr.request_data === 'string'
  ? JSON.parse(dr.request_data || '{}')
  : (dr.request_data || {});

let superAdminTempPass: string | null = null;
let requesterTempPass: string | null = null;

if (rd.application_id) {
  // Flow 1: org registration — create accounts, update org_id
  const appResult = await query(
    `SELECT * FROM organization_applications WHERE id = $1 AND application_status = 'pending'`,
    [rd.application_id]
  );
  if (appResult.rows.length === 0) {
    return res.status(400).json({ error: 'Organization application not found or already processed' });
  }
  const app = appResult.rows[0];

  await query('BEGIN');
  try {
    // Create super_admin (find-or-create)
    let superAdminId: string;
    const existingSA = await query('SELECT id FROM users WHERE email = $1', [app.super_admin_email]);
    if (existingSA.rows.length > 0) {
      superAdminId = existingSA.rows[0].id;
    } else {
      superAdminTempPass = crypto.randomBytes(8).toString('hex');
      const saHash = await hashPassword(superAdminTempPass);
      const saRes = await query(
        `INSERT INTO users (email, password_hash, role, name, sub_role)
         VALUES ($1,$2,'corporate',$3,'super_admin') RETURNING id`,
        [app.super_admin_email, saHash, app.super_admin_name || app.company_name]
      );
      superAdminId = saRes.rows[0].id;
      await query('UPDATE users SET org_id = $1 WHERE id = $1', [superAdminId]);
    }

    // Create requester (find-or-create)
    if (app.requester_email) {
      const existingReq = await query('SELECT id FROM users WHERE email = $1', [app.requester_email]);
      if (existingReq.rows.length === 0) {
        requesterTempPass = crypto.randomBytes(8).toString('hex');
        const reqHash = await hashPassword(requesterTempPass);
        await query(
          `INSERT INTO users (email, password_hash, role, name, sub_role, org_id)
           VALUES ($1,$2,'corporate',$3,'requester',$4)`,
          [app.requester_email, reqHash, app.requester_name || 'Requester', superAdminId]
        );
      } else {
        await query(
          'UPDATE users SET org_id = $1 WHERE id = $2 AND org_id IS NULL',
          [superAdminId, existingReq.rows[0].id]
        );
      }
    }

    // Patch signatory org_id
    await query('UPDATE users SET org_id = $1 WHERE id = $2', [superAdminId, user.id]);

    // Update did_request org_id to real super_admin
    await query('UPDATE did_requests SET org_id = $1 WHERE id = $2', [superAdminId, id]);

    // Mark org application signatory_approved
    await query(
      `UPDATE organization_applications
       SET application_status = 'signatory_approved', user_id = $1, updated_at = NOW()
       WHERE id = $2`,
      [superAdminId, rd.application_id]
    );

    await query('COMMIT');
  } catch (err) {
    await query('ROLLBACK');
    throw err;
  }
}

// Always: forward to DID issuer
await query(
  `UPDATE did_requests
   SET corp_status = 'signatory_approved', status = 'pending',
       corp_signatory_id = $1, updated_at = NOW()
   WHERE id = $2`,
  [user.id, id]
);

res.json({
  success: true,
  action: 'approved',
  superAdminTempPassword: superAdminTempPass,
  requesterTempPassword: requesterTempPass,
  message: 'DID request forwarded to issuer for issuance',
});
```

**4. `POST /api/authority/did-requests/:id/issue`**

After creating the DID, add VC issuance for Flow 1:

```typescript
const rd = typeof dr.request_data === 'string'
  ? JSON.parse(dr.request_data || '{}')
  : (dr.request_data || {});

// ... existing DID creation code (creates newDid) ...

// Flow 1: also issue VCs from the org application
if (rd.application_id) {
  const appResult = await query(
    'SELECT * FROM organization_applications WHERE id = $1',
    [rd.application_id]
  );
  if (appResult.rows.length > 0) {
    const app = appResult.rows[0];
    const docs: any[] = Array.isArray(app.documents) ? app.documents
      : (typeof app.documents === 'string' ? JSON.parse(app.documents || '[]') : []);
    const vcTypes = docs.map((d: any) => d.vc_type).filter(Boolean);
    const expiresAt = new Date(Date.now() + 365 * 24 * 60 * 60 * 1000);
    for (const vcType of vcTypes) {
      const vcJson = buildCorporateVC(vcType, app, issuerDid, newDid.did, expiresAt);
      await query(
        `INSERT INTO credentials (vc_json, holder_did_id, issuer_did_id, credential_type, issued_at, expires_at)
         VALUES ($1,$2,$3,$4,NOW(),$5)`,
        [JSON.stringify(vcJson), newDid.id, issuerDid.id, vcType, expiresAt]
      );
    }
    await query(
      `UPDATE organization_applications
       SET application_status = 'issued', corporate_user_id = $1, checker_id = $2
       WHERE id = $3`,
      [dr.org_id, user.id, rd.application_id]
    );
  }
}
```

Note: `issuerDid` lookup must be added to this endpoint (currently only in the `organization_applications/issue` endpoint). Add before the DID creation:
```typescript
const issuerDidResult = await query(
  `SELECT id, did_string, private_key_encrypted FROM dids
   WHERE user_id = $1 AND did_type = 'parent' ORDER BY created_at DESC LIMIT 1`,
  [orgRoot]
);
if (issuerDidResult.rows.length === 0) {
  // No issuer DID — skip VC issuance, just issue the corporate DID
}
const issuerDid = issuerDidResult.rows[0];
```

---

### `src/frontend/pages/CorporateDashboard.tsx` — 2 UI changes

**5. `signatory-queue` tab — org-registration card label + temp password panel**

In the `didQueue.filter(r => r.corp_status === 'checker_approved').map(...)` render block:

- Detect org registration: `rd.application_id` present
- If org registration: show `"🏢 Corporate Registration — {rd.company_name || rd.orgName}"`
- If regular DID request: show `"🔑 DID Request — {r.purpose}"`

After `handleCorpAction` returns for a signatory-approve, if the response contains `superAdminTempPassword`:
- Show the same yellow credentials panel used in `SignatoryDashboard` (email + temp password for super_admin and requester)

**6. `request-did` tab — update success message**

Change:
```
'DID request submitted — Maker → Checker → Authorised Signatory → Issuer'
```
To:
```
'DID request submitted — awaiting Authorised Signatory approval'
```

---

## What stays unchanged

- `GET /api/corporate/did-requests/queue` — already returns `corp_status = 'checker_approved'` items for AS
- `GET /api/corporate/signatory/issued-dids` — already queries `did_requests WHERE status='approved'`
- `POST /api/corporate/signatory/issued-dids/:id/share` — no change
- `GET /api/authority/did-requests` — already shows `status='pending'` to all issuer sub_roles
- `POST /api/authority/did-requests/:id/approve` — maker creates MC action, no change
- DID Issuer nav — `did-requests` already visible to all govt_agency sub_roles
- Corp Maker/Checker queues — DID request sections show empty gracefully (no change needed)
- `SignatoryDashboard` route — kept for backward compatibility, hidden from nav

---

## Test Plan

1. Register a new corporate via home page `/signup`
2. Log in as the AS → `CorporateDashboard` → "Sign & Submit" tab → should see "🏢 Corporate Registration — {company}" card
3. Click Sign & Submit → yellow temp password panel shows super_admin + requester credentials
4. Log in as DID Issuer maker → "DID Requests" tab → should see the pending request
5. Maker clicks Approve → forwarded to checker queue
6. Log in as DID Issuer checker → "Checker Queue" → approve → DID issued
7. Log back in as AS → "Issued DIDs" tab → DID appears with `as_notified_at` set
8. AS clicks Share → Super Admin wallet shows DID + VCs
9. Log in as Super Admin → wallet shows DID
10. Super Admin adds Maker/Checker via Team tab
11. Log in as Corporate Requester → "Request DID" tab → fill form → submit → success message "awaiting AS approval"
12. Log back in as AS → "Sign & Submit" tab → sees "🔑 DID Request" card → approves
13. Same DID Issuer flow → DID issued → AS shares → Super Admin wallet updated
