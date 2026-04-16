# Signatory + Maker-Checker Registration Flow Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the Portal Manager → DID Issuer single-step corporate registration flow with a three-stage chain: Authorized Signatory → DID Issuer Maker → DID Issuer Checker.

**Architecture:** Pure `application_status` state machine on `organization_applications` (`pending → signatory_approved → maker_reviewed → issued/rejected`). Signatory account is created at registration time with `org_id = NULL`; it's patched to `superAdminId` after issuance. No `mc_actions` table dependency.

**Tech Stack:** Express/TypeScript backend, React/TypeScript frontend, PostgreSQL (schema migrations run at startup via `src/db/migrate.ts`). No test framework — verification is via server logs and browser UI.

---

## File Map

| File | Action |
|------|--------|
| `src/db/schema.sql` | Add 5 columns, widen CHECK, add 3 indexes |
| `src/server/index.ts` | Update 3 endpoints, add 4 new endpoints, remove 2 portal endpoints |
| `src/frontend/pages/OrganizationApplyPage.tsx` | Replace 4-step wizard with 5-step wizard |
| `src/frontend/pages/SignatoryDashboard.tsx` | **New file** |
| `src/frontend/pages/AuthorityDashboard.tsx` | Corp Applications tab becomes role-aware |
| `src/frontend/pages/PortalManagerDashboard.tsx` | Remove Corp Applications tab + state |
| `src/frontend/components/AppShell.tsx` | Add signatory nav, remove portal_manager Corp Applications nav |
| `src/frontend/App.tsx` | Add `/corporate/signatory` route |

---

## Task 1: DB Schema — New Columns, Widened Status, Indexes

**Files:**
- Modify: `src/db/schema.sql` (append after line 530)

- [ ] **Step 1: Append migrations to `src/db/schema.sql`**

Add this block at the very end of `src/db/schema.sql` (after the last line, currently line 530 — `CREATE INDEX IF NOT EXISTS idx_org_app_corporate_user …`):

```sql
-- ── Signatory + Maker-Checker flow ───────────────────────────────────────────

-- New columns on organization_applications
ALTER TABLE organization_applications ADD COLUMN IF NOT EXISTS signatory_name    VARCHAR(255);
ALTER TABLE organization_applications ADD COLUMN IF NOT EXISTS signatory_email   VARCHAR(255);
ALTER TABLE organization_applications ADD COLUMN IF NOT EXISTS signatory_user_id UUID REFERENCES users(id) ON DELETE SET NULL;
ALTER TABLE organization_applications ADD COLUMN IF NOT EXISTS maker_id          UUID REFERENCES users(id) ON DELETE SET NULL;
ALTER TABLE organization_applications ADD COLUMN IF NOT EXISTS checker_id        UUID REFERENCES users(id) ON DELETE SET NULL;

-- Widen application_status CHECK to include signatory_approved and maker_reviewed
DO $$
BEGIN
  ALTER TABLE organization_applications DROP CONSTRAINT IF EXISTS chk_org_app_status;
  ALTER TABLE organization_applications ADD CONSTRAINT chk_org_app_status
    CHECK (application_status IN (
      'pending', 'partial', 'complete',
      'signatory_approved', 'maker_reviewed',
      'activated', 'issued', 'rejected'
    ));
END $$;

-- Indexes for the new FK columns
CREATE INDEX IF NOT EXISTS idx_org_app_signatory ON organization_applications(signatory_user_id);
CREATE INDEX IF NOT EXISTS idx_org_app_maker     ON organization_applications(maker_id);
CREATE INDEX IF NOT EXISTS idx_org_app_checker   ON organization_applications(checker_id);
```

- [ ] **Step 2: Restart the dev server to run migrations**

```bash
# In the project root, stop and restart the dev server.
# Migrations run automatically at startup via src/db/migrate.ts.
# Check for errors in the server console — should see no constraint errors.
```

- [ ] **Step 3: Verify columns exist**

```bash
# In psql or via the server console, run:
# SELECT column_name FROM information_schema.columns
# WHERE table_name = 'organization_applications'
# AND column_name IN ('signatory_name','signatory_email','signatory_user_id','maker_id','checker_id');
# Expected: 5 rows returned
```

- [ ] **Step 4: Commit**

```bash
git add src/db/schema.sql
git commit -m "feat(db): add signatory/maker/checker columns + widen application_status"
```

---

## Task 2: Backend — Update `GET /api/public/did-issuers` and `POST /api/organizations/apply`

**Files:**
- Modify: `src/server/index.ts` (lines 2442–2556)

### 2a. Update the DID Issuers query

- [ ] **Step 1: Replace the `did-issuers` query body**

Find in `src/server/index.ts` (lines ~2444–2450):

```typescript
    const result = await query(
      `SELECT u.id, u.name, u.email
       FROM users u
       WHERE u.role = 'government_agency'
         AND u.sub_role = 'did_issuer_admin'
       ORDER BY u.name`,
      []
    );
```

Replace with:

```typescript
    const result = await query(
      `SELECT id, name, email
       FROM users
       WHERE role = 'government_agency'
         AND sub_role = 'super_admin'
         AND org_id = id
       ORDER BY name`,
      []
    );
```

### 2b. Update `POST /api/organizations/apply` — add signatory + assigned_issuer_id

- [ ] **Step 2: Add new destructured fields in the apply handler**

Find the destructuring block at line ~2476:

```typescript
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
```

Replace with:

```typescript
      const {
        org_name, email, org_logo_url,
        director_full_name, aadhaar_number, dob, gender, state, pincode,
        company_name, cin, company_status, company_category, date_of_incorporation,
        pan_number, gstn, ie_code,
        director_name, din, designation, signing_authority_level,
        // key people
        super_admin_name, super_admin_email,
        requester_name, requester_email,
        // signatory + issuer (new)
        signatory_name, signatory_email,
        assigned_issuer_id,
        documents: documentsJson,
      } = req.body as Record<string, string>;
```

- [ ] **Step 3: Add signatory + issuer validation after the existing requiredFields check**

Find (line ~2488):

```typescript
      // Validate required fields
      const requiredFields = [org_name, email, state, pincode,
        company_name, cin, company_status, company_category,
        date_of_incorporation, pan_number,
        super_admin_name, super_admin_email, requester_name, requester_email];
      if (requiredFields.some(v => !v)) {
        return res.status(400).json({ error: 'All required fields must be provided' });
      }
```

Replace with:

