# Corporate Registration & Home Page Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a dark marketing landing page with a DID Issuer strip, a 4-step corporate registration wizard with file uploads, a Portal Manager approval flow, and a DID Issuer issuance flow that mints a corporate DID + VCs on approval.

**Architecture:** DB schema extended with new columns on `organization_applications`; multer handles multipart file uploads to `uploads/corporate-docs/`; 7 new/updated API endpoints wire the full pending→activated→issued workflow; all frontend pages extended in-place following existing patterns (AppShell tabs, inline JSX, no new routes).

**Tech Stack:** Express + multer (file upload), PostgreSQL (JSONB documents column, status constraint update), React + TypeScript (existing pattern — no new dependencies on frontend)

---

## File Map

| File | Action | What changes |
|------|--------|--------------|
| `src/db/schema.sql` | Modify | Add 7 columns + update `application_status` constraint |
| `package.json` | Modify | Add `multer` + `@types/multer` |
| `src/server/index.ts` | Modify | multer setup, `buildCorporateVC`, 6 new endpoints, update apply endpoint |
| `src/frontend/pages/Dashboard.tsx` | Replace | Dark marketing landing page |
| `src/frontend/pages/OrganizationApplyPage.tsx` | Replace | 4-step registration wizard |
| `src/frontend/pages/PortalManagerDashboard.tsx` | Modify | Add Corp Applications tab |
| `src/frontend/pages/AuthorityDashboard.tsx` | Modify | Add Corp Applications tab (did_issuer_admin only) |
| `src/frontend/components/AppShell.tsx` | Modify | Add Corp Applications nav item for did_issuer_admin |

---

## Task 1: DB Schema — Add Columns & Update Status Constraint

**Files:**
- Modify: `src/db/schema.sql` (append at end of file)

- [ ] **Step 1: Read the tail of schema.sql to find the right insertion point**

Run: `tail -30 src/db/schema.sql`

Expected: last lines should be the `employee_credential_permissions` table and a `UNIQUE` constraint ending around line 460.

- [ ] **Step 2: Append schema migrations to schema.sql**

Add this block at the very end of `src/db/schema.sql`:

```sql
-- ─── Corporate Registration (2026-04-16) ──────────────────────────────────────

-- New columns on organization_applications for the self-registration flow
ALTER TABLE organization_applications ADD COLUMN IF NOT EXISTS super_admin_name    VARCHAR(255);
ALTER TABLE organization_applications ADD COLUMN IF NOT EXISTS super_admin_email   VARCHAR(255);
ALTER TABLE organization_applications ADD COLUMN IF NOT EXISTS requester_name      VARCHAR(255);
ALTER TABLE organization_applications ADD COLUMN IF NOT EXISTS requester_email     VARCHAR(255);
ALTER TABLE organization_applications ADD COLUMN IF NOT EXISTS documents           JSONB NOT NULL DEFAULT '[]';
ALTER TABLE organization_applications ADD COLUMN IF NOT EXISTS assigned_issuer_id  UUID REFERENCES users(id);
ALTER TABLE organization_applications ADD COLUMN IF NOT EXISTS corporate_user_id   UUID REFERENCES users(id);

-- Widen application_status to include 'activated' and 'issued'
-- (existing values: pending, partial, complete, rejected — keep all of them)
DO $$
BEGIN
  ALTER TABLE organization_applications DROP CONSTRAINT IF EXISTS chk_org_app_status;
  ALTER TABLE organization_applications ADD CONSTRAINT chk_org_app_status
    CHECK (application_status IN ('pending', 'partial', 'complete', 'rejected', 'activated', 'issued'));
END $$;
```

- [ ] **Step 3: Verify the migrations run cleanly**

Run: `npm run dev` (or `npx ts-node src/db/migrate.ts` if there's a standalone migrate script)

Expected: Server starts with no errors, schema migrations execute without `ERROR` lines. If you see `column "documents" of relation "organization_applications" already exists` — that's fine, the `IF NOT EXISTS` guards it.

Actually verify by checking: after server starts, run:
```bash
curl -s http://localhost:3002/health
```
Expected: `{"status":"ok","timestamp":"..."}` — server is up.

- [ ] **Step 4: Commit**

```bash
git add src/db/schema.sql
git commit -m "feat(db): add corporate registration columns + widen application_status constraint"
```

---

## Task 2: Install Multer + File Upload Plumbing + Public DID Issuers Endpoint

**Files:**
- Modify: `package.json`
- Modify: `src/server/index.ts` (imports, post-CORS setup, one new endpoint)

- [ ] **Step 1: Install multer**

```bash
npm install multer @types/multer
```

Expected: `package.json` gets `"multer": "^1.x.x"` and `"@types/multer": "^1.x.x"` in dependencies.

- [ ] **Step 2: Add multer imports to server**

In `src/server/index.ts`, directly after the existing import block (around line 10, after the `import { generateKeyPair } from '../utils/crypto.js';` line doesn't exist yet in that section — add after the `import cors from 'cors';` line), add:

```typescript
import multer from 'multer';
import fs from 'fs';
import path from 'path';
```

The import section at the top of the file should look like (existing imports preserved, new ones added):

```typescript
import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import crypto from 'crypto';
import multer from 'multer';
import fs from 'fs';
import path from 'path';
import { runMigrations } from '../db/migrate.js';
// ... rest of existing imports unchanged
```

- [ ] **Step 3: Add uploads directory + static serving + multer config**

In `src/server/index.ts`, locate this block (around line 30):
```typescript
const app = express();
const PORT = process.env.PORT || 3002;

app.use(cors());
app.use(express.json());
```

Replace it with:
```typescript
const app = express();
const PORT = process.env.PORT || 3002;

app.use(cors());
app.use(express.json());

// ─── File Uploads ─────────────────────────────────────────────────────────────

const UPLOADS_DIR = path.join(process.cwd(), 'uploads', 'corporate-docs');
if (!fs.existsSync(UPLOADS_DIR)) fs.mkdirSync(UPLOADS_DIR, { recursive: true });
app.use('/uploads', express.static(path.join(process.cwd(), 'uploads')));

const corpDocStorage = multer.diskStorage({
  destination: UPLOADS_DIR,
  filename: (_req, file, cb) => cb(null, `${Date.now()}-${file.originalname.replace(/\s+/g, '-')}`),
});
const corpDocUpload = multer({
  storage: corpDocStorage,
  limits: { fileSize: 5 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    const allowed = ['application/pdf', 'image/jpeg', 'image/png'];
    cb(null, allowed.includes(file.mimetype));
  },
});
```

- [ ] **Step 4: Add GET /api/public/did-issuers endpoint**

In `src/server/index.ts`, find the comment line `// ── Organization Application Routes ──────────────────────────────────────` (around line 2353). Immediately before that comment, insert:

```typescript
// ─── Public Endpoints ─────────────────────────────────────────────────────────

// Returns all active DID issuers — used on landing page + Portal Manager dropdown
app.get('/api/public/did-issuers', async (_req, res) => {
  try {
    const result = await query(
      `SELECT u.id, u.name, u.email
       FROM users u
       WHERE u.role = 'government_agency'
         AND u.sub_role = 'did_issuer_admin'
       ORDER BY u.name`,
      []
    );
    res.json({ success: true, issuers: result.rows });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});
```

- [ ] **Step 5: Verify the endpoint**

Start the server, then:
```bash
curl -s http://localhost:3002/api/public/did-issuers
```
Expected: `{"success":true,"issuers":[...]}` — array may be empty if no did_issuer_admin users exist yet, but the response must be `200 OK` with `success: true`.

- [ ] **Step 6: Commit**

```bash
git add package.json package-lock.json src/server/index.ts
git commit -m "feat: add multer upload plumbing and GET /api/public/did-issuers"
```

---

## Task 3: Update POST /api/organizations/apply (multipart + new fields)

**Files:**
- Modify: `src/server/index.ts` (around lines 2355–2396)

The existing endpoint accepts JSON. We replace it with a multer-powered multipart endpoint.

- [ ] **Step 1: Find the existing endpoint**

In `src/server/index.ts`, find this exact block (starting around line 2355):

```typescript
app.post('/api/organizations/apply', async (req, res) => {
  try {
    const {
      org_name, email, org_logo_url,
      director_full_name, aadhaar_number, dob, gender, state, pincode,
      company_name, cin, company_status, company_category, date_of_incorporation,
      pan_number, gstn, ie_code,
      director_name, din, designation, signing_authority_level
    } = req.body;

    const required = [org_name, email, director_full_name, aadhaar_number, dob, gender,
      state, pincode, company_name, cin, company_status, company_category,
      date_of_incorporation, pan_number, gstn, ie_code, director_name, din, designation];
    if (required.some(v => !v)) {
      return res.status(400).json({ error: 'All required fields must be provided' });
    }

    const existing = await query('SELECT id FROM organization_applications WHERE cin = $1', [cin]);
    if (existing.rows.length > 0) {
      return res.status(400).json({ error: 'An application with this CIN already exists' });
    }

    const result = await query(
      `INSERT INTO organization_applications
        (org_name, email, org_logo_url, director_full_name, aadhaar_number, dob, gender,
         state, pincode, company_name, cin, company_status, company_category,
         date_of_incorporation, pan_number, gstn, ie_code, director_name, din, designation,
         signing_authority_level)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21)
       RETURNING id`,
      [org_name, email, org_logo_url || null, director_full_name, aadhaar_number, dob, gender,
       state, pincode, company_name, cin, company_status, company_category,
       date_of_incorporation, pan_number, gstn, ie_code, director_name, din, designation,
       signing_authority_level || 'Single Signatory']
    );

    res.json({ success: true, applicationId: result.rows[0].id });
  } catch (error: any) {
    console.error('Apply error:', error);
    res.status(500).json({ error: error.message });
  }
});
```

- [ ] **Step 2: Replace it with the multipart version**

Replace the entire `app.post('/api/organizations/apply', ...)` block above with:

```typescript
app.post('/api/organizations/apply',
  corpDocUpload.fields([
    { name: 'doc_MCARegistration', maxCount: 1 },
    { name: 'doc_GSTINCredential', maxCount: 1 },
    { name: 'doc_IECCredential',   maxCount: 1 },
    { name: 'doc_PANCredential',   maxCount: 1 },
  ]),
  async (req, res) => {
    try {
      // multer puts text fields in req.body and files in req.files
      const {
        org_name, email, org_logo_url,
        director_full_name, aadhaar_number, dob, gender, state, pincode,
        company_name, cin, company_status, company_category, date_of_incorporation,
        pan_number, gstn, ie_code,
        director_name, din, designation, signing_authority_level,
        // new fields
        super_admin_name, super_admin_email,
        requester_name, requester_email,
        documents: documentsJson,
      } = req.body as Record<string, string>;

      // Validate required fields
      const requiredFields = [org_name, email, director_full_name, state, pincode,
        company_name, cin, company_status, company_category,
        date_of_incorporation, pan_number, company_name,
        super_admin_name, super_admin_email, requester_name, requester_email];
      if (requiredFields.some(v => !v)) {
        return res.status(400).json({ error: 'All required fields must be provided' });
      }

      // Duplicate CIN check
      const existing = await query('SELECT id FROM organization_applications WHERE cin = $1', [cin]);
      if (existing.rows.length > 0) {
        return res.status(400).json({ error: 'An application with this CIN already exists' });
      }

      // Parse documents JSON; attach file_paths from uploaded files
      let documents: any[] = [];
      try {
        documents = JSON.parse(documentsJson || '[]');
      } catch {
        return res.status(400).json({ error: 'Invalid documents JSON' });
      }

      const files = (req.files as Record<string, Express.Multer.File[]>) || {};
      documents = documents.map((doc: any) => {
        const fileField = `doc_${doc.vc_type}`;
        const uploaded = files[fileField]?.[0];
        return {
          ...doc,
          file_path: uploaded
            ? `uploads/corporate-docs/${uploaded.filename}`
            : null,
        };
      });

      // Validate MCA (required) document
      const mcaDoc = documents.find((d: any) => d.vc_type === 'MCARegistration');
      if (!mcaDoc) {
        return res.status(400).json({ error: 'MCA Registration document is required' });
      }

      const result = await query(
        `INSERT INTO organization_applications
          (org_name, email, org_logo_url, director_full_name, aadhaar_number, dob, gender,
           state, pincode, company_name, cin, company_status, company_category,
           date_of_incorporation, pan_number, gstn, ie_code, director_name, din, designation,
           signing_authority_level,
           super_admin_name, super_admin_email, requester_name, requester_email, documents)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,
                 $22,$23,$24,$25,$26)
         RETURNING id`,
        [
          org_name, email, org_logo_url || null,
          director_full_name || '', aadhaar_number || '', dob || '1990-01-01', gender || '',
          state, pincode, company_name, cin,
          company_status || 'Active', company_category || 'Private Limited',
          date_of_incorporation, pan_number, gstn || '', ie_code || '',
          director_name || '', din || '', designation || '', signing_authority_level || 'Single Signatory',
          super_admin_name, super_admin_email, requester_name, requester_email,
          JSON.stringify(documents),
        ]
      );

      res.json({ success: true, applicationId: result.rows[0].id });
    } catch (error: any) {
      console.error('Apply error:', error);
      res.status(500).json({ error: error.message });
    }
  }
);
```

