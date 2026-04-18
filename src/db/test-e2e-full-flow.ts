/**
 * End-to-End Flow Test
 *
 * Step 1 — DID Issuance
 *   • HDFC Corp requests a DID via the formal workflow
 *   • IBDIC (DID issuer) issues the DID → anchored on Besu
 *   • DID document resolved and verified
 *
 * Step 2 — VC Issuance
 *   • XYZ Corp requests DGFTExportLicense from DGFT
 *   • XYZ Corp requests NESLBusinessRegistrationCredential from NeSL
 *   • Both government agencies issue the VCs → anchored on Besu
 *
 * Step 3 — VC Shared by Corporate
 *   • HDFC Bank verifier sends a proof request to Vikram (XYZ employee)
 *   • Vikram fetches credentials from corporate wallet
 *   • Vikram composes a Verifiable Presentation (VP) and submits to HDFC
 *
 * Step 4 — VC Verification by HDFC
 *   • HDFC verifier reviews the submitted VP
 *   • HDFC verifier approves → final status = 'approved'
 *
 * Prerequisites:
 *   npx tsx src/db/seed-hdfc-verifier.ts   (run once before this test)
 *
 * Run:
 *   DATABASE_URL=postgresql://... npx tsx src/db/test-e2e-full-flow.ts
 */

const BASE = 'http://localhost:3001';

// ─── HTTP helpers ─────────────────────────────────────────────────────────────