```typescript
      // Validate required fields
      const requiredFields = [org_name, email, state, pincode,
        company_name, cin, company_status, company_category,
        date_of_incorporation, pan_number,
        super_admin_name, super_admin_email, requester_name, requester_email,
        signatory_name, signatory_email, assigned_issuer_id];
      if (requiredFields.some(v => !v)) {
        return res.status(400).json({ error: 'All required fields must be provided' });
      }

      // Validate assigned_issuer_id is a valid government_agency super_admin who self-owns their org
      const issuerCheck = await query(
        `SELECT id FROM users
         WHERE id = $1 AND role = 'government_agency' AND sub_role = 'super_admin' AND org_id = id`,
        [assigned_issuer_id]
      );
      if (issuerCheck.rows.length === 0) {
        return res.status(400).json({ error: 'Invalid DID Issuer selected' });
      }
```

- [ ] **Step 4: Create the signatory account and insert with new columns**

Find the INSERT statement starting at line ~2528:

```typescript
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
```

Replace with:

```typescript
      // Create signatory account (org_id = NULL — patched at issuance)
      const signatoryTempPass = crypto.randomBytes(8).toString('hex');
      const signatoryHash = await hashPassword(signatoryTempPass);
      const signatoryResult = await query(
        `INSERT INTO users (email, password_hash, role, name, sub_role, org_id)
         VALUES ($1, $2, 'corporate', $3, 'authorized_signatory', NULL)
         RETURNING id`,
        [signatory_email, signatoryHash, signatory_name]
      );
      const signatoryUserId = signatoryResult.rows[0].id;
      console.log(`[SUBMITTED] signatory: ${signatory_email} | password: ${signatoryTempPass}`);

      const result = await query(
        `INSERT INTO organization_applications
          (org_name, email, org_logo_url, director_full_name, aadhaar_number, dob, gender,
           state, pincode, company_name, cin, company_status, company_category,
           date_of_incorporation, pan_number, gstn, ie_code, director_name, din, designation,
           signing_authority_level,
           super_admin_name, super_admin_email, requester_name, requester_email, documents,
           signatory_name, signatory_email, signatory_user_id, assigned_issuer_id)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,
                 $22,$23,$24,$25,$26,$27,$28,$29,$30)
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
          signatory_name, signatory_email, signatoryUserId, assigned_issuer_id,
        ]
      );

      res.json({
        success: true,
        applicationId: result.rows[0].id,
        signatory_temp_password: signatoryTempPass,
      });
```

- [ ] **Step 5: Restart server and test via curl or browser**

```bash
# Test: submit an apply form (use the 5-step wizard in the next task, or curl):
# Expected: response includes { success: true, applicationId: "...", signatory_temp_password: "..." }
# Server console should show: [SUBMITTED] signatory: <email> | password: <pass>
```

- [ ] **Step 6: Commit**

```bash
git add src/server/index.ts
git commit -m "feat(api): update did-issuers query + apply endpoint with signatory account creation"
```

---

## Task 3: Backend — New Signatory Endpoints (GET, Approve, Reject)

**Files:**
- Modify: `src/server/index.ts` (insert after the apply endpoint, before the portal manager section at line ~2558)

- [ ] **Step 1: Add the three signatory endpoints**

Find the comment line `// ─── Portal Manager: Corporate Applications ──` (line ~2558).

Insert the following **before** that comment:

```typescript
// ── Signatory: Corporate Applications ────────────────────────────────────────

// GET /api/corporate/signatory/applications — list pending apps for this signatory
app.get('/api/corporate/signatory/applications', requireAuth, requireRole('corporate'), async (req, res) => {
  try {
    const user = (req as any).user;
    if (user.sub_role !== 'authorized_signatory') {
      return res.status(403).json({ error: 'authorized_signatory sub_role required' });
    }
    const result = await query(
      `SELECT oa.*, u.name AS assigned_issuer_name, u.email AS assigned_issuer_email
       FROM organization_applications oa
       LEFT JOIN users u ON u.id = oa.assigned_issuer_id
       WHERE oa.signatory_user_id = $1
         AND oa.application_status = 'pending'
       ORDER BY oa.created_at DESC`,
      [user.id]
    );
    res.json({ success: true, applications: result.rows });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// POST /api/corporate/signatory/applications/:id/approve
app.post('/api/corporate/signatory/applications/:id/approve', requireAuth, requireRole('corporate'), async (req, res) => {
  try {
    const user = (req as any).user;
    if (user.sub_role !== 'authorized_signatory') {
      return res.status(403).json({ error: 'authorized_signatory sub_role required' });
    }
    const { id } = req.params;
    const appCheck = await query(
      `SELECT id FROM organization_applications
       WHERE id = $1 AND signatory_user_id = $2 AND application_status = 'pending'`,
      [id, user.id]
    );
    if (appCheck.rows.length === 0) {
      return res.status(404).json({ error: 'Application not found or not in pending state' });
    }
    await query(
      `UPDATE organization_applications SET application_status = 'signatory_approved' WHERE id = $1`,
      [id]
    );
    res.json({ success: true });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// POST /api/corporate/signatory/applications/:id/reject
app.post('/api/corporate/signatory/applications/:id/reject', requireAuth, requireRole('corporate'), async (req, res) => {
  try {
    const user = (req as any).user;
    if (user.sub_role !== 'authorized_signatory') {
      return res.status(403).json({ error: 'authorized_signatory sub_role required' });
    }
    const { id } = req.params;
    const { rejection_reason } = req.body;
    const appCheck = await query(
      `SELECT id FROM organization_applications
       WHERE id = $1 AND signatory_user_id = $2 AND application_status = 'pending'`,
      [id, user.id]
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

- [ ] **Step 2: Restart server and verify no TypeScript errors**

```bash
# Server should start without errors.
# The three new endpoints will appear in the route list.
```

- [ ] **Step 3: Commit**

```bash
git add src/server/index.ts
git commit -m "feat(api): add signatory GET/approve/reject endpoints"
```

---

## Task 4: Backend — Maker-Review Endpoint + Role-Aware GET + Updated Issue + Remove Portal

**Files:**
- Modify: `src/server/index.ts` (several locations in lines 2558–2773)

### 4a. Add maker-review endpoint

- [ ] **Step 1: Insert maker-review endpoint**

Find `// ─── DID Issuer: Corporate Applications ──` (line ~2643).

Insert the following **before** the `app.get('/api/did-issuer/corporate-applications'` line:

```typescript
// POST /api/did-issuer/corporate-applications/:id/maker-review
app.post('/api/did-issuer/corporate-applications/:id/maker-review', requireAuth, requireRole('government_agency'), async (req, res) => {
  try {
    const user = (req as any).user;
    if (user.sub_role !== 'maker') {
      return res.status(403).json({ error: 'maker sub_role required' });
    }
    const { id } = req.params;
    const appCheck = await query(
      `SELECT id FROM organization_applications
       WHERE id = $1 AND assigned_issuer_id = $2 AND application_status = 'signatory_approved'`,
      [id, user.org_id]
    );
    if (appCheck.rows.length === 0) {
      return res.status(404).json({ error: 'Application not found or not in signatory_approved state' });
    }
    await query(
      `UPDATE organization_applications
       SET application_status = 'maker_reviewed', maker_id = $1
       WHERE id = $2`,
      [user.id, id]
    );
    res.json({ success: true });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

```

