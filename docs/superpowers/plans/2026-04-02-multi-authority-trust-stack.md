# Multi-Authority Trust Stack — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Expand from single-authority DGFT onboarding to 4 independent issuing authorities (MCA, DGFT, GSTN, PAN/IT), each issuing their own W3C DIA VC, with a corporate wallet showing 4 DIA cards and a trust score.

**Architecture:** Add `authority_type` to `users`; replace `field_verifications` with `authority_verifications` JSONB on `organization_applications`; expand `application_status` CHECK; update all 5 backend routes to be authority-scoped; update `AuthContext` to carry `authority_type`; add authority dropdown to RegisterPage; make AuthorityDashboard dynamic; replace single Corp Wallet card with 4 DIA cards + trust score.

**Tech Stack:** PostgreSQL 15, Express/TypeScript, React 18 + React Router v6, custom CSS + inline styles (no Tailwind). DB port 5433, backend port 3002, frontend port 3000. No git in project — skip all git commit steps.

---

## File Map

| File | Action | Responsibility |
|---|---|---|
| `src/db/schema.sql` | Modify | Add `authority_type` column; rename `field_verifications` → `authority_verifications`; update CHECK constraint |
| `src/server/index.ts` | Modify | Add `buildDIAVC`/`diaCredentialType` helpers; update 5 routes: register, list-orgs, verify-field, approve, reject |
| `src/frontend/contexts/AuthContext.tsx` | Modify | Add `authority_type?: string` to `User` interface; add `authority_type` param to `register()` |
| `src/frontend/pages/RegisterPage.tsx` | Modify | Add authority type dropdown shown when role = government_agency |
| `src/frontend/pages/AuthorityDashboard.tsx` | Modify | Dynamic authority badge/color; authority-scoped verification checkboxes; scoped pending status |
| `src/frontend/pages/CorporateDashboard.tsx` | Modify | Replace `walletVC` with `walletVCs` map; 4 DIA cards in 2×2 grid; trust score banner |

---

## Task 1: DB Migrations

**Files:**
- Modify: `src/db/schema.sql`

- [ ] **Step 1: Add `authority_type` column to users table in schema.sql**

Open `src/db/schema.sql`. Find the `CREATE TABLE IF NOT EXISTS users` block. After the existing columns (before the closing `);`), add:

```sql
  authority_type          VARCHAR(30)
                          CHECK (authority_type IN ('mca', 'dgft', 'gstn_trust_anchor', 'pan_trust_anchor')),
```

- [ ] **Step 2: Update `organization_applications` column name in schema.sql**

In `src/db/schema.sql`, find `field_verifications` in the `organization_applications` CREATE TABLE definition and rename it to `authority_verifications`. Also update the DEFAULT:

Find:
```sql
  field_verifications     JSONB NOT NULL DEFAULT '{"cin":false,"pan":false,"gstn":false,"ie_code":false}',
```

Replace with:
```sql
  authority_verifications JSONB NOT NULL DEFAULT '{
    "mca":  {"status":"pending","verified_cin":false,"verified_company_name":false,"vc_id":null},
    "dgft": {"status":"pending","verified_ie_code":false,"vc_id":null},
    "gstn": {"status":"pending","verified_gstn":false,"vc_id":null},
    "pan":  {"status":"pending","verified_pan":false,"vc_id":null}
  }',
```

- [ ] **Step 3: Update `application_status` CHECK constraint in schema.sql**

Find:
```sql
  application_status      VARCHAR(20) NOT NULL DEFAULT 'pending'
                          CHECK (application_status IN ('pending', 'approved', 'rejected')),
```

Replace with:
```sql
  application_status      VARCHAR(20) NOT NULL DEFAULT 'pending'
                          CHECK (application_status IN ('pending', 'partial', 'complete', 'rejected')),
```

- [ ] **Step 4: Apply migration — add `authority_type` column**

```bash
DATABASE_URL=postgresql://didvc_user:didvc_pass@localhost:5433/didvc
psql $DATABASE_URL -c "
ALTER TABLE users
  ADD COLUMN IF NOT EXISTS authority_type VARCHAR(30)
  CHECK (authority_type IN ('mca', 'dgft', 'gstn_trust_anchor', 'pan_trust_anchor'));
"
```

Expected: `ALTER TABLE`

- [ ] **Step 5: Migrate existing government_agency users to dgft**

```bash
DATABASE_URL=postgresql://didvc_user:didvc_pass@localhost:5433/didvc
psql $DATABASE_URL -c "
UPDATE users SET authority_type = 'dgft' WHERE role = 'government_agency' AND authority_type IS NULL;
"
```

Expected: `UPDATE N` (N ≥ 0)

- [ ] **Step 6: Rename `field_verifications` → `authority_verifications`**

```bash
DATABASE_URL=postgresql://didvc_user:didvc_pass@localhost:5433/didvc
psql $DATABASE_URL -c "
ALTER TABLE organization_applications
  RENAME COLUMN field_verifications TO authority_verifications;
"
```

Expected: `ALTER TABLE`

- [ ] **Step 7: Reset authority_verifications for pending applications**

```bash
DATABASE_URL=postgresql://didvc_user:didvc_pass@localhost:5433/didvc
psql $DATABASE_URL -c "
UPDATE organization_applications
SET authority_verifications = '{
  \"mca\":  {\"status\":\"pending\",\"verified_cin\":false,\"verified_company_name\":false,\"vc_id\":null},
  \"dgft\": {\"status\":\"pending\",\"verified_ie_code\":false,\"vc_id\":null},
  \"gstn\": {\"status\":\"pending\",\"verified_gstn\":false,\"vc_id\":null},
  \"pan\":  {\"status\":\"pending\",\"verified_pan\":false,\"vc_id\":null}
}'::jsonb
WHERE application_status = 'pending';
"
```

Expected: `UPDATE N`

- [ ] **Step 8: Update `application_status` CHECK constraint**

```bash
DATABASE_URL=postgresql://didvc_user:didvc_pass@localhost:5433/didvc
psql $DATABASE_URL -c "
ALTER TABLE organization_applications
  DROP CONSTRAINT IF EXISTS organization_applications_application_status_check;
ALTER TABLE organization_applications
  ADD CONSTRAINT organization_applications_application_status_check
    CHECK (application_status IN ('pending', 'partial', 'complete', 'rejected'));
"
```

Expected: `ALTER TABLE`

- [ ] **Step 9: Verify DB state**

```bash
DATABASE_URL=postgresql://didvc_user:didvc_pass@localhost:5433/didvc
psql $DATABASE_URL -c "\d users" | grep authority_type
psql $DATABASE_URL -c "\d organization_applications" | grep authority
```

Expected: `authority_type` column in users table; `authority_verifications` column in organization_applications.

---

## Task 2: Backend — update `/api/auth/register` and add `authority_type` to user record

**Files:**
- Modify: `src/server/index.ts`

- [ ] **Step 1: Update the register route to accept and store `authority_type`**

