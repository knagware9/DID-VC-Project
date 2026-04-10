/**
 * Express API server for DID VC project
 */
import express from 'express';
import cors from 'cors';
import crypto from 'crypto';
import { runMigrations } from '../db/migrate.js';
import { query } from '../db/index.js';
import { getPolygonService } from '../blockchain/polygon.js';
const polygonService = getPolygonService();
import {
  hashPassword,
  verifyPassword,
  generateToken,
  generateMFACode,
  storeMFACode,
  verifyMFACode,
  createSession,
  getSession,
  deleteSession,
  getUserById,
  getUserByEmail,
  UserRole,
} from './auth.js';

const app = express();
const PORT = process.env.PORT || 3002;

app.use(cors());
app.use(express.json());

// ─── Auth Middleware ──────────────────────────────────────────────────────────

const requireAuth = async (req: express.Request, res: express.Response, next: express.NextFunction) => {
  const token = req.headers.authorization?.replace('Bearer ', '');
  if (!token) return res.status(401).json({ error: 'Authentication required' });

  const session = await getSession(token);
  if (!session) return res.status(401).json({ error: 'Invalid or expired session' });

  const user = await getUserById(session.userId);
  if (!user) return res.status(401).json({ error: 'User not found' });

  (req as any).user = user;
  (req as any).session = session;
  next();
};

const requireRole = (role: UserRole) => (req: express.Request, res: express.Response, next: express.NextFunction) => {
  const user = (req as any).user;
  if (!user || user.role !== role) {
    return res.status(403).json({ error: `This endpoint requires ${role} role` });
  }
  next();
};

const requireSubRole = (subRole: string) => (req: express.Request, res: express.Response, next: express.NextFunction) => {
  const user = (req as any).user;
  if (!user || (user as any).sub_role !== subRole) {
    return res.status(403).json({ error: `This endpoint requires sub_role: ${subRole}` });
  }
  next();
};

// ─── Audit Log Helper ─────────────────────────────────────────────────────────

async function writeAuditLog(eventType: string, actorDid: string | null, subjectDid: string | null, credentialType?: string) {
  const typeHash = credentialType
    ? crypto.createHash('sha256').update(credentialType).digest('hex')
    : null;
  await query(
    'INSERT INTO audit_logs (event_type, actor_did, subject_did, credential_type_hash) VALUES ($1, $2, $3, $4)',
    [eventType, actorDid, subjectDid, typeHash]
  ).catch(console.error);
}

// ─── DID Helpers ──────────────────────────────────────────────────────────────

import { generateKeyPair } from '../utils/crypto.js';

function generateWebDID(name: string): string {
  const slug = name.toLowerCase().replace(/[^a-z0-9]/g, '-').replace(/-+/g, '-');
  const unique = crypto.randomBytes(4).toString('hex');
  return `did:web:didvc.platform:${slug}-${unique}`;
}

function generateSubDID(parentDid: string, employeeId: string): string {
  const unique = crypto.randomBytes(4).toString('hex');
  return `${parentDid}:employee:${employeeId}-${unique}`;
}

async function createAndStoreDID(userId: string, didType: 'parent' | 'sub', parentDidId?: string, customSlug?: string): Promise<{ did: string; id: string; publicKey: string; privateKey: string }> {
  const { privateKey, publicKey } = generateKeyPair();
  const publicKeyHex = Buffer.from(publicKey).toString('hex');
  const privateKeyHex = Buffer.from(privateKey).toString('hex');

  let didString: string;
  if (didType === 'parent') {
    didString = customSlug ? `did:web:didvc.platform:${customSlug}` : generateWebDID(userId);
  } else {
    const parentResult = await query('SELECT did_string FROM dids WHERE id = $1', [parentDidId]);
    const parentDid = parentResult.rows[0]?.did_string || '';
    didString = generateSubDID(parentDid, crypto.randomBytes(4).toString('hex'));
  }

  const result = await query(
    'INSERT INTO dids (did_string, user_id, public_key, private_key_encrypted, did_type, parent_did_id) VALUES ($1, $2, $3, $4, $5, $6) RETURNING id',
    [didString, userId, publicKeyHex, privateKeyHex, didType, parentDidId || null]
  );

  // Register DID on Polygon (async, don't block)
  polygonService.registerDID(didString, publicKeyHex).catch(err =>
    console.error('[Polygon] Failed to register DID:', err.message)
  );

  return { did: didString, id: result.rows[0].id, publicKey: publicKeyHex, privateKey: privateKeyHex };
}

// ─── Health Check ─────────────────────────────────────────────────────────────

