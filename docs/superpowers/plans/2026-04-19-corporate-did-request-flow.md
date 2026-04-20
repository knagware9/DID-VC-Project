# Corporate DID Request Flow Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement a unified DID request flow where both the home-page corporate registration form and the logged-in Corporate Requester's DID form land directly in the Corporate AS's "Sign & Submit" tab, then flow through DID Issuer Maker → Checker → DID issued → AS shares to Super Admin wallet.

**Architecture:** A `did_request` row is created at two points — at registration time (alongside the `organization_applications` row) and when a Corporate Requester submits a DID request from the dashboard. Both arrive in the AS's `signatory-queue` tab with `corp_status='checker_approved'`. The AS's approval triggers account creation (for registrations) and forwards to the DID Issuer. The DID Issuer Checker's `issue` endpoint already creates a parent DID; we extend it to also issue VCs when the request originated from a registration.

**Tech Stack:** Node.js/Express (TypeScript) backend, React/TypeScript frontend, PostgreSQL, existing `did_requests` / `organization_applications` tables.

---

## File Map

| File | Change |
|---|---|
| `src/server/index.ts` | 4 endpoint changes (apply, did-requests POST, signatory-approve, authority issue) |
| `src/frontend/pages/CorporateDashboard.tsx` | signatory-queue card labels + temp password panel after approve |

---

### Task 1: `POST /api/organizations/apply` — create `did_request` inside the transaction

**Files:**
- Modify: `src/server/index.ts:2734–2768`

The goal is to INSERT a `did_request` row inside the existing `BEGIN/COMMIT` block so the AS sees the registration as a DID request in their "Sign & Submit" tab the moment they log in.

- [ ] **Step 1: Locate the transaction block in `apply`**

Open `src/server/index.ts`. Find line ~2734 which starts `await query('BEGIN', []);`. The block runs to line ~2768 where `COMMIT` is called and the response is sent.

The current block looks like:
```typescript
await query('BEGIN', []);
try {
  const signatoryResult = await query(
    `INSERT INTO users (email, password_hash, role, name, sub_role, org_id)
     VALUES ($1, $2, 'corporate', $3, 'authorized_signatory', NULL)
     RETURNING id`,
    [signatory_email, signatoryHash, signatory_name]
  );
  const signatoryUserId = signatoryResult.rows[0].id;

  const result = await query(
    `INSERT INTO organization_applications ...`,
    [...]
  );

  await query('COMMIT', []);
  console.log(`[SUBMITTED] signatory: ${signatory_email} | password: ${signatoryTempPass}`);

  res.json({
    success: true,
    applicationId: result.rows[0].id,
    signatory_temp_password: signatoryTempPass,
  });
} catch (txErr: any) {
  await query('ROLLBACK', []);
  throw txErr;
}
```

- [ ] **Step 2: Add `did_request` INSERT between the org_application INSERT and the COMMIT**

Replace the block (from `await query('COMMIT', []);` through `res.json(...)`) with the version below. The new INSERT uses `corp_status='checker_approved'` (directly in AS queue), `status='draft'` (not yet visible to issuer), and stores `application_id` in `request_data` so downstream endpoints can detect it is a registration request.

```typescript
        // Create did_request so the AS sees it in their Sign & Submit tab immediately
        await query(
          `INSERT INTO did_requests
             (requester_user_id, org_id, status, corp_status, corp_signatory_id,
              issuer_user_id, purpose, request_data)
           VALUES ($1, $1, 'draft', 'checker_approved', $1, $2,
                   'Corporate DID Registration', $3)`,
          [
            signatoryUserId,
            assigned_issuer_id,
            JSON.stringify({
              application_id: result.rows[0].id,
              company_name: company_name,
              cin: cin,
            }),
          ]
        );

        await query('COMMIT', []);
        console.log(`[SUBMITTED] signatory: ${signatory_email} | password: ${signatoryTempPass}`);

        res.json({
          success: true,
          applicationId: result.rows[0].id,
          signatory_temp_password: signatoryTempPass,
        });
```

- [ ] **Step 3: Verify TypeScript compiles**

```bash
cd /Users/kamleshnagware/did-vc-project
npx tsc --noEmit 2>&1 | head -30
```