- [ ] **Step 3: Smoke-test with curl**

```bash
curl -s -X POST http://localhost:3002/api/organizations/apply \
  -F "org_name=Test Corp" \
  -F "email=test@corp.com" \
  -F "director_full_name=Test Dir" \
  -F "aadhaar_number=123456789012" \
  -F "dob=1990-01-01" \
  -F "gender=Male" \
  -F "state=Maharashtra" \
  -F "pincode=400001" \
  -F "company_name=Test Corp Pvt Ltd" \
  -F "cin=U72900MH2020PTC999999" \
  -F "company_status=Active" \
  -F "company_category=Private Limited" \
  -F "date_of_incorporation=2020-01-01" \
  -F "pan_number=AABCT1234D" \
  -F "gstn=" \
  -F "ie_code=" \
  -F "director_name=Test Dir" \
  -F "din=12345678" \
  -F "designation=Director" \
  -F "super_admin_name=Admin User" \
  -F "super_admin_email=admin@testcorp.com" \
  -F "requester_name=Requester User" \
  -F "requester_email=requester@testcorp.com" \
  -F 'documents=[{"type":"MCARegistration","vc_type":"MCARegistration","reference_number":"U72900MH2020PTC999999","required":true}]'
```
Expected: `{"success":true,"applicationId":"<uuid>"}`.

- [ ] **Step 4: Commit**

```bash
git add src/server/index.ts
git commit -m "feat: update POST /api/organizations/apply to multipart with new fields"
```

---

## Task 4: Portal Manager Endpoints (List, Activate, Reject)

**Files:**
- Modify: `src/server/index.ts` (add 3 endpoints after the apply endpoint)

- [ ] **Step 1: Find the insertion point**

In `src/server/index.ts`, find the `app.get('/api/authority/organizations', ...)` endpoint (around line 2398). Insert the three new endpoints **before** that line.

- [ ] **Step 2: Add the three Portal Manager endpoints**

Insert immediately before `app.get('/api/authority/organizations', ...)`:

```typescript
// ─── Portal Manager: Corporate Applications ───────────────────────────────────

app.get('/api/portal/corporate-applications', requireAuth, requireRole('portal_manager'), async (req, res) => {
  try {
    const result = await query(
      `SELECT
         oa.id, oa.org_name, oa.company_name, oa.cin, oa.pan_number,
         oa.super_admin_name, oa.super_admin_email,
         oa.requester_name, oa.requester_email,
         oa.documents, oa.application_status, oa.rejection_reason,
         oa.created_at,
         u.name AS assigned_issuer_name, u.email AS assigned_issuer_email
       FROM organization_applications oa
       LEFT JOIN users u ON u.id = oa.assigned_issuer_id
       WHERE oa.application_status IN ('pending', 'activated', 'issued', 'rejected')
         AND oa.super_admin_email IS NOT NULL
       ORDER BY oa.created_at DESC`,
      []
    );
    res.json({ success: true, applications: result.rows });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

app.post('/api/portal/corporate-applications/:id/activate', requireAuth, requireRole('portal_manager'), async (req, res) => {
  try {
    const { id } = req.params;
    const { assigned_issuer_id } = req.body;
    if (!assigned_issuer_id) return res.status(400).json({ error: 'assigned_issuer_id required' });

    // Validate issuer is a did_issuer_admin
    const issuerCheck = await query(
      `SELECT id FROM users WHERE id = $1 AND role = 'government_agency' AND sub_role = 'did_issuer_admin'`,
      [assigned_issuer_id]
    );
    if (issuerCheck.rows.length === 0) {
      return res.status(400).json({ error: 'User is not a valid DID Issuer' });
    }

    const appCheck = await query(
      `SELECT id FROM organization_applications WHERE id = $1 AND application_status = 'pending'`,
      [id]
    );
    if (appCheck.rows.length === 0) {
      return res.status(404).json({ error: 'Application not found or not in pending state' });
    }

    await query(
      `UPDATE organization_applications
       SET application_status = 'activated', assigned_issuer_id = $1
       WHERE id = $2`,
      [assigned_issuer_id, id]
    );
    res.json({ success: true });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

app.post('/api/portal/corporate-applications/:id/reject', requireAuth, requireRole('portal_manager'), async (req, res) => {
  try {
    const { id } = req.params;
    const { rejection_reason } = req.body;

    const appCheck = await query(
      `SELECT id FROM organization_applications WHERE id = $1 AND application_status = 'pending'`,
      [id]
    );
    if (appCheck.rows.length === 0) {
      return res.status(404).json({ error: 'Application not found or not in pending state' });
    }

    await query(
      `UPDATE organization_applications
       SET application_status = 'rejected', rejection_reason = $1
       WHERE id = $2`,
      [rejection_reason || null, id]
    );
    res.json({ success: true });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});
```

- [ ] **Step 3: Smoke-test list endpoint (requires portal_manager token)**

```bash
# 1. Login as portal_manager
TOKEN=$(curl -s -X POST http://localhost:3002/api/auth/login \
  -H 'Content-Type: application/json' \
  -d '{"email":"portal@platform.com","password":"your-portal-password"}' \
  | jq -r '.token')

# 2. List corp applications
curl -s http://localhost:3002/api/portal/corporate-applications \
  -H "Authorization: Bearer $TOKEN"
```
Expected: `{"success":true,"applications":[...]}` — includes the test application from Task 3.

- [ ] **Step 4: Commit**

```bash
git add src/server/index.ts
git commit -m "feat: add Portal Manager corporate-applications endpoints (list/activate/reject)"
```

---

## Task 5: DID Issuer Endpoints + buildCorporateVC

**Files:**
- Modify: `src/server/index.ts` (add `buildCorporateVC` function + 2 endpoints)

- [ ] **Step 1: Add the buildCorporateVC helper function**

In `src/server/index.ts`, find the `buildDIAVC` function (around line 2288). Immediately after that function (after its closing `}` and before `// ── Organization Application Routes`), add:

```typescript
function buildCorporateVC(vcType: string, app: any, issuerDid: any, holderDid: string, expiresAt: Date) {
  const vcId = crypto.randomUUID();
  const now = new Date();
  const doc = (app.documents || []).find((d: any) => d.vc_type === vcType) || {};
  const base = {
    '@context': ['https://www.w3.org/2018/credentials/v1'],
    id: `urn:uuid:${vcId}`,
    issuer: issuerDid.did_string,
    issuanceDate: now.toISOString(),
    expirationDate: expiresAt.toISOString(),
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
    MCARegistration: {
      type: ['VerifiableCredential', 'MCARegistration'],
      credentialSubject: {
        id: holderDid,
        companyName: app.company_name,
        cin: app.cin,
        companyStatus: app.company_status,
        companyCategory: app.company_category,
        dateOfIncorporation: app.date_of_incorporation,
        registrationNumber: doc.reference_number || app.cin,
      },
    },
    GSTINCredential: {
      type: ['VerifiableCredential', 'GSTINCredential'],
      credentialSubject: {
        id: holderDid,
        companyName: app.company_name,
        gstin: doc.reference_number || app.gstn,
      },
    },
    IECCredential: {
      type: ['VerifiableCredential', 'IECCredential'],
      credentialSubject: {
        id: holderDid,
        companyName: app.company_name,
        ieCode: doc.reference_number || app.ie_code,
      },
    },
    PANCredential: {
      type: ['VerifiableCredential', 'PANCredential'],
      credentialSubject: {
        id: holderDid,
        companyName: app.company_name,
        pan: doc.reference_number || app.pan_number,
      },
    },
  };
  return { ...base, ...(subjectMap[vcType] || { type: ['VerifiableCredential', vcType], credentialSubject: { id: holderDid } }) };
}
```

