# Role Hierarchy + Maker/Checker Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Expand the 3-role system to a 10-role hierarchy with `sub_role` column, Maker/Checker dual-control for both authority VC issuance and corporate VP sharing, and a full Portal Manager admin UI.

**Architecture:** Three layers built in sequence — (A) DB schema + auth plumbing, (B) `mc_actions` table + Maker/Checker API routes + sub-role-aware dashboard views, (C) Portal Manager backend routes + 4-tab dashboard UI. Each layer is independently deployable and testable.

**Tech Stack:** PostgreSQL 15 (port 5433), Express/TypeScript (`npx tsx`), React 18 + React Router v6, bcryptjs, custom CSS + inline styles (no Tailwind). No git repository — skip all commit steps.

---

## File Map

| File | Action | Responsibility |
|---|---|---|
| `src/db/schema.sql` | Modify | Add `sub_role`, `org_id` columns to `users`; add `portal_manager` to role CHECK; add `mc_actions` and `vp_requests` tables |
| `src/db/seeds/portal-manager.sql` | Create | Seed Portal Manager user |
| `src/server/index.ts` | Modify | `requireSubRole` helper; MC routes; portal routes; corporate team routes; update approve route to set `sub_role='super_admin'` + `org_id` |
| `src/frontend/contexts/AuthContext.tsx` | Modify | Add `sub_role` + `org_id` to `User`; add `portal_manager` to `UserRole`; update `redirectByRole` |
| `src/frontend/App.tsx` | Modify | Add `/portal/dashboard` route; add `portal_manager` nav link; update role badge label |
| `src/frontend/pages/RegisterPage.tsx` | Modify | Remove `government_agency` role option (Portal Manager provisions those now) |
| `src/frontend/pages/AuthorityDashboard.tsx` | Modify | Sub-role aware views: Maker (submit to checker) / Checker (queue) / VC Issuer Admin (all) |
| `src/frontend/pages/CorporateDashboard.tsx` | Modify | Sub-role aware: Maker VP draft, Checker VP queue, Super Admin/Admin Team tab |
| `src/frontend/pages/PortalManagerDashboard.tsx` | Create | 4-tab Portal Manager UI |

---

## Task 1: DB Schema — sub_role, org_id, portal_manager

**Files:**
- Modify: `src/db/schema.sql`

- [ ] **Step 1: Add migration guards at bottom of schema.sql**

Open `src/db/schema.sql`. Append after the last existing `DO $$ ... END $$;` block (currently the `authority_type` migration at line ~188):

```sql
-- Phase 3A: Role hierarchy migrations

-- 1. Add portal_manager to role CHECK (drop and recreate constraint)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'users' AND column_name = 'sub_role'
  ) THEN
    ALTER TABLE users ADD COLUMN sub_role VARCHAR(30)
      CHECK (sub_role IN (
        'did_issuer_admin', 'vc_issuer_admin', 'maker', 'checker',
        'super_admin', 'admin', 'operator', 'member'
      ));
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'users' AND column_name = 'org_id'
  ) THEN
    ALTER TABLE users ADD COLUMN org_id UUID REFERENCES users(id);
  END IF;
END $$;

-- Update role CHECK to include portal_manager (idempotent approach: alter existing constraint)
DO $$
BEGIN
  -- Drop old constraint if it doesn't include portal_manager
  IF EXISTS (
    SELECT 1 FROM information_schema.table_constraints
    WHERE constraint_name = 'users_role_check' AND table_name = 'users'
  ) THEN
    ALTER TABLE users DROP CONSTRAINT users_role_check;
  END IF;
  -- Add updated constraint
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.table_constraints
    WHERE constraint_name = 'chk_users_role' AND table_name = 'users'
  ) THEN
    ALTER TABLE users ADD CONSTRAINT chk_users_role
      CHECK (role IN ('portal_manager', 'government_agency', 'corporate', 'verifier'));
  END IF;
END $$;

-- mc_actions table
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

-- vp_requests table
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

CREATE INDEX IF NOT EXISTS idx_mc_actions_resource ON mc_actions(resource_type, resource_id);
CREATE INDEX IF NOT EXISTS idx_mc_actions_maker ON mc_actions(maker_id);
CREATE INDEX IF NOT EXISTS idx_mc_actions_status ON mc_actions(status);
CREATE INDEX IF NOT EXISTS idx_vp_requests_org ON vp_requests(holder_org_id);
```

- [ ] **Step 2: Apply the migration**

```bash
DATABASE_URL=postgresql://didvc_user:didvc_pass@localhost:5433/didvc
psql $DATABASE_URL -f /Users/kamleshnagware/did-vc-project/src/db/schema.sql
```

Expected: multiple `DO`, `CREATE TABLE`, `CREATE INDEX` lines — no ERROR lines.

- [ ] **Step 3: Verify new columns and tables exist**

```bash
psql postgresql://didvc_user:didvc_pass@localhost:5433/didvc -c "\d users" | grep -E "sub_role|org_id|role"
psql postgresql://didvc_user:didvc_pass@localhost:5433/didvc -c "\dt mc_actions vp_requests"
```

Expected: `sub_role` and `org_id` columns in users; both tables listed.

---

## Task 2: Seed Portal Manager user

**Files:**
- Create: `src/db/seeds/portal-manager.sql`

- [ ] **Step 1: Create the seeds directory and generate bcrypt hash**

```bash
mkdir -p /Users/kamleshnagware/did-vc-project/src/db/seeds
node -e "const b=require('bcryptjs'); b.hash('PortalManager@2026',10).then(h=>console.log(h))"
```

Copy the printed hash — it looks like `$2a$10$...` (60 chars).

- [ ] **Step 2: Create seed file**

Create `src/db/seeds/portal-manager.sql` with the hash from Step 1 substituted in:

```sql
INSERT INTO users (email, password_hash, role, name)
VALUES (
  'portal@didvc.platform',
  '$2a$10$REPLACE_WITH_HASH_FROM_STEP_1',
  'portal_manager',
  'DID-VC Portal Manager'
) ON CONFLICT (email) DO NOTHING;
```

- [ ] **Step 3: Apply seed**

```bash
psql postgresql://didvc_user:didvc_pass@localhost:5433/didvc -f /Users/kamleshnagware/did-vc-project/src/db/seeds/portal-manager.sql
```

Expected: `INSERT 0 1` (or `INSERT 0 0` if already exists).

- [ ] **Step 4: Verify**

```bash
psql postgresql://didvc_user:didvc_pass@localhost:5433/didvc -c "SELECT email, role, name FROM users WHERE role='portal_manager';"
```

Expected: one row with `portal@didvc.platform`.

---

## Task 3: Backend — requireSubRole helper + update auth routes

**Files:**
- Modify: `src/server/index.ts`

- [ ] **Step 1: Add requireSubRole middleware after requireRole**

Find the `requireRole` function (around line 49 in index.ts). Insert immediately after its closing `};`:

```typescript
const requireSubRole = (subRole: string) => (req: express.Request, res: express.Response, next: express.NextFunction) => {
  const user = (req as any).user;
  if (!user || (user as any).sub_role !== subRole) {
    return res.status(403).json({ error: `This endpoint requires sub_role: ${subRole}` });
  }
  next();
};
```

- [ ] **Step 2: Update /api/auth/me to return sub_role and org_id**

Find this line (around line 242):
```typescript
  res.json({
    success: true,
    user: { id: user.id, email: user.email, role: user.role, did, name: user.name, authority_type: user.authority_type || null },
  });
```

Replace with:
```typescript
  res.json({
    success: true,
    user: { id: user.id, email: user.email, role: user.role, did, name: user.name, authority_type: (user as any).authority_type || null, sub_role: (user as any).sub_role || null, org_id: (user as any).org_id || null },
  });
```

- [ ] **Step 3: Update /api/auth/verify-mfa to return sub_role and org_id**

Find (around line 217):
```typescript
      user: { id: user.id, email: user.email, role: user.role, did, name: user.name, authority_type: (user as any).authority_type || null },
```

Replace with:
```typescript
      user: { id: user.id, email: user.email, role: user.role, did, name: user.name, authority_type: (user as any).authority_type || null, sub_role: (user as any).sub_role || null, org_id: (user as any).org_id || null },
```

- [ ] **Step 4: Update /api/auth/register — block government_agency public registration**

Find (around line 125):
```typescript
    if (!['government_agency', 'verifier'].includes(role)) {
      return res.status(400).json({ error: 'Invalid role. Must be government_agency or verifier' });
    }
```

Replace with:
```typescript
    if (!['verifier'].includes(role)) {
      return res.status(400).json({ error: 'Invalid role. Use /api/portal/authorities to create authority accounts.' });
    }
```

Also remove the authority_type validation block (lines ~128–134) since verifiers don't need it:
```typescript
    // Remove these lines:
    // const validAuthorityTypes = ['mca', 'dgft', 'gstn_trust_anchor', 'pan_trust_anchor'];
    // if (role === 'government_agency' && !authority_type) { ... }
    // if (authority_type && !validAuthorityTypes.includes(authority_type)) { ... }
```

- [ ] **Step 5: Update the org approve route to set sub_role='super_admin' and org_id on corporate user creation**

Find (around line 1594–1598) the INSERT into users inside the approve route:
```typescript
        const userResult = await query(
          'INSERT INTO users (email, password_hash, role, name) VALUES ($1, $2, $3, $4) RETURNING id',
          [org.email, passwordHash, 'corporate', org.company_name]
        );
        userId = userResult.rows[0].id;
```

Replace with:
```typescript
        const userResult = await query(
          'INSERT INTO users (email, password_hash, role, name, sub_role) VALUES ($1, $2, $3, $4, $5) RETURNING id',
          [org.email, passwordHash, 'corporate', org.company_name, 'super_admin']
        );
        userId = userResult.rows[0].id;
        // Set org_id = self (super admin owns the org scope)
        await query('UPDATE users SET org_id = $1 WHERE id = $1', [userId]);
```

- [ ] **Step 6: Smoke test — restart backend and verify sub_role returned on login**

```bash
pkill -f "tsx src/server/index.ts" 2>/dev/null; sleep 1
DATABASE_URL=postgresql://didvc_user:didvc_pass@localhost:5433/didvc PORT=3002 npx tsx src/server/index.ts &
sleep 3

# Login as portal manager
TOKEN=$(python3 -c "
import urllib.request, urllib.parse, json
data = json.dumps({'email':'portal@didvc.platform','password':'PortalManager@2026'}).encode()
req = urllib.request.Request('http://localhost:3002/api/auth/login', data=data, headers={'Content-Type':'application/json'})
res = urllib.request.urlopen(req)
print(json.loads(res.read())['tempToken'])
")
echo "tempToken: $TOKEN"
```

