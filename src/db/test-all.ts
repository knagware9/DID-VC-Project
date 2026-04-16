/**
 * Comprehensive platform test — all users, all roles, full E2E
 */
import { query, pool } from './index.js';

const BASE = 'http://localhost:3002';
const PWD  = 'Platform@123';

let passed = 0;
let failed = 0;
const failures: string[] = [];

function ok(label: string) {
  console.log(`  ✅ ${label}`);
  passed++;
}

function fail(label: string, reason: string) {
  console.log(`  ❌ ${label}: ${reason}`);
  failed++;
  failures.push(`${label}: ${reason}`);
}

async function api(method: string, path: string, body?: any, token?: string): Promise<any> {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (token) headers['Authorization'] = `Bearer ${token}`;
  const res = await fetch(`${BASE}${path}`, {
    method, headers,
    body: body ? JSON.stringify(body) : undefined,
  });
  let data: any;
  const text = await res.text();
  try { data = JSON.parse(text); } catch { data = { error: `Non-JSON: ${text.slice(0, 80)}` }; }
  return { status: res.status, ok: res.ok, data };
}

async function login(email: string): Promise<string | null> {
  const r = await api('POST', '/api/auth/login', { email, password: PWD });
  if (!r.ok || !r.data.token) {
    fail(`Login: ${email}`, r.data.error || 'no token');
    return null;
  }
  ok(`Login: ${email} [${r.data.user.role}${r.data.user.sub_role ? '/' + r.data.user.sub_role : ''}]`);
  return r.data.token;
}

function section(title: string) {
  console.log(`\n${'─'.repeat(60)}`);
  console.log(`  ${title}`);
  console.log('─'.repeat(60));
}

// ── Main ──────────────────────────────────────────────────────