- [ ] **Step 2: Add DID Issuer list endpoint**

After the Portal Manager endpoints added in Task 4 (after `app.post('/api/portal/corporate-applications/:id/reject', ...)`), insert:

```typescript
// ─── DID Issuer: Corporate Applications ──────────────────────────────────────

app.get('/api/did-issuer/corporate-applications', requireAuth, requireRole('government_agency'), async (req, res) => {
  try {
    const issuerId = (req as any).user.id;
    const subRole: string = (req as any).user.sub_role || '';
    if (subRole !== 'did_issuer_admin') {
      return res.status(403).json({ error: 'did_issuer_admin sub_role required' });
    }
    const result = await query(
      `SELECT id, org_name, company_name, cin, pan_number,
              super_admin_name, super_admin_email, requester_name, requester_email,
              documents, application_status, created_at
       FROM organization_applications
       WHERE assigned_issuer_id = $1 AND application_status = 'activated'
       ORDER BY created_at DESC`,
      [issuerId]
    );
    res.json({ success: true, applications: result.rows });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});
```

- [ ] **Step 3: Add DID Issuer issue endpoint**

Immediately after the GET endpoint above, insert:

```typescript
app.post('/api/did-issuer/corporate-applications/:id/issue', requireAuth, requireRole('government_agency'), async (req, res) => {
  try {
    const issuerId = (req as any).user.id;
    const subRole: string = (req as any).user.sub_role || '';
    if (subRole !== 'did_issuer_admin') {
      return res.status(403).json({ error: 'did_issuer_admin sub_role required' });
    }

    const { id } = req.params;
    const { vc_types }: { vc_types: string[] } = req.body;
    if (!vc_types || vc_types.length === 0) {
      return res.status(400).json({ error: 'vc_types array required' });
    }

    // Load application
    const appResult = await query(
      `SELECT * FROM organization_applications WHERE id = $1`,
      [id]
    );
    if (appResult.rows.length === 0) return res.status(404).json({ error: 'Application not found' });
    const app = appResult.rows[0];
    if (app.application_status !== 'activated') return res.status(400).json({ error: 'Application is not in activated state' });
    if (app.assigned_issuer_id !== issuerId) return res.status(403).json({ error: 'Application is assigned to a different issuer' });

    // Load issuer's parent DID for signing
    const issuerDidResult = await query(
      `SELECT id, did_string, private_key_encrypted FROM dids
       WHERE user_id = $1 AND did_type = 'parent' ORDER BY created_at DESC LIMIT 1`,
      [issuerId]
    );
    if (issuerDidResult.rows.length === 0) return res.status(400).json({ error: 'Issuer has no parent DID' });
    const issuerDid = issuerDidResult.rows[0];

    // Generate temp passwords
    const superAdminTempPass = crypto.randomBytes(8).toString('hex');
    const requesterTempPass = crypto.randomBytes(8).toString('hex');
    const superAdminHash = await hashPassword(superAdminTempPass);
    const requesterHash = await hashPassword(requesterTempPass);

    // All operations in a transaction
    await query('BEGIN', []);
    try {
      // 1. Create super_admin user
      const superAdminResult = await query(
        `INSERT INTO users (email, password_hash, role, name, sub_role)
         VALUES ($1, $2, 'corporate', $3, 'super_admin')
         RETURNING id`,
        [app.super_admin_email, superAdminHash, app.company_name]
      );
      const superAdminId = superAdminResult.rows[0].id;

      // 2. Set org_id = superAdminId (self-owns)
      await query(`UPDATE users SET org_id = $1 WHERE id = $1`, [superAdminId]);

      // 3. Create corporate parent DID
      const slug = app.company_name.toLowerCase().replace(/[^a-z0-9]/g, '-').replace(/-+/g, '-');
      const corporateDid = await createAndStoreDID(superAdminId, 'parent', undefined, slug);

      // 4. Create requester user
      const requesterResult = await query(
        `INSERT INTO users (email, password_hash, role, name, sub_role, org_id)
         VALUES ($1, $2, 'corporate', $3, 'requester', $4)
         RETURNING id`,
        [app.requester_email, requesterHash, app.requester_name, superAdminId]
      );
      const requesterId = requesterResult.rows[0].id;

      // 5. Issue selected VCs
      const expiresAt = new Date(Date.now() + 365 * 24 * 60 * 60 * 1000);
      for (const vcType of vc_types) {
        const vcJson = buildCorporateVC(vcType, app, issuerDid, corporateDid.did, expiresAt);
        await query(
          `INSERT INTO credentials (vc_json, holder_did_id, issuer_did_id, credential_type, issued_at, expires_at)
           VALUES ($1, $2, $3, $4, NOW(), $5)`,
          [JSON.stringify(vcJson), corporateDid.id, issuerDid.id, vcType, expiresAt]
        );
      }

      // 6. Mark application as issued
      await query(
        `UPDATE organization_applications
         SET application_status = 'issued', corporate_user_id = $1
         WHERE id = $2`,
        [superAdminId, id]
      );

      await query('COMMIT', []);

      // Log temp passwords (email delivery is future scope)
      console.log(`[ISSUED] super_admin: ${app.super_admin_email} | password: ${superAdminTempPass} | requester: ${app.requester_email} | password: ${requesterTempPass}`);

      res.json({
        success: true,
        corporateDid: corporateDid.did,
        super_admin_email: app.super_admin_email,
        super_admin_temp_password: superAdminTempPass,
        requester_email: app.requester_email,
        requester_temp_password: requesterTempPass,
        vcs_issued: vc_types.length,
      });
    } catch (txErr: any) {
      await query('ROLLBACK', []);
      throw txErr;
    }
  } catch (error: any) {
    console.error('Issue error:', error);
    res.status(500).json({ error: error.message });
  }
});
```

- [ ] **Step 4: Verify server compiles and starts**

```bash
npm run dev
```
Expected: Server starts on port 3002, no TypeScript errors.

- [ ] **Step 5: Commit**

```bash
git add src/server/index.ts
git commit -m "feat: add buildCorporateVC + DID Issuer corporate-applications endpoints"
```

---

## Task 6: Dashboard.tsx — Dark Marketing Landing Page

**Files:**
- Replace: `src/frontend/pages/Dashboard.tsx`

- [ ] **Step 1: Replace Dashboard.tsx entirely**

Replace the full contents of `src/frontend/pages/Dashboard.tsx` with:

```tsx
import React, { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';

const roleDefaultPath: Record<string, string> = {
  corporate: '/corporate/dashboard',
  government_agency: '/authority/dashboard',
  verifier: '/verifier/dashboard',
  portal_manager: '/portal/dashboard',
};

type Issuer = { id: string; name: string; email: string };

const Dashboard: React.FC = () => {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [issuers, setIssuers] = useState<Issuer[]>([]);

  useEffect(() => {
    if (user) navigate(roleDefaultPath[user.role] ?? '/', { replace: true });
  }, [user, navigate]);

  useEffect(() => {
    fetch('/api/public/did-issuers')
      .then(r => r.json())
      .then(d => { if (d.success) setIssuers(d.issuers || []); })
      .catch(() => {});
  }, []);

  if (user) return null;

  return (
    <div style={{ fontFamily: 'Inter, system-ui, sans-serif', minHeight: '100vh' }}>

      {/* ── Top Nav ── */}
      <nav style={{ background: '#0f172a', padding: '0.75rem 2rem', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <span style={{ color: 'white', fontWeight: 800, fontSize: '1.1rem', letterSpacing: '-0.02em' }}>
          🔐 DID·VC Platform
        </span>
        <div style={{ display: 'flex', gap: '1rem', alignItems: 'center' }}>
          <Link to="/login" style={{ color: '#94a3b8', textDecoration: 'none', fontSize: '0.875rem' }}>Login</Link>
          <Link to="/signup" style={{
            background: '#2563eb', color: 'white', textDecoration: 'none',
            padding: '0.4rem 1rem', borderRadius: 6, fontSize: '0.875rem', fontWeight: 600,
          }}>Register Corporate →</Link>
        </div>
      </nav>

      {/* ── Hero ── */}
      <section style={{ background: 'linear-gradient(135deg, #1e3a5f, #0f172a)', padding: '5rem 2rem', textAlign: 'center' }}>
        <div style={{ fontSize: '0.75rem', color: '#60a5fa', fontWeight: 700, letterSpacing: '0.15em', marginBottom: '1.25rem', textTransform: 'uppercase' }}>
          India's Decentralised Identity Network
        </div>
        <h1 style={{ fontSize: 'clamp(1.75rem, 4vw, 3rem)', color: 'white', fontWeight: 800, marginBottom: '0.75rem', lineHeight: 1.2 }}>
          Verifiable Credentials for<br />Indian Enterprises
        </h1>
        <p style={{ color: '#94a3b8', fontSize: '1.1rem', marginBottom: '2.5rem' }}>
          Issue · Verify · Share
        </p>
        <Link to="/signup" style={{
          background: '#2563eb', color: 'white', textDecoration: 'none',
          padding: '0.8rem 2rem', borderRadius: 8, fontSize: '1rem', fontWeight: 700,
          display: 'inline-block',
        }}>
          Register Your Corporate →
        </Link>
      </section>

      {/* ── DID Issuers Strip ── */}
      <section style={{ background: '#f8fafc', padding: '2rem', borderTop: '1px solid #e2e8f0', borderBottom: '1px solid #e2e8f0' }}>
        <div style={{ textAlign: 'center', fontSize: '0.7rem', fontWeight: 700, color: '#94a3b8', letterSpacing: '0.12em', textTransform: 'uppercase', marginBottom: '1rem' }}>
          Trusted DID Issuers
        </div>
        {issuers.length === 0 ? (
          <p style={{ textAlign: 'center', color: '#cbd5e1', fontSize: '0.85rem' }}>Loading issuers…</p>
        ) : (
          <div style={{ display: 'flex', justifyContent: 'center', flexWrap: 'wrap', gap: '0.75rem' }}>
            {issuers.map(issuer => (
              <span key={issuer.id} style={{
                background: 'white', border: '1px solid #e2e8f0',
                borderRadius: 8, padding: '0.4rem 1rem',
                fontSize: '0.85rem', fontWeight: 700, color: '#1e293b',
              }}>
                {issuer.name}
              </span>
            ))}
          </div>
        )}
      </section>

      {/* ── How It Works ── */}
      <section style={{ background: 'white', padding: '4rem 2rem' }}>
        <h2 style={{ textAlign: 'center', fontSize: '1.5rem', fontWeight: 800, color: '#0f172a', marginBottom: '3rem' }}>
          How It Works
        </h2>
        <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', gap: '0.5rem', flexWrap: 'wrap', maxWidth: 700, margin: '0 auto' }}>
          {[
            { icon: '📋', label: 'Register', sub: 'Submit company info & documents' },
            { icon: '✅', label: 'Portal Review', sub: 'Portal Manager activates' },
            { icon: '🔑', label: 'Get DID', sub: 'DID Issuer mints your DID' },
            { icon: '🎖', label: 'Get VCs', sub: 'Credentials issued to wallet' },
          ].map((step, i, arr) => (
            <React.Fragment key={step.label}>
              <div style={{ textAlign: 'center', flex: '1 1 120px', minWidth: 100 }}>
                <div style={{ fontSize: '2rem', marginBottom: '0.5rem' }}>{step.icon}</div>
                <div style={{ fontWeight: 700, color: '#0f172a', fontSize: '0.9rem' }}>{step.label}</div>
                <div style={{ color: '#64748b', fontSize: '0.75rem', marginTop: '0.25rem' }}>{step.sub}</div>
              </div>
              {i < arr.length - 1 && (
                <div style={{ color: '#d1d5db', fontSize: '1.5rem', flexShrink: 0 }}>→</div>
              )}
            </React.Fragment>
          ))}
        </div>
      </section>

      {/* ── Role Cards ── */}
      <section style={{ background: '#f8fafc', padding: '4rem 2rem' }}>
        <div style={{ maxWidth: 900, margin: '0 auto', display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))', gap: '1.5rem' }}>
          {[
            { title: 'Corporate', icon: '🏢', desc: 'Register your company, get a decentralised DID, and receive government-issued verifiable credentials.' },
            { title: 'Govt Issuer', icon: '🏛', desc: 'Issue MCA, GSTIN, IEC, and PAN credentials to verified enterprises on your network.' },
            { title: 'Verifier', icon: '🔍', desc: 'Send proof requests to corporate employees and verify credentials instantly.' },
          ].map(card => (
            <div key={card.title} style={{
              background: 'white', borderRadius: 12, padding: '1.75rem',
              border: '1px solid #e2e8f0', boxShadow: '0 1px 3px rgba(0,0,0,0.06)',
            }}>
              <div style={{ fontSize: '2rem', marginBottom: '0.75rem' }}>{card.icon}</div>
              <h3 style={{ fontWeight: 700, color: '#0f172a', marginBottom: '0.5rem' }}>{card.title}</h3>
              <p style={{ color: '#64748b', fontSize: '0.875rem', lineHeight: 1.6 }}>{card.desc}</p>
            </div>
          ))}
        </div>
      </section>

      {/* ── Footer ── */}
      <footer style={{ background: '#0f172a', padding: '1.5rem 2rem', textAlign: 'center' }}>
        <span style={{ color: '#475569', fontSize: '0.8rem' }}>DID·VC Platform — India's Decentralised Identity Network</span>
      </footer>
    </div>
  );
};

export default Dashboard;
```

- [ ] **Step 2: Verify in browser**

