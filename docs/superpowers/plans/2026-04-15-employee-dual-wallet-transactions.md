# Employee Dual Wallet & Transactions Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give corporate employees a dual-wallet view (Employee + Corporate credentials with admin-controlled permissions), a unified Transactions tab, and give verifiers a 3-step org→employee→credentials proof request flow.

**Architecture:** New `employee_credential_permissions` table controls which corporate credential types each employee may share. Six new API endpoints expose this data. AppShell gains a `my-wallets` and `transactions` tab for employee sub_role. CorporateDashboard and VerifierDashboard are updated in-place following existing patterns (direct fetch + useState, no new components files).

**Tech Stack:** PostgreSQL, Express/TypeScript (server/index.ts), React 18 (TSX), existing `requireAuth`/`requireRole` middleware.

---

## File Map

| File | Change |
|------|--------|
| `src/db/schema.sql` | Add `employee_credential_permissions` table + index |
| `src/server/index.ts` | 6 new endpoints appended before final `app.listen` |
| `src/frontend/components/AppShell.tsx` | Add `my-wallets` + `transactions` tabs for employee subRole |
| `src/frontend/pages/CorporateDashboard.tsx` | New `my-wallets` tab, `transactions` tab, employee permissions UI, updated ProofRequestsTab |
| `src/frontend/pages/VerifierDashboard.tsx` | Replace employee search with 3-step corp→employee→credentials form |

---

## Task 1: DB — employee_credential_permissions table

**Files:**
- Modify: `src/db/schema.sql`

- [ ] **Step 1: Add the table definition to schema.sql**

Open `src/db/schema.sql` and append at the very end (after the last existing block):

```sql
-- Employee credential sharing permissions (admin-granted)
CREATE TABLE IF NOT EXISTS employee_credential_permissions (
  id                   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  employee_registry_id UUID NOT NULL REFERENCES employee_registry(id) ON DELETE CASCADE,
  credential_type      VARCHAR(100) NOT NULL,
  granted_by           UUID NOT NULL REFERENCES users(id),
  created_at           TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE (employee_registry_id, credential_type)
);
CREATE INDEX IF NOT EXISTS idx_emp_cred_perms_registry
  ON employee_credential_permissions(employee_registry_id);
```

- [ ] **Step 2: Apply the migration**

```bash
psql "postgresql://didvc_user:didvc_pass@localhost:5433/didvc" \
  -c "CREATE TABLE IF NOT EXISTS employee_credential_permissions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    employee_registry_id UUID NOT NULL REFERENCES employee_registry(id) ON DELETE CASCADE,
    credential_type VARCHAR(100) NOT NULL,
    granted_by UUID NOT NULL REFERENCES users(id),
    created_at TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE (employee_registry_id, credential_type)
  );
  CREATE INDEX IF NOT EXISTS idx_emp_cred_perms_registry ON employee_credential_permissions(employee_registry_id);"
```

Expected output: `CREATE TABLE` then `CREATE INDEX`

- [ ] **Step 3: Verify table exists**

```bash
psql "postgresql://didvc_user:didvc_pass@localhost:5433/didvc" \
  -c "\d employee_credential_permissions"
```

Expected: table columns listed including `employee_registry_id`, `credential_type`, `granted_by`.

- [ ] **Step 4: Commit**

```bash
git add src/db/schema.sql
git commit -m "feat: add employee_credential_permissions table"
```

---

## Task 2: Server — Verifier corporate org + employee listing endpoints

**Files:**
- Modify: `src/server/index.ts` (append before the final `app.listen(...)` call)

- [ ] **Step 1: Find the insertion point**

```bash
grep -n "app.listen" src/server/index.ts | tail -1
```

Note the line number. All new server code in Tasks 2-6 goes immediately before that line.

- [ ] **Step 2: Add GET /api/verifier/corporates**

Append to `src/server/index.ts` before `app.listen`:

```typescript
// Verifier: list all corporate organisations (root users with role=corporate, org_id=self)
app.get('/api/verifier/corporates', requireAuth, requireRole('verifier'), async (req, res) => {
  try {
    const result = await query(
      `SELECT u.id, u.name, u.email,
              d.did_string,
              (SELECT COUNT(*) FROM employee_registry er WHERE er.corporate_user_id = u.id) AS employee_count
       FROM users u
       LEFT JOIN dids d ON d.user_id = u.id AND d.did_type = 'parent'
       WHERE u.role = 'corporate'
         AND u.sub_role = 'super_admin'
         AND u.org_id = u.id
       ORDER BY u.name`,
      []
    );
    res.json({ success: true, corporates: result.rows });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});
```

- [ ] **Step 3: Add GET /api/verifier/corporates/:orgId/employees**

```typescript
// Verifier: list employees of a specific corporate org (only those with portal accounts)
app.get('/api/verifier/corporates/:orgId/employees', requireAuth, requireRole('verifier'), async (req, res) => {
  try {
    const { orgId } = req.params;
    const result = await query(
      `SELECT er.id, er.employee_id, er.name, er.email, er.user_id,
              d.did_string AS employee_did
       FROM employee_registry er
       LEFT JOIN dids d ON er.sub_did_id = d.id
       WHERE er.corporate_user_id = $1
         AND er.user_id IS NOT NULL
       ORDER BY er.name`,
      [orgId]
    );
    res.json({ success: true, employees: result.rows });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});
```

- [ ] **Step 4: Restart server and verify endpoints**

```bash
# Kill existing server
pkill -f "tsx src/server/index.ts" || true
# Start fresh
DATABASE_URL="postgresql://didvc_user:didvc_pass@localhost:5433/didvc" \
  nohup npx tsx src/server/index.ts > /tmp/server.log 2>&1 &
sleep 2

# Test (use your verifier token from browser localStorage)
TOKEN=$(psql "postgresql://didvc_user:didvc_pass@localhost:5433/didvc" -t \
  -c "SELECT token FROM auth_tokens at JOIN users u ON u.id=at.user_id WHERE u.email='verifier@bank.com' ORDER BY at.created_at DESC LIMIT 1;" 2>/dev/null | xargs)

curl -s -H "Authorization: Bearer $TOKEN" http://localhost:3000/api/verifier/corporates | jq '.corporates[0].name'
```

Expected: `"FSV Labs Pvt Ltd"` (or similar)