async function main() {
  console.log('\n══════════════════════════════════════════════════════════');
  console.log('  DID-VC Platform — Full System Test');
  console.log('══════════════════════════════════════════════════════════');

  // ── 1. Login all users ──────────────────────────────────────
  section('1. Login — All Users');

  const tokens: Record<string, string> = {};
  const users = [
    'portal@test.com',
    'pm-maker@didvc.in',
    'pm-checker@didvc.in',
    'admin@dgft.gov.in',
    'admin@ibdic.org.in',
    'admin@nesl.co.in',
    'admin@protean.co.in',
    'admin@xyz.co.in',
    'maker@xyz.co.in',
    'checker@xyz.co.in',
    'admin@sbi.co.in',
    'verifier@sbi.co.in',
  ];

  for (const email of users) {
    const tok = await login(email);
    if (tok) tokens[email] = tok;
  }

  // ── 2. Auth /me endpoint ────────────────────────────────────
  section('2. Auth — /me endpoint (role & sub_role verification)');

  const expectedRoles: Record<string, { role: string; sub_role?: string }> = {
    'portal@test.com':     { role: 'portal_manager', sub_role: 'super_admin' },
    'pm-maker@didvc.in':   { role: 'portal_manager', sub_role: 'maker' },
    'pm-checker@didvc.in': { role: 'portal_manager', sub_role: 'checker' },
    'admin@dgft.gov.in':   { role: 'government_agency', sub_role: 'did_issuer_admin' },
    'admin@ibdic.org.in':  { role: 'government_agency', sub_role: 'did_issuer_admin' },
    'admin@nesl.co.in':    { role: 'government_agency', sub_role: 'vc_issuer_admin' },
    'admin@protean.co.in': { role: 'government_agency', sub_role: 'did_issuer_admin' },
    'admin@xyz.co.in':     { role: 'corporate', sub_role: 'super_admin' },
    'maker@xyz.co.in':     { role: 'corporate', sub_role: 'maker' },
    'checker@xyz.co.in':   { role: 'corporate', sub_role: 'checker' },
    'admin@sbi.co.in':     { role: 'corporate', sub_role: 'super_admin' },
    'verifier@sbi.co.in':  { role: 'verifier' },
  };

  for (const [email, tok] of Object.entries(tokens)) {
    const r = await api('GET', '/api/auth/me', undefined, tok);
    const expected = expectedRoles[email];
    if (!r.ok) { fail(`/me: ${email}`, r.data.error); continue; }
    const u = r.data.user;
    if (u.role !== expected.role) { fail(`/me: ${email}`, `role=${u.role} expected=${expected.role}`); continue; }
    if (expected.sub_role && u.sub_role !== expected.sub_role) { fail(`/me: ${email}`, `sub_role=${u.sub_role} expected=${expected.sub_role}`); continue; }
    ok(`/me: ${email} → role=${u.role}, sub_role=${u.sub_role ?? 'none'}`);
  }

  // ── 3. Portal Manager ───────────────────────────────────────
  section('3. Portal Manager — All Tabs');

  const pmToken = tokens['portal@test.com'];
  if (pmToken) {
    const team = await api('GET', '/api/portal/admin/team', undefined, pmToken);
    if (team.ok && Array.isArray(team.data.team)) ok(`[Super Admin] Admin team list: ${team.data.team.length} members`);
    else fail('Admin team list', team.data.error);

    const entities = await api('GET', '/api/portal/entities', undefined, pmToken);
    if (entities.ok && Array.isArray(entities.data.entities)) ok(`[Super Admin] Platform entities: ${entities.data.entities.length} entities`);
    else fail('Platform entities list', entities.data.error);

    const orgs = await api('GET', '/api/portal/organizations', undefined, pmToken);
    if (orgs.ok) ok(`[Super Admin] Organizations: ${orgs.data.organizations?.length ?? 0} orgs`);
    else fail('Organizations list', orgs.data.error);

    const dids = await api('GET', '/api/portal/dids', undefined, pmToken);
    if (dids.ok) ok(`[Super Admin] DID registry: ${dids.data.dids?.length ?? 0} DIDs`);
    else fail('DID registry', dids.data.error);

    const authR = await api('GET', '/api/portal/authorities', undefined, pmToken);
    if (authR.ok) ok(`[Super Admin] Authorities: ${authR.data.authorities?.length ?? 0} authorities`);
    else fail('Authorities', authR.data.error);

    const mcQ = await api('GET', '/api/mc/queue', undefined, pmToken);
    if (mcQ.ok) ok(`[Super Admin] Admin queue: ${mcQ.data.actions?.length ?? mcQ.data.queue?.length ?? 0} items`);
    else fail('MC queue (portal)', mcQ.data.error);

    const stats = await api('GET', '/api/portal/stats', undefined, pmToken);
    if (stats.ok) ok(`[Super Admin] Stats: ${JSON.stringify(stats.data.stats ?? stats.data).slice(0,60)}`);
    else fail('Portal stats', stats.data.error);

    // Add new team member
    const newMember = await api('POST', '/api/portal/admin/team', {
      email: `test-checker-${Date.now()}@didvc.in`,
      name: 'Test Checker',
      sub_role: 'checker',
    }, pmToken);
    if (newMember.ok && newMember.data.userId) ok(`[Super Admin] Add team member: userId=${newMember.data.userId.slice(0,8)}, tempPwd set`);
    else fail('Add team member', newMember.data.error);
  }

  // Portal maker — submit entity
  const makerToken = tokens['pm-maker@didvc.in'];
  if (makerToken) {
    const submit = await api('POST', '/api/portal/entities/submit', {
      name: `Test Issuer ${Date.now()}`,
      email: `test-issuer-${Date.now()}@example.com`,
      entity_type: 'vc_issuer',
      notes: 'Automated test entity',
    }, makerToken);
    if (submit.ok && submit.data.entityId) ok(`[Maker] Entity submit: entityId=${submit.data.entityId.slice(0,8)}`);
    else fail('Entity submit (maker)', submit.data.error);

    const q = await api('GET', '/api/mc/queue', undefined, makerToken);
    if (q.ok && (q.data.actions?.length > 0 || q.data.queue?.length >= 0)) ok(`[Maker] MC queue visible: ${q.data.actions?.length ?? 0} items`);
    else fail('MC queue (maker)', q.data.error);

    // Maker blocked from team management
    const blocked = await api('GET', '/api/portal/admin/team', undefined, makerToken);
    if (!blocked.ok) ok(`[Maker] Correctly blocked from admin team endpoint (${blocked.status})`);
    else fail('Maker should be blocked from admin team', 'got 200');
  }

  // Portal checker approves entity
  const checkerToken = tokens['pm-checker@didvc.in'];
  if (checkerToken) {
    const q = await api('GET', '/api/mc/queue', undefined, checkerToken);
    if (q.ok) ok(`[Checker] Admin queue: ${q.data.actions?.length ?? 0} pending actions`);
    else fail('Checker MC queue', q.data.error);

    // Approve first pending action if any
    const pending = q.data.actions ?? [];
    if (pending.length > 0) {
      const approveRes = await api('POST', `/api/mc/${pending[0].id}/approve`, {}, checkerToken);
      if (approveRes.ok) ok(`[Checker] Approved entity action: ${pending[0].id.slice(0,8)} → entity activated`);
      else fail('Checker approve entity', approveRes.data.error);
    } else {
      ok(`[Checker] No pending actions (all previously approved)`);
    }
  }

  // ── 4. Authority Dashboards ─────────────────────────────────
  section('4. Authority Dashboards (DGFT, IBDIC, NESL, Protean)');

  const authorities = [
    { email: 'admin@dgft.gov.in',   label: 'DGFT' },
    { email: 'admin@ibdic.org.in',  label: 'IBDIC' },
    { email: 'admin@nesl.co.in',    label: 'NESL' },
    { email: 'admin@protean.co.in', label: 'Protean' },
  ];

  for (const { email, label } of authorities) {
    const tok = tokens[email];
    if (!tok) continue;

    const pending = await api('GET', '/api/vc-requests/pending', undefined, tok);
    if (pending.ok) ok(`${label} — pending VC requests: ${pending.data.requests?.length ?? 0}`);
    else fail(`${label} pending requests`, pending.data.error);

    const issued = await api('GET', '/api/vc-requests/issued', undefined, tok);
    if (issued.ok) ok(`${label} — issued VC records: ${issued.data.requests?.length ?? 0}`);
    else fail(`${label} issued records`, issued.data.error);

    const mcQ = await api('GET', '/api/mc/queue', undefined, tok);
    if (mcQ.ok) ok(`${label} — checker queue: ${mcQ.data.queue?.length ?? 0} items (no authority_type = VC issuer mode)`);
    else fail(`${label} checker queue`, mcQ.data.error);

    const orgApps = await api('GET', '/api/authority/organizations', undefined, tok);
    // Expected 400 for no authority_type — that's OK for these seeded issuers
    if (orgApps.ok) ok(`${label} — org applications: ${orgApps.data.applications?.length ?? 0}`);
    else if (orgApps.status === 400) ok(`${label} — org applications: skipped (VC issuer mode, no authority_type)`);
    else fail(`${label} org applications`, orgApps.data.error);
  }

  // ── 5. Corporate (XYZ) ──────────────────────────────────────
  section('5. Corporate — XYZ Pvt Ltd');

  const xyzToken = tokens['admin@xyz.co.in'];
  if (xyzToken) {
    const creds = await api('GET', '/api/credentials/my', undefined, xyzToken);
    if (creds.ok && Array.isArray(creds.data.credentials)) ok(`[Admin] My credentials: ${creds.data.credentials.length} VCs`);
    else fail('XYZ credentials', creds.data.error);

    const myVcReqs = await api('GET', '/api/vc-requests/my', undefined, xyzToken);
    if (myVcReqs.ok) ok(`[Admin] VC requests: ${myVcReqs.data.requests?.length ?? 0} requests`);
    else fail('XYZ VC requests', myVcReqs.data.error);

    const proofReqs = await api('GET', '/api/holder/verification-requests', undefined, xyzToken);
    if (proofReqs.ok) ok(`[Admin] Incoming proof requests: ${proofReqs.data.requests?.length ?? 0}`);
    else fail('XYZ proof requests', proofReqs.data.error);

    const employees = await api('GET', '/api/dids/employees', undefined, xyzToken);
    if (employees.ok) ok(`[Admin] Employees (sub-DIDs): ${employees.data.employees?.length ?? 0}`);
    else fail('XYZ employees', employees.data.error);

    const team = await api('GET', '/api/corporate/team', undefined, xyzToken);
    if (team.ok) ok(`[Admin] Corporate team: ${team.data.members?.length ?? 0} members`);
    else fail('XYZ team', team.data.error);

    const issuers = await api('GET', '/api/users/issuers', undefined, xyzToken);
    if (issuers.ok) ok(`[Admin] Available issuers: ${issuers.data.issuers?.length ?? 0}`);
    else fail('XYZ issuers list', issuers.data.error);

    const auditLog = await api('GET', '/api/audit-logs', undefined, xyzToken);
    if (auditLog.ok) ok(`[Admin] Audit logs: ${auditLog.data.logs?.length ?? 0} entries`);
    else fail('Audit logs', auditLog.data.error);
  }

  // Maker sub-role check
  const xyzMakerToken = tokens['maker@xyz.co.in'];
  if (xyzMakerToken) {
    const r = await api('GET', '/api/credentials/my', undefined, xyzMakerToken);
    if (r.ok) ok(`[Maker] Credentials accessible`);
    else fail('XYZ maker credentials', r.data.error);

    const q = await api('GET', '/api/mc/queue', undefined, xyzMakerToken);
    if (q.ok) ok(`[Maker] MC queue: ${q.data.queue?.length ?? 0} items`);
    else fail('XYZ maker MC queue', q.data.error);
  }

  // Checker sub-role check
  const xyzCheckerToken = tokens['checker@xyz.co.in'];
  if (xyzCheckerToken) {
    const q = await api('GET', '/api/mc/queue', undefined, xyzCheckerToken);
    if (q.ok) ok(`[Checker] VP queue: ${q.data.queue?.length ?? 0} items pending approval`);
    else fail('XYZ checker queue', q.data.error);
  }

  // ── 6. Verifier (SBI) ───────────────────────────────────────
  section('6. Verifier — SBI Bank');

  // verifier@sbi.co.in has role='verifier'
  const sbiVerToken = tokens['verifier@sbi.co.in'];
  if (sbiVerToken) {
    const reqs = await api('GET', '/api/verifier/requests', undefined, sbiVerToken);
    if (reqs.ok) ok(`[Verifier] Verification requests: ${reqs.data.requests?.length ?? 0}`);
    else fail('SBI verifier requests', reqs.data.error);

    const shared = await api('GET', '/api/verifier/shared-presentations', undefined, sbiVerToken);
    if (shared.ok) ok(`[Verifier] Shared presentations: ${shared.data.presentations?.length ?? 0}`);
    else fail('SBI shared presentations', shared.data.error);
  }

  // admin@sbi.co.in has role='corporate' — uses holder APIs
  const sbiAdminToken = tokens['admin@sbi.co.in'];
  if (sbiAdminToken) {
    const r = await api('GET', '/api/auth/me', undefined, sbiAdminToken);
    if (r.ok) ok(`[SBI Admin] corporate/super_admin: ${r.data.user.email}`);
    else fail('SBI admin /me', r.data.error);
  }

  // ── 7. Full E2E Flow ─────────────────────────────────────────
  section('7. End-to-End Flow — XYZ → DGFT+NESL → SBI Verify');

  const issuers = await query(
    `SELECT id, email FROM users WHERE email IN
     ('admin@dgft.gov.in','admin@nesl.co.in')`
  );
  const issuerMap: Record<string, string> = {};
  for (const row of issuers.rows) issuerMap[row.email] = row.id;

  const credIds: string[] = [];

  if (xyzToken) {
    // XYZ requests DGFT VC
    const r1 = await api('POST', '/api/vc-requests', {
      credentialType: 'DGFTImporterExporterCodeCredential',
      targetIssuerId: issuerMap['admin@dgft.gov.in'],
      requestData: { companyName: 'XYZ Private Limited', ieCode: 'IEC7777777', registrationDate: '2000-01-15', portCode: 'INMAA4', exportCategory: 'Merchant Exporter' },
    }, xyzToken);
    if (r1.ok) ok(`E2E: XYZ → DGFT request: ${r1.data.request?.id?.slice(0,8)}`);
    else { fail('E2E: DGFT VC request', r1.data.error); }

    // XYZ requests NESL VC
    const r2 = await api('POST', '/api/vc-requests', {
      credentialType: 'NESLBusinessRegistrationCredential',
      targetIssuerId: issuerMap['admin@nesl.co.in'],
      requestData: { cin: 'U88888MH2026PTC888', companyName: 'XYZ Private Limited', companyStatus: 'Active', dateOfIncorp: '2000-01-01', authorizedCapital: '10000000', paidUpCapital: '5000000', registeredAddress: 'Mumbai' },
    }, xyzToken);
    if (r2.ok) ok(`E2E: XYZ → NESL request: ${r2.data.request?.id?.slice(0,8)}`);
    else { fail('E2E: NESL VC request', r2.data.error); }

    // DGFT approves
    if (r1.ok) {
      const tok = tokens['admin@dgft.gov.in'];
      const approve = await api('POST', `/api/vc-requests/${r1.data.request.id}/approve`, {}, tok);
      if (approve.ok) { ok(`E2E: DGFT issued VC → ${approve.data.credentialDbId?.slice(0,8)}`); credIds.push(approve.data.credentialDbId); }
      else fail('E2E: DGFT approve', approve.data.error);
    }

    // NESL approves
    if (r2.ok) {
      const tok = tokens['admin@nesl.co.in'];
      const approve = await api('POST', `/api/vc-requests/${r2.data.request.id}/approve`, {}, tok);
      if (approve.ok) { ok(`E2E: NESL issued VC → ${approve.data.credentialDbId?.slice(0,8)}`); credIds.push(approve.data.credentialDbId); }
      else fail('E2E: NESL approve', approve.data.error);
    }

    // SBI (verifier role) creates proof request
    const xyzDID = await query(
      `SELECT d.did_string FROM dids d JOIN users u ON u.id=d.user_id WHERE u.email='admin@xyz.co.in' AND d.did_type='parent'`
    );
    const holderDid = xyzDID.rows[0]?.did_string;

    if (!sbiVerToken) { fail('E2E: SBI verifier not logged in', 'no token'); }
    else {
      const vReq = await api('POST', '/api/verifier/request-proof', {
        holderDid,
        requiredCredentialTypes: ['DGFTImporterExporterCodeCredential', 'NESLBusinessRegistrationCredential'],
      }, sbiVerToken);

      if (vReq.ok) {
        ok(`E2E: SBI proof request: ${vReq.data.request?.id?.slice(0,8)} (challenge: ${vReq.data.request?.challenge?.slice(0,8)})`);
        const vReqId = vReq.data.request.id;

        if (credIds.length >= 2) {
          const vp = await api('POST', '/api/presentations/compose', {
            credentialIds: credIds,
            verifierRequestId: vReqId,
            purpose: 'Full system test VP',
            selectedFields: {
              [credIds[0]]: ['companyName', 'ieCode'],
              [credIds[1]]: ['cin', 'companyName', 'companyStatus'],
            },
          }, xyzToken);
          if (vp.ok) {
            ok(`E2E: XYZ VP composed → presentationId=${vp.data.presentationId?.slice(0,8)}`);

            const approve = await api('POST', `/api/verifier/requests/${vReqId}/approve`, {}, sbiVerToken);
            if (approve.ok) ok(`E2E: SBI APPROVED VP ✓ — Full flow complete!`);
            else fail('E2E: SBI approve VP', approve.data.error);
          } else fail('E2E: compose VP', vp.data.error);
        }
      } else fail('E2E: SBI proof request', vReq.data.error);
    }
  }

  // ── Access Control Checks ────────────────────────────────────
  section('8. Access Control — Role Enforcement');

  // Corporate cannot access portal routes
  if (xyzToken) {
    const r = await api('GET', '/api/portal/entities', undefined, xyzToken);
    if (!r.ok) ok(`Corporate blocked from /api/portal/entities (${r.status})`);
    else fail('Corporate should not access portal routes', 'got 200');
  }

  // Non-verifier cannot create proof request
  if (xyzToken) {
    const r = await api('POST', '/api/verifier/request-proof', { holderDid: 'did:web:test', requiredCredentialTypes: [] }, xyzToken);
    if (!r.ok) ok(`Corporate blocked from /api/verifier/request-proof (${r.status})`);
    else fail('Corporate should not create proof requests', 'got 200');
  }

  // Government agency cannot request VCs
  const dgftTok = tokens['admin@dgft.gov.in'];
  if (dgftTok) {
    const r = await api('POST', '/api/vc-requests', { credentialType: 'Test', targetIssuerId: 'abc', requestData: {} }, dgftTok);
    if (!r.ok) ok(`Government agency blocked from /api/vc-requests (${r.status})`);
    else fail('Gov agency should not request VCs', 'got 200');
  }

  // ── Summary ──────────────────────────────────────────────────
  console.log(`\n${'═'.repeat(60)}`);
  console.log(`  TEST RESULTS`);
  console.log(`${'═'.repeat(60)}`);
  console.log(`  Passed : ${passed}`);
  console.log(`  Failed : ${failed}`);
  if (failures.length > 0) {
    console.log(`\n  Failures:`);
    failures.forEach(f => console.log(`    ✗ ${f}`));
  } else {
    console.log(`\n  🎉 All ${passed} tests passed!`);
  }
  console.log('');

  await pool.end();
}

main().catch(err => {
  console.error('\n❌ Test runner failed:', err.message);
  pool.end();
  process.exit(1);
});