Expected: no errors.

- [ ] **Step 4: Manual smoke test**

```bash
# Start the server locally if not running
curl -s -X POST http://localhost:3001/api/organizations/apply \
  -F "org_name=Test Corp" -F "company_name=Test Corp" \
  -F "cin=U72900MH2020PTC999999" -F "pan_number=AABCU9603R" \
  -F "state=Maharashtra" -F "pincode=400001" \
  -F "date_of_incorporation=2020-01-01" \
  -F "company_status=Active" -F "company_category=Private Limited" \
  -F "email=testcorp@example.com" \
  -F "super_admin_name=Admin User" -F "super_admin_email=admin_test_$(date +%s)@example.com" \
  -F "requester_name=Req User"   -F "requester_email=req_test_$(date +%s)@example.com" \
  -F "signatory_name=AS User"    -F "signatory_email=as_test_$(date +%s)@example.com" \
  -F "assigned_issuer_id=<VALID_ISSUER_ID>" \
  -F 'documents=[{"type":"MCARegistration","vc_type":"MCARegistration","reference_number":"U72900MH2020","required":true}]'
```

Expected: `{ "success": true, "applicationId": "...", "signatory_temp_password": "..." }`

Then verify `did_request` was created:
```bash
# Log in as signatory and call the queue endpoint
TOKEN=$(curl -s -X POST http://localhost:3001/api/auth/login \
  -H 'Content-Type: application/json' \
  -d '{"email":"<signatory_email>","password":"<temp_pass>"}' | python3 -c "import sys,json; print(json.load(sys.stdin)['token'])")

curl -s http://localhost:3001/api/corporate/did-requests/queue \
  -H "Authorization: Bearer $TOKEN" | python3 -m json.tool | grep -A3 '"corp_status"'
```

Expected: a row with `corp_status: "checker_approved"` and `request_data.application_id` set.

- [ ] **Step 5: Commit**

```bash
cd /Users/kamleshnagware/did-vc-project
git add src/server/index.ts
git commit -m "feat: create did_request at registration so AS sees it in Sign & Submit tab"
```

---

### Task 2: `POST /api/corporate/did-requests` — Corporate Requester goes directly to AS

**Files:**
- Modify: `src/server/index.ts:750–763`

Currently the requester's request is created with `corp_status='submitted'` (goes to Corp Maker queue). Change it to `'checker_approved'` so it lands directly in the AS's Sign & Submit tab.

- [ ] **Step 1: Locate the initialCorpStatus line**

In `src/server/index.ts` around line 756:
```typescript
const initialCorpStatus: string | null = isRequester ? 'submitted' : (isSuperAdmin ? 'checker_approved' : null);
```

- [ ] **Step 2: Change `'submitted'` to `'checker_approved'`**

Replace the two comment + initialCorpStatus lines (lines ~752–756):

```typescript
    // Both requester and super_admin go directly to AS Sign & Submit (no corp maker/checker for DID requests)
    const initialStatus = (isRequester || isSuperAdmin) ? 'draft' : 'pending';
    const initialCorpStatus: string | null = (isRequester || isSuperAdmin) ? 'checker_approved' : null;
```

- [ ] **Step 3: Verify TypeScript compiles**