- [ ] **Step 5: Commit**

```bash
git add src/server/index.ts
git commit -m "feat: add verifier corporates and employees listing endpoints"
```

---

## Task 3: Server — Employee credential permission read/write endpoints

**Files:**
- Modify: `src/server/index.ts`

- [ ] **Step 1: Add GET /api/corporate/employees/:id/permissions**

Append to `src/server/index.ts` before `app.listen`:

```typescript
// Corporate: get credential sharing permissions for an employee
app.get('/api/corporate/employees/:employeeRegistryId/permissions', requireAuth, requireRole('corporate'), async (req, res) => {
  try {
    const user = (req as any).user;
    const { employeeRegistryId } = req.params;
    const orgOwner = user.org_id || user.id;

    // Verify the employee belongs to this org
    const empCheck = await query(
      'SELECT id FROM employee_registry WHERE id = $1 AND corporate_user_id = $2',
      [employeeRegistryId, orgOwner]
    );
    if (empCheck.rows.length === 0) return res.status(404).json({ error: 'Employee not found in your organisation' });

    const result = await query(
      `SELECT credential_type FROM employee_credential_permissions
       WHERE employee_registry_id = $1 ORDER BY credential_type`,
      [employeeRegistryId]
    );
    res.json({ success: true, credential_types: result.rows.map((r: any) => r.credential_type) });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});
```

- [ ] **Step 2: Add POST /api/corporate/employees/:id/permissions**

```typescript
// Corporate: set credential sharing permissions for an employee (admin only, full replace)
app.post('/api/corporate/employees/:employeeRegistryId/permissions', requireAuth, requireRole('corporate'), async (req, res) => {
  try {
    const user = (req as any).user;
    if (!['super_admin', 'admin'].includes(user.sub_role)) {
      return res.status(403).json({ error: 'Only admin or super_admin can manage employee permissions' });
    }
    const { employeeRegistryId } = req.params;
    const { credential_types } = req.body; // string[]
    if (!Array.isArray(credential_types)) {
      return res.status(400).json({ error: 'credential_types must be an array of strings' });
    }
    const orgOwner = user.org_id || user.id;

    const empCheck = await query(
      'SELECT id FROM employee_registry WHERE id = $1 AND corporate_user_id = $2',
      [employeeRegistryId, orgOwner]
    );
    if (empCheck.rows.length === 0) return res.status(404).json({ error: 'Employee not found in your organisation' });

    // Full replace: delete existing then insert new
    await query('DELETE FROM employee_credential_permissions WHERE employee_registry_id = $1', [employeeRegistryId]);
    for (const ct of credential_types) {
      if (typeof ct === 'string' && ct.trim()) {
        await query(
          'INSERT INTO employee_credential_permissions (employee_registry_id, credential_type, granted_by) VALUES ($1, $2, $3)',
          [employeeRegistryId, ct.trim(), user.id]
        );
      }
    }
    res.json({ success: true, message: 'Permissions updated' });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});
```

- [ ] **Step 3: Commit**

```bash
git add src/server/index.ts
git commit -m "feat: add employee credential permission management endpoints"
```

---

## Task 4: Server — Employee corporate wallet endpoint

**Files:**
- Modify: `src/server/index.ts`

- [ ] **Step 1: Add GET /api/holder/corporate-wallet**

Append to `src/server/index.ts` before `app.listen`:

```typescript
// Employee: get corporate credentials they are permitted to share
app.get('/api/holder/corporate-wallet', requireAuth, requireRole('corporate'), async (req, res) => {
  try {
    const user = (req as any).user;
    if (user.sub_role !== 'employee') {
      return res.status(403).json({ error: 'Only employees can access corporate wallet' });
    }

    // Get this employee's registry entry
    const empResult = await query(
      'SELECT er.id, er.corporate_user_id FROM employee_registry er WHERE er.user_id = $1 LIMIT 1',
      [user.id]
    );
    if (empResult.rows.length === 0) return res.json({ success: true, credentials: [] });

    const { id: empRegistryId, corporate_user_id: orgOwnerId } = empResult.rows[0];

    // Get permitted credential types for this employee
    const permResult = await query(
      'SELECT credential_type FROM employee_credential_permissions WHERE employee_registry_id = $1',
      [empRegistryId]
    );
    const allowedTypes = permResult.rows.map((r: any) => r.credential_type);
    if (allowedTypes.length === 0) return res.json({ success: true, credentials: [] });

    // Get corporate parent DID
    const corpDidResult = await query(
      "SELECT id FROM dids WHERE user_id = $1 AND did_type = 'parent' ORDER BY created_at DESC LIMIT 1",
      [orgOwnerId]
    );
    if (corpDidResult.rows.length === 0) return res.json({ success: true, credentials: [] });

    const corpDidId = corpDidResult.rows[0].id;

    // Return only credentials of permitted types
    const placeholders = allowedTypes.map((_: any, i: number) => `$${i + 2}`).join(', ');
    const result = await query(
      `SELECT c.id, c.credential_type, c.issued_at, c.expires_at, c.revoked, c.vc_json,
              d.did_string AS issuer_did_string
       FROM credentials c
       LEFT JOIN dids d ON c.issuer_did_id = d.id
       WHERE c.holder_did_id = $1
         AND c.credential_type IN (${placeholders})
         AND c.revoked = false
       ORDER BY c.issued_at DESC`,
      [corpDidId, ...allowedTypes]
    );
    res.json({ success: true, credentials: result.rows });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});
```

- [ ] **Step 2: Commit**

```bash
git add src/server/index.ts
git commit -m "feat: add holder corporate-wallet endpoint with permission filtering"
```

---

## Task 5: Server — Employee transactions endpoint

**Files:**
- Modify: `src/server/index.ts`

- [ ] **Step 1: Add GET /api/holder/transactions**

Append to `src/server/index.ts` before `app.listen`:

```typescript
// Employee: unified transactions timeline (inbound proof requests + outbound presentations)
app.get('/api/holder/transactions', requireAuth, requireRole('corporate'), async (req, res) => {
  try {
    const user = (req as any).user;
    if (user.sub_role !== 'employee') {
      return res.status(403).json({ error: 'Only employees can access transactions' });
    }

    // Get employee's sub-DID
    const didRow = await query(
      'SELECT d.id FROM employee_registry er JOIN dids d ON er.sub_did_id = d.id WHERE er.user_id = $1 LIMIT 1',
      [user.id]
    );
    if (didRow.rows.length === 0) return res.json({ success: true, transactions: [] });
    const holderDidId = didRow.rows[0].id;

    // Inbound: verification requests targeted at this employee
    const inbound = await query(
      `SELECT vr.id, 'inbound' AS direction,
              'Proof Request Received' AS title,
              u.name AS counterparty_name,
              u.email AS counterparty_email,
              vr.required_credential_types,
              vr.status,
              vr.created_at
       FROM verification_requests vr
       JOIN users u ON vr.verifier_user_id = u.id
       WHERE vr.holder_did_id = $1
       ORDER BY vr.created_at DESC`,
      [holderDidId]
    );

    // Outbound: presentations submitted by this employee
    const outbound = await query(
      `SELECT p.id, 'outbound' AS direction,
              'Presentation Submitted' AS title,
              u.name AS counterparty_name,
              u.email AS counterparty_email,
              vr.required_credential_types,
              vr.status,
              p.created_at
       FROM presentations p
       JOIN verification_requests vr ON p.verifier_request_id = vr.id
       JOIN users u ON vr.verifier_user_id = u.id
       WHERE p.holder_did_id = $1
       ORDER BY p.created_at DESC`,
      [holderDidId]
    );

    // Merge and sort by created_at descending
    const all = [...inbound.rows, ...outbound.rows]
      .sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());

    res.json({ success: true, transactions: all });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});
```

- [ ] **Step 2: Restart server and smoke-test**

```bash
pkill -f "tsx src/server/index.ts" || true
DATABASE_URL="postgresql://didvc_user:didvc_pass@localhost:5433/didvc" \
  nohup npx tsx src/server/index.ts > /tmp/server.log 2>&1 &
sleep 2
echo "Server started — check /tmp/server.log for errors"
grep -i "error\|Error" /tmp/server.log | head -5
```

Expected: no errors in log.

- [ ] **Step 3: Commit**

```bash
git add src/server/index.ts
git commit -m "feat: add holder transactions endpoint for employee unified timeline"
```

---

## Task 6: AppShell — Add my-wallets and transactions tabs for employee

**Files:**
- Modify: `src/frontend/components/AppShell.tsx`

- [ ] **Step 1: Read current corporate nav items (lines 32-45)**

The current `corporate` array in `NAV_ITEMS` has `corp-wallet` restricted to non-employee subRoles. We need to add `my-wallets` and `transactions` tabs visible only to `employee` subRole.

- [ ] **Step 2: Update the corporate nav array**

In `src/frontend/components/AppShell.tsx`, find the `corporate` array inside `NAV_ITEMS` and replace it with:

```typescript
  corporate: [
    { tab: 'credentials',     label: 'My Credentials',   icon: '🏷' },
    { tab: 'employees',       label: 'Employees',         icon: '👥', subRoles: ['super_admin', 'admin', 'maker', 'checker', 'authorized_signatory', 'requester', 'operator', 'member'] },
    { tab: 'requests',        label: 'My Requests',       icon: '📄', subRoles: ['requester'] },
    { tab: 'request-vc',      label: 'Request VC',        icon: '📝', subRoles: ['requester'] },
    { tab: 'request-did',     label: 'Request DID',       icon: '🔑', subRoles: ['requester', 'super_admin'] },
    { tab: 'corp-queue',      label: 'Review Queue',      icon: '🔍', subRoles: ['maker', 'super_admin'] },
    { tab: 'checker-queue',   label: 'Approval Queue',    icon: '✅', subRoles: ['checker', 'super_admin'] },
    { tab: 'signatory-queue', label: 'Sign & Submit',     icon: '✍️',  subRoles: ['authorized_signatory', 'super_admin'] },
    { tab: 'proof-requests',  label: 'Proof Requests',    icon: '🛡' },
    { tab: 'corp-wallet',     label: 'Wallet',            icon: '💼', subRoles: ['super_admin', 'admin', 'maker', 'checker', 'authorized_signatory', 'requester', 'operator', 'member'] },
    { tab: 'my-wallets',      label: 'My Wallets',        icon: '💼', subRoles: ['employee'] },
    { tab: 'transactions',    label: 'Transactions',      icon: '🔄', subRoles: ['employee'] },
    { tab: 'team',            label: 'Team',              icon: '🤝', subRoles: ['super_admin', 'admin'] },
    { tab: 'vp-queue',        label: 'VP Queue',          icon: '⏳', subRoles: ['checker', 'super_admin'] },
  ],
```

- [ ] **Step 3: Commit**

```bash
git add src/frontend/components/AppShell.tsx
git commit -m "feat: add my-wallets and transactions nav tabs for employee sub_role"
```

---

## Task 7: CorporateDashboard — My Wallets tab (dual wallet)

**Files:**
- Modify: `src/frontend/pages/CorporateDashboard.tsx`

- [ ] **Step 1: Add state variables for wallets**

In `CorporateDashboard`, find the block of `useState` declarations (around line 230) and add after the existing `walletVCs` state:

```typescript
  const [corpWalletCredentials, setCorpWalletCredentials] = useState<any[]>([]);
  const [activeWallet, setActiveWallet] = useState<'employee' | 'corporate'>('employee');
  const [empWalletCredentials, setEmpWalletCredentials] = useState<any[]>([]);
```

- [ ] **Step 2: Add my-wallets tab data loading in loadAll()**

In the `loadAll()` function, find the `else if (tab === 'corp-wallet')` branch and add a new branch after it:

```typescript
      } else if (tab === 'my-wallets') {
        const [empData, corpData] = await Promise.all([
          fetch('/api/credentials/my', { headers: { Authorization: `Bearer ${token}` } }).then(r => r.json()),
          fetch('/api/holder/corporate-wallet', { headers: { Authorization: `Bearer ${token}` } }).then(r => r.json()),
        ]);
        setEmpWalletCredentials(empData.credentials || []);
        setCorpWalletCredentials(corpData.credentials || []);
        setActiveWallet('employee');
```

- [ ] **Step 3: Add the my-wallets tab render**

In the main JSX return of `CorporateDashboard`, find where the tab renders are (look for `{tab === 'corp-wallet' &&` or similar pattern). Add the following block alongside the other tab renders:

```tsx
        {tab === 'my-wallets' && (
          <div>
            <h3>My Wallets</h3>
            <p style={{ color: '#666', fontSize: '0.9rem', marginBottom: '1.25rem' }}>
              Your personal credentials and corporate credentials you are authorised to share.
            </p>

            {/* Wallet toggle */}
            <div style={{ display: 'flex', border: '1px solid #e2e8f0', borderRadius: 8, overflow: 'hidden', width: 'fit-content', marginBottom: '1.5rem' }}>
              <button
                onClick={() => setActiveWallet('employee')}
                style={{ padding: '8px 20px', border: 'none', cursor: 'pointer', fontWeight: 600, fontSize: '0.85rem',
                  background: activeWallet === 'employee' ? '#2563eb' : '#f8fafc',
                  color: activeWallet === 'employee' ? 'white' : '#64748b' }}
              >
                👤 Employee Wallet
              </button>
              <button
                onClick={() => setActiveWallet('corporate')}
                style={{ padding: '8px 20px', border: 'none', borderLeft: '1px solid #e2e8f0', cursor: 'pointer', fontWeight: 600, fontSize: '0.85rem',
                  background: activeWallet === 'corporate' ? '#7c3aed' : '#f8fafc',
                  color: activeWallet === 'corporate' ? 'white' : '#64748b' }}
              >
                🏢 Corporate Wallet
              </button>
            </div>

            {activeWallet === 'employee' && (
              <div>
                <p style={{ fontSize: '0.8rem', color: '#3b82f6', background: '#eff6ff', padding: '8px 12px', borderRadius: 6, marginBottom: '1rem' }}>
                  ℹ️ These are credentials issued directly to your identity. Only you can share them.
                </p>
                {empWalletCredentials.length === 0 ? (
                  <p style={{ color: '#888' }}>No credentials in your employee wallet yet.</p>
                ) : (
                  <div style={{ display: 'grid', gap: '0.75rem', maxWidth: 600 }}>
                    {empWalletCredentials.filter((c: any) => !c.revoked).map((c: any) => (
                      <div key={c.id} className="card" style={{ padding: '12px 16px' }}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                          <div>
                            <div style={{ fontWeight: 700, fontSize: '0.9rem' }}>{c.credential_type}</div>
                            <div style={{ fontSize: '0.75rem', color: '#64748b', marginTop: 2 }}>
                              {c.issuer_did_string ? `Issued by: ${c.issuer_did_string.split(':').pop()}` : 'Issuer unknown'}
                            </div>
                            <div style={{ fontSize: '0.7rem', color: '#94a3b8', marginTop: 2 }}>
                              {new Date(c.issued_at).toLocaleDateString()}
                            </div>
                          </div>
                          <span style={{ background: '#dcfce7', color: '#16a34a', fontSize: '0.65rem', padding: '2px 8px', borderRadius: 10, fontWeight: 600 }}>ACTIVE</span>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}

            {activeWallet === 'corporate' && (
              <div>
                <p style={{ fontSize: '0.8rem', color: '#7c3aed', background: '#faf5ff', border: '1px solid #e9d5ff', padding: '8px 12px', borderRadius: 6, marginBottom: '1rem' }}>
                  🔐 Corporate credentials you are authorised to share on behalf of your organisation. Contact admin to change permissions.
                </p>
                {corpWalletCredentials.length === 0 ? (
                  <p style={{ color: '#888' }}>No corporate credentials are currently authorised for sharing. Contact your admin.</p>
                ) : (
                  <div style={{ display: 'grid', gap: '0.75rem', maxWidth: 600 }}>
                    {corpWalletCredentials.map((c: any) => (
                      <div key={c.id} className="card" style={{ padding: '12px 16px' }}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                          <div>
                            <div style={{ fontWeight: 700, fontSize: '0.9rem' }}>{c.credential_type}</div>
                            <div style={{ fontSize: '0.75rem', color: '#64748b', marginTop: 2 }}>
                              {c.issuer_did_string ? `Issued by: ${c.issuer_did_string.split(':').pop()}` : 'Issuer unknown'}
                            </div>
                            <div style={{ fontSize: '0.7rem', color: '#94a3b8', marginTop: 2 }}>
                              {new Date(c.issued_at).toLocaleDateString()}
                            </div>
                          </div>
                          <span style={{ background: '#dcfce7', color: '#16a34a', fontSize: '0.65rem', padding: '2px 8px', borderRadius: 10, fontWeight: 600 }}>CAN SHARE</span>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>
        )}
```

- [ ] **Step 4: Commit**

```bash
git add src/frontend/pages/CorporateDashboard.tsx
git commit -m "feat: add My Wallets tab with dual employee/corporate wallet toggle"
```

---

## Task 8: CorporateDashboard — Transactions tab

**Files:**
- Modify: `src/frontend/pages/CorporateDashboard.tsx`

- [ ] **Step 1: Add transactions state**

After the `corpWalletCredentials` state added in Task 7, add:

```typescript
  const [transactions, setTransactions] = useState<any[]>([]);
```

- [ ] **Step 2: Add transactions data loading in loadAll()**

After the `my-wallets` branch added in Task 7, add:

```typescript
      } else if (tab === 'transactions') {
        const r = await fetch('/api/holder/transactions', { headers: { Authorization: `Bearer ${token}` } });
        const d = await r.json();
        setTransactions(d.transactions || []);
```

- [ ] **Step 3: Add the transactions tab render**

Add alongside the other tab renders in the JSX return:

```tsx
        {tab === 'transactions' && (
          <div>
            <h3>Transactions</h3>
            <p style={{ color: '#666', fontSize: '0.9rem', marginBottom: '1.25rem' }}>
              All credential sharing activity — proof requests received and presentations submitted.
            </p>
            {transactions.length === 0 ? (
              <p style={{ color: '#888' }}>No transactions yet.</p>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem', maxWidth: 680 }}>
                {transactions.map((tx: any) => {
                  const isInbound = tx.direction === 'inbound';
                  const borderColor = isInbound ? '#3b82f6' : '#16a34a';
                  const bgColor = isInbound ? '#eff6ff' : '#f0fdf4';
                  const statusBg = tx.status === 'pending' ? '#feebc8' : tx.status === 'submitted' ? '#bee3f8' : tx.status === 'approved' ? '#c6f6d5' : '#fed7d7';
                  const statusClr = tx.status === 'pending' ? '#7b341e' : tx.status === 'submitted' ? '#2a69ac' : tx.status === 'approved' ? '#276749' : '#c53030';
                  const types = Array.isArray(tx.required_credential_types) ? tx.required_credential_types.join(', ') : (tx.required_credential_types || '');
                  return (
                    <div key={tx.id} style={{ borderLeft: `3px solid ${borderColor}`, background: bgColor, borderRadius: '0 8px 8px 0', padding: '10px 14px' }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                        <div style={{ fontWeight: 700, fontSize: '0.85rem' }}>
                          {isInbound ? '📥' : '📤'} {tx.title}
                        </div>
                        <span style={{ fontSize: '0.68rem', color: '#94a3b8' }}>
                          {new Date(tx.created_at).toLocaleString()}
                        </span>
                      </div>
                      <div style={{ fontSize: '0.78rem', color: '#374151', marginTop: 4 }}>
                        {isInbound
                          ? <span><strong>{tx.counterparty_name || tx.counterparty_email}</strong> requested: <strong>{types || 'credentials'}</strong></span>
                          : <span>Shared <strong>{types || 'credentials'}</strong> with <strong>{tx.counterparty_name || tx.counterparty_email}</strong></span>
                        }
                      </div>
                      <div style={{ marginTop: 6 }}>
                        <span style={{ fontSize: '0.65rem', padding: '2px 8px', borderRadius: 8, fontWeight: 600, background: statusBg, color: statusClr }}>
                          {tx.status?.toUpperCase()}
                        </span>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        )}
```

- [ ] **Step 4: Commit**

```bash
git add src/frontend/pages/CorporateDashboard.tsx
git commit -m "feat: add Transactions tab with unified inbound/outbound timeline"
```

---

## Task 9: CorporateDashboard — Employee permissions management in Employees tab

**Files:**
- Modify: `src/frontend/pages/CorporateDashboard.tsx`

- [ ] **Step 1: Add permissions state**

After the `transactions` state added in Task 8, add:

```typescript
  const [empPermissions, setEmpPermissions] = useState<Record<string, string[]>>({});
  const [expandedPermEmpId, setExpandedPermEmpId] = useState<string | null>(null);
  const [permMsg, setPermMsg] = useState<{ id: string; type: 'success' | 'error'; text: string } | null>(null);
```

- [ ] **Step 2: Add helper functions for permissions**

After the `showMsg` function, add:

```typescript
  async function loadEmpPermissions(empRegistryId: string) {
    if (!token) return;
    const r = await fetch(`/api/corporate/employees/${empRegistryId}/permissions`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    const d = await r.json();
    setEmpPermissions(prev => ({ ...prev, [empRegistryId]: d.credential_types || [] }));
  }

  async function toggleEmpPermission(empRegistryId: string, credType: string) {
    const current = empPermissions[empRegistryId] || [];
    const updated = current.includes(credType)
      ? current.filter(t => t !== credType)
      : [...current, credType];
    setEmpPermissions(prev => ({ ...prev, [empRegistryId]: updated }));
  }

  async function saveEmpPermissions(empRegistryId: string) {
    if (!token) return;
    const types = empPermissions[empRegistryId] || [];
    try {
      const r = await fetch(`/api/corporate/employees/${empRegistryId}/permissions`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ credential_types: types }),
      });
      const d = await r.json();
      if (!r.ok) throw new Error(d.error);
      setPermMsg({ id: empRegistryId, type: 'success', text: '✓ Permissions saved' });
    } catch (err: any) {
      setPermMsg({ id: empRegistryId, type: 'error', text: err.message });
    }
    setTimeout(() => setPermMsg(null), 3000);
  }
```

- [ ] **Step 3: Add credential types list for the corporate org**

Near the top of the `CorporateDashboard` function (after the state declarations), add a constant representing the corporate credential types the org holds (sourced from `credentials` state when employees tab is loaded, but we use a fixed list of known corporate types for the permission UI):

```typescript
  // Corporate credential types available for permission granting
  const CORP_CREDENTIAL_TYPES = ['IECCredential', 'MCARegistration', 'GSTINCredential', 'PANCredential', 'IBDICDigitalIdentityCredential'];
```

- [ ] **Step 4: Add the permissions panel to each employee card in the Employees tab**

In the JSX where employees are rendered (in the `{tab === 'employees' &&` block), find the employee card render. After the existing employee card content (name, email, sub-DID, "Create Login" button), add this block — visible only to super_admin and admin:

```tsx
                  {/* Credential Sharing Permissions — admin only */}
                  {['super_admin', 'admin'].includes(subRole) && (
                    <div style={{ marginTop: '0.75rem', borderTop: '1px solid #e2e8f0', paddingTop: '0.75rem' }}>
                      <button
                        style={{ fontSize: '0.75rem', color: '#7c3aed', background: 'none', border: 'none', cursor: 'pointer', fontWeight: 600, padding: 0 }}
                        onClick={() => {
                          const newId = expandedPermEmpId === emp.id ? null : emp.id;
                          setExpandedPermEmpId(newId);
                          if (newId) loadEmpPermissions(emp.id);
                        }}
                      >
                        {expandedPermEmpId === emp.id ? '▲ Hide' : '▼ Credential Sharing Permissions'}
                      </button>
                      {expandedPermEmpId === emp.id && (
                        <div style={{ marginTop: '0.5rem' }}>
                          <div style={{ fontSize: '0.72rem', color: '#64748b', marginBottom: '0.5rem' }}>
                            Select which corporate credentials this employee can share on behalf of the organisation:
                          </div>
                          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.3rem', marginBottom: '0.75rem' }}>
                            {CORP_CREDENTIAL_TYPES.map(ct => (
                              <label key={ct} style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', cursor: 'pointer', fontSize: '0.8rem' }}>
                                <input
                                  type="checkbox"
                                  checked={(empPermissions[emp.id] || []).includes(ct)}
                                  onChange={() => toggleEmpPermission(emp.id, ct)}
                                />
                                {ct}
                              </label>
                            ))}
                          </div>
                          {permMsg?.id === emp.id && (
                            <div style={{ fontSize: '0.75rem', color: permMsg.type === 'success' ? '#276749' : '#dc3545', marginBottom: '0.5rem' }}>
                              {permMsg.text}
                            </div>
                          )}
                          <button
                            className="btn btn-primary"
                            style={{ fontSize: '0.75rem', padding: '4px 12px' }}
                            onClick={() => saveEmpPermissions(emp.id)}
                          >
                            Save Permissions
                          </button>
                        </div>
                      )}
                    </div>
                  )}
```