Start the dev server (`npm run dev` in the frontend, or your project's equivalent). Navigate to `http://localhost:5173/` (or whatever the dev port is). Expected:
- Dark navy nav with "DID·VC Platform" + "Login" link + "Register Corporate →" button
- Dark gradient hero with headline "Verifiable Credentials for Indian Enterprises"
- Light issuer strip showing `{name}` pills from the API (or "Loading issuers…" if empty)
- White "How It Works" section with 4 icon steps
- Light role cards section (Corporate, Govt Issuer, Verifier)
- Dark footer

- [ ] **Step 3: Commit**

```bash
git add src/frontend/pages/Dashboard.tsx
git commit -m "feat(ui): dark marketing landing page with DID issuer strip"
```

---

## Task 7: OrganizationApplyPage.tsx — 4-Step Wizard

**Files:**
- Replace: `src/frontend/pages/OrganizationApplyPage.tsx`

- [ ] **Step 1: Replace OrganizationApplyPage.tsx entirely**

Replace the full contents of `src/frontend/pages/OrganizationApplyPage.tsx` with:

```tsx
import React, { useState, useRef } from 'react';
import { useNavigate } from 'react-router-dom';

const COMPANY_CATEGORIES = ['Private Limited', 'Public Limited', 'LLP', 'OPC', 'Section 8'];

type DocumentBlock = {
  vc_type: string;
  type: string;
  label: string;
  required: boolean;
  reference_field: string;
  reference_placeholder: string;
};

const DOCUMENT_BLOCKS: DocumentBlock[] = [
  { vc_type: 'MCARegistration', type: 'MCARegistration', label: 'MCA Registration Certificate', required: true, reference_field: 'ref_MCARegistration', reference_placeholder: 'e.g. U72900MH2020PTC123456' },
  { vc_type: 'GSTINCredential', type: 'GSTINCredential', label: 'GSTIN Certificate', required: false, reference_field: 'ref_GSTINCredential', reference_placeholder: 'e.g. 27AABCU9603R1Z5' },
  { vc_type: 'IECCredential', type: 'IECCredential', label: 'IEC (Import Export Code)', required: false, reference_field: 'ref_IECCredential', reference_placeholder: 'e.g. ABCDE1234F' },
  { vc_type: 'PANCredential', type: 'PANCredential', label: 'PAN Card', required: false, reference_field: 'ref_PANCredential', reference_placeholder: 'e.g. AABCU9603R' },
];

export default function OrganizationApplyPage() {
  const navigate = useNavigate();
  const [step, setStep] = useState(1);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [applicationId, setApplicationId] = useState('');

  // Step 1 — Company Info
  const [form, setForm] = useState({
    org_name: '', cin: '', pan_number: '', gstn: '', state: '', pincode: '',
    date_of_incorporation: '', company_status: 'Active', company_category: 'Private Limited',
    // legacy director fields (kept for schema compatibility)
    director_full_name: '', aadhaar_number: '000000000000', dob: '1990-01-01', gender: 'Male',
    director_name: '', din: '00000000', designation: 'Director',
  });

  // Step 2 — Key People
  const [people, setPeople] = useState({
    super_admin_name: '', super_admin_email: '',
    requester_name: '', requester_email: '',
  });

  // Step 3 — Documents
  const [refs, setRefs] = useState<Record<string, string>>({});
  const [files, setFiles] = useState<Record<string, File | null>>({});
  const fileInputRefs = useRef<Record<string, HTMLInputElement | null>>({});

  const setFormField = (k: string) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) =>
    setForm(f => ({ ...f, [k]: e.target.value }));
  const setPeopleField = (k: string) => (e: React.ChangeEvent<HTMLInputElement>) =>
    setPeople(p => ({ ...p, [k]: e.target.value }));
  const setRef = (k: string) => (e: React.ChangeEvent<HTMLInputElement>) =>
    setRefs(r => ({ ...r, [k]: e.target.value }));
  const setFile = (vcType: string, f: File | null) =>
    setFiles(prev => ({ ...prev, [vcType]: f }));

  function validateStep1() {
    const missing = ['org_name', 'cin', 'pan_number', 'state', 'pincode', 'date_of_incorporation']
      .filter(k => !(form as any)[k]);
    if (missing.length) { setError(`Please fill in: ${missing.join(', ')}`); return false; }
    setError(''); return true;
  }

  function validateStep2() {
    const { super_admin_name, super_admin_email, requester_name, requester_email } = people;
    if (!super_admin_name || !super_admin_email || !requester_name || !requester_email) {
      setError('All key people fields are required'); return false;
    }
    setError(''); return true;
  }

  function validateStep3() {
    const mcaRef = refs['ref_MCARegistration'];
    if (!mcaRef) { setError('MCA Registration reference number is required'); return false; }
    setError(''); return true;
  }

  async function handleSubmit() {
    setLoading(true);
    setError('');
    try {
      const fd = new FormData();

      // Company info
      Object.entries(form).forEach(([k, v]) => fd.append(k, v));
      fd.set('company_name', form.org_name); // org_name is the company name
      fd.set('email', people.super_admin_email);
      fd.set('ie_code', '');

      // Key people
      Object.entries(people).forEach(([k, v]) => fd.append(k, v));

      // Documents JSON (without file_path — server attaches from uploaded files)
      const documents = DOCUMENT_BLOCKS
        .filter(b => refs[b.reference_field] || files[b.vc_type])
        .map(b => ({
          type: b.type,
          vc_type: b.vc_type,
          reference_number: refs[b.reference_field] || '',
          required: b.required,
        }));
      fd.append('documents', JSON.stringify(documents));

      // File uploads
      DOCUMENT_BLOCKS.forEach(b => {
        const f = files[b.vc_type];
        if (f) fd.append(`doc_${b.vc_type}`, f);
      });

      const res = await fetch('/api/organizations/apply', { method: 'POST', body: fd });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Submission failed');
      setApplicationId(data.applicationId);
      setStep(5); // success screen
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  // ── Success screen ──
  if (step === 5) {
    return (
      <div style={{ minHeight: '100vh', background: '#f1f5f9', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '2rem' }}>
        <div style={{ background: 'white', borderRadius: 12, padding: '2.5rem', maxWidth: 480, width: '100%', textAlign: 'center', boxShadow: '0 4px 24px rgba(0,0,0,0.08)' }}>
          <div style={{ fontSize: '3rem', marginBottom: '1rem' }}>✅</div>
          <h2 style={{ color: '#16a34a', marginBottom: '0.5rem', fontWeight: 800 }}>Application Submitted!</h2>
          <p style={{ color: '#64748b', marginBottom: '1rem', lineHeight: 1.6 }}>
            Your application ID is:
          </p>
          <code style={{ background: '#f1f5f9', padding: '0.5rem 1rem', borderRadius: 6, fontSize: '0.8rem', color: '#1e293b', display: 'block', marginBottom: '1.5rem', wordBreak: 'break-all' }}>
            {applicationId}
          </code>
          <p style={{ color: '#64748b', fontSize: '0.875rem', marginBottom: '2rem' }}>
            We'll email you when your corporate DID is ready. Portal Manager reviews → DID Issuer issues your DID + credentials.
          </p>
          <button style={{ background: '#2563eb', color: 'white', border: 'none', padding: '0.75rem 2rem', borderRadius: 8, fontWeight: 700, cursor: 'pointer', fontSize: '0.9rem' }}
            onClick={() => navigate('/login')}>
            Go to Login
          </button>
        </div>
      </div>
    );
  }

  const progressPct = ((step - 1) / 3) * 100;

  return (
    <div style={{ minHeight: '100vh', background: '#f1f5f9', padding: '2rem 1rem' }}>
      <div style={{ maxWidth: 640, margin: '0 auto' }}>

        {/* Header */}
        <div style={{ textAlign: 'center', marginBottom: '2rem' }}>
          <h1 style={{ color: '#0f172a', fontWeight: 800, fontSize: '1.5rem', marginBottom: '0.25rem' }}>Corporate Registration</h1>
          <p style={{ color: '#64748b', fontSize: '0.875rem' }}>Step {step} of 4</p>
        </div>

        {/* Progress bar */}
        <div style={{ display: 'flex', gap: 6, marginBottom: '2rem' }}>
          {[1, 2, 3, 4].map(s => (
            <div key={s} style={{ flex: 1, height: 4, borderRadius: 2, background: s <= step ? '#2563eb' : '#e2e8f0', transition: 'background 0.3s' }} />
          ))}
        </div>

        <div style={{ background: 'white', borderRadius: 12, padding: '2rem', boxShadow: '0 2px 8px rgba(0,0,0,0.06)' }}>
          {error && (
            <div style={{ background: '#fef2f2', border: '1px solid #fecaca', color: '#dc2626', padding: '0.75rem 1rem', borderRadius: 8, marginBottom: '1.5rem', fontSize: '0.875rem' }}>
              {error}
            </div>
          )}

          {/* ── Step 1: Company Information ── */}
          {step === 1 && (
            <>
              <h2 style={{ fontWeight: 700, color: '#0f172a', marginBottom: '1.5rem', fontSize: '1.1rem' }}>Company Information</h2>
              <div style={{ marginBottom: '1rem' }}>
                <label style={{ display: 'block', fontWeight: 600, fontSize: '0.85rem', marginBottom: '0.35rem', color: '#374151' }}>Company Name *</label>
                <input style={inputStyle} value={form.org_name} onChange={setFormField('org_name')} placeholder="e.g. FSV Labs Pvt Ltd" />
              </div>
              <div style={{ marginBottom: '1rem' }}>
                <label style={{ display: 'block', fontWeight: 600, fontSize: '0.85rem', marginBottom: '0.35rem', color: '#374151' }}>CIN (Corporate Identification No.) *</label>
                <input style={inputStyle} value={form.cin} onChange={setFormField('cin')} placeholder="e.g. U72900MH2020PTC123456" maxLength={21} />
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem', marginBottom: '1rem' }}>
                <div>
                  <label style={labelStyle}>PAN Number *</label>
                  <input style={inputStyle} value={form.pan_number} onChange={setFormField('pan_number')} placeholder="AABCU9603R" maxLength={10} />
                </div>
                <div>
                  <label style={labelStyle}>GSTIN (optional)</label>
                  <input style={inputStyle} value={form.gstn} onChange={setFormField('gstn')} placeholder="27AABCU9603R1Z5" maxLength={15} />
                </div>
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem', marginBottom: '1rem' }}>
                <div>
                  <label style={labelStyle}>State *</label>
                  <input style={inputStyle} value={form.state} onChange={setFormField('state')} placeholder="Maharashtra" />
                </div>
                <div>
                  <label style={labelStyle}>Pincode *</label>
                  <input style={inputStyle} value={form.pincode} onChange={setFormField('pincode')} placeholder="400001" maxLength={6} />
                </div>
              </div>
              <div style={{ marginBottom: '1rem' }}>
                <label style={labelStyle}>Date of Incorporation *</label>
                <input style={inputStyle} type="date" value={form.date_of_incorporation} onChange={setFormField('date_of_incorporation')} />
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem', marginBottom: '1.5rem' }}>
                <div>
                  <label style={labelStyle}>Company Status</label>
                  <select style={inputStyle} value={form.company_status} onChange={setFormField('company_status')}>
                    <option>Active</option><option>Inactive</option>
                  </select>
                </div>
                <div>
                  <label style={labelStyle}>Category</label>
                  <select style={inputStyle} value={form.company_category} onChange={setFormField('company_category')}>
                    {COMPANY_CATEGORIES.map(c => <option key={c}>{c}</option>)}
                  </select>
                </div>
              </div>
              <button style={nextBtnStyle} onClick={() => { if (validateStep1()) setStep(2); }}>
                Next →
              </button>
            </>
          )}

          {/* ── Step 2: Key People ── */}
          {step === 2 && (
            <>
              <h2 style={{ fontWeight: 700, color: '#0f172a', marginBottom: '1.5rem', fontSize: '1.1rem' }}>Key People</h2>

              {/* Super Admin */}
              <div style={{ background: '#eff6ff', borderRadius: 8, padding: '1rem', marginBottom: '1rem', border: '1px solid #bfdbfe' }}>
                <div style={{ fontWeight: 700, color: '#2563eb', marginBottom: '0.75rem', fontSize: '0.9rem' }}>👤 Super Admin</div>
                <div style={{ marginBottom: '0.75rem' }}>
                  <label style={labelStyle}>Full Name *</label>
                  <input style={{ ...inputStyle, borderColor: '#bfdbfe' }} value={people.super_admin_name} onChange={setPeopleField('super_admin_name')} placeholder="Kamlesh Nagware" />
                </div>
                <div>
                  <label style={labelStyle}>Email *</label>
                  <input style={{ ...inputStyle, borderColor: '#bfdbfe' }} type="email" value={people.super_admin_email} onChange={setPeopleField('super_admin_email')} placeholder="admin@company.com" />
                </div>
              </div>

              {/* Requester */}
              <div style={{ background: '#f0fdf4', borderRadius: 8, padding: '1rem', marginBottom: '1.5rem', border: '1px solid #bbf7d0' }}>
                <div style={{ fontWeight: 700, color: '#16a34a', marginBottom: '0.75rem', fontSize: '0.9rem' }}>📋 Corporate Requester</div>
                <div style={{ marginBottom: '0.75rem' }}>
                  <label style={labelStyle}>Full Name *</label>
                  <input style={{ ...inputStyle, borderColor: '#bbf7d0' }} value={people.requester_name} onChange={setPeopleField('requester_name')} placeholder="Priya Sharma" />
                </div>
                <div>
                  <label style={labelStyle}>Email *</label>
                  <input style={{ ...inputStyle, borderColor: '#bbf7d0' }} type="email" value={people.requester_email} onChange={setPeopleField('requester_email')} placeholder="requester@company.com" />
                </div>
              </div>

              <div style={{ display: 'flex', gap: '0.75rem' }}>
                <button style={backBtnStyle} onClick={() => setStep(1)}>← Back</button>
                <button style={{ ...nextBtnStyle, flex: 2 }} onClick={() => { if (validateStep2()) setStep(3); }}>Next →</button>
              </div>
            </>
          )}

          {/* ── Step 3: Supporting Documents ── */}
          {step === 3 && (
            <>
              <h2 style={{ fontWeight: 700, color: '#0f172a', marginBottom: '0.5rem', fontSize: '1.1rem' }}>Supporting Documents</h2>
              <p style={{ color: '#64748b', fontSize: '0.8rem', marginBottom: '1.5rem' }}>Each uploaded document generates one Verifiable Credential on approval.</p>

              {DOCUMENT_BLOCKS.map(block => (
                <div key={block.vc_type} style={{ border: '1px solid #e2e8f0', borderRadius: 8, padding: '1rem', marginBottom: '0.75rem', background: '#f8fafc' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.75rem' }}>
                    <span style={{ fontWeight: 700, fontSize: '0.9rem', color: '#1e293b' }}>{block.label}</span>
                    <span style={{
                      background: block.required ? '#dcfce7' : '#f1f5f9',
                      color: block.required ? '#16a34a' : '#64748b',
                      fontSize: '0.65rem', fontWeight: 700, padding: '2px 8px', borderRadius: 8,
                    }}>
                      {block.required ? 'REQUIRED' : 'OPTIONAL'}
                    </span>
                  </div>
                  <div style={{ marginBottom: '0.5rem' }}>
                    <label style={labelStyle}>Reference Number{block.required ? ' *' : ''}</label>
                    <input style={{ ...inputStyle, background: 'white' }}
                      value={refs[block.reference_field] || ''}
                      onChange={setRef(block.reference_field)}
                      placeholder={block.reference_placeholder} />
                  </div>
                  {/* File upload drop zone */}
                  <div
                    style={{
                      border: `2px dashed ${files[block.vc_type] ? '#16a34a' : '#cbd5e1'}`,
                      borderRadius: 6, padding: '0.75rem', textAlign: 'center', cursor: 'pointer', background: 'white',
                    }}
                    onClick={() => fileInputRefs.current[block.vc_type]?.click()}
                  >
                    {files[block.vc_type] ? (
                      <>
                        <div style={{ fontSize: '1.25rem' }}>📄</div>
                        <div style={{ fontSize: '0.75rem', color: '#1e293b', marginTop: '0.25rem' }}>{files[block.vc_type]!.name}</div>
                        <div style={{ fontSize: '0.7rem', color: '#16a34a', fontWeight: 700 }}>✓ Uploaded</div>
                      </>
                    ) : (
                      <div style={{ fontSize: '0.75rem', color: '#94a3b8' }}>
                        + Upload {block.label} (PDF / JPG / PNG, max 5 MB)
                      </div>
                    )}
                    <input
                      type="file"
                      accept=".pdf,.jpg,.jpeg,.png"
                      style={{ display: 'none' }}
                      ref={el => { fileInputRefs.current[block.vc_type] = el; }}
                      onChange={e => setFile(block.vc_type, e.target.files?.[0] || null)}
                    />
                  </div>
                </div>
              ))}

              <div style={{ display: 'flex', gap: '0.75rem', marginTop: '1.5rem' }}>
                <button style={backBtnStyle} onClick={() => setStep(2)}>← Back</button>
                <button style={{ ...nextBtnStyle, flex: 2 }} onClick={() => { if (validateStep3()) setStep(4); }}>Next →</button>
              </div>
            </>
          )}

          {/* ── Step 4: Review & Submit ── */}
          {step === 4 && (
            <>
              <h2 style={{ fontWeight: 700, color: '#0f172a', marginBottom: '1.5rem', fontSize: '1.1rem' }}>Review & Submit</h2>

              {/* Company */}
              <div style={{ background: '#f8fafc', borderRadius: 8, padding: '1rem', marginBottom: '1rem' }}>
                <div style={{ fontWeight: 700, color: '#1e293b', marginBottom: '0.5rem' }}>{form.org_name}</div>
                <div style={{ fontSize: '0.8rem', color: '#64748b' }}>CIN: {form.cin} · PAN: {form.pan_number}</div>
                <div style={{ fontSize: '0.8rem', color: '#64748b' }}>{form.state} {form.pincode} · Inc: {form.date_of_incorporation}</div>
              </div>

              {/* Key People */}
              <div style={{ background: '#eff6ff', borderRadius: 8, padding: '1rem', marginBottom: '1rem' }}>
                <div style={{ fontWeight: 700, color: '#2563eb', marginBottom: '0.5rem', fontSize: '0.85rem' }}>Key People</div>
                <div style={{ fontSize: '0.8rem', color: '#374151' }}>Admin: {people.super_admin_name} ({people.super_admin_email})</div>
                <div style={{ fontSize: '0.8rem', color: '#374151', marginTop: '0.25rem' }}>Requester: {people.requester_name} ({people.requester_email})</div>
              </div>

              {/* Documents */}
              <div style={{ background: '#f0fdf4', borderRadius: 8, padding: '1rem', marginBottom: '1.5rem' }}>
                <div style={{ fontWeight: 700, color: '#16a34a', marginBottom: '0.5rem', fontSize: '0.85rem' }}>Documents → VCs on Approval</div>
                {DOCUMENT_BLOCKS.filter(b => refs[b.reference_field] || files[b.vc_type]).map(b => (
                  <div key={b.vc_type} style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', fontSize: '0.8rem', color: '#374151', marginBottom: '0.25rem' }}>
                    <span style={{ color: '#16a34a' }}>✓</span>
                    <span>{b.vc_type} VC ← {files[b.vc_type]?.name || `(ref: ${refs[b.reference_field]})`}</span>
                  </div>
                ))}
              </div>

              {/* Info box */}
              <div style={{ background: '#fff7ed', border: '1px solid #fed7aa', borderRadius: 8, padding: '0.75rem 1rem', marginBottom: '1.5rem', fontSize: '0.8rem', color: '#92400e' }}>
                ⏱ After submission: Portal Manager reviews → DID Issuer issues your corporate DID + credentials → login details sent by email
              </div>

              <div style={{ display: 'flex', gap: '0.75rem' }}>
                <button style={backBtnStyle} onClick={() => setStep(3)}>← Back</button>
                <button
                  style={{ ...nextBtnStyle, flex: 2, background: loading ? '#94a3b8' : '#16a34a' }}
                  disabled={loading}
                  onClick={handleSubmit}
                >
                  {loading ? 'Submitting…' : 'Submit Application ✓'}
                </button>
              </div>
            </>
          )}
        </div>

        <p style={{ textAlign: 'center', marginTop: '1.5rem', color: '#64748b', fontSize: '0.875rem' }}>
          Already approved? <a href="/login" style={{ color: '#2563eb' }}>Login here</a>
        </p>
      </div>
    </div>
  );
}

// ── Shared styles ──
const inputStyle: React.CSSProperties = {
  width: '100%', padding: '0.6rem 0.75rem', border: '1px solid #e2e8f0',
  borderRadius: 6, fontSize: '0.875rem', color: '#1e293b', background: 'white',
  boxSizing: 'border-box' as const, outline: 'none',
};
const labelStyle: React.CSSProperties = {
  display: 'block', fontWeight: 600, fontSize: '0.8rem', marginBottom: '0.3rem', color: '#374151',
};
const nextBtnStyle: React.CSSProperties = {
  flex: 1, padding: '0.75rem', background: '#2563eb', color: 'white', border: 'none',
  borderRadius: 8, fontWeight: 700, fontSize: '0.95rem', cursor: 'pointer',
};
const backBtnStyle: React.CSSProperties = {
  flex: 1, padding: '0.75rem', background: '#f1f5f9', color: '#64748b', border: '1px solid #e2e8f0',
  borderRadius: 8, fontWeight: 600, fontSize: '0.9rem', cursor: 'pointer',
};
```

- [ ] **Step 2: Verify in browser**

Navigate to `http://localhost:5173/signup`. Expected:
- Step 1 shows "Company Information" form with progress bar (1/4 filled blue)
- "Next →" moves to Step 2, "← Back" returns
- Step 3 shows 4 document blocks (MCA = REQUIRED badge, others = OPTIONAL)
- File upload click opens file picker
- Step 4 shows review summary
- Submit sends multipart and shows success screen with application ID

- [ ] **Step 3: Commit**

```bash
git add src/frontend/pages/OrganizationApplyPage.tsx
git commit -m "feat(ui): 4-step corporate registration wizard with file uploads"
```

---

## Task 8: PortalManagerDashboard.tsx — Corp Applications Tab

**Files:**
- Modify: `src/frontend/pages/PortalManagerDashboard.tsx`
- Modify: `src/frontend/components/AppShell.tsx`

- [ ] **Step 1: Add the Tab type and state**

In `src/frontend/pages/PortalManagerDashboard.tsx`, find line 5:
```typescript
type Tab = 'overview' | 'authorities' | 'dids' | 'organizations' | 'entities' | 'entity-onboard' | 'admin-queue' | 'admin-team';
```

Replace with:
```typescript
type Tab = 'overview' | 'authorities' | 'dids' | 'organizations' | 'entities' | 'entity-onboard' | 'admin-queue' | 'admin-team' | 'applications';
```

- [ ] **Step 2: Add state for corp applications and issuers**

In `PortalManagerDashboard.tsx`, find the line:
```typescript
  const [showTeamForm, setShowTeamForm] = useState(false);
```

After the `const [rejectingId, setRejectingId] = useState<string | null>(null);` line (around line 80), add:

```typescript
  // Corp Applications tab state
  const [corpApps, setCorpApps] = useState<any[]>([]);
  const [availableIssuers, setAvailableIssuers] = useState<any[]>([]);
  const [selectedIssuer, setSelectedIssuer] = useState<Record<string, string>>({});
  const [expandedApp, setExpandedApp] = useState<string | null>(null);
  const [appMsg, setAppMsg] = useState('');
```

- [ ] **Step 3: Load corp apps + issuers in useEffect**

Find the `loadTab` function (starts around line 91). Find the final `else if` block in it (the `admin-team` block):
```typescript
      } else if (tab === 'admin-team') {
        const r = await fetch('/api/portal/admin/team', { headers: authHeader() });
        const d = await r.json();
        setTeamMembers(d.team || []);
      }
```

Immediately after that closing `}` (but still inside the `try` block), add:

```typescript
      } else if (tab === 'applications') {
        const [appsRes, issuersRes] = await Promise.all([
          fetch('/api/portal/corporate-applications', { headers: authHeader() }),
          fetch('/api/public/did-issuers'),
        ]);
        const appsData = await appsRes.json();
        const issuersData = await issuersRes.json();
        setCorpApps(appsData.applications || []);
        setAvailableIssuers(issuersData.issuers || []);
      }
```

- [ ] **Step 4: Add activate + reject handlers**

After the `handleOnboardSubmit` function (around line 172), add:

```typescript
  async function handleActivate(appId: string) {
    const issuerId = selectedIssuer[appId];
    if (!issuerId) { setAppMsg('Please select a DID Issuer first'); return; }
    setLoading(true);
    try {
      const r = await fetch(`/api/portal/corporate-applications/${appId}/activate`, {
        method: 'POST', headers: authHeader(),
        body: JSON.stringify({ assigned_issuer_id: issuerId }),
      });
      const d = await r.json();
      if (!r.ok) throw new Error(d.error);
      setAppMsg('Application activated and assigned to issuer.');
      loadTab();
    } catch (e: any) { setAppMsg(e.message); }
    finally { setLoading(false); }
  }

  async function handleRejectApp(appId: string) {
    const reason = window.prompt('Rejection reason (optional):');
    if (reason === null) return; // cancelled
    setLoading(true);
    try {
      const r = await fetch(`/api/portal/corporate-applications/${appId}/reject`, {
        method: 'POST', headers: authHeader(),
        body: JSON.stringify({ rejection_reason: reason }),
      });
      const d = await r.json();
      if (!r.ok) throw new Error(d.error);
      setAppMsg('Application rejected.');
      loadTab();
    } catch (e: any) { setAppMsg(e.message); }
    finally { setLoading(false); }
  }
```

- [ ] **Step 5: Add the Corp Applications JSX panel**

In `PortalManagerDashboard.tsx`, find the last JSX panel — the closing `{/* ── Corporate / Members ── */}` section that ends with:
```tsx
        </>
      )}
    </div>
  );
}
```

Insert the following block **before** the final `</div>` closing tag (i.e., after `)}` that closes the `tab === 'organizations'` section):

```tsx
      {/* ── Corp Applications ── */}
      {tab === 'applications' && (
        <>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1.5rem' }}>
            <h2 style={{ margin: 0 }}>Corporate Applications</h2>
            {appMsg && <span style={{ color: appMsg.includes('error') || appMsg.includes('select') ? '#dc3545' : '#16a34a', fontSize: '0.875rem' }}>{appMsg}</span>}
          </div>

          {corpApps.length === 0 && (
            <div className="card" style={{ textAlign: 'center', padding: '2rem', color: '#888' }}>No corporate applications yet.</div>
          )}

          {corpApps.map(app => {
            const statusColor: Record<string, string> = {
              pending: '#fef3c7', activated: '#dbeafe', issued: '#dcfce7', rejected: '#fee2e2',
            };
            const statusText: Record<string, string> = {
              pending: '#92400e', activated: '#1e40af', issued: '#166534', rejected: '#991b1b',
            };
            return (
              <div key={app.id} className="card" style={{ marginBottom: '1rem', padding: '1.25rem' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '0.5rem' }}>
                  <div>
                    <div style={{ fontWeight: 700, color: '#1e293b', fontSize: '1rem' }}>{app.company_name}</div>
                    <div style={{ fontSize: '0.78rem', color: '#64748b' }}>CIN: {app.cin}</div>
                    <div style={{ fontSize: '0.78rem', color: '#374151', marginTop: '0.25rem' }}>
                      Admin: {app.super_admin_name} ({app.super_admin_email}) · Requester: {app.requester_name} ({app.requester_email})
                    </div>
                    <div style={{ fontSize: '0.75rem', color: '#94a3b8', marginTop: '0.25rem' }}>
                      Submitted: {new Date(app.created_at).toLocaleDateString()}
                    </div>
                  </div>
                  <span style={{
                    background: statusColor[app.application_status] || '#f1f5f9',
                    color: statusText[app.application_status] || '#374151',
                    fontSize: '0.7rem', fontWeight: 700, padding: '3px 10px', borderRadius: 8,
                  }}>
                    {app.application_status.toUpperCase()}
                  </span>
                </div>

                {/* Expand/collapse documents */}
                <button
                  style={{ background: 'none', border: 'none', color: '#2563eb', fontSize: '0.8rem', cursor: 'pointer', padding: '0.25rem 0', fontWeight: 600 }}
                  onClick={() => setExpandedApp(expandedApp === app.id ? null : app.id)}
                >
                  {expandedApp === app.id ? '▲ Hide Documents' : '▼ Show Documents'}
                </button>

                {expandedApp === app.id && (
                  <div style={{ marginTop: '0.75rem', background: '#f8fafc', borderRadius: 6, padding: '0.75rem' }}>
                    {(app.documents || []).length === 0 ? (
                      <span style={{ color: '#94a3b8', fontSize: '0.8rem' }}>No documents</span>
                    ) : (
                      (app.documents as any[]).map((doc: any, i: number) => (
                        <div key={i} style={{ fontSize: '0.8rem', color: '#374151', marginBottom: '0.35rem', display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
                          <span>📄 {doc.vc_type}</span>
                          {doc.reference_number && <span style={{ color: '#64748b' }}>ref: {doc.reference_number}</span>}
                          {doc.file_path && (
                            <a href={`/${doc.file_path}`} target="_blank" rel="noopener noreferrer"
                              style={{ color: '#2563eb', textDecoration: 'none', fontWeight: 600 }}>
                              Download ↗
                            </a>
                          )}
                        </div>
                      ))
                    )}
                  </div>
                )}

                {/* Actions for pending applications */}
                {app.application_status === 'pending' && (
                  <div style={{ marginTop: '1rem', borderTop: '1px solid #f1f5f9', paddingTop: '1rem' }}>
                    <div style={{ fontSize: '0.8rem', fontWeight: 600, color: '#374151', marginBottom: '0.5rem' }}>Assign to DID Issuer</div>
                    <div style={{ display: 'flex', gap: '0.75rem', alignItems: 'center' }}>
                      <select
                        style={{ flex: 1, padding: '0.5rem 0.75rem', border: '1px solid #e2e8f0', borderRadius: 6, fontSize: '0.85rem', color: '#1e293b' }}
                        value={selectedIssuer[app.id] || ''}
                        onChange={e => setSelectedIssuer(prev => ({ ...prev, [app.id]: e.target.value }))}
                      >
                        <option value="">Select DID Issuer…</option>
                        {availableIssuers.map((iss: any) => (
                          <option key={iss.id} value={iss.id}>{iss.name}</option>
                        ))}
                      </select>
                      <button
                        style={{ padding: '0.5rem 1rem', background: '#2563eb', color: 'white', border: 'none', borderRadius: 6, fontWeight: 600, fontSize: '0.85rem', cursor: 'pointer' }}
                        onClick={() => handleActivate(app.id)} disabled={loading}
                      >
                        ✓ Activate & Assign
                      </button>
                      <button
                        style={{ padding: '0.5rem 1rem', background: '#f1f5f9', color: '#64748b', border: '1px solid #e2e8f0', borderRadius: 6, fontWeight: 600, fontSize: '0.85rem', cursor: 'pointer' }}
                        onClick={() => handleRejectApp(app.id)} disabled={loading}
                      >
                        ✗ Reject
                      </button>
                    </div>
                  </div>
                )}

                {/* Activated: show assigned issuer */}
                {app.application_status === 'activated' && (
                  <div style={{ marginTop: '0.75rem', fontSize: '0.8rem', color: '#1e40af', background: '#dbeafe', padding: '0.5rem 0.75rem', borderRadius: 6 }}>
                    Assigned to: {app.assigned_issuer_name || 'DID Issuer'} — awaiting issuance
                  </div>
                )}

                {/* Issued: done */}
                {app.application_status === 'issued' && (
                  <div style={{ marginTop: '0.75rem', fontSize: '0.8rem', color: '#166534', background: '#dcfce7', padding: '0.5rem 0.75rem', borderRadius: 6 }}>
                    🎉 Issued by {app.assigned_issuer_name || 'DID Issuer'} — corporate accounts created
                  </div>
                )}

                {/* Rejected: show reason */}
                {app.application_status === 'rejected' && (
                  <div style={{ marginTop: '0.75rem', fontSize: '0.8rem', color: '#991b1b', background: '#fee2e2', padding: '0.5rem 0.75rem', borderRadius: 6 }}>
                    Rejected{app.rejection_reason ? `: ${app.rejection_reason}` : ''}
                  </div>
                )}
              </div>
            );
          })}
        </>
      )}
```

- [ ] **Step 6: Add Corp Applications to AppShell nav for portal_manager**

In `src/frontend/components/AppShell.tsx`, find the `portal_manager` nav items array:

```typescript
  portal_manager: [
    { tab: 'overview',       label: 'Overview',                   icon: '🏠' },
    { tab: 'entities',       label: 'Issuer & Trusted Endorser',  icon: '🌐' },
    { tab: 'entity-onboard', label: 'Onboard Entity',             icon: '➕', subRoles: ['super_admin', 'maker'] },
    { tab: 'admin-team',     label: 'Admin Team',                 icon: '👥', subRoles: ['super_admin'] },
    { tab: 'dids',           label: 'DID Registry',               icon: '🔑', subRoles: ['super_admin'] },
    { tab: 'organizations',  label: 'Corporate / Members',        icon: '🏢', subRoles: ['super_admin'] },
    { tab: '__besu_explorer__', label: 'Besu Explorer',           icon: '⛓️', subRoles: ['super_admin'] },
  ],
```

Add `{ tab: 'applications', label: 'Corp Applications', icon: '🏢' }` after the `'entities'` item:

```typescript
  portal_manager: [
    { tab: 'overview',       label: 'Overview',                   icon: '🏠' },
    { tab: 'entities',       label: 'Issuer & Trusted Endorser',  icon: '🌐' },
    { tab: 'applications',   label: 'Corp Applications',          icon: '📋' },
    { tab: 'entity-onboard', label: 'Onboard Entity',             icon: '➕', subRoles: ['super_admin', 'maker'] },
    { tab: 'admin-team',     label: 'Admin Team',                 icon: '👥', subRoles: ['super_admin'] },
    { tab: 'dids',           label: 'DID Registry',               icon: '🔑', subRoles: ['super_admin'] },
    { tab: 'organizations',  label: 'Corporate / Members',        icon: '🏢', subRoles: ['super_admin'] },
    { tab: '__besu_explorer__', label: 'Besu Explorer',           icon: '⛓️', subRoles: ['super_admin'] },
  ],
```

- [ ] **Step 7: Verify in browser**

Login as portal_manager. Expected:
- "Corp Applications" tab appears in sidebar
- Clicking it loads the applications list
- A pending application shows the DID Issuer dropdown + "✓ Activate & Assign" + "✗ Reject" buttons
- Selecting an issuer and clicking activate changes status to `activated`

- [ ] **Step 8: Commit**

```bash
git add src/frontend/pages/PortalManagerDashboard.tsx src/frontend/components/AppShell.tsx
git commit -m "feat(ui): Portal Manager Corp Applications tab with activate/reject"
```

---

## Task 9: AuthorityDashboard.tsx — Corp Applications Tab + AppShell Nav

**Files:**
- Modify: `src/frontend/pages/AuthorityDashboard.tsx`
- Modify: `src/frontend/components/AppShell.tsx`

- [ ] **Step 1: Add state for corp applications in AuthorityDashboard**

In `src/frontend/pages/AuthorityDashboard.tsx`, find the `const [ledgerCredType, ...]` line (around line 72). After it, add:

```typescript
  // Corp Applications (did_issuer_admin only)
  const [corpApps, setCorpApps] = useState<any[]>([]);
  const [corpAppMsg, setCorpAppMsg] = useState('');
  const [selectedVcTypes, setSelectedVcTypes] = useState<Record<string, string[]>>({});
```

- [ ] **Step 2: Add loadCorpApplications function**

In `AuthorityDashboard.tsx`, find `async function loadTeam()`. After that function, add:

```typescript
  async function loadCorpApplications() {
    try {
      const res = await fetch('/api/did-issuer/corporate-applications', { headers: authHeader() });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      setCorpApps(data.applications || []);
      // Pre-select all vc_types from each application's documents
      const preSelected: Record<string, string[]> = {};
      for (const app of (data.applications || [])) {
        preSelected[app.id] = (app.documents || []).map((d: any) => d.vc_type);
      }
      setSelectedVcTypes(preSelected);
    } catch (e: any) { setCorpAppMsg(e.message); }
  }
```

- [ ] **Step 3: Wire loadCorpApplications into useEffect**

Find the `useEffect` that handles view changes (around line 76):
```typescript
  useEffect(() => {
    if (view === 'dashboard') { loadVcRequests(); loadIssued(); loadTeam(); loadDidRequests(); }
    if (view === 'vc-requests') loadVcRequests();
    if (view === 'did-requests') loadDidRequests();
    if (view === 'checker-queue') loadMCQueue();
    if (view === 'issued') loadIssued();
    if (view === 'team') loadTeam();
  }, [view]);
```

Add one more line at the end:

```typescript
  useEffect(() => {
    if (view === 'dashboard') { loadVcRequests(); loadIssued(); loadTeam(); loadDidRequests(); }
    if (view === 'vc-requests') loadVcRequests();
    if (view === 'did-requests') loadDidRequests();
    if (view === 'checker-queue') loadMCQueue();
    if (view === 'issued') loadIssued();
    if (view === 'team') loadTeam();
    if (view === 'corp-applications') loadCorpApplications();
  }, [view]);
```

- [ ] **Step 4: Add handleIssueCorpDID function**

After `loadCorpApplications`, add:

```typescript
  async function handleIssueCorpDID(appId: string) {
    const vcTypes = selectedVcTypes[appId] || [];
    if (vcTypes.length === 0) { setCorpAppMsg('Select at least one VC type'); return; }
    setLoading(true);
    setCorpAppMsg('');
    try {
      const res = await fetch(`/api/did-issuer/corporate-applications/${appId}/issue`, {
        method: 'POST',
        headers: authHeader(),
        body: JSON.stringify({ vc_types: vcTypes }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      setCorpAppMsg(`✅ Issued! DID: ${data.corporateDid} | super_admin pass: ${data.super_admin_temp_password} | requester pass: ${data.requester_temp_password}`);
      loadCorpApplications();
    } catch (e: any) { setCorpAppMsg(e.message); }
    finally { setLoading(false); }
  }
```

- [ ] **Step 5: Add Corp Applications JSX panel**

In `AuthorityDashboard.tsx`, find the `{/* ── Team ── */}` block (around line 640). After the entire Team section (after its closing `)}`) and before the final `</div>` closing tag, add:

```tsx
      {/* ── Corp Applications (did_issuer_admin only) ── */}
      {view === 'corp-applications' && (
        <>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1.5rem' }}>
            <h2 style={{ margin: 0 }}>Corporate Applications — Ready to Issue</h2>
          </div>

          {corpAppMsg && (
            <div style={{
              padding: '0.75rem 1rem', borderRadius: 8, marginBottom: '1rem', fontSize: '0.85rem',
              background: corpAppMsg.startsWith('✅') ? '#f0fdf4' : '#fef2f2',
              color: corpAppMsg.startsWith('✅') ? '#166534' : '#dc2626',
              border: `1px solid ${corpAppMsg.startsWith('✅') ? '#bbf7d0' : '#fecaca'}`,
              wordBreak: 'break-all',
            }}>
              {corpAppMsg}
            </div>
          )}

          {corpApps.length === 0 && (
            <div className="card" style={{ textAlign: 'center', padding: '2rem', color: '#888' }}>
              No applications assigned to you yet.
            </div>
          )}

          {corpApps.map(app => {
            const docs: any[] = app.documents || [];
            const slug = (app.company_name || '').toLowerCase().replace(/[^a-z0-9]/g, '-').replace(/-+/g, '-');
            const didPreview = `did:web:didvc.platform:${slug}`;
            const myVcTypes = selectedVcTypes[app.id] || [];

            return (
              <div key={app.id} className="card" style={{ marginBottom: '1.5rem', padding: '1.5rem', border: '2px solid #2563eb' }}>
                <div style={{ fontWeight: 800, fontSize: '1.05rem', color: '#1e293b', marginBottom: '0.25rem' }}>{app.company_name}</div>
                <div style={{ fontSize: '0.78rem', color: '#64748b', marginBottom: '0.75rem' }}>CIN: {app.cin} · Admin: {app.super_admin_email}</div>

                {/* DID Preview */}
                <div style={{ background: 'white', borderRadius: 6, padding: '0.6rem 0.9rem', marginBottom: '0.75rem', border: '1px solid #e2e8f0' }}>
                  <div style={{ fontSize: '0.7rem', fontWeight: 700, color: '#374151', marginBottom: '0.25rem' }}>DID to be issued</div>
                  <code style={{ fontSize: '0.72rem', color: '#2563eb', wordBreak: 'break-all' }}>{didPreview}</code>
                </div>

                {/* VCs to issue */}
                <div style={{ background: 'white', borderRadius: 6, padding: '0.75rem', marginBottom: '0.75rem', border: '1px solid #e2e8f0' }}>
                  <div style={{ fontSize: '0.7rem', fontWeight: 700, color: '#374151', marginBottom: '0.5rem' }}>VCs to issue against documents</div>
                  {docs.length === 0 && <span style={{ fontSize: '0.8rem', color: '#94a3b8' }}>No documents</span>}
                  {docs.map((doc: any, i: number) => (
                    <label key={i} style={{
                      display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                      padding: '0.4rem 0.75rem', borderRadius: 4, marginBottom: '0.35rem', cursor: 'pointer',
                      background: myVcTypes.includes(doc.vc_type) ? '#f0fdf4' : '#f8fafc',
                      borderLeft: `3px solid ${myVcTypes.includes(doc.vc_type) ? '#16a34a' : '#e2e8f0'}`,
                    }}>
                      <div>
                        <div style={{ fontWeight: 600, fontSize: '0.82rem', color: '#1e293b' }}>{doc.vc_type}</div>
                        <div style={{ fontSize: '0.7rem', color: '#64748b' }}>
                          {doc.file_path ? `📄 ${doc.file_path.split('/').pop()}` : `📋 Ref: ${doc.reference_number}`}
                        </div>
                      </div>
                      <input
                        type="checkbox"
                        checked={myVcTypes.includes(doc.vc_type)}
                        onChange={() => setSelectedVcTypes(prev => {
                          const current = prev[app.id] || [];
                          return {
                            ...prev,
                            [app.id]: current.includes(doc.vc_type)
                              ? current.filter(t => t !== doc.vc_type)
                              : [...current, doc.vc_type],
                          };
                        })}
                        style={{ accentColor: '#16a34a', width: 16, height: 16 }}
                      />
                    </label>
                  ))}
                </div>

                {/* Warning */}
                <div style={{ background: '#fff7ed', border: '1px solid #fed7aa', borderRadius: 6, padding: '0.6rem 0.75rem', marginBottom: '1rem', fontSize: '0.75rem', color: '#92400e' }}>
                  ⚡ Clicking "Issue" will: create the corporate DID · create super_admin + requester accounts · issue selected VCs to corporate wallet · log temp passwords to server console
                </div>

                <button
                  style={{ width: '100%', padding: '0.75rem', background: loading ? '#94a3b8' : '#16a34a', color: 'white', border: 'none', borderRadius: 8, fontWeight: 700, fontSize: '0.95rem', cursor: loading ? 'default' : 'pointer' }}
                  disabled={loading}
                  onClick={() => handleIssueCorpDID(app.id)}
                >
                  🔑 Issue DID + Credentials →
                </button>
              </div>
            );
          })}
        </>
      )}
```

- [ ] **Step 6: Add Corp Applications nav item to AppShell for did_issuer_admin**

In `src/frontend/components/AppShell.tsx`, find the `government_agency` nav items array:

```typescript
  government_agency: [
    { tab: 'dashboard',      label: 'Overview',         icon: '🏠' },
    { tab: 'vc-requests',    label: 'VC Requests',      icon: '📄' },
    { tab: 'did-requests',   label: 'DID Requests',     icon: '🔑' },
    { tab: 'checker-queue',  label: 'Checker Queue',    icon: '✅', subRoles: ['checker', 'super_admin'] },
    { tab: 'issued',         label: 'Issued',           icon: '📋' },
    { tab: 'team',           label: 'Team',             icon: '👥', subRoles: ['super_admin'] },
  ],
```

Add the Corp Applications item (only visible to did_issuer_admin):

```typescript
  government_agency: [
    { tab: 'dashboard',         label: 'Overview',           icon: '🏠' },
    { tab: 'vc-requests',       label: 'VC Requests',        icon: '📄' },
    { tab: 'did-requests',      label: 'DID Requests',       icon: '🔑' },
    { tab: 'checker-queue',     label: 'Checker Queue',      icon: '✅', subRoles: ['checker', 'super_admin'] },
    { tab: 'issued',            label: 'Issued',             icon: '📋' },
    { tab: 'corp-applications', label: 'Corp Applications',  icon: '🏢', subRoles: ['did_issuer_admin'] },
    { tab: 'team',              label: 'Team',               icon: '👥', subRoles: ['super_admin'] },
  ],
```

> **Note:** AppShell filters nav items by `subRoles`. Since `did_issuer_admin` users have `sub_role = 'did_issuer_admin'`, this item only appears for them.

- [ ] **Step 7: Verify in browser**

Login as a `did_issuer_admin` government_agency user. Expected:
- "Corp Applications" tab appears in sidebar
- Clicking it loads applications assigned to this issuer
- Each card shows company info, DID preview, and VC checkboxes (pre-checked)
- "🔑 Issue DID + Credentials →" button triggers the backend and shows temp passwords in the success message
- After issuance: logging in as the new super_admin email shows the corporate wallet with issued VCs

- [ ] **Step 8: Commit**

```bash
git add src/frontend/pages/AuthorityDashboard.tsx src/frontend/components/AppShell.tsx
git commit -m "feat(ui): DID Issuer Corp Applications tab + AppShell nav for did_issuer_admin"
```

---

## End-to-End Verification

After all tasks are complete, run this manual test flow:

1. **Public** → Visit `/` → See dark landing page with issuer strip loaded from API
2. **Corporate** → Click "Register Corporate →" → Complete 4-step wizard → Submit → See confirmation with applicationId
3. **Portal Manager** → Login → "Corp Applications" tab → See the pending application → Select a DID Issuer → "✓ Activate & Assign"
4. **DID Issuer** → Login (with `did_issuer_admin` sub_role) → "Corp Applications" tab → See the activated application → Check VCs → "🔑 Issue DID + Credentials →" → Note temp passwords from success message
5. **Corporate** → Login with `super_admin_email` + temp password → Corporate wallet shows issued VCs (MCARegistration, GSTINCredential, etc.)