Find in `src/server/index.ts`:
```typescript
app.post('/api/auth/register', async (req, res) => {
  try {
    const { email, password, role, name } = req.body;
    if (!email || !password || !role) {
      return res.status(400).json({ error: 'Email, password, and role are required' });
    }
    if (!['government_agency', 'verifier'].includes(role)) {
      return res.status(400).json({ error: 'Invalid role. Must be government_agency or verifier' });
    }

    const existing = await getUserByEmail(email);
    if (existing) return res.status(400).json({ error: 'User already exists' });

    const passwordHash = await hashPassword(password);
    const userName = name || email.split('@')[0];

    const userResult = await query(
      'INSERT INTO users (email, password_hash, role, name) VALUES ($1, $2, $3, $4) RETURNING id',
      [email, passwordHash, role, userName]
    );
    const userId = userResult.rows[0].id;

    // Auto-create DID for government_agency on registration
    let did: string | undefined;
    if (role === 'government_agency') {
      const slug = userName.toLowerCase().replace(/[^a-z0-9]/g, '-');
      const didData = await createAndStoreDID(userId, 'parent', undefined, slug);
      did = didData.did;
      // DID stored in dids table; mfa_secret reserved for TOTP
    }

    const token = await createSession(userId, role);

    res.json({
      success: true,
      token,
      user: { id: userId, email, role, did, name: userName },
    });
  } catch (error: any) {
    console.error('Register error:', error);
    res.status(500).json({ error: error.message });
  }
});
```

Replace with:
```typescript
app.post('/api/auth/register', async (req, res) => {
  try {
    const { email, password, role, name, authority_type } = req.body;
    if (!email || !password || !role) {
      return res.status(400).json({ error: 'Email, password, and role are required' });
    }
    if (!['government_agency', 'verifier'].includes(role)) {
      return res.status(400).json({ error: 'Invalid role. Must be government_agency or verifier' });
    }
    const validAuthorityTypes = ['mca', 'dgft', 'gstn_trust_anchor', 'pan_trust_anchor'];
    if (role === 'government_agency' && !authority_type) {
      return res.status(400).json({ error: 'authority_type is required for government_agency role' });
    }
    if (authority_type && !validAuthorityTypes.includes(authority_type)) {
      return res.status(400).json({ error: 'Invalid authority_type' });
    }

    const existing = await getUserByEmail(email);
    if (existing) return res.status(400).json({ error: 'User already exists' });

    const passwordHash = await hashPassword(password);
    const userName = name || email.split('@')[0];

    const userResult = await query(
      'INSERT INTO users (email, password_hash, role, name, authority_type) VALUES ($1, $2, $3, $4, $5) RETURNING id',
      [email, passwordHash, role, userName, authority_type || null]
    );
    const userId = userResult.rows[0].id;

    // Auto-create DID for government_agency on registration
    let did: string | undefined;
    if (role === 'government_agency') {
      const slug = userName.toLowerCase().replace(/[^a-z0-9]/g, '-');
      const didData = await createAndStoreDID(userId, 'parent', undefined, slug);
      did = didData.did;
    }

    const token = await createSession(userId, role);

    res.json({
      success: true,
      token,
      user: { id: userId, email, role, did, name: userName, authority_type: authority_type || null },
    });
  } catch (error: any) {
    console.error('Register error:', error);
    res.status(500).json({ error: error.message });
  }
});
```

- [ ] **Step 2: Ensure `/api/auth/me` returns `authority_type`**

Find the `/api/auth/me` route. It reads `user` from `getUserById`. Check `getUserByEmail` / `getUserById` return shape in `src/server/auth.ts`. If `authority_type` is not already returned, we patch the `/api/auth/me` route inline.

Read `src/server/auth.ts`:

```bash
grep -n "authority_type\|getUserById\|SELECT.*FROM users" /Users/kamleshnagware/did-vc-project/src/server/auth.ts | head -30
```

If `getUserById` does NOT select `authority_type`, find the `/api/auth/me` route in `index.ts` and add it to the response:

```typescript
// In /api/auth/me:
res.json({ success: true, user: { ...user, authority_type: user.authority_type } });
```

(The user object from session should now carry authority_type since DB query will include it after the column exists — verify the SELECT query in auth.ts includes it or add it.)

- [ ] **Step 3: Smoke test register with authority_type**

```bash
DATABASE_URL=postgresql://didvc_user:didvc_pass@localhost:5433/didvc PORT=3002 \
  npx tsx src/server/index.ts &
sleep 2

curl -s -X POST http://localhost:3002/api/auth/register \
  -H "Content-Type: application/json" \
  -d '{"email":"mca@test.gov.in","password":"password123","role":"government_agency","name":"MCA Authority","authority_type":"mca"}' | python3 -m json.tool
```

Expected: `{"success":true,"token":"...","user":{"id":"...","email":"mca@test.gov.in","role":"government_agency","authority_type":"mca",...}}`

```bash
curl -s -X POST http://localhost:3002/api/auth/register \
  -H "Content-Type: application/json" \
  -d '{"email":"nodtype@test.gov.in","password":"password123","role":"government_agency","name":"No Type"}' | python3 -m json.tool
```

Expected: `{"error":"authority_type is required for government_agency role"}`

---

## Task 3: Backend — authority-scoped list/detail routes

**Files:**
- Modify: `src/server/index.ts`

- [ ] **Step 1: Update `GET /api/authority/organizations`**

Find in `src/server/index.ts`:
```typescript
app.get('/api/authority/organizations', requireAuth, requireRole('government_agency'), async (req, res) => {
  try {
    const status = (req.query.status as string) || 'pending';
    const rows = await query(
      `SELECT * FROM organization_applications WHERE application_status = $1 ORDER BY created_at DESC`,
      [status]
    );
    const stats = await query(
      `SELECT
        COUNT(*) FILTER (WHERE application_status='pending') AS pending,
        COUNT(*) FILTER (WHERE application_status='approved') AS approved,
        COUNT(*) FILTER (WHERE application_status='rejected') AS rejected,
        COUNT(*) AS total
       FROM organization_applications`
    );
    res.json({ organizations: rows.rows, stats: stats.rows[0] });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});
```

Replace with:
```typescript
app.get('/api/authority/organizations', requireAuth, requireRole('government_agency'), async (req, res) => {
  try {
    const authorityType: string = (req as any).user.authority_type || 'dgft';
    const status = (req.query.status as string) || 'pending';
    const rows = await query(
      `SELECT * FROM organization_applications
       WHERE authority_verifications->$1->>'status' = $2
       ORDER BY created_at DESC`,
      [authorityType, status]
    );
    const stats = await query(
      `SELECT
        COUNT(*) FILTER (WHERE authority_verifications->$1->>'status'='pending') AS pending,
        COUNT(*) FILTER (WHERE authority_verifications->$1->>'status'='approved') AS approved,
        COUNT(*) FILTER (WHERE authority_verifications->$1->>'status'='rejected') AS rejected,
        COUNT(*) AS total
       FROM organization_applications`,
      [authorityType]
    );
    res.json({ organizations: rows.rows, stats: stats.rows[0] });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});
```

- [ ] **Step 2: Verify route returns scoped data**

With the backend running (from Task 2 Step 3), log in as mca@test.gov.in:

```bash
MFA_RES=$(curl -s -X POST http://localhost:3002/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{"email":"mca@test.gov.in","password":"password123"}')
echo $MFA_RES
TEMP_TOKEN=$(echo $MFA_RES | python3 -c "import sys,json; print(json.load(sys.stdin)['tempToken'])")
MFA_CODE=$(echo $MFA_RES | python3 -c "import sys,json; d=json.load(sys.stdin); print(d.get('mfaCode',''))")
# get MFA code from console log if not in response
```

```bash
MCA_TOKEN=$(curl -s -X POST http://localhost:3002/api/auth/verify-mfa \
  -H "Content-Type: application/json" \
  -d "{\"tempToken\":\"$TEMP_TOKEN\",\"code\":\"$MFA_CODE\"}" | python3 -c "import sys,json; print(json.load(sys.stdin)['token'])")

curl -s "http://localhost:3002/api/authority/organizations" \
  -H "Authorization: Bearer $MCA_TOKEN" | python3 -m json.tool
```