### 4b. Make `GET /api/did-issuer/corporate-applications` role-aware

- [ ] **Step 2: Replace the GET endpoint body**

Find the full `app.get('/api/did-issuer/corporate-applications', ...)` handler (lines ~2645–2665). Replace its body (from `try {` to the closing `});`) with:

```typescript
  try {
    const user = (req as any).user;
    const subRole: string = user.sub_role || '';
    // Determine which status to show based on sub_role
    let statusFilter: string;
    if (subRole === 'maker') {
      statusFilter = 'signatory_approved';
    } else if (subRole === 'checker' || subRole === 'super_admin') {
      statusFilter = 'maker_reviewed';
    } else {
      return res.status(403).json({ error: 'maker, checker, or super_admin sub_role required' });
    }
    const result = await query(
      `SELECT oa.id, oa.org_name, oa.company_name, oa.cin, oa.pan_number,
              oa.super_admin_name, oa.super_admin_email,
              oa.requester_name, oa.requester_email,
              oa.signatory_name, oa.signatory_email,
              oa.documents, oa.application_status, oa.created_at,
              mu.name AS maker_name
       FROM organization_applications oa
       LEFT JOIN users mu ON mu.id = oa.maker_id
       WHERE oa.assigned_issuer_id = $1 AND oa.application_status = $2
       ORDER BY oa.created_at DESC`,
      [user.org_id, statusFilter]
    );
    res.json({ success: true, applications: result.rows });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
```

### 4c. Update `POST .../issue` — checker/super_admin only + patch signatory org_id

- [ ] **Step 3: Replace sub_role check and status check in the issue endpoint**

Find in the issue handler (line ~2670):

```typescript
    const subRole: string = (req as any).user.sub_role || '';
    if (subRole !== 'did_issuer_admin') {
      return res.status(403).json({ error: 'did_issuer_admin sub_role required' });
    }
```

Replace with:

```typescript
    const user = (req as any).user;
    const subRole: string = user.sub_role || '';
    if (subRole !== 'checker' && subRole !== 'super_admin') {
      return res.status(403).json({ error: 'checker or super_admin sub_role required' });
    }
```

- [ ] **Step 4: Fix the status + org check in the issue endpoint**

Find (line ~2688):

```typescript
    if (app.application_status !== 'activated') return res.status(400).json({ error: 'Application is not in activated state' });
    if (app.assigned_issuer_id !== issuerId) return res.status(403).json({ error: 'Application is assigned to a different issuer' });
```

Replace with:

```typescript
    if (app.application_status !== 'maker_reviewed') return res.status(400).json({ error: 'Application is not in maker_reviewed state' });
    if (app.assigned_issuer_id !== user.org_id) return res.status(403).json({ error: 'Application is assigned to a different issuer org' });
```

- [ ] **Step 5: Add signatory org_id patch + checker_id after super_admin is created**

The issue handler already has:
```typescript
      // 2. Set org_id = superAdminId (self-owns)
      await query(`UPDATE users SET org_id = $1 WHERE id = $1`, [superAdminId]);
```

Add signatory patch and checker_id immediately after that line:

```typescript
      // 2. Set org_id = superAdminId (self-owns)
      await query(`UPDATE users SET org_id = $1 WHERE id = $1`, [superAdminId]);

      // 2b. Patch signatory's org_id now that super_admin exists
      if (app.signatory_user_id) {
        await query(
          `UPDATE users SET org_id = $1 WHERE id = $2`,
          [superAdminId, app.signatory_user_id]
        );
      }
```

- [ ] **Step 6: Add `checker_id` to the final application UPDATE**

Find (line ~2744):

```typescript
      // 6. Mark application as issued
      await query(
        `UPDATE organization_applications
         SET application_status = 'issued', corporate_user_id = $1
         WHERE id = $2`,
        [superAdminId, id]
      );
```

Replace with:

```typescript
      // 6. Mark application as issued
      await query(
        `UPDATE organization_applications
         SET application_status = 'issued', corporate_user_id = $1, checker_id = $2
         WHERE id = $3`,
        [superAdminId, user.id, id]
      );
```

Also update `issuerId` reference in step 1 of the handler (line ~2692) — the old code uses `issuerId` (which was `user.id`) for `assigned_issuer_id` comparison. Change the issuer DID lookup to use `user.org_id`:

Find:

```typescript
    // Load issuer's parent DID for signing
    const issuerDidResult = await query(
      `SELECT id, did_string, private_key_encrypted FROM dids
       WHERE user_id = $1 AND did_type = 'parent' ORDER BY created_at DESC LIMIT 1`,
      [issuerId]
    );
```

Replace with:

```typescript
    // Load issuer org's parent DID for signing (owned by super_admin = org_id)
    const issuerDidResult = await query(
      `SELECT id, did_string, private_key_encrypted FROM dids
       WHERE user_id = $1 AND did_type = 'parent' ORDER BY created_at DESC LIMIT 1`,
      [user.org_id]
    );
```

And remove the now-unused `const issuerId = (req as any).user.id;` line (line ~2669).

### 4d. Remove Portal Manager activate/reject endpoints

- [ ] **Step 7: Delete the two portal manager endpoints**

Remove the entire `app.post('/api/portal/corporate-applications/:id/activate', ...)` handler (lines ~2583–2616).

Remove the entire `app.post('/api/portal/corporate-applications/:id/reject', ...)` handler (lines ~2618–2641).

Keep `app.get('/api/portal/corporate-applications', ...)` — the portal manager list endpoint can remain for backward compatibility (it will just show no `pending` apps in the new flow).

- [ ] **Step 8: Restart server and verify TypeScript compiles**

```bash
# Server should start without TypeScript errors.
# Confirm the new endpoints exist:
#   POST /api/did-issuer/corporate-applications/:id/maker-review
#   GET  /api/did-issuer/corporate-applications (now role-aware)
# Confirm portal activate/reject endpoints are gone (should return 404).
```

- [ ] **Step 9: Commit**

```bash
git add src/server/index.ts
git commit -m "feat(api): add maker-review endpoint, role-aware GET, update issue + remove portal activate/reject"
```

---

## Task 5: Frontend — OrganizationApplyPage.tsx 5-Step Wizard

**Files:**
- Modify: `src/frontend/pages/OrganizationApplyPage.tsx` (full replacement)