Expected: a hex temp token printed.

---

## Task 4: Backend — MC action routes

**Files:**
- Modify: `src/server/index.ts`

- [ ] **Step 1: Add MC routes block before app.listen**

Find the line `app.listen(PORT` near the bottom of index.ts. Insert the following block immediately before it:

```typescript
// ── Maker/Checker Routes ──────────────────────────────────────────────────

// GET /api/mc/queue — returns pending mc_actions scoped to the logged-in user
app.get('/api/mc/queue', requireAuth, async (req, res) => {
  try {
    const user = (req as any).user;
    const resourceType = req.query.resource_type as string;

    let rows;
    if (user.role === 'government_agency') {
      // Authority side: filter by authority_type of the maker
      if (!user.authority_type) return res.status(400).json({ error: 'No authority_type on account' });
      rows = await query(
        `SELECT mc.*, u.authority_type as maker_authority_type
         FROM mc_actions mc
         JOIN users u ON u.id = mc.maker_id
         WHERE mc.status = 'pending'
           AND mc.resource_type = 'vc_issuance'
           AND u.authority_type = $1
         ORDER BY mc.created_at DESC`,
        [user.authority_type]
      );
    } else if (user.role === 'corporate') {
      // Corporate side: filter by org_id
      const orgId = user.org_id || user.id;
      rows = await query(
        `SELECT mc.* FROM mc_actions mc
         WHERE mc.status = 'pending'
           AND mc.resource_type = 'vp_share'
           AND mc.org_id = $1
         ORDER BY mc.created_at DESC`,
        [orgId]
      );
    } else {
      return res.status(403).json({ error: 'MC queue not available for this role' });
    }
    res.json({ actions: rows.rows });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// POST /api/mc/submit — Maker creates a pending mc_action
app.post('/api/mc/submit', requireAuth, async (req, res) => {
  try {
    const user = (req as any).user;
    if (!user.sub_role || !['maker', 'vc_issuer_admin'].includes(user.sub_role)) {
      return res.status(403).json({ error: 'Only users with sub_role maker or vc_issuer_admin can submit actions' });
    }
    const { resource_type, resource_id, payload } = req.body;
    if (!resource_type || !resource_id) {
      return res.status(400).json({ error: 'resource_type and resource_id are required' });
    }
    if (!['vc_issuance', 'vp_share'].includes(resource_type)) {
      return res.status(400).json({ error: 'resource_type must be vc_issuance or vp_share' });
    }

    // Duplicate check: no pending action for same resource
    const existing = await query(
      `SELECT id FROM mc_actions WHERE resource_id = $1 AND resource_type = $2 AND status = 'pending'`,
      [resource_id, resource_type]
    );
    if (existing.rows.length > 0) {
      return res.status(400).json({ error: 'A pending action already exists for this resource' });
    }

    const orgId = user.org_id || (user.role === 'corporate' ? user.id : null);

    // For vp_share: create vp_requests draft row first
    let vpRequestId: string | null = null;
    if (resource_type === 'vp_share') {
      const { vc_ids, verifier_id, note } = payload || {};
      if (!vc_ids || !verifier_id) {
        return res.status(400).json({ error: 'payload.vc_ids and payload.verifier_id required for vp_share' });
      }
      const vpResult = await query(
        `INSERT INTO vp_requests (holder_org_id, verifier_id, vc_ids, status, note)
         VALUES ($1, $2, $3, 'draft', $4) RETURNING id`,
        [orgId, verifier_id, JSON.stringify(vc_ids), note || null]
      );
      vpRequestId = vpResult.rows[0].id;
    }

    const finalResourceId = resource_type === 'vp_share' ? vpRequestId : resource_id;

    const result = await query(
      `INSERT INTO mc_actions (resource_type, resource_id, org_id, maker_id, payload)
       VALUES ($1, $2, $3, $4, $5) RETURNING id`,
      [resource_type, finalResourceId, orgId, user.id, JSON.stringify(payload || {})]
    );

    res.json({ success: true, actionId: result.rows[0].id, vpRequestId });
  } catch (error: any) {
    console.error('MC submit error:', error);
    res.status(500).json({ error: error.message });
  }
});

// POST /api/mc/:id/approve — Checker approves a pending mc_action
app.post('/api/mc/:id/approve', requireAuth, async (req, res) => {
  try {
    const user = (req as any).user;
    if (!user.sub_role || !['checker', 'vc_issuer_admin'].includes(user.sub_role)) {
      return res.status(403).json({ error: 'Only users with sub_role checker or vc_issuer_admin can approve actions' });
    }

    const actionResult = await query('SELECT * FROM mc_actions WHERE id = $1', [req.params.id]);
    const action = actionResult.rows[0];
    if (!action) return res.status(404).json({ error: 'Action not found' });
    if (action.status !== 'pending') return res.status(400).json({ error: `Action is already ${action.status}` });

    // Self-approval guard
    if (action.maker_id === user.id) {
      return res.status(403).json({ error: 'A Maker cannot approve their own action' });
    }

    if (action.resource_type === 'vc_issuance') {
      // Delegate to existing approve logic: call the approve route inline
      // Get the org application
      const appResult = await query('SELECT * FROM organization_applications WHERE id = $1', [action.resource_id]);
      const org = appResult.rows[0];
      if (!org) return res.status(404).json({ error: 'Organization application not found' });

      const authorityType: string = user.authority_type;
      if (!authorityType) return res.status(400).json({ error: 'Account has no authority_type configured' });

      const authVerif = org.authority_verifications[authorityType];
      if (!authVerif) return res.status(400).json({ error: `No slot for authority_type ${authorityType}` });
      if (authVerif.status === 'approved') return res.status(400).json({ error: `${authorityType} has already approved this application` });

      const allVerified = Object.entries(authVerif)
        .filter(([k]) => k.startsWith('verified_'))
        .every(([, v]) => v === true);
      if (!allVerified) return res.status(400).json({ error: `All ${authorityType} fields must be verified before approval` });

      const issuerDidResult = await query(
        'SELECT id, did_string, private_key_encrypted FROM dids WHERE user_id = $1 AND did_type = $2',
        [user.id, 'parent']
      );
      if (!issuerDidResult.rows[0]) return res.status(500).json({ error: `${authorityType} DID not found` });
      const issuerDid = issuerDidResult.rows[0];

      let userId = org.user_id;
      let holderDid: string;
      let holderDidId: string;
      let tempPassword: string | null = null;

      await query('BEGIN');
      try {
        if (!userId) {
          tempPassword = crypto.randomBytes(8).toString('hex');
          const passwordHash = await hashPassword(tempPassword);
          const userResult = await query(
            'INSERT INTO users (email, password_hash, role, name, sub_role) VALUES ($1, $2, $3, $4, $5) RETURNING id',
            [org.email, passwordHash, 'corporate', org.company_name, 'super_admin']
          );
          userId = userResult.rows[0].id;
          await query('UPDATE users SET org_id = $1 WHERE id = $1', [userId]);
          const slug = org.company_name.toLowerCase().replace(/[^a-z0-9]/g, '-');
          const didData = await createAndStoreDID(userId, 'parent', undefined, slug);
          holderDid = didData.did;
          const holderDidResult = await query('SELECT id FROM dids WHERE did_string = $1', [holderDid]);
          holderDidId = holderDidResult.rows[0].id;
          console.log(`[APPROVAL EMAIL] To: ${org.email} | Login: ${org.email} | Temp Password: ${tempPassword}`);
        } else {
          const didResult = await query('SELECT did_string, id FROM dids WHERE user_id = $1 AND did_type = $2', [userId, 'parent']);
          if (!didResult.rows[0]) { await query('ROLLBACK'); return res.status(500).json({ error: 'Corporate DID not found' }); }
          holderDid = didResult.rows[0].did_string;
          holderDidId = didResult.rows[0].id;
        }

        const now = new Date();
        const expiresAt = new Date(now.getFullYear() + 10, now.getMonth(), now.getDate());
        const vc = buildDIAVC(authorityType, org, issuerDid, holderDid, expiresAt);
        const credType = diaCredentialType(authorityType);

        const credResult = await query(
          `INSERT INTO credentials (vc_json, holder_did_id, issuer_did_id, credential_type, issued_at, expires_at)
           VALUES ($1, $2, $3, $4, $5, $6) RETURNING id`,
          [JSON.stringify(vc), holderDidId, issuerDid.id, credType, now, expiresAt]
        );
        const vcId = credResult.rows[0].id;

        const updatedVerifResult = await query(
          `UPDATE organization_applications
           SET authority_verifications = jsonb_set(
             jsonb_set(authority_verifications, $1::text[], $2::jsonb),
             $3::text[], $4::jsonb
           ), updated_at = NOW()
           WHERE id = $5
           RETURNING authority_verifications`,
          [`{${authorityType},status}`, '"approved"', `{${authorityType},vc_id}`, JSON.stringify(vcId), action.resource_id]
        );
        const updatedVerif = updatedVerifResult.rows[0].authority_verifications;
        const allApproved = ['mca', 'dgft', 'gstn_trust_anchor', 'pan_trust_anchor']
          .every(at => updatedVerif[at]?.status === 'approved');
        const newStatus = allApproved ? 'complete' : 'partial';
        await query('UPDATE organization_applications SET application_status = $1, user_id = $2, updated_at = NOW() WHERE id = $3',
          [newStatus, userId, action.resource_id]);

        // Mark mc_action approved
        await query(`UPDATE mc_actions SET status='approved', checker_id=$1, updated_at=NOW() WHERE id=$2`, [user.id, req.params.id]);

        await query('COMMIT');

        polygonService.anchorVC(vcId, vc, issuerDid.did_string, holderDid, credType, expiresAt)
          .catch(err => console.error('[Polygon] VC anchor failed:', err.message));

        res.json({ success: true, vcId, credentialType: credType, applicationStatus: newStatus, ...(tempPassword ? { tempPassword } : {}) });
      } catch (innerError: any) {
        await query('ROLLBACK');
        throw innerError;
      }
    } else if (action.resource_type === 'vp_share') {
      // Assemble W3C VP from selected credentials
      const vpResult = await query('SELECT * FROM vp_requests WHERE id = $1', [action.resource_id]);
      const vpRequest = vpResult.rows[0];
      if (!vpRequest) return res.status(404).json({ error: 'VP request not found' });

      const vcIds: string[] = vpRequest.vc_ids;
      const credResults = await query(
        `SELECT vc_json FROM credentials WHERE id = ANY($1::uuid[])`,
        [vcIds]
      );
      const vcs = credResults.rows.map((r: any) => r.vc_json);

      // Get org's parent DID for signing
      const orgDidResult = await query(
        `SELECT did_string, private_key_encrypted FROM dids WHERE user_id = $1 AND did_type = 'parent' LIMIT 1`,
        [action.org_id || user.id]
      );
      if (!orgDidResult.rows[0]) return res.status(500).json({ error: 'Corporate DID not found' });
      const orgDid = orgDidResult.rows[0];

      const vpId = crypto.randomUUID();
      const now = new Date();
      const vp = {
        '@context': ['https://www.w3.org/2018/credentials/v1'],
        id: `urn:uuid:${vpId}`,
        type: ['VerifiablePresentation'],
        holder: orgDid.did_string,
        verifiableCredential: vcs,
        proof: {
          type: 'EcdsaSecp256k1Signature2019',
          created: now.toISOString(),
          verificationMethod: `${orgDid.did_string}#keys-1`,
          proofPurpose: 'authentication',
          jws: crypto.createHmac('sha256', orgDid.private_key_encrypted)
            .update(JSON.stringify({ id: `urn:uuid:${vpId}`, holder: orgDid.did_string }))
            .digest('hex'),
        },
      };

      await query('BEGIN');
      try {
        await query(`UPDATE vp_requests SET vp_json=$1, status='sent', updated_at=NOW() WHERE id=$2`, [JSON.stringify(vp), action.resource_id]);
        await query(`UPDATE mc_actions SET status='approved', checker_id=$1, updated_at=NOW() WHERE id=$2`, [user.id, req.params.id]);
        await query('COMMIT');
      } catch (e) {
        await query('ROLLBACK');
        throw e;
      }

      res.json({ success: true, vpId, vp });
    } else {
      res.status(400).json({ error: 'Unknown resource_type' });
    }
  } catch (error: any) {
    console.error('MC approve error:', error);
    res.status(500).json({ error: error.message });
  }
});