```bash
cd /Users/kamleshnagware/did-vc-project
npx tsc --noEmit 2>&1 | head -30
```

Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add src/server/index.ts
git commit -m "feat: corporate DID request bypasses maker/checker — goes directly to AS Sign & Submit"
```

---

### Task 3: `POST /api/corporate/did-requests/:id/signatory-approve` — create accounts for registration requests

**Files:**
- Modify: `src/server/index.ts:900–952`

When the AS approves a DID request that originated from the registration form (`request_data.application_id` present), the endpoint must:
1. Create super_admin + requester user accounts (find-or-create, safe to re-run)
2. Update `did_request.org_id = superAdminId` (so "Issued DIDs" endpoint can find it after DID is issued)
3. Patch AS's own `org_id = superAdminId`
4. Set `organization_applications.application_status = 'signatory_approved'`

For regular DID requests (no `application_id`), the endpoint continues to work as before.

- [ ] **Step 1: Locate the endpoint body**

Find the endpoint starting at line ~900:
```typescript
app.post('/api/corporate/did-requests/:id/signatory-approve', ...
```

The current logic after the `drResult` query (line ~925):
1. If `decision === 'reject'` → update to rejected
2. Otherwise → update `corp_status='signatory_approved'`, `status='pending'`
3. Return `{ success: true, action: 'approved', ... }`

- [ ] **Step 2: Read the `request_data` from `drResult` and add the org-registration branch**

Replace the section from the `if (decision === 'reject')` check down to the final `res.json(...)` (lines ~935–948) with:

```typescript
    if (decision === 'reject') {
      await query(
        `UPDATE did_requests SET corp_status = 'rejected', rejection_reason = $1, corp_signatory_id = $2, updated_at = NOW() WHERE id = $3`,
        [rejection_reason || 'Rejected by authorized signatory', user.id, id]
      );
      return res.json({ success: true, action: 'rejected' });
    }

    // Read request_data to detect org-registration DID requests
    const dr = drResult.rows[0];
    const rd: any = typeof dr.request_data === 'string'
      ? JSON.parse(dr.request_data || '{}')
      : (dr.request_data || {});

    let superAdminTempPass: string | null = null;
    let requesterTempPass: string | null = null;

    if (rd.application_id) {
      // ── Org Registration path: create corporate accounts ──────────────────
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
        // Find-or-create super_admin
        let superAdminId: string;
        const existingSA = await query('SELECT id FROM users WHERE email = $1', [app.super_admin_email]);
        if (existingSA.rows.length > 0) {
          superAdminId = existingSA.rows[0].id;
        } else {
          superAdminTempPass = crypto.randomBytes(8).toString('hex');
          const saHash = await hashPassword(superAdminTempPass);
          const saRes = await query(
            `INSERT INTO users (email, password_hash, role, name, sub_role)
             VALUES ($1, $2, 'corporate', $3, 'super_admin') RETURNING id`,
            [app.super_admin_email, saHash, app.super_admin_name || app.company_name]
          );
          superAdminId = saRes.rows[0].id;
          await query('UPDATE users SET org_id = $1 WHERE id = $1', [superAdminId]);
        }

        // Find-or-create requester
        if (app.requester_email) {
          const existingReq = await query('SELECT id FROM users WHERE email = $1', [app.requester_email]);
          if (existingReq.rows.length === 0) {
            requesterTempPass = crypto.randomBytes(8).toString('hex');
            const reqHash = await hashPassword(requesterTempPass);
            await query(
              `INSERT INTO users (email, password_hash, role, name, sub_role, org_id)
               VALUES ($1, $2, 'corporate', $3, 'requester', $4)`,
              [app.requester_email, reqHash, app.requester_name || 'Requester', superAdminId]
            );
          } else {
            await query(
              'UPDATE users SET org_id = $1 WHERE id = $2 AND org_id IS NULL',
              [superAdminId, existingReq.rows[0].id]
            );
          }
        }

        // Patch AS org_id
        await query('UPDATE users SET org_id = $1 WHERE id = $2', [superAdminId, user.id]);

        // Update did_request org_id to real super_admin (so issued-dids query finds it)
        await query('UPDATE did_requests SET org_id = $1 WHERE id = $2', [superAdminId, id]);

        // Mark org application signatory_approved
        await query(
          `UPDATE organization_applications
           SET application_status = 'signatory_approved', user_id = $1, updated_at = NOW()
           WHERE id = $2`,
          [superAdminId, rd.application_id]
        );

        await query('COMMIT');
        console.log(`[SIGNATORY APPROVE REG] org: ${app.company_name} | super_admin: ${app.super_admin_email} | pass: ${superAdminTempPass}`);
      } catch (txErr: any) {
        await query('ROLLBACK');
        throw txErr;
      }
    }

    // Always: forward to DID issuer
    await query(
      `UPDATE did_requests SET corp_status = 'signatory_approved', status = 'pending',
       corp_signatory_id = $1, updated_at = NOW() WHERE id = $2`,
      [user.id, id]
    );

    res.json({
      success: true,
      action: 'approved',
      corp_status: 'signatory_approved',
      status: 'pending',
      superAdminTempPassword: superAdminTempPass,
      requesterTempPassword: requesterTempPass,
      message: 'DID request forwarded to issuer for issuance',
    });
