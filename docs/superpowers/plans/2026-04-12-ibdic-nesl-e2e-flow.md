# IBDIC + NeSL Onboarding & E2E Demo Flow — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add IBDIC (DID Issuer) and NeSL (VC Issuer) with proper person names for all entity users, then run a complete E2E demo using XYZ Private Limited requesting credentials from IBDIC and NeSL, followed by SBI verifying via Verifiable Presentation.

**Architecture:**  
IBDIC and NeSL already exist as active platform entities in the DB (from the seed script). The gaps are: (a) maker/checker names are machine-generated org strings instead of real person names, (b) the frontend VC-request dropdown doesn't include IBDIC/NeSL credential types, (c) the server `credTypeEntityMap` doesn't route to IBDIC/NeSL specifically, and (d) no E2E demo transaction has been run for XYZ + IBDIC/NeSL + SBI.

**Tech Stack:** PostgreSQL (direct SQL updates), TypeScript/React (frontend), Node/Express (server), Hyperledger Besu (local blockchain at localhost:8545)

---

## File Map

| File | Change |
|------|--------|
| `src/db/seed.ts` | Update `createIssuerTeam` / entity names to use proper person names |
| `src/frontend/pages/CorporateDashboard.tsx` | Add IBDICDigitalIdentityCredential + NESLBusinessRegistrationCredential to dropdown; update info panel |
| `src/server/index.ts` | Extend `credTypeEntityMap` with IBDIC/NeSL types; update routing to resolve specific entity by name |
| *(no new files)* | All changes are edits to existing files |

---

## Task 1 — Update All Maker/Checker Names to Proper Person Names

Update the `name` column in `users` for all maker and checker accounts across every entity.

**Files:** DB (via node -e SQL command)

**Person name assignments:**

| Email | New Name |
|-------|----------|
| pm-maker@didvc.in | Rahul Sharma |
| pm-checker@didvc.in | Priya Singh |
| maker@dgft.gov.in | Amit Verma |
| checker@dgft.gov.in | Sunita Devi |
| maker@ibdic.org.in | Rajesh Kumar |
| checker@ibdic.org.in | Meera Nair |
| maker@nesl.co.in | Vikram Patel |
| checker@nesl.co.in | Rekha Gupta |
| maker@protean.co.in | Aditya Rao |
| checker@protean.co.in | Kavita Sharma |
| maker@xyz.co.in | Suresh Shah |
| checker@xyz.co.in | Ananya Joshi |
| maker-v@sbi.co.in | Ramesh Kumar |
| checker-v@sbi.co.in | Deepa Pillai |

Also update admin display names:
| Email | New Name |
|-------|----------|
| admin@dgft.gov.in | DGFT — Directorate General of Foreign Trade |
| admin@ibdic.org.in | IBDIC — Indian Blockchain DID Council |
| admin@nesl.co.in | NeSL — National e-Governance Services Ltd |
| admin@protean.co.in | Protean eGov Technologies |
| admin@xyz.co.in | XYZ Private Limited |
| verifier@sbi.co.in | State Bank of India (SBI) |
| portal@test.com | DID-VC Portal Manager |

- [ ] **Step 1.1 — Run SQL name updates**

```bash
node -e "
const { Pool } = require('pg');
const pool = new Pool({ connectionString: 'postgresql://localhost:5432/didvc' });
const updates = [
  ['pm-maker@didvc.in',       'Rahul Sharma'],
  ['pm-checker@didvc.in',     'Priya Singh'],
  ['maker@dgft.gov.in',       'Amit Verma'],
  ['checker@dgft.gov.in',     'Sunita Devi'],
  ['maker@ibdic.org.in',      'Rajesh Kumar'],
  ['checker@ibdic.org.in',    'Meera Nair'],
  ['maker@nesl.co.in',        'Vikram Patel'],
  ['checker@nesl.co.in',      'Rekha Gupta'],
  ['maker@protean.co.in',     'Aditya Rao'],
  ['checker@protean.co.in',   'Kavita Sharma'],
  ['maker@xyz.co.in',         'Suresh Shah'],
  ['checker@xyz.co.in',       'Ananya Joshi'],
  ['maker-v@sbi.co.in',       'Ramesh Kumar'],
  ['checker-v@sbi.co.in',     'Deepa Pillai'],
  ['admin@dgft.gov.in',       'DGFT — Directorate General of Foreign Trade'],
  ['admin@ibdic.org.in',      'IBDIC — Indian Blockchain DID Council'],
  ['admin@nesl.co.in',        'NeSL — National e-Governance Services Ltd'],
  ['admin@protean.co.in',     'Protean eGov Technologies'],
  ['admin@xyz.co.in',         'XYZ Private Limited'],
  ['verifier@sbi.co.in',      'State Bank of India (SBI)'],
  ['portal@test.com',         'DID-VC Portal Manager'],
];
Promise.all(updates.map(([email, name]) =>
  pool.query('UPDATE users SET name = \$1 WHERE email = \$2', [name, email])
)).then(() => { console.log('All names updated'); pool.end(); }).catch(e => { console.error(e.message); pool.end(); });
"
```