// POST /api/mc/:id/reject — Checker rejects a pending mc_action
app.post('/api/mc/:id/reject', requireAuth, async (req, res) => {
  try {
    const user = (req as any).user;
    if (!user.sub_role || !['checker', 'vc_issuer_admin'].includes(user.sub_role)) {
      return res.status(403).json({ error: 'Only users with sub_role checker or vc_issuer_admin can reject actions' });
    }
    const { reason } = req.body;
    if (!reason) return res.status(400).json({ error: 'rejection reason is required' });

    const actionResult = await query('SELECT * FROM mc_actions WHERE id = $1', [req.params.id]);
    const action = actionResult.rows[0];
    if (!action) return res.status(404).json({ error: 'Action not found' });
    if (action.status !== 'pending') return res.status(400).json({ error: `Action is already ${action.status}` });
    if (action.maker_id === user.id) return res.status(403).json({ error: 'A Maker cannot reject their own action' });

    await query(
      `UPDATE mc_actions SET status='rejected', checker_id=$1, rejection_reason=$2, updated_at=NOW() WHERE id=$3`,
      [user.id, reason, req.params.id]
    );

    // If vp_share, also mark vp_request as rejected
    if (action.resource_type === 'vp_share') {
      await query(`UPDATE vp_requests SET status='rejected', updated_at=NOW() WHERE id=$1`, [action.resource_id]);
    }

    res.json({ success: true });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});
```

- [ ] **Step 2: Restart backend and verify MC queue returns 401 without auth**

```bash
pkill -f "tsx src/server/index.ts" 2>/dev/null; sleep 1
DATABASE_URL=postgresql://didvc_user:didvc_pass@localhost:5433/didvc PORT=3002 npx tsx src/server/index.ts &
sleep 3
curl -s http://localhost:3002/api/mc/queue
```

Expected: `{"error":"Authentication required"}`

---

## Task 5: Backend — Portal Manager routes

**Files:**
- Modify: `src/server/index.ts`

- [ ] **Step 1: Add portal routes before app.listen**

Insert the following block immediately before `app.listen(PORT`:

```typescript
// ── Portal Manager Routes ─────────────────────────────────────────────────

app.get('/api/portal/stats', requireAuth, requireRole('portal_manager' as any), async (req, res) => {
  try {
    const stats = await query(`
      SELECT
        (SELECT COUNT(*) FROM users WHERE role = 'corporate') AS total_orgs,
        (SELECT COUNT(*) FROM dids) AS total_dids,
        (SELECT COUNT(*) FROM credentials) AS total_vcs,
        (SELECT COUNT(*) FROM mc_actions WHERE status = 'pending') AS pending_mc_actions,
        (SELECT COUNT(*) FROM organization_applications WHERE application_status = 'complete') AS approved_orgs,
        (SELECT COUNT(*) FROM organization_applications WHERE application_status = 'rejected') AS rejected_orgs
    `);
    res.json({ stats: stats.rows[0] });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

app.get('/api/portal/authorities', requireAuth, requireRole('portal_manager' as any), async (req, res) => {
  try {
    const rows = await query(
      `SELECT id, email, name, authority_type, sub_role, created_at FROM users WHERE role = 'government_agency' ORDER BY created_at DESC`
    );
    res.json({ authorities: rows.rows });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

app.post('/api/portal/authorities', requireAuth, requireRole('portal_manager' as any), async (req, res) => {
  try {
    const { email, name, authority_type, sub_role } = req.body;
    const validAuthorityTypes = ['mca', 'dgft', 'gstn_trust_anchor', 'pan_trust_anchor'];
    const validSubRoles = ['did_issuer_admin', 'vc_issuer_admin', 'maker', 'checker'];
    if (!email || !name || !authority_type || !sub_role) {
      return res.status(400).json({ error: 'email, name, authority_type, and sub_role are required' });
    }
    if (!validAuthorityTypes.includes(authority_type)) {
      return res.status(400).json({ error: `Invalid authority_type. Must be one of: ${validAuthorityTypes.join(', ')}` });
    }
    if (!validSubRoles.includes(sub_role)) {
      return res.status(400).json({ error: `Invalid sub_role. Must be one of: ${validSubRoles.join(', ')}` });
    }
    const existing = await query('SELECT id FROM users WHERE email = $1', [email]);
    if (existing.rows.length > 0) return res.status(400).json({ error: 'Email already exists' });

    const tempPassword = crypto.randomBytes(8).toString('hex');
    const passwordHash = await hashPassword(tempPassword);
    const userResult = await query(
      `INSERT INTO users (email, password_hash, role, name, authority_type, sub_role)
       VALUES ($1, $2, 'government_agency', $3, $4, $5) RETURNING id`,
      [email, passwordHash, name, authority_type, sub_role]
    );
    const userId = userResult.rows[0].id;

    // Create DID for the authority user
    const slug = name.toLowerCase().replace(/[^a-z0-9]/g, '-');
    const didData = await createAndStoreDID(userId, 'parent', undefined, slug);

    console.log(`[PORTAL] Authority account created: ${email} | Temp Password: ${tempPassword}`);
    res.json({ success: true, userId, did: didData.did, tempPassword });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

app.patch('/api/portal/authorities/:id', requireAuth, requireRole('portal_manager' as any), async (req, res) => {
  try {
    const { active } = req.body;
    if (typeof active !== 'boolean') return res.status(400).json({ error: 'active (boolean) is required' });
    // We use a simple approach: clear sessions to deactivate, or just track via a flag
    // For demo: we delete all sessions on deactivate (effectively logs them out)
    if (!active) {
      await query('DELETE FROM sessions WHERE user_id = $1', [req.params.id]);
    }
    // Store active state in a simple JSONB metadata (we'll use the existing name field as a marker for simplicity)
    // Instead: add is_active column gracefully
    await query(`
      UPDATE users SET name = CASE
        WHEN $1 = true THEN regexp_replace(name, ' \[INACTIVE\]', '')
        ELSE name || ' [INACTIVE]'
      END WHERE id = $2
    `, [active, req.params.id]);
    res.json({ success: true, active });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

app.get('/api/portal/dids', requireAuth, requireRole('portal_manager' as any), async (req, res) => {
  try {
    const page = parseInt(req.query.page as string) || 1;
    const limit = 20;
    const offset = (page - 1) * limit;
    const rows = await query(
      `SELECT d.id, d.did_string, d.did_type, d.created_at, u.name as owner_name, u.role as owner_role
       FROM dids d JOIN users u ON u.id = d.user_id
       ORDER BY d.created_at DESC LIMIT $1 OFFSET $2`,
      [limit, offset]
    );
    const total = await query('SELECT COUNT(*) FROM dids');
    res.json({ dids: rows.rows, total: parseInt(total.rows[0].count), page, limit });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

app.get('/api/portal/organizations', requireAuth, requireRole('portal_manager' as any), async (req, res) => {
  try {
    const status = req.query.status as string;
    const where = status ? `WHERE application_status = $1` : '';
    const params = status ? [status] : [];
    const rows = await query(
      `SELECT id, org_name, company_name, cin, application_status, authority_verifications, created_at, updated_at
       FROM organization_applications ${where} ORDER BY created_at DESC`,
      params
    );
    res.json({ organizations: rows.rows });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// ── Corporate Team Routes ─────────────────────────────────────────────────

app.get('/api/corporate/team', requireAuth, requireRole('corporate'), async (req, res) => {
  try {
    const user = (req as any).user;
    if (!['super_admin', 'admin'].includes(user.sub_role)) {
      return res.status(403).json({ error: 'Only super_admin or admin can view team' });
    }
    const orgId = user.org_id || user.id;
    const rows = await query(
      `SELECT id, email, name, sub_role, created_at FROM users WHERE org_id = $1 ORDER BY created_at DESC`,
      [orgId]
    );
    res.json({ team: rows.rows });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

app.post('/api/corporate/team/invite', requireAuth, requireRole('corporate'), async (req, res) => {
  try {
    const user = (req as any).user;
    if (user.sub_role !== 'super_admin') {
      return res.status(403).json({ error: 'Only super_admin can invite team members' });
    }
    const { email, name, sub_role } = req.body;
    const validSubRoles = ['admin', 'operator', 'maker', 'checker', 'member'];
    if (!email || !name || !sub_role) return res.status(400).json({ error: 'email, name, and sub_role are required' });
    if (!validSubRoles.includes(sub_role)) {
      return res.status(400).json({ error: `Invalid sub_role. Must be one of: ${validSubRoles.join(', ')}` });
    }
    const existing = await query('SELECT id FROM users WHERE email = $1', [email]);
    if (existing.rows.length > 0) return res.status(400).json({ error: 'Email already exists' });

    const orgId = user.org_id || user.id;
    const tempPassword = crypto.randomBytes(8).toString('hex');
    const passwordHash = await hashPassword(tempPassword);
    const result = await query(
      `INSERT INTO users (email, password_hash, role, name, sub_role, org_id)
       VALUES ($1, $2, 'corporate', $3, $4, $5) RETURNING id`,
      [email, passwordHash, name, sub_role, orgId]
    );
    console.log(`[TEAM INVITE] To: ${email} | Temp Password: ${tempPassword}`);
    res.json({ success: true, userId: result.rows[0].id, tempPassword });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});
```

- [ ] **Step 2: Verify portal stats returns 403 without portal_manager role**

```bash
curl -s http://localhost:3002/api/portal/stats
```

Expected: `{"error":"Authentication required"}`

---

## Task 6: Frontend — AuthContext and App.tsx updates

**Files:**
- Modify: `src/frontend/contexts/AuthContext.tsx`
- Modify: `src/frontend/App.tsx`

- [ ] **Step 1: Update AuthContext.tsx — add sub_role, org_id, portal_manager**

Replace the entire file content of `src/frontend/contexts/AuthContext.tsx` with:

```typescript
import React, { createContext, useContext, useState, useEffect } from 'react';

const API_BASE = '/api';

export type UserRole = 'corporate' | 'government_agency' | 'verifier' | 'portal_manager';

interface User {
  id: string;
  email: string;
  role: UserRole;
  did?: string;
  name?: string;
  authority_type?: string;
  sub_role?: string | null;
  org_id?: string | null;
}

interface AuthContextType {
  user: User | null;
  token: string | null;
  login: (email: string, password: string) => Promise<{ mfaRequired: boolean; tempToken?: string; mfaCode?: string }>;
  verifyMFA: (tempToken: string, code: string) => Promise<void>;
  register: (email: string, password: string, role: UserRole, name?: string, authority_type?: string) => Promise<void>;
  logout: () => void;
  loading: boolean;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export const AuthProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [user, setUser] = useState<User | null>(null);
  const [token, setToken] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const storedToken = localStorage.getItem('auth_token');
    if (storedToken) {
      fetch(`${API_BASE}/auth/me`, { headers: { Authorization: `Bearer ${storedToken}` } })
        .then(r => r.json())
        .then(data => {
          if (data.success) { setToken(storedToken); setUser(data.user); }
          else localStorage.removeItem('auth_token');
        })
        .catch(() => localStorage.removeItem('auth_token'))
        .finally(() => setLoading(false));
    } else { setLoading(false); }
  }, []);

  const login = async (email: string, password: string) => {
    const res = await fetch(`${API_BASE}/auth/login`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Login failed');
    return { mfaRequired: data.mfaRequired, tempToken: data.tempToken, mfaCode: data.mfaCode };
  };

  const verifyMFA = async (tempToken: string, code: string) => {
    const res = await fetch(`${API_BASE}/auth/verify-mfa`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ tempToken, code }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'MFA verification failed');
    setToken(data.token);
    setUser(data.user);
    localStorage.setItem('auth_token', data.token);
    redirectByRole(data.user.role);
  };

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

  const logout = () => {
    if (token) fetch(`${API_BASE}/auth/logout`, { method: 'POST', headers: { Authorization: `Bearer ${token}` } }).catch(() => {});
    setToken(null); setUser(null);
    localStorage.removeItem('auth_token');
    window.location.href = '/';
  };

  function redirectByRole(role: UserRole) {
    setTimeout(() => {
      if (role === 'portal_manager') window.location.href = '/portal/dashboard';
      else if (role === 'corporate') window.location.href = '/corporate/dashboard';
      else if (role === 'government_agency') window.location.href = '/authority/dashboard';
      else window.location.href = '/verifier/dashboard';
    }, 100);
  }

  return (
    <AuthContext.Provider value={{ user, token, login, verifyMFA, register, logout, loading }}>
      {children}
    </AuthContext.Provider>
  );
};

export const useAuth = () => {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within AuthProvider');
  return ctx;
};
```

- [ ] **Step 2: Update App.tsx — add portal route, update nav role badge**

Replace the entire content of `src/frontend/App.tsx` with:

```typescript
import React, { useState } from 'react';
import { BrowserRouter as Router, Routes, Route, Link, Navigate } from 'react-router-dom';
import { AuthProvider, useAuth } from './contexts/AuthContext';
import LoginPage from './pages/LoginPage';
import RegisterPage from './pages/RegisterPage';
import CorporateDashboard from './pages/CorporateDashboard';
import GovtIssuerDashboard from './pages/GovtIssuerDashboard';
import VerifierDashboard from './pages/VerifierDashboard';
import VPComposerPage from './pages/VPComposerPage';
import Dashboard from './pages/Dashboard';
import ShareViewPage from './pages/ShareViewPage';
import OrganizationApplyPage from './pages/OrganizationApplyPage';
import AuthorityLoginPage from './pages/AuthorityLoginPage';
import AuthorityDashboard from './pages/AuthorityDashboard';
import PortalManagerDashboard from './pages/PortalManagerDashboard';
import ProtectedRoute from './components/ProtectedRoute';
import './App.css';

const ROLE_LABELS: Record<string, string> = {
  corporate: 'Corporate',
  government_agency: 'Authority',
  verifier: 'Verifier',
  portal_manager: 'Portal Manager',
};

function Navbar() {
  const { user, logout } = useAuth();

  return (
    <nav className="navbar">
      <div className="nav-container">
        <Link to="/" className="nav-logo">DID VC Platform</Link>
        <div className="nav-links">
          {user ? (
            <>
              {user.role === 'corporate' && <>
                <Link to="/corporate/dashboard" className="nav-link">Dashboard</Link>
                <Link to="/corporate/compose-vp" className="nav-link">Compose VP</Link>
              </>}
              {user.role === 'government_agency' && <Link to="/authority/dashboard" className="nav-link">Issuer Panel</Link>}
              {user.role === 'verifier' && <Link to="/verifier/dashboard" className="nav-link">Verifier Portal</Link>}
              {user.role === 'portal_manager' && <Link to="/portal/dashboard" className="nav-link">Portal Admin</Link>}
            </>
          ) : (
            <>
              <Link to="/" className="nav-link">Home</Link>
              <Link to="/login" className="nav-link">Login</Link>
              <Link to="/register" className="nav-link">Register</Link>
            </>
          )}
        </div>
        {user && (
          <div style={{ display: 'flex', alignItems: 'center', gap: '1rem' }}>
            <span style={{ color: '#667eea', fontWeight: 500, fontSize: '0.9rem' }}>
              {user.name || user.email}
              <span style={{ marginLeft: '0.5rem', fontSize: '0.75rem', background: '#e2e8f0', padding: '2px 8px', borderRadius: '12px', color: '#555' }}>
                {ROLE_LABELS[user.role] || user.role}
                {user.sub_role ? ` · ${user.sub_role.replace(/_/g, ' ')}` : ''}
              </span>
            </span>
            <button className="btn btn-secondary btn-sm" onClick={logout}>Logout</button>
          </div>
        )}
      </div>
    </nav>
  );
}

function ProtectedRouteWrapper({ role, children }: { role: string; children: React.ReactNode }) {
  const { user, loading } = useAuth();
  if (loading) return <div style={{ textAlign: 'center', padding: '3rem' }}>Loading...</div>;
  if (!user) return <Navigate to="/login" replace />;
  if (user.role !== role) return <Navigate to="/" replace />;
  return <>{children}</>;
}

function AppRoutes() {
  const { user } = useAuth();
  return (
    <Routes>
      <Route path="/" element={<Dashboard />} />
      <Route path="/login" element={<LoginPage />} />
      <Route path="/register" element={<RegisterPage />} />
      <Route path="/corporate/dashboard" element={<ProtectedRouteWrapper role="corporate"><CorporateDashboard /></ProtectedRouteWrapper>} />
      <Route path="/corporate/compose-vp" element={<ProtectedRouteWrapper role="corporate"><VPComposerPage /></ProtectedRouteWrapper>} />
      <Route path="/issuer/dashboard" element={<ProtectedRouteWrapper role="government_agency"><GovtIssuerDashboard /></ProtectedRouteWrapper>} />
      <Route path="/verifier/dashboard" element={<ProtectedRouteWrapper role="verifier"><VerifierDashboard /></ProtectedRouteWrapper>} />
      <Route path="/signup" element={<OrganizationApplyPage />} />
      <Route path="/authority-login" element={<AuthorityLoginPage />} />
      <Route path="/authority/dashboard" element={<ProtectedRouteWrapper role="government_agency"><AuthorityDashboard /></ProtectedRouteWrapper>} />
      <Route path="/portal/dashboard" element={<ProtectedRouteWrapper role="portal_manager"><PortalManagerDashboard /></ProtectedRouteWrapper>} />
      <Route path="/share/:token" element={<ShareViewPage />} />
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}

function App() {
  return (
    <AuthProvider>
      <Router>
        <div className="app">
          <Navbar />
          <main className="main-content"><AppRoutes /></main>
        </div>
      </Router>
    </AuthProvider>
  );
}

export default App;
```

- [ ] **Step 3: Update RegisterPage.tsx — remove government_agency role option**

In `src/frontend/pages/RegisterPage.tsx`, find the `roles` array:

```typescript
  const roles = [
    { value: 'government_agency', label: 'Government Agency', desc: 'Issue trusted credentials to corporates (MCA, DGFT, GSTN, PAN)' },
    { value: 'verifier', label: 'Verifier / Relying Party', desc: 'Verify presentations from corporates' },
  ];
```

Replace with:

```typescript
  const roles = [
    { value: 'verifier', label: 'Verifier / Relying Party', desc: 'Verify presentations from corporates' },
  ];
```

Also update the form state default since `government_agency` is no longer an option. Find:
```typescript
  const [form, setForm] = useState({ email: '', password: '', name: '', role: 'government_agency' as UserRole, authority_type: '' });
```

Replace with:
```typescript
  const [form, setForm] = useState({ email: '', password: '', name: '', role: 'verifier' as UserRole, authority_type: '' });
```

---

## Task 7: Create PortalManagerDashboard.tsx

**Files:**
- Create: `src/frontend/pages/PortalManagerDashboard.tsx`

- [ ] **Step 1: Create the file**

```typescript
import React, { useState, useEffect } from 'react';
import { useAuth } from '../contexts/AuthContext';

type Tab = 'overview' | 'authorities' | 'dids' | 'organizations';

type Authority = {
  id: string; email: string; name: string;
  authority_type: string; sub_role: string; created_at: string;
};

type DIDRow = {
  id: string; did_string: string; did_type: string;
  owner_name: string; owner_role: string; created_at: string;
};

type OrgRow = {
  id: string; org_name: string; company_name: string; cin: string;
  application_status: string; authority_verifications: Record<string, any>; created_at: string;
};

type Stats = {
  total_orgs: string; total_dids: string; total_vcs: string;
  pending_mc_actions: string; approved_orgs: string; rejected_orgs: string;
};

const AUTHORITY_TYPES = ['mca', 'dgft', 'gstn_trust_anchor', 'pan_trust_anchor'];
const AUTHORITY_SUB_ROLES = ['did_issuer_admin', 'vc_issuer_admin', 'maker', 'checker'];
const AUTHORITY_LABELS: Record<string, string> = {
  mca: 'MCA', dgft: 'DGFT', gstn_trust_anchor: 'GSTN', pan_trust_anchor: 'Income Tax',
};
const STATUS_COLORS: Record<string, string> = {
  pending: '#ffc107', partial: '#17a2b8', complete: '#28a745', rejected: '#dc3545',
};

export default function PortalManagerDashboard() {
  const { token, user, logout } = useAuth();
  const [tab, setTab] = useState<Tab>('overview');
  const [stats, setStats] = useState<Stats | null>(null);
  const [authorities, setAuthorities] = useState<Authority[]>([]);
  const [dids, setDids] = useState<DIDRow[]>([]);
  const [didPage, setDidPage] = useState(1);
  const [didTotal, setDidTotal] = useState(0);
  const [orgs, setOrgs] = useState<OrgRow[]>([]);
  const [orgStatusFilter, setOrgStatusFilter] = useState('');
  const [showCreateForm, setShowCreateForm] = useState(false);
  const [createForm, setCreateForm] = useState({ email: '', name: '', authority_type: 'mca', sub_role: 'maker' });
  const [createdCred, setCreatedCred] = useState<{ email: string; tempPassword: string } | null>(null);
  const [msg, setMsg] = useState('');
  const [loading, setLoading] = useState(false);

  const authHeader = () => ({ Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' });

  useEffect(() => { loadTab(); }, [tab, didPage, orgStatusFilter]);

  async function loadTab() {
    setLoading(true);
    try {
      if (tab === 'overview') {
        const r = await fetch('/api/portal/stats', { headers: authHeader() });
        const d = await r.json();
        setStats(d.stats);
      } else if (tab === 'authorities') {
        const r = await fetch('/api/portal/authorities', { headers: authHeader() });
        const d = await r.json();
        setAuthorities(d.authorities || []);
      } else if (tab === 'dids') {
        const r = await fetch(`/api/portal/dids?page=${didPage}`, { headers: authHeader() });
        const d = await r.json();
        setDids(d.dids || []);
        setDidTotal(d.total || 0);
      } else if (tab === 'organizations') {
        const qs = orgStatusFilter ? `?status=${orgStatusFilter}` : '';
        const r = await fetch(`/api/portal/organizations${qs}`, { headers: authHeader() });
        const d = await r.json();
        setOrgs(d.organizations || []);
      }
    } catch (e: any) { setMsg(e.message); }
    finally { setLoading(false); }
  }

  async function handleDeactivate(id: string, active: boolean) {
    const r = await fetch(`/api/portal/authorities/${id}`, {
      method: 'PATCH', headers: authHeader(),
      body: JSON.stringify({ active }),
    });
    if (r.ok) loadTab();
    else { const d = await r.json(); setMsg(d.error); }
  }

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    try {
      const r = await fetch('/api/portal/authorities', {
        method: 'POST', headers: authHeader(),
        body: JSON.stringify(createForm),
      });
      const d = await r.json();
      if (!r.ok) throw new Error(d.error);
      setCreatedCred({ email: createForm.email, tempPassword: d.tempPassword });
      setShowCreateForm(false);
      setCreateForm({ email: '', name: '', authority_type: 'mca', sub_role: 'maker' });
      loadTab();
    } catch (e: any) { setMsg(e.message); }
    finally { setLoading(false); }
  }

  const tabStyle = (t: Tab) => ({
    padding: '0.5rem 1.25rem', border: 'none', cursor: 'pointer', borderRadius: 6,
    background: tab === t ? '#667eea' : '#f0f0f0',
    color: tab === t ? '#fff' : '#333', fontWeight: 600 as const, fontSize: '0.875rem',
  });

  return (
    <div style={{ display: 'flex', minHeight: '100vh', background: '#f5f5f5' }}>
      {/* Sidebar */}
      <div style={{ width: 220, background: '#fff', borderRight: '1px solid #e2e8f0', padding: '1.5rem 0', flexShrink: 0 }}>
        <div style={{ padding: '0 1.5rem 1.5rem', borderBottom: '1px solid #e2e8f0' }}>
          <div style={{ background: '#667eea', color: '#fff', display: 'inline-block', padding: '0.25rem 0.75rem', borderRadius: 20, fontSize: '0.7rem', fontWeight: 700, marginBottom: '0.5rem' }}>PORTAL MANAGER</div>
          <div style={{ fontWeight: 700, color: '#333', fontSize: '0.9rem' }}>Platform Admin</div>
        </div>
        {(['overview', 'authorities', 'dids', 'organizations'] as Tab[]).map(t => (
          <button key={t} onClick={() => setTab(t)}
            style={{ display: 'block', width: '100%', textAlign: 'left', padding: '0.75rem 1.5rem', border: 'none',
              background: tab === t ? '#f0f4ff' : 'transparent', color: tab === t ? '#667eea' : '#555',
              fontWeight: tab === t ? 600 : 400, cursor: 'pointer', textTransform: 'capitalize' }}>
            {t === 'dids' ? 'DID Registry' : t === 'authorities' ? 'Authority Accounts' : t.charAt(0).toUpperCase() + t.slice(1)}
          </button>
        ))}
        <button onClick={() => { logout(); }}
          style={{ display: 'block', width: '100%', textAlign: 'left', padding: '0.75rem 1.5rem', border: 'none', background: 'transparent', color: '#dc3545', cursor: 'pointer', marginTop: '1rem' }}>
          Logout
        </button>
      </div>

      {/* Main */}
      <div style={{ flex: 1, padding: '2rem', overflow: 'auto' }}>
        {msg && <div className="alert alert-error" style={{ marginBottom: '1rem' }}>{msg} <button onClick={() => setMsg('')} style={{ marginLeft: '1rem', background: 'none', border: 'none', cursor: 'pointer' }}>✕</button></div>}

        {/* Created credential modal */}
        {createdCred && (
          <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000 }}>
            <div className="card" style={{ width: 420, padding: '2rem', textAlign: 'center' }}>
              <div style={{ fontSize: '2.5rem', marginBottom: '0.75rem' }}>🔑</div>
              <h3 style={{ color: '#28a745', marginBottom: '1rem' }}>Account Created!</h3>
              <div style={{ background: '#f8f9fa', borderRadius: 8, padding: '1rem', textAlign: 'left', marginBottom: '1.5rem' }}>
                <div style={{ marginBottom: '0.5rem' }}><strong>Email:</strong> {createdCred.email}</div>
                <div><strong>Temp Password:</strong> <code style={{ background: '#e2e8f0', padding: '0.2rem 0.5rem', borderRadius: 4 }}>{createdCred.tempPassword}</code></div>
              </div>
              <p style={{ color: '#666', fontSize: '0.85rem', marginBottom: '1.5rem' }}>Share these credentials securely with the authority officer. They should change their password on first login.</p>
              <button className="btn btn-primary" onClick={() => setCreatedCred(null)}>Done</button>
            </div>
          </div>
        )}

        {/* Overview Tab */}
        {tab === 'overview' && (
          <>
            <h2 style={{ marginBottom: '1.5rem' }}>Platform Overview</h2>
            {stats && (
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '1rem', marginBottom: '2rem' }}>
                {[
                  { label: 'Total Organizations', value: stats.total_orgs, color: '#667eea' },
                  { label: 'Active DIDs', value: stats.total_dids, color: '#1a73e8' },
                  { label: 'VCs Issued', value: stats.total_vcs, color: '#28a745' },
                  { label: 'Pending MC Actions', value: stats.pending_mc_actions, color: '#ffc107' },
                  { label: 'Approved Orgs', value: stats.approved_orgs, color: '#28a745' },
                  { label: 'Rejected Orgs', value: stats.rejected_orgs, color: '#dc3545' },
                ].map(s => (
                  <div key={s.label} className="card" style={{ padding: '1.25rem', textAlign: 'center' }}>
                    <div style={{ fontSize: '2rem', fontWeight: 700, color: s.color }}>{s.value || '0'}</div>
                    <div style={{ color: '#666', fontSize: '0.875rem', marginTop: '0.25rem' }}>{s.label}</div>
                  </div>
                ))}
              </div>
            )}
            <div className="card" style={{ padding: '1.25rem' }}>
              <h4 style={{ marginBottom: '0.75rem' }}>Portal Manager Profile</h4>
              <p><strong>Name:</strong> {user?.name}</p>
              <p><strong>Email:</strong> {user?.email}</p>
              <p><strong>Role:</strong> Portal Manager</p>
              <p><strong>Status:</strong> <span style={{ color: '#28a745', fontWeight: 600 }}>Active</span></p>
            </div>
          </>
        )}

        {/* Authority Accounts Tab */}
        {tab === 'authorities' && (
          <>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1.5rem' }}>
              <h2 style={{ margin: 0 }}>Authority Accounts</h2>
              <button className="btn btn-primary" onClick={() => setShowCreateForm(true)}>+ Create Account</button>
            </div>

            {showCreateForm && (
              <div className="card" style={{ padding: '1.5rem', marginBottom: '1.5rem' }}>
                <h4 style={{ marginBottom: '1rem' }}>Create Authority Account</h4>
                <form onSubmit={handleCreate}>
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem' }}>
                    <div className="form-group">
                      <label>Email *</label>
                      <input className="form-input" type="email" value={createForm.email}
                        onChange={e => setCreateForm(f => ({ ...f, email: e.target.value }))} required />
                    </div>
                    <div className="form-group">
                      <label>Full Name *</label>
                      <input className="form-input" value={createForm.name}
                        onChange={e => setCreateForm(f => ({ ...f, name: e.target.value }))} required />
                    </div>
                    <div className="form-group">
                      <label>Authority Type *</label>
                      <select className="form-input" value={createForm.authority_type}
                        onChange={e => setCreateForm(f => ({ ...f, authority_type: e.target.value }))}>
                        {AUTHORITY_TYPES.map(t => <option key={t} value={t}>{AUTHORITY_LABELS[t]} ({t})</option>)}
                      </select>
                    </div>
                    <div className="form-group">
                      <label>Sub Role *</label>
                      <select className="form-input" value={createForm.sub_role}
                        onChange={e => setCreateForm(f => ({ ...f, sub_role: e.target.value }))}>
                        {AUTHORITY_SUB_ROLES.map(r => <option key={r} value={r}>{r.replace(/_/g, ' ')}</option>)}
                      </select>
                    </div>
                  </div>
                  <div style={{ display: 'flex', gap: '0.75rem', marginTop: '1rem' }}>
                    <button className="btn btn-primary" type="submit" disabled={loading}>{loading ? 'Creating...' : 'Create Account'}</button>
                    <button className="btn btn-secondary" type="button" onClick={() => setShowCreateForm(false)}>Cancel</button>
                  </div>
                </form>
              </div>
            )}

            <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                <thead>
                  <tr style={{ background: '#f8f9fa' }}>
                    {['Name', 'Email', 'Authority', 'Sub Role', 'Created', 'Actions'].map(h => (
                      <th key={h} style={{ padding: '0.75rem 1rem', textAlign: 'left', fontWeight: 600, fontSize: '0.875rem', color: '#555', borderBottom: '1px solid #e2e8f0' }}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {authorities.length === 0 && (
                    <tr><td colSpan={6} style={{ padding: '2rem', textAlign: 'center', color: '#888' }}>No authority accounts yet. Create the first one above.</td></tr>
                  )}
                  {authorities.map(a => (
                    <tr key={a.id} style={{ borderBottom: '1px solid #f0f0f0' }}>
                      <td style={{ padding: '0.75rem 1rem', fontWeight: 600 }}>{a.name}</td>
                      <td style={{ padding: '0.75rem 1rem', fontSize: '0.875rem', color: '#555' }}>{a.email}</td>
                      <td style={{ padding: '0.75rem 1rem' }}>
                        <span style={{ background: '#e2e8f0', padding: '0.2rem 0.6rem', borderRadius: 12, fontSize: '0.75rem', fontWeight: 600 }}>
                          {AUTHORITY_LABELS[a.authority_type] || a.authority_type}
                        </span>
                      </td>
                      <td style={{ padding: '0.75rem 1rem', fontSize: '0.875rem' }}>{a.sub_role?.replace(/_/g, ' ') || '—'}</td>
                      <td style={{ padding: '0.75rem 1rem', fontSize: '0.8rem', color: '#888' }}>{new Date(a.created_at).toLocaleDateString()}</td>
                      <td style={{ padding: '0.75rem 1rem' }}>
                        {a.name.includes('[INACTIVE]') ? (
                          <button className="btn btn-primary" style={{ padding: '0.25rem 0.75rem', fontSize: '0.8rem' }}
                            onClick={() => handleDeactivate(a.id, true)}>Activate</button>
                        ) : (
                          <button className="btn btn-secondary" style={{ padding: '0.25rem 0.75rem', fontSize: '0.8rem', color: '#dc3545' }}
                            onClick={() => handleDeactivate(a.id, false)}>Deactivate</button>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        )}

        {/* DID Registry Tab */}
        {tab === 'dids' && (
          <>
            <h2 style={{ marginBottom: '1.5rem' }}>DID Registry <span style={{ fontSize: '0.875rem', color: '#888', fontWeight: 400 }}>({didTotal} total)</span></h2>
            <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                <thead>
                  <tr style={{ background: '#f8f9fa' }}>
                    {['DID String', 'Type', 'Owner', 'Role', 'Created'].map(h => (
                      <th key={h} style={{ padding: '0.75rem 1rem', textAlign: 'left', fontWeight: 600, fontSize: '0.875rem', color: '#555', borderBottom: '1px solid #e2e8f0' }}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {dids.map(d => (
                    <tr key={d.id} style={{ borderBottom: '1px solid #f0f0f0' }}>
                      <td style={{ padding: '0.75rem 1rem', fontFamily: 'monospace', fontSize: '0.78rem', color: '#333', maxWidth: 300, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}
                        title={d.did_string}>{d.did_string}</td>
                      <td style={{ padding: '0.75rem 1rem' }}>
                        <span style={{ background: d.did_type === 'parent' ? '#e2e8f0' : '#f0f4ff', padding: '0.2rem 0.6rem', borderRadius: 12, fontSize: '0.75rem', fontWeight: 600 }}>
                          {d.did_type}
                        </span>
                      </td>
                      <td style={{ padding: '0.75rem 1rem', fontSize: '0.875rem' }}>{d.owner_name}</td>
                      <td style={{ padding: '0.75rem 1rem', fontSize: '0.8rem', color: '#555' }}>{d.owner_role}</td>
                      <td style={{ padding: '0.75rem 1rem', fontSize: '0.8rem', color: '#888' }}>{new Date(d.created_at).toLocaleDateString()}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div style={{ display: 'flex', gap: '0.5rem', marginTop: '1rem', justifyContent: 'center' }}>
              <button className="btn btn-secondary" disabled={didPage === 1} onClick={() => setDidPage(p => p - 1)} style={{ padding: '0.3rem 0.75rem' }}>← Prev</button>
              <span style={{ padding: '0.3rem 0.75rem', color: '#666' }}>Page {didPage} of {Math.ceil(didTotal / 20) || 1}</span>
              <button className="btn btn-secondary" disabled={didPage * 20 >= didTotal} onClick={() => setDidPage(p => p + 1)} style={{ padding: '0.3rem 0.75rem' }}>Next →</button>
            </div>
          </>
        )}

        {/* Organizations Tab */}
        {tab === 'organizations' && (
          <>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1.5rem' }}>
              <h2 style={{ margin: 0 }}>Organizations</h2>
              <select className="form-input" value={orgStatusFilter} onChange={e => setOrgStatusFilter(e.target.value)} style={{ width: 180 }}>
                <option value="">All Statuses</option>
                <option value="pending">Pending</option>
                <option value="partial">Partial</option>
                <option value="complete">Complete</option>
                <option value="rejected">Rejected</option>
              </select>
            </div>
            <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                <thead>
                  <tr style={{ background: '#f8f9fa' }}>
                    {['Company Name', 'CIN', 'Status', 'Approvals', 'Applied'].map(h => (
                      <th key={h} style={{ padding: '0.75rem 1rem', textAlign: 'left', fontWeight: 600, fontSize: '0.875rem', color: '#555', borderBottom: '1px solid #e2e8f0' }}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {orgs.length === 0 && (
                    <tr><td colSpan={5} style={{ padding: '2rem', textAlign: 'center', color: '#888' }}>No organizations found.</td></tr>
                  )}
                  {orgs.map(o => {
                    const approvalCount = Object.values(o.authority_verifications || {})
                      .filter((v: any) => v.status === 'approved').length;
                    return (
                      <tr key={o.id} style={{ borderBottom: '1px solid #f0f0f0' }}>
                        <td style={{ padding: '0.75rem 1rem', fontWeight: 600 }}>{o.company_name}</td>
                        <td style={{ padding: '0.75rem 1rem', fontFamily: 'monospace', fontSize: '0.8rem' }}>{o.cin}</td>
                        <td style={{ padding: '0.75rem 1rem' }}>
                          <span style={{ background: STATUS_COLORS[o.application_status] + '22', color: STATUS_COLORS[o.application_status], padding: '0.2rem 0.6rem', borderRadius: 12, fontSize: '0.75rem', fontWeight: 600, textTransform: 'capitalize' }}>
                            {o.application_status}
                          </span>
                        </td>
                        <td style={{ padding: '0.75rem 1rem' }}>
                          <span style={{ background: approvalCount === 4 ? '#d4edda' : '#fff3cd', color: approvalCount === 4 ? '#155724' : '#856404', padding: '0.2rem 0.6rem', borderRadius: 12, fontSize: '0.75rem', fontWeight: 700 }}>
                            {approvalCount}/4
                          </span>
                        </td>
                        <td style={{ padding: '0.75rem 1rem', fontSize: '0.8rem', color: '#888' }}>{new Date(o.created_at).toLocaleDateString()}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
```

---

## Task 8: Update AuthorityDashboard — sub_role aware views

**Files:**
- Modify: `src/frontend/pages/AuthorityDashboard.tsx`

- [ ] **Step 1: Replace the Approve button with Maker submit flow**

Find the section in AuthorityDashboard.tsx where the Approve/Reject buttons are rendered inside the detail modal (search for `handleApprove`). The current flow calls `/api/authority/organizations/:id/approve` directly.

Replace the entire `handleApprove` function and associated state/UI with the Maker/Checker aware version:

After the existing `const [showApprovedModal, setShowApprovedModal] = useState(false);` line, add:
```typescript
  const subRole = (user as any)?.sub_role;
```

Replace the `toggleField` function:
```typescript
  async function toggleField(orgId: string, field: string, checked: boolean) {
    const res = await fetch(`/api/authority/organizations/${orgId}/verify-field`, {
      method: 'POST', headers: authHeader(),
      body: JSON.stringify({ field, verified: checked }),
    });
    const data = await res.json();
    if (data.field_verifications && selected) {
      setSelected({ ...selected, field_verifications: data.field_verifications } as any);
    }
    if (data.authority_verifications && selected) {
      setSelected({ ...selected, authority_verifications: data.authority_verifications });
    }
  }
```

Replace the `handleApprove` function with a Maker submit function:
```typescript
  async function handleMakerSubmit(orgId: string) {
    setLoading(true);
    try {
      const res = await fetch('/api/mc/submit', {
        method: 'POST', headers: authHeader(),
        body: JSON.stringify({ resource_type: 'vc_issuance', resource_id: orgId, payload: { org_id: orgId } }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      setMsg('Submitted for Checker approval. The action is now in the Checker queue.');
      setSelected(null);
    } catch (err: any) { setMsg(err.message); }
    finally { setLoading(false); }
  }
```

Keep the existing `handleReject` function as-is (it calls the authority reject route which is still valid for authority-scoped rejections).

- [ ] **Step 2: Add Checker queue view to the dashboard**

After the existing `const [view, setView] = useState<'dashboard' | 'pending'>('dashboard');` line, update the type:
```typescript
  const [view, setView] = useState<'dashboard' | 'pending' | 'checker-queue'>('dashboard');
  const [mcQueue, setMcQueue] = useState<any[]>([]);
```

Add a `loadMCQueue` function after `loadOrgs`:
```typescript
  async function loadMCQueue() {
    try {
      const res = await fetch('/api/mc/queue?resource_type=vc_issuance', { headers: authHeader() });
      const data = await res.json();
      setMcQueue(data.actions || []);
    } catch { setMsg('Failed to load checker queue'); }
  }
```

Update the `useEffect` to also load the queue when needed:
```typescript
  useEffect(() => {
    loadOrgs();
    if (subRole === 'checker' || subRole === 'vc_issuer_admin') loadMCQueue();
  }, [view]);
```

- [ ] **Step 3: Add Checker Queue tab to sidebar and render it**

In the sidebar nav buttons array, add after the `'pending'` entry:
```typescript
  ...(subRole === 'checker' || subRole === 'vc_issuer_admin' ? [{ key: 'checker-queue', label: 'Checker Queue' }] : []),
```

After the `{view === 'pending' && (...)}` block, add:
```typescript
        {view === 'checker-queue' && (
          <div>
            <h2 style={{ marginBottom: '1rem' }}>Checker Queue</h2>
            {mcQueue.length === 0 ? (
              <div className="card" style={{ padding: '2rem', textAlign: 'center', color: '#888' }}>No pending actions in the queue.</div>
            ) : (
              <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
                <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                  <thead>
                    <tr style={{ background: '#f8f9fa' }}>
                      {['Resource ID', 'Submitted By', 'Created', 'Actions'].map(h => (
                        <th key={h} style={{ padding: '0.75rem 1rem', textAlign: 'left', fontWeight: 600, fontSize: '0.875rem', color: '#555', borderBottom: '1px solid #e2e8f0' }}>{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {mcQueue.map((action: any) => (
                      <tr key={action.id} style={{ borderBottom: '1px solid #f0f0f0' }}>
                        <td style={{ padding: '0.75rem 1rem', fontFamily: 'monospace', fontSize: '0.78rem' }}>{action.resource_id}</td>
                        <td style={{ padding: '0.75rem 1rem', fontSize: '0.875rem' }}>{action.maker_id}</td>
                        <td style={{ padding: '0.75rem 1rem', fontSize: '0.8rem', color: '#888' }}>{new Date(action.created_at).toLocaleDateString()}</td>
                        <td style={{ padding: '0.75rem 1rem', display: 'flex', gap: '0.5rem' }}>
                          <button className="btn btn-primary" style={{ padding: '0.25rem 0.75rem', fontSize: '0.8rem' }}
                            onClick={async () => {
                              setLoading(true);
                              try {
                                const r = await fetch(`/api/mc/${action.id}/approve`, { method: 'POST', headers: authHeader(), body: '{}' });
                                const d = await r.json();
                                if (!r.ok) throw new Error(d.error);
                                setShowApprovedModal(true);
                                loadMCQueue();
                              } catch (e: any) { setMsg(e.message); }
                              finally { setLoading(false); }
                            }}>
                            Approve
                          </button>
                          <button className="btn btn-secondary" style={{ padding: '0.25rem 0.75rem', fontSize: '0.8rem', color: '#dc3545' }}
                            onClick={async () => {
                              const reason = prompt('Rejection reason:');
                              if (!reason) return;
                              const r = await fetch(`/api/mc/${action.id}/reject`, { method: 'POST', headers: authHeader(), body: JSON.stringify({ reason }) });
                              if (r.ok) loadMCQueue();
                              else { const d = await r.json(); setMsg(d.error); }
                            }}>
                            Reject
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        )}
```

- [ ] **Step 4: Update the modal action buttons to be sub_role aware**

In the modal's action buttons section, replace the current Approve button with:
```typescript
            <div style={{ display: 'flex', gap: '0.75rem', flexWrap: 'wrap' }}>
              {(subRole === 'maker' || subRole === 'vc_issuer_admin') && (
                <button className="btn btn-primary"
                  disabled={!allVerified(selected.authority_verifications?.[authorityType] || {}) || loading}
                  onClick={() => handleMakerSubmit(selected.id)}
                  style={{ opacity: allVerified(selected.authority_verifications?.[authorityType] || {}) ? 1 : 0.5 }}>
                  {loading ? 'Submitting...' : subRole === 'vc_issuer_admin' ? 'Approve (Admin Override)' : 'Submit for Checker Approval'}
                </button>
              )}
              {(subRole === 'maker' || subRole === 'vc_issuer_admin' || !subRole) && (
                <button className="btn btn-danger" disabled={loading} onClick={() => setShowRejectInput(true)}>Reject</button>
              )}
            </div>
```

---

## Task 9: Update CorporateDashboard — sub_role aware views + VP draft flow

**Files:**
- Modify: `src/frontend/pages/CorporateDashboard.tsx`

- [ ] **Step 1: Add Team tab to Tab type and tab buttons**

Find:
```typescript
type Tab = 'credentials' | 'employees' | 'requests' | 'issue' | 'proof-requests' | 'corp-wallet';
```

Replace with:
```typescript
type Tab = 'credentials' | 'employees' | 'requests' | 'issue' | 'proof-requests' | 'corp-wallet' | 'team' | 'vp-queue';
```

- [ ] **Step 2: Add team and vp-queue state**

After the existing `const [walletVCs, setWalletVCs]` line, add:
```typescript
  const [team, setTeam] = useState<any[]>([]);
  const [vpQueue, setVpQueue] = useState<any[]>([]);
  const [showInviteForm, setShowInviteForm] = useState(false);
  const [inviteForm, setInviteForm] = useState({ email: '', name: '', sub_role: 'operator' });
  const [inviteMsg, setInviteMsg] = useState('');
  const subRole = (user as any)?.sub_role;
```

- [ ] **Step 3: Add loadAll branches for team and vp-queue**

Inside `loadAll()`, after the `corp-wallet` branch, add:
```typescript
      } else if (tab === 'team') {
        const r = await fetch('/api/corporate/team', { headers: { Authorization: `Bearer ${token}` } });
        const d = await r.json();
        setTeam(d.team || []);
      } else if (tab === 'vp-queue') {
        const r = await fetch('/api/mc/queue?resource_type=vp_share', { headers: { Authorization: `Bearer ${token}` } });
        const d = await r.json();
        setVpQueue(d.actions || []);
```

- [ ] **Step 4: Add Team and VP Queue tab buttons**

In the tabs array (around where `corp-wallet` tab button is defined), add:
```typescript
    ...(subRole === 'super_admin' || subRole === 'admin' ? [{ id: 'team', label: 'Team' }] : []),
    ...(subRole === 'checker' ? [{ id: 'vp-queue', label: 'VP Queue' }] : []),
```

- [ ] **Step 5: Add Team tab content**

After `{tab === 'corp-wallet' && (...)}`, add:

```typescript
          {tab === 'team' && (
            <div>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem' }}>
                <h3 style={{ margin: 0 }}>Team Members</h3>
                {subRole === 'super_admin' && (
                  <button className="btn btn-primary" style={{ padding: '0.4rem 1rem' }} onClick={() => setShowInviteForm(true)}>+ Invite Member</button>
                )}
              </div>
              {inviteMsg && <div className="alert alert-error" style={{ marginBottom: '1rem' }}>{inviteMsg}</div>}
              {showInviteForm && (
                <div className="card" style={{ padding: '1.25rem', marginBottom: '1rem' }}>
                  <h4 style={{ marginBottom: '0.75rem' }}>Invite Team Member</h4>
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '0.75rem' }}>
                    <div className="form-group" style={{ margin: 0 }}>
                      <label>Email *</label>
                      <input className="form-input" type="email" value={inviteForm.email}
                        onChange={e => setInviteForm(f => ({ ...f, email: e.target.value }))} />
                    </div>
                    <div className="form-group" style={{ margin: 0 }}>
                      <label>Name *</label>
                      <input className="form-input" value={inviteForm.name}
                        onChange={e => setInviteForm(f => ({ ...f, name: e.target.value }))} />
                    </div>
                    <div className="form-group" style={{ margin: 0 }}>
                      <label>Sub Role *</label>
                      <select className="form-input" value={inviteForm.sub_role}
                        onChange={e => setInviteForm(f => ({ ...f, sub_role: e.target.value }))}>
                        {['admin', 'operator', 'maker', 'checker', 'member'].map(r => (
                          <option key={r} value={r}>{r}</option>
                        ))}
                      </select>
                    </div>
                  </div>
                  <div style={{ display: 'flex', gap: '0.5rem', marginTop: '0.75rem' }}>
                    <button className="btn btn-primary" onClick={async () => {
                      try {
                        const r = await fetch('/api/corporate/team/invite', {
                          method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
                          body: JSON.stringify(inviteForm),
                        });
                        const d = await r.json();
                        if (!r.ok) throw new Error(d.error);
                        setInviteMsg(`✓ Invited! Temp password: ${d.tempPassword}`);
                        setShowInviteForm(false);
                        setInviteForm({ email: '', name: '', sub_role: 'operator' });
                        loadAll();
                      } catch (e: any) { setInviteMsg(e.message); }
                    }}>Send Invite</button>
                    <button className="btn btn-secondary" onClick={() => setShowInviteForm(false)}>Cancel</button>
                  </div>
                </div>
              )}
              <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
                <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                  <thead>
                    <tr style={{ background: '#f8f9fa' }}>
                      {['Name', 'Email', 'Sub Role', 'Joined'].map(h => (
                        <th key={h} style={{ padding: '0.75rem 1rem', textAlign: 'left', fontWeight: 600, fontSize: '0.875rem', color: '#555', borderBottom: '1px solid #e2e8f0' }}>{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {team.length === 0 && (
                      <tr><td colSpan={4} style={{ padding: '2rem', textAlign: 'center', color: '#888' }}>No team members yet.</td></tr>
                    )}
                    {team.map((m: any) => (
                      <tr key={m.id} style={{ borderBottom: '1px solid #f0f0f0' }}>
                        <td style={{ padding: '0.75rem 1rem', fontWeight: 600 }}>{m.name}</td>
                        <td style={{ padding: '0.75rem 1rem', fontSize: '0.875rem', color: '#555' }}>{m.email}</td>
                        <td style={{ padding: '0.75rem 1rem' }}>
                          <span style={{ background: '#e2e8f0', padding: '0.2rem 0.6rem', borderRadius: 12, fontSize: '0.75rem', fontWeight: 600 }}>{m.sub_role || '—'}</span>
                        </td>
                        <td style={{ padding: '0.75rem 1rem', fontSize: '0.8rem', color: '#888' }}>{new Date(m.created_at).toLocaleDateString()}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
```

- [ ] **Step 6: Add "Create VP Draft" button to Corp Wallet tab for Maker**

In the existing Corp Wallet tab content (search for `{tab === 'corp-wallet' && (`), add a VP draft section below the DIA cards grid. Find the closing `</div>` of the corp-wallet tab block and insert before it:

```typescript
              {/* VP Draft — only shown to Maker sub_role */}
              {subRole === 'maker' && (
                <div className="card" style={{ padding: '1.25rem', marginTop: '1rem' }}>
                  <h4 style={{ marginBottom: '0.75rem' }}>Create VP Draft for Checker Approval</h4>
                  <p style={{ color: '#666', fontSize: '0.875rem', marginBottom: '1rem' }}>
                    Select credentials to share and a verifier. Your Checker will review and sign.
                  </p>
                  <VPDraftForm token={token} walletVCs={walletVCs} onSubmit={loadAll} />
                </div>
              )}
```

Then add the `VPDraftForm` component at the top of the file (before the `export default` line):

```typescript
function VPDraftForm({ token, walletVCs, onSubmit }: { token: string | null; walletVCs: Record<string, any>; onSubmit: () => void }) {
  const [selectedTypes, setSelectedTypes] = useState<string[]>([]);
  const [verifierId, setVerifierId] = useState('');
  const [note, setNote] = useState('');
  const [msg, setMsg] = useState('');
  const [loading, setLoading] = useState(false);

  const toggleType = (type: string) => setSelectedTypes(s => s.includes(type) ? s.filter(t => t !== type) : [...s, type]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (selectedTypes.length === 0) { setMsg('Select at least one credential'); return; }
    if (!verifierId.trim()) { setMsg('Verifier ID is required'); return; }
    setLoading(true);
    setMsg('');
    try {
      // Collect credential IDs for selected types
      const vcIds = selectedTypes.map(type => walletVCs[type]?.id).filter(Boolean);
      if (vcIds.length === 0) { setMsg('Selected credentials not found in wallet'); setLoading(false); return; }
      const res = await fetch('/api/mc/submit', {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ resource_type: 'vp_share', resource_id: crypto.randomUUID(), payload: { vc_ids: vcIds, verifier_id: verifierId, note } }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      setMsg('✓ VP draft submitted for Checker approval');
      setSelectedTypes([]); setVerifierId(''); setNote('');
      onSubmit();
    } catch (err: any) { setMsg(err.message); }
    finally { setLoading(false); }
  };

  const availableTypes = Object.keys(walletVCs);

  return (
    <form onSubmit={handleSubmit}>
      {msg && <div style={{ marginBottom: '0.75rem', color: msg.startsWith('✓') ? '#28a745' : '#dc3545', fontSize: '0.875rem' }}>{msg}</div>}
      <div style={{ marginBottom: '0.75rem' }}>
        <label style={{ fontWeight: 600, display: 'block', marginBottom: '0.5rem', fontSize: '0.875rem' }}>Select Credentials *</label>
        {availableTypes.length === 0 ? (
          <div style={{ color: '#888', fontSize: '0.85rem' }}>No credentials in wallet yet.</div>
        ) : availableTypes.map(type => (
          <label key={type} style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '0.35rem', cursor: 'pointer' }}>
            <input type="checkbox" checked={selectedTypes.includes(type)} onChange={() => toggleType(type)} />
            <span style={{ fontSize: '0.85rem' }}>{type}</span>
          </label>
        ))}
      </div>
      <div className="form-group">
        <label>Verifier Email / ID *</label>
        <input className="form-input" value={verifierId} onChange={e => setVerifierId(e.target.value)} placeholder="verifier@example.com" />
      </div>
      <div className="form-group">
        <label>Note (optional)</label>
        <input className="form-input" value={note} onChange={e => setNote(e.target.value)} placeholder="e.g., Trade finance application" />
      </div>
      <button className="btn btn-primary" type="submit" disabled={loading} style={{ marginTop: '0.5rem' }}>
        {loading ? 'Submitting...' : 'Submit VP Draft to Checker'}
      </button>
    </form>
  );
}
```

Note: `walletVCs` stores VCs by credential type. The Corp Wallet fetch (`api.getMyCredentials`) returns credential objects. Update the wallet load in `loadAll` to store the full credential object (including `id`) keyed by type, so `walletVCs[type].id` is available for `VPDraftForm`:

In `loadAll()`, find the corp-wallet branch and replace:
```typescript
        DIA_CONFIG.forEach(d => {
          const found = (data.credentials || []).find((c: any) => c.credential_type === d.type);
          if (found) acc[d.type] = found.vc_json;
        });
```
with:
```typescript
        DIA_CONFIG.forEach(d => {
          const found = (data.credentials || []).find((c: any) => c.credential_type === d.type);
          if (found) acc[d.type] = { ...found.vc_json, id: found.id };
        });
```

- [ ] **Step 7: Add VP Queue tab content for Checker**

After the Team tab block, add:

```typescript
          {tab === 'vp-queue' && (
            <div>
              <h3 style={{ marginBottom: '1rem' }}>Pending VP Approvals</h3>
              {vpQueue.length === 0 ? (
                <div className="card" style={{ padding: '2rem', textAlign: 'center', color: '#888' }}>No pending VP drafts to review.</div>
              ) : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
                  {vpQueue.map((action: any) => (
                    <div key={action.id} className="card" style={{ padding: '1.25rem' }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                        <div>
                          <div style={{ fontWeight: 600, marginBottom: '0.25rem' }}>VP Draft</div>
                          <div style={{ fontSize: '0.8rem', color: '#888' }}>Submitted: {new Date(action.created_at).toLocaleString()}</div>
                          <div style={{ fontSize: '0.8rem', color: '#555', marginTop: '0.25rem' }}>
                            Credentials: {JSON.stringify(action.payload?.vc_ids || [])}
                          </div>
                        </div>
                        <div style={{ display: 'flex', gap: '0.5rem' }}>
                          <button className="btn btn-primary" style={{ padding: '0.3rem 0.75rem', fontSize: '0.85rem' }}
                            onClick={async () => {
                              const r = await fetch(`/api/mc/${action.id}/approve`, {
                                method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, body: '{}',
                              });
                              const d = await r.json();
                              if (r.ok) { loadAll(); }
                              else alert(d.error);
                            }}>
                            Sign &amp; Send
                          </button>
                          <button className="btn btn-secondary" style={{ padding: '0.3rem 0.75rem', fontSize: '0.85rem', color: '#dc3545' }}
                            onClick={async () => {
                              const reason = prompt('Rejection reason:');
                              if (!reason) return;
                              const r = await fetch(`/api/mc/${action.id}/reject`, {
                                method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
                                body: JSON.stringify({ reason }),
                              });
                              if (r.ok) loadAll();
                            }}>
                            Reject
                          </button>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
```

---

## Task 10: End-to-End Verification

- [ ] **Step 1: Restart full stack**

```bash
pkill -f "tsx src/server/index.ts" 2>/dev/null; sleep 1
DATABASE_URL=postgresql://didvc_user:didvc_pass@localhost:5433/didvc PORT=3002 npx tsx src/server/index.ts &
sleep 3
```

- [ ] **Step 2: Verify Portal Manager login**

Navigate to `http://localhost:3000/login`. Enter:
- Email: `portal@didvc.platform`
- Password: `PortalManager@2026`

Enter MFA code from console. Expect redirect to `http://localhost:3000/portal/dashboard`.

Verify: Overview tab shows stat cards with numbers. Authority Accounts tab shows empty table with "Create Account" button.

- [ ] **Step 3: Create a Maker authority account via Portal Manager**

In Authority Accounts tab, click "Create Account":
- Email: `mca-maker@mca.gov.in`
- Name: `MCA Field Officer`
- Authority Type: `MCA`
- Sub Role: `maker`

Click "Create Account". Expect modal showing temp password.

- [ ] **Step 4: Create a Checker authority account**

Click "Create Account" again:
- Email: `mca-checker@mca.gov.in`
- Name: `MCA Senior Officer`
- Authority Type: `MCA`
- Sub Role: `checker`

Click "Create Account". Note temp password.

- [ ] **Step 5: Verify both accounts in DB**

```bash
psql postgresql://didvc_user:didvc_pass@localhost:5433/didvc \
  -c "SELECT email, role, authority_type, sub_role FROM users WHERE role='government_agency' ORDER BY created_at DESC LIMIT 5;"
```

Expected: both MCA accounts with correct sub_roles.

- [ ] **Step 6: Login as MCA Maker and submit an org for checker approval**

Navigate to `http://localhost:3000/login`. Login as `mca-maker@mca.gov.in` with the temp password. Expect redirect to `/authority/dashboard`.

In Pending Requests, open an existing pending org application. Check all MCA fields (CIN, Company Name). Click "Submit for Checker Approval". Expect success message.

- [ ] **Step 7: Login as MCA Checker and approve**

Login as `mca-checker@mca.gov.in`. Navigate to `/authority/dashboard`. Click "Checker Queue" in sidebar. Expect the pending action from Step 6 to appear. Click "Approve". Expect "Organization Approved!" modal.

- [ ] **Step 8: Verify mc_actions record in DB**

```bash
psql postgresql://didvc_user:didvc_pass@localhost:5433/didvc \
  -c "SELECT id, resource_type, status, maker_id IS NOT NULL as has_maker, checker_id IS NOT NULL as has_checker FROM mc_actions ORDER BY created_at DESC LIMIT 3;"
```

Expected: row with `resource_type=vc_issuance`, `status=approved`, both maker and checker IDs present.

- [ ] **Step 9: Verify self-approval guard**

```bash
# Get maker token via Python
python3 -c "
import urllib.request, json
data = json.dumps({'email':'mca-maker@mca.gov.in','password':'TEMP_PASSWORD_HERE'}).encode()
req = urllib.request.Request('http://localhost:3002/api/auth/login', data=data, headers={'Content-Type':'application/json'})
res = urllib.request.urlopen(req)
print(json.dumps(json.loads(res.read()), indent=2))
"
```

After getting maker's full token (via MFA), try to approve an action the maker submitted:
```bash
python3 -c "
import urllib.request, json
token = 'MAKER_TOKEN_HERE'
action_id = 'ACTION_ID_HERE'
req = urllib.request.Request(f'http://localhost:3002/api/mc/{action_id}/approve',
  data=b'{}', headers={'Authorization': f'Bearer {token}', 'Content-Type': 'application/json'})
req.get_method = lambda: 'POST'
try:
  res = urllib.request.urlopen(req)
  print(json.loads(res.read()))
except urllib.error.HTTPError as e:
  print(json.loads(e.read()))
"
```

Expected: `{"error":"A Maker cannot approve their own action"}`

- [ ] **Step 10: Verify Corporate Super Admin Team tab**

Login as an existing approved corporate user (from a previous org application). Navigate to `/corporate/dashboard`. Expect "Team" tab visible (since sub_role = super_admin). Click Team tab → "Invite Member". Invite:
- Email: `maker@acme.com`
- Name: `Acme Maker`
- Sub Role: `maker`

Expect temp password shown. Verify in DB:

```bash
psql postgresql://didvc_user:didvc_pass@localhost:5433/didvc \
  -c "SELECT email, role, sub_role, org_id IS NOT NULL as has_org FROM users WHERE email='maker@acme.com';"
```

Expected: row with `role=corporate`, `sub_role=maker`, `has_org=true`.

- [ ] **Step 11: Verify DID Registry in Portal Manager**

Login back as Portal Manager. Click "DID Registry" tab. Expect table with all DIDs (paginated 20/page). Verify columns: DID String, Type (parent/sub), Owner, Role, Created.

- [ ] **Step 12: Verify Organizations tab in Portal Manager**

Click "Organizations" tab. Expect all org applications listed. Use the status filter dropdown to filter by "complete". Expect only fully approved orgs shown with 4/4 badge.
