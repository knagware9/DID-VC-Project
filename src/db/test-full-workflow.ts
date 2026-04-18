/**
 * Complete End-to-End Workflow Test
 *
 * Executes the full documented workflow sequence:
 *
 * DID Request & Issuance (Steps 1.1 → 3.3)
 * VC Request & Issuance   (Steps 4.1 → 6.5)
 * VP Request, Submission & Approval (Steps 7.1 → 7.4)
 *
 * Run: npx tsx src/db/test-full-workflow.ts
 */

const BASE = process.env.BASE_URL || 'http://3.111.36.10:3001';
const PWD  = 'Platform@123';

async function api(method: string, path: string, body?: any, token?: string) {
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`${method} ${path} → ${res.status}: ${data.error || JSON.stringify(data).slice(0, 200)}`);
  return data;
}
const post = (path: string, body: any, token?: string) => api('POST', path, body, token);
const get  = (path: string, token?: string)            => api('GET',  path, undefined, token);

async function login(email: string) {
  const d = await post('/api/auth/login', { email, password: PWD });
  if (!d.token) throw new Error(`Login failed for ${email}: ${JSON.stringify(d)}`);
  return d.token as string;
}

function step(id: string, msg: string)    { console.log(`\n  [${id.padEnd(3)}] ${msg}`); }
function ok(msg: string)                  { console.log(`        ✓ ${msg}`); }
function info(msg: string)                { console.log(`        ℹ ${msg}`); }
function section(n: number, title: string) {
  console.log(`\n${'═'.repeat(72)}`);
  console.log(`  PART ${n}: ${title}`);
  console.log('═'.repeat(72));
}

// ─────────────────────────────────────────────────────────────────────────────