Expected output: `All names updated`

Also sync the `platform_entities.name` column to match:

```bash
node -e "
const { Pool } = require('pg');
const pool = new Pool({ connectionString: 'postgresql://localhost:5432/didvc' });
const updates = [
  ['admin@dgft.gov.in',   'DGFT — Directorate General of Foreign Trade'],
  ['admin@ibdic.org.in',  'IBDIC — Indian Blockchain DID Council'],
  ['admin@nesl.co.in',    'NeSL — National e-Governance Services Ltd'],
  ['admin@protean.co.in', 'Protean eGov Technologies'],
];
Promise.all(updates.map(([email, name]) =>
  pool.query('UPDATE platform_entities SET name = \$1 WHERE email = \$2', [name, email])
)).then(() => { console.log('platform_entities names updated'); pool.end(); }).catch(e => { console.error(e.message); pool.end(); });
"
```

Also update `seed.ts` so re-runs produce proper names:

- [ ] **Step 1.2 — Update seed.ts `createIssuerTeam` to use person names**

In `src/db/seed.ts`, replace the generic `orgName + ' Maker'` / `orgName + ' Checker'` pattern with a name map:

```typescript
// Add this map above main()
const TEAM_NAMES: Record<string, { maker: string; checker: string }> = {
  'dgft.gov.in':    { maker: 'Amit Verma',    checker: 'Sunita Devi' },
  'ibdic.org.in':   { maker: 'Rajesh Kumar',  checker: 'Meera Nair' },
  'nesl.co.in':     { maker: 'Vikram Patel',  checker: 'Rekha Gupta' },
  'protean.co.in':  { maker: 'Aditya Rao',    checker: 'Kavita Sharma' },
};

// Replace createIssuerTeam function body:
async function createIssuerTeam(adminUserId: string, domain: string): Promise<void> {
  const makerEmail = `maker@${domain}`;
  const checkerEmail = `checker@${domain}`;
  const names = TEAM_NAMES[domain] || { maker: domain + ' Maker', checker: domain + ' Checker' };
  await createUser(makerEmail, names.maker, 'government_agency', { sub_role: 'maker', org_id: adminUserId });
  await createUser(checkerEmail, names.checker, 'government_agency', { sub_role: 'checker', org_id: adminUserId });
}
```

Also update Portal Manager team names in `main()`:
```typescript
const pmMakerId = await createUser('pm-maker@didvc.in', 'Rahul Sharma', 'portal_manager', { sub_role: 'maker' });
const pmCheckerId = await createUser('pm-checker@didvc.in', 'Priya Singh', 'portal_manager', { sub_role: 'checker' });
```

And entity display names:
```typescript
const dgftId = await ensureEntity('DGFT — Directorate General of Foreign Trade', 'admin@dgft.gov.in', 'did_issuer', ...);
const ibdicId = await ensureEntity('IBDIC — Indian Blockchain DID Council', 'admin@ibdic.org.in', 'did_issuer', ...);
const neslId  = await ensureEntity('NeSL — National e-Governance Services Ltd', 'admin@nesl.co.in', 'vc_issuer', ...);
const proteanId = await ensureEntity('Protean eGov Technologies', 'admin@protean.co.in', 'trust_endorser', ...);
```

And for `createCorporateOrg('XYZ Private Limited', ...)` update maker/checker names:
```typescript
await createUser(makerEmail, 'Suresh Shah', 'corporate', { sub_role: 'maker', org_id: adminId });
await createUser(checkerEmail, 'Ananya Joshi', 'corporate', { sub_role: 'checker', org_id: adminId });
```

And `createVerifierOrg` for SBI:
```typescript
await createUser(makerEmail, 'Ramesh Kumar', 'verifier', { sub_role: 'maker', org_id: adminId });
await createUser(checkerEmail, 'Deepa Pillai', 'verifier', { sub_role: 'checker', org_id: adminId });
```

