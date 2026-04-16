# Employee Dual Wallet & Transactions Design

**Date:** 2026-04-15  
**Status:** Approved  

---

## Overview

Enhance the corporate employee experience with:
1. **Verifier org-scoped request flow** — verifier picks corporate org → then picks a specific employee → sends proof request
2. **Dual wallet view** — employees see both their own (Employee Wallet) and the corporate's (Corporate Wallet) credentials, with admin-controlled sharing permissions
3. **Transactions tab** — unified timeline of inbound proof requests and outbound credential shares
4. **Admin permission management** — corporate admin assigns which corporate credential types each employee may share

---

## 1. Data Model

### New Table: `employee_credential_permissions`

```sql
CREATE TABLE IF NOT EXISTS employee_credential_permissions (
  id                   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  employee_registry_id UUID NOT NULL REFERENCES employee_registry(id) ON DELETE CASCADE,
  credential_type      VARCHAR(100) NOT NULL,
  granted_by           UUID NOT NULL REFERENCES users(id),
  created_at           TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE (employee_registry_id, credential_type)
);
CREATE INDEX IF NOT EXISTS idx_emp_cred_perms_registry ON employee_credential_permissions(employee_registry_id);
```

**Logic:** A row in this table means the employee is permitted to share that credential type from the corporate's DID wallet. No row = no access. The corporate admin (super_admin/admin sub_role) manages these rows.

---

## 2. API Changes

### 2a. New: GET `/api/verifier/corporates`
Returns all active corporate organisations (users with `role='corporate'` and `sub_role='super_admin'` with `org_id=id`), including their name, DID, and employee count.  
**Auth:** verifier role only.

### 2b. New: GET `/api/verifier/corporates/:orgId/employees`
Returns all employees of a given corporate org (from `employee_registry` where `org_id = :orgId`), including name, email, sub-DID string, and `user_id` (to show portal access status).  
**Auth:** verifier role only.

### 2c. Update: POST `/api/verifier/request-proof`
No change to payload — still accepts `holderDid` (employee sub-DID) and `requiredCredentialTypes`. The frontend now derives `holderDid` via the new org → employee picker instead of the old free-text search.

### 2d. New: GET `/api/corporate/employees/:employeeRegistryId/permissions`
Returns the list of credential types the employee is permitted to share from corporate wallet.  
**Auth:** corporate role; super_admin/admin sees all employees; employees can only query their own.

### 2e. New: POST `/api/corporate/employees/:employeeRegistryId/permissions`
Body: `{ credential_types: string[] }` — full replace (upsert/delete) of permission set.  
**Auth:** corporate super_admin or admin sub_role only.

### 2f. New: GET `/api/holder/corporate-wallet`
Returns corporate DID credentials filtered to only those types the calling employee has permission to share (via `employee_credential_permissions`).  
**Auth:** employee sub_role; looks up the employee's `employee_registry` row → fetches `employee_credential_permissions` → filters corporate DID credentials.

### 2g. New: GET `/api/holder/transactions`
Returns a unified timeline (newest first) combining:
- **Inbound:** `verification_requests` where `holder_did_id` = employee's sub-DID — shown as "Proof Request Received"
- **Outbound:** `presentations` where `holder_did_id` = employee's sub-DID — shown as "Presentation Submitted"

Each item includes: type, counterparty name, credential types involved, status, timestamp.  
**Auth:** employee sub_role.

---

## 3. Frontend Changes

### 3a. AppShell.tsx — corporate nav items (employee sub_role)

Add `transactions` tab for employee; rename `corp-wallet` to `my-wallets`:

```
employee sees:
  🏷 My Credentials    (credentials)
  🛡 Proof Requests    (proof-requests)
  💼 My Wallets        (my-wallets)     ← replaces corp-wallet
  🔄 Transactions      (transactions)   ← NEW
```

All other sub_roles continue to see the existing tabs (corp-wallet remains for non-employee sub_roles).

### 3b. CorporateDashboard.tsx — My Wallets tab (`my-wallets`)

Toggle between two sub-views:

**Employee Wallet:**  
- Loads from existing `GET /api/credentials/my` (employee sub-DID credentials)
- Cards show credential type, issuer, issued date, status badge

**Corporate Wallet:**  
- Loads from new `GET /api/holder/corporate-wallet`
- Cards show credential type, issuer, status; badge "CAN SHARE" (green) for all shown (already filtered)
- Info note: "Contact admin to change sharing permissions"
- If no permissions granted: empty state "No corporate credentials are currently authorized for sharing. Contact your admin."

### 3c. CorporateDashboard.tsx — Transactions tab (`transactions`)

- Loads from new `GET /api/holder/transactions`
- Unified timeline, newest first
- **Inbound (blue left border):** "📥 Proof Request Received" — verifier name, requested credential types, status pill (Pending / Submitted / Verified)
- **Outbound (green left border):** "📤 Presentation Submitted" — verifier name, credentials shared, whether from Employee or Corporate wallet, status pill
- Empty state: "No transactions yet"

### 3d. CorporateDashboard.tsx — Employees tab (admin permission management)

Below each employee card (visible to super_admin/admin only):
- Expandable "Credential Sharing Permissions" section
- Shows a row per corporate credential type currently held by the org DID
- Checkbox per type — checked = employee can share it from corporate wallet
- "Save Permissions" button → calls `POST /api/corporate/employees/:id/permissions`
- Loads current permissions from `GET /api/corporate/employees/:id/permissions` on expand

### 3e. VerifierDashboard.tsx — New Request tab (3-step flow)

Replace current free-text employee search with:

**Step 1 — Select Corporate Org:**  
- Dropdown populated from `GET /api/verifier/corporates`
- Shows org name, DID, employee count

**Step 2 — Select Employee:**  
- Search input + list loaded from `GET /api/verifier/corporates/:orgId/employees`
- Each row: name, email, sub-DID (truncated), click to select

**Step 3 — Credential Types + Submit:**  
- Checkboxes for credential types (free text + common presets)
- Purpose/note textarea
- Confirmation: "Request will be sent to [Employee Name]'s dashboard"
- Submit → existing `POST /api/verifier/request-proof`

---

## 4. Proof Request Response Flow (Employee)

When an employee responds to a proof request (existing Proof Requests tab):

1. Employee sees required credential types
2. Credentials panel shows **two sections**: Employee Wallet matches + Corporate Wallet matches (filtered by permissions)
3. Employee selects credentials from either/both wallets and submits VP
4. `POST /api/presentations/compose` — no change to payload; the backend already handles employee sub-DID signing

---

## 5. Security Constraints

- Employees can only view/share corporate credentials they have explicit `employee_credential_permissions` rows for
- `GET /api/holder/corporate-wallet` enforces this server-side — never relies on frontend filtering
- Admin permission updates are guarded by `sub_role IN ('super_admin', 'admin')` check
- Verifier endpoints (`/api/verifier/corporates`, `/api/verifier/corporates/:orgId/employees`) only return active portal users (employees with `user_id IS NOT NULL` in `employee_registry`)

---

## 6. Files to Modify

| File | Change |
|------|--------|
| `src/db/schema.sql` | Add `employee_credential_permissions` table |
| `src/server/index.ts` | 5 new endpoints (2g–2g), update nav logic |
| `src/frontend/components/AppShell.tsx` | Add `transactions` tab, rename `corp-wallet` → `my-wallets` for employee |
| `src/frontend/pages/CorporateDashboard.tsx` | New Wallets tab, Transactions tab, Employee permissions UI |
| `src/frontend/pages/VerifierDashboard.tsx` | Replace employee search with 3-step org → employee → credentials flow |