Expected: JSON with `organizations` array and `stats` showing counts scoped to MCA's pending slot.

---

## Task 4: Backend — authority-scoped `verify-field` route

**Files:**
- Modify: `src/server/index.ts`

- [ ] **Step 1: Update `POST /api/authority/organizations/:id/verify-field`**

Find:
```typescript
app.post('/api/authority/organizations/:id/verify-field', requireAuth, requireRole('government_agency'), async (req, res) => {
  try {
    const { field, verified } = req.body;
    const validFields = ['cin', 'pan', 'gstn', 'ie_code'];
    if (!validFields.includes(field)) {
      return res.status(400).json({ error: 'Invalid field. Must be one of: cin, pan, gstn, ie_code' });
    }
    const result = await query(
      `UPDATE organization_applications
       SET field_verifications = field_verifications || $1::jsonb, updated_at = NOW()
       WHERE id = $2
       RETURNING field_verifications`,
      [JSON.stringify({ [field]: verified }), req.params.id]
    );
    if (!result.rows[0]) return res.status(404).json({ error: 'Application not found' });
    res.json({ success: true, field_verifications: result.rows[0].field_verifications });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});
```

Replace with:
```typescript
app.post('/api/authority/organizations/:id/verify-field', requireAuth, requireRole('government_agency'), async (req, res) => {
  try {
    const authorityType: string = (req as any).user.authority_type || 'dgft';
    const { field, verified } = req.body;
    const fieldsByAuthority: Record<string, string[]> = {
      mca:               ['cin', 'company_name'],
      dgft:              ['ie_code'],
      gstn_trust_anchor: ['gstn'],
      pan_trust_anchor:  ['pan'],
    };
    const allowed = fieldsByAuthority[authorityType] || [];
    if (!allowed.includes(field)) {
      return res.status(400).json({ error: `Field '${field}' is not in ${authorityType} scope. Allowed: ${allowed.join(', ')}` });
    }
    const result = await query(
      `UPDATE organization_applications
       SET authority_verifications = jsonb_set(
         authority_verifications,
         $1::text[],
         $2::jsonb
       ), updated_at = NOW()
       WHERE id = $3
       RETURNING authority_verifications`,
      [`{${authorityType},verified_${field}}`, JSON.stringify(verified), req.params.id]
    );
    if (!result.rows[0]) return res.status(404).json({ error: 'Application not found' });
    res.json({ success: true, authority_verifications: result.rows[0].authority_verifications });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});
```

- [ ] **Step 2: Smoke test scoped field verification**

First get an application ID:
```bash
APP_ID=$(psql postgresql://didvc_user:didvc_pass@localhost:5433/didvc -t -c \
  "SELECT id FROM organization_applications ORDER BY created_at DESC LIMIT 1;" | tr -d ' ')
echo "App ID: $APP_ID"
```

Test MCA can verify CIN:
```bash
curl -s -X POST "http://localhost:3002/api/authority/organizations/$APP_ID/verify-field" \
  -H "Authorization: Bearer $MCA_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"field":"cin","verified":true}' | python3 -m json.tool
```

Expected: `{"success":true,"authority_verifications":{"mca":{"status":"pending","verified_cin":true,...},...}}`

Test MCA cannot verify ie_code (cross-authority field):
```bash
curl -s -X POST "http://localhost:3002/api/authority/organizations/$APP_ID/verify-field" \
  -H "Authorization: Bearer $MCA_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"field":"ie_code","verified":true}' | python3 -m json.tool
```

Expected: `{"error":"Field 'ie_code' is not in mca scope. Allowed: cin, company_name"}`

---

## Task 5: Backend — add `buildDIAVC` helper and update approve route

**Files:**
- Modify: `src/server/index.ts`

- [ ] **Step 1: Add `buildDIAVC` and `diaCredentialType` helper functions**

Find the line `// ─── Organization Application Routes` (or just before `app.post('/api/organizations/apply'`). Insert the two helper functions immediately before the Organization Application Routes comment:

```typescript
// ── DIA VC Helpers ────────────────────────────────────────────────────────────

function diaCredentialType(authorityType: string): string {
  const map: Record<string, string> = {
    mca:               'CompanyRegistrationCredential',
    dgft:              'IECCredential',
    gstn_trust_anchor: 'GSTINCredential',
    pan_trust_anchor:  'PANCredential',
  };
  return map[authorityType] || 'UnknownCredential';
}

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
        id: holderDid,
        companyName: org.company_name,
        cin: org.cin,
        companyStatus: org.company_status,
        companyCategory: org.company_category,
        dateOfIncorporation: org.date_of_incorporation,
        directorName: org.director_name,
        din: org.din,
        digitalIdentityAnchor: org.cin,
      },
    },
    dgft: {
      type: ['VerifiableCredential', 'IECCredential'],
      credentialSubject: {
        id: holderDid,
        companyName: org.company_name,
        ieCode: org.ie_code,
        digitalIdentityAnchor: org.ie_code,
      },
    },
    gstn_trust_anchor: {
      type: ['VerifiableCredential', 'GSTINCredential'],
      credentialSubject: {
        id: holderDid,
        companyName: org.company_name,
        gstin: org.gstn,
        digitalIdentityAnchor: org.gstn,
      },
    },
    pan_trust_anchor: {
      type: ['VerifiableCredential', 'PANCredential'],
      credentialSubject: {
        id: holderDid,
        companyName: org.company_name,
        pan: org.pan_number,
        digitalIdentityAnchor: org.pan_number,
      },
    },
  };
  return { ...base, ...subjectMap[authorityType] };
}
```

- [ ] **Step 2: Replace the approve route**

Find the existing approve route (starts with `app.post('/api/authority/organizations/:id/approve'`). Replace the entire route with:

```typescript
app.post('/api/authority/organizations/:id/approve', requireAuth, requireRole('government_agency'), async (req, res) => {
  try {
    const authorityType: string = (req as any).user.authority_type || 'dgft';
    const appResult = await query('SELECT * FROM organization_applications WHERE id = $1', [req.params.id]);
    const org = appResult.rows[0];
    if (!org) return res.status(404).json({ error: 'Application not found' });

    // Check all this authority's fields are verified
    const authVerif = org.authority_verifications[authorityType];
    if (!authVerif) return res.status(400).json({ error: `No slot for authority_type ${authorityType}` });
    const allVerified = Object.entries(authVerif)
      .filter(([k]) => k.startsWith('verified_'))
      .every(([, v]) => v === true);
    if (!allVerified) {
      return res.status(400).json({ error: `All ${authorityType} fields must be verified before approval` });
    }
    if (authVerif.status === 'approved') {
      return res.status(400).json({ error: `${authorityType} has already approved this application` });
    }

    // Get issuer (this authority's) DID
    const dgftUser = (req as any).user;
    const issuerDidResult = await query(
      'SELECT id, did_string, private_key_encrypted FROM dids WHERE user_id = $1 AND did_type = $2',
      [dgftUser.id, 'parent']
    );
    if (!issuerDidResult.rows[0]) return res.status(500).json({ error: `${authorityType} DID not found` });
    const issuerDid = issuerDidResult.rows[0];

    // Create corporate user only on FIRST approval (when user_id is null)
    let userId = org.user_id;
    let holderDid: string;
    let holderDidId: string;
    let tempPassword: string | null = null;

    if (!userId) {
      // First approval — create corporate user + DID
      tempPassword = crypto.randomBytes(8).toString('hex');
      const passwordHash = await hashPassword(tempPassword);
      const userResult = await query(
        'INSERT INTO users (email, password_hash, role, name) VALUES ($1, $2, $3, $4) RETURNING id',
        [org.email, passwordHash, 'corporate', org.company_name]
      );
      userId = userResult.rows[0].id;
      const slug = org.company_name.toLowerCase().replace(/[^a-z0-9]/g, '-');
      const didData = await createAndStoreDID(userId, 'parent', undefined, slug);
      holderDid = didData.did;
      const holderDidResult = await query('SELECT id FROM dids WHERE did_string = $1', [holderDid]);
      holderDidId = holderDidResult.rows[0].id;
      console.log(`[APPROVAL EMAIL] To: ${org.email} | Login: ${org.email} | Temp Password: ${tempPassword}`);
    } else {
      // Subsequent approval — look up existing corporate DID
      const didResult = await query(
        'SELECT did_string, id FROM dids WHERE user_id = $1 AND did_type = $2',
        [userId, 'parent']
      );
      if (!didResult.rows[0]) return res.status(500).json({ error: 'Corporate DID not found' });
      holderDid = didResult.rows[0].did_string;
      holderDidId = didResult.rows[0].id;
    }

    // Build DIA VC for this authority only
    const now = new Date();
    const expiresAt = new Date(now.getFullYear() + 10, now.getMonth(), now.getDate());
    const vc = buildDIAVC(authorityType, org, issuerDid, holderDid);
    const credType = diaCredentialType(authorityType);

    // Store credential
    const credResult = await query(
      `INSERT INTO credentials (vc_json, holder_did_id, issuer_did_id, credential_type, issued_at, expires_at)
       VALUES ($1, $2, $3, $4, $5, $6) RETURNING id`,
      [JSON.stringify(vc), holderDidId, issuerDid.id, credType, now, expiresAt]
    );
    const vcId = credResult.rows[0].id;

    // Update authority slot: set status=approved, vc_id=<id>
    // Then compute new overall application_status
    const updatedVerifResult = await query(
      `UPDATE organization_applications
       SET authority_verifications = jsonb_set(
         jsonb_set(authority_verifications, $1::text[], $2::jsonb),
         $3::text[], $4::jsonb
       ), updated_at = NOW()
       WHERE id = $5
       RETURNING authority_verifications`,
      [
        `{${authorityType},status}`, '"approved"',
        `{${authorityType},vc_id}`, JSON.stringify(vcId),
        req.params.id
      ]
    );
    const updatedVerif = updatedVerifResult.rows[0].authority_verifications;
    const allApproved = ['mca', 'dgft', 'gstn_trust_anchor', 'pan_trust_anchor']
      .every(at => updatedVerif[at]?.status === 'approved');
    const newStatus = allApproved ? 'complete' : 'partial';

    await query(
      'UPDATE organization_applications SET application_status = $1, user_id = $2, updated_at = NOW() WHERE id = $3',
      [newStatus, userId, req.params.id]
    );

    // Polygon anchor (async, non-blocking)
    polygonService.anchorVC(vcId, vc, issuerDid.did_string, holderDid, credType, expiresAt)
      .catch(err => console.error('[Polygon] VC anchor failed:', err.message));

    res.json({
      success: true,
      userId,
      did: holderDid,
      vcId,
      credentialType: credType,
      applicationStatus: newStatus,
      ...(tempPassword ? { tempPassword } : {}),
    });
  } catch (error: any) {
    console.error('Approve error:', error);
    res.status(500).json({ error: error.message });
  }
});
```

- [ ] **Step 3: Smoke test approve (requires an application with verified CIN + company_name for MCA)**

First verify company_name for MCA on the test app:
```bash
curl -s -X POST "http://localhost:3002/api/authority/organizations/$APP_ID/verify-field" \
  -H "Authorization: Bearer $MCA_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"field":"company_name","verified":true}' | python3 -m json.tool
```

Then approve:
```bash
curl -s -X POST "http://localhost:3002/api/authority/organizations/$APP_ID/approve" \
  -H "Authorization: Bearer $MCA_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{}' | python3 -m json.tool
```

Expected: `{"success":true,"userId":"...","did":"did:web:...","vcId":"...","credentialType":"CompanyRegistrationCredential","applicationStatus":"partial",...}`

Verify DB:
```bash
psql postgresql://didvc_user:didvc_pass@localhost:5433/didvc -c \
  "SELECT credential_type, issued_at FROM credentials WHERE credential_type='CompanyRegistrationCredential' ORDER BY issued_at DESC LIMIT 1;"
```

Expected: one row with `CompanyRegistrationCredential`.

---

## Task 6: Backend — authority-scoped reject route

**Files:**
- Modify: `src/server/index.ts`

- [ ] **Step 1: Replace the reject route**

Find:
```typescript
app.post('/api/authority/organizations/:id/reject', requireAuth, requireRole('government_agency'), async (req, res) => {
  try {
    const { reason } = req.body;
    if (!reason) return res.status(400).json({ error: 'Rejection reason is required' });
    const result = await query(
      'UPDATE organization_applications SET application_status=$1, rejection_reason=$2, updated_at=NOW() WHERE id=$3 RETURNING id',
      ['rejected', reason, req.params.id]
    );
    if (!result.rows[0]) return res.status(404).json({ error: 'Application not found' });
    res.json({ success: true });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});
```

Replace with:
```typescript
app.post('/api/authority/organizations/:id/reject', requireAuth, requireRole('government_agency'), async (req, res) => {
  try {
    const authorityType: string = (req as any).user.authority_type || 'dgft';
    const { reason } = req.body;
    if (!reason) return res.status(400).json({ error: 'Rejection reason is required' });
    // Authority-scoped rejection: only update this authority's slot
    // Do NOT change overall application_status — other authorities can still approve
    const result = await query(
      `UPDATE organization_applications
       SET authority_verifications = jsonb_set(
         jsonb_set(authority_verifications, $1::text[], '"rejected"'::jsonb),
         $2::text[], $3::jsonb
       ), updated_at = NOW()
       WHERE id = $4
       RETURNING id`,
      [
        `{${authorityType},status}`,
        `{${authorityType},rejection_reason}`,
        JSON.stringify(reason),
        req.params.id
      ]
    );
    if (!result.rows[0]) return res.status(404).json({ error: 'Application not found' });
    res.json({ success: true });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});
```

- [ ] **Step 2: Verify reject is authority-scoped**

```bash
# Register a DGFT user
curl -s -X POST http://localhost:3002/api/auth/register \
  -H "Content-Type: application/json" \
  -d '{"email":"dgft2@test.gov.in","password":"password123","role":"government_agency","name":"DGFT Officer","authority_type":"dgft"}' | python3 -m json.tool
```

Then log in as DGFT and reject the application:
```bash
DGFT_LOGIN=$(curl -s -X POST http://localhost:3002/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{"email":"dgft2@test.gov.in","password":"password123"}')
# ... get tempToken + mfaCode from console log, then verify-mfa to get DGFT_TOKEN
# Then:
curl -s -X POST "http://localhost:3002/api/authority/organizations/$APP_ID/reject" \
  -H "Authorization: Bearer $DGFT_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"reason":"IE Code mismatch"}' | python3 -m json.tool
```

Expected: `{"success":true}`