- [ ] **Step 1.3 — Verify names in DB**

```bash
node -e "
const { Pool } = require('pg');
const pool = new Pool({ connectionString: 'postgresql://localhost:5432/didvc' });
pool.query('SELECT email, name, role, sub_role FROM users WHERE sub_role IN (\\'maker\\', \\'checker\\') ORDER BY role, email').then(r => { r.rows.forEach(row => console.log(row.sub_role.padEnd(8), row.email.padEnd(30), row.name)); pool.end(); }).catch(e => { console.error(e.message); pool.end(); });
"
```

Expected: 14 rows, each with a human name.

---

## Task 2 — Add IBDIC + NeSL Credential Types to Frontend Dropdown

**File:** `src/frontend/pages/CorporateDashboard.tsx`

- [ ] **Step 2.1 — Add credential type options to the Issue & Request form**

Find the `<select>` for `credentialType` (around line 401–412). Replace it with:

```tsx
<select className="form-input" value={vcReqForm.credentialType}
  onChange={e => setVcReqForm(f => ({ ...f, credentialType: e.target.value, issuerUserId: '' }))}>
  <optgroup label="Company Identity (DID Issuer)">
    <option value="CompanyRegistrationCredential">Company Registration (MCA)</option>
    <option value="IECCredential">Importer-Exporter Code / IEC (DGFT)</option>
    <option value="DGFTExportLicense">DGFT Export License</option>
    <option value="IBDICDigitalIdentityCredential">Digital Identity Credential (IBDIC)</option>
  </optgroup>
  <optgroup label="Business &amp; Compliance (VC Issuer)">
    <option value="NESLBusinessRegistrationCredential">Business Registration (NeSL)</option>
    <option value="GSTINCredential">GSTIN Certificate (GSTN)</option>
  </optgroup>
  <optgroup label="Tax &amp; Endorsement (Trust Endorser)">
    <option value="PANCredential">PAN Credential (Protean)</option>
  </optgroup>
</select>
```

- [ ] **Step 2.2 — Update the info panel routing hint**

Find the info panel text (around line 391–394):
```tsx
<strong style={{ color: '#334155' }}>Issuer routing:</strong>
{' '}Company Registration / IEC → DID Issuer &nbsp;·&nbsp;
GSTIN → VC Issuer &nbsp;·&nbsp;
PAN → Trust Endorser
```

Replace with:
```tsx
<strong style={{ color: '#334155' }}>Issuer routing:</strong>
{' '}Company / IEC / IBDIC Identity → <strong>DID Issuer</strong> (DGFT · IBDIC) &nbsp;·&nbsp;
NeSL Business / GSTIN → <strong>VC Issuer</strong> (NeSL · GSTN) &nbsp;·&nbsp;
PAN → <strong>Trust Endorser</strong> (Protean)
```

- [ ] **Step 2.3 — Add request data placeholders for new credential types**

Find the `placeholder` prop on the `<textarea>` (around line 429–439). Extend the ternary chain to add:

```tsx
placeholder={
  vcReqForm.credentialType === 'CompanyRegistrationCredential'
    ? '{\n  "cin": "U12345MH2020PLC123456",\n  "companyName": "XYZ Pvt Ltd"\n}'
  : vcReqForm.credentialType === 'IBDICDigitalIdentityCredential'
    ? '{\n  "entityName": "XYZ Private Limited",\n  "cin": "U12345MH2000PTC123456",\n  "category": "Private Limited"\n}'
  : vcReqForm.credentialType === 'NESLBusinessRegistrationCredential'
    ? '{\n  "companyName": "XYZ Private Limited",\n  "registrationNumber": "U12345MH2000PTC123456",\n  "jurisdiction": "Maharashtra"\n}'
  : vcReqForm.credentialType === 'GSTINCredential'
    ? '{\n  "gstin": "27ABCDE1234F1Z5",\n  "legalName": "XYZ Pvt Ltd"\n}'
  : vcReqForm.credentialType === 'PANCredential'
    ? '{\n  "pan": "ABCDE1234F",\n  "name": "XYZ Pvt Ltd"\n}'
  : vcReqForm.credentialType === 'IECCredential'
    ? '{\n  "ieCode": "0000000",\n  "exporterName": "XYZ Pvt Ltd"\n}'
  : '{\n  "companyName": "XYZ Pvt Ltd",\n  "address": "Mumbai, Maharashtra"\n}'
}
```