The current file has 4 steps. We add Step 2b → "Authorized Signatory" panel within Step 2 (making it 5 total steps by adding a new step 3 for DID Issuer selection), and bump Documents to Step 4, Review to Step 5.

- [ ] **Step 1: Add signatory + issuer state to the component**

At the top of `OrganizationApplyPage`, find the state declarations (after `const [people, setPeople] = ...`). Add:

```typescript
  // Step 2b — Authorized Signatory (added to Step 2 panel)
  const [signatory, setSignatory] = useState({ name: '', email: '' });

  // Step 3 — DID Issuer selection
  const [issuers, setIssuers] = useState<{ id: string; name: string; email: string }[]>([]);
  const [selectedIssuerId, setSelectedIssuerId] = useState('');
  const [issuersLoading, setIssuersLoading] = useState(false);
```

- [ ] **Step 2: Replace existing validation functions**

Find the existing `validateStep2` and `validateStep3` functions in `OrganizationApplyPage.tsx` (lines ~65–77) and replace them entirely with the following four functions:

```typescript
  async function loadIssuers() {
    setIssuersLoading(true);
    try {
      const res = await fetch('/api/public/did-issuers');
      const data = await res.json();
      setIssuers(data.issuers || []);
    } catch {
      setError('Failed to load DID Issuers');
    } finally {
      setIssuersLoading(false);
    }
  }

  function validateStep2() {
    const { super_admin_name, super_admin_email, requester_name, requester_email } = people;
    if (!super_admin_name || !super_admin_email || !requester_name || !requester_email) {
      setError('All key people fields are required'); return false;
    }
    if (!signatory.name || !signatory.email) {
      setError('Authorized Signatory name and email are required'); return false;
    }
    setError(''); return true;
  }

  function validateStep3() {
    if (!selectedIssuerId) { setError('Please select a DID Issuer'); return false; }
    setError(''); return true;
  }

  function validateStep4() {
    const mcaRef = refs['ref_MCARegistration'];
    if (!mcaRef) { setError('MCA Registration reference number is required'); return false; }
    setError(''); return true;
  }
```

The old `validateStep2` checked only super_admin/requester fields (now extended to also check signatory). The old `validateStep3` checked MCA reference — it is now renamed `validateStep4` because step numbering shifted.

- [ ] **Step 3: Update the progress bar to 5 steps**

Find:

```tsx
        <div style={{ display: 'flex', gap: 6, marginBottom: '2rem' }}>
          {[1, 2, 3, 4].map(s => (
```

Replace with:

```tsx
        <div style={{ display: 'flex', gap: 6, marginBottom: '2rem' }}>
          {[1, 2, 3, 4, 5].map(s => (
```

Also update the step label:

Find: `<p style={{ color: '#64748b', fontSize: '0.875rem' }}>Step {step} of 4</p>`

Replace: `<p style={{ color: '#64748b', fontSize: '0.875rem' }}>Step {step} of 5</p>`

- [ ] **Step 4: Add Authorized Signatory panel to Step 2**

In the Step 2 JSX block, find the closing `</div>` after the Requester panel (just before the Back/Next buttons). Insert before the buttons div:

```tsx
              {/* Authorized Signatory */}
              <div style={{ background: '#fff7ed', borderRadius: 8, padding: '1rem', marginBottom: '1.5rem', border: '1px solid #fed7aa' }}>
                <div style={{ fontWeight: 700, color: '#d97706', marginBottom: '0.75rem', fontSize: '0.9rem' }}>✍️ Authorized Signatory</div>
                <p style={{ fontSize: '0.75rem', color: '#92400e', marginBottom: '0.75rem', lineHeight: 1.5 }}>
                  This person will receive a login to review and approve this application before it is sent to the DID Issuer.
                </p>
                <div style={{ marginBottom: '0.75rem' }}>
                  <label style={labelStyle}>Full Name *</label>
                  <input style={{ ...inputStyle, borderColor: '#fed7aa' }}
                    value={signatory.name}
                    onChange={e => setSignatory(s => ({ ...s, name: e.target.value }))}
                    placeholder="Authorized Signatory name" />
                </div>
                <div>
                  <label style={labelStyle}>Email *</label>
                  <input style={{ ...inputStyle, borderColor: '#fed7aa' }} type="email"
                    value={signatory.email}
                    onChange={e => setSignatory(s => ({ ...s, email: e.target.value }))}
                    placeholder="signatory@company.com" />
                </div>
              </div>
```

Update the Step 2 "Next" button onClick:

Find: `onClick={() => { if (validateStep2()) setStep(3); }}`

Replace: `onClick={() => { if (validateStep2()) { loadIssuers(); setStep(3); } }}`

- [ ] **Step 5: Add Step 3 — DID Issuer selection JSX**

Currently Step 3 is Documents. Shift it to Step 4. Add a new `{step === 3 && ...}` block:

After the closing `</>` of the Step 2 block, insert:

```tsx
          {/* ── Step 3: Select DID Issuer ── */}
          {step === 3 && (
            <>
              <h2 style={{ fontWeight: 700, color: '#0f172a', marginBottom: '0.5rem', fontSize: '1.1rem' }}>Select DID Issuer</h2>
              <p style={{ color: '#64748b', fontSize: '0.8rem', marginBottom: '1.5rem' }}>
                Which DID Issuer will issue your corporate DID and Verifiable Credentials?
              </p>

              {issuersLoading ? (
                <div style={{ textAlign: 'center', padding: '2rem', color: '#94a3b8' }}>Loading issuers…</div>
              ) : issuers.length === 0 ? (
                <div style={{ background: '#fef2f2', border: '1px solid #fecaca', borderRadius: 8, padding: '1rem', color: '#dc2626', fontSize: '0.875rem' }}>
                  No DID Issuers available. Please contact support.
                </div>
              ) : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem', marginBottom: '1.5rem' }}>
                  {issuers.map(iss => (
                    <label key={iss.id} style={{
                      display: 'flex', alignItems: 'center', gap: '1rem', padding: '1rem',
                      borderRadius: 8, cursor: 'pointer',
                      border: `2px solid ${selectedIssuerId === iss.id ? '#2563eb' : '#e2e8f0'}`,
                      background: selectedIssuerId === iss.id ? '#eff6ff' : 'white',
                    }}>
                      <input type="radio" name="issuer" value={iss.id}
                        checked={selectedIssuerId === iss.id}
                        onChange={() => setSelectedIssuerId(iss.id)}
                        style={{ accentColor: '#2563eb' }} />
                      <div>
                        <div style={{ fontWeight: 700, color: '#1e293b', fontSize: '0.9rem' }}>{iss.name}</div>
                        <div style={{ fontSize: '0.75rem', color: '#64748b' }}>{iss.email}</div>
                      </div>
                    </label>
                  ))}
                </div>
              )}

              <div style={{ display: 'flex', gap: '0.75rem' }}>
                <button style={backBtnStyle} onClick={() => setStep(2)}>← Back</button>
                <button style={{ ...nextBtnStyle, flex: 2 }} onClick={() => { if (validateStep3()) setStep(4); }}>
                  Next →
                </button>
              </div>
            </>
          )}
```