Verify application_status is still `partial` (MCA already approved), not `rejected`:
```bash
psql postgresql://didvc_user:didvc_pass@localhost:5433/didvc -c \
  "SELECT application_status, authority_verifications->'mca'->>'status' AS mca_status, authority_verifications->'dgft'->>'status' AS dgft_status FROM organization_applications WHERE id='$APP_ID';"
```

Expected: `application_status=partial`, `mca_status=approved`, `dgft_status=rejected`.

---

## Task 7: Frontend — update `AuthContext` to carry `authority_type`

**Files:**
- Modify: `src/frontend/contexts/AuthContext.tsx`

- [ ] **Step 1: Add `authority_type` to `User` interface**

Find:
```typescript
interface User {
  id: string;
  email: string;
  role: UserRole;
  did?: string;
  name?: string;
}
```

Replace with:
```typescript
interface User {
  id: string;
  email: string;
  role: UserRole;
  did?: string;
  name?: string;
  authority_type?: string;
}
```

- [ ] **Step 2: Add `authority_type` parameter to `register()` function signature in interface**

Find:
```typescript
  register: (email: string, password: string, role: UserRole, name?: string) => Promise<void>;
```

Replace with:
```typescript
  register: (email: string, password: string, role: UserRole, name?: string, authority_type?: string) => Promise<void>;
```

- [ ] **Step 3: Update `register()` implementation**

Find:
```typescript
  const register = async (email: string, password: string, role: UserRole, name?: string) => {
    const res = await fetch(`${API_BASE}/auth/register`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password, role, name }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Registration failed');
    setToken(data.token);
    setUser(data.user);
    localStorage.setItem('auth_token', data.token);
    redirectByRole(role);
  };
```

Replace with:
```typescript
  const register = async (email: string, password: string, role: UserRole, name?: string, authority_type?: string) => {
    const res = await fetch(`${API_BASE}/auth/register`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password, role, name, authority_type }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Registration failed');
    setToken(data.token);
    setUser(data.user);
    localStorage.setItem('auth_token', data.token);
    redirectByRole(role);
  };
```

- [ ] **Step 4: Update `redirectByRole` to send government_agency to `/authority/dashboard`**

Find:
```typescript
  function redirectByRole(role: UserRole) {
    setTimeout(() => {
      if (role === 'corporate') window.location.href = '/corporate/dashboard';
      else if (role === 'government_agency') window.location.href = '/issuer/dashboard';
      else window.location.href = '/verifier/dashboard';
    }, 100);
  }
```

Replace with:
```typescript
  function redirectByRole(role: UserRole) {
    setTimeout(() => {
      if (role === 'corporate') window.location.href = '/corporate/dashboard';
      else if (role === 'government_agency') window.location.href = '/authority/dashboard';
      else window.location.href = '/verifier/dashboard';
    }, 100);
  }
```

- [ ] **Step 5: Verify TypeScript compiles**

```bash
cd /Users/kamleshnagware/did-vc-project
npx tsc --noEmit --project tsconfig.json 2>&1 | head -30
```

Expected: no errors related to `AuthContext.tsx`.

---

## Task 8: Frontend — update `RegisterPage.tsx` with authority type dropdown

**Files:**
- Modify: `src/frontend/pages/RegisterPage.tsx`

- [ ] **Step 1: Add `authority_type` to form state**

Find:
```typescript
  const [form, setForm] = useState({ email: '', password: '', name: '', role: 'government_agency' as UserRole });
```

Replace with:
```typescript
  const [form, setForm] = useState({ email: '', password: '', name: '', role: 'government_agency' as UserRole, authority_type: '' });
```

- [ ] **Step 2: Update `handleSubmit` to pass `authority_type`**

Find:
```typescript
    try { await register(form.email, form.password, form.role, form.name); }
```

Replace with:
```typescript
    try { await register(form.email, form.password, form.role, form.name, form.authority_type || undefined); }
```

- [ ] **Step 3: Add authority type dropdown after the role radio buttons**

Find the closing `</div>` that ends the roles section. It's right after the `{roles.map(...)}` block — find this closing pattern:

```typescript
          </div>
          </div>
          <button className="btn btn-primary" type="submit" disabled={loading} style={{ width: '100%', marginTop: '1rem' }}>
```

Replace with:
```tsx
          </div>
          </div>
          {form.role === 'government_agency' && (
            <div className="form-group" style={{ marginTop: '0.75rem' }}>
              <label>Authority Type *</label>
              <select
                className="form-input"
                value={form.authority_type}
                onChange={e => setForm(f => ({ ...f, authority_type: e.target.value }))}
                required
              >
                <option value="">Select your authority</option>
                <option value="mca">MCA — Ministry of Corporate Affairs</option>
                <option value="dgft">DGFT — Directorate General of Foreign Trade</option>
                <option value="gstn_trust_anchor">GSTN — GST Trust Anchor</option>
                <option value="pan_trust_anchor">Income Tax — PAN Trust Anchor</option>
              </select>
            </div>
          )}
          <button className="btn btn-primary" type="submit" disabled={loading} style={{ width: '100%', marginTop: '1rem' }}>
```

- [ ] **Step 4: Verify TypeScript compiles**

```bash
cd /Users/kamleshnagware/did-vc-project
npx tsc --noEmit --project tsconfig.json 2>&1 | head -30
```

Expected: no errors from `RegisterPage.tsx`.

---

## Task 9: Frontend — update `AuthorityDashboard.tsx` for dynamic authority

**Files:**
- Modify: `src/frontend/pages/AuthorityDashboard.tsx`

- [ ] **Step 1: Update `OrgApp` type to use `authority_verifications`**

Find:
```typescript
type OrgApp = {
  id: string; org_name: string; email: string; director_full_name: string;
  aadhaar_number: string; dob: string; gender: string; state: string; pincode: string;
  company_name: string; cin: string; company_status: string; company_category: string;
  date_of_incorporation: string; pan_number: string; gstn: string; ie_code: string;
  director_name: string; din: string; designation: string; signing_authority_level: string;
  field_verifications: { cin: boolean; pan: boolean; gstn: boolean; ie_code: boolean };
  application_status: string; rejection_reason?: string; created_at: string; updated_at: string;
};
```

Replace with:
```typescript
type AuthoritySlot = {
  status: 'pending' | 'approved' | 'rejected';
  vc_id: string | null;
  [key: string]: boolean | string | null;
};

type OrgApp = {
  id: string; org_name: string; email: string; director_full_name: string;
  aadhaar_number: string; dob: string; gender: string; state: string; pincode: string;
  company_name: string; cin: string; company_status: string; company_category: string;
  date_of_incorporation: string; pan_number: string; gstn: string; ie_code: string;
  director_name: string; din: string; designation: string; signing_authority_level: string;
  authority_verifications: Record<string, AuthoritySlot>;
  application_status: string; rejection_reason?: string; created_at: string; updated_at: string;
};
```

- [ ] **Step 2: Add `AUTHORITY_META` and `AUTHORITY_FIELDS` constants**

After the type declarations, add:

```typescript
const AUTHORITY_META: Record<string, { label: string; color: string }> = {
  mca:               { label: 'MCA',        color: '#1a73e8' },
  dgft:              { label: 'DGFT',       color: '#667eea' },
  gstn_trust_anchor: { label: 'GSTN',       color: '#28a745' },
  pan_trust_anchor:  { label: 'Income Tax', color: '#e67e22' },
};

const AUTHORITY_FIELDS: Record<string, { key: string; label: string; valueKey: keyof OrgApp }[]> = {
  mca: [
    { key: 'cin',          label: 'CIN',          valueKey: 'cin' },
    { key: 'company_name', label: 'Company Name',  valueKey: 'company_name' },
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

- [ ] **Step 3: Update `Stats` type to match new backend response**

Find:
```typescript
type Stats = { pending: string; approved: string; rejected: string; total: string };
```

Replace with:
```typescript
type Stats = { pending: string; approved: string; rejected: string; total: string };
```

(No change needed — same shape.)

- [ ] **Step 4: Add `authorityType` and `meta` inside the component**

Find the start of the `AuthorityDashboard` component function body (right after `export default function AuthorityDashboard() {`). Add these two lines right after the destructuring of `useAuth`:

```typescript
  const { token, user, logout } = useAuth();
```

Change to:
```typescript
  const { token, user, logout } = useAuth();
  const authorityType = (user as any)?.authority_type || 'dgft';
  const meta = AUTHORITY_META[authorityType] || AUTHORITY_META.dgft;
```

- [ ] **Step 5: Update `toggleField` to use `authority_verifications`**

Find:
```typescript
  async function toggleField(orgId: string, field: string, checked: boolean) {
    const res = await fetch(`/api/authority/organizations/${orgId}/verify-field`, {
      method: 'POST', headers: authHeader(),
      body: JSON.stringify({ field, verified: checked }),
    });
    const data = await res.json();
    if (data.field_verifications && selected) {
      setSelected({ ...selected, field_verifications: data.field_verifications });
    }
  }
```

Replace with:
```typescript
  async function toggleField(orgId: string, field: string, checked: boolean) {
    const res = await fetch(`/api/authority/organizations/${orgId}/verify-field`, {
      method: 'POST', headers: authHeader(),
      body: JSON.stringify({ field, verified: checked }),
    });
    const data = await res.json();
    if (data.authority_verifications && selected) {
      setSelected({ ...selected, authority_verifications: data.authority_verifications });
    }
  }
```

- [ ] **Step 6: Update `allVerified` helper**

Find:
```typescript
  const allVerified = (fv: OrgApp['field_verifications']) => fv.cin && fv.pan && fv.gstn && fv.ie_code;
```

Replace with:
```typescript
  const allVerified = (org: OrgApp) => {
    const slot = org.authority_verifications?.[authorityType];
    if (!slot) return false;
    return Object.entries(slot)
      .filter(([k]) => k.startsWith('verified_'))
      .every(([, v]) => v === true);
  };
```

- [ ] **Step 7: Replace hardcoded DGFT badge with dynamic `meta` badge**

Find ALL occurrences of this hardcoded badge (there are 2–3 in the file — in sidebar and in table):
```typescript
<div style={{ background: '#667eea', color: '#fff', display: 'inline-block', padding: '0.25rem 0.75rem', borderRadius: 20, fontSize: '0.7rem', fontWeight: 600, marginBottom: '0.5rem' }}>DGFT</div>
```

Replace each with:
```tsx
<div style={{ background: meta.color, color: '#fff', display: 'inline-block', padding: '0.25rem 0.75rem', borderRadius: 20, fontSize: '0.7rem', fontWeight: 600, marginBottom: '0.5rem' }}>{meta.label}</div>
```

Also find the table badge:
```tsx
<span style={{ background: '#667eea', color: '#fff', padding: '0.2rem 0.6rem', borderRadius: 12, fontSize: '0.7rem', fontWeight: 600 }}>DGFT</span>
```

Replace with:
```tsx
<span style={{ background: meta.color, color: '#fff', padding: '0.2rem 0.6rem', borderRadius: 12, fontSize: '0.7rem', fontWeight: 600 }}>{meta.label}</span>
```

- [ ] **Step 8: Replace hardcoded DGFT verification checkboxes with dynamic authority-scoped fields**

Find the "DGFT Verification" section in the modal (inside `{selected && (...)}` block):
```tsx
            {/* DGFT Verification Checkboxes */}
            <div style={{ marginBottom: '1.5rem' }}>
              <h4 style={{ color: '#667eea', borderBottom: '1px solid #e2e8f0', paddingBottom: '0.5rem', marginBottom: '0.75rem' }}>DGFT Verification</h4>
              {[
                { key: 'cin' as const, label: 'CIN', value: selected.cin },
                { key: 'pan' as const, label: 'PAN Number', value: selected.pan_number },
                { key: 'gstn' as const, label: 'GSTN', value: selected.gstn },
                { key: 'ie_code' as const, label: 'IE Code', value: selected.ie_code },
              ].map(field => (
                <div key={field.key} style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', marginBottom: '0.75rem' }}>
                  <input type="checkbox" checked={selected.field_verifications[field.key]}
                    onChange={e => toggleField(selected.id, field.key, e.target.checked)}
                    style={{ width: 16, height: 16, cursor: 'pointer' }} />
                  <span style={{ fontWeight: 500 }}>{field.label}</span>
                  <span style={{ fontFamily: 'monospace', color: '#555', fontSize: '0.875rem' }}>({field.value})</span>
                  {selected.field_verifications[field.key] && (
                    <span style={{ background: '#d4edda', color: '#155724', padding: '0.15rem 0.5rem', borderRadius: 8, fontSize: '0.75rem', fontWeight: 600 }}>Verified</span>
                  )}
                </div>
              ))}
            </div>
```

Replace with:
```tsx
            {/* Authority Verification Checkboxes */}
            <div style={{ marginBottom: '1.5rem' }}>
              <h4 style={{ color: meta.color, borderBottom: '1px solid #e2e8f0', paddingBottom: '0.5rem', marginBottom: '0.75rem' }}>{meta.label} Verification</h4>
              {(AUTHORITY_FIELDS[authorityType] || []).map(field => {
                const isVerified = selected.authority_verifications?.[authorityType]?.[`verified_${field.key}`] === true;
                return (
                  <div key={field.key} style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', marginBottom: '0.75rem' }}>
                    <input type="checkbox" checked={isVerified}
                      onChange={e => toggleField(selected.id, field.key, e.target.checked)}
                      style={{ width: 16, height: 16, cursor: 'pointer' }} />
                    <span style={{ fontWeight: 500 }}>{field.label}</span>
                    <span style={{ fontFamily: 'monospace', color: '#555', fontSize: '0.875rem' }}>({String(selected[field.valueKey] || '—')})</span>
                    {isVerified && (
                      <span style={{ background: '#d4edda', color: '#155724', padding: '0.15rem 0.5rem', borderRadius: 8, fontSize: '0.75rem', fontWeight: 600 }}>Verified</span>
                    )}
                  </div>
                );
              })}
            </div>
```

- [ ] **Step 9: Update Approve button to use new `allVerified` signature**

Find:
```tsx
              <button className="btn btn-primary" disabled={!allVerified(selected.field_verifications) || loading}
                onClick={() => handleApprove(selected.id)}
                style={{ opacity: allVerified(selected.field_verifications) ? 1 : 0.5 }}>
```

Replace with:
```tsx
              <button className="btn btn-primary" disabled={!allVerified(selected) || loading}
                onClick={() => handleApprove(selected.id)}
                style={{ opacity: allVerified(selected) ? 1 : 0.5 }}>
```

- [ ] **Step 10: Update table status badge to use per-authority status**

Find in the table row:
```tsx
                      <td style={{ padding: '0.75rem 1rem' }}>
                        <span style={{ background: '#fff3cd', color: '#856404', padding: '0.2rem 0.6rem', borderRadius: 12, fontSize: '0.7rem', fontWeight: 600 }}>Pending</span>
                      </td>
```

Replace with:
```tsx
                      <td style={{ padding: '0.75rem 1rem' }}>
                        {(() => {
                          const slotStatus = org.authority_verifications?.[authorityType]?.status || 'pending';
                          const statusStyles: Record<string, { bg: string; color: string }> = {
                            pending:  { bg: '#fff3cd', color: '#856404' },
                            approved: { bg: '#d4edda', color: '#155724' },
                            rejected: { bg: '#f8d7da', color: '#721c24' },
                          };
                          const s = statusStyles[slotStatus] || statusStyles.pending;
                          return (
                            <span style={{ background: s.bg, color: s.color, padding: '0.2rem 0.6rem', borderRadius: 12, fontSize: '0.7rem', fontWeight: 600 }}>
                              {slotStatus.charAt(0).toUpperCase() + slotStatus.slice(1)}
                            </span>
                          );
                        })()}
                      </td>
```

- [ ] **Step 11: Verify TypeScript compiles**

```bash
cd /Users/kamleshnagware/did-vc-project
npx tsc --noEmit --project tsconfig.json 2>&1 | grep -i "AuthorityDashboard\|error" | head -20
```

Expected: no errors.

---

## Task 10: Frontend — update `CorporateDashboard.tsx` with 4 DIA cards and trust score

**Files:**
- Modify: `src/frontend/pages/CorporateDashboard.tsx`

- [ ] **Step 1: Add `DIA_CONFIG` constant and update wallet state**

Find near the top of `CorporateDashboard.tsx` the existing `walletVC` state:
```typescript
  const [walletVC, setWalletVC] = useState<any>(null);
```

Replace with:
```typescript
  const [walletVCs, setWalletVCs] = useState<Record<string, any>>({});
  const [legacyVC, setLegacyVC] = useState<any>(null);
```

Also add the `DIA_CONFIG` constant before the component function (at module level, after the imports):

```typescript
const DIA_CONFIG = [
  { type: 'CompanyRegistrationCredential', label: 'Company Registration', authority: 'MCA',        badge: '#1a73e8', diaLabel: 'DIA1', anchorKey: 'cin' },
  { type: 'IECCredential',                 label: 'IEC Credential',       authority: 'DGFT',       badge: '#667eea', diaLabel: 'DIA2', anchorKey: 'ieCode' },
  { type: 'GSTINCredential',               label: 'GSTIN Credential',     authority: 'GSTN',       badge: '#28a745', diaLabel: 'DIA3', anchorKey: 'gstin' },
  { type: 'PANCredential',                 label: 'PAN Credential',       authority: 'Income Tax', badge: '#e67e22', diaLabel: 'DIA4', anchorKey: 'pan' },
];
```

- [ ] **Step 2: Update `loadAll()` for corp-wallet tab**

Find the existing corp-wallet loading logic:
```typescript
else if (tab === 'corp-wallet') {
  const data = await api.getMyCredentials(token);
  const orgVC = (data.credentials || []).find(
    (c: any) => c.credential_type === 'OrganizationIdentityCredential'
  );
  setWalletVC(orgVC ? orgVC.vc_json : null);
}
```

Replace with:
```typescript
else if (tab === 'corp-wallet') {
  const data = await api.getMyCredentials(token);
  const creds = data.credentials || [];
  const vcMap: Record<string, any> = {};
  DIA_CONFIG.forEach(d => {
    const found = creds.find((c: any) => c.credential_type === d.type);
    if (found) vcMap[d.type] = typeof found.vc_json === 'string' ? JSON.parse(found.vc_json) : found.vc_json;
  });
  setWalletVCs(vcMap);
  // Backward compatibility: legacy OrganizationIdentityCredential
  const legacy = creds.find((c: any) => c.credential_type === 'OrganizationIdentityCredential');
  setLegacyVC(legacy ? (typeof legacy.vc_json === 'string' ? JSON.parse(legacy.vc_json) : legacy.vc_json) : null);
}
```

- [ ] **Step 3: Replace Corp Wallet tab content**

Find the existing `{tab === 'corp-wallet' && (` block. It spans from this line to its closing `)}`. Replace the entire block with:

```tsx
{tab === 'corp-wallet' && (
  <div>
    <h3 style={{ marginBottom: '1rem' }}>Corporate Identity Wallet</h3>

    {/* Trust Score Banner */}
    {(() => {
      const trustScore = DIA_CONFIG.filter(d => walletVCs[d.type]).length;
      const trustLabel = trustScore === 4
        ? 'Fully Verified (4/4)'
        : trustScore > 0
          ? `Partial Trust (${trustScore}/4)`
          : 'Unverified (0/4)';
      const trustColor = trustScore === 4 ? '#28a745' : trustScore > 0 ? '#ffa500' : '#dc3545';
      return (
        <div className="card" style={{ padding: '1rem', marginBottom: '1.5rem', display: 'flex', alignItems: 'center', gap: '1rem' }}>
          <div style={{ fontSize: '2rem', fontWeight: 700, color: trustColor }}>{trustScore}/4</div>
          <div>
            <div style={{ fontWeight: 600, color: trustColor }}>{trustLabel}</div>
            <div style={{ color: '#666', fontSize: '0.875rem' }}>Decentralized Identity Attestations received</div>
          </div>
        </div>
      );
    })()}

    {/* 4 DIA Cards in 2×2 grid */}
    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem', marginBottom: '1.5rem' }}>
      {DIA_CONFIG.map(dia => {
        const vc = walletVCs[dia.type];
        return (
          <div key={dia.type} className="card" style={{ padding: '1.25rem', border: vc ? `2px solid ${dia.badge}` : '2px solid #e2e8f0' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.75rem' }}>
              <div>
                <span style={{ background: dia.badge, color: '#fff', padding: '0.2rem 0.6rem', borderRadius: 12, fontSize: '0.7rem', fontWeight: 700, marginRight: '0.5rem' }}>{dia.authority}</span>
                <span style={{ background: '#e9ecef', color: '#495057', padding: '0.2rem 0.6rem', borderRadius: 12, fontSize: '0.7rem', fontWeight: 600 }}>{dia.diaLabel}</span>
              </div>
              {vc
                ? <span style={{ background: '#d4edda', color: '#155724', padding: '0.2rem 0.6rem', borderRadius: 12, fontSize: '0.7rem', fontWeight: 600 }}>✓ Issued</span>
                : <span style={{ background: '#f8d7da', color: '#721c24', padding: '0.2rem 0.6rem', borderRadius: 12, fontSize: '0.7rem', fontWeight: 600 }}>Pending</span>
              }
            </div>
            <div style={{ fontWeight: 600, marginBottom: '0.5rem', fontSize: '0.9rem' }}>{dia.label}</div>
            {vc ? (
              <div style={{ background: '#f8f9fa', borderRadius: 6, padding: '0.75rem' }}>
                <div style={{ fontSize: '0.75rem', color: '#888', marginBottom: '0.25rem' }}>Digital Identity Anchor</div>
                <div style={{ fontFamily: 'monospace', fontSize: '0.875rem', color: '#333', fontWeight: 600 }}>
                  {vc.credentialSubject?.[dia.anchorKey] || '—'}
                </div>
                <div style={{ fontSize: '0.75rem', color: '#888', marginTop: '0.5rem' }}>
                  Issuer: {vc.issuer?.substring(0, 30)}...
                </div>
              </div>
            ) : (
              <div style={{ color: '#aaa', fontSize: '0.875rem', fontStyle: 'italic' }}>
                Awaiting {dia.authority} approval
              </div>
            )}
          </div>
        );
      })}
    </div>

    {/* Legacy OrganizationIdentityCredential */}
    {legacyVC && (
      <div className="card" style={{ padding: '1.25rem', border: '1px dashed #ccc', marginTop: '1rem' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.5rem' }}>
          <h4 style={{ margin: 0, color: '#666' }}>Legacy Credential</h4>
          <span style={{ background: '#e2e8f0', color: '#555', padding: '0.2rem 0.6rem', borderRadius: 12, fontSize: '0.7rem' }}>OrganizationIdentityCredential</span>
        </div>
        <p style={{ color: '#888', fontSize: '0.875rem', margin: 0 }}>
          This credential was issued before the multi-authority upgrade. Your new DIA credentials above supersede it.
        </p>
      </div>
    )}
  </div>
)}
```

- [ ] **Step 4: Verify TypeScript compiles**

```bash
cd /Users/kamleshnagware/did-vc-project
npx tsc --noEmit --project tsconfig.json 2>&1 | grep -i "CorporateDashboard\|error" | head -20
```

Expected: no errors.

---

## Task 11: End-to-End Verification

- [ ] **Step 1: Start services**

```bash
# Ensure postgres
docker-compose up -d postgres
sleep 2

# Kill any existing backend, start fresh
pkill -f "tsx src/server" 2>/dev/null; sleep 1
DATABASE_URL=postgresql://didvc_user:didvc_pass@localhost:5433/didvc PORT=3002 \
  npx tsx src/server/index.ts &
sleep 2

# Frontend dev server (if not running)
npm run dev:frontend &
sleep 3
```

- [ ] **Step 2: Register 4 authority users**

```bash
# MCA
curl -s -X POST http://localhost:3002/api/auth/register \
  -H "Content-Type: application/json" \
  -d '{"email":"mca@gov.in","password":"password123","role":"government_agency","name":"MCA Authority","authority_type":"mca"}' | python3 -m json.tool

# DGFT
curl -s -X POST http://localhost:3002/api/auth/register \
  -H "Content-Type: application/json" \
  -d '{"email":"dgft@gov.in","password":"password123","role":"government_agency","name":"DGFT Authority","authority_type":"dgft"}' | python3 -m json.tool

# GSTN
curl -s -X POST http://localhost:3002/api/auth/register \
  -H "Content-Type: application/json" \
  -d '{"email":"gstn@gov.in","password":"password123","role":"government_agency","name":"GSTN Trust Anchor","authority_type":"gstn_trust_anchor"}' | python3 -m json.tool

# PAN
curl -s -X POST http://localhost:3002/api/auth/register \
  -H "Content-Type: application/json" \
  -d '{"email":"pan@gov.in","password":"password123","role":"government_agency","name":"PAN Trust Anchor","authority_type":"pan_trust_anchor"}' | python3 -m json.tool
```

Expected: all return `{"success":true,"token":"...","user":{..."authority_type":"mca"...}}`

- [ ] **Step 3: Submit org application**

Navigate to `http://localhost:3000/signup`. Fill and submit with:
- CIN: `L51100MH2010PLC201010`
- PAN: `AABCT9999E`
- GSTN: `27AABCT9999E1Z5`
- IE Code: `AABCT9999E`

Verify DB: `SELECT id, company_name, application_status FROM organization_applications ORDER BY created_at DESC LIMIT 1;`

Expected: status = `pending`

- [ ] **Step 4: MCA approves — verify scoped fields + first DIA VC**

Navigate to `http://localhost:3000/authority-login`. Log in as `mca@gov.in`.

Dashboard badge should say "MCA" in blue (#1a73e8).

Click Pending Requests → find the application → View Details.

Should see only 2 checkboxes: "CIN" and "Company Name" (not all 4 old fields).

Check both → Approve button enables → Click Approve.

Expected: success modal. Application status moves to `partial`.

Verify DB:
```bash
psql postgresql://didvc_user:didvc_pass@localhost:5433/didvc -c \
  "SELECT application_status, authority_verifications->'mca'->>'status' AS mca, authority_verifications->'dgft'->>'status' AS dgft FROM organization_applications ORDER BY created_at DESC LIMIT 1;"
```

Expected: `partial | approved | pending`

```bash
psql postgresql://didvc_user:didvc_pass@localhost:5433/didvc -c \
  "SELECT credential_type FROM credentials ORDER BY issued_at DESC LIMIT 1;"
```

Expected: `CompanyRegistrationCredential`

- [ ] **Step 5: DGFT approves — issues IECCredential**

Logout → login as `dgft@gov.in`. Dashboard badge = "DGFT" purple.

Pending Requests → application should be visible (DGFT slot still pending).

View Details → only "IE Code" checkbox visible.

Check it → Approve → success.

Verify: `IECCredential` row in credentials table.

Application status stays `partial` (2/4 done).

- [ ] **Step 6: GSTN and PAN approve**

Repeat for `gstn@gov.in` (sees only GSTN checkbox) and `pan@gov.in` (sees only PAN Number checkbox).

After 4th approval:
```bash
psql postgresql://didvc_user:didvc_pass@localhost:5433/didvc -c \
  "SELECT application_status FROM organization_applications ORDER BY created_at DESC LIMIT 1;"
```

Expected: `complete`

- [ ] **Step 7: Corporate login + Corp Wallet with 4 DIA cards**

Get temp password from backend console log: `[APPROVAL EMAIL] To: ... | Temp Password: ...`

Navigate to `http://localhost:3000/login`. Log in with corporate email + temp password.

In CorporateDashboard → click Corp Wallet tab.

Expected:
- Trust score banner: "Fully Verified (4/4)" in green
- 2×2 grid with 4 cards: MCA/DIA1 (blue, CIN), DGFT/DIA2 (purple, IE Code), GSTN/DIA3 (green, GSTN), Income Tax/DIA4 (orange, PAN)
- Each card shows "✓ Issued" badge and the DIA anchor value

- [ ] **Step 8: Scope rejection test — DGFT cannot verify CIN**

As DGFT officer, verify that attempting to verify CIN returns 400:
```bash
curl -s -X POST "http://localhost:3002/api/authority/organizations/<some-app-id>/verify-field" \
  -H "Authorization: Bearer $DGFT_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"field":"cin","verified":true}' | python3 -m json.tool
```

Expected: `{"error":"Field 'cin' is not in dgft scope. Allowed: ie_code"}`

- [ ] **Step 9: Register flow test — authority_type dropdown visible**

Navigate to `http://localhost:3000/register`.

Select "Government Agency (DGFT)" radio → authority type dropdown appears.

Select "Verifier / Relying Party" → dropdown disappears.

Select government_agency again → choose "MCA — Ministry of Corporate Affairs" → submit → verify registration succeeds and redirects to `/authority/dashboard`.

- [ ] **Step 10: Verify W3C VC structure for each type**

```bash
psql postgresql://didvc_user:didvc_pass@localhost:5433/didvc -t -c \
  "SELECT vc_json FROM credentials WHERE credential_type='CompanyRegistrationCredential' ORDER BY issued_at DESC LIMIT 1;" \
  | python3 -m json.tool
```

Expected JSON has: `@context`, `type: ["VerifiableCredential","CompanyRegistrationCredential"]`, `issuer`, `credentialSubject.cin`, `credentialSubject.digitalIdentityAnchor`, `proof.type: "EcdsaSecp256k1Signature2019"`