---

## Task 3 — Update Server CredType Routing for IBDIC/NeSL

**File:** `src/server/index.ts`  
**Location:** `POST /api/vc-requests` handler, `credTypeEntityMap` block (~line 376)

The current map routes by `entity_type` and picks the first active entity of that type (LIMIT 1). Since there are two DID issuers (DGFT and IBDIC), we need name-based routing for the new types.

- [ ] **Step 3.1 — Extend credTypeEntityMap and add name-based entity resolution**

Find this block:
```typescript
const credTypeEntityMap: Record<string, string> = {
  CompanyRegistrationCredential: 'did_issuer',
  IECCredential:                 'did_issuer',
  DGFTExportLicense:             'did_issuer',
  MCARegistration:               'did_issuer',
  IECode:                        'did_issuer',

  GSTCertificate:                'vc_issuer',
  PANCredential:                 'trust_endorser',
};
let issuerUserId = targetIssuerId || null;
if (!issuerUserId) {
  const entityType = credTypeEntityMap[credentialType];
  if (entityType) {
    const entityResult = await query(
      `SELECT user_id FROM platform_entities WHERE entity_type = $1 AND status = 'active' LIMIT 1`,
      [entityType]
    );
    issuerUserId = entityResult.rows[0]?.user_id || null;
  }
}
```

Replace with:
```typescript
// Map credential type → specific entity name (takes priority over entity_type routing)
const credTypeEntityNameMap: Record<string, string> = {
  IBDICDigitalIdentityCredential:    'IBDIC — Indian Blockchain DID Council',
  NESLBusinessRegistrationCredential:'NeSL — National e-Governance Services Ltd',
};
// Map credential type → entity_type (fallback for types without a named entity)
const credTypeEntityMap: Record<string, string> = {
  CompanyRegistrationCredential: 'did_issuer',
  IECCredential:                 'did_issuer',
  DGFTExportLicense:             'did_issuer',
  MCARegistration:               'did_issuer',
  IECode:                        'did_issuer',
  GSTINCredential:               'vc_issuer',
  GSTCertificate:                'vc_issuer',
  PANCredential:                 'trust_endorser',
};
let issuerUserId = targetIssuerId || null;
if (!issuerUserId) {
  const namedEntity = credTypeEntityNameMap[credentialType];
  if (namedEntity) {
    const entityResult = await query(
      `SELECT user_id FROM platform_entities WHERE name = $1 AND status = 'active' LIMIT 1`,
      [namedEntity]
    );
    issuerUserId = entityResult.rows[0]?.user_id || null;
  } else {
    const entityType = credTypeEntityMap[credentialType];
    if (entityType) {
      const entityResult = await query(
        `SELECT user_id FROM platform_entities WHERE entity_type = $1 AND status = 'active' LIMIT 1`,
        [entityType]
      );
      issuerUserId = entityResult.rows[0]?.user_id || null;
    }
  }
}
```

---

## Task 4 — Run E2E Demo: XYZ → IBDIC → NeSL → SBI VP Verification

This task is executed via API calls (using `node -e` / `curl` style commands through Node). The flow:

```
XYZ Maker submits IBDIC credential request
  → IBDIC Maker forwards to checker (mc_actions)
    → IBDIC Checker approves → IBDICDigitalIdentityCredential issued + Besu anchored
XYZ Maker submits NeSL credential request
  → NeSL Maker forwards to checker
    → NeSL Checker approves → NESLBusinessRegistrationCredential issued + Besu anchored
SBI Maker creates proof request targeting XYZ's DID
XYZ Super Admin composes VP (selects IBDIC + NeSL credentials)
  → submits VP → SBI sees submission
    → SBI Checker approves presentation → verification complete
```

**All passwords:** `Platform@123`

- [ ] **Step 4.1 — Fetch entity user IDs needed for routing**

```bash
node -e "
const { Pool } = require('pg');
const pool = new Pool({ connectionString: 'postgresql://localhost:5432/didvc' });
pool.query(\`
  SELECT u.email, u.id, u.name, pe.name as entity_name, pe.entity_type
  FROM users u JOIN platform_entities pe ON pe.user_id = u.id
  WHERE u.sub_role = 'super_admin'
  ORDER BY pe.entity_type, u.email
\`).then(r => { r.rows.forEach(row => console.log(row.entity_type.padEnd(15), row.email.padEnd(30), row.id)); pool.end(); }).catch(e => { console.error(e.message); pool.end(); });
"
```