- [ ] **Step 6: Shift Documents to Step 4 and Review to Step 5**

In the Documents JSX block, change `{step === 3 && (` to `{step === 4 && (`.

Update its back button: `onClick={() => setStep(2)}` → `onClick={() => setStep(3)}`.

Update its next button: `onClick={() => { if (validateStep3()) setStep(4); }}` → `onClick={() => { if (validateStep4()) setStep(5); }}`.

In the Review & Submit JSX block, change `{step === 4 && (` to `{step === 5 && (`.

Update its back button: `onClick={() => setStep(3)}` → `onClick={() => setStep(4)}`.

- [ ] **Step 7: Add signatory + issuer to the FormData and review summary**

In `handleSubmit`, after `Object.entries(people).forEach(...)`, add:

```typescript
      // Signatory + issuer
      fd.append('signatory_name', signatory.name);
      fd.append('signatory_email', signatory.email);
      fd.append('assigned_issuer_id', selectedIssuerId);
```

In the Review Step 5, update the step-5 screen trigger from `setStep(5)` on successful submit to `setStep(6)` and update `{step === 5 && (` success screen check to `{step === 6 && (`.

Wait — let's keep the success screen at step 6 to avoid a collision. Change `setApplicationId(data.applicationId); setStep(5);` to:

```typescript
      setApplicationId(data.applicationId);
      setSignatoryTempPassword(data.signatory_temp_password || '');
      setStep(6);
```

Add the state variable at the top of the component:

```typescript
  const [signatoryTempPassword, setSignatoryTempPassword] = useState('');
```

Update the success screen check from `if (step === 5)` to `if (step === 6)`.

In the success screen JSX, show the signatory temp password. After the applicationId code block add:

```tsx
          {signatoryTempPassword && (
            <>
              <p style={{ color: '#64748b', fontSize: '0.875rem', marginBottom: '0.5rem' }}>
                Authorized Signatory login credentials:
              </p>
              <div style={{ background: '#fff7ed', border: '1px solid #fed7aa', borderRadius: 6, padding: '0.75rem', marginBottom: '1.5rem', fontSize: '0.8rem', color: '#92400e' }}>
                <div>📧 {signatory.email}</div>
                <div style={{ marginTop: '0.35rem' }}>🔑 Temp password: <strong>{signatoryTempPassword}</strong></div>
                <div style={{ marginTop: '0.5rem', fontSize: '0.7rem' }}>Share these credentials with your Authorized Signatory. They can change the password after first login.</div>
              </div>
            </>
          )}
```

Also update the amber info box in the Review step to say:

```tsx
              <div style={{ background: '#fff7ed', border: '1px solid #fed7aa', borderRadius: 8, padding: '0.75rem 1rem', marginBottom: '1.5rem', fontSize: '0.8rem', color: '#92400e' }}>
                ⏱ After submission: Authorized Signatory reviews → DID Issuer Maker verifies → DID Issuer Checker issues your corporate DID + credentials
              </div>
```

Add the selected issuer name to the Review step Key People panel:

```tsx
                <div style={{ fontSize: '0.8rem', color: '#374151', marginTop: '0.25rem' }}>Signatory: {signatory.name} ({signatory.email})</div>
                <div style={{ fontSize: '0.8rem', color: '#374151', marginTop: '0.25rem' }}>DID Issuer: {issuers.find(i => i.id === selectedIssuerId)?.name || selectedIssuerId}</div>
```

- [ ] **Step 8: Restart frontend, navigate to `/signup`, verify 5-step flow works**

```bash
# Expected:
# Step 1: Company Info
# Step 2: Key People (Super Admin + Requester + Authorized Signatory panels)
# Step 3: DID Issuer selection (radio cards loaded from API)
# Step 4: Documents (unchanged)
# Step 5: Review & Submit (shows signatory + issuer in summary)
# Step 6: Success screen with applicationId + signatory temp password
```

- [ ] **Step 9: Commit**

```bash
git add src/frontend/pages/OrganizationApplyPage.tsx
git commit -m "feat(frontend): 5-step registration wizard with signatory + DID Issuer selection"
```

---

## Task 6: Frontend — New `SignatoryDashboard.tsx`

**Files:**
- Create: `src/frontend/pages/SignatoryDashboard.tsx`

- [ ] **Step 1: Create the file**

Create `src/frontend/pages/SignatoryDashboard.tsx` with this content:

```tsx
import React, { useState, useEffect } from 'react';
import { useAuth } from '../contexts/AuthContext';

export default function SignatoryDashboard() {
  const { token } = useAuth();
  const [applications, setApplications] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [msg, setMsg] = useState('');
  const [rejectingId, setRejectingId] = useState<string | null>(null);
  const [rejectReason, setRejectReason] = useState('');

  const authHeader = () => ({ Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' });

  useEffect(() => { loadApplications(); }, []);

  async function loadApplications() {
    setLoading(true);
    try {
      const res = await fetch('/api/corporate/signatory/applications', { headers: authHeader() });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      setApplications(data.applications || []);
    } catch (e: any) {
      setMsg(e.message);
    } finally {
      setLoading(false);
    }
  }

  async function handleApprove(appId: string) {
    setMsg('');
    try {
      const res = await fetch(`/api/corporate/signatory/applications/${appId}/approve`, {
        method: 'POST', headers: authHeader(), body: '{}',
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      setMsg('✅ Application approved and submitted to DID Issuer.');
      loadApplications();
    } catch (e: any) { setMsg(e.message); }
  }

  async function handleReject(appId: string) {
    setMsg('');
    try {
      const res = await fetch(`/api/corporate/signatory/applications/${appId}/reject`, {
        method: 'POST', headers: authHeader(),
        body: JSON.stringify({ rejection_reason: rejectReason }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      setMsg('Application rejected.');
      setRejectingId(null);
      setRejectReason('');
      loadApplications();
    } catch (e: any) { setMsg(e.message); }
  }

  return (
    <div style={{ minHeight: '100vh', background: '#f1f5f9', padding: '2rem 1rem' }}>
      <div style={{ maxWidth: 720, margin: '0 auto' }}>

        {/* Header */}
        <div style={{ marginBottom: '2rem' }}>
          <h1 style={{ fontWeight: 800, color: '#0f172a', fontSize: '1.5rem', margin: 0 }}>Authorized Signatory</h1>
          <p style={{ color: '#64748b', fontSize: '0.875rem', marginTop: '0.25rem' }}>
            Review and approve corporate registration applications assigned to you.
          </p>
        </div>

        {msg && (
          <div style={{
            padding: '0.75rem 1rem', borderRadius: 8, marginBottom: '1rem', fontSize: '0.875rem',
            background: msg.startsWith('✅') ? '#f0fdf4' : '#fef2f2',
            color: msg.startsWith('✅') ? '#166534' : '#dc2626',
            border: `1px solid ${msg.startsWith('✅') ? '#bbf7d0' : '#fecaca'}`,
          }}>
            {msg}
          </div>
        )}

        {loading && (
          <div style={{ textAlign: 'center', padding: '3rem', color: '#94a3b8' }}>Loading…</div>
        )}

        {!loading && applications.length === 0 && (
          <div style={{ background: 'white', borderRadius: 12, padding: '3rem', textAlign: 'center', boxShadow: '0 2px 8px rgba(0,0,0,0.06)' }}>
            <div style={{ fontSize: '2.5rem', marginBottom: '1rem' }}>📋</div>
            <div style={{ color: '#64748b', fontSize: '0.9rem' }}>No pending applications assigned to you.</div>
          </div>
        )}

        {applications.map((app: any) => {
          const docs: any[] = app.documents || [];
          return (
            <div key={app.id} style={{ background: 'white', borderRadius: 12, padding: '1.5rem', marginBottom: '1.5rem', boxShadow: '0 2px 8px rgba(0,0,0,0.06)' }}>

              {/* Company header */}
              <div style={{ marginBottom: '1.25rem' }}>
                <div style={{ fontWeight: 800, fontSize: '1.1rem', color: '#0f172a' }}>{app.company_name}</div>
                <div style={{ fontSize: '0.78rem', color: '#64748b', marginTop: '0.25rem' }}>
                  CIN: {app.cin} · Submitted: {new Date(app.created_at).toLocaleDateString()}
                </div>
                {app.assigned_issuer_name && (
                  <div style={{ fontSize: '0.78rem', color: '#2563eb', marginTop: '0.25rem' }}>
                    DID Issuer: {app.assigned_issuer_name}
                  </div>
                )}
              </div>

              {/* Key People */}
              <div style={{ background: '#eff6ff', borderRadius: 8, padding: '0.9rem', marginBottom: '1rem' }}>
                <div style={{ fontWeight: 700, color: '#2563eb', fontSize: '0.82rem', marginBottom: '0.5rem' }}>Key People</div>
                <div style={{ fontSize: '0.8rem', color: '#374151' }}>Super Admin: {app.super_admin_name} ({app.super_admin_email})</div>
                <div style={{ fontSize: '0.8rem', color: '#374151', marginTop: '0.25rem' }}>Requester: {app.requester_name} ({app.requester_email})</div>
              </div>

              {/* Documents */}
              {docs.length > 0 && (
                <div style={{ marginBottom: '1rem' }}>
                  <div style={{ fontWeight: 700, fontSize: '0.82rem', color: '#374151', marginBottom: '0.5rem' }}>Documents</div>
                  {docs.map((doc: any, i: number) => (
                    <div key={i} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '0.4rem 0.75rem', borderRadius: 6, background: '#f8fafc', border: '1px solid #e2e8f0', marginBottom: '0.35rem', fontSize: '0.8rem' }}>
                      <div>
                        <span style={{ fontWeight: 600, color: '#1e293b' }}>{doc.vc_type}</span>
                        <span style={{ color: '#64748b', marginLeft: '0.5rem' }}>{doc.reference_number}</span>
                      </div>
                      {doc.file_path && (
                        <a href={`/${doc.file_path}`} target="_blank" rel="noopener noreferrer"
                          style={{ fontSize: '0.75rem', color: '#2563eb', textDecoration: 'none' }}>
                          📎 View
                        </a>
                      )}
                    </div>
                  ))}
                </div>
              )}

              {/* Warning */}
              <div style={{ background: '#fff7ed', border: '1px solid #fed7aa', borderRadius: 8, padding: '0.75rem 1rem', marginBottom: '1.25rem', fontSize: '0.8rem', color: '#92400e' }}>
                ⚠️ Approving this will submit the application to <strong>{app.assigned_issuer_name || 'the DID Issuer'}</strong> for DID issuance.
              </div>

              {/* Reject inline form */}
              {rejectingId === app.id && (
                <div style={{ background: '#fef2f2', border: '1px solid #fecaca', borderRadius: 8, padding: '1rem', marginBottom: '1rem' }}>
                  <div style={{ fontWeight: 600, color: '#dc2626', marginBottom: '0.5rem', fontSize: '0.85rem' }}>Rejection Reason (optional)</div>
                  <textarea
                    value={rejectReason}
                    onChange={e => setRejectReason(e.target.value)}
                    placeholder="Reason for rejection…"
                    style={{ width: '100%', minHeight: 72, padding: '0.5rem', borderRadius: 6, border: '1px solid #fecaca', fontSize: '0.875rem', boxSizing: 'border-box', resize: 'vertical' }}
                  />
                  <div style={{ display: 'flex', gap: '0.5rem', marginTop: '0.75rem' }}>
                    <button
                      style={{ flex: 1, padding: '0.6rem', background: '#dc2626', color: 'white', border: 'none', borderRadius: 6, fontWeight: 700, cursor: 'pointer', fontSize: '0.875rem' }}
                      onClick={() => handleReject(app.id)}
                    >
                      Confirm Reject
                    </button>
                    <button
                      style={{ flex: 1, padding: '0.6rem', background: '#f1f5f9', color: '#64748b', border: '1px solid #e2e8f0', borderRadius: 6, cursor: 'pointer', fontSize: '0.875rem' }}
                      onClick={() => { setRejectingId(null); setRejectReason(''); }}
                    >
                      Cancel
                    </button>
                  </div>
                </div>
              )}

              {/* Actions */}
              {rejectingId !== app.id && (
                <div style={{ display: 'flex', gap: '0.75rem' }}>
                  <button
                    style={{ flex: 1, padding: '0.75rem', background: '#f1f5f9', color: '#dc2626', border: '1px solid #fecaca', borderRadius: 8, fontWeight: 700, cursor: 'pointer', fontSize: '0.9rem' }}
                    onClick={() => setRejectingId(app.id)}
                  >
                    ✗ Reject
                  </button>
                  <button
                    style={{ flex: 2, padding: '0.75rem', background: '#2563eb', color: 'white', border: 'none', borderRadius: 8, fontWeight: 700, cursor: 'pointer', fontSize: '0.9rem' }}
                    onClick={() => handleApprove(app.id)}
                  >
                    ✓ Approve & Submit to DID Issuer
                  </button>
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Commit the new file**

```bash
git add src/frontend/pages/SignatoryDashboard.tsx
git commit -m "feat(frontend): add SignatoryDashboard for authorized signatory review"
```

---

## Task 7: Frontend — AuthorityDashboard.tsx Role-Aware Corp Applications Tab

**Files:**
- Modify: `src/frontend/pages/AuthorityDashboard.tsx`

### 7a. Add maker-review handler

- [ ] **Step 1: Add `handleMakerReview` function**

In `AuthorityDashboard.tsx`, after the `handleIssueCorpDID` function (line ~155), add:

```typescript
  async function handleMakerReview(appId: string) {
    setLoading(true);
    setCorpAppMsg('');
    try {
      const res = await fetch(`/api/did-issuer/corporate-applications/${appId}/maker-review`, {
        method: 'POST',
        headers: authHeader(),
        body: '{}',
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      setCorpAppMsg('✅ Sent to checker.');
      loadCorpApplications();
    } catch (e: any) { setCorpAppMsg(e.message); }
    finally { setLoading(false); }
  }
```

### 7b. Update the `loadCorpApplications` function trigger condition

- [ ] **Step 2: Update the useEffect status conditions**

Find the `useEffect` that loads based on `view` (line ~83):

```typescript
    if (view === 'corp-applications') loadCorpApplications();
```

This line stays as-is — the backend already filters by role.

### 7c. Replace Corp Applications JSX with role-aware version

- [ ] **Step 3: Replace the Corp Applications JSX section**

Find in `AuthorityDashboard.tsx` the section starting with:

```tsx
      {/* ── Corp Applications (did_issuer_admin only) ── */}
      {view === 'corp-applications' && (
```

Replace the entire block (from that comment through the closing `)}`) with:

```tsx
      {/* ── Corp Applications (role-aware: maker / checker / super_admin) ── */}
      {view === 'corp-applications' && (
        <>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1.5rem' }}>
            <h2 style={{ margin: 0 }}>
              {subRole === 'maker' ? 'Corporate Applications — Awaiting Review' : 'Corporate Applications — Ready to Issue'}
            </h2>
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
              {subRole === 'maker' ? 'No applications awaiting maker review.' : 'No applications ready to issue.'}
            </div>
          )}

          {corpApps.map(app => {
            const docs: any[] = app.documents || [];
            const slug = (app.company_name || '').toLowerCase().replace(/[^a-z0-9]/g, '-').replace(/-+/g, '-');
            const didPreview = `did:web:didvc.platform:${slug}`;
            const myVcTypes = selectedVcTypes[app.id] || [];

            return (
              <div key={app.id} className="card" style={{ marginBottom: '1.5rem', padding: '1.5rem', border: `2px solid ${subRole === 'maker' ? '#f59e0b' : '#2563eb'}` }}>
                <div style={{ fontWeight: 800, fontSize: '1.05rem', color: '#1e293b', marginBottom: '0.25rem' }}>{app.company_name}</div>
                <div style={{ fontSize: '0.78rem', color: '#64748b', marginBottom: '0.25rem' }}>
                  CIN: {app.cin} · Signatory: {app.signatory_name || '—'}
                </div>
                <div style={{ fontSize: '0.78rem', color: '#64748b', marginBottom: '0.75rem' }}>
                  Submitted: {new Date(app.created_at).toLocaleDateString()}
                  {app.maker_name && <span> · Reviewed by: {app.maker_name}</span>}
                </div>

                {/* Documents list */}
                <div style={{ background: 'white', borderRadius: 6, padding: '0.75rem', marginBottom: '0.75rem', border: '1px solid #e2e8f0' }}>
                  <div style={{ fontSize: '0.7rem', fontWeight: 700, color: '#374151', marginBottom: '0.5rem' }}>
                    {subRole === 'maker' ? 'Documents' : 'VCs to issue against documents'}
                  </div>
                  {docs.length === 0 && <span style={{ fontSize: '0.8rem', color: '#94a3b8' }}>No documents</span>}
                  {docs.map((doc: any, i: number) => (
                    subRole === 'maker' ? (
                      <div key={i} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '0.4rem 0.75rem', borderRadius: 4, marginBottom: '0.35rem', background: '#f8fafc', border: '1px solid #e2e8f0' }}>
                        <div>
                          <div style={{ fontWeight: 600, fontSize: '0.82rem', color: '#1e293b' }}>{doc.vc_type}</div>
                          <div style={{ fontSize: '0.7rem', color: '#64748b' }}>
                            {doc.file_path
                              ? <a href={`/${doc.file_path}`} target="_blank" rel="noopener noreferrer" style={{ color: '#2563eb', textDecoration: 'none' }}>📄 {doc.file_path.split('/').pop()}</a>
                              : `📋 Ref: ${doc.reference_number}`}
                          </div>
                        </div>
                      </div>
                    ) : (
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
                    )
                  ))}
                </div>

                {/* DID Preview (checker/super_admin only) */}
                {subRole !== 'maker' && (
                  <div style={{ background: 'white', borderRadius: 6, padding: '0.6rem 0.9rem', marginBottom: '0.75rem', border: '1px solid #e2e8f0' }}>
                    <div style={{ fontSize: '0.7rem', fontWeight: 700, color: '#374151', marginBottom: '0.25rem' }}>DID to be issued</div>
                    <code style={{ fontSize: '0.72rem', color: '#2563eb', wordBreak: 'break-all' }}>{didPreview}</code>
                  </div>
                )}

                {/* Warning (checker/super_admin only) */}
                {subRole !== 'maker' && (
                  <div style={{ background: '#fff7ed', border: '1px solid #fed7aa', borderRadius: 6, padding: '0.6rem 0.75rem', marginBottom: '1rem', fontSize: '0.75rem', color: '#92400e' }}>
                    ⚡ Clicking "Issue" will: create the corporate DID · create super_admin + requester accounts · issue selected VCs to corporate wallet · log temp passwords to server console
                  </div>
                )}

                {/* Action button */}
                {subRole === 'maker' ? (
                  <button
                    style={{ width: '100%', padding: '0.75rem', background: loading ? '#94a3b8' : '#f59e0b', color: 'white', border: 'none', borderRadius: 8, fontWeight: 700, fontSize: '0.95rem', cursor: loading ? 'default' : 'pointer' }}
                    disabled={loading}
                    onClick={() => handleMakerReview(app.id)}
                  >
                    Send to Checker →
                  </button>
                ) : (
                  <button
                    style={{ width: '100%', padding: '0.75rem', background: loading ? '#94a3b8' : '#16a34a', color: 'white', border: 'none', borderRadius: 8, fontWeight: 700, fontSize: '0.95rem', cursor: loading ? 'default' : 'pointer' }}
                    disabled={loading}
                    onClick={() => handleIssueCorpDID(app.id)}
                  >
                    🔑 Issue DID + Credentials →
                  </button>
                )}
              </div>
            );
          })}
        </>
      )}