```

- [ ] **Step 3: Verify TypeScript compiles**

```bash
cd /Users/kamleshnagware/did-vc-project
npx tsc --noEmit 2>&1 | head -30
```

Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add src/server/index.ts
git commit -m "feat: signatory-approve creates corporate accounts and updates org_id for registration DID requests"
```

---

### Task 4: `POST /api/authority/did-requests/:id/issue` — issue VCs for registration requests

**Files:**
- Modify: `src/server/index.ts:1035–1086`

The Checker's `issue` endpoint already creates the corporate parent DID. Extend it so that when `request_data.application_id` is present, it also issues the VCs (MCA, GSTIN, IEC, PAN) from the org application documents, and marks the application as `'issued'`.

`buildCorporateVC` and `issuerDid` lookup already exist in the `organization_applications/issue` endpoint — we reuse the same pattern here.

- [ ] **Step 1: Locate the endpoint**

Find `app.post('/api/authority/did-requests/:id/issue', ...` around line 1035. The body ends around line 1086 with `res.json({ success: true, did: newDid.did, didId: newDid.id });`.

- [ ] **Step 2: Add issuer DID lookup before the DID creation**

Find the line inside the endpoint that reads:
```typescript
    // Create the DID for the corporate org
    const slug = dr.org_name?.toLowerCase()...
```

Insert the following BEFORE that line (after the MC action check block ends):

```typescript
    // Parse request_data to detect org-registration requests
    const rdRaw: any = typeof dr.request_data === 'string'
      ? JSON.parse(dr.request_data || '{}')
      : (dr.request_data || {});

    // For org-registration requests: look up the issuer's parent DID for VC signing
    let issuerDid: { id: string; did_string: string; private_key_encrypted: string } | null = null;
    if (rdRaw.application_id) {
      const issuerDidResult = await query(
        `SELECT id, did_string, private_key_encrypted FROM dids
         WHERE user_id = $1 AND did_type = 'parent' ORDER BY created_at DESC LIMIT 1`,
        [orgRoot]
      );
      if (issuerDidResult.rows.length > 0) {
        issuerDid = issuerDidResult.rows[0];
      }
    }
```

- [ ] **Step 3: Add VC issuance and application status update AFTER the `did_request` UPDATE**

Find this block (around line 1074):
```typescript
    await query(
      `UPDATE did_requests SET status = 'approved', created_did_id = $1, updated_at = NOW(),
       as_notified_at = CASE WHEN corp_signatory_id IS NOT NULL THEN NOW() ELSE as_notified_at END
       WHERE id = $2`,
      [newDid.id, id]
    );

    await writeAuditLog('did_issued', null, newDid.did, 'DID');
    res.json({ success: true, did: newDid.did, didId: newDid.id });
```

Replace it with:

```typescript
    await query(
      `UPDATE did_requests SET status = 'approved', created_did_id = $1, updated_at = NOW(),
       as_notified_at = CASE WHEN corp_signatory_id IS NOT NULL THEN NOW() ELSE as_notified_at END
       WHERE id = $2`,
      [newDid.id, id]
    );

    // Org-registration: issue VCs from the application documents
    let vcsIssued = 0;
    if (rdRaw.application_id && issuerDid) {
      const appResult = await query(
        'SELECT * FROM organization_applications WHERE id = $1',
        [rdRaw.application_id]
      );
      if (appResult.rows.length > 0) {
        const app = appResult.rows[0];
        const docs: any[] = Array.isArray(app.documents)
          ? app.documents
          : (typeof app.documents === 'string' ? JSON.parse(app.documents || '[]') : []);
        const vcTypes: string[] = docs.map((d: any) => d.vc_type).filter(Boolean);
        const expiresAt = new Date(Date.now() + 365 * 24 * 60 * 60 * 1000);
        for (const vcType of vcTypes) {
          const vcJson = buildCorporateVC(vcType, app, issuerDid, newDid.did, expiresAt);
          await query(
            `INSERT INTO credentials (vc_json, holder_did_id, issuer_did_id, credential_type, issued_at, expires_at)
             VALUES ($1, $2, $3, $4, NOW(), $5)`,
            [JSON.stringify(vcJson), newDid.id, issuerDid.id, vcType, expiresAt]
          );
          vcsIssued++;
        }
        await query(
          `UPDATE organization_applications
           SET application_status = 'issued', corporate_user_id = $1, checker_id = $2, updated_at = NOW()
           WHERE id = $3`,
          [dr.org_id, user.id, rdRaw.application_id]
        );
        console.log(`[ORG DID ISSUED] company: ${app.company_name} | did: ${newDid.did} | vcs: ${vcsIssued}`);
      }
    }

    await writeAuditLog('did_issued', null, newDid.did, 'DID');
    res.json({ success: true, did: newDid.did, didId: newDid.id, vcsIssued });
```