Save the IBDIC and NeSL user IDs for the next steps.

Also get XYZ's DID:
```bash
node -e "
const { Pool } = require('pg');
const pool = new Pool({ connectionString: 'postgresql://localhost:5432/didvc' });
pool.query(\`SELECT d.did_string, u.email FROM dids d JOIN users u ON u.id = d.user_id WHERE u.email = 'admin@xyz.co.in' AND d.did_type = 'parent'\`).then(r => { console.log(r.rows); pool.end(); }).catch(e => { console.error(e.message); pool.end(); });
"
```

- [ ] **Step 4.2 — XYZ Admin requests IBDICDigitalIdentityCredential**

```bash
node -e "
const http = require('http');
const BASE = 'http://localhost:3000';

async function req(method, path, body, token) {
  return new Promise((resolve, reject) => {
    const payload = JSON.stringify(body);
    const opts = {
      hostname: 'localhost', port: 3000, path,
      method, headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(payload), ...(token ? { Authorization: 'Bearer ' + token } : {}) }
    };
    const r = http.request(opts, res => {
      let d = ''; res.on('data', c => d += c); res.on('end', () => resolve({ status: res.statusCode, body: JSON.parse(d) }));
    });
    r.on('error', reject); r.write(payload); r.end();
  });
}

async function main() {
  // Login XYZ admin
  const login = await req('POST', '/api/auth/login', { email: 'admin@xyz.co.in', password: 'Platform@123' });
  const token = login.body.token;
  console.log('XYZ Admin logged in:', login.status, login.body.user?.name);

  // Submit IBDIC credential request
  const vcReq = await req('POST', '/api/vc-requests', {
    credentialType: 'IBDICDigitalIdentityCredential',
    requestData: { entityName: 'XYZ Private Limited', cin: 'U12345MH2000PTC123456', category: 'Private Limited' }
  }, token);
  console.log('VC Request (IBDIC):', vcReq.status, JSON.stringify(vcReq.body));
}
main().catch(console.error);
"
```

Expected: status 200/201, body contains `{ id: '...', credential_type: 'IBDICDigitalIdentityCredential' }`

Note the `vc_request_id` for Step 4.3.

- [ ] **Step 4.3 — IBDIC Maker submits to checker queue**

```bash
node -e "
const http = require('http');
async function req(method, path, body, token) {
  return new Promise((resolve, reject) => {
    const payload = JSON.stringify(body);
    const opts = { hostname: 'localhost', port: 3000, path, method, headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(payload), ...(token ? { Authorization: 'Bearer ' + token } : {}) } };
    const r = http.request(opts, res => { let d = ''; res.on('data', c => d += c); res.on('end', () => resolve({ status: res.statusCode, body: JSON.parse(d) })); });
    r.on('error', reject); r.write(payload); r.end();
  });
}

async function main() {
  // Login IBDIC maker
  const login = await req('POST', '/api/auth/login', { email: 'maker@ibdic.org.in', password: 'Platform@123' });
  const token = login.body.token;
  console.log('IBDIC Maker logged in:', login.body.user?.name);

  // Get pending VC requests for IBDIC
  const pending = await req('GET', '/api/vc-requests/pending', {}, token);
  console.log('Pending requests:', JSON.stringify(pending.body));

  if (pending.body.requests?.length > 0) {
    const vcReqId = pending.body.requests[0].id;
    // Forward to checker via mc_actions
    const forward = await req('POST', '/api/mc/submit', {
      resource_type: 'vc_request_approval',
      resource_id: vcReqId,
      payload: { note: 'IBDIC Digital Identity — XYZ Pvt Ltd verified' }
    }, token);
    console.log('Forwarded to checker:', forward.status, JSON.stringify(forward.body));
  }
}
main().catch(console.error);
"
```

Expected: status 200, `{ actionId: '...' }`

- [ ] **Step 4.4 — IBDIC Checker approves → credential issued + Besu anchored**