- [ ] **Step 5: Commit**

```bash
git add src/frontend/pages/CorporateDashboard.tsx
git commit -m "feat: add employee credential sharing permission management in Employees tab"
```

---

## Task 10: CorporateDashboard — Update ProofRequestsTab to include corporate credentials

**Files:**
- Modify: `src/frontend/pages/CorporateDashboard.tsx`

- [ ] **Step 1: Update ProofRequestsTab component signature**

Find the `ProofRequestsTab` function definition (around line 81) and update its props interface and signature:

```tsx
function ProofRequestsTab({ proofRequests, myCredentials, corporateCredentials, token, onRefresh }: {
  proofRequests: any[];
  myCredentials: any[];
  corporateCredentials: any[];
  token: string | null;
  onRefresh: () => void;
}) {
```

- [ ] **Step 2: Update the credential selection panel inside ProofRequestsTab**

In `ProofRequestsTab`, find the section that renders credential checkboxes (the `myCredentials.filter(...)` block inside the expanded panel). Replace the entire credential selection block with this two-section version:

```tsx
                    {/* Employee credentials */}
                    {myCredentials.filter((c: any) => !c.revoked).length > 0 && (
                      <div style={{ marginBottom: '0.75rem' }}>
                        <div style={{ fontSize: '0.75rem', fontWeight: 700, color: '#2563eb', marginBottom: '0.4rem' }}>
                          👤 Employee Wallet
                        </div>
                        <div style={{ display: 'grid', gap: '0.4rem' }}>
                          {myCredentials.filter((c: any) => !c.revoked).map((c: any) => {
                            const isChecked = (selected[r.id] || []).includes(c.id);
                            const isRequested = (r.required_credential_types || []).includes(c.credential_type);
                            return (
                              <label key={c.id} style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', cursor: 'pointer', padding: '0.5rem', borderRadius: 6, background: isChecked ? '#eff6ff' : '#f8fafc', border: `1px solid ${isChecked ? '#1a56db' : '#e2e8f0'}` }}>
                                <input type="checkbox" checked={isChecked} onChange={() => toggleCred(r.id, c.id)} />
                                <div style={{ flex: 1 }}>
                                  <span style={{ fontWeight: 600, fontSize: '0.875rem' }}>{c.credential_type}</span>
                                  {isRequested && <span style={{ marginLeft: 6, fontSize: '0.68rem', background: '#dcfce7', color: '#166534', padding: '1px 6px', borderRadius: 8 }}>Requested</span>}
                                  <div style={{ fontSize: '0.72rem', color: '#64748b' }}>Issued: {new Date(c.issued_at).toLocaleDateString()}</div>
                                </div>
                              </label>
                            );
                          })}
                        </div>
                      </div>
                    )}
                    {/* Corporate credentials */}
                    {corporateCredentials.filter((c: any) => !c.revoked).length > 0 && (
                      <div style={{ marginBottom: '0.75rem' }}>
                        <div style={{ fontSize: '0.75rem', fontWeight: 700, color: '#7c3aed', marginBottom: '0.4rem' }}>
                          🏢 Corporate Wallet
                        </div>
                        <div style={{ display: 'grid', gap: '0.4rem' }}>
                          {corporateCredentials.filter((c: any) => !c.revoked).map((c: any) => {
                            const isChecked = (selected[r.id] || []).includes(c.id);
                            const isRequested = (r.required_credential_types || []).includes(c.credential_type);
                            return (
                              <label key={c.id} style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', cursor: 'pointer', padding: '0.5rem', borderRadius: 6, background: isChecked ? '#faf5ff' : '#f8fafc', border: `1px solid ${isChecked ? '#7c3aed' : '#e2e8f0'}` }}>
                                <input type="checkbox" checked={isChecked} onChange={() => toggleCred(r.id, c.id)} />
                                <div style={{ flex: 1 }}>
                                  <span style={{ fontWeight: 600, fontSize: '0.875rem' }}>{c.credential_type}</span>
                                  {isRequested && <span style={{ marginLeft: 6, fontSize: '0.68rem', background: '#dcfce7', color: '#166534', padding: '1px 6px', borderRadius: 8 }}>Requested</span>}
                                  <div style={{ fontSize: '0.72rem', color: '#64748b' }}>
                                    Corporate credential · {new Date(c.issued_at).toLocaleDateString()}
                                  </div>
                                </div>
                              </label>
                            );
                          })}
                        </div>
                      </div>
                    )}
                    {myCredentials.length === 0 && corporateCredentials.length === 0 && (
                      <p style={{ color: '#888', fontSize: '0.85rem' }}>No credentials available to share.</p>
                    )}
```

- [ ] **Step 3: Load corporate credentials alongside proof requests**

In `loadAll()`, find the `proof-requests` branch and update it to also fetch corporate wallet:

```typescript
      } else if (tab === 'proof-requests') {
        const [prData, credData, corpData] = await Promise.all([
          api.getMyVerificationRequests(token),
          api.getMyCredentials(token),
          fetch('/api/holder/corporate-wallet', { headers: { Authorization: `Bearer ${token}` } }).then(r => r.json()),
        ]);
        setProofRequests(prData.requests || []);
        setCredentials(credData.credentials || []);
        setCorpWalletCredentials(corpData.credentials || []);
```

- [ ] **Step 4: Update the ProofRequestsTab call site**

Find where `<ProofRequestsTab` is rendered in the JSX and add the `corporateCredentials` prop:

```tsx
          {tab === 'proof-requests' && (
            <ProofRequestsTab
              proofRequests={proofRequests}
              myCredentials={credentials}
              corporateCredentials={corpWalletCredentials}
              token={token}
              onRefresh={loadAll}
            />
          )}
```

- [ ] **Step 5: Commit**