app.get('/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// ─── Auth Endpoints ───────────────────────────────────────────────────────────

app.post('/api/auth/register', async (req, res) => {
  try {
    const { email, password, role, name, authority_type } = req.body;
    if (!email || !password || !role) {
      return res.status(400).json({ error: 'Email, password, and role are required' });
    }
    if (!['verifier'].includes(role)) {
      return res.status(400).json({ error: 'Invalid role. Use /api/portal/authorities to create authority accounts.' });
    }

    const existing = await getUserByEmail(email);
    if (existing) return res.status(400).json({ error: 'User already exists' });

    const passwordHash = await hashPassword(password);
    const userName = name || email.split('@')[0];

    const userResult = await query(
      'INSERT INTO users (email, password_hash, role, name, authority_type) VALUES ($1, $2, $3, $4, $5) RETURNING id',
      [email, passwordHash, role, userName, authority_type || null]
    );
    const userId = userResult.rows[0].id;

    // Auto-create DID for government_agency on registration
    let did: string | undefined;
    if (role === 'government_agency') {
      const slug = userName.toLowerCase().replace(/[^a-z0-9]/g, '-');
      const didData = await createAndStoreDID(userId, 'parent', undefined, slug);
      did = didData.did;
    }

    const token = await createSession(userId, role);

    res.json({
      success: true,
      token,
      user: { id: userId, email, role, did, name: userName, authority_type: authority_type || null },
    });
  } catch (error: any) {
    console.error('Register error:', error);
    res.status(500).json({ error: error.message });
  }
});

app.post('/api/auth/login', async (req, res) => {
  try {
    const { email, password } = req.body;
    if (!email || !password) return res.status(400).json({ error: 'Email and password are required' });

    const user = await getUserByEmail(email);
    if (!user || !(await verifyPassword(password, user.password_hash))) {
      return res.status(401).json({ error: 'Invalid credentials' });
    }

    // MFA step: generate code and return temp token
    const mfaCode = generateMFACode();
    const tempToken = storeMFACode(user.id, mfaCode);

    // In production, send code via email/SMS. For prototype, return it in response.
    console.log(`[MFA] Code for ${email}: ${mfaCode}`);

    res.json({
      success: true,
      mfaRequired: true,
      tempToken,
      user: { id: user.id, email: user.email, role: user.role, name: user.name },
    });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

app.post('/api/auth/verify-mfa', async (req, res) => {
  try {
    const { tempToken, code } = req.body;
    if (!tempToken || !code) return res.status(400).json({ error: 'tempToken and code are required' });

    const userId = verifyMFACode(tempToken, code);
    if (!userId) return res.status(401).json({ error: 'Invalid or expired MFA code' });

    const user = await getUserById(userId);
    if (!user) return res.status(404).json({ error: 'User not found' });

    // Get user's DID
    const didResult = await query(
      "SELECT did_string FROM dids WHERE user_id = $1 AND did_type = 'parent' LIMIT 1",
      [userId]
    );
    const did = didResult.rows[0]?.did_string;

    const token = await createSession(userId, user.role);

    res.json({
      success: true,
      token,
      user: { id: user.id, email: user.email, role: user.role, did, name: user.name, authority_type: (user as any).authority_type || null, sub_role: (user as any).sub_role || null, org_id: (user as any).org_id || null },
    });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

app.post('/api/auth/logout', requireAuth, async (req, res) => {
  const token = req.headers.authorization?.replace('Bearer ', '');
  if (token) await deleteSession(token);
  res.json({ success: true });
});

app.get('/api/auth/me', requireAuth, async (req, res) => {
  const user = (req as any).user;
  const didResult = await query(
    "SELECT did_string FROM dids WHERE user_id = $1 AND did_type = 'parent' LIMIT 1",
    [user.id]
  );
  const did = didResult.rows[0]?.did_string;
  res.json({
    success: true,
    user: { id: user.id, email: user.email, role: user.role, did, name: user.name, authority_type: (user as any).authority_type || null, sub_role: (user as any).sub_role || null, org_id: (user as any).org_id || null },
  });
});

// ─── DID Management Endpoints ─────────────────────────────────────────────────

app.get('/api/dids/my', requireAuth, async (req, res) => {
  try {
    const user = (req as any).user;
    const result = await query(
      'SELECT id, did_string, did_type, parent_did_id, created_at FROM dids WHERE user_id = $1 ORDER BY created_at ASC',
      [user.id]
    );
    res.json({ success: true, dids: result.rows });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

app.get('/api/dids/:did/document', async (req, res) => {
  try {
    const { did } = req.params;
    const result = await query('SELECT * FROM dids WHERE did_string = $1', [did]);
    if (result.rows.length === 0) return res.status(404).json({ error: 'DID not found' });

    const didRow = result.rows[0];
    const didDocument = {
      '@context': ['https://www.w3.org/ns/did/v1'],
      id: didRow.did_string,
      verificationMethod: [{
        id: `${didRow.did_string}#keys-1`,
        type: 'EcdsaSecp256k1VerificationKey2019',
        controller: didRow.did_string,
        publicKeyHex: didRow.public_key,
      }],
      authentication: [`${didRow.did_string}#keys-1`],
      assertionMethod: [`${didRow.did_string}#keys-1`],
    };

    res.json({ success: true, didDocument });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// ─── Employee Sub-DID Endpoints (Corporate only) ──────────────────────────────

app.get('/api/dids/employees', requireAuth, requireRole('corporate'), async (req, res) => {
  try {
    const user = (req as any).user;
    const result = await query(
      `SELECT er.*, d.did_string FROM employee_registry er
       LEFT JOIN dids d ON er.sub_did_id = d.id
       WHERE er.corporate_user_id = $1
       ORDER BY er.created_at DESC`,
      [user.id]
    );
    res.json({ success: true, employees: result.rows });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

app.post('/api/dids/employees', requireAuth, requireRole('corporate'), async (req, res) => {
  try {
    const user = (req as any).user;
    const { employeeId, name, email } = req.body;

    if (!employeeId || !name || !email) {
      return res.status(400).json({ error: 'employeeId, name, and email are required' });
    }

    // Get corporate's parent DID
    const parentDidResult = await query(
      "SELECT id FROM dids WHERE user_id = $1 AND did_type = 'parent' LIMIT 1",
      [user.id]
    );
    if (parentDidResult.rows.length === 0) {
      return res.status(400).json({ error: 'Corporate has no parent DID' });
    }
    const parentDidId = parentDidResult.rows[0].id;

    // Create Sub-DID
    const subDidData = await createAndStoreDID(user.id, 'sub', parentDidId);

    // Register employee
    const empResult = await query(
      `INSERT INTO employee_registry (corporate_user_id, employee_id, name, email, sub_did_id)
       VALUES ($1, $2, $3, $4, $5) RETURNING *`,
      [user.id, employeeId, name, email, subDidData.id]
    );

    res.json({ success: true, employee: { ...empResult.rows[0], did_string: subDidData.did } });
  } catch (error: any) {
    if (error.code === '23505') {
      return res.status(400).json({ error: 'Employee ID already exists for this corporate' });
    }
    res.status(500).json({ error: error.message });
  }
});

app.post('/api/dids/employees/bulk', requireAuth, requireRole('corporate'), async (req, res) => {
  try {
    const user = (req as any).user;
    const { employees } = req.body; // [{ employeeId, name, email }]

    if (!Array.isArray(employees) || employees.length === 0) {
      return res.status(400).json({ error: 'employees array is required' });
    }

    const parentDidResult = await query(
      "SELECT id FROM dids WHERE user_id = $1 AND did_type = 'parent' LIMIT 1",
      [user.id]
    );
    if (parentDidResult.rows.length === 0) {
      return res.status(400).json({ error: 'Corporate has no parent DID' });
    }
    const parentDidId = parentDidResult.rows[0].id;

    const created = [];
    const errors = [];

    for (const emp of employees) {
      try {
        const subDidData = await createAndStoreDID(user.id, 'sub', parentDidId);
        const empResult = await query(
          `INSERT INTO employee_registry (corporate_user_id, employee_id, name, email, sub_did_id)
           VALUES ($1, $2, $3, $4, $5) RETURNING *`,
          [user.id, emp.employeeId, emp.name, emp.email, subDidData.id]
        );
        created.push({ ...empResult.rows[0], did_string: subDidData.did });
      } catch (err: any) {
        errors.push({ employeeId: emp.employeeId, error: err.message });
      }
    }

    res.json({ success: true, created, errors });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// ─── VC Request Endpoints ─────────────────────────────────────────────────────

app.post('/api/vc-requests', requireAuth, requireRole('corporate'), async (req, res) => {
  try {
    const user = (req as any).user;
    const { credentialType, requestData, targetIssuerId } = req.body;

    if (!credentialType) return res.status(400).json({ error: 'credentialType is required' });

    const didResult = await query(
      "SELECT id FROM dids WHERE user_id = $1 AND did_type = 'parent' LIMIT 1",
      [user.id]
    );
    const requesterDidId = didResult.rows[0]?.id || null;

    // Find a government_agency issuer (or specific one if targetIssuerId provided)
    const issuerResult = await query(
      "SELECT id FROM users WHERE role = 'government_agency' LIMIT 1"
    );
    const issuerUserId = targetIssuerId || issuerResult.rows[0]?.id || null;

    const result = await query(
      `INSERT INTO vc_requests (requester_user_id, requester_did_id, issuer_user_id, credential_type, request_data)
       VALUES ($1, $2, $3, $4, $5) RETURNING *`,
      [user.id, requesterDidId, issuerUserId, credentialType, JSON.stringify(requestData || {})]
    );

    res.json({ success: true, request: result.rows[0] });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

app.get('/api/vc-requests/my', requireAuth, async (req, res) => {
  try {
    const user = (req as any).user;
    const result = await query(
      `SELECT vcr.*, u.name as issuer_name FROM vc_requests vcr
       LEFT JOIN users u ON vcr.issuer_user_id = u.id
       WHERE vcr.requester_user_id = $1
       ORDER BY vcr.created_at DESC`,
      [user.id]
    );
    res.json({ success: true, requests: result.rows });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

app.get('/api/vc-requests/pending', requireAuth, requireRole('government_agency'), async (req, res) => {
  try {
    const user = (req as any).user;
    const result = await query(
      `SELECT vcr.*, u.name as requester_name, u.email as requester_email, d.did_string as requester_did
       FROM vc_requests vcr
       JOIN users u ON vcr.requester_user_id = u.id
       LEFT JOIN dids d ON vcr.requester_did_id = d.id
       WHERE vcr.issuer_user_id = $1 AND vcr.status = 'pending'
       ORDER BY vcr.created_at ASC`,
      [user.id]
    );
    res.json({ success: true, requests: result.rows });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

app.get('/api/vc-requests/issued', requireAuth, requireRole('government_agency'), async (req, res) => {
  try {
    const user = (req as any).user;
    const result = await query(
      `SELECT vcr.*, u.name as requester_name, u.email as requester_email
       FROM vc_requests vcr
       JOIN users u ON vcr.requester_user_id = u.id
       WHERE vcr.issuer_user_id = $1 AND vcr.status != 'pending'
       ORDER BY vcr.updated_at DESC`,
      [user.id]
    );
    res.json({ success: true, requests: result.rows });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

app.post('/api/vc-requests/:id/approve', requireAuth, requireRole('government_agency'), async (req, res) => {
  try {
    const user = (req as any).user;
    const { id } = req.params;

    const reqResult = await query('SELECT * FROM vc_requests WHERE id = $1 AND issuer_user_id = $2', [id, user.id]);
    if (reqResult.rows.length === 0) return res.status(404).json({ error: 'Request not found' });
    const vcReq = reqResult.rows[0];

    if (vcReq.status !== 'pending') return res.status(400).json({ error: 'Request is not pending' });

    // Get issuer DID
    const issuerDidResult = await query(
      "SELECT id, did_string, private_key_encrypted FROM dids WHERE user_id = $1 AND did_type = 'parent' LIMIT 1",
      [user.id]
    );
    if (issuerDidResult.rows.length === 0) return res.status(400).json({ error: 'Issuer has no DID' });
    const issuerDid = issuerDidResult.rows[0];

    // Build VC JSON
    const now = new Date();
    const expiresAt = new Date(now.getTime() + 365 * 24 * 60 * 60 * 1000);
    const vcId = `urn:uuid:${crypto.randomUUID()}`;

    // Sign with Ed25519
    const privateKeyBytes = Buffer.from(issuerDid.private_key_encrypted, 'hex');
    const vcPayload = {
      '@context': ['https://www.w3.org/2018/credentials/v1'],
      id: vcId,
      type: ['VerifiableCredential', vcReq.credential_type],
      issuer: issuerDid.did_string,
      issuanceDate: now.toISOString(),
      expirationDate: expiresAt.toISOString(),
      credentialSubject: {
        ...vcReq.request_data,
        id: vcReq.requester_did_id ? (await query('SELECT did_string FROM dids WHERE id = $1', [vcReq.requester_did_id])).rows[0]?.did_string : undefined,
      },
    };

    const dataToSign = Buffer.from(JSON.stringify(vcPayload));
    const signatureHex = crypto.createHmac('sha256', privateKeyBytes).update(dataToSign).digest('hex');

    const signedVC = {
      ...vcPayload,
      proof: {
        type: 'EcdsaSecp256k1Signature2019',
        created: now.toISOString(),
        proofPurpose: 'assertionMethod',
        verificationMethod: `${issuerDid.did_string}#keys-1`,
        jws: signatureHex,
      },
    };

    // Store credential in DB
    const credResult = await query(
      `INSERT INTO credentials (vc_json, holder_did_id, issuer_did_id, credential_type, issued_at, expires_at, vc_request_id)
       VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING id`,
      [JSON.stringify(signedVC), vcReq.requester_did_id, issuerDid.id, vcReq.credential_type, now, expiresAt, id]
    );

    // Update request status
    await query('UPDATE vc_requests SET status = $1, updated_at = NOW() WHERE id = $2', ['approved', id]);

    await writeAuditLog('vc_issued', issuerDid.did_string, null, vcReq.credential_type);

    // Anchor VC hash on Polygon blockchain
    let polygonTxHash: string | undefined;
    try {
      const holderDidString = vcReq.requester_did_id
        ? (await query('SELECT did_string FROM dids WHERE id = $1', [vcReq.requester_did_id])).rows[0]?.did_string || ''
        : '';
      const anchored = await polygonService.anchorVC(
        vcId,
        signedVC,
        issuerDid.did_string,
        holderDidString,
        vcReq.credential_type,
        expiresAt
      );
      polygonTxHash = anchored.txHash;
      console.log(`[Polygon] VC anchored: ${polygonTxHash}`);
    } catch (err: any) {
      console.error('[Polygon] Anchor failed:', err.message);
    }

    res.json({ success: true, credential: signedVC, credentialDbId: credResult.rows[0].id, polygonTxHash });
  } catch (error: any) {
    console.error('Approve error:', error);
    res.status(500).json({ error: error.message });
  }
});

app.post('/api/vc-requests/:id/reject', requireAuth, requireRole('government_agency'), async (req, res) => {
  try {
    const user = (req as any).user;
    const { id } = req.params;
    const { reason } = req.body;

    const result = await query(
      'UPDATE vc_requests SET status = $1, rejection_reason = $2, updated_at = NOW() WHERE id = $3 AND issuer_user_id = $4 AND status = $5 RETURNING *',
      ['rejected', reason || 'No reason provided', id, user.id, 'pending']
    );
    if (result.rows.length === 0) return res.status(404).json({ error: 'Request not found or not pending' });

    res.json({ success: true, request: result.rows[0] });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// ─── Credentials Endpoints ────────────────────────────────────────────────────

app.get('/api/credentials/my', requireAuth, async (req, res) => {
  try {
    const user = (req as any).user;
    const didResult = await query(
      "SELECT id FROM dids WHERE user_id = $1 AND did_type = 'parent' LIMIT 1",
      [user.id]
    );
    if (didResult.rows.length === 0) return res.json({ success: true, credentials: [] });

    const result = await query(
      `SELECT c.*, d.did_string as issuer_did_string FROM credentials c
       LEFT JOIN dids d ON c.issuer_did_id = d.id
       WHERE c.holder_did_id = $1
       ORDER BY c.issued_at DESC`,
      [didResult.rows[0].id]
    );
    res.json({ success: true, credentials: result.rows });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// ─── Corporate Internal Issuance Endpoints ────────────────────────────────────

app.post('/api/corporate/issue-to-employee', requireAuth, requireRole('corporate'), async (req, res) => {
  try {
    const user = (req as any).user;
    const { employeeRegistryId, credentialTemplate, credentialData } = req.body;

    if (!employeeRegistryId || !credentialTemplate) {
      return res.status(400).json({ error: 'employeeRegistryId and credentialTemplate are required' });
    }

    const templates: Record<string, string[]> = {
      EmploymentCertificate: ['dateOfJoining', 'employeeId', 'department', 'status'],
      DesignationCertificate: ['currentRole', 'grade', 'effectiveDate'],
    };
    if (!templates[credentialTemplate]) {
      return res.status(400).json({ error: `Invalid template. Use: ${Object.keys(templates).join(', ')}` });
    }

    // Get employee's sub-DID
    const empResult = await query(
      'SELECT er.*, d.id as did_db_id, d.did_string FROM employee_registry er JOIN dids d ON er.sub_did_id = d.id WHERE er.id = $1 AND er.corporate_user_id = $2',
      [employeeRegistryId, user.id]
    );
    if (empResult.rows.length === 0) return res.status(404).json({ error: 'Employee not found' });
    const employee = empResult.rows[0];

    // Get corporate's DID (issuer)
    const corpDidResult = await query(
      "SELECT id, did_string, private_key_encrypted FROM dids WHERE user_id = $1 AND did_type = 'parent' LIMIT 1",
      [user.id]
    );
    if (corpDidResult.rows.length === 0) return res.status(400).json({ error: 'Corporate has no DID' });
    const corpDid = corpDidResult.rows[0];

    const now = new Date();
    const expiresAt = new Date(now.getTime() + 365 * 24 * 60 * 60 * 1000);
    const vcId = `urn:uuid:${crypto.randomUUID()}`;

    const subject: Record<string, any> = { id: employee.did_string };
    for (const field of templates[credentialTemplate]) {
      if (credentialData[field] !== undefined) subject[field] = credentialData[field];
    }

    const privateKeyBytes = Buffer.from(corpDid.private_key_encrypted, 'hex');
    const vcPayload = {
      '@context': ['https://www.w3.org/2018/credentials/v1'],
      id: vcId,
      type: ['VerifiableCredential', credentialTemplate],
      issuer: corpDid.did_string,
      issuanceDate: now.toISOString(),
      expirationDate: expiresAt.toISOString(),
      credentialSubject: subject,
    };

    const dataToSign = Buffer.from(JSON.stringify(vcPayload));
    const signatureHex = crypto.createHmac('sha256', privateKeyBytes).update(dataToSign).digest('hex');

    const signedVC = {
      ...vcPayload,
      proof: {
        type: 'EcdsaSecp256k1Signature2019',
        created: now.toISOString(),
        proofPurpose: 'assertionMethod',
        verificationMethod: `${corpDid.did_string}#keys-1`,
        jws: signatureHex,
      },
    };

    const credResult = await query(
      `INSERT INTO credentials (vc_json, holder_did_id, issuer_did_id, credential_type, issued_at, expires_at)
       VALUES ($1, $2, $3, $4, $5, $6) RETURNING id`,
      [JSON.stringify(signedVC), employee.did_db_id, corpDid.id, credentialTemplate, now, expiresAt]
    );

    await writeAuditLog('vc_issued', corpDid.did_string, employee.did_string, credentialTemplate);

    // Anchor VC hash on Polygon blockchain
    let polygonTxHash: string | undefined;
    try {
      const anchored = await polygonService.anchorVC(
        vcId,
        signedVC,
        corpDid.did_string,
        employee.did_string,
        credentialTemplate,
        expiresAt
      );
      polygonTxHash = anchored.txHash;
      console.log(`[Polygon] VC anchored: ${polygonTxHash}`);
    } catch (err: any) {
      console.error('[Polygon] Anchor failed:', err.message);
    }

    res.json({ success: true, credential: signedVC, credentialDbId: credResult.rows[0].id, polygonTxHash });
  } catch (error: any) {
    console.error('Issue to employee error:', error);
    res.status(500).json({ error: error.message });
  }
});

app.get('/api/corporate/issued', requireAuth, requireRole('corporate'), async (req, res) => {
  try {
    const user = (req as any).user;
    const corpDidResult = await query(
      "SELECT id FROM dids WHERE user_id = $1 AND did_type = 'parent' LIMIT 1",
      [user.id]
    );
    if (corpDidResult.rows.length === 0) return res.json({ success: true, credentials: [] });

    const result = await query(
      `SELECT c.*, d.did_string as holder_did_string,
              er.name as employee_name, er.employee_id
       FROM credentials c
       LEFT JOIN dids d ON c.holder_did_id = d.id
       LEFT JOIN employee_registry er ON er.sub_did_id = d.id
       WHERE c.issuer_did_id = $1
       ORDER BY c.issued_at DESC`,
      [corpDidResult.rows[0].id]
    );
    res.json({ success: true, credentials: result.rows });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

app.post('/api/corporate/revoke/:credentialId', requireAuth, requireRole('corporate'), async (req, res) => {
  try {
    const user = (req as any).user;
    const { credentialId } = req.params;

    const corpDidResult = await query(
      "SELECT id FROM dids WHERE user_id = $1 AND did_type = 'parent' LIMIT 1",
      [user.id]
    );
    if (corpDidResult.rows.length === 0) return res.status(400).json({ error: 'Corporate has no DID' });

    const credResult = await query(
      'SELECT id FROM credentials WHERE id = $1 AND issuer_did_id = $2',
      [credentialId, corpDidResult.rows[0].id]
    );
    if (credResult.rows.length === 0) return res.status(404).json({ error: 'Credential not found or not issued by you' });

    await query('UPDATE credentials SET revoked = TRUE WHERE id = $1', [credentialId]);
    await query(
      'INSERT INTO revocation_list (credential_id, revoked_by_user_id) VALUES ($1, $2)',
      [credentialId, user.id]
    );

    // Revoke on Polygon blockchain
    const credVcRow = await query('SELECT vc_json FROM credentials WHERE id = $1', [credentialId]);
    if (credVcRow.rows[0]) {
      const vcId = credVcRow.rows[0].vc_json?.id || credentialId;
      polygonService.revokeVCOnChain(vcId).catch(err => console.error('[Polygon] Revoke failed:', err.message));
    }

    res.json({ success: true, message: 'Credential revoked' });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// ─── VP Composition Endpoints ─────────────────────────────────────────────────

app.post('/api/presentations/compose', requireAuth, async (req, res) => {
  try {
    const user = (req as any).user;
    const { credentialIds, selectedFields, verifierRequestId, purpose } = req.body;

    if (!credentialIds || !Array.isArray(credentialIds) || credentialIds.length === 0) {
      return res.status(400).json({ error: 'credentialIds array is required' });
    }

    const holderDidResult = await query(
      "SELECT id, did_string, private_key_encrypted FROM dids WHERE user_id = $1 AND did_type = 'parent' LIMIT 1",
      [user.id]
    );
    if (holderDidResult.rows.length === 0) return res.status(400).json({ error: 'User has no DID' });
    const holderDid = holderDidResult.rows[0];

    // Fetch credentials
    const credResult = await query(
      'SELECT * FROM credentials WHERE id = ANY($1) AND revoked = FALSE',
      [credentialIds]
    );

    const vcList = credResult.rows.map((row: any) => {
      const vc = row.vc_json;
      if (selectedFields && selectedFields[row.id]) {
        const fields = selectedFields[row.id];
        const subject: Record<string, any> = {};
        if (vc.credentialSubject?.id) subject.id = vc.credentialSubject.id;
        for (const field of fields) {
          if (vc.credentialSubject?.[field] !== undefined) {
            subject[field] = vc.credentialSubject[field];
          }
        }
        return { ...vc, credentialSubject: subject };
      }
      return vc;
    });

    const now = new Date();
    const vpPayload = {
      '@context': ['https://www.w3.org/2018/credentials/v1'],
      type: ['VerifiablePresentation'],
      verifiableCredential: vcList,
      holder: holderDid.did_string,
      purpose: purpose || 'general',
    };

    const privateKeyBytes = Buffer.from(holderDid.private_key_encrypted, 'hex');
    const dataToSign = Buffer.from(JSON.stringify(vpPayload));
    const signatureHex = crypto.createHmac('sha256', privateKeyBytes).update(dataToSign).digest('hex');

    const signedVP = {
      ...vpPayload,
      proof: {
        type: 'EcdsaSecp256k1Signature2019',
        created: now.toISOString(),
        proofPurpose: 'authentication',
        verificationMethod: `${holderDid.did_string}#keys-1`,
        jws: signatureHex,
      },
    };

    const presResult = await query(
      'INSERT INTO presentations (vp_json, holder_did_id, verifier_request_id) VALUES ($1, $2, $3) RETURNING id',
      [JSON.stringify(signedVP), holderDid.id, verifierRequestId || null]
    );

    // Update verification request with presentation
    if (verifierRequestId) {
      await query(
        "UPDATE verification_requests SET presentation_id = $1, status = 'submitted', updated_at = NOW() WHERE id = $2",
        [presResult.rows[0].id, verifierRequestId]
      );
    }

    await writeAuditLog('vp_created', holderDid.did_string, null, 'VerifiablePresentation');

    res.json({ success: true, presentation: signedVP, presentationId: presResult.rows[0].id });
  } catch (error: any) {
    console.error('Compose VP error:', error);
    res.status(500).json({ error: error.message });
  }
});

app.get('/api/presentations/:id', requireAuth, async (req, res) => {
  try {
    const { id } = req.params;
    const result = await query('SELECT * FROM presentations WHERE id = $1', [id]);
    if (result.rows.length === 0) return res.status(404).json({ error: 'Presentation not found' });
    res.json({ success: true, presentation: result.rows[0].vp_json });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// ─── Verification Request Endpoints ──────────────────────────────────────────

app.post('/api/verifier/request-proof', requireAuth, requireRole('verifier'), async (req, res) => {
  try {
    const user = (req as any).user;
    const { requiredCredentialTypes, holderDid } = req.body;

    // Look up holder DID UUID if provided
    let holderDidId: string | null = null;
    if (holderDid) {
      const didRow = await query(`SELECT id FROM dids WHERE did_string = $1`, [holderDid]);
      if (didRow.rows.length === 0) {
        return res.status(400).json({ error: `Holder DID not found: ${holderDid}` });
      }
      holderDidId = didRow.rows[0].id;
    }

    const challenge = crypto.randomBytes(16).toString('hex');
    const result = await query(
      `INSERT INTO verification_requests (verifier_user_id, holder_did_id, required_credential_types, challenge)
       VALUES ($1, $2, $3, $4) RETURNING *`,
      [user.id, holderDidId, requiredCredentialTypes || [], challenge]
    );

    res.json({ success: true, request: result.rows[0] });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

app.get('/api/verifier/requests', requireAuth, requireRole('verifier'), async (req, res) => {
  try {
    const user = (req as any).user;
    const result = await query(
      `SELECT vr.*, p.vp_json FROM verification_requests vr
       LEFT JOIN presentations p ON vr.presentation_id = p.id
       WHERE vr.verifier_user_id = $1
       ORDER BY vr.created_at DESC`,
      [user.id]
    );
    res.json({ success: true, requests: result.rows });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// Holder: get verification requests targeted at my DID
app.get('/api/holder/verification-requests', requireAuth, requireRole('corporate'), async (req, res) => {
  try {
    const user = (req as any).user;
    // Get holder's primary DID
    const didRow = await query(
      `SELECT id FROM dids WHERE user_id = $1 AND parent_did_id IS NULL LIMIT 1`,
      [user.id]
    );
    if (didRow.rows.length === 0) {
      return res.json({ success: true, requests: [] });
    }
    const holderDidId = didRow.rows[0].id;

    const result = await query(
      `SELECT vr.*, u.name AS verifier_name, u.email AS verifier_email
       FROM verification_requests vr
       JOIN users u ON vr.verifier_user_id = u.id
       WHERE vr.holder_did_id = $1
       ORDER BY vr.created_at DESC`,
      [holderDidId]
    );
    res.json({ success: true, requests: result.rows });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

app.post('/api/verifier/requests/:id/approve', requireAuth, requireRole('verifier'), async (req, res) => {
  try {
    const user = (req as any).user;
    const { id } = req.params;

    const vrResult = await query('SELECT * FROM verification_requests WHERE id = $1 AND verifier_user_id = $2', [id, user.id]);
    if (vrResult.rows.length === 0) return res.status(404).json({ error: 'Verification request not found' });

    const vr = vrResult.rows[0];
    if (!vr.presentation_id) return res.status(400).json({ error: 'No presentation submitted yet' });

    // Verify: check credentials are not revoked
    const presResult = await query('SELECT vp_json FROM presentations WHERE id = $1', [vr.presentation_id]);
    const vp = presResult.rows[0]?.vp_json;
    const vcList = vp?.verifiableCredential || [];

    for (const vc of vcList) {
      if (vc.id) {
        const credResult = await query('SELECT revoked FROM credentials WHERE vc_json->>\'id\' = $1', [vc.id]);
        if (credResult.rows[0]?.revoked) {
          return res.status(400).json({ error: `Credential ${vc.id} has been revoked` });
        }
      }
    }

    await query(
      "UPDATE verification_requests SET status = 'approved', updated_at = NOW() WHERE id = $1",
      [id]
    );

    await writeAuditLog('verification_approved', null, null, 'VerifiablePresentation');

    // Verify on Polygon
    const polygonResults = [];
    for (const vc of vcList) {
      if (vc.id) {
        const onChainResult = await polygonService.verifyVCOnChain(vc.id, vc);
        polygonResults.push({ vcId: vc.id, ...onChainResult });
      }
    }

    res.json({ success: true, message: 'Verification approved', polygonResults });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

app.post('/api/verifier/requests/:id/reject', requireAuth, requireRole('verifier'), async (req, res) => {
  try {
    const user = (req as any).user;
    const { id } = req.params;
    const { reason } = req.body;

    await query(
      "UPDATE verification_requests SET status = 'rejected', rejection_reason = $1, updated_at = NOW() WHERE id = $2 AND verifier_user_id = $3",
      [reason || 'No reason provided', id, user.id]
    );

    await writeAuditLog('verification_rejected', null, null, 'VerifiablePresentation');

    res.json({ success: true, message: 'Verification rejected' });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// ─── Issuer Direct Issuance & Holder Sharing Endpoints ────────────────────────

// 1. GET /api/users/holders — list corporate users with parent DID strings
app.get('/api/users/holders', requireAuth, requireRole('government_agency'), async (req, res) => {
  try {
    const result = await query(
      `SELECT u.id, u.name, u.email, d.did_string
       FROM users u
       JOIN dids d ON d.user_id = u.id
       WHERE u.role = 'corporate' AND d.parent_did_id IS NULL
       ORDER BY u.name`,
      []
    );
    res.json({ success: true, holders: result.rows });
  } catch (error: any) {
    console.error('Get holders error:', error);
    res.status(500).json({ error: error.message });
  }
});

// 2. GET /api/users/issuers — list government_agency users with parent DID strings
app.get('/api/users/issuers', requireAuth, requireRole('corporate'), async (req, res) => {
  try {
    const result = await query(
      `SELECT u.id, u.name, u.email, d.did_string
       FROM users u
       JOIN dids d ON d.user_id = u.id
       WHERE u.role = 'government_agency' AND d.parent_did_id IS NULL
       ORDER BY u.name`,
      []
    );
    res.json({ success: true, issuers: result.rows });
  } catch (error: any) {
    console.error('Get issuers error:', error);
    res.status(500).json({ error: error.message });
  }
});

// 3. POST /api/credentials/issue-direct — issue a VC directly without a request
app.post('/api/credentials/issue-direct', requireAuth, async (req, res) => {
  try {
    const user = (req as any).user;
    if (user.role !== 'government_agency' && user.role !== 'corporate') {
      return res.status(403).json({ error: 'Forbidden' });
    }
    const { holderDid: holderDidString, credentialType, credentialSubject, expiresAt: expiresAtRaw } = req.body;

    if (!holderDidString) return res.status(400).json({ error: 'holderDid is required' });
    if (!credentialType) return res.status(400).json({ error: 'credentialType is required' });
    if (!credentialSubject || typeof credentialSubject !== 'object' || Array.isArray(credentialSubject)) {
      return res.status(400).json({ error: 'credentialSubject must be a valid object' });
    }

    // 1. Validate holderDid exists
    const holderDidResult = await query(
      'SELECT id, did_string FROM dids WHERE did_string = $1 LIMIT 1',
      [holderDidString]
    );
    if (holderDidResult.rows.length === 0) return res.status(404).json({ error: 'Holder DID not found' });
    const holderDid = holderDidResult.rows[0];

    // 2. Get issuer's parent DID
    const issuerDidResult = await query(
      `SELECT id, did_string, private_key_encrypted FROM dids WHERE user_id = $1 AND did_type = 'parent' LIMIT 1`,
      [user.id]
    );
    if (issuerDidResult.rows.length === 0) return res.status(400).json({ error: 'Issuer has no DID' });
    const issuerDid = issuerDidResult.rows[0];

    // 3. Build and sign VC
    const vcId = `urn:uuid:${crypto.randomUUID()}`;
    const now = new Date();
    const expiresAt = expiresAtRaw ? new Date(expiresAtRaw) : new Date(Date.now() + 365 * 24 * 60 * 60 * 1000);
    const privateKeyBytes = Buffer.from(issuerDid.private_key_encrypted, 'hex');
    const vcPayload = {
      '@context': ['https://www.w3.org/2018/credentials/v1'],
      id: vcId,
      type: ['VerifiableCredential', credentialType],
      issuer: issuerDid.did_string,
      issuanceDate: now.toISOString(),
      expirationDate: expiresAt.toISOString(),
      credentialSubject: { ...credentialSubject, id: holderDid.did_string }
    };
    const dataToSign = Buffer.from(JSON.stringify(vcPayload));
    const signatureHex = crypto.createHmac('sha256', privateKeyBytes).update(dataToSign).digest('hex');
    const signedVC = {
      ...vcPayload,
      proof: {
        type: 'EcdsaSecp256k1Signature2019',
        created: now.toISOString(),
        proofPurpose: 'assertionMethod',
        verificationMethod: `${issuerDid.did_string}#keys-1`,
        jws: signatureHex
      }
    };

    // 4. Store credential
    const credResult = await query(
      `INSERT INTO credentials (vc_json, holder_did_id, issuer_did_id, credential_type, issued_at, expires_at)
       VALUES ($1, $2, $3, $4, $5, $6) RETURNING id`,
      [JSON.stringify(signedVC), holderDid.id, issuerDid.id, credentialType, now, expiresAt]
    );

    // 5. Anchor on Polygon
    let polygonTxHash: string | undefined;
    try {
      const anchored = await polygonService.anchorVC(vcId, signedVC, issuerDid.did_string, holderDid.did_string, credentialType, expiresAt);
      polygonTxHash = anchored.txHash;
    } catch (err: any) { console.error('[Polygon] Anchor failed:', err.message); }

    // 6. Audit log
    await writeAuditLog('vc_issued_direct', issuerDid.did_string, holderDid.did_string, credentialType);

    // 7. Response
    res.json({ success: true, credential: signedVC, credentialId: credResult.rows[0].id, polygonTxHash });
  } catch (error: any) {
    console.error('Issue direct error:', error);
    res.status(500).json({ error: error.message });
  }
});

// 4. POST /api/credentials/:id/share-qr — generate a shareable QR token for a credential
app.post('/api/credentials/:id/share-qr', requireAuth, requireRole('corporate'), async (req, res) => {
  try {
    const user = (req as any).user;
    const credentialId = req.params.id;

    // Get caller's parent DID
    const callerDidResult = await query(
      `SELECT id, did_string, private_key_encrypted FROM dids WHERE user_id = $1 AND did_type = 'parent' LIMIT 1`,
      [user.id]
    );
    if (callerDidResult.rows.length === 0) return res.status(400).json({ error: 'No DID found for user' });
    const holderDid = callerDidResult.rows[0];

    // Verify credential belongs to caller
    const credResult = await query(
      `SELECT * FROM credentials WHERE id = $1 AND holder_did_id = $2 AND revoked = FALSE`,
      [credentialId, holderDid.id]
    );
    if (credResult.rows.length === 0) return res.status(404).json({ error: 'Credential not found or access denied' });
    const credential = credResult.rows[0];

    // Build VP from single credential
    const now = new Date();
    const vcList = [credential.vc_json];
    const vpPayload = {
      '@context': ['https://www.w3.org/2018/credentials/v1'],
      type: ['VerifiablePresentation'],
      verifiableCredential: vcList,
      holder: holderDid.did_string,
      purpose: 'general'
    };
    const privateKeyBytes = Buffer.from(holderDid.private_key_encrypted, 'hex');
    const dataToSign = Buffer.from(JSON.stringify(vpPayload));
    const signatureHex = crypto.createHmac('sha256', privateKeyBytes).update(dataToSign).digest('hex');
    const signedVP = {
      ...vpPayload,
      proof: {
        type: 'EcdsaSecp256k1Signature2019',
        created: now.toISOString(),
        proofPurpose: 'authentication',
        verificationMethod: `${holderDid.did_string}#keys-1`,
        jws: signatureHex
      }
    };

    // Generate token and insert share record
    const token = crypto.randomBytes(16).toString('hex');
    const shareResult = await query(
      `INSERT INTO credential_shares (credential_id, presentation_json, token, expires_at)
       VALUES ($1, $2, $3, NOW() + INTERVAL '7 days') RETURNING id, token, expires_at`,
      [credentialId, JSON.stringify(signedVP), token]
    );

    const share = shareResult.rows[0];
    res.json({ success: true, token: share.token, expiresAt: share.expires_at });
  } catch (error: any) {
    console.error('Share QR error:', error);
    res.status(500).json({ error: error.message });
  }
});

// 5. GET /api/share/:token — public endpoint to retrieve a shared credential presentation
app.get('/api/share/:token', async (req, res) => {
  try {
    const { token } = req.params;

    const result = await query(
      `SELECT cs.*, c.credential_type, c.vc_json, c.issued_at, c.revoked,
              d.did_string as issuer_did
       FROM credential_shares cs
       JOIN credentials c ON cs.credential_id = c.id
       LEFT JOIN dids d ON c.issuer_did_id = d.id
       WHERE cs.token = $1`,
      [token]
    );
    if (result.rows.length === 0) return res.status(404).json({ error: 'Share not found or expired' });
    const share = result.rows[0];

    // Check expiry
    if (share.expires_at && new Date(share.expires_at) < new Date()) {
      return res.status(410).json({ error: 'Share link has expired' });
    }

    // Increment scanned_count and get updated value
    const updatedShare = await query(
      `UPDATE credential_shares SET scanned_count = scanned_count + 1 WHERE id = $1 RETURNING scanned_count`,
      [share.id]
    );

    res.json({
      success: true,
      presentation: share.presentation_json,
      credentialType: share.credential_type,
      issuerDid: share.issuer_did,
      issuedAt: share.issued_at,
      revoked: share.revoked,
      expiresAt: share.expires_at,
      scannedCount: updatedShare.rows[0]?.scanned_count ?? share.scanned_count + 1
    });
  } catch (error: any) {
    console.error('Share token error:', error);
    res.status(500).json({ error: error.message });
  }
});

// 6. POST /api/presentations/share-to-did — share a VP directly to a verifier DID
app.post('/api/presentations/share-to-did', requireAuth, requireRole('corporate'), async (req, res) => {
  try {
    const user = (req as any).user;
    const { credentialIds, verifierDid: verifierDidString, purpose } = req.body;

    if (!Array.isArray(credentialIds) || credentialIds.length === 0) {
      return res.status(400).json({ error: 'credentialIds must be a non-empty array' });
    }
    if (!verifierDidString) return res.status(400).json({ error: 'verifierDid is required' });

    // Get holder's DID
    const holderDidResult = await query(
      `SELECT id, did_string, private_key_encrypted FROM dids WHERE user_id = $1 AND did_type = 'parent' LIMIT 1`,
      [user.id]
    );
    if (holderDidResult.rows.length === 0) return res.status(400).json({ error: 'No DID found for user' });
    const holderDid = holderDidResult.rows[0];

    // Fetch credentials (verify ownership)
    const credResult = await query(
      `SELECT * FROM credentials WHERE id = ANY($1) AND holder_did_id = $2 AND revoked = FALSE`,
      [credentialIds, holderDid.id]
    );
    const vcList = credResult.rows.map((row: any) => row.vc_json);

    // Build and sign VP
    const now = new Date();
    const vpPayload = {
      '@context': ['https://www.w3.org/2018/credentials/v1'],
      type: ['VerifiablePresentation'],
      verifiableCredential: vcList,
      holder: holderDid.did_string,
      purpose: purpose || 'general'
    };
    const privateKeyBytes = Buffer.from(holderDid.private_key_encrypted, 'hex');
    const dataToSign = Buffer.from(JSON.stringify(vpPayload));
    const signatureHex = crypto.createHmac('sha256', privateKeyBytes).update(dataToSign).digest('hex');
    const signedVP = {
      ...vpPayload,
      proof: {
        type: 'EcdsaSecp256k1Signature2019',
        created: now.toISOString(),
        proofPurpose: 'authentication',
        verificationMethod: `${holderDid.did_string}#keys-1`,
        jws: signatureHex
      }
    };

    // Insert presentation
    const presResult = await query(
      `INSERT INTO presentations (vp_json, holder_did_id, verifier_request_id, direct_share_verifier_did, share_purpose)
       VALUES ($1, $2, NULL, $3, $4) RETURNING id`,
      [JSON.stringify(signedVP), holderDid.id, verifierDidString, purpose || 'general']
    );

    // Audit log
    await writeAuditLog('vc_shared_to_did', holderDid.did_string, verifierDidString, 'VerifiablePresentation');

    res.json({ success: true, presentationId: presResult.rows[0].id });
  } catch (error: any) {
    console.error('Share to DID error:', error);
    res.status(500).json({ error: error.message });
  }
});

// 7. GET /api/verifier/shared-presentations — list VPs shared directly to this verifier
app.get('/api/verifier/shared-presentations', requireAuth, requireRole('verifier'), async (req, res) => {
  try {
    const user = (req as any).user;

    // Get verifier's parent DID
    const verifierDidResult = await query(
      `SELECT did_string FROM dids WHERE user_id = $1 AND did_type = 'parent' LIMIT 1`,
      [user.id]
    );
    if (verifierDidResult.rows.length === 0) return res.json({ success: true, presentations: [] });
    const verifierDid = verifierDidResult.rows[0].did_string;

    // Query presentations shared to this verifier DID
    const result = await query(
      `SELECT p.*, d.did_string as holder_did
       FROM presentations p
       LEFT JOIN dids d ON p.holder_did_id = d.id
       WHERE p.direct_share_verifier_did = $1
       ORDER BY p.created_at DESC`,
      [verifierDid]
    );

    res.json({ success: true, presentations: result.rows });
  } catch (error: any) {
    console.error('Verifier shared presentations error:', error);
    res.status(500).json({ error: error.message });
  }
});

// ─── Audit Log Endpoint ───────────────────────────────────────────────────────

app.get('/api/audit-logs', requireAuth, async (req, res) => {
  try {
    const { limit = 50 } = req.query;
    const result = await query(
      'SELECT id, event_type, actor_did, subject_did, credential_type_hash, created_at FROM audit_logs ORDER BY created_at DESC LIMIT $1',
      [Number(limit)]
    );
    res.json({ success: true, logs: result.rows });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// ─── Polygon Endpoints ────────────────────────────────────────────────────────

app.get('/api/polygon/status', async (req, res) => {
  try {
    const status = await polygonService.getStatus();
    res.json({ success: true, ...status });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// Kept for backwards compatibility
app.get('/api/polygon/network', (req, res) => {
  res.json({ network: polygonService.getNetwork(), rpcUrl: polygonService.getRpcUrl() });
});

// ── DIA VC Helpers ────────────────────────────────────────────────────────────

function diaCredentialType(authorityType: string): string {
  const map: Record<string, string> = {
    mca:               'CompanyRegistrationCredential',
    dgft:              'IECCredential',
    gstn_trust_anchor: 'GSTINCredential',
    pan_trust_anchor:  'PANCredential',
  };
  return map[authorityType] || 'UnknownCredential';
}

function buildDIAVC(authorityType: string, org: any, issuerDid: any, holderDid: string, expiresAt: Date) {
  const vcId = crypto.randomUUID();
  const now = new Date();
  const base = {
    '@context': ['https://www.w3.org/2018/credentials/v1'],
    id: `urn:uuid:${vcId}`,
    issuer: issuerDid.did_string,
    issuanceDate: now.toISOString(),
    expirationDate: expiresAt.toISOString(),
    proof: {
      type: 'EcdsaSecp256k1Signature2019',
      created: now.toISOString(),
      verificationMethod: `${issuerDid.did_string}#keys-1`,
      proofPurpose: 'assertionMethod',
      jws: crypto.createHmac('sha256', issuerDid.private_key_encrypted)
        .update(JSON.stringify({ id: `urn:uuid:${vcId}`, holderDid }))
        .digest('hex'),
    },
  };
  const subjectMap: Record<string, object> = {
    mca: {
      type: ['VerifiableCredential', 'CompanyRegistrationCredential'],
      credentialSubject: {
        id: holderDid,
        companyName: org.company_name,
        cin: org.cin,
        companyStatus: org.company_status,
        companyCategory: org.company_category,
        dateOfIncorporation: org.date_of_incorporation,
        directorName: org.director_name,
        din: org.din,
        digitalIdentityAnchor: org.cin,
      },
    },
    dgft: {
      type: ['VerifiableCredential', 'IECCredential'],
      credentialSubject: {
        id: holderDid,
        companyName: org.company_name,
        ieCode: org.ie_code,
        digitalIdentityAnchor: org.ie_code,
      },
    },
    gstn_trust_anchor: {
      type: ['VerifiableCredential', 'GSTINCredential'],
      credentialSubject: {
        id: holderDid,
        companyName: org.company_name,
        gstin: org.gstn,
        digitalIdentityAnchor: org.gstn,
      },
    },
    pan_trust_anchor: {
      type: ['VerifiableCredential', 'PANCredential'],
      credentialSubject: {
        id: holderDid,
        companyName: org.company_name,
        pan: org.pan_number,
        digitalIdentityAnchor: org.pan_number,
      },
    },
  };
  return { ...base, ...subjectMap[authorityType] };
}

// ── Organization Application Routes ──────────────────────────────────────

app.post('/api/organizations/apply', async (req, res) => {
  try {
    const {
      org_name, email, org_logo_url,
      director_full_name, aadhaar_number, dob, gender, state, pincode,
      company_name, cin, company_status, company_category, date_of_incorporation,
      pan_number, gstn, ie_code,
      director_name, din, designation, signing_authority_level
    } = req.body;

    const required = [org_name, email, director_full_name, aadhaar_number, dob, gender,
      state, pincode, company_name, cin, company_status, company_category,
      date_of_incorporation, pan_number, gstn, ie_code, director_name, din, designation];
    if (required.some(v => !v)) {
      return res.status(400).json({ error: 'All required fields must be provided' });
    }

    const existing = await query('SELECT id FROM organization_applications WHERE cin = $1', [cin]);
    if (existing.rows.length > 0) {
      return res.status(400).json({ error: 'An application with this CIN already exists' });
    }

    const result = await query(
      `INSERT INTO organization_applications
        (org_name, email, org_logo_url, director_full_name, aadhaar_number, dob, gender,
         state, pincode, company_name, cin, company_status, company_category,
         date_of_incorporation, pan_number, gstn, ie_code, director_name, din, designation,
         signing_authority_level)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21)
       RETURNING id`,
      [org_name, email, org_logo_url || null, director_full_name, aadhaar_number, dob, gender,
       state, pincode, company_name, cin, company_status, company_category,
       date_of_incorporation, pan_number, gstn, ie_code, director_name, din, designation,
       signing_authority_level || 'Single Signatory']
    );

    res.json({ success: true, applicationId: result.rows[0].id });
  } catch (error: any) {
    console.error('Apply error:', error);
    res.status(500).json({ error: error.message });
  }
});

app.get('/api/authority/organizations', requireAuth, requireRole('government_agency'), async (req, res) => {
  try {
    const authorityType: string = (req as any).user.authority_type;
    if (!authorityType) {
      return res.status(400).json({ error: 'Account has no authority_type configured. Please re-register.' });
    }
    const status = (req.query.status as string) || 'pending';
    const rows = await query(
      `SELECT * FROM organization_applications
       WHERE authority_verifications->$1->>'status' = $2
       ORDER BY created_at DESC`,
      [authorityType, status]
    );
    const stats = await query(
      `SELECT
        COUNT(*) FILTER (WHERE authority_verifications->$1->>'status'='pending') AS pending,
        COUNT(*) FILTER (WHERE authority_verifications->$1->>'status'='approved') AS approved,
        COUNT(*) FILTER (WHERE authority_verifications->$1->>'status'='rejected') AS rejected,
        COUNT(*) AS total
       FROM organization_applications`,
      [authorityType]
    );
    res.json({ organizations: rows.rows, stats: stats.rows[0] });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

app.get('/api/authority/organizations/:id', requireAuth, requireRole('government_agency'), async (req, res) => {
  try {
    const result = await query('SELECT * FROM organization_applications WHERE id = $1', [req.params.id]);
    if (!result.rows[0]) return res.status(404).json({ error: 'Application not found' });
    res.json({ organization: result.rows[0] });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

app.post('/api/authority/organizations/:id/verify-field', requireAuth, requireRole('government_agency'), async (req, res) => {
  try {
    const authorityType: string = (req as any).user.authority_type;
    if (!authorityType) {
      return res.status(400).json({ error: 'Account has no authority_type configured. Please re-register.' });
    }
    const { field, verified } = req.body;
    const fieldsByAuthority: Record<string, string[]> = {
      mca:               ['cin', 'company_name'],
      dgft:              ['ie_code'],
      gstn_trust_anchor: ['gstn'],
      pan_trust_anchor:  ['pan'],
    };
    const allowed = fieldsByAuthority[authorityType] || [];
    if (!allowed.includes(field)) {
      return res.status(400).json({ error: `Field '${field}' is not in ${authorityType} scope. Allowed: ${allowed.join(', ')}` });
    }
    const result = await query(
      `UPDATE organization_applications
       SET authority_verifications = jsonb_set(
         authority_verifications,
         $1::text[],
         $2::jsonb
       ), updated_at = NOW()
       WHERE id = $3
       RETURNING authority_verifications`,
      [`{${authorityType},verified_${field}}`, JSON.stringify(verified), req.params.id]
    );
    if (!result.rows[0]) return res.status(404).json({ error: 'Application not found' });
    res.json({ success: true, authority_verifications: result.rows[0].authority_verifications });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

app.post('/api/authority/organizations/:id/approve', requireAuth, requireRole('government_agency'), async (req, res) => {
  try {
    const authorityType: string = (req as any).user.authority_type;
    if (!authorityType) {
      return res.status(400).json({ error: 'Account has no authority_type configured. Please re-register.' });
    }
    const appResult = await query('SELECT * FROM organization_applications WHERE id = $1', [req.params.id]);
    const org = appResult.rows[0];
    if (!org) return res.status(404).json({ error: 'Application not found' });

    // Check all this authority's fields are verified
    const authVerif = org.authority_verifications[authorityType];
    if (!authVerif) return res.status(400).json({ error: `No slot for authority_type ${authorityType}` });
    const allVerified = Object.entries(authVerif)
      .filter(([k]) => k.startsWith('verified_'))
      .every(([, v]) => v === true);
    if (!allVerified) {
      return res.status(400).json({ error: `All ${authorityType} fields must be verified before approval` });
    }
    if (authVerif.status === 'approved') {
      return res.status(400).json({ error: `${authorityType} has already approved this application` });
    }

    // Get issuer (this authority's) DID
    const authorityUser = (req as any).user;
    const issuerDidResult = await query(
      'SELECT id, did_string, private_key_encrypted FROM dids WHERE user_id = $1 AND did_type = $2',
      [authorityUser.id, 'parent']
    );
    if (!issuerDidResult.rows[0]) return res.status(500).json({ error: `${authorityType} DID not found` });
    const issuerDid = issuerDidResult.rows[0];

    // Create corporate user only on FIRST approval (when user_id is null)
    let userId = org.user_id;
    let holderDid: string;
    let holderDidId: string;
    let tempPassword: string | null = null;

    await query('BEGIN');
    try {
      if (!userId) {
        // First approval — create corporate user + DID
        tempPassword = crypto.randomBytes(8).toString('hex');
        const passwordHash = await hashPassword(tempPassword);
        const userResult = await query(
          'INSERT INTO users (email, password_hash, role, name, sub_role) VALUES ($1, $2, $3, $4, $5) RETURNING id',
          [org.email, passwordHash, 'corporate', org.company_name, 'super_admin']
        );
        userId = userResult.rows[0].id;
        // Set org_id = self (super admin owns the org scope)
        await query('UPDATE users SET org_id = $1 WHERE id = $1', [userId]);
        const slug = org.company_name.toLowerCase().replace(/[^a-z0-9]/g, '-');
        const didData = await createAndStoreDID(userId, 'parent', undefined, slug);
        holderDid = didData.did;
        const holderDidResult = await query('SELECT id FROM dids WHERE did_string = $1', [holderDid]);
        holderDidId = holderDidResult.rows[0].id;
        console.log(`[APPROVAL EMAIL] To: ${org.email} | Login: ${org.email} | Temp Password: ${tempPassword}`);
      } else {
        // Subsequent approval — look up existing corporate DID
        const didResult = await query(
          'SELECT did_string, id FROM dids WHERE user_id = $1 AND did_type = $2',
          [userId, 'parent']
        );
        if (!didResult.rows[0]) {
          await query('ROLLBACK');
          return res.status(500).json({ error: 'Corporate DID not found' });
        }
        holderDid = didResult.rows[0].did_string;
        holderDidId = didResult.rows[0].id;
      }

      // Build DIA VC for this authority only
      const now = new Date();
      const expiresAt = new Date(now.getFullYear() + 10, now.getMonth(), now.getDate());
      const vc = buildDIAVC(authorityType, org, issuerDid, holderDid, expiresAt);
      const credType = diaCredentialType(authorityType);

      // Store credential
      const credResult = await query(
        `INSERT INTO credentials (vc_json, holder_did_id, issuer_did_id, credential_type, issued_at, expires_at)
         VALUES ($1, $2, $3, $4, $5, $6) RETURNING id`,
        [JSON.stringify(vc), holderDidId, issuerDid.id, credType, now, expiresAt]
      );
      const vcId = credResult.rows[0].id;

      // Update authority slot: set status=approved, vc_id
      const updatedVerifResult = await query(
        `UPDATE organization_applications
         SET authority_verifications = jsonb_set(
           jsonb_set(authority_verifications, $1::text[], $2::jsonb),
           $3::text[], $4::jsonb
         ), updated_at = NOW()
         WHERE id = $5
         RETURNING authority_verifications`,
        [
          `{${authorityType},status}`, '"approved"',
          `{${authorityType},vc_id}`, JSON.stringify(vcId),
          req.params.id
        ]
      );
      const updatedVerif = updatedVerifResult.rows[0].authority_verifications;
      const allApproved = ['mca', 'dgft', 'gstn_trust_anchor', 'pan_trust_anchor']
        .every(at => updatedVerif[at]?.status === 'approved');
      const newStatus = allApproved ? 'complete' : 'partial';

      await query(
        'UPDATE organization_applications SET application_status = $1, user_id = $2, updated_at = NOW() WHERE id = $3',
        [newStatus, userId, req.params.id]
      );

      await query('COMMIT');

      // Polygon anchor (async, non-blocking)
      polygonService.anchorVC(vcId, vc, issuerDid.did_string, holderDid, credType, expiresAt)
        .catch(err => console.error('[Polygon] VC anchor failed:', err.message));

      res.json({
        success: true,
        userId,
        did: holderDid,
        vcId,
        credentialType: credType,
        applicationStatus: newStatus,
        ...(tempPassword ? { tempPassword } : {}),
      });
    } catch (innerError: any) {
      await query('ROLLBACK');
      throw innerError;
    }
  } catch (error: any) {
    console.error('Approve error:', error);
    res.status(500).json({ error: error.message });
  }
});

app.post('/api/authority/organizations/:id/reject', requireAuth, requireRole('government_agency'), async (req, res) => {
  try {
    const authorityType: string = (req as any).user.authority_type;
    if (!authorityType) {
      return res.status(400).json({ error: 'Account has no authority_type configured. Please re-register.' });
    }
    const { reason } = req.body;
    if (!reason) return res.status(400).json({ error: 'Rejection reason is required' });
    // Authority-scoped rejection: only update this authority's slot; other authorities can still approve
    const result = await query(
      `UPDATE organization_applications
       SET authority_verifications = jsonb_set(
         jsonb_set(authority_verifications, $1::text[], '"rejected"'::jsonb),
         $2::text[], $3::jsonb
       ), updated_at = NOW()
       WHERE id = $4
       RETURNING id`,
      [
        `{${authorityType},status}`,
        `{${authorityType},rejection_reason}`,
        JSON.stringify(reason),
        req.params.id
      ]
    );
    if (!result.rows[0]) return res.status(404).json({ error: 'Application not found' });
    res.json({ success: true });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// ── Maker/Checker Routes ──────────────────────────────────────────────────

// GET /api/mc/queue — returns pending mc_actions scoped to the logged-in user
app.get('/api/mc/queue', requireAuth, async (req, res) => {
  try {
    const user = (req as any).user;

    let rows;
    if (user.role === 'government_agency') {
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
      const orgId = (user as any).org_id || user.id;
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

    // Cross-role guard: government_agency can only submit vc_issuance; corporate can only submit vp_share
    if (user.role === 'government_agency' && resource_type !== 'vc_issuance') {
      return res.status(403).json({ error: 'Government agency users can only submit vc_issuance actions' });
    }
    if (user.role === 'corporate' && resource_type !== 'vp_share') {
      return res.status(403).json({ error: 'Corporate users can only submit vp_share actions' });
    }

    // Duplicate check: no pending action for same resource
    const existing = await query(
      `SELECT id FROM mc_actions WHERE resource_id = $1 AND resource_type = $2 AND status = 'pending'`,
      [resource_id, resource_type]
    );
    if (existing.rows.length > 0) {
      return res.status(400).json({ error: 'A pending action already exists for this resource' });
    }

    const orgId = (user as any).org_id || (user.role === 'corporate' ? user.id : null);

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
      const appResult = await query('SELECT * FROM organization_applications WHERE id = $1', [action.resource_id]);
      const org = appResult.rows[0];
      if (!org) return res.status(404).json({ error: 'Organization application not found' });

      const authorityType: string = (user as any).authority_type;
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
        const vc = buildDIAVC(authorityType, org, issuerDid, holderDid!, expiresAt);
        const credType = diaCredentialType(authorityType);

        const credResult = await query(
          `INSERT INTO credentials (vc_json, holder_did_id, issuer_did_id, credential_type, issued_at, expires_at)
           VALUES ($1, $2, $3, $4, $5, $6) RETURNING id`,
          [JSON.stringify(vc), holderDidId!, issuerDid.id, credType, now, expiresAt]
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

        await query(`UPDATE mc_actions SET status='approved', checker_id=$1, updated_at=NOW() WHERE id=$2`, [user.id, req.params.id]);

        await query('COMMIT');

        polygonService.anchorVC(vcId, vc, issuerDid.did_string, holderDid!, credType, expiresAt)
          .catch(err => console.error('[Polygon] VC anchor failed:', err.message));

        res.json({ success: true, vcId, credentialType: credType, applicationStatus: newStatus, ...(tempPassword ? { tempPassword } : {}) });
      } catch (innerError: any) {
        await query('ROLLBACK');
        throw innerError;
      }
    } else if (action.resource_type === 'vp_share') {
      // Org-scope guard: checker must belong to the same org as the action
      const checkerOrgId = user.org_id || user.id;
      if (action.org_id && action.org_id !== checkerOrgId) {
        return res.status(403).json({ error: 'You can only approve actions belonging to your own organization' });
      }
      const vpResult = await query('SELECT * FROM vp_requests WHERE id = $1', [action.resource_id]);
      const vpRequest = vpResult.rows[0];
      if (!vpRequest) return res.status(404).json({ error: 'VP request not found' });

      const vcIds: string[] = vpRequest.vc_ids;
      const credResults = await query(
        `SELECT vc_json FROM credentials WHERE id = ANY($1::uuid[])`,
        [vcIds]
      );
      const vcs = credResults.rows.map((r: any) => r.vc_json);

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

    await query('BEGIN');
    try {
      await query(
        `UPDATE mc_actions SET status='rejected', rejection_reason=$1, checker_id=$2, updated_at=NOW() WHERE id=$3`,
        [reason, user.id, req.params.id]
      );
      if (action.resource_type === 'vp_share') {
        await query(`UPDATE vp_requests SET status='rejected', updated_at=NOW() WHERE id=$1`, [action.resource_id]);
      }
      await query('COMMIT');
    } catch (e) {
      await query('ROLLBACK');
      throw e;
    }
    res.json({ success: true });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

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
    if (!active) {
      await query('DELETE FROM sessions WHERE user_id = $1', [req.params.id]);
    }
    await query(`
      UPDATE users SET name = CASE
        WHEN $1 = true THEN regexp_replace(name, ' \\[INACTIVE\\]', '')
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

// ─── Start Server ─────────────────────────────────────────────────────────────

async function start() {
  try {
    await runMigrations();
    app.listen(PORT, () => {
      console.log(`Server running on http://localhost:${PORT}`);
    });
  } catch (error) {
    console.error('Failed to start server:', error);
    process.exit(1);
  }
}

start();
