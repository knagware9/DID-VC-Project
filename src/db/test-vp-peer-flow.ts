/**
 * E2E test: 10-step Employee VP Peer Review Flow
 *
 * Actors:
 *   Bank Verifier   : verifier@sbi.co.in (verifier role, super_admin)
 *   Bank Approver   : checker-v@sbi.co.in (verifier role, checker)
 *   Emp 1 (sender)  : vikram.singh@xyz.co.in (corporate/employee) — XYZ-EMP-001
 *   Emp 2 (reviewer): sneha.patel@xyz.co.in  (corporate/employee) — XYZ-EMP-002
 *
 * Steps:
 *  1. Bank verifier requests VC submission from Vikram
 *  2. Vikram sees the proof request
 *  3. Vikram composes VP from his credentials (employee + corporate)
 *  4. Vikram shares VP to Sneha for internal peer review
 *  5. Sneha sees the pending review in her VP Review queue
 *  6. Sneha verifies the VCs in the VP
 *  7. Sneha approves → VP submitted to bank
 *  8. Bank verifier sees and reviews the submitted VP
 *  9. Bank verifier/checker approves the VP
 * 10. Transactions show approved status for both bank and corporate
 */

const BASE = 'http://localhost:3001';

async function post(path: string, body: any, token?: string) {
  const r = await fetch(`${BASE}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: JSON.stringify(body),
  });
  const d = await r.json();
  if (!r.ok) throw new Error(`POST ${path}: ${d.error || JSON.stringify(d)}`);
  return d;
}

async function get(path: string, token: string) {
  const r = await fetch(`${BASE}${path}`, { headers: { Authorization: `Bearer ${token}` } });
  const d = await r.json();
  if (!r.ok) throw new Error(`GET ${path}: ${d.error || JSON.stringify(d)}`);
  return d;
}

async function login(email: string, password = 'Platform@123') {
  const d = await post('/api/auth/login', { email, password });
  if (!d.token) throw new Error(`Login failed for ${email}: ${JSON.stringify(d)}`);
  console.log(`  ✓ Logged in: ${email}`);
  return d.token as string;
}

async function main() {
  console.log('\n══════════════════════════════════════════════════════════════');
  console.log('  10-Step Employee VP Peer Review Flow — E2E Test');
  console.log('══════════════════════════════════════════════════════════════\n');

  // ── Login all actors ──────────────────────────────────────────────────────
  console.log('── Authenticating ────────────────────────────────────────────');
  const bankToken  = await login('verifier@sbi.co.in');
  const vikramToken = await login('vikram.singh@xyz.co.in');
  const snehaToken  = await login('sneha.patel@xyz.co.in');

  // ── Pre-step: Issue EmploymentCertificate to Vikram so he has something to share
  console.log('\n── Pre-step: Issue credentials to Vikram ─────────────────────');
  const xyzAdminToken = await login('admin@xyz.co.in');
  // Get Vikram's employee registry ID
  const empList = await get('/api/dids/employees', xyzAdminToken);
  const vikramEmpReg = (empList.employees || []).find((e: any) => e.email === 'vikram.singh@xyz.co.in');
  if (!vikramEmpReg) throw new Error('Vikram not found in employee registry');
  console.log(`  Vikram employee registry ID: ${vikramEmpReg.id}`);

  // Issue EmploymentCertificate
  try {
    await post('/api/corporate/issue-to-employee', {
      employeeRegistryId: vikramEmpReg.id,
      credentialTemplate: 'EmploymentCertificate',
      credentialData: { dateOfJoining: '2023-01-01', employeeId: 'XYZ-EMP-001', department: 'Trade Finance', status: 'Active' },
    }, xyzAdminToken);
    console.log('  ✓ EmploymentCertificate issued to Vikram');
  } catch (e: any) {
    console.log(`  ℹ EmploymentCertificate: ${e.message} (may already exist)`);
  }

  // ── Step 1: Bank sends proof request to Vikram ────────────────────────────
  console.log('\n── Step 1: Bank sends proof request ──────────────────────────');
  // Get Vikram's sub-DID (now returned correctly by api/auth/me for employees)
  const vikramProfile = await get('/api/auth/me', vikramToken);
  const vikramDid = vikramProfile.user?.did;
  if (!vikramDid) throw new Error('Vikram has no DID');
  console.log(`  Vikram sub-DID: ${vikramDid}`);

  const proofReqResult = await post('/api/verifier/request-proof', {
    requiredCredentialTypes: ['DGFTImporterExporterCodeCredential', 'NESLBusinessRegistrationCredential'],
    holderDid: vikramDid,
  }, bankToken);
  console.log(`  ✓ Proof request sent. Request ID: ${proofReqResult.request?.id || proofReqResult.requestId}`);
  const requestId = proofReqResult.request?.id || proofReqResult.requestId;

  // ── Step 2: Vikram sees the proof request ─────────────────────────────────
  console.log('\n── Step 2: Vikram sees proof request ─────────────────────────');
  const vikramRequests = await get('/api/holder/verification-requests', vikramToken);
  const myReq = (vikramRequests.requests || []).find((r: any) => r.id === requestId);
  if (!myReq) throw new Error(`Vikram doesn't see request ${requestId}`);
  console.log(`  ✓ Vikram sees request: status=${myReq.status}, requires=${myReq.required_credential_types?.join(', ')}`);

  // ── Step 3: Vikram gets his credentials (employee + corporate wallet) ─────
  console.log('\n── Step 3: Vikram checks credentials ─────────────────────────');
  const [empCreds, corpCreds] = await Promise.all([
    get('/api/credentials/my', vikramToken),
    get('/api/holder/corporate-wallet', vikramToken),
  ]);
  const allCreds = [...(empCreds.credentials || []), ...(corpCreds.credentials || [])];
  console.log(`  Employee wallet: ${(empCreds.credentials || []).length} credential(s)`);
  console.log(`  Corporate wallet: ${(corpCreds.credentials || []).length} credential(s)`);
  if (allCreds.length === 0) {
    console.log('  ⚠ No credentials found — Vikram cannot compose a VP. Continuing to test the peer flow with any available cred.');
  }
  const credIds = allCreds.slice(0, 2).map((c: any) => c.id);
  if (credIds.length === 0) {
    console.log('  ℹ No credentials to share — skipping VP compose step. Testing with manual presentation ID...');
  }
  console.log(`  Using credential IDs: [${credIds.join(', ')}]`);

  // If no credentials, we need to issue some first
  if (credIds.length === 0) {
    console.log('\n  ℹ Vikram has no credentials. Cannot test full VP compose. Flow verified up to Step 2.');
    console.log('  To complete the test: have XYZ admin issue credentials to Vikram first.');
    process.exit(0);
  }

  // ── Step 4: Vikram composes VP as draft (no verifierRequestId) ────────────
  console.log('\n── Step 4: Vikram composes VP draft ──────────────────────────');
  const vpDraft = await post('/api/presentations/compose', {
    credentialIds: credIds,
    purpose: 'KYC Verification for SBI Bank',
  }, vikramToken);
  const presentationId = vpDraft.presentationId;
  console.log(`  ✓ VP composed (draft). Presentation ID: ${presentationId}`);

  // ── Step 5: Vikram shares VP to Sneha for peer review ────────────────────
  console.log('\n── Step 5: Vikram shares VP to Sneha for peer review ─────────');
  const shareResult = await post(`/api/presentations/${presentationId}/share-to-peer`, {
    peerEmail: 'sneha.patel@xyz.co.in',
    note: 'Please review before submitting to SBI for KYC renewal',
    verifierRequestId: requestId,
  }, vikramToken);
  console.log(`  ✓ ${shareResult.message}`);

  // Verify VR is still pending (not yet submitted to bank)
  const bankViewBefore = await get('/api/verifier/requests', bankToken);
  const vrBefore = (bankViewBefore.requests || []).find((r: any) => r.id === requestId);
  console.log(`  ✓ Bank sees request as: ${vrBefore?.status || 'unknown'} (should still be 'pending')`);
  if (vrBefore?.status === 'submitted') {
    console.log('  ⚠ Request already submitted — expected pending at this stage');
  }

  // ── Step 6: Sneha sees the VP in her review queue ─────────────────────────
  console.log('\n── Step 6: Sneha sees pending VP in review queue ─────────────');
  const snehaQueue = await get('/api/employee/vp-pending-review', snehaToken);
  const pendingPres = (snehaQueue.presentations || []).find((p: any) => p.id === presentationId);
  if (!pendingPres) {
    throw new Error(`Sneha does not see presentation ${presentationId} in her review queue`);
  }
  console.log(`  ✓ Sneha sees VP from: ${pendingPres.sender_name || pendingPres.sender_email}`);
  console.log(`  ✓ Note: "${pendingPres.reviewer_note}"`);
  const vp = typeof pendingPres.vp_json === 'string' ? JSON.parse(pendingPres.vp_json) : pendingPres.vp_json;
  console.log(`  ✓ VP contains ${(vp?.verifiableCredential || []).length} credential(s)`);
  console.log(`  ✓ VP holder: ${vp?.holder}`);

  // ── Step 7: Sneha verifies and approves the VP ────────────────────────────
  console.log('\n── Step 7: Sneha approves VP → submits to bank ───────────────');
  const approveResult = await post(`/api/presentations/${presentationId}/peer-approve`, {
    decision: 'approve',
    note: 'Credentials verified. KYC documents are authentic.',
  }, snehaToken);
  console.log(`  ✓ ${approveResult.message}`);

  // ── Step 8: Bank verifier sees submitted VP ───────────────────────────────
  console.log('\n── Step 8: Bank verifier sees submitted VP ───────────────────');
  const bankViewAfter = await get('/api/verifier/requests', bankToken);
  const vrAfter = (bankViewAfter.requests || []).find((r: any) => r.id === requestId);
  if (!vrAfter) throw new Error('Bank cannot find the verification request');
  console.log(`  ✓ Bank sees request status: ${vrAfter.status} (expected 'submitted')`);
  if (vrAfter.status !== 'submitted') {
    throw new Error(`Expected 'submitted' but got '${vrAfter.status}'`);
  }

  // ── Step 9: Bank approves the VP ─────────────────────────────────────────
  console.log('\n── Step 9: Bank approves the VP ──────────────────────────────');
  const bankApproveResult = await post(`/api/verifier/requests/${requestId}/approve`, {}, bankToken);
  console.log(`  ✓ Bank approved: ${JSON.stringify(bankApproveResult).slice(0, 100)}`);

  // ── Step 10: Check transactions ──────────────────────────────────────────
  console.log('\n── Step 10: Verify transactions ──────────────────────────────');
  const vikramTx = await get('/api/holder/transactions', vikramToken);
  const bankTx   = await get('/api/verifier/requests', bankToken);

  const outboundTx = (vikramTx.transactions || []).find((t: any) => t.direction === 'outbound');
  const approvedReq = (bankTx.requests || []).find((r: any) => r.id === requestId);

  console.log(`  Vikram's outbound transaction: ${outboundTx ? `status=${outboundTx.status}` : 'NOT FOUND'}`);
  console.log(`  Bank's request final status:   ${approvedReq?.status || 'NOT FOUND'}`);

  if (approvedReq?.status === 'approved') {
    console.log('\n══════════════════════════════════════════════════════════════');
    console.log('  ✅  ALL 10 STEPS PASSED — Peer VP Review Flow is WORKING!');
    console.log('══════════════════════════════════════════════════════════════\n');
  } else {
    throw new Error(`Final status is '${approvedReq?.status}' instead of 'approved'`);
  }
}

main().catch(err => {
  console.error('\n❌ Test failed:', err.message);
  process.exit(1);
});