```

- [ ] **Step 4: Commit**

```bash
git add src/frontend/pages/AuthorityDashboard.tsx
git commit -m "feat(frontend): role-aware Corp Applications tab (maker/checker) in AuthorityDashboard"
```

---

## Task 8: Frontend — PortalManagerDashboard Cleanup + AppShell + App.tsx Routing

**Files:**
- Modify: `src/frontend/pages/PortalManagerDashboard.tsx`
- Modify: `src/frontend/components/AppShell.tsx`
- Modify: `src/frontend/App.tsx`

### 8a. Remove Corp Applications tab from PortalManagerDashboard

- [ ] **Step 1: Remove `'applications'` from Tab union type**

Find in `PortalManagerDashboard.tsx` (line ~5):

```typescript
type Tab = 'overview' | 'authorities' | 'dids' | 'organizations' | 'entities' | 'entity-onboard' | 'admin-queue' | 'admin-team' | 'applications';
```

Replace with:

```typescript
type Tab = 'overview' | 'authorities' | 'dids' | 'organizations' | 'entities' | 'entity-onboard' | 'admin-queue' | 'admin-team';
```

- [ ] **Step 2: Remove Corp Applications state variables**

Remove these lines (lines ~84–88):

```typescript
  // Corp Applications tab state
  const [corpApps, setCorpApps] = useState<any[]>([]);
  const [availableIssuers, setAvailableIssuers] = useState<any[]>([]);
  const [selectedIssuer, setSelectedIssuer] = useState<Record<string, string>>({});
  const [expandedApp, setExpandedApp] = useState<string | null>(null);
  const [appMsg, setAppMsg] = useState('');