- [ ] **Step 4: Verify TypeScript compiles**

```bash
cd /Users/kamleshnagware/did-vc-project
npx tsc --noEmit 2>&1 | head -30
```

Expected: no errors.

- [ ] **Step 5: Commit**

```bash
git add src/server/index.ts
git commit -m "feat: DID issuer checker also issues org VCs when approving a registration DID request"
```

---

### Task 5: `CorporateDashboard.tsx` — signatory-queue card labels and temp password panel

**Files:**
- Modify: `src/frontend/pages/CorporateDashboard.tsx`

Two sub-changes:
1. Cards in the signatory-queue: show "🏢 Corporate Registration — {company_name}" for registration requests, keep "🔑 {orgName}" for regular ones.
2. After the AS approves, if `superAdminTempPassword` or `requesterTempPassword` is in the response, show a yellow credentials panel (same visual style as `SignatoryDashboard`).

- [ ] **Step 1: Add `signatoryApproveCredentials` state variable**

Find the existing state declarations at the top of the `CorporateDashboard` component (around line 377 where `didQueue` is declared). Add after the `didQueue` state:

```typescript
  const [signatoryApproveCredentials, setSignatoryApproveCredentials] = useState<{
    companyName: string;
    superAdminEmail: string;
    superAdminPass: string | null;
    requesterEmail: string | null;
    requesterPass: string | null;
  } | null>(null);
```

- [ ] **Step 2: Add a dedicated `handleSignatoryApproveDID` function**

Add the following function after `handleCorpReject` (around line 609):

```typescript
  async function handleSignatoryApproveDID(req: any) {
    if (!token) return;
    try {
      const r = await fetch(`/api/corporate/did-requests/${req.id}/signatory-approve`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ decision: 'approve' }),
      });
      const d = await r.json();
      if (!r.ok) throw new Error(d.error);
      // Show temp credentials panel if this was a registration request
      if (d.superAdminTempPassword || d.requesterTempPassword) {
        const rd = typeof req.request_data === 'string'
          ? JSON.parse(req.request_data || '{}')
          : (req.request_data || {});
        setSignatoryApproveCredentials({
          companyName: rd.company_name || rd.orgName || 'Company',
          superAdminEmail: rd.super_admin_email || '',
          superAdminPass: d.superAdminTempPassword || null,
          requesterEmail: rd.requester_email || null,
          requesterPass: d.requesterTempPassword || null,
        });
      }
      showMsg('success', '✓ DID request forwarded to DID Issuer');
      loadAll();
    } catch (err: any) { showMsg('error', err.message); }
  }
```

Note: `rd.super_admin_email` and `rd.requester_email` are not stored in the `did_request.request_data`. We need to fetch the org application to show the correct emails. To avoid an extra fetch, load the emails from the org application response. Simplest fix: the backend already returns the emails of created accounts implicitly. Instead, just show "Super Admin account created" with the password, and let the AS look up the email from the application form they already filled in.

Revise the function to not rely on emails from `request_data`:

```typescript
  async function handleSignatoryApproveDID(req: any) {
    if (!token) return;
    try {
      const r = await fetch(`/api/corporate/did-requests/${req.id}/signatory-approve`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ decision: 'approve' }),
      });
      const d = await r.json();
      if (!r.ok) throw new Error(d.error);
      if (d.superAdminTempPassword || d.requesterTempPassword) {
        const rd: any = typeof req.request_data === 'string'
          ? JSON.parse(req.request_data || '{}')
          : (req.request_data || {});
        setSignatoryApproveCredentials({
          companyName: rd.company_name || rd.orgName || 'Company',
          superAdminEmail: '(use email from registration form)',
          superAdminPass: d.superAdminTempPassword || null,
          requesterEmail: null,
          requesterPass: d.requesterTempPassword || null,
        });
      }
      showMsg('success', '✓ DID request forwarded to DID Issuer');
      loadAll();
    } catch (err: any) { showMsg('error', err.message); }
  }
```

- [ ] **Step 3: Add the credentials panel JSX just before the signatory-queue tab block**

Find the `{tab === 'signatory-queue' && (` block (around line 1785). Immediately before it, insert:

```tsx
          {/* Temp credentials panel after AS approves a registration DID request */}
          {tab === 'signatory-queue' && signatoryApproveCredentials && (
            <div style={{ background: '#fefce8', border: '2px solid #fde047', borderRadius: 12, padding: '1.25rem', marginBottom: '1.5rem' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.75rem' }}>
                <div style={{ fontWeight: 800, color: '#713f12', fontSize: '0.95rem' }}>
                  🔐 New Account Credentials — {signatoryApproveCredentials.companyName}
                </div>
                <button onClick={() => setSignatoryApproveCredentials(null)}
                  style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: '1.1rem', color: '#92400e' }}>✕</button>
              </div>
              <div style={{ fontSize: '0.78rem', color: '#92400e', marginBottom: '0.75rem' }}>
                ⚠️ Copy these passwords now — they will not be shown again.
              </div>
              {signatoryApproveCredentials.superAdminPass && (
                <div style={{ background: 'white', borderRadius: 8, padding: '0.75rem 1rem', marginBottom: '0.5rem', border: '1px solid #fde047' }}>
                  <div style={{ fontSize: '0.72rem', fontWeight: 700, color: '#2563eb', marginBottom: '0.25rem' }}>SUPER ADMIN</div>
                  <div style={{ fontSize: '0.85rem', color: '#1e293b' }}>Email: <strong>{signatoryApproveCredentials.superAdminEmail}</strong></div>
                  <div style={{ fontSize: '0.85rem', color: '#1e293b' }}>Temp Password: <strong style={{ fontFamily: 'monospace', background: '#f1f5f9', padding: '1px 6px', borderRadius: 4 }}>{signatoryApproveCredentials.superAdminPass}</strong></div>
                </div>
              )}
              {signatoryApproveCredentials.requesterPass && (
                <div style={{ background: 'white', borderRadius: 8, padding: '0.75rem 1rem', border: '1px solid #fde047' }}>
                  <div style={{ fontSize: '0.72rem', fontWeight: 700, color: '#7c3aed', marginBottom: '0.25rem' }}>REQUESTER</div>
                  <div style={{ fontSize: '0.85rem', color: '#1e293b' }}>Temp Password: <strong style={{ fontFamily: 'monospace', background: '#f1f5f9', padding: '1px 6px', borderRadius: 4 }}>{signatoryApproveCredentials.requesterPass}</strong></div>
                </div>
              )}
            </div>
          )}
```

- [ ] **Step 4: Update the card title in the signatory-queue render to distinguish registration vs regular requests**

Find this line in the signatory-queue `.map(...)` block (around line 1804):
```tsx
<span style={{ fontWeight: 700 }}>🔑 {rd.orgName || 'DID Creation Request'}</span>
```

Replace with:
```tsx
<span style={{ fontWeight: 700 }}>
  {rd.application_id
    ? `🏢 Corporate Registration — ${rd.company_name || rd.orgName || 'New Corporate'}`
    : `🔑 ${rd.orgName || r.purpose || 'DID Creation Request'}`}
</span>
```

- [ ] **Step 5: Update the "Sign & Forward" button to call `handleSignatoryApproveDID`**

Find the button (around line 1825):
```tsx
onClick={() => handleCorpAction(r.id, 'did', 'signatory-approve', 'approve')}>
  ✍️ Sign & Forward to IBDIC
```