```bash
git add src/frontend/pages/CorporateDashboard.tsx
git commit -m "feat: show employee and corporate wallet credentials in proof request response"
```

---

## Task 11: VerifierDashboard — 3-step org → employee → credentials flow

**Files:**
- Modify: `src/frontend/pages/VerifierDashboard.tsx`

- [ ] **Step 1: Add state for 3-step flow**

In `VerifierDashboard`, find the existing state for the new request form (look for `empSearch`, `empResults`, `newReqHolderDid` etc.) and add/replace with:

```typescript
  // 3-step proof request form
  const [reqStep, setReqStep] = useState<1 | 2 | 3>(1);
  const [corpList, setCorpList] = useState<any[]>([]);
  const [selectedCorp, setSelectedCorp] = useState<any | null>(null);
  const [corpEmployees, setCorpEmployees] = useState<any[]>([]);
  const [empSearch, setEmpSearch] = useState('');
  const [selectedEmployee, setSelectedEmployee] = useState<any | null>(null);
  const [newReqHolderDid, setNewReqHolderDid] = useState('');
  const [newReqCredTypes, setNewReqCredTypes] = useState('');
  const [newReqPurpose, setNewReqPurpose] = useState('');
  const [newReqMsg, setNewReqMsg] = useState('');
  const [newReqLoading, setNewReqLoading] = useState(false);
```

- [ ] **Step 2: Add data loading functions**

After the existing `searchEmployees` function (or wherever request-related functions live), add:

```typescript
  async function loadCorporates() {
    if (!token) return;
    try {
      const r = await fetch('/api/verifier/corporates', { headers: { Authorization: `Bearer ${token}` } });
      const d = await r.json();
      setCorpList(d.corporates || []);
    } catch {}
  }

  async function loadCorpEmployees(orgId: string) {
    if (!token) return;
    try {
      const r = await fetch(`/api/verifier/corporates/${orgId}/employees`, { headers: { Authorization: `Bearer ${token}` } });
      const d = await r.json();
      setCorpEmployees(d.employees || []);
    } catch {}
  }

  async function handleSendProofRequest() {
    if (!selectedEmployee || !newReqCredTypes.trim()) {
      setNewReqMsg('Select an employee and specify at least one credential type');
      return;
    }
    setNewReqLoading(true);
    setNewReqMsg('');
    try {
      const credTypes = newReqCredTypes.split(',').map((s: string) => s.trim()).filter(Boolean);
      const r = await fetch('/api/verifier/request-proof', {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          holderDid: selectedEmployee.employee_did,
          requiredCredentialTypes: credTypes,
          purpose: newReqPurpose,
        }),
      });
      const d = await r.json();
      if (!r.ok) throw new Error(d.error);
      setNewReqMsg('✓ Proof request sent successfully');
      // Reset form
      setReqStep(1);
      setSelectedCorp(null);
      setCorpEmployees([]);
      setSelectedEmployee(null);
      setNewReqHolderDid('');
      setNewReqCredTypes('');
      setNewReqPurpose('');
    } catch (err: any) {
      setNewReqMsg(err.message);
    } finally {
      setNewReqLoading(false);
    }
  }
```

- [ ] **Step 3: Trigger corporate list load when new tab opens**

Find the `useEffect` that loads data when the active tab changes (or in `loadAll`) and add loading of corporates when the `new` tab is selected:

```typescript
  // Add inside the useEffect / loadData for tab === 'new':
  if (tab === 'new') {
    loadCorporates();
    setReqStep(1);
  }
```

- [ ] **Step 4: Replace the 'new' tab JSX with the 3-step form**

Find the `{tab === 'new' && (` block in the VerifierDashboard JSX and replace its content with:

```tsx
        {tab === 'new' && (
          <div style={{ maxWidth: 640 }}>
            <h3>New Proof Request</h3>
            <p style={{ color: '#666', fontSize: '0.9rem', marginBottom: '1.5rem' }}>
              Select a corporate organisation, pick an employee, then specify the credentials you need.
            </p>

            {/* Step indicators */}
            <div style={{ display: 'flex', gap: 0, marginBottom: '1.5rem' }}>
              {[1, 2, 3].map(s => (
                <div key={s} style={{ flex: 1, textAlign: 'center', padding: '8px 4px', fontSize: '0.75rem', fontWeight: 600,
                  background: reqStep === s ? '#2563eb' : reqStep > s ? '#dcfce7' : '#f1f5f9',
                  color: reqStep === s ? 'white' : reqStep > s ? '#16a34a' : '#94a3b8',
                  borderRadius: s === 1 ? '8px 0 0 8px' : s === 3 ? '0 8px 8px 0' : 0,
                  border: '1px solid #e2e8f0', borderLeft: s > 1 ? 'none' : '1px solid #e2e8f0' }}>
                  {reqStep > s ? '✓ ' : `${s}. `}
                  {s === 1 ? 'Select Org' : s === 2 ? 'Select Employee' : 'Send Request'}
                </div>
              ))}
            </div>

            {/* Step 1 — Select Corporate */}
            {reqStep === 1 && (
              <div className="card">
                <h4 style={{ marginTop: 0 }}>Select Corporate Organisation</h4>
                {corpList.length === 0 ? (
                  <p style={{ color: '#888', fontSize: '0.85rem' }}>No corporate organisations found.</p>
                ) : (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
                    {corpList.map((corp: any) => (
                      <div key={corp.id}
                        onClick={() => { setSelectedCorp(corp); loadCorpEmployees(corp.id); setReqStep(2); }}
                        style={{ padding: '12px', border: `2px solid ${selectedCorp?.id === corp.id ? '#2563eb' : '#e2e8f0'}`,
                          borderRadius: 8, cursor: 'pointer', background: selectedCorp?.id === corp.id ? '#eff6ff' : 'white' }}>
                        <div style={{ fontWeight: 700 }}>{corp.name}</div>
                        <div style={{ fontSize: '0.72rem', color: '#64748b', marginTop: 2 }}>
                          {corp.employee_count} employee(s) with portal access
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}

            {/* Step 2 — Select Employee */}
            {reqStep === 2 && selectedCorp && (
              <div className="card">
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.75rem' }}>
                  <h4 style={{ margin: 0 }}>Select Employee — {selectedCorp.name}</h4>
                  <button onClick={() => { setReqStep(1); setSelectedEmployee(null); }}
                    style={{ fontSize: '0.75rem', color: '#64748b', background: 'none', border: 'none', cursor: 'pointer' }}>
                    ← Back
                  </button>
                </div>
                <input
                  className="form-input"
                  placeholder="Filter by name or email..."
                  value={empSearch}
                  onChange={e => setEmpSearch(e.target.value)}
                  style={{ marginBottom: '0.75rem' }}
                />
                {corpEmployees.length === 0 ? (
                  <p style={{ color: '#888', fontSize: '0.85rem' }}>No employees with portal accounts found.</p>
                ) : (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
                    {corpEmployees
                      .filter((e: any) =>
                        !empSearch ||
                        e.name?.toLowerCase().includes(empSearch.toLowerCase()) ||
                        e.email?.toLowerCase().includes(empSearch.toLowerCase())
                      )
                      .map((emp: any) => (
                        <div key={emp.id}
                          onClick={() => { setSelectedEmployee(emp); setNewReqHolderDid(emp.employee_did); setReqStep(3); }}
                          style={{ padding: '12px', border: `2px solid ${selectedEmployee?.id === emp.id ? '#2563eb' : '#e2e8f0'}`,
                            borderRadius: 8, cursor: 'pointer', background: selectedEmployee?.id === emp.id ? '#eff6ff' : 'white' }}>
                          <div style={{ fontWeight: 700 }}>{emp.name}</div>
                          <div style={{ fontSize: '0.72rem', color: '#64748b', marginTop: 2 }}>{emp.email}</div>
                          <div style={{ fontSize: '0.65rem', color: '#94a3b8', marginTop: 2, fontFamily: 'monospace' }}>
                            {emp.employee_did ? emp.employee_did.slice(0, 60) + '…' : 'No DID'}
                          </div>
                        </div>
                      ))}
                  </div>
                )}
              </div>
            )}

            {/* Step 3 — Credential types + submit */}
            {reqStep === 3 && selectedEmployee && (
              <div className="card">
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.75rem' }}>
                  <h4 style={{ margin: 0 }}>Specify Credentials</h4>
                  <button onClick={() => { setReqStep(2); }}
                    style={{ fontSize: '0.75rem', color: '#64748b', background: 'none', border: 'none', cursor: 'pointer' }}>
                    ← Back
                  </button>
                </div>

                <div style={{ padding: '8px 12px', background: '#f0fdf4', borderRadius: 6, marginBottom: '1rem', fontSize: '0.78rem', color: '#374151' }}>
                  Sending to: <strong>{selectedEmployee.name}</strong> ({selectedEmployee.email}) at <strong>{selectedCorp?.name}</strong>
                </div>

                <div className="form-group">
                  <label style={{ fontWeight: 600 }}>Required Credential Types *</label>
                  <input
                    className="form-input"
                    placeholder="e.g. EmploymentCertificate, IECCredential"
                    value={newReqCredTypes}
                    onChange={e => setNewReqCredTypes(e.target.value)}
                  />
                  <div style={{ fontSize: '0.7rem', color: '#94a3b8', marginTop: 4 }}>
                    Comma-separated. Employee sees these highlighted in their wallet.
                  </div>
                </div>

                <div className="form-group">
                  <label style={{ fontWeight: 600 }}>Purpose / Note</label>
                  <input
                    className="form-input"
                    placeholder="e.g. KYC for trade finance application"
                    value={newReqPurpose}
                    onChange={e => setNewReqPurpose(e.target.value)}
                  />
                </div>

                {newReqMsg && (
                  <div style={{ marginBottom: '0.75rem', fontSize: '0.875rem', color: newReqMsg.startsWith('✓') ? '#276749' : '#dc3545' }}>
                    {newReqMsg}
                  </div>
                )}

                <button
                  className="btn btn-primary"
                  onClick={handleSendProofRequest}
                  disabled={newReqLoading}
                >
                  {newReqLoading ? 'Sending...' : 'Send Proof Request →'}
                </button>
              </div>
            )}
          </div>
        )}
```

- [ ] **Step 5: Commit**

```bash
git add src/frontend/pages/VerifierDashboard.tsx
git commit -m "feat: replace verifier employee search with 3-step org→employee→credentials flow"
```

---

## Task 12: Final integration test

- [ ] **Step 1: Restart server**

```bash
pkill -f "tsx src/server/index.ts" || true
DATABASE_URL="postgresql://didvc_user:didvc_pass@localhost:5433/didvc" \
  nohup npx tsx src/server/index.ts > /tmp/server.log 2>&1 &
sleep 2
grep -i "listening\|error" /tmp/server.log | head -5
```

Expected: `Server listening on port 3000` (no errors)

- [ ] **Step 2: Rebuild frontend**

```bash
cd /Users/kamleshnagware/did-vc-project
npm run build 2>&1 | tail -20
```

Expected: build completes with no TypeScript errors.

- [ ] **Step 3: End-to-end test — admin grants permissions**

1. Login as `fsvlabs@admin.com` / `Platform@123`
2. Go to **Employees** tab
3. Click "▼ Credential Sharing Permissions" on Priya Sharma
4. Check `IECCredential` → Save
5. Verify: success message appears

- [ ] **Step 4: End-to-end test — verifier sends request**

1. Login as `verifier@bank.com` / `Platform@123`
2. Go to **New Request** tab
3. Step 1: Select FSV Labs
4. Step 2: Select Priya Sharma
5. Step 3: Enter `EmploymentCertificate, IECCredential` → Send
6. Verify: success message

- [ ] **Step 5: End-to-end test — employee responds**

1. Login as `priya.sharma@fsvlabs.com` / `Platform@123`
2. Go to **My Wallets** → Corporate Wallet → see `IECCredential` with "CAN SHARE"
3. Go to **Proof Requests** → see new request from HDFC Bank
4. Click Share Credentials → see two sections (Employee Wallet + Corporate Wallet)
5. Select credentials → Submit → success

- [ ] **Step 6: End-to-end test — transactions tab**

1. Still as `priya.sharma@fsvlabs.com`
2. Go to **Transactions** → see both the inbound request and outbound presentation

- [ ] **Step 7: Final commit**

```bash
git add -A
git commit -m "feat: employee dual wallet, transactions tab, and 3-step verifier flow — complete"
```