```bash
node -e "
const http = require('http');
async function req(method, path, body, token) {
  return new Promise((resolve, reject) => {
    const payload = JSON.stringify(body);
    const opts = { hostname: 'localhost', port: 3000, path, method, headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(payload), ...(token ? { Authorization: 'Bearer ' + token } : {}) } };
    const r = http.request(opts, res => { let d = ''; res.on('data', c => d += c); res.on('end', () => resolve({ status: res.statusCode, body: JSON.parse(d) })); });
    r.on('error', reject); r.write(payload); r.end();
  });
}

async function main() {
  const login = await req('POST', '/api/auth/login', { email: 'checker@ibdic.org.in', password: 'Platform@123' });
  const token = login.body.token;
  console.log('IBDIC Checker logged in:', login.body.user?.name);

  const queue = await req('GET', '/api/mc/queue', {}, token);
  console.log('Checker queue:', JSON.stringify(queue.body));

  if (queue.body.actions?.length > 0) {
    const actionId = queue.body.actions[0].id;
    const approve = await req('POST', '/api/mc/' + actionId + '/approve', { note: 'Approved by IBDIC checker' }, token);
    console.log('Approved:', approve.status, JSON.stringify(approve.body));
  }
}
main().catch(console.error);
"
```

Expected: status 200, body contains `credential` with `polygon_block_number` (Besu anchor).

- [ ] **Step 4.5 — XYZ Admin requests NESLBusinessRegistrationCredential**

```bash
node -e "
const http = require('http');
async function req(method, path, body, token) {
  return new Promise((resolve, reject) => {
    const payload = JSON.stringify(body);
    const opts = { hostname: 'localhost', port: 3000, path, method, headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(payload), ...(token ? { Authorization: 'Bearer ' + token } : {}) } };
    const r = http.request(opts, res => { let d = ''; res.on('data', c => d += c); res.on('end', () => resolve({ status: res.statusCode, body: JSON.parse(d) })); });
    r.on('error', reject); r.write(payload); r.end();
  });
}

async function main() {
  const login = await req('POST', '/api/auth/login', { email: 'admin@xyz.co.in', password: 'Platform@123' });
  const token = login.body.token;

  const vcReq = await req('POST', '/api/vc-requests', {
    credentialType: 'NESLBusinessRegistrationCredential',
    requestData: { companyName: 'XYZ Private Limited', registrationNumber: 'U12345MH2000PTC123456', jurisdiction: 'Maharashtra' }
  }, token);
  console.log('VC Request (NeSL):', vcReq.status, JSON.stringify(vcReq.body));
}
main().catch(console.error);
"
```

- [ ] **Step 4.6 — NeSL Maker → Checker flow (same pattern as IBDIC)**

Login as `maker@nesl.co.in`, fetch pending, submit to mc. Then login as `checker@nesl.co.in`, fetch queue, approve.

```bash
node -e "
const http = require('http');
async function req(method, path, body, token) {
  return new Promise((resolve, reject) => {
    const payload = JSON.stringify(body);
    const opts = { hostname: 'localhost', port: 3000, path, method, headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(payload), ...(token ? { Authorization: 'Bearer ' + token } : {}) } };
    const r = http.request(opts, res => { let d = ''; res.on('data', c => d += c); res.on('end', () => resolve({ status: res.statusCode, body: JSON.parse(d) })); });
    r.on('error', reject); r.write(payload); r.end();
  });
}

async function main() {
  // --- NeSL Maker ---
  const makerLogin = await req('POST', '/api/auth/login', { email: 'maker@nesl.co.in', password: 'Platform@123' });
  const makerToken = makerLogin.body.token;
  console.log('NeSL Maker logged in:', makerLogin.body.user?.name);

  const pending = await req('GET', '/api/vc-requests/pending', {}, makerToken);
  console.log('Pending:', JSON.stringify(pending.body));

  if (pending.body.requests?.length > 0) {
    const vcReqId = pending.body.requests[0].id;
    const forward = await req('POST', '/api/mc/submit', {
      resource_type: 'vc_request_approval',
      resource_id: vcReqId,
      payload: { note: 'NeSL Business Registration — XYZ verified' }
    }, makerToken);
    console.log('NeSL Maker forwarded:', forward.status, JSON.stringify(forward.body));
  }

  // --- NeSL Checker ---
  const checkerLogin = await req('POST', '/api/auth/login', { email: 'checker@nesl.co.in', password: 'Platform@123' });
  const checkerToken = checkerLogin.body.token;
  console.log('NeSL Checker logged in:', checkerLogin.body.user?.name);

  const queue = await req('GET', '/api/mc/queue', {}, checkerToken);
  console.log('Checker queue:', JSON.stringify(queue.body));

  if (queue.body.actions?.length > 0) {
    const actionId = queue.body.actions[0].id;
    const approve = await req('POST', '/api/mc/' + actionId + '/approve', { note: 'NeSL Business Registration approved' }, checkerToken);
    console.log('NeSL Checker approved:', approve.status, JSON.stringify(approve.body));
  }
}
main().catch(console.error);
"
```