Replace the `onClick` with the new dedicated function, passing the full request object:
```tsx
onClick={() => handleSignatoryApproveDID(r)}>
  ✍️ Sign & Forward to DID Issuer
```

- [ ] **Step 6: Update the success message for the `request-did` tab submission**

Find in `handleDIDRequestSubmit` (around line 638):
```typescript
showMsg('success', subRole === 'requester'
  ? 'DID request submitted — Maker → Checker → Authorised Signatory → Issuer'
  : 'DID request submitted to issuer for issuance');
```

Replace with:
```typescript
showMsg('success', 'DID request submitted — awaiting Authorised Signatory approval');
```

- [ ] **Step 7: Verify TypeScript compiles**

```bash
cd /Users/kamleshnagware/did-vc-project
npx tsc --noEmit 2>&1 | head -30
```

Expected: no errors.

- [ ] **Step 8: Commit**

```bash
git add src/frontend/pages/CorporateDashboard.tsx
git commit -m "feat: signatory-queue shows registration vs regular DID request labels and temp password panel"
```

---

### Task 6: Deploy to EC2 and end-to-end smoke test

**Files:** None (deployment only)

- [ ] **Step 1: SCP both changed files to EC2**

```bash
scp -i /Users/kamleshnagware/Downloads/pocdid.pem \
  /Users/kamleshnagware/did-vc-project/src/server/index.ts \
  ubuntu@3.111.36.10:/home/ubuntu/did-vc-project/src/server/index.ts

scp -i /Users/kamleshnagware/Downloads/pocdid.pem \
  /Users/kamleshnagware/did-vc-project/src/frontend/pages/CorporateDashboard.tsx \
  ubuntu@3.111.36.10:/home/ubuntu/did-vc-project/src/frontend/pages/CorporateDashboard.tsx
```

- [ ] **Step 2: Build and restart containers**

```bash
ssh -i /Users/kamleshnagware/Downloads/pocdid.pem ubuntu@3.111.36.10 \
  "cd /home/ubuntu/did-vc-project && \
   docker compose build backend frontend --no-cache 2>&1 | tail -10 && \
   docker compose stop backend frontend && \
   docker compose rm -f backend frontend && \
   docker compose up -d backend frontend --no-deps"
```

- [ ] **Step 3: Verify backend started cleanly**

```bash
ssh -i /Users/kamleshnagware/Downloads/pocdid.pem ubuntu@3.111.36.10 \
  "sleep 5 && docker compose -f /home/ubuntu/did-vc-project/docker-compose.yml logs backend --tail=10"
```

Expected: `Server running on http://localhost:3001`

- [ ] **Step 4: End-to-end test — Flow 1 (Registration)**

```
1. Open http://3.111.36.10:3000 → click "Register your Corporate"
2. Fill form: Company Info → Key People → Select DID Issuer → Documents → Submit
3. Note the signatory temp password shown on success screen
4. Log in as the AS with that temp password → CorporateDashboard
5. Click "Sign & Submit" tab — should see "🏢 Corporate Registration — {company}" card
6. Click "Sign & Forward to DID Issuer"
   → Yellow credentials panel appears with super_admin + requester temp passwords
7. Log in as DID Issuer maker → "DID Requests" tab → should see the pending request
8. Click Approve → "Forwarded to checker queue"
9. Log in as DID Issuer checker → "Checker Queue" tab → approve
10. Log back in as AS → "DID Issued" tab → DID appears
11. Click "Share to Corporate Super Admin"
12. Log in as Super Admin (temp password from step 6) → "Wallet" tab → DID + VCs visible
```

- [ ] **Step 5: End-to-end test — Flow 2 (Ongoing Requester DID request)**

```
1. Log in as Corporate Requester (e.g. priya@fsvlabs.com)
2. Go to "Request DID" tab → fill form → submit
   → Success message: "DID request submitted — awaiting Authorised Signatory approval"
3. Log in as the Corporate AS for that org → "Sign & Submit" tab
   → Should see "🔑 {purpose}" card
4. Click "Sign & Forward to DID Issuer"
   → No temp password panel (regular request, not registration)
5. DID Issuer Maker → Checker → DID issued
6. AS → "DID Issued" → Share → Super Admin wallet updated
```