```

- [ ] **Step 3: Remove the Corp Applications `loadTab` branch**

Find the `loadTab` function — there will be a branch like `if (tab === 'applications') { ... }` that calls `loadCorpApplications` and `loadAvailableIssuers`. Remove that entire branch.

- [ ] **Step 4: Remove `loadCorpApplications`, `loadAvailableIssuers`, `handleActivate`, `handleRejectApp` functions**

Search for and delete:
- `async function loadCorpApplications() { ... }`
- `async function loadAvailableIssuers() { ... }` (or similar)  
- `async function handleActivate(appId: string) { ... }`
- `async function handleRejectApp(appId: string) { ... }`

- [ ] **Step 5: Remove Corp Applications JSX panel**

Find the `{tab === 'applications' && ( ... )}` JSX block and remove the entire block.

### 8b. Update AppShell.tsx — signatory routing + remove portal_manager Corp Applications nav

- [ ] **Step 6: Remove portal_manager Corp Applications nav item from AppShell**

Find in `src/frontend/components/AppShell.tsx`:

```typescript
    { tab: 'applications',   label: 'Corp Applications',          icon: '📋' },
```

Delete that line.

- [ ] **Step 7: Update government_agency corp-applications nav to show to maker/checker/super_admin (not just did_issuer_admin)**

Find:

```typescript
    { tab: 'corp-applications', label: 'Corp Applications',  icon: '🏢', subRoles: ['did_issuer_admin'] },
```

Replace with:

```typescript
    { tab: 'corp-applications', label: 'Corp Applications',  icon: '🏢', subRoles: ['maker', 'checker', 'super_admin'] },
```

### 8c. Add `/corporate/signatory` route in App.tsx

- [ ] **Step 8: Import SignatoryDashboard in App.tsx**

In `src/frontend/App.tsx`, add import after the existing page imports (line ~16):

```typescript
import SignatoryDashboard from './pages/SignatoryDashboard';
```

- [ ] **Step 9: Add the route**

In the `AppRoutes` function, after the `/corporate/compose-vp` route (line ~66), add:

```tsx
      <Route path="/corporate/signatory" element={
        <ProtectedRouteWrapper role="corporate">
          <SignatoryDashboard />
        </ProtectedRouteWrapper>
      } />
```

- [ ] **Step 10: Update the login redirect for authorized_signatory in AuthContext or LoginPage**

The `authorized_signatory` user needs to be redirected to `/corporate/signatory` after login instead of `/corporate/dashboard`. Check `src/frontend/pages/LoginPage.tsx` for the redirect logic.

Find the post-login redirect in `LoginPage.tsx`. It likely looks like:

```typescript
if (data.user.role === 'corporate') navigate('/corporate/dashboard');
```

Add a condition before the corporate redirect:

```typescript
if (data.user.role === 'corporate' && data.user.sub_role === 'authorized_signatory') {
  navigate('/corporate/signatory');
} else if (data.user.role === 'corporate') {
  navigate('/corporate/dashboard');
}
```

- [ ] **Step 11: Rebuild frontend and test**

```bash
# Expected end-to-end flow:
# 1. Corporate submits 5-step form → sees applicationId + signatory temp password
# 2. Signatory logs in → lands on /corporate/signatory → sees the application
# 3. Signatory clicks Approve → status becomes signatory_approved
# 4. DID Issuer Maker logs in → sees app in Corp Applications tab → clicks "Send to Checker"
# 5. DID Issuer Checker logs in → sees app → selects VCs → clicks Issue → DID + VCs created
# 6. Super admin logs in → sees credentials in wallet
```

- [ ] **Step 12: Commit**

```bash
git add src/frontend/pages/PortalManagerDashboard.tsx src/frontend/components/AppShell.tsx src/frontend/App.tsx src/frontend/pages/LoginPage.tsx
git commit -m "feat(frontend): signatory route + cleanup portal manager corp apps + update nav sub_roles"
```

---

## Verification Checklist

Run through this manually after all tasks complete:

- [ ] Submit a new corporate registration with all 5 steps including signatory + DID Issuer selection
- [ ] Confirm server console logs: `[SUBMITTED] signatory: <email> | password: <pass>`
- [ ] Confirm success screen shows signatory temp password
- [ ] Login as signatory → redirects to `/corporate/signatory`
- [ ] Signatory approves → application status becomes `signatory_approved`
- [ ] Login as maker (government_agency org member with `sub_role=maker`) → Corp Applications tab shows the `signatory_approved` app
- [ ] Maker clicks "Send to Checker" → status becomes `maker_reviewed`
- [ ] Login as checker (government_agency org member with `sub_role=checker`) → Corp Applications tab shows the `maker_reviewed` app
- [ ] Checker issues DID + VCs → server console logs temp passwords → status becomes `issued`
- [ ] Login as corporate super_admin → wallet shows issued VCs
- [ ] Portal Manager dashboard → Corp Applications tab is gone