Expected: both credentials issued, each with Besu `polygon_block_number`.

- [ ] **Step 4.7 — SBI Maker creates proof request targeting XYZ's DID**

```bash
node -e "
const http = require('http');
async function req(method, path, body, token) {
  return new Promise((resolve, reject) => {
    const payload = JSON.stringify(body);
    const opts = { hostname: 'localhost', port: 3000, path, method, headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(payload), ...(token ? { Authorization: 'Bearer ' + token } : {}) } };
    const r = http.request(opts, res => { let d = ''; res.on('data', c => d += c); res.on('end', () => resolve({ status: res.statusCode, body: JSON.parse(d) })); });
    r.on('error', reject); r.write(payload); r.end();
  });
}

async function main() {
  const login = await req('POST', '/api/auth/login', { email: 'maker-v@sbi.co.in', password: 'Platform@123' });
  const token = login.body.token;
  console.log('SBI Maker logged in:', login.body.user?.name);

  // XYZ's DID
  const xyzDid = 'did:web:didvc.platform:xyz-private-limited';

  const proofReq = await req('POST', '/api/verifier/proof-requests', {
    holder_did: xyzDid,
    required_credential_types: ['IBDICDigitalIdentityCredential', 'NESLBusinessRegistrationCredential'],
    challenge: 'sbi-kyb-challenge-' + Date.now(),
    note: 'SBI — Know Your Business verification for XYZ Pvt Ltd'
  }, token);
  console.log('Proof request created:', proofReq.status, JSON.stringify(proofReq.body));
}
main().catch(console.error);
"
```

- [ ] **Step 4.8 — XYZ Admin composes and submits VP**

```bash
node -e "
const http = require('http');
async function req(method, path, body, token) {
  return new Promise((resolve, reject) => {
    const payload = JSON.stringify(body);
    const opts = { hostname: 'localhost', port: 3000, path, method, headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(payload), ...(token ? { Authorization: 'Bearer ' + token } : {}) } };
    const r = http.request(opts, res => { let d = ''; res.on('data', c => d += c); res.on('end', () => resolve({ status: res.statusCode, body: JSON.parse(d) })); });
    r.on('error', reject); r.write(payload); r.end();
  });
}

async function main() {
  const login = await req('POST', '/api/auth/login', { email: 'admin@xyz.co.in', password: 'Platform@123' });
  const token = login.body.token;

  // Get proof requests
  const proofReqs = await req('GET', '/api/holder/verification-requests', {}, token);
  console.log('Proof requests for XYZ:', JSON.stringify(proofReqs.body));

  // Get XYZ credentials
  const creds = await req('GET', '/api/credentials/my', {}, token);
  console.log('XYZ credentials:', creds.body.credentials?.map((c) => c.credential_type));

  // Find IBDIC + NeSL credential IDs
  const ibdic = creds.body.credentials?.find(c => c.credential_type === 'IBDICDigitalIdentityCredential');
  const nesl  = creds.body.credentials?.find(c => c.credential_type === 'NESLBusinessRegistrationCredential');
  console.log('IBDIC cred id:', ibdic?.id, '| NeSL cred id:', nesl?.id);

  if (!ibdic || !nesl) { console.error('Missing credentials!'); return; }

  const proofReqList = proofReqs.body.requests || proofReqs.body;
  const pendingReq = Array.isArray(proofReqList) ? proofReqList.find(r => r.status === 'pending') : null;
  if (!pendingReq) { console.log('No pending proof request found'); return; }

  // Compose and submit VP
  const vpSubmit = await req('POST', '/api/holder/present', {
    verification_request_id: pendingReq.id,
    credential_ids: [ibdic.id, nesl.id],
    disclosed_fields: {}
  }, token);
  console.log('VP submitted:', vpSubmit.status, JSON.stringify(vpSubmit.body));
}
main().catch(console.error);
"
```

- [ ] **Step 4.9 — SBI Checker approves presentation**

