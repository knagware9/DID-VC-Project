/**
 * End-to-End Flow Test
 *
 * Demonstrates the complete DID-VC lifecycle:
 *   1. DGFT  (DID Issuer)   → issues DID Credential    to XYZ Pvt Ltd
 *   2. IBDIC (DID Issuer)   → issues Identity Credential to XYZ Pvt Ltd
 *   3. NESL  (VC Issuer)    → issues Business VC        to XYZ Pvt Ltd
 *   4. Protean (Trust End.) → issues Trust Endorsement  to XYZ Pvt Ltd
 *   5. SBI Bank (Verifier)  → requests proof from XYZ
 *   6. XYZ   (Holder)       → composes & submits VP
 *   7. SBI   (Verifier)     → reviews & approves
 */
import bcrypt from 'bcryptjs';
import { query, pool } from './index.js';

const BASE = 'http://localhost:3001';
const PWD  = 'Platform@123';

// ── Helpers ───────────────────────────────────────────────────────────────────

function sleep(ms: number) { return new Promise(r => setTimeout(r, ms)); }

async function api(method: string, path: string, body?: any, token?: string) {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (token) headers['Authorization'] = `Bearer ${token}`;
  const res = await fetch(`${BASE}${path}`, {
    method, headers,
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await res.json() as any;
  if (!res.ok) throw new Error(`${method} ${path} → ${res.status}: ${data.error || JSON.stringify(data)}`);
  return data;
}

async function login(email: string, password = PWD): Promise<string> {
  const { token } = await api('POST', '/api/auth/login', { email, password });
  return token;
}

async function ensureVerifier(email: string, name: string): Promise<void> {
  const existing = await query('SELECT id FROM users WHERE email = $1', [email]);
  if (existing.rows.length > 0) return;
  const hash = await bcrypt.hash(PWD, 10);
  await query(
    `INSERT INTO users (email, password_hash, role, name) VALUES ($1, $2, 'verifier', $3)`,
    [email, hash, name]
  );
  console.log(`  ✓ created verifier: ${email}`);
}

function box(title: string) {
  const line = '─'.repeat(60);
  console.log(`\n┌${line}┐`);
  console.log(`│  ${title.padEnd(58)}│`);
  console.log(`└${line}┘`);
}

function step(n: number, msg: string) {
  console.log(`\n  [${n}] ${msg}`);
}

// ── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  console.log('\n══════════════════════════════════════════════════════════════');
  console.log('  DID-VC Platform — End-to-End Flow');
  console.log('══════════════════════════════════════════════════════════════');

  // ── 0. Prepare SBI as verifier ───────────────────────────────────────────
  box('0 · Setup: SBI Bank Verifier Account');
  await ensureVerifier('verifier@sbi.co.in', 'SBI Bank Verifier');

  // ── 1. XYZ requests VCs from all issuers ────────────────────────────────
  box('1 · XYZ Pvt Ltd: Login & Request Credentials');
  step(1, 'Logging in as XYZ Pvt Ltd admin...');
  const xyzToken = await login('admin@xyz.co.in');
  console.log('     → Logged in ✓');

  // Get NESL/DGFT/IBDIC/Protean user IDs to use as targetIssuerId
  const issuers = await query(
    `SELECT u.id, u.email, u.name FROM users u WHERE u.email IN
     ('admin@dgft.gov.in','admin@ibdic.org.in','admin@nesl.co.in','admin@protean.co.in')`
  );
  const issuerMap: Record<string, string> = {};
  for (const row of issuers.rows) issuerMap[row.email] = row.id;

  step(2, 'XYZ requesting IE Code credential from DGFT...');
  const req1 = await api('POST', '/api/vc-requests', {
    credentialType: 'DGFTImporterExporterCodeCredential',
    targetIssuerId: issuerMap['admin@dgft.gov.in'],
    requestData: {
      companyName:      'XYZ Private Limited',
      ieCode:           'IEC0123456789',
      registrationDate: '2000-01-15',
      portCode:         'INMAA4',
      exportCategory:   'Merchant Exporter',
    },
  }, xyzToken);
  const vcReqDgft = req1.request.id;
  console.log(`     → VC Request ID: ${vcReqDgft}`);

  step(3, 'XYZ requesting Digital Identity credential from IBDIC...');
  const req2 = await api('POST', '/api/vc-requests', {
    credentialType: 'IBDICDigitalIdentityCredential',
    targetIssuerId: issuerMap['admin@ibdic.org.in'],
    requestData: {
      entityName:        'XYZ Private Limited',
      verificationLevel: 'Enhanced',
      kycStatus:         'Verified',
      registrationNo:    'U12345MH2000PTC123456',
    },
  }, xyzToken);
  const vcReqIbdic = req2.request.id;
  console.log(`     → VC Request ID: ${vcReqIbdic}`);

  step(4, 'XYZ requesting Business Registration VC from NESL...');
  const req3 = await api('POST', '/api/vc-requests', {
    credentialType: 'NESLBusinessRegistrationCredential',
    targetIssuerId: issuerMap['admin@nesl.co.in'],
    requestData: {
      cin:               'U12345MH2000PTC123456',
      companyName:       'XYZ Private Limited',
      companyStatus:     'Active',
      dateOfIncorp:      '2000-01-01',
      authorizedCapital: '10000000',
      paidUpCapital:     '5000000',
      registeredAddress: 'Mumbai, Maharashtra',
    },
  }, xyzToken);
  const vcReqNesl = req3.request.id;
  console.log(`     → VC Request ID: ${vcReqNesl}`);

  step(5, 'XYZ requesting Trust Endorsement from Protean...');
  const req4 = await api('POST', '/api/vc-requests', {
    credentialType: 'ProteanTrustEndorsementCredential',
    targetIssuerId: issuerMap['admin@protean.co.in'],
    requestData: {
      pan:           'ABCDE1234F',
      nameOnPAN:     'XYZ PRIVATE LIMITED',
      panStatus:     'Active',
      assessmentYear:'2024-25',
      endorsedBy:    'Protean eGov Technologies',
    },
  }, xyzToken);
  const vcReqProtean = req4.request.id;
  console.log(`     → VC Request ID: ${vcReqProtean}`);

  // ── 2. Each authority approves & issues ──────────────────────────────────
  box('2 · DID & VC Issuers: Approve & Issue Credentials');

  const issuanceJobs: Array<{ label: string; email: string; vcReqId: string }> = [
    { label: 'DGFT',    email: 'admin@dgft.gov.in',     vcReqId: vcReqDgft    },
    { label: 'IBDIC',   email: 'admin@ibdic.org.in',    vcReqId: vcReqIbdic   },
    { label: 'NESL',    email: 'admin@nesl.co.in',      vcReqId: vcReqNesl    },
    { label: 'Protean', email: 'admin@protean.co.in',   vcReqId: vcReqProtean },
  ];

  const credentialIds: string[] = [];

  for (const { label, email, vcReqId } of issuanceJobs) {
    step(0, `${label} logging in and approving request ${vcReqId.slice(0, 8)}...`);
    const tok = await login(email);
    const result = await api('POST', `/api/vc-requests/${vcReqId}/approve`, {}, tok);
    credentialIds.push(result.credentialDbId);
    console.log(`     → VC issued by ${label}`);
    console.log(`       Credential ID : ${result.credentialDbId}`);
    console.log(`       VC ID         : ${result.credential.id}`);
    console.log(`       Issued at     : ${result.credential.issuanceDate}`);
    console.log(`       Expires       : ${result.credential.expirationDate}`);
  }

  // ── 3. SBI requests proof from XYZ ──────────────────────────────────────
  box('3 · SBI Bank (Verifier): Create Proof Request');

  step(1, 'SBI logging in...');
  const sbiToken = await login('verifier@sbi.co.in');
  console.log('     → Logged in ✓');

  // Get XYZ holder DID
  const xyzDIDResult = await query(
    `SELECT d.did_string FROM dids d
     JOIN users u ON u.id = d.user_id
     WHERE u.email = 'admin@xyz.co.in' AND d.did_type = 'parent'`
  );
  const xyzDID = xyzDIDResult.rows[0]?.did_string;
  console.log(`     XYZ DID: ${xyzDID}`);

  step(2, 'SBI sending verification request to XYZ...');
  const vReq = await api('POST', '/api/verifier/request-proof', {
    holderDid: xyzDID,
    requiredCredentialTypes: [
      'IBDICDigitalIdentityCredential',
      'NESLBusinessRegistrationCredential',
      'ProteanTrustEndorsementCredential',
    ],
  }, sbiToken);
  const verificationRequestId = vReq.request.id;
  const challenge = vReq.request.challenge;
  console.log(`     → Verification Request ID : ${verificationRequestId}`);
  console.log(`       Challenge               : ${challenge}`);
  console.log(`       Required types          : IBDIC + NESL + Protean credentials`);

  // ── 4. XYZ composes VP and submits ──────────────────────────────────────
  box('4 · XYZ Pvt Ltd (Holder): Compose & Submit VP');

  step(1, 'XYZ selecting credentials and composing Verifiable Presentation...');
  // Use IBDIC, NESL, Protean credentials (indices 1, 2, 3)
  const selectedCredIds = [credentialIds[1], credentialIds[2], credentialIds[3]];

  const vpResult = await api('POST', '/api/presentations/compose', {
    credentialIds: selectedCredIds,
    verifierRequestId: verificationRequestId,
    purpose: 'KYC and trade finance verification for SBI Bank loan application',
    selectedFields: {
      [credentialIds[1]]: ['entityName', 'verificationLevel', 'kycStatus'],
      [credentialIds[2]]: ['cin', 'companyName', 'companyStatus', 'authorizedCapital'],
      [credentialIds[3]]: ['pan', 'nameOnPAN', 'panStatus'],
    },
  }, xyzToken);

  console.log(`     → Presentation ID    : ${vpResult.presentationId}`);
  console.log(`       Credentials in VP  : ${selectedCredIds.length}`);
  console.log(`       Holder             : ${vpResult.presentation.holder}`);
  console.log(`       Proof type         : ${vpResult.presentation.proof?.type}`);

  // ── 5. SBI reviews and approves ──────────────────────────────────────────
  box('5 · SBI Bank (Verifier): Review & Approve VP');

  step(1, 'SBI checking submitted verification requests...');
  const requests = await api('GET', '/api/verifier/requests', undefined, sbiToken);
  const submitted = requests.requests.find((r: any) => r.id === verificationRequestId);
  console.log(`     → Status: ${submitted?.status}`);

  step(2, 'SBI approving the verification...');
  await api('POST', `/api/verifier/requests/${verificationRequestId}/approve`, {}, sbiToken);
  console.log('     → Verification APPROVED ✓');

  // ── Summary ──────────────────────────────────────────────────────────────
  console.log('\n══════════════════════════════════════════════════════════════');
  console.log('  ✅  End-to-End Flow Complete');
  console.log('══════════════════════════════════════════════════════════════');
  console.log('\n  Credentials issued to XYZ Pvt Ltd:');
  const labels = ['DGFT IE Code', 'IBDIC Digital Identity', 'NESL Business Reg.', 'Protean Trust Endorsement'];
  credentialIds.forEach((id, i) => console.log(`    [${i+1}] ${labels[i].padEnd(26)} ID: ${id}`));
  console.log(`\n  Verifiable Presentation: ${vpResult.presentationId}`);
  console.log(`  Verification by SBI     : APPROVED`);
  console.log('\n  Actor Summary:');
  console.log('    DGFT    → DID Issuer  → issued IE Code credential');
  console.log('    IBDIC   → DID Issuer  → issued Digital Identity credential');
  console.log('    NESL    → VC Issuer   → issued Business Registration credential');
  console.log('    Protean → Trust End.  → issued Trust Endorsement credential');
  console.log('    XYZ     → Holder      → composed VP with selective disclosure');
  console.log('    SBI     → Verifier    → verified XYZ identity & credentials');
  console.log('');

  await pool.end();
}

main().catch(err => {
  console.error('\n❌ Flow failed:', err.message);
  pool.end();
  process.exit(1);
});