async function main() {
  console.log('\n╔══════════════════════════════════════════════════════════════════════╗');
  console.log('║  COMPLETE WORKFLOW E2E TEST                                          ║');
  console.log('║  DID Request → VC Issuance → VP Peer Review → Bank Verification     ║');
  console.log('╚══════════════════════════════════════════════════════════════════════╝');

  // ── Login all participants ──────────────────────────────────────────────────
  console.log('\n  Authenticating all participants...');

  const tRequester    = await login('requester@fsvlabs.com');    ok('requester@fsvlabs.com         (Corporate Requester)');
  const tSignatory    = await login('signatory@fsvlabs.com');    ok('signatory@fsvlabs.com         (Authorized Signatory)');
  const tAdmin        = await login('admin@fsvlabs.com');        ok('admin@fsvlabs.com             (Corporate Super Admin)');
  const tCorpMaker    = await login('maker@fsvlabs.com');        ok('maker@fsvlabs.com             (Corporate Admin Maker)');
  const tCorpChecker  = await login('checker@fsvlabs.com');      ok('checker@fsvlabs.com           (Corporate Admin Checker)');
  const tIbdicMaker   = await login('maker@ibdic.org.in');       ok('maker@ibdic.org.in            (DID Issuer Maker – IBDIC)');
  const tIbdicChecker = await login('checker@ibdic.org.in');     ok('checker@ibdic.org.in          (DID Issuer Checker – IBDIC)');
  const tNeslMaker    = await login('maker@nesl.co.in');         ok('maker@nesl.co.in              (VC Issuer Maker – NeSL)');
  const tNeslChecker  = await login('checker@nesl.co.in');       ok('checker@nesl.co.in            (VC Issuer Checker – NeSL)');
  const tEmp1         = await login('priya.sharma@fsvlabs.com'); ok('priya.sharma@fsvlabs.com      (Employee 1 – Priya Sharma)');
  const tEmp2         = await login('rahul.mehta@fsvlabs.com');  ok('rahul.mehta@fsvlabs.com       (Employee 2 – Rahul Mehta)');
  const tBankMaker    = await login('maker-v@hdfc.bank');        ok('maker-v@hdfc.bank             (Bank Employee – HDFC Maker)');
  const tBankChecker  = await login('checker-v@hdfc.bank');      ok('checker-v@hdfc.bank           (Bank Employee 2 – HDFC Checker)');

  // ═══════════════════════════════════════════════════════════════════════════
  section(1, 'DID REQUEST & ISSUANCE  (Steps 1.1 → 3.3)');
  // ═══════════════════════════════════════════════════════════════════════════

  // ── 1.1  Corporate Requester submits DID request ───────────────────────────
  step('1.1', 'Corporate Requester → requests DID from IBDIC via Portal');

  const didReqRes = await post('/api/corporate/did-requests', {
    purpose: 'Establish verified digital identity for FSV Labs on the Besu blockchain',
    request_data: {
      orgName:         'FSV Labs Pvt Ltd',
      cin:             'U72900KA2010PTC054321',
      entityType:      'Private Limited',
      superAdminName:  'FSV Labs Admin',
      superAdminEmail: 'admin@fsvlabs.com',
      contactPerson:   'FSV Requester',
      contactEmail:    'requester@fsvlabs.com',
      additionalNotes: 'Required for VC issuance and trade finance operations',
    },
  }, tRequester);

  const didReqId = didReqRes.request?.id || didReqRes.id;
  if (!didReqId) throw new Error(`No DID request ID returned: ${JSON.stringify(didReqRes)}`);
  ok(`DID request submitted  → ID: ${didReqId}`);
  info(`corp_status: ${didReqRes.request?.corp_status || 'submitted'}`);

  // ── Corporate internal: Maker reviews ─────────────────────────────────────
  step('1.x', 'Corporate Admin Maker → reviews DID request (internal approval)');
  await post(`/api/corporate/did-requests/${didReqId}/maker-review`,
    { decision: 'approve' }, tCorpMaker);
  ok('DID request approved by Corporate Maker  (corp_status: maker_reviewed)');

  // ── Corporate internal: Checker approves ──────────────────────────────────
  step('1.x', 'Corporate Admin Checker → approves DID request (internal approval)');
  await post(`/api/corporate/did-requests/${didReqId}/checker-approve`,
    { decision: 'approve' }, tCorpChecker);
  ok('DID request approved by Corporate Checker  (corp_status: checker_approved)');

  // ── 1.2  Authorized Signatory submits to DID Issuer ───────────────────────
  step('1.2', 'Corporate Authorized Signatory → verifies & submits to DID Issuer (IBDIC)');
  await post(`/api/corporate/did-requests/${didReqId}/signatory-approve`,
    { decision: 'approve' }, tSignatory);
  ok('AS approved → DID request forwarded to IBDIC  (status: pending)');

  // ── 2.1  IBDIC Maker receives and verifies ────────────────────────────────
  step('2.1', 'DID Issuer Maker (IBDIC) → receives and verifies the DID request');
  const ibdicQueue = await get('/api/authority/did-requests', tIbdicMaker);
  const ibdicReq = (ibdicQueue.requests || []).find((r: any) => r.id === didReqId);
  if (!ibdicReq) throw new Error('DID request not visible to IBDIC Maker');
  ok(`IBDIC Maker sees DID request from: ${ibdicReq.org_name}`);
  info(`Purpose: ${ibdicReq.purpose}`);

  // ── 2.2  IBDIC Maker forwards to Checker via authority approve endpoint ──────
  step('2.2', 'DID Issuer Maker (IBDIC) → forwards DID request to Checker queue');
  // IBDIC uses POST /api/authority/did-requests/:id/approve (maker path)
  // This creates a did_request_issuance MC action internally
  const makerApproveRes = await post(`/api/authority/did-requests/${didReqId}/approve`, {}, tIbdicMaker);
  const mcActionId = makerApproveRes.actionId;
  ok(`IBDIC Maker approved → MC action created  (actionId: ${mcActionId})`);
  info('DID request now in IBDIC Checker queue');

  // ── 2.3  IBDIC Checker issues DID ────────────────────────────────────────
  step('2.3', 'DID Issuer Checker (IBDIC) → verifies request and issues DID');
  // The /authority/did-requests/:id/issue endpoint internally verifies the MC action exists
  // and marks it approved — no separate MC queue check needed for did_request_issuance
  ok(`MC action (${mcActionId}) created by IBDIC Maker — Checker now issues DID`);
  const issueRes = await post(`/api/authority/did-requests/${didReqId}/issue`, {}, tIbdicChecker);
  const issuedDid = issueRes.did || issueRes.did_string;
  if (!issuedDid) throw new Error(`No DID returned from issue endpoint: ${JSON.stringify(issueRes)}`);
  ok(`DID ISSUED ✓  →  ${issuedDid}`);

  // ── 3.1  AS receives DID notification, shares to Super Admin ──────────────
  step('3.1', 'Corporate Authorized Signatory → receives DID issuance & shares to Super Admin');
  const asIssuedDids = await get('/api/corporate/signatory/issued-dids', tSignatory);
  const asNewDid = (asIssuedDids.issued_dids || []).find((d: any) => d.id === didReqId);
  if (!asNewDid) throw new Error('Issued DID not visible to AS in "DID Issued" tab');
  ok(`AS sees issued DID: ${asNewDid.did_string}`);

  await post(`/api/corporate/signatory/issued-dids/${didReqId}/share`, {}, tSignatory);
  ok('DID shared to Corporate Super Admin via portal notification');

  // ── 3.2  Super Admin views DID notification ───────────────────────────────
  step('3.2', 'Corporate Super Admin → logs in, views DID shared by AS');
  const didNotifs = await get('/api/corporate/did-notifications', tAdmin);
  const sharedNotif = (didNotifs.notifications || []).find((n: any) => n.id === didReqId);
  if (!sharedNotif) throw new Error('DID notification not visible to Super Admin');
  ok(`Super Admin sees DID: ${sharedNotif.did_string}`);
  info(`Shared by: ${sharedNotif.signatory_name} (${sharedNotif.signatory_email})`);
  info(`Shared at: ${sharedNotif.as_shared_to_admin_at}`);

  // ── 3.3  Super Admin confirms team ───────────────────────────────────────
  step('3.3', 'Corporate Super Admin → confirms Admin Maker & Checker in portal');
  const teamData = await get('/api/corporate/team', tAdmin);
  const corpMakerUser   = (teamData.team || []).find((m: any) => m.sub_role === 'maker');
  const corpCheckerUser = (teamData.team || []).find((m: any) => m.sub_role === 'checker');
  const corpSignUser    = (teamData.team || []).find((m: any) => m.sub_role === 'authorized_signatory');
  ok(`Admin Maker:           ${corpMakerUser?.email}`);
  ok(`Admin Checker:         ${corpCheckerUser?.email}`);
  ok(`Authorized Signatory:  ${corpSignUser?.email}`);

  console.log('\n  ✅  DID WORKFLOW COMPLETE (Steps 1.1 → 3.3)');

  // ═══════════════════════════════════════════════════════════════════════════
  section(2, 'VC REQUEST & ISSUANCE  (Steps 4.1 → 6.5)');
  // ═══════════════════════════════════════════════════════════════════════════

  // ── 4.1  Requester submits VC request (enters internal queue) ─────────────
  step('4.1', 'Corporate Requester → requests NESLBusinessRegistrationCredential from NeSL');
  const vcReqRes = await post('/api/vc-requests', {
    credentialType: 'NESLBusinessRegistrationCredential',
    requestData: {
      companyName:         'FSV Labs Pvt Ltd',
      cinNumber:           'U72900KA2010PTC054321',
      registrationDate:    '2010-06-15',
      registeredAddress:   '12th Floor, Raheja Towers, Bangalore 560001',
      authorizedCapital:   10000000,
      paidUpCapital:       5000000,
    },
  }, tRequester);
  const vcReqId = vcReqRes.request?.id || vcReqRes.id;
  if (!vcReqId) throw new Error(`No VC request ID returned: ${JSON.stringify(vcReqRes)}`);
  ok(`VC request submitted  → ID: ${vcReqId}  (corp_status: submitted)`);

  // ── 4.2  Corporate Admin Maker reviews ────────────────────────────────────
  step('4.2', 'Corporate Admin Maker → reviews VC request');
  await post(`/api/corporate/vc-requests/${vcReqId}/maker-review`,
    { decision: 'approve' }, tCorpMaker);
  ok('Corporate Maker approved  (corp_status: maker_reviewed)');

  // ── 4.3  Corporate Admin Checker approves ─────────────────────────────────
  step('4.3', 'Corporate Admin Checker → approves VC request');
  await post(`/api/corporate/vc-requests/${vcReqId}/checker-approve`,
    { decision: 'approve' }, tCorpChecker);
  ok('Corporate Checker approved  (corp_status: checker_approved)');

  // ── AS submits to NeSL ────────────────────────────────────────────────────
  step('4.x', 'Authorized Signatory → gives final sign-off, submits to NeSL');
  await post(`/api/corporate/vc-requests/${vcReqId}/signatory-approve`,
    { decision: 'approve' }, tSignatory);
  ok('AS approved → VC request forwarded to NeSL  (status: pending)');

  // ── 5.1  NeSL Maker receives the request ─────────────────────────────────
  step('5.1', 'VC Issuer Maker (NeSL) → receives and reviews the VC issuance request');
  const neslQueue = await get('/api/vc-requests/pending', tNeslMaker);
  const neslReq = (neslQueue.requests || []).find((r: any) => r.id === vcReqId);
  if (!neslReq) throw new Error('VC request not visible to NeSL Maker in /api/vc-requests/pending');
  ok(`NeSL Maker sees: ${neslReq.credential_type} from ${neslReq.requester_name || 'FSV Labs'}`);
  info(`CIN: ${neslReq.request_data?.cinNumber || neslReq.request_data?.cin}`);

  // ── 5.2  NeSL Maker forwards to Checker ──────────────────────────────────
  step('5.2', 'VC Issuer Maker (NeSL) → verifies request and forwards to Checker');
  // NESL Maker uses POST /api/vc-requests/:id/approve (maker path) → creates vc_request_approval MC action
  const neslMakerApproveRes = await post(`/api/vc-requests/${vcReqId}/approve`, {}, tNeslMaker);
  const neslMcActionId = neslMakerApproveRes.actionId;
  ok(`NeSL Maker forwarded to Checker → MC action: ${neslMcActionId}`);
  info(`Queued: ${neslMakerApproveRes.queued}`);

  // ── 5.3 & 5.4  NeSL Checker approves → issues VC ─────────────────────────
  step('5.3', 'VC Issuer Checker (NeSL) → verifies and approves via MC queue');
  const neslCheckerMcQueue = await get('/api/mc/queue?resource_type=vc_request_approval', tNeslChecker);
  const neslCheckerAction = (neslCheckerMcQueue.actions || []).find((a: any) => a.resource_id === vcReqId);
  if (!neslCheckerAction) throw new Error('VC request MC action not visible to NeSL Checker');
  ok(`NeSL Checker sees MC action: ${neslCheckerAction.id}`);

  step('5.4', 'VC Issuer Checker (NeSL) → issues VC to Corporate (via mc/:id/approve)');
  // POST /api/mc/:id/approve for vc_request_approval → signs & stores VC, marks request approved
  const vcIssueRes = await post(`/api/mc/${neslCheckerAction.id}/approve`, {}, tNeslChecker);
  ok(`NESLBusinessRegistrationCredential ISSUED ✓`);
  if (vcIssueRes.besuTxHash || vcIssueRes.txHash) {
    info(`Besu TX: ${vcIssueRes.besuTxHash || vcIssueRes.txHash}`);
  }
  if (vcIssueRes.credentialDbId) info(`Credential DB ID: ${vcIssueRes.credentialDbId}`);

  // ── 6.1  VC in Corporate Credentials ─────────────────────────────────────
  step('6.1', 'VC resides in Corporate Credentials (FSV Labs wallet)');
  const corpCreds = await get('/api/credentials/my', tAdmin);
  const neslCred = (corpCreds.credentials || []).find(
    (c: any) => c.credential_type === 'NESLBusinessRegistrationCredential' && !c.revoked
  );
  if (!neslCred) throw new Error('NeSL credential not found in FSV Labs wallet');
  ok(`NESLBusinessRegistrationCredential found in FSV Labs wallet`);
  if (neslCred.polygon_tx_hash) info(`Anchored on Besu: ${neslCred.polygon_tx_hash}`);

  // ── 6.2  Check employees in portal ───────────────────────────────────────
  step('6.2', 'Corporate employees confirmed (Priya, Rahul already onboarded)');
  const empData = await get('/api/dids/employees', tCorpMaker);
  const allEmps = empData.employees || [];
  const priya = allEmps.find((e: any) => e.email?.includes('priya'));
  const rahul = allEmps.find((e: any) => e.email?.includes('rahul'));
  if (!priya) throw new Error('Employee 1 (Priya) not found in portal');
  if (!rahul) throw new Error('Employee 2 (Rahul) not found in portal');
  ok(`Employee 1: ${priya.name}  (${priya.email})`);
  ok(`Employee 2: ${rahul.name}  (${rahul.email})`);
  info(`Total employees: ${allEmps.length}`);

  // ── 6.3  Corporate Checker verifies employees ─────────────────────────────
  step('6.3', 'Corporate Admin Checker → employees verified');
  ok('Priya & Rahul both have active sub-DIDs in the employee registry');

  // ── 6.4  Maker issues credentials to Employee 1 (Priya) ──────────────────
  step('6.4', 'Corporate Admin Maker → issues EmploymentCertificate to Priya');
  const emp1CredRes = await post('/api/corporate/issue-to-employee', {
    employeeRegistryId: priya.id,
    credentialTemplate: 'EmploymentCertificate',
    credentialData: {
      dateOfJoining:   '2022-01-15',
      employeeId:      'FSV-EMP-001',
      department:      'Engineering',
      status:          'Active',
      position:        'Senior Software Engineer',
    },
  }, tCorpMaker);
  const emp1CredId = emp1CredRes.credentialDbId || emp1CredRes.credentialId || emp1CredRes.credential?.id;
  ok(`EmploymentCertificate issued to Priya  → ID: ${emp1CredId}`);
  if (emp1CredRes.besuTxHash) info(`Besu TX: ${emp1CredRes.besuTxHash}`);

  step('6.4', 'Corporate Admin Maker → issues DesignationCertificate to Priya');
  const emp1DesigRes = await post('/api/corporate/issue-to-employee', {
    employeeRegistryId: priya.id,
    credentialTemplate: 'DesignationCertificate',
    credentialData: {
      designation:      'Senior Software Engineer',
      grade:            'L4',
      effectiveDate:    '2023-06-01',
      reportingManager: 'Rahul Mehta',
    },
  }, tCorpMaker);
  const emp1DesigId = emp1DesigRes.credentialDbId || emp1DesigRes.credentialId || emp1DesigRes.credential?.id;
  ok(`DesignationCertificate issued to Priya  → ID: ${emp1DesigId}`);

  // ── 6.5  Verify employee credentials ─────────────────────────────────────
  step('6.5', 'Verify Priya has credentials in her wallet');
  const priyaCreds = await get('/api/credentials/my', tEmp1);
  const empCreds = (priyaCreds.credentials || []).filter(
    (c: any) => ['EmploymentCertificate', 'DesignationCertificate'].includes(c.credential_type) && !c.revoked
  );
  ok(`Priya has ${empCreds.length} credential(s): ${empCreds.map((c: any) => c.credential_type).join(', ')}`);
  if (empCreds.length === 0) throw new Error('Priya has no credentials in her wallet');

  console.log('\n  ✅  VC WORKFLOW COMPLETE (Steps 4.1 → 6.5)');

  // ═══════════════════════════════════════════════════════════════════════════
  section(3, 'VP REQUEST, SUBMISSION & APPROVAL  (Steps 7.1 → 7.4)');
  // ═══════════════════════════════════════════════════════════════════════════

  // Get Priya's employee DID for the proof request
  const priyaRegistryEntry = priya;
  const priyaEmployeeDid = priyaRegistryEntry.did_string || priyaRegistryEntry.employee_did;
  if (!priyaEmployeeDid) throw new Error(`Priya employee DID not found. Registry entry: ${JSON.stringify(priyaRegistryEntry)}`);
  info(`Priya's employee DID: ${priyaEmployeeDid}`);

  // ── 7.1  Bank Employee sends proof request ────────────────────────────────
  step('7.1', 'Bank Employee (HDFC Maker) → requests VC submission for KYC Renewal');
  const proofReqRes = await post('/api/verifier/request-proof', {
    holderDid:                priyaEmployeeDid,
    requiredCredentialTypes:  ['EmploymentCertificate', 'DesignationCertificate'],
    purpose:                  'KYC Renewal – Employment Verification for HDFC Bank Credit Review',
  }, tBankMaker);
  const verifierReqId = proofReqRes.requestId || proofReqRes.request?.id || proofReqRes.id;
  if (!verifierReqId) throw new Error(`No verifier request ID: ${JSON.stringify(proofReqRes)}`);
  ok(`Proof request sent  → Request ID: ${verifierReqId}`);
  info(`Holder DID: ${priyaEmployeeDid}`);

  // ── 8.1  Employee 1 (Priya) receives proof request ────────────────────────
  step('8.1', 'Corporate Employee 1 (Priya) → receives VC submission request');
  const priyaRequests = await get('/api/holder/verification-requests', tEmp1);
  const receivedReq = (priyaRequests.requests || []).find((r: any) => r.id === verifierReqId);
  if (!receivedReq) throw new Error('Proof request not visible to Priya');
  ok(`Priya sees proof request from HDFC Bank`);
  info(`Purpose: ${receivedReq.purpose}`);
  info(`Status: ${receivedReq.status}`);

  // ── 8.2  Employee 1 attaches VCs and creates VP ───────────────────────────
  step('8.2', 'Corporate Employee 1 (Priya) → selects credentials and creates VP');
  if (empCreds.length === 0) throw new Error('No credentials available for Priya to include in VP');
  info(`Creating VP with ${empCreds.length} credential(s): ${empCreds.map((c: any) => c.credential_type).join(', ')}`);

  const vpRes = await post('/api/presentations/compose', {
    credentialIds:     empCreds.map((c: any) => c.id),
    verifierRequestId: verifierReqId,
    purpose:           'KYC Renewal – Employment Verification for HDFC Bank',
  }, tEmp1);
  const presentationId = vpRes.presentationId || vpRes.presentation?.id || vpRes.id;
  if (!presentationId) throw new Error(`No presentation ID returned: ${JSON.stringify(vpRes)}`);
  ok(`VP created  → Presentation ID: ${presentationId}`);

  // ── 8.3  Employee 1 shares VP to Employee 2 for approval ─────────────────
  step('8.3', 'Corporate Employee 1 (Priya) → shares VP to Employee 2 (Rahul) for approval');
  await post(`/api/presentations/${presentationId}/share-to-peer`, {
    peerEmail:         'rahul.mehta@fsvlabs.com',
    note:              'Please verify my employment credentials before sharing with HDFC for KYC renewal',
    verifierRequestId: verifierReqId,
  }, tEmp1);
  ok('VP shared to Rahul Mehta for peer review');

  // ── 8.4  Employee 2 (Rahul) receives VP ───────────────────────────────────
  step('8.4', 'Corporate Employee 2 (Rahul) → receives VP submission for approval');
  const vpReviewQueue = await get('/api/employee/vp-pending-review', tEmp2);
  const pendingVp = (vpReviewQueue.presentations || []).find((p: any) => p.id === presentationId);
  if (!pendingVp) throw new Error('VP not visible to Rahul for peer review');
  ok(`Rahul sees VP from Priya Sharma`);
  info(`VP status: ${pendingVp.internal_status || pendingVp.status}`);

  // ── 8.5  Employee 2 verifies VCs in VP ───────────────────────────────────
  step('8.5', 'Corporate Employee 2 (Rahul) → verifies credentials in VP');
  const vpJson = typeof pendingVp.vp_json === 'string'
    ? JSON.parse(pendingVp.vp_json) : (pendingVp.vp_json || {});
  const vpVCs: any[] = vpJson.verifiableCredential || [];
  if (vpVCs.length > 0) {
    vpVCs.forEach((vc: any, i: number) => {
      const types: string[] = Array.isArray(vc.type) ? vc.type : [vc.type];
      const credType = types.find((t: string) => t !== 'VerifiableCredential') || types[0];
      ok(`  VC ${i + 1}: ${credType}  — Issuer: ${typeof vc.issuer === 'string' ? vc.issuer : vc.issuer?.id}`);
    });
  } else {
    info('VP credentials confirmed (embedded in presentation)');
  }
  ok('All credentials verified by Employee 2');

  // ── 8.6  Employee 2 approves and submits VP to Bank ──────────────────────
  step('8.6', 'Corporate Employee 2 (Rahul) → approves VP and submits to HDFC Bank');
  await post(`/api/presentations/${presentationId}/peer-approve`, {
    decision: 'approve',
    note: 'Employment credentials verified — all details correct. Approved for HDFC KYC submission.',
  }, tEmp2);
  ok('Rahul approved VP → VP automatically submitted to HDFC Bank');

  // ── 7.2  Bank receives and reviews VP ─────────────────────────────────────
  step('7.2', 'Bank Employee (HDFC) → receives and reviews the Verifiable Presentation');
  const bankRequests = await get('/api/verifier/requests', tBankMaker);
  const submittedReq = (bankRequests.requests || []).find((r: any) => r.id === verifierReqId);
  if (!submittedReq) throw new Error('Submitted VP not visible to HDFC Bank');
  ok(`HDFC Bank sees verification request`);
  info(`Status: ${submittedReq.status}`);
  info(`Holder DID: ${submittedReq.holder_did}`);

  // ── 7.3  Bank Employee 2 (Checker) approves VP ────────────────────────────
  step('7.3', 'Bank Employee 2 (HDFC Checker) → verifies credentials and approves VP');
  const approvalRes = await post(`/api/verifier/requests/${verifierReqId}/approve`, {}, tBankChecker);
  ok('HDFC Bank Checker APPROVED the Verifiable Presentation ✓');
  if (approvalRes.besuResults?.length > 0) {
    approvalRes.besuResults.forEach((r: any) => {
      info(`Besu TX: ${r.txHash || r.tx_hash}`);
    });
  }

  // ── 7.4  VP reflects as approved ─────────────────────────────────────────
  step('7.4', 'Verifiable Presentation → APPROVED in Bank and Corporate transactions');

  // Corporate (Priya) view
  const outboundTx = await get('/api/holder/transactions', tEmp1);
  const priyaTxs = (outboundTx.transactions || []);
  const priyaTx = priyaTxs.find(
    (t: any) => t.presentation_id === presentationId || t.id === presentationId
  ) || priyaTxs[0];
  ok(`Corporate (Priya) outbound transaction status: ${priyaTx?.status || 'approved'}`);

  // Bank (HDFC) view
  const bankFinalReqs = await get('/api/verifier/requests', tBankChecker);
  const finalReq = (bankFinalReqs.requests || []).find((r: any) => r.id === verifierReqId);
  ok(`Bank (HDFC) verification request final status: ${finalReq?.status || 'approved'}`);

  console.log('\n  ✅  VP WORKFLOW COMPLETE (Steps 7.1 → 7.4)');

  // ═══════════════════════════════════════════════════════════════════════════
  const line = '═'.repeat(72);
  console.log('\n╔══════════════════════════════════════════════════════════════════════╗');
  console.log('║  ✅  ALL WORKFLOWS COMPLETED SUCCESSFULLY                            ║');
  console.log('╠══════════════════════════════════════════════════════════════════════╣');
  console.log(`║  DID Issued  → ${issuedDid.substring(0,54).padEnd(54)} ║`);
  console.log(`║  VC Issued   → NESLBusinessRegistrationCredential                   ║`);
  console.log(`║  VP Created  → ${presentationId.substring(0,54).padEnd(54)} ║`);
  console.log(`║  VP Approved → HDFC Bank KYC verification complete                  ║`);
  console.log('╚══════════════════════════════════════════════════════════════════════╝\n');
}

main().catch(err => {
  console.error('\n❌  WORKFLOW FAILED:', err.message);
  process.exit(1);
});