```bash
node -e "
const http = require('http');
async function req(method, path, body, token) {
  return new Promise((resolve, reject) => {
    const payload = JSON.stringify(body);
    const opts = { hostname: 'localhost', port: 3000, path, method, headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(payload), ...(token ? { Authorization: 'Bearer ' + token } : {}) } };
    const r = http.request(opts, res => { let d = ''; res.on('data', c => d += c); res.on('end', () => resolve({ status: res.statusCode, body: JSON.parse(d) })); });
    r.on('error', reject); r.write(payload); r.end();
  });
}

async function main() {
  const login = await req('POST', '/api/auth/login', { email: 'checker-v@sbi.co.in', password: 'Platform@123' });
  const token = login.body.token;
  console.log('SBI Checker logged in:', login.body.user?.name);

  const queue = await req('GET', '/api/verifier/presentations', {}, token);
  console.log('Presentations:', JSON.stringify(queue.body));

  const submitted = (queue.body.presentations || queue.body)?.find(p => p.status === 'submitted' || p.vp_json);
  if (!submitted) { console.log('No submitted presentation found'); return; }

  const approve = await req('POST', '/api/verifier/presentations/' + submitted.id + '/approve', {
    note: 'KYB verification complete for XYZ Pvt Ltd by SBI'
  }, token);
  console.log('SBI Checker approved VP:', approve.status, JSON.stringify(approve.body));
}
main().catch(console.error);
"
```

Expected: VP approved, `status: 'approved'`, on-chain verification recorded.

---

## Task 5 — Verify Results in UI

- [ ] **Step 5.1 — Login as XYZ Admin in browser, check My Credentials tab**

Navigate to http://localhost:3000, login as `admin@xyz.co.in / Platform@123`.
Go to **My Credentials** tab — should show:
- IBDICDigitalIdentityCredential ✓ (with Besu block number)
- NESLBusinessRegistrationCredential ✓ (with Besu block number)

- [ ] **Step 5.2 — Check Portal Manager Entity Registry**

Login as `portal@test.com / Platform@123`.
Go to **Platform Entities** tab — should show:
- IBDIC — Indian Blockchain DID Council [DID Issuer] Active
- NeSL — National e-Governance Services Ltd [VC Issuer] Active
- DGFT — Directorate General of Foreign Trade [DID Issuer] Active
- Protean eGov Technologies [Trust Endorser] Active

- [ ] **Step 5.3 — Check SBI Verifier approved presentations**

Login as `verifier@sbi.co.in / Platform@123`.
Go to **Presentations** tab — XYZ's VP should show status: **Approved**.

---

## Complete Credentials Reference

All accounts use password: **`Platform@123`**

### Portal Manager
| Role | Email | Name |
|------|-------|------|
| super_admin | portal@test.com | DID-VC Portal Manager |
| maker | pm-maker@didvc.in | Rahul Sharma |
| checker | pm-checker@didvc.in | Priya Singh |

### DID Issuers
| Org | Role | Email | Name |
|-----|------|-------|------|
| DGFT | super_admin | admin@dgft.gov.in | DGFT — Directorate General of Foreign Trade |
| DGFT | maker | maker@dgft.gov.in | Amit Verma |
| DGFT | checker | checker@dgft.gov.in | Sunita Devi |
| IBDIC | super_admin | admin@ibdic.org.in | IBDIC — Indian Blockchain DID Council |
| IBDIC | maker | maker@ibdic.org.in | Rajesh Kumar |
| IBDIC | checker | checker@ibdic.org.in | Meera Nair |

### VC Issuer
| Org | Role | Email | Name |
|-----|------|-------|------|
| NeSL | super_admin | admin@nesl.co.in | NeSL — National e-Governance Services Ltd |
| NeSL | maker | maker@nesl.co.in | Vikram Patel |
| NeSL | checker | checker@nesl.co.in | Rekha Gupta |

### Trust Endorser
| Org | Role | Email | Name |
|-----|------|-------|------|
| Protean | super_admin | admin@protean.co.in | Protean eGov Technologies |
| Protean | maker | maker@protean.co.in | Aditya Rao |
| Protean | checker | checker@protean.co.in | Kavita Sharma |

### Corporate Org — XYZ Private Limited
| Role | Email | Name |
|------|-------|------|
| super_admin | admin@xyz.co.in | XYZ Private Limited |
| maker | maker@xyz.co.in | Suresh Shah |
| checker | checker@xyz.co.in | Ananya Joshi |

### Corporate Org — AcmeCorp (existing 4/4)
| Role | Email | Name |
|------|-------|------|
| super_admin | corp@acme.com | AcmeCorp |

### Verifier — State Bank of India
| Role | Email | Name |
|------|-------|------|
| super_admin | verifier@sbi.co.in | State Bank of India (SBI) |
| maker | maker-v@sbi.co.in | Ramesh Kumar |
| checker | checker-v@sbi.co.in | Deepa Pillai |