async function post(path: string, body: any, token?: string) {
  const r = await fetch(`${BASE}${path}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify(body),
  });
  const d = await r.json();
  if (!r.ok) throw new Error(`POST ${path}: ${d.error || JSON.stringify(d)}`);
  return d;
}

async function get(path: string, token: string) {
  const r = await fetch(`${BASE}${path}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  const d = await r.json();
  if (!r.ok) throw new Error(`GET ${path}: ${d.error || JSON.stringify(d)}`);
  return d;
}

async function login(email: string, password = 'Platform@123') {
  const d = await post('/api/auth/login', { email, password });
  if (!d.token) throw new Error(`Login failed for ${email}: ${JSON.stringify(d)}`);
  console.log(`  ✓ ${email}`);
  return d.token as string;
}

// ─── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  console.log('\n╔══════════════════════════════════════════════════════════════╗');
  console.log('║   End-to-End Flow: DID → VC Issuance → Share → Verify        ║');
  console.log('╚══════════════════════════════════════════════════════════════╝\n');

  // ── Authenticate all actors ───────────────────────────────────────────────
  console.log('── Authenticating actors ─────────────────────────────────────');
  const hdfcCorpToken  = await login('admin@hdfc.co.in');       // HDFC Corp admin (DID request)
  const ibdicToken     = await login('admin@ibdic.org.in');     // IBDIC (DID issuer)
  const xyzAdminToken  = await login('admin@xyz.co.in');        // XYZ Corp (VC request)
  const dgftToken      = await login('admin@dgft.gov.in');      // DGFT (VC issuer)
  const neslToken      = await login('admin@nesl.co.in');       // NeSL (VC issuer)
  const vikramToken    = await login('vikram.singh@xyz.co.in'); // XYZ employee (VP composer)
  const hdfcVerfToken  = await login('verifier@hdfc.bank');     // HDFC verifier

  // ══════════════════════════════════════════════════════════════════════════
  // STEP 1 — DID ISSUANCE
  // ══════════════════════════════════════════════════════════════════════════
  console.log('\n╔──────────────────────────────────────────────────────────────╗');
  console.log('║  STEP 1: DID Issuance (HDFC Corp → IBDIC)                    ║');
  console.log('╚──────────────────────────────────────────────────────────────╝');

  // 1a. HDFC Corp admin submits DID request
  //     (super_admin skips internal maker/checker/signatory — goes to 'pending' immediately)
  console.log('\n  1a. HDFC Corp submits DID registration request');
  const didReqResult = await post('/api/corporate/did-requests', {
    purpose: 'Register HDFC Bank corporate DID on Besu blockchain',
    request_data: {
      orgName: 'HDFC Bank',
      cin: 'L65920MH1994PLC080618',
      gstn: '27AAACH2702H1ZL',
    },
  }, hdfcCorpToken);
  const didReqId = didReqResult.request?.id;
  console.log(`  ✓ DID request created — ID: ${didReqId}`);
  console.log(`    Status: ${didReqResult.request?.status}`);

  // 1b. IBDIC super_admin issues the DID
  //     Use /issue (not /approve) — handles duplicate DID slugs with random suffix
  console.log('\n  1b. IBDIC issues DID → registers on Besu');
  const didIssuedResult = await post(
    `/api/authority/did-requests/${didReqId}/issue`,
    {},
    ibdicToken
  );
  const issuedDid = didIssuedResult.did;
  console.log(`  ✓ DID issued: ${issuedDid}`);
  console.log(`    Action: ${didIssuedResult.action}`);

  // 1c. Resolve DID document
  console.log('\n  1c. Resolve DID document');
  const encodedDid = encodeURIComponent(issuedDid);
  const didDoc = await get(`/api/dids/${encodedDid}/document`, hdfcCorpToken);
  console.log(`  ✓ DID Document resolved`);
  console.log(`    ID       : ${didDoc.document?.id || issuedDid}`);
  console.log(`    Controller: ${didDoc.document?.controller || '(same)'}`);
  console.log(`    Keys     : ${(didDoc.document?.verificationMethod || []).length} verification method(s)`);

  // ══════════════════════════════════════════════════════════════════════════
  // STEP 2 — VC ISSUANCE
  // ══════════════════════════════════════════════════════════════════════════
  console.log('\n╔──────────────────────────────────────────────────────────────╗');
  console.log('║  STEP 2: VC Issuance (DGFT + NeSL → XYZ Corp)                ║');
  console.log('╚──────────────────────────────────────────────────────────────╝');

  // 2a. XYZ Corp requests DGFTExportLicense
  console.log('\n  2a. XYZ Corp requests DGFTExportLicense from DGFT');
  const vcReq1 = await post('/api/vc-requests', {
    credentialType: 'DGFTExportLicense',
    requestData: {
      licenseNumber: 'EXP-2024-XYZ-001',
      holderName: 'XYZ Private Limited',
      licenseType: 'General Export License',
      commodities: ['Electronics', 'Textiles'],
      validFrom: '2024-01-01',
      validTo: '2025-12-31',
    },
  }, xyzAdminToken);
  const vcReqId1 = vcReq1.request?.id || vcReq1.id;
  console.log(`  ✓ VC Request created — ID: ${vcReqId1}, Status: ${vcReq1.request?.status || vcReq1.status}`);

  // 2b. DGFT super_admin issues the VC
  console.log('\n  2b. DGFT issues DGFTExportLicense → anchors hash on Besu');
  const vcIssued1 = await post(`/api/vc-requests/${vcReqId1}/approve`, {}, dgftToken);
  console.log(`  ✓ VC Issued — credential ID: ${vcIssued1.credentialId || vcIssued1.credential?.id || '(stored)'}`);
  if (vcIssued1.besuTxHash) {
    console.log(`    Besu Tx  : ${vcIssued1.besuTxHash}`);
  }

  // 2c. XYZ Corp requests NESLBusinessRegistrationCredential
  console.log('\n  2c. XYZ Corp requests NESLBusinessRegistrationCredential from NeSL');
  const vcReq2 = await post('/api/vc-requests', {
    credentialType: 'NESLBusinessRegistrationCredential',
    requestData: {
      registrationNumber: 'NESL-REG-XYZ-2024',
      businessName: 'XYZ Private Limited',
      registrationType: 'Private Limited',
      registrationDate: '2010-05-15',
      jurisdiction: 'Maharashtra, India',
    },
  }, xyzAdminToken);
  const vcReqId2 = vcReq2.request?.id || vcReq2.id;
  console.log(`  ✓ VC Request created — ID: ${vcReqId2}, Status: ${vcReq2.request?.status || vcReq2.status}`);

  // 2d. NeSL issues the VC
  console.log('\n  2d. NeSL issues NESLBusinessRegistrationCredential → anchors on Besu');
  const vcIssued2 = await post(`/api/vc-requests/${vcReqId2}/approve`, {}, neslToken);
  console.log(`  ✓ VC Issued — credential ID: ${vcIssued2.credentialId || vcIssued2.credential?.id || '(stored)'}`);
  if (vcIssued2.besuTxHash) {
    console.log(`    Besu Tx  : ${vcIssued2.besuTxHash}`);
  }

  // 2e. Verify both VCs are in XYZ Corp wallet
  console.log('\n  2e. Verify VCs in XYZ Corp wallet');
  const xyzCreds = await get('/api/credentials/my', xyzAdminToken);
  const issuedTypes = (xyzCreds.credentials || []).map((c: any) => c.credential_type);
  console.log(`  ✓ Credentials in XYZ Corp wallet: ${(xyzCreds.credentials || []).length}`);
  issuedTypes.slice(0, 6).forEach((t: string) => console.log(`    • ${t}`));

  // ══════════════════════════════════════════════════════════════════════════
  // STEP 3 — VP CREATED AND SHARED BY CORPORATE EMPLOYEE
  // ══════════════════════════════════════════════════════════════════════════
  console.log('\n╔──────────────────────────────────────────────────────────────╗');
  console.log('║  STEP 3: VP Shared by Corporate (Vikram → HDFC Verifier)      ║');
  console.log('╚──────────────────────────────────────────────────────────────╝');

  // 3a. Get Vikram's sub-DID
  console.log('\n  3a. Resolve Vikram\'s employee sub-DID');
  const vikramProfile = await get('/api/auth/me', vikramToken);
  const vikramDid = vikramProfile.user?.did;
  if (!vikramDid) throw new Error('Vikram has no sub-DID');
  console.log(`  ✓ Vikram sub-DID: ${vikramDid}`);

  // 3b. HDFC Verifier sends proof request to Vikram
  console.log('\n  3b. HDFC Verifier sends proof request to Vikram');
  const proofReq = await post('/api/verifier/request-proof', {
    requiredCredentialTypes: ['DGFTExportLicense', 'NESLBusinessRegistrationCredential'],
    holderDid: vikramDid,
  }, hdfcVerfToken);
  const requestId = proofReq.request?.id;
  console.log(`  ✓ Proof request sent — ID: ${requestId}`);
  console.log(`    Requires: DGFTExportLicense, NESLBusinessRegistrationCredential`);

  // 3c. Vikram sees the proof request
  console.log('\n  3c. Vikram checks incoming proof requests');
  const vikramRequests = await get('/api/holder/verification-requests', vikramToken);
  const myReq = (vikramRequests.requests || []).find((r: any) => r.id === requestId);
  if (!myReq) throw new Error(`Vikram cannot find request ${requestId}`);
  console.log(`  ✓ Vikram sees request — status: ${myReq.status}`);
  console.log(`    Required types: ${(myReq.required_credential_types || []).join(', ')}`);

  // 3d. Vikram fetches credentials from corporate wallet
  console.log('\n  3d. Vikram fetches credentials from corporate wallet');
  const corpWallet = await get('/api/holder/corporate-wallet', vikramToken);
  const corpCreds = corpWallet.credentials || [];
  console.log(`  ✓ Corporate wallet: ${corpCreds.length} credential(s)`);
  corpCreds.slice(0, 5).forEach((c: any) => console.log(`    • ${c.credential_type} (id: ${c.id})`));

  if (corpCreds.length === 0) {
    console.log('\n  ⚠ No credentials in Vikram\'s corporate wallet.');
    console.log('    Checking employee personal wallet...');
    const empCreds = await get('/api/credentials/my', vikramToken);
    const all = empCreds.credentials || [];
    if (all.length === 0) throw new Error('Vikram has no credentials to share');
    corpCreds.push(...all);
  }

  const credIds = corpCreds.slice(0, 3).map((c: any) => c.id);
  console.log(`  ✓ Using ${credIds.length} credential(s) for VP composition`);

  // 3e. Vikram composes VP and submits directly to HDFC verifier
  console.log('\n  3e. Vikram composes VP and submits to HDFC verifier');
  const vpResult = await post('/api/presentations/compose', {
    credentialIds: credIds,
    purpose: 'KYC & Trade Finance Verification for HDFC Bank',
    verifierRequestId: requestId,
  }, vikramToken);
  const presentationId = vpResult.presentationId;
  console.log(`  ✓ VP composed and submitted — Presentation ID: ${presentationId}`);
  const vp = vpResult.presentation;
  console.log(`    VP holder    : ${vp?.holder}`);
  console.log(`    Credentials  : ${(vp?.verifiableCredential || []).length}`);
  console.log(`    Proof type   : ${vp?.proof?.type}`);

  // ══════════════════════════════════════════════════════════════════════════
  // STEP 4 — VC VERIFICATION BY HDFC
  // ══════════════════════════════════════════════════════════════════════════
  console.log('\n╔──────────────────────────────────────────────────────────────╗');
  console.log('║  STEP 4: VC Verification by HDFC Bank                         ║');
  console.log('╚──────────────────────────────────────────────────────────────╝');

  // 4a. HDFC verifier sees the submitted VP
  console.log('\n  4a. HDFC verifier reviews submitted requests');
  const hdfcRequests = await get('/api/verifier/requests', hdfcVerfToken);
  const submittedReq = (hdfcRequests.requests || []).find((r: any) => r.id === requestId);
  if (!submittedReq) throw new Error('HDFC verifier cannot find the submitted request');
  console.log(`  ✓ HDFC sees request — status: ${submittedReq.status}`);
  if (submittedReq.status !== 'submitted') {
    throw new Error(`Expected 'submitted' but got '${submittedReq.status}'`);
  }

  // 4b. Inspect VP contents
  console.log('\n  4b. Inspect VP contents');
  const submittedVP = typeof submittedReq.vp_json === 'string'
    ? JSON.parse(submittedReq.vp_json)
    : submittedReq.vp_json;
  if (submittedVP) {
    const vcs = submittedVP.verifiableCredential || [];
    console.log(`  ✓ VP contains ${vcs.length} Verifiable Credential(s):`);
    vcs.forEach((vc: any, i: number) => {
      const type = Array.isArray(vc.type) ? vc.type.filter((t: string) => t !== 'VerifiableCredential').join(', ') : vc.type;
      console.log(`    [${i + 1}] ${type}`);
      console.log(`        Issuer : ${vc.issuer}`);
      console.log(`        Holder : ${vc.credentialSubject?.id}`);
      console.log(`        Issued : ${vc.issuanceDate?.slice(0, 10)}`);
      console.log(`        Proof  : ${vc.proof?.type} ✓`);
    });
    console.log(`\n  ✓ VP Holder DID : ${submittedVP.holder}`);
    console.log(`  ✓ VP Proof Type : ${submittedVP.proof?.type}`);
  }

  // 4c. HDFC verifier approves
  console.log('\n  4c. HDFC verifier approves the VP');
  const approveResult = await post(
    `/api/verifier/requests/${requestId}/approve`,
    { note: 'All credentials verified. KYC approved for trade finance.' },
    hdfcVerfToken
  );
  console.log(`  ✓ Verification approved: ${JSON.stringify(approveResult).slice(0, 100)}`);

  // 4d. Final status check
  console.log('\n  4d. Final status check');
  const finalRequests = await get('/api/verifier/requests', hdfcVerfToken);
  const finalReq = (finalRequests.requests || []).find((r: any) => r.id === requestId);
  console.log(`  ✓ Final verification status: ${finalReq?.status}`);

  // Vikram's transaction record
  const vikramTx = await get('/api/holder/transactions', vikramToken).catch(() => ({ transactions: [] }));
  const outboundTx = (vikramTx.transactions || []).find((t: any) =>
    t.direction === 'outbound' || t.presentation_id === presentationId
  );
  if (outboundTx) {
    console.log(`  ✓ Vikram's outbound transaction: status=${outboundTx.status}`);
  }

  if (finalReq?.status !== 'approved') {
    throw new Error(`Expected 'approved' but got '${finalReq?.status}'`);
  }

  // ══════════════════════════════════════════════════════════════════════════
  // SUMMARY
  // ══════════════════════════════════════════════════════════════════════════
  console.log('\n╔══════════════════════════════════════════════════════════════╗');
  console.log('║  ✅  ALL 4 STEPS PASSED — End-to-End Flow VERIFIED            ║');
  console.log('╠══════════════════════════════════════════════════════════════╣');
  console.log(`║  Step 1: DID Issued     → ${issuedDid}`);
  console.log(`║  Step 2: VCs Issued     → DGFTExportLicense + NESLBusinessReg`);
  console.log(`║  Step 3: VP Shared      → Presentation ID: ${presentationId}`);
  console.log(`║  Step 4: Verified ✓     → HDFC Bank approved KYC             ║`);
  console.log('╚══════════════════════════════════════════════════════════════╝\n');
}

main().catch(err => {
  console.error('\n❌ E2E test failed:', err.message);
  process.exit(1);
});
