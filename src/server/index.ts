/**
 * Express API server for DID VC project
 */
import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import crypto from 'crypto';
import multer from 'multer';
import fs from 'fs';
import path from 'path';
import { runMigrations } from '../db/migrate.js';
import { query } from '../db/index.js';
import { getBesuService } from '../blockchain/besu.js';
const besuService = getBesuService();
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

// ─── File Uploads ─────────────────────────────────────────────────────────────

const UPLOADS_DIR = path.join(process.cwd(), 'uploads', 'corporate-docs');
if (!fs.existsSync(UPLOADS_DIR)) fs.mkdirSync(UPLOADS_DIR, { recursive: true });
app.use('/uploads', express.static(path.join(process.cwd(), 'uploads')));

const corpDocStorage = multer.diskStorage({
  destination: UPLOADS_DIR,
  filename: (_req, file, cb) => {
    const safe = file.originalname.replace(/[^a-zA-Z0-9._-]/g, '-');
    cb(null, `${Date.now()}-${safe}`);
  },
});
const corpDocUpload = multer({
  storage: corpDocStorage,
  limits: { fileSize: 5 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    const allowed = ['application/pdf', 'image/jpeg', 'image/png'];
    cb(null, allowed.includes(file.mimetype));
  },
});

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

  // Register DID on Besu (async, don't block) — persist tx hash
  besuService.registerDID(didString, publicKeyHex)
    .then(({ txHash, blockNumber }) =>
      query(`UPDATE dids SET polygon_tx_hash=$1, polygon_block_number=$2 WHERE did_string=$3`,
        [txHash, blockNumber ?? null, didString])
        .catch(e => console.error('[Besu] DID DB update failed:', e.message))
    )
    .catch(err => console.error('[Besu] Failed to register DID:', err.message));

  return { did: didString, id: result.rows[0].id, publicKey: publicKeyHex, privateKey: privateKeyHex };
}

// ─── Org DID Owner Helper ─────────────────────────────────────────────────────
// For maker/checker users the DID, employee registry and all org-level resources
// belong to the super_admin (org_id). Always resolve via this helper so every
// endpoint is consistent regardless of which team member is logged in.
function orgDIDOwner(user: any): string {
  return user.sub_role === 'super_admin' ? user.id : (user.org_id || user.id);
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

    // Direct login — no MFA
    const didResult = await query(
      "SELECT did_string FROM dids WHERE user_id = $1 AND did_type = 'parent' LIMIT 1",
      [user.id]
    );
    const did = didResult.rows[0]?.did_string;
    const token = await createSession(user.id, user.role);

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
    [orgDIDOwner(user)]
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
      [orgDIDOwner(user)]
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
      [orgDIDOwner(user)]
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
    const orgOwner = orgDIDOwner(user);

    if (!employeeId || !name || !email) {
      return res.status(400).json({ error: 'employeeId, name, and email are required' });
    }

    // Get corporate's parent DID (belongs to the org super_admin)
    const parentDidResult = await query(
      "SELECT id FROM dids WHERE user_id = $1 AND did_type = 'parent' LIMIT 1",
      [orgOwner]
    );
    if (parentDidResult.rows.length === 0) {
      return res.status(400).json({ error: 'Corporate has no parent DID' });
    }
    const parentDidId = parentDidResult.rows[0].id;

    // Create Sub-DID owned by the org super_admin
    const subDidData = await createAndStoreDID(orgOwner, 'sub', parentDidId);

    // Register employee under the org super_admin
    const empResult = await query(
      `INSERT INTO employee_registry (corporate_user_id, employee_id, name, email, sub_did_id)
       VALUES ($1, $2, $3, $4, $5) RETURNING *`,
      [orgOwner, employeeId, name, email, subDidData.id]
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
    const orgOwner = orgDIDOwner(user);

    if (!Array.isArray(employees) || employees.length === 0) {
      return res.status(400).json({ error: 'employees array is required' });
    }

    const parentDidResult = await query(
      "SELECT id FROM dids WHERE user_id = $1 AND did_type = 'parent' LIMIT 1",
      [orgOwner]
    );
    if (parentDidResult.rows.length === 0) {
      return res.status(400).json({ error: 'Corporate has no parent DID' });
    }
    const parentDidId = parentDidResult.rows[0].id;

    const created = [];
    const errors = [];

    for (const emp of employees) {
      try {
        const subDidData = await createAndStoreDID(orgOwner, 'sub', parentDidId);
        const empResult = await query(
          `INSERT INTO employee_registry (corporate_user_id, employee_id, name, email, sub_did_id)
           VALUES ($1, $2, $3, $4, $5) RETURNING *`,
          [orgOwner, emp.employeeId, emp.name, emp.email, subDidData.id]
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

    // Authorized signatories cannot create requests directly — they only sign off
    if (user.sub_role === 'authorized_signatory') {
      return res.status(403).json({ error: 'Authorized signatories cannot submit requests directly. Use Sign & Submit to approve checker-approved requests.' });
    }

    const { credentialType, requestData, targetIssuerId } = req.body;

    if (!credentialType) return res.status(400).json({ error: 'credentialType is required' });

    // For maker/checker, DID belongs to the org (super_admin), not the individual user
    const didOwnerId = (user.sub_role === 'super_admin') ? user.id : (user.org_id || user.id);
    const didResult = await query(
      "SELECT id FROM dids WHERE user_id = $1 AND did_type = 'parent' LIMIT 1",
      [didOwnerId]
    );
    const requesterDidId = didResult.rows[0]?.id || null;

    // Route every credential type to its specific named entity (fully deterministic)
    const credTypeEntityNameMap: Record<string, string> = {
      // DGFT — DID Issuer
      IECCredential:                      'Directorate General of Foreign Trade (DGFT)',
      DGFTExportLicense:                  'Directorate General of Foreign Trade (DGFT)',
      TradeLicense:                       'Directorate General of Foreign Trade (DGFT)',
      // IBDIC — DID Issuer
      IBDICDigitalIdentityCredential:     'IBDIC \u2014 Indian Blockchain DID Council',
      // MCA — DID Issuer
      MCARegistration:                    'Ministry of Corporate Affairs (MCA)',
      CompanyRegistrationCredential:      'Ministry of Corporate Affairs (MCA)',
      // NeSL — VC Issuer
      NESLBusinessRegistrationCredential: 'NeSL \u2014 National e-Governance Services Ltd',
      MSMERegistration:                   'NeSL \u2014 National e-Governance Services Ltd',
      // GSTN — VC Issuer
      GSTINCredential:                    'GST Network (GSTN)',
      GSTCertificate:                     'GST Network (GSTN)',
      // Protean — Trust Endorser
      PANCredential:                      'Protean eGov Technologies',
    };
    // Legacy fallback (kept for any unknown types)
    const credTypeEntityMap: Record<string, string> = {
      IECode: 'did_issuer',
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
        if (!issuerUserId) {
          // Fallback: any super_admin government_agency user
          const fallback = await query(
            `SELECT id FROM users WHERE role = 'government_agency' AND sub_role = 'super_admin' LIMIT 1`
          );
          issuerUserId = fallback.rows[0]?.id || null;
        }
      }
    }

    // Requesters start internal approval flow (draft); everyone else submits directly to issuer
    const isRequester = user.sub_role === 'requester';
    const initialStatus     = isRequester ? 'draft'     : 'pending';
    const initialCorpStatus = isRequester ? 'submitted' : null;

    const result = await query(
      `INSERT INTO vc_requests (requester_user_id, requester_did_id, issuer_user_id, credential_type, request_data, status, corp_status)
       VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING *`,
      [user.id, requesterDidId, issuerUserId, credentialType, JSON.stringify(requestData || {}), initialStatus, initialCorpStatus]
    );

    res.json({ success: true, request: result.rows[0] });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

app.get('/api/vc-requests/my', requireAuth, async (req, res) => {
  try {
    const user = (req as any).user;
    // Show all requests for the org (any team member's submissions) by scoping to org owner
    const orgOwner = orgDIDOwner(user);
    const result = await query(
      `SELECT vcr.*,
              u.name  as issuer_name,
              ru.name as corp_reviewer_name,
              cu.name as corp_checker_name,
              su.name as corp_signatory_name
       FROM vc_requests vcr
       LEFT JOIN users u  ON vcr.issuer_user_id    = u.id
       LEFT JOIN users ru ON vcr.corp_reviewer_id  = ru.id
       LEFT JOIN users cu ON vcr.corp_checker_id   = cu.id
       LEFT JOIN users su ON vcr.corp_signatory_id = su.id
       WHERE vcr.requester_user_id IN (SELECT id FROM users WHERE id = $1 OR org_id = $1)
       ORDER BY vcr.created_at DESC`,
      [orgOwner]
    );
    res.json({ success: true, requests: result.rows });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

app.get('/api/vc-requests/pending', requireAuth, requireRole('government_agency'), async (req, res) => {
  try {
    const user = (req as any).user;
    const orgRoot = (user as any).org_id || user.id;
    const result = await query(
      `SELECT vcr.*, u.name as requester_name, u.email as requester_email, d.did_string as requester_did,
              mc.id as mc_action_id, mc.status as mc_action_status
       FROM vc_requests vcr
       JOIN users u ON vcr.requester_user_id = u.id
       LEFT JOIN dids d ON vcr.requester_did_id = d.id
       LEFT JOIN mc_actions mc ON mc.resource_id = vcr.id AND mc.resource_type = 'vc_request_approval'
       WHERE vcr.issuer_user_id IN (SELECT id FROM users WHERE id = $1 OR org_id = $1)
         AND vcr.status = 'pending'
       ORDER BY vcr.created_at ASC`,
      [orgRoot]
    );
    res.json({ success: true, requests: result.rows });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

app.get('/api/vc-requests/issued', requireAuth, requireRole('government_agency'), async (req, res) => {
  try {
    const user = (req as any).user;
    const orgRoot = (user as any).org_id || user.id;
    const result = await query(
      `SELECT vcr.*, u.name as requester_name, u.email as requester_email,
              c.id as credential_id, c.polygon_tx_hash, c.polygon_block_number, c.polygon_anchored_at
       FROM vc_requests vcr
       JOIN users u ON vcr.requester_user_id = u.id
       LEFT JOIN credentials c ON c.vc_request_id = vcr.id
       WHERE vcr.issuer_user_id IN (SELECT id FROM users WHERE id = $1 OR org_id = $1)
         AND vcr.status != 'pending'
       ORDER BY vcr.updated_at DESC`,
      [orgRoot]
    );
    res.json({ success: true, requests: result.rows });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// ─── Corporate Internal Approval Workflow ────────────────────────────────────

// GET /api/corporate/vc-requests/queue — role-aware queue (maker/checker/AS/super_admin)
app.get('/api/corporate/vc-requests/queue', requireAuth, requireRole('corporate'), async (req, res) => {
  try {
    const user = (req as any).user;
    const orgOwner = orgDIDOwner(user);
    const stageMap: Record<string, string> = {
      maker:                'submitted',
      checker:              'maker_reviewed',
      authorized_signatory: 'checker_approved',
    };
    const targetStage = stageMap[user.sub_role];
    if (!targetStage && user.sub_role !== 'super_admin') {
      return res.json({ success: true, requests: [] });
    }
    const stageClause = user.sub_role === 'super_admin'
      ? `AND vcr.corp_status IS NOT NULL AND vcr.status = 'draft'`
      : `AND vcr.corp_status = $2 AND vcr.status = 'draft'`;
    const params: any[] = user.sub_role === 'super_admin' ? [orgOwner] : [orgOwner, targetStage];
    const result = await query(
      `SELECT vcr.*,
              ru.name  as requester_name, ru.email as requester_email,
              rev.name as corp_reviewer_name,
              chk.name as corp_checker_name
       FROM vc_requests vcr
       JOIN  users ru  ON vcr.requester_user_id  = ru.id
       LEFT JOIN users rev ON vcr.corp_reviewer_id  = rev.id
       LEFT JOIN users chk ON vcr.corp_checker_id   = chk.id
       WHERE vcr.requester_user_id IN (SELECT id FROM users WHERE id = $1 OR org_id = $1)
         ${stageClause}
       ORDER BY vcr.created_at ASC`,
      params
    );
    res.json({ success: true, requests: result.rows });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// POST /api/corporate/vc-requests/:id/maker-review — maker reviews submitted request
app.post('/api/corporate/vc-requests/:id/maker-review', requireAuth, requireRole('corporate'), async (req, res) => {
  try {
    const user = (req as any).user;
    if (!['maker', 'super_admin'].includes(user.sub_role)) {
      return res.status(403).json({ error: 'Only maker or super_admin can review submitted requests' });
    }
    const { id } = req.params;
    const { decision, rejection_reason } = req.body;
    const orgOwner = orgDIDOwner(user);
    const vcReqResult = await query(
      `SELECT id FROM vc_requests
       WHERE id = $1
         AND requester_user_id IN (SELECT id FROM users WHERE id = $2 OR org_id = $2)
         AND corp_status = 'submitted' AND status = 'draft'`,
      [id, orgOwner]
    );
    if (vcReqResult.rows.length === 0) {
      return res.status(404).json({ error: 'Request not found or not in submitted state' });
    }
    if (decision === 'reject') {
      await query(
        `UPDATE vc_requests SET status = 'rejected', rejection_reason = $1,
          corp_status = NULL, corp_reviewer_id = $2, updated_at = NOW() WHERE id = $3`,
        [rejection_reason || 'Rejected by maker', user.id, id]
      );
      return res.json({ success: true, action: 'rejected' });
    }
    await query(
      `UPDATE vc_requests SET corp_status = 'maker_reviewed', corp_reviewer_id = $1, updated_at = NOW() WHERE id = $2`,
      [user.id, id]
    );
    res.json({ success: true, action: 'approved', corp_status: 'maker_reviewed' });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// POST /api/corporate/vc-requests/:id/checker-approve — checker approves maker_reviewed request
app.post('/api/corporate/vc-requests/:id/checker-approve', requireAuth, requireRole('corporate'), async (req, res) => {
  try {
    const user = (req as any).user;
    if (!['checker', 'super_admin'].includes(user.sub_role)) {
      return res.status(403).json({ error: 'Only checker or super_admin can approve at the checker stage' });
    }
    const { id } = req.params;
    const { decision, rejection_reason } = req.body;
    const orgOwner = orgDIDOwner(user);
    const vcReqResult = await query(
      `SELECT id FROM vc_requests
       WHERE id = $1
         AND requester_user_id IN (SELECT id FROM users WHERE id = $2 OR org_id = $2)
         AND corp_status = 'maker_reviewed' AND status = 'draft'`,
      [id, orgOwner]
    );
    if (vcReqResult.rows.length === 0) {
      return res.status(404).json({ error: 'Request not found or not in maker_reviewed state' });
    }
    if (decision === 'reject') {
      await query(
        `UPDATE vc_requests SET status = 'rejected', rejection_reason = $1,
          corp_status = NULL, corp_checker_id = $2, updated_at = NOW() WHERE id = $3`,
        [rejection_reason || 'Rejected by checker', user.id, id]
      );
      return res.json({ success: true, action: 'rejected' });
    }
    await query(
      `UPDATE vc_requests SET corp_status = 'checker_approved', corp_checker_id = $1, updated_at = NOW() WHERE id = $2`,
      [user.id, id]
    );
    res.json({ success: true, action: 'approved', corp_status: 'checker_approved' });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// POST /api/corporate/vc-requests/:id/signatory-approve — AS gives final sign-off, submits to issuer
app.post('/api/corporate/vc-requests/:id/signatory-approve', requireAuth, requireRole('corporate'), async (req, res) => {
  try {
    const user = (req as any).user;
    if (!['authorized_signatory', 'super_admin'].includes(user.sub_role)) {
      return res.status(403).json({ error: 'Only authorized_signatory or super_admin can give final sign-off' });
    }
    const { id } = req.params;
    const { decision, rejection_reason } = req.body;
    const orgOwner = orgDIDOwner(user);
    const vcReqResult = await query(
      `SELECT id FROM vc_requests
       WHERE id = $1
         AND requester_user_id IN (SELECT id FROM users WHERE id = $2 OR org_id = $2)
         AND corp_status = 'checker_approved' AND status = 'draft'`,
      [id, orgOwner]
    );
    if (vcReqResult.rows.length === 0) {
      return res.status(404).json({ error: 'Request not found or not in checker_approved state' });
    }
    if (decision === 'reject') {
      await query(
        `UPDATE vc_requests SET status = 'rejected', rejection_reason = $1,
          corp_status = NULL, corp_signatory_id = $2, updated_at = NOW() WHERE id = $3`,
        [rejection_reason || 'Rejected by authorized signatory', user.id, id]
      );
      return res.json({ success: true, action: 'rejected' });
    }
    // Approved: flip status to 'pending' — issuer can now see and process this request
    await query(
      `UPDATE vc_requests SET corp_status = 'signatory_approved', corp_signatory_id = $1,
        status = 'pending', updated_at = NOW() WHERE id = $2`,
      [user.id, id]
    );
    res.json({ success: true, action: 'approved', corp_status: 'signatory_approved', status: 'pending' });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// POST /api/corporate/did-requests — requester submits a DID creation request
app.post('/api/corporate/did-requests', requireAuth, requireRole('corporate'), async (req, res) => {
  try {
    const user = (req as any).user;
    if (!['requester', 'super_admin'].includes(user.sub_role)) {
      return res.status(403).json({ error: 'Only requester sub_role can submit DID requests' });
    }
    const { request_data, purpose, issuerUserId } = req.body;
    const orgOwner = orgDIDOwner(user);

    // Resolve issuer: use provided ID or default to IBDIC (first active did_issuer entity)
    let resolvedIssuerId = issuerUserId || null;
    if (!resolvedIssuerId) {
      const ibdic = await query(
        `SELECT user_id FROM platform_entities WHERE entity_type = 'did_issuer' AND status = 'active' AND name ILIKE '%IBDIC%' LIMIT 1`
      );
      resolvedIssuerId = ibdic.rows[0]?.user_id || null;
      if (!resolvedIssuerId) {
        const anyIssuer = await query(
          `SELECT user_id FROM platform_entities WHERE entity_type = 'did_issuer' AND status = 'active' LIMIT 1`
        );
        resolvedIssuerId = anyIssuer.rows[0]?.user_id || null;
      }
    }

    const isRequester = user.sub_role === 'requester';
    const initialStatus = isRequester ? 'draft' : 'pending';
    const initialCorpStatus = isRequester ? 'submitted' : null;

    const result = await query(
      `INSERT INTO did_requests (requester_user_id, org_id, request_data, purpose, issuer_user_id, status, corp_status)
       VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING *`,
      [user.id, orgOwner, JSON.stringify(request_data || {}), purpose || null, resolvedIssuerId, initialStatus, initialCorpStatus]
    );
    res.json({ success: true, request: result.rows[0] });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// GET /api/corporate/did-requests/queue — role-aware DID request queue
app.get('/api/corporate/did-requests/queue', requireAuth, requireRole('corporate'), async (req, res) => {
  try {
    const user = (req as any).user;
    const orgOwner = orgDIDOwner(user);
    const stageMap: Record<string, string> = {
      maker:                'submitted',
      checker:              'maker_reviewed',
      authorized_signatory: 'checker_approved',
    };
    const targetStage = stageMap[user.sub_role];
    if (!targetStage && user.sub_role !== 'super_admin') {
      return res.json({ success: true, requests: [] });
    }
    const stageClause = user.sub_role === 'super_admin'
      ? `AND dr.corp_status NOT IN ('completed', 'rejected')`
      : `AND dr.corp_status = $2`;
    const params: any[] = user.sub_role === 'super_admin' ? [orgOwner] : [orgOwner, targetStage];
    const result = await query(
      `SELECT dr.*,
              ru.name  as requester_name, ru.email as requester_email,
              rev.name as corp_reviewer_name,
              chk.name as corp_checker_name
       FROM did_requests dr
       JOIN  users ru  ON dr.requester_user_id = ru.id
       LEFT JOIN users rev ON dr.corp_reviewer_id = rev.id
       LEFT JOIN users chk ON dr.corp_checker_id  = chk.id
       WHERE (dr.org_id = $1 OR dr.requester_user_id IN (SELECT id FROM users WHERE org_id = $1 OR id = $1))
         ${stageClause}
       ORDER BY dr.created_at ASC`,
      params
    );
    res.json({ success: true, requests: result.rows });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// GET /api/corporate/did-requests/my — requester sees their own DID requests
app.get('/api/corporate/did-requests/my', requireAuth, requireRole('corporate'), async (req, res) => {
  try {
    const user = (req as any).user;
    const orgOwner = orgDIDOwner(user);
    const result = await query(
      `SELECT dr.*,
              rev.name as corp_reviewer_name,
              chk.name as corp_checker_name,
              su.name  as corp_signatory_name
       FROM did_requests dr
       LEFT JOIN users rev ON dr.corp_reviewer_id  = rev.id
       LEFT JOIN users chk ON dr.corp_checker_id   = chk.id
       LEFT JOIN users su  ON dr.corp_signatory_id = su.id
       WHERE dr.requester_user_id IN (SELECT id FROM users WHERE id = $1 OR org_id = $1)
       ORDER BY dr.created_at DESC`,
      [orgOwner]
    );
    res.json({ success: true, requests: result.rows });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// POST /api/corporate/did-requests/:id/maker-review
app.post('/api/corporate/did-requests/:id/maker-review', requireAuth, requireRole('corporate'), async (req, res) => {
  try {
    const user = (req as any).user;
    if (!['maker', 'super_admin'].includes(user.sub_role)) {
      return res.status(403).json({ error: 'Only maker or super_admin can review DID requests' });
    }
    const { id } = req.params;
    const { decision, rejection_reason } = req.body;
    const orgOwner = orgDIDOwner(user);
    const drResult = await query(
      `SELECT id FROM did_requests
       WHERE id = $1 AND corp_status = 'submitted'
         AND (org_id = $2 OR requester_user_id IN (SELECT id FROM users WHERE org_id = $2 OR id = $2))`,
      [id, orgOwner]
    );
    if (drResult.rows.length === 0) return res.status(404).json({ error: 'DID request not found or not in submitted state' });
    if (decision === 'reject') {
      await query(`UPDATE did_requests SET corp_status = 'rejected', rejection_reason = $1, corp_reviewer_id = $2, updated_at = NOW() WHERE id = $3`, [rejection_reason || 'Rejected by maker', user.id, id]);
      return res.json({ success: true, action: 'rejected' });
    }
    await query(`UPDATE did_requests SET corp_status = 'maker_reviewed', corp_reviewer_id = $1, updated_at = NOW() WHERE id = $2`, [user.id, id]);
    res.json({ success: true, action: 'approved', corp_status: 'maker_reviewed' });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// POST /api/corporate/did-requests/:id/checker-approve
app.post('/api/corporate/did-requests/:id/checker-approve', requireAuth, requireRole('corporate'), async (req, res) => {
  try {
    const user = (req as any).user;
    if (!['checker', 'super_admin'].includes(user.sub_role)) {
      return res.status(403).json({ error: 'Only checker or super_admin can approve DID requests at checker stage' });
    }
    const { id } = req.params;
    const { decision, rejection_reason } = req.body;
    const orgOwner = orgDIDOwner(user);
    const drResult = await query(
      `SELECT id FROM did_requests
       WHERE id = $1 AND corp_status = 'maker_reviewed'
         AND (org_id = $2 OR requester_user_id IN (SELECT id FROM users WHERE org_id = $2 OR id = $2))`,
      [id, orgOwner]
    );
    if (drResult.rows.length === 0) return res.status(404).json({ error: 'DID request not found or not in maker_reviewed state' });
    if (decision === 'reject') {
      await query(`UPDATE did_requests SET corp_status = 'rejected', rejection_reason = $1, corp_checker_id = $2, updated_at = NOW() WHERE id = $3`, [rejection_reason || 'Rejected by checker', user.id, id]);
      return res.json({ success: true, action: 'rejected' });
    }
    await query(`UPDATE did_requests SET corp_status = 'checker_approved', corp_checker_id = $1, updated_at = NOW() WHERE id = $2`, [user.id, id]);
    res.json({ success: true, action: 'approved', corp_status: 'checker_approved' });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// POST /api/corporate/did-requests/:id/signatory-approve — forwards to DID issuer (IBDIC)
app.post('/api/corporate/did-requests/:id/signatory-approve', requireAuth, requireRole('corporate'), async (req, res) => {
  try {
    const user = (req as any).user;
    if (!['authorized_signatory', 'super_admin'].includes(user.sub_role)) {
      return res.status(403).json({ error: 'Only authorized_signatory or super_admin can give final DID sign-off' });
    }
    const { id } = req.params;
    const { decision, rejection_reason } = req.body;
    const orgOwner = orgDIDOwner(user);
    const drResult = await query(
      `SELECT dr.*, u.email as requester_email
       FROM did_requests dr
       JOIN users u ON dr.requester_user_id = u.id
       WHERE dr.id = $1 AND dr.corp_status = 'checker_approved'
         AND (dr.org_id = $2 OR dr.requester_user_id IN (SELECT id FROM users WHERE org_id = $2 OR id = $2))`,
      [id, orgOwner]
    );
    if (drResult.rows.length === 0) return res.status(404).json({ error: 'DID request not found or not in checker_approved state' });

    if (decision === 'reject') {
      await query(
        `UPDATE did_requests SET corp_status = 'rejected', rejection_reason = $1, corp_signatory_id = $2, updated_at = NOW() WHERE id = $3`,
        [rejection_reason || 'Rejected by authorized signatory', user.id, id]
      );
      return res.json({ success: true, action: 'rejected' });
    }

    // Forward to DID issuer (IBDIC) — flip status to 'pending' so issuer can see it
    await query(
      `UPDATE did_requests SET corp_status = 'signatory_approved', status = 'pending', corp_signatory_id = $1, updated_at = NOW() WHERE id = $2`,
      [user.id, id]
    );
    res.json({ success: true, action: 'approved', corp_status: 'signatory_approved', status: 'pending', message: 'DID request forwarded to issuer (IBDIC) for issuance' });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// ─── IBDIC / DID Issuer — DID Request Endpoints ──────────────────────────────

// GET /api/authority/did-requests — DID issuer sees pending DID requests
app.get('/api/authority/did-requests', requireAuth, requireRole('government_agency'), async (req, res) => {
  try {
    const user = (req as any).user;
    const orgRoot = (user as any).org_id || user.id;
    const result = await query(
      `SELECT dr.*,
              ru.name  as requester_name,  ru.email  as requester_email,
              ou.name  as org_name,         ou.email  as org_email,
              rev.name as corp_reviewer_name,
              chk.name as corp_checker_name,
              sig.name as corp_signatory_name,
              cd.did_string as created_did_string
       FROM did_requests dr
       JOIN  users ru  ON dr.requester_user_id = ru.id
       JOIN  users ou  ON dr.org_id            = ou.id
       LEFT JOIN users rev ON dr.corp_reviewer_id  = rev.id
       LEFT JOIN users chk ON dr.corp_checker_id   = chk.id
       LEFT JOIN users sig ON dr.corp_signatory_id = sig.id
       LEFT JOIN dids  cd  ON dr.created_did_id    = cd.id
       WHERE dr.issuer_user_id IN (SELECT id FROM users WHERE id = $1 OR org_id = $1)
         AND dr.status IN ('pending','approved','rejected')
       ORDER BY dr.created_at DESC`,
      [orgRoot]
    );
    res.json({ success: true, requests: result.rows });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// POST /api/authority/did-requests/:id/approve — issuer maker forwards to checker queue
app.post('/api/authority/did-requests/:id/approve', requireAuth, requireRole('government_agency'), async (req, res) => {
  try {
    const user = (req as any).user;
    const { id } = req.params;
    const orgRoot = (user as any).org_id || user.id;

    // Checkers must use the issue endpoint
    if (user.sub_role === 'checker') {
      return res.status(403).json({ error: 'Checkers must issue via /authority/did-requests/:id/issue' });
    }

    const drResult = await query(
      `SELECT dr.* FROM did_requests dr
       WHERE dr.id = $1 AND dr.status = 'pending'
         AND dr.issuer_user_id IN (SELECT id FROM users WHERE id = $2 OR org_id = $2)`,
      [id, orgRoot]
    );
    if (drResult.rows.length === 0) return res.status(404).json({ error: 'DID request not found or not pending' });

    if (user.sub_role === 'maker') {
      // Create MC action for checker
      const existing = await query(
        `SELECT id FROM mc_actions WHERE resource_id = $1 AND resource_type = 'did_request_issuance' AND status = 'pending'`,
        [id]
      );
      if (existing.rows.length > 0) return res.status(400).json({ error: 'Already forwarded to checker queue' });
      const action = await query(
        `INSERT INTO mc_actions (resource_type, resource_id, org_id, maker_id, payload)
         VALUES ('did_request_issuance', $1, $2, $3, $4) RETURNING id`,
        [id, orgRoot, user.id, JSON.stringify({ did_request_id: id })]
      );
      return res.json({ success: true, queued: true, actionId: action.rows[0].id });
    }

    // super_admin: issue DID directly
    const dr = drResult.rows[0];
    const newDid = await createAndStoreDID(dr.org_id, 'parent', undefined, dr.org_id.slice(0, 8));
    await query(
      `UPDATE did_requests SET status = 'approved', created_did_id = $1, updated_at = NOW() WHERE id = $2`,
      [newDid.id, id]
    );
    res.json({ success: true, action: 'approved', did: newDid.did });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// POST /api/authority/did-requests/:id/issue — issuer checker creates DID
app.post('/api/authority/did-requests/:id/issue', requireAuth, requireRole('government_agency'), async (req, res) => {
  try {
    const user = (req as any).user;
    if (!['checker', 'super_admin'].includes(user.sub_role)) {
      return res.status(403).json({ error: 'Only checker or super_admin can issue a DID' });
    }
    const { id } = req.params;
    const orgRoot = (user as any).org_id || user.id;

    // Find pending MC action (checker path) or direct (super_admin)
    const drResult = await query(
      `SELECT dr.*, ou.name as org_name FROM did_requests dr
       JOIN users ou ON dr.org_id = ou.id
       WHERE dr.id = $1 AND dr.status = 'pending'
         AND dr.issuer_user_id IN (SELECT id FROM users WHERE id = $2 OR org_id = $2)`,
      [id, orgRoot]
    );
    if (drResult.rows.length === 0) return res.status(404).json({ error: 'DID request not found or not pending' });
    const dr = drResult.rows[0];

    // Verify MC action exists for checkers
    if (user.sub_role === 'checker') {
      const mcResult = await query(
        `SELECT id FROM mc_actions WHERE resource_id = $1 AND resource_type = 'did_request_issuance' AND status = 'pending'`,
        [id]
      );
      if (mcResult.rows.length === 0) return res.status(400).json({ error: 'No maker approval found. Maker must approve first.' });
      // Mark MC action approved
      await query(`UPDATE mc_actions SET status = 'approved', checker_id = $1, updated_at = NOW() WHERE resource_id = $2 AND resource_type = 'did_request_issuance'`, [user.id, id]);
    }

    // Create the DID for the corporate org
    const slug = dr.org_name?.toLowerCase().replace(/[^a-z0-9]/g, '-').replace(/-+/g, '-') || dr.org_id.slice(0, 12);
    // Check if org already has a parent DID; if so create with unique suffix
    const existing = await query(`SELECT id FROM dids WHERE user_id = $1 AND did_type = 'parent'`, [dr.org_id]);
    const finalSlug = existing.rows.length > 0 ? `${slug}-${crypto.randomBytes(3).toString('hex')}` : slug;
    const newDid = await createAndStoreDID(dr.org_id, 'parent', undefined, finalSlug);

    await query(
      `UPDATE did_requests SET status = 'approved', created_did_id = $1, updated_at = NOW() WHERE id = $2`,
      [newDid.id, id]
    );

    await writeAuditLog('did_issued', null, newDid.did, 'DID');
    res.json({ success: true, did: newDid.did, didId: newDid.id });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// POST /api/authority/did-requests/:id/reject — issuer rejects DID request
app.post('/api/authority/did-requests/:id/reject', requireAuth, requireRole('government_agency'), async (req, res) => {
  try {
    const user = (req as any).user;
    const { id } = req.params;
    const { reason } = req.body;
    const orgRoot = (user as any).org_id || user.id;
    const drResult = await query(
      `SELECT id FROM did_requests WHERE id = $1 AND status = 'pending'
         AND issuer_user_id IN (SELECT id FROM users WHERE id = $2 OR org_id = $2)`,
      [id, orgRoot]
    );
    if (drResult.rows.length === 0) return res.status(404).json({ error: 'DID request not found' });
    await query(
      `UPDATE did_requests SET status = 'rejected', rejection_reason = $1, updated_at = NOW() WHERE id = $2`,
      [reason || 'Rejected by issuer', id]
    );
    res.json({ success: true, action: 'rejected' });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// ─── End Corporate Internal Approval Workflow ─────────────────────────────────

app.post('/api/vc-requests/:id/approve', requireAuth, requireRole('government_agency'), async (req, res) => {
  try {
    const user = (req as any).user;
    const { id } = req.params;
    const subRole = (user as any).sub_role;
    const orgRoot = (user as any).org_id || user.id;

    // Checker must use the MC queue, not this endpoint
    if (subRole === 'checker') {
      return res.status(403).json({ error: 'Checkers must approve via the Checker Queue (mc queue)' });
    }

    const reqResult = await query(
      `SELECT * FROM vc_requests WHERE id = $1
       AND issuer_user_id IN (SELECT id FROM users WHERE id = $2 OR org_id = $2)`,
      [id, orgRoot]
    );
    if (reqResult.rows.length === 0) return res.status(404).json({ error: 'Request not found' });
    const vcReq = reqResult.rows[0];

    // Maker: forward to checker queue
    if (subRole === 'maker') {
      if (vcReq.status !== 'pending') return res.status(400).json({ error: 'Request is not pending' });
      // Check no existing pending action
      const existingAction = await query(
        `SELECT id FROM mc_actions WHERE resource_id = $1 AND resource_type = 'vc_request_approval' AND status = 'pending'`,
        [id]
      );
      if (existingAction.rows.length > 0) return res.status(400).json({ error: 'Already forwarded to checker queue' });
      const actionResult = await query(
        `INSERT INTO mc_actions (resource_type, resource_id, org_id, maker_id, payload)
         VALUES ('vc_request_approval', $1, $2, $3, $4) RETURNING id`,
        [id, orgRoot, user.id, JSON.stringify({ credential_type: vcReq.credential_type })]
      );
      return res.json({ success: true, queued: true, actionId: actionResult.rows[0].id });
    }

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

    // Anchor VC hash on Besu blockchain
    let besuTxHash: string | undefined;
    try {
      const holderDidString = vcReq.requester_did_id
        ? (await query('SELECT did_string FROM dids WHERE id = $1', [vcReq.requester_did_id])).rows[0]?.did_string || ''
        : '';
      const anchored = await besuService.anchorVC(
        vcId,
        signedVC,
        issuerDid.did_string,
        holderDidString,
        vcReq.credential_type,
        expiresAt
      );
      besuTxHash = anchored.txHash;
      console.log(`[Besu] VC anchored: ${besuTxHash}`);
      query(`UPDATE credentials SET polygon_tx_hash=$1, polygon_vc_hash=$2,
             polygon_block_number=$3, polygon_anchored_at=NOW() WHERE vc_json->>'id'=$4`,
        [anchored.txHash, anchored.vcHash, anchored.blockNumber ?? null, vcId])
        .catch(e => console.error('[Besu] DB update failed:', e.message));
    } catch (err: any) {
      console.error('[Besu] Anchor failed:', err.message);
    }

    res.json({ success: true, credential: signedVC, credentialDbId: credResult.rows[0].id, besuTxHash });
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
    const orgRoot = (user as any).org_id || user.id;

    const result = await query(
      `UPDATE vc_requests SET status = $1, rejection_reason = $2, updated_at = NOW()
       WHERE id = $3
         AND issuer_user_id IN (SELECT id FROM users WHERE id = $4 OR org_id = $4)
         AND status = $5 RETURNING *`,
      ['rejected', reason || 'No reason provided', id, orgRoot, 'pending']
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
    // Employees use their sub-DID (linked via employee_registry)
    const didResult = (user as any).sub_role === 'employee'
      ? await query(
          `SELECT d.id FROM employee_registry er JOIN dids d ON er.sub_did_id = d.id WHERE er.user_id = $1 LIMIT 1`,
          [user.id]
        )
      : await query(
          "SELECT id FROM dids WHERE user_id = $1 AND did_type = 'parent' LIMIT 1",
          [orgDIDOwner(user)]
        );
    if (didResult.rows.length === 0) return res.json({ success: true, credentials: [] });

    const result = await query(
      `SELECT c.id, c.credential_type, c.issued_at, c.expires_at, c.revoked, c.vc_json,
              c.polygon_tx_hash, c.polygon_vc_hash, c.polygon_block_number, c.polygon_anchored_at,
              d.did_string as issuer_did_string
       FROM credentials c
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

    const orgOwner = orgDIDOwner(user);

    // Get employee's sub-DID (scoped to org)
    const empResult = await query(
      'SELECT er.*, d.id as did_db_id, d.did_string FROM employee_registry er JOIN dids d ON er.sub_did_id = d.id WHERE er.id = $1 AND er.corporate_user_id = $2',
      [employeeRegistryId, orgOwner]
    );
    if (empResult.rows.length === 0) return res.status(404).json({ error: 'Employee not found' });
    const employee = empResult.rows[0];

    // Get corporate's DID (issuer — belongs to org super_admin)
    const corpDidResult = await query(
      "SELECT id, did_string, private_key_encrypted FROM dids WHERE user_id = $1 AND did_type = 'parent' LIMIT 1",
      [orgOwner]
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

    // Anchor VC hash on Besu blockchain
    let besuTxHash: string | undefined;
    try {
      const anchored = await besuService.anchorVC(
        vcId,
        signedVC,
        corpDid.did_string,
        employee.did_string,
        credentialTemplate,
        expiresAt
      );
      besuTxHash = anchored.txHash;
      console.log(`[Besu] VC anchored: ${besuTxHash}`);
      query(`UPDATE credentials SET polygon_tx_hash=$1, polygon_vc_hash=$2,
             polygon_block_number=$3, polygon_anchored_at=NOW() WHERE vc_json->>'id'=$4`,
        [anchored.txHash, anchored.vcHash, anchored.blockNumber ?? null, vcId])
        .catch(e => console.error('[Besu] DB update failed:', e.message));
    } catch (err: any) {
      console.error('[Besu] Anchor failed:', err.message);
    }

    res.json({ success: true, credential: signedVC, credentialDbId: credResult.rows[0].id, besuTxHash });
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
      [orgDIDOwner(user)]
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
      [orgDIDOwner(user)]
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

    // Revoke on Besu blockchain
    const credVcRow = await query('SELECT vc_json FROM credentials WHERE id = $1', [credentialId]);
    if (credVcRow.rows[0]) {
      const vcId = credVcRow.rows[0].vc_json?.id || credentialId;
      besuService.revokeVCOnChain(vcId).catch(err => console.error('[Besu] Revoke failed:', err.message));
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

    // Employees use their sub-DID for VP composition
    const holderDidResult = (user as any).sub_role === 'employee'
      ? await query(
          `SELECT d.id, d.did_string, d.private_key_encrypted FROM employee_registry er JOIN dids d ON er.sub_did_id = d.id WHERE er.user_id = $1 LIMIT 1`,
          [user.id]
        )
      : await query(
          "SELECT id, did_string, private_key_encrypted FROM dids WHERE user_id = $1 AND did_type = 'parent' LIMIT 1",
          [orgDIDOwner(user)]
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
    const orgRoot = user.org_id || user.id;
    const result = await query(
      `INSERT INTO verification_requests (verifier_user_id, holder_did_id, required_credential_types, challenge)
       VALUES ($1, $2, $3, $4) RETURNING *`,
      [orgRoot, holderDidId, requiredCredentialTypes || [], challenge]
    );

    res.json({ success: true, request: result.rows[0] });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// Verifier: search employees across all corporates to find their DID for targeting VP requests
app.get('/api/verifier/employees', requireAuth, requireRole('verifier'), async (req, res) => {
  try {
    const { q } = req.query; // search by name or email
    const searchClause = q
      ? `WHERE (er.name ILIKE $1 OR er.email ILIKE $1 OR u.name ILIKE $1)`
      : '';
    const params = q ? [`%${q}%`] : [];

    const result = await query(
      `SELECT er.id, er.employee_id, er.name, er.email, er.user_id,
              d.did_string as employee_did,
              u.name as org_name, u.id as org_id
       FROM employee_registry er
       LEFT JOIN dids d ON er.sub_did_id = d.id
       LEFT JOIN users u ON er.corporate_user_id = u.id
       ${searchClause}
       ORDER BY er.name
       LIMIT 50`,
      params
    );
    res.json({ success: true, employees: result.rows });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

app.get('/api/verifier/requests', requireAuth, requireRole('verifier'), async (req, res) => {
  try {
    const user = (req as any).user;
    const orgRoot = user.org_id || user.id;
    const result = await query(
      `SELECT vr.*, p.vp_json FROM verification_requests vr
       LEFT JOIN presentations p ON vr.presentation_id = p.id
       WHERE vr.verifier_user_id IN (SELECT id FROM users WHERE id=$1 OR org_id=$1)
       ORDER BY vr.created_at DESC`,
      [orgRoot]
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
    // Employees use their sub-DID; other corporate users use parent DID
    const didRow = (user as any).sub_role === 'employee'
      ? await query(
          `SELECT d.id FROM employee_registry er JOIN dids d ON er.sub_did_id = d.id WHERE er.user_id = $1 LIMIT 1`,
          [user.id]
        )
      : await query(
          `SELECT id FROM dids WHERE user_id = $1 AND parent_did_id IS NULL LIMIT 1`,
          [orgDIDOwner(user)]
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
    if (user.sub_role && !['checker', 'super_admin'].includes(user.sub_role)) {
      return res.status(403).json({ error: 'Only checker or super_admin can approve verification requests' });
    }
    const orgRoot = user.org_id || user.id;
    const vrResult = await query(
      'SELECT * FROM verification_requests WHERE id = $1 AND verifier_user_id IN (SELECT id FROM users WHERE id=$2 OR org_id=$2)',
      [id, orgRoot]
    );
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

    // Verify on Besu
    const besuResults = [];
    for (const vc of vcList) {
      if (vc.id) {
        const onChainResult = await besuService.verifyVCOnChain(vc.id, vc);
        besuResults.push({ vcId: vc.id, ...onChainResult });
      }
    }

    res.json({ success: true, message: 'Verification approved', besuResults });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

app.post('/api/verifier/requests/:id/reject', requireAuth, requireRole('verifier'), async (req, res) => {
  try {
    const user = (req as any).user;
    const { id } = req.params;
    const { reason } = req.body;
    if (user.sub_role && !['checker', 'super_admin'].includes(user.sub_role)) {
      return res.status(403).json({ error: 'Only checker or super_admin can reject verification requests' });
    }
    const orgRoot = user.org_id || user.id;
    await query(
      `UPDATE verification_requests SET status = 'rejected', rejection_reason = $1, updated_at = NOW()
       WHERE id = $2 AND verifier_user_id IN (SELECT id FROM users WHERE id=$3 OR org_id=$3)`,
      [reason || 'No reason provided', id, orgRoot]
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

// 2. GET /api/users/issuers — list platform entities (named issuers) with user_id + entity_type
app.get('/api/users/issuers', requireAuth, requireRole('corporate'), async (req, res) => {
  try {
    // Return platform entities (named orgs) with their admin user_id and DID
    const result = await query(
      `SELECT pe.user_id as id, pe.name, pe.email, pe.entity_type, d.did_string
       FROM platform_entities pe
       JOIN dids d ON d.user_id = pe.user_id AND d.did_type = 'parent'
       WHERE pe.status = 'active'
       ORDER BY pe.entity_type, pe.name`,
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

    // 5. Anchor on Besu
    let besuTxHash: string | undefined;
    try {
      const anchored = await besuService.anchorVC(vcId, signedVC, issuerDid.did_string, holderDid.did_string, credentialType, expiresAt);
      besuTxHash = anchored.txHash;
      query(`UPDATE credentials SET polygon_tx_hash=$1, polygon_vc_hash=$2,
             polygon_block_number=$3, polygon_anchored_at=NOW() WHERE vc_json->>'id'=$4`,
        [anchored.txHash, anchored.vcHash, anchored.blockNumber ?? null, vcId])
        .catch(e => console.error('[Besu] DB update failed:', e.message));
    } catch (err: any) { console.error('[Besu] Anchor failed:', err.message); }

    // 6. Audit log
    await writeAuditLog('vc_issued_direct', issuerDid.did_string, holderDid.did_string, credentialType);

    // 7. Response
    res.json({ success: true, credential: signedVC, credentialId: credResult.rows[0].id, besuTxHash });
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

    // Get caller's parent DID (scoped to org for maker/checker)
    const callerDidResult = await query(
      `SELECT id, did_string, private_key_encrypted FROM dids WHERE user_id = $1 AND did_type = 'parent' LIMIT 1`,
      [orgDIDOwner(user)]
    );
    if (callerDidResult.rows.length === 0) return res.status(400).json({ error: 'No DID found for user' });
    const holderDid = callerDidResult.rows[0];

    // Verify credential belongs to org
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

    // Get holder's DID (scoped to org for maker/checker)
    const holderDidResult = await query(
      `SELECT id, did_string, private_key_encrypted FROM dids WHERE user_id = $1 AND did_type = 'parent' LIMIT 1`,
      [orgDIDOwner(user)]
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

// ─── Besu Endpoints ────────────────────────────────────────────────────────

app.get('/api/besu/status', async (req, res) => {
  try {
    const status = await besuService.getStatus();
    res.json({ success: true, ...status });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// Kept for backwards compatibility
app.get('/api/besu/network', (req, res) => {
  res.json({ network: besuService.getNetwork(), rpcUrl: besuService.getRpcUrl() });
});

// ─── Besu Explorer Endpoints ──────────────────────────────────────────────────

// Raw JSON-RPC proxy to local chain (uses Node 18+ native fetch)
async function rpc(method: string, params: any[] = []): Promise<any> {
  const res = await fetch(process.env.BESU_RPC_URL || 'http://localhost:8545', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', method, params, id: 1 }),
  });
  const json: any = await res.json();
  if (json.error) throw new Error(json.error.message);
  return json.result;
}

// GET /api/besu/explorer/overview — chain summary
app.get('/api/besu/explorer/overview', async (_req, res) => {
  try {
    const [blockHex, chainIdHex, gasPrice] = await Promise.all([
      rpc('eth_blockNumber'),
      rpc('eth_chainId'),
      rpc('eth_gasPrice'),
    ]);
    const latestBlockNumber = parseInt(blockHex, 16);
    const latestBlock = await rpc('eth_getBlockByNumber', [blockHex, true]);
    const totalTxns = latestBlock?.transactions?.length || 0;

    // Count transactions across all blocks
    let totalTransactions = 0;
    const blockPromises = Array.from({ length: latestBlockNumber + 1 }, (_, i) =>
      rpc('eth_getBlockByNumber', [hex(i), false])
    );
    const blocks = await Promise.all(blockPromises);
    for (const b of blocks) totalTransactions += (b?.transactions?.length || 0);

    res.json({
      success: true,
      blockNumber: latestBlockNumber,
      chainId: parseInt(chainIdHex, 16),
      gasPrice: parseInt(gasPrice, 16),
      totalTransactions,
      didRegistryAddress: process.env.DID_REGISTRY_ADDRESS || null,
      vcRegistryAddress: process.env.VC_REGISTRY_ADDRESS || null,
      rpcUrl: process.env.BESU_RPC_URL || 'http://localhost:8545',
      network: process.env.BESU_NETWORK || 'dev',
      latestBlock: {
        number: latestBlockNumber,
        hash: latestBlock?.hash,
        timestamp: latestBlock?.timestamp ? parseInt(latestBlock.timestamp, 16) : null,
        txCount: latestBlock?.transactions?.length || 0,
        gasUsed: latestBlock?.gasUsed ? parseInt(latestBlock.gasUsed, 16) : 0,
      },
    });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

function hex(n: number): string { return '0x' + n.toString(16); }

// GET /api/besu/explorer/blocks?page=1&limit=20
app.get('/api/besu/explorer/blocks', async (req, res) => {
  try {
    const limit = Math.min(parseInt(req.query.limit as string) || 20, 50);
    const page = parseInt(req.query.page as string) || 1;
    const latestHex = await rpc('eth_blockNumber');
    const latest = parseInt(latestHex, 16);

    // Fetch blocks from latest downward
    const from = Math.max(0, latest - (page - 1) * limit);
    const to   = Math.max(0, from - limit + 1);
    const indices = Array.from({ length: from - to + 1 }, (_, i) => from - i);

    const blocks = await Promise.all(
      indices.map(i => rpc('eth_getBlockByNumber', [hex(i), true]))
    );

    const formatted = blocks.filter(Boolean).map((b: any) => ({
      number: parseInt(b.number, 16),
      hash: b.hash,
      parentHash: b.parentHash,
      timestamp: parseInt(b.timestamp, 16),
      txCount: b.transactions?.length || 0,
      gasUsed: parseInt(b.gasUsed || '0', 16),
      gasLimit: parseInt(b.gasLimit || '0', 16),
      miner: b.miner,
      transactions: (b.transactions || []).map((tx: any) => ({
        hash: tx.hash,
        from: tx.from,
        to: tx.to,
        value: parseInt(tx.value || '0', 16),
        gas: parseInt(tx.gas || '0', 16),
        contract: !tx.to ? '(contract deploy)' :
          tx.to?.toLowerCase() === (process.env.DID_REGISTRY_ADDRESS || '').toLowerCase() ? 'DID Registry' :
          tx.to?.toLowerCase() === (process.env.VC_REGISTRY_ADDRESS || '').toLowerCase() ? 'VC Registry' : tx.to,
        type: !tx.to ? 'deploy' :
          tx.to?.toLowerCase() === (process.env.DID_REGISTRY_ADDRESS || '').toLowerCase() ? 'DID' :
          tx.to?.toLowerCase() === (process.env.VC_REGISTRY_ADDRESS || '').toLowerCase() ? 'VC' : 'transfer',
      })),
    }));

    res.json({ success: true, blocks: formatted, totalBlocks: latest + 1, page, limit });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// GET /api/besu/explorer/tx/:hash — single transaction detail
app.get('/api/besu/explorer/tx/:hash', async (req, res) => {
  try {
    const [tx, receipt] = await Promise.all([
      rpc('eth_getTransactionByHash', [req.params.hash]),
      rpc('eth_getTransactionReceipt', [req.params.hash]),
    ]);
    if (!tx) return res.status(404).json({ error: 'Transaction not found' });

    const DID_ADDR = (process.env.DID_REGISTRY_ADDRESS || '').toLowerCase();
    const VC_ADDR  = (process.env.VC_REGISTRY_ADDRESS  || '').toLowerCase();
    const toAddr   = (tx.to || '').toLowerCase();

    // Cross-reference with DB for VC/DID info
    const vcRow = receipt?.status === '0x1'
      ? await query(`SELECT c.credential_type, c.issued_at, hd.did_string as holder_did,
                            id2.did_string as issuer_did
                     FROM credentials c
                     LEFT JOIN dids hd ON hd.id = c.holder_did_id
                     LEFT JOIN dids id2 ON id2.id = c.issuer_did_id
                     WHERE c.polygon_tx_hash = $1 LIMIT 1`, [req.params.hash])
      : null;

    const didRow = receipt?.status === '0x1'
      ? await query(`SELECT did_string FROM dids WHERE polygon_tx_hash = $1 LIMIT 1`, [req.params.hash])
      : null;

    res.json({
      success: true,
      transaction: {
        hash: tx.hash,
        blockNumber: parseInt(tx.blockNumber || '0', 16),
        from: tx.from,
        to: tx.to,
        value: parseInt(tx.value || '0', 16),
        gas: parseInt(tx.gas || '0', 16),
        gasUsed: receipt ? parseInt(receipt.gasUsed || '0', 16) : null,
        status: receipt?.status === '0x1' ? 'success' : receipt ? 'failed' : 'pending',
        input: tx.input,
        contract: !tx.to ? '(contract deploy)' :
          toAddr === DID_ADDR ? 'DID Registry' :
          toAddr === VC_ADDR  ? 'VC Registry'  : tx.to,
        type: !tx.to ? 'deploy' : toAddr === DID_ADDR ? 'DID' : toAddr === VC_ADDR ? 'VC' : 'transfer',
        // DB cross-reference
        credential: vcRow?.rows[0] || null,
        did: didRow?.rows[0] || null,
        logs: receipt?.logs || [],
      },
    });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// GET /api/besu/explorer/transactions — all transactions with DB annotations
app.get('/api/besu/explorer/transactions', async (req, res) => {
  try {
    const limit = Math.min(parseInt(req.query.limit as string) || 50, 200);
    const latestHex = await rpc('eth_blockNumber');
    const latest = parseInt(latestHex, 16);

    const allBlocks = await Promise.all(
      Array.from({ length: latest + 1 }, (_, i) => rpc('eth_getBlockByNumber', [hex(i), true]))
    );

    const DID_ADDR = (process.env.DID_REGISTRY_ADDRESS || '').toLowerCase();
    const VC_ADDR  = (process.env.VC_REGISTRY_ADDRESS  || '').toLowerCase();

    // Flatten all transactions, newest first
    const txns: any[] = [];
    for (const block of allBlocks.reverse()) {
      if (!block) continue;
      const ts = parseInt(block.timestamp, 16);
      const bn = parseInt(block.number, 16);
      for (const tx of (block.transactions || [])) {
        const toAddr = (tx.to || '').toLowerCase();
        txns.push({
          hash: tx.hash,
          blockNumber: bn,
          timestamp: ts,
          from: tx.from,
          to: tx.to,
          gas: parseInt(tx.gas || '0', 16),
          contract: !tx.to ? '(deploy)' :
            toAddr === DID_ADDR ? 'DID Registry' :
            toAddr === VC_ADDR  ? 'VC Registry'  : tx.to,
          type: !tx.to ? 'deploy' : toAddr === DID_ADDR ? 'DID' : toAddr === VC_ADDR ? 'VC' : 'transfer',
        });
      }
      if (txns.length >= limit) break;
    }

    // Annotate with DB credential info
    const txHashes = txns.filter(t => t.type === 'VC').map(t => t.hash);
    let credMap: Record<string, any> = {};
    if (txHashes.length > 0) {
      const credRows = await query(
        `SELECT c.polygon_tx_hash, c.credential_type, c.issued_at,
                hd.did_string as holder_did, u.name as holder_name
         FROM credentials c
         LEFT JOIN dids hd ON hd.id = c.holder_did_id
         LEFT JOIN users u ON u.id = hd.user_id
         WHERE c.polygon_tx_hash = ANY($1)`, [txHashes]
      );
      for (const r of credRows.rows) credMap[r.polygon_tx_hash] = r;
    }

    const annotated = txns.slice(0, limit).map(t => ({
      ...t,
      credential: credMap[t.hash] || null,
    }));

    res.json({ success: true, transactions: annotated, total: txns.length });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

app.get('/api/besu/did/:did', async (req, res) => {
  try {
    const result = await besuService.resolveDIDFromChain(req.params.did);
    res.json({ success: true, ...result });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

app.get('/api/besu/vc/:vcId', async (req, res) => {
  try {
    const result = await besuService.getVCFromChain(req.params.vcId);
    res.json({ success: true, ...result });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
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

// ─── Public Endpoints ─────────────────────────────────────────────────────────

// Returns all active DID issuers — used on landing page + Portal Manager dropdown
app.get('/api/public/did-issuers', async (_req, res) => {
  try {
    const result = await query(
      `SELECT u.id, u.name, u.email
       FROM users u
       WHERE u.role = 'government_agency'
         AND u.sub_role = 'did_issuer_admin'
       ORDER BY u.name`,
      []
    );
    res.json({ success: true, issuers: result.rows });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// ── Organization Application Routes ──────────────────────────────────────

app.post('/api/organizations/apply',
  corpDocUpload.fields([
    { name: 'doc_MCARegistration', maxCount: 1 },
    { name: 'doc_GSTINCredential', maxCount: 1 },
    { name: 'doc_IECCredential',   maxCount: 1 },
    { name: 'doc_PANCredential',   maxCount: 1 },
  ]),
  async (req, res) => {
    try {
      // multer puts text fields in req.body and files in req.files
      const {
        org_name, email, org_logo_url,
        director_full_name, aadhaar_number, dob, gender, state, pincode,
        company_name, cin, company_status, company_category, date_of_incorporation,
        pan_number, gstn, ie_code,
        director_name, din, designation, signing_authority_level,
        // new fields
        super_admin_name, super_admin_email,
        requester_name, requester_email,
        documents: documentsJson,
      } = req.body as Record<string, string>;

      // Validate required fields
      const requiredFields = [org_name, email, director_full_name, state, pincode,
        company_name, cin, company_status, company_category,
        date_of_incorporation, pan_number, company_name,
        super_admin_name, super_admin_email, requester_name, requester_email];
      if (requiredFields.some(v => !v)) {
        return res.status(400).json({ error: 'All required fields must be provided' });
      }

      // Duplicate CIN check
      const existing = await query('SELECT id FROM organization_applications WHERE cin = $1', [cin]);
      if (existing.rows.length > 0) {
        return res.status(400).json({ error: 'An application with this CIN already exists' });
      }

      // Parse documents JSON; attach file_paths from uploaded files
      let documents: any[] = [];
      try {
        documents = JSON.parse(documentsJson || '[]');
      } catch {
        return res.status(400).json({ error: 'Invalid documents JSON' });
      }

      const files = (req.files as Record<string, Express.Multer.File[]>) || {};
      documents = documents.map((doc: any) => {
        const fileField = `doc_${doc.vc_type}`;
        const uploaded = files[fileField]?.[0];
        return {
          ...doc,
          file_path: uploaded
            ? `uploads/corporate-docs/${uploaded.filename}`
            : null,
        };
      });

      // Validate MCA (required) document
      const mcaDoc = documents.find((d: any) => d.vc_type === 'MCARegistration');
      if (!mcaDoc) {
        return res.status(400).json({ error: 'MCA Registration document is required' });
      }

      const result = await query(
        `INSERT INTO organization_applications
          (org_name, email, org_logo_url, director_full_name, aadhaar_number, dob, gender,
           state, pincode, company_name, cin, company_status, company_category,
           date_of_incorporation, pan_number, gstn, ie_code, director_name, din, designation,
           signing_authority_level,
           super_admin_name, super_admin_email, requester_name, requester_email, documents)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,
                 $22,$23,$24,$25,$26)
         RETURNING id`,
        [
          org_name, email, org_logo_url || null,
          director_full_name || '', aadhaar_number || '', dob || '1990-01-01', gender || '',
          state, pincode, company_name, cin,
          company_status || 'Active', company_category || 'Private Limited',
          date_of_incorporation, pan_number, gstn || '', ie_code || '',
          director_name || '', din || '', designation || '', signing_authority_level || 'Single Signatory',
          super_admin_name, super_admin_email, requester_name, requester_email,
          JSON.stringify(documents),
        ]
      );

      res.json({ success: true, applicationId: result.rows[0].id });
    } catch (error: any) {
      console.error('Apply error:', error);
      res.status(500).json({ error: error.message });
    }
  }
);

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

      // Besu anchor (async, non-blocking) — persist tx hash
      besuService.anchorVC(vcId, vc, issuerDid.did_string, holderDid, credType, expiresAt)
        .then(({ txHash, vcHash, blockNumber }) =>
          query(`UPDATE credentials SET polygon_tx_hash=$1, polygon_vc_hash=$2,
                 polygon_block_number=$3, polygon_anchored_at=NOW() WHERE id=$4`,
            [txHash, vcHash, blockNumber ?? null, credResult.rows[0].id])
            .catch(e => console.error('[Besu] DB update failed:', e.message))
        )
        .catch(err => console.error('[Besu] VC anchor failed:', err.message));

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
      const orgRoot = (user as any).org_id || user.id;
      if (user.authority_type) {
        // Handle both legacy vc_issuance and new vc_request_approval flows
        rows = await query(
          `SELECT mc.*, u.authority_type as maker_authority_type,
                  vr.credential_type, vr.request_data,
                  ru.name as requester_name, ru.email as requester_email
           FROM mc_actions mc
           JOIN users u ON u.id = mc.maker_id
           LEFT JOIN vc_requests vr ON vr.id = mc.resource_id AND mc.resource_type = 'vc_request_approval'
           LEFT JOIN users ru ON ru.id = vr.requester_user_id
           WHERE mc.status = 'pending'
             AND (
               (mc.resource_type = 'vc_issuance' AND u.authority_type = $1)
               OR (mc.resource_type = 'vc_request_approval' AND mc.org_id = $2)
             )
           ORDER BY mc.created_at DESC`,
          [user.authority_type, orgRoot]
        );
      } else {
        // New issuer org flow: vc_request_approval items for this org
        rows = await query(
          `SELECT mc.*, vr.credential_type, vr.request_data,
                  ru.name as requester_name, ru.email as requester_email,
                  mu.name as maker_name, mu.email as maker_email
           FROM mc_actions mc
           LEFT JOIN vc_requests vr ON vr.id = mc.resource_id
           LEFT JOIN users ru ON ru.id = vr.requester_user_id
           LEFT JOIN users mu ON mu.id = mc.maker_id
           WHERE mc.status = 'pending'
             AND mc.resource_type = 'vc_request_approval'
             AND mc.org_id = $1
           ORDER BY mc.created_at DESC`,
          [orgRoot]
        );
      }
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
    } else if (user.role === 'portal_manager') {
      rows = await query(
        `SELECT mc.*, pe.name as entity_name, pe.entity_type, pe.email as entity_email,
                mu.name as maker_name, mu.email as maker_email
         FROM mc_actions mc
         LEFT JOIN platform_entities pe ON pe.id = mc.resource_id AND mc.resource_type = 'entity_onboarding'
         LEFT JOIN users mu ON mu.id = mc.maker_id
         WHERE mc.status = 'pending'
           AND mc.resource_type = 'entity_onboarding'
         ORDER BY mc.created_at DESC`
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
    const allowedSubRoles = ['maker', 'vc_issuer_admin', 'super_admin'];
    if (!user.sub_role || !allowedSubRoles.includes(user.sub_role)) {
      return res.status(403).json({ error: 'Only users with sub_role maker, vc_issuer_admin, or super_admin can submit actions' });
    }
    const { resource_type, resource_id, payload } = req.body;
    if (!resource_type || !resource_id) {
      return res.status(400).json({ error: 'resource_type and resource_id are required' });
    }
    if (!['vc_issuance', 'vp_share', 'entity_onboarding'].includes(resource_type)) {
      return res.status(400).json({ error: 'resource_type must be vc_issuance, vp_share, or entity_onboarding' });
    }

    // Cross-role guard
    if (user.role === 'government_agency' && resource_type !== 'vc_issuance') {
      return res.status(403).json({ error: 'Government agency users can only submit vc_issuance actions' });
    }
    if (user.role === 'corporate' && resource_type !== 'vp_share') {
      return res.status(403).json({ error: 'Corporate users can only submit vp_share actions' });
    }
    if (user.role === 'portal_manager' && resource_type !== 'entity_onboarding') {
      return res.status(403).json({ error: 'Portal manager users can only submit entity_onboarding actions' });
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
    const allowedApproveSubRoles = user.role === 'portal_manager'
      ? ['checker', 'super_admin']
      : ['checker', 'super_admin', 'vc_issuer_admin', 'did_issuer_admin'];
    if (!user.sub_role || !allowedApproveSubRoles.includes(user.sub_role)) {
      return res.status(403).json({ error: 'Insufficient sub_role to approve actions' });
    }

    const actionResult = await query('SELECT * FROM mc_actions WHERE id = $1', [req.params.id]);
    const action = actionResult.rows[0];
    if (!action) return res.status(404).json({ error: 'Action not found' });
    if (action.status !== 'pending') return res.status(400).json({ error: `Action is already ${action.status}` });

    // Self-approval guard — super_admin can bypass for single-admin demo setups
    if (action.maker_id === user.id && user.sub_role !== 'super_admin') {
      return res.status(403).json({ error: 'A Maker cannot approve their own action' });
    }

    if (action.resource_type === 'entity_onboarding') {
      if (user.role !== 'portal_manager') return res.status(403).json({ error: 'Only portal_manager can approve entity_onboarding' });

      const entityResult = await query('SELECT * FROM platform_entities WHERE id = $1', [action.resource_id]);
      const entity = entityResult.rows[0];
      if (!entity) return res.status(404).json({ error: 'Platform entity not found' });

      const tempPassword = crypto.randomBytes(8).toString('hex');
      const passwordHash = await hashPassword(tempPassword);

      await query('BEGIN');
      try {
        // Always create entity admins as super_admin so they can approve vc_requests directly
        // and appear in the checker DID lookup. org_id is set to self (org root pattern).
        const userResult = await query(
          `INSERT INTO users (email, password_hash, role, name, sub_role)
           VALUES ($1, $2, 'government_agency', $3, 'super_admin') RETURNING id`,
          [entity.email, passwordHash, entity.name]
        );
        const newUserId = userResult.rows[0].id;
        // Self-referential org_id: marks this user as the root of their org
        await query(`UPDATE users SET org_id = $1 WHERE id = $1`, [newUserId]);

        const slug = entity.name.toLowerCase().replace(/[^a-z0-9]/g, '-');
        const didData = await createAndStoreDID(newUserId, 'parent', undefined, slug);

        await query(
          `UPDATE platform_entities SET status='active', user_id=$1, did=$2, activated_by=$3, updated_at=NOW() WHERE id=$4`,
          [newUserId, didData.did, user.id, entity.id]
        );
        await query(`UPDATE mc_actions SET status='approved', checker_id=$1, updated_at=NOW() WHERE id=$2`, [user.id, req.params.id]);

        await query('COMMIT');
        console.log(`[PORTAL] Entity activated: ${entity.email} | Temp Password: ${tempPassword} | DID: ${didData.did}`);
        res.json({ success: true, entityId: entity.id, userId: newUserId, did: didData.did, tempPassword });
      } catch (innerError: any) {
        await query('ROLLBACK');
        throw innerError;
      }
    } else if (action.resource_type === 'vc_issuance') {
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

        besuService.anchorVC(vcId, vc, issuerDid.did_string, holderDid!, credType, expiresAt)
          .then(({ txHash, vcHash, blockNumber }) =>
            query(`UPDATE credentials SET polygon_tx_hash=$1, polygon_vc_hash=$2,
                   polygon_block_number=$3, polygon_anchored_at=NOW() WHERE id=$4`,
              [txHash, vcHash, blockNumber ?? null, credResult.rows[0].id])
              .catch(e => console.error('[Besu] DB update failed:', e.message))
          )
          .catch(err => console.error('[Besu] VC anchor failed:', err.message));

        res.json({ success: true, vcId, credentialType: credType, applicationStatus: newStatus, ...(tempPassword ? { tempPassword } : {}) });
      } catch (innerError: any) {
        await query('ROLLBACK');
        throw innerError;
      }
    } else if (action.resource_type === 'vc_request_approval') {
      if (user.role !== 'government_agency') return res.status(403).json({ error: 'Only government_agency can approve vc_request_approval' });
      const checkerOrgRoot = (user as any).org_id || user.id;
      if (action.org_id && action.org_id !== checkerOrgRoot) {
        return res.status(403).json({ error: 'You can only approve actions for your own issuer org' });
      }
      const vcReqResult = await query('SELECT * FROM vc_requests WHERE id = $1', [action.resource_id]);
      const vcReq = vcReqResult.rows[0];
      if (!vcReq) return res.status(404).json({ error: 'VC request not found' });
      if (vcReq.status !== 'pending') return res.status(400).json({ error: 'VC request is no longer pending' });

      // Use the org root admin's DID for signing (look up by user_id directly, no sub_role constraint
      // since entity admins may have super_admin or legacy did_issuer_admin sub_role)
      const issuerDidResult = await query(
        `SELECT id, did_string, private_key_encrypted FROM dids
         WHERE user_id = $1 AND did_type = 'parent' LIMIT 1`,
        [checkerOrgRoot]
      );
      if (!issuerDidResult.rows[0]) return res.status(400).json({ error: 'Issuer DID not found' });
      const issuerDid = issuerDidResult.rows[0];

      const now = new Date();
      const expiresAt = new Date(now.getTime() + 365 * 24 * 60 * 60 * 1000);
      const vcId = `urn:uuid:${crypto.randomUUID()}`;
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

      await query('BEGIN');
      try {
        const credResult = await query(
          `INSERT INTO credentials (vc_json, holder_did_id, issuer_did_id, credential_type, issued_at, expires_at, vc_request_id)
           VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING id`,
          [JSON.stringify(signedVC), vcReq.requester_did_id, issuerDid.id, vcReq.credential_type, now, expiresAt, vcReq.id]
        );
        await query(`UPDATE vc_requests SET status='approved', updated_at=NOW() WHERE id=$1`, [vcReq.id]);
        await query(`UPDATE mc_actions SET status='approved', checker_id=$1, updated_at=NOW() WHERE id=$2`, [user.id, req.params.id]);
        await query('COMMIT');
        await writeAuditLog('vc_issued', issuerDid.did_string, null, vcReq.credential_type);

        const credDbId = credResult.rows[0].id;
        const holderVcDidStr = vcReq.requester_did_id
          ? (await query('SELECT did_string FROM dids WHERE id = $1', [vcReq.requester_did_id])).rows[0]?.did_string || ''
          : '';
        besuService.anchorVC(vcId, signedVC, issuerDid.did_string, holderVcDidStr, vcReq.credential_type, expiresAt)
          .then(({ txHash, vcHash, blockNumber }) =>
            query(`UPDATE credentials SET polygon_tx_hash=$1, polygon_vc_hash=$2,
                   polygon_block_number=$3, polygon_anchored_at=NOW() WHERE id=$4`,
              [txHash, vcHash, blockNumber ?? null, credDbId])
              .catch(e => console.error('[Besu] DB update failed:', e.message))
          )
          .catch(err => console.error('[Besu] VC anchor (checker) failed:', err.message));

        res.json({ success: true, credential: signedVC, credentialDbId: credDbId, besuTxHash: undefined });
      } catch (innerError: any) {
        await query('ROLLBACK');
        throw innerError;
      }
    } else if (action.resource_type === 'vp_share') {
      // Org-scope guard: checker must belong to the same org as the action
      const checkerOrgId = (user as any).org_id || user.id;
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
    const allowedRejectSubRoles = (user.role === 'portal_manager' || user.role === 'government_agency')
      ? ['checker', 'super_admin', 'did_issuer_admin', 'vc_issuer_admin']
      : ['checker', 'vc_issuer_admin', 'did_issuer_admin'];
    if (!user.sub_role || !allowedRejectSubRoles.includes(user.sub_role)) {
      return res.status(403).json({ error: 'Insufficient sub_role to reject actions' });
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
      if (action.resource_type === 'entity_onboarding') {
        await query(`UPDATE platform_entities SET status='rejected', rejection_reason=$1, updated_at=NOW() WHERE id=$2`, [reason, action.resource_id]);
      }
      if (action.resource_type === 'vc_request_approval') {
        await query(`UPDATE vc_requests SET status='rejected', rejection_reason=$1, updated_at=NOW() WHERE id=$2`, [reason, action.resource_id]);
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

// ── Authority (Government Agency) Team Routes ─────────────────────────────

app.get('/api/authority/team', requireAuth, async (req, res) => {
  try {
    const user = (req as any).user;
    if (user.role !== 'government_agency') return res.status(403).json({ error: 'Forbidden' });
    const orgRoot = user.org_id || user.id;
    const result = await query(
      `SELECT id, email, name, sub_role, created_at FROM users
       WHERE role='government_agency' AND (id=$1 OR org_id=$1)
       ORDER BY sub_role, created_at DESC`,
      [orgRoot]
    );
    res.json({ team: result.rows });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

app.post('/api/authority/team/invite', requireAuth, async (req, res) => {
  try {
    const user = (req as any).user;
    if (user.role !== 'government_agency') return res.status(403).json({ error: 'Forbidden' });
    if (user.sub_role !== 'super_admin') return res.status(403).json({ error: 'Only super_admin can invite team members' });
    const { email, name, sub_role } = req.body;
    if (!email || !name || !sub_role) return res.status(400).json({ error: 'email, name, and sub_role are required' });
    if (!['maker', 'checker'].includes(sub_role)) return res.status(400).json({ error: 'sub_role must be maker or checker' });
    const orgRoot = user.org_id || user.id;
    const existing = await query('SELECT id FROM users WHERE email=$1', [email]);
    if (existing.rows.length > 0) return res.status(409).json({ error: 'Email already registered' });
    const tempPassword = Math.random().toString(36).slice(-10) + 'A1!';
    const bcrypt = await import('bcryptjs');
    const passwordHash = await bcrypt.default.hash(tempPassword, 10);
    const inserted = await query(
      `INSERT INTO users (email, password_hash, role, name, sub_role, org_id)
       VALUES ($1, $2, 'government_agency', $3, $4, $5) RETURNING id`,
      [email, passwordHash, name, sub_role, orgRoot]
    );
    res.json({ success: true, userId: inserted.rows[0].id, tempPassword });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// ── Verifier Team Routes ──────────────────────────────────────────────────

app.get('/api/verifier/team', requireAuth, async (req, res) => {
  try {
    const user = (req as any).user;
    if (user.role !== 'verifier') return res.status(403).json({ error: 'Forbidden' });
    const orgRoot = user.org_id || user.id;
    const result = await query(
      `SELECT id, email, name, sub_role, created_at FROM users
       WHERE role='verifier' AND (id=$1 OR org_id=$1)
       ORDER BY sub_role, created_at DESC`,
      [orgRoot]
    );
    res.json({ team: result.rows });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

app.post('/api/verifier/team/invite', requireAuth, async (req, res) => {
  try {
    const user = (req as any).user;
    if (user.role !== 'verifier') return res.status(403).json({ error: 'Forbidden' });
    if (user.sub_role !== 'super_admin') return res.status(403).json({ error: 'Only super_admin can invite team members' });
    const { email, name, sub_role } = req.body;
    if (!email || !name || !sub_role) return res.status(400).json({ error: 'email, name, and sub_role are required' });
    if (!['maker', 'checker'].includes(sub_role)) return res.status(400).json({ error: 'sub_role must be maker or checker' });
    const orgRoot = user.org_id || user.id;
    const existing = await query('SELECT id FROM users WHERE email=$1', [email]);
    if (existing.rows.length > 0) return res.status(409).json({ error: 'Email already registered' });
    const tempPassword = Math.random().toString(36).slice(-10) + 'A1!';
    const bcrypt = await import('bcryptjs');
    const passwordHash = await bcrypt.default.hash(tempPassword, 10);
    const inserted = await query(
      `INSERT INTO users (email, password_hash, role, name, sub_role, org_id)
       VALUES ($1, $2, 'verifier', $3, $4, $5) RETURNING id`,
      [email, passwordHash, name, sub_role, orgRoot]
    );
    res.json({ success: true, userId: inserted.rows[0].id, tempPassword });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// ── Portal Manager Routes ─────────────────────────────────────────────────

app.get('/api/portal/stats', requireAuth, requireRole('portal_manager' as any), async (req, res) => {
  try {
    const stats = await query(`
      SELECT
        (SELECT COUNT(*) FROM organization_applications) AS total_orgs,
        (SELECT COUNT(*) FROM platform_entities WHERE status = 'active') AS total_entities,
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

// Portal Manager: Admin Team Management (super_admin only)
app.get('/api/portal/admin/team', requireAuth, requireRole('portal_manager' as any), async (req, res) => {
  try {
    const user = (req as any).user;
    if (user.sub_role !== 'super_admin') return res.status(403).json({ error: 'Only super_admin can view admin team' });
    const rows = await query(
      `SELECT id, email, name, sub_role, created_at FROM users
       WHERE role = 'portal_manager'
       ORDER BY CASE sub_role WHEN 'super_admin' THEN 0 WHEN 'checker' THEN 1 ELSE 2 END, created_at DESC`
    );
    res.json({ team: rows.rows });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

app.post('/api/portal/admin/team', requireAuth, requireRole('portal_manager' as any), async (req, res) => {
  try {
    const user = (req as any).user;
    if (user.sub_role !== 'super_admin') return res.status(403).json({ error: 'Only super_admin can add admin team members' });
    const { email, name, sub_role } = req.body;
    if (!email || !name || !sub_role) return res.status(400).json({ error: 'email, name, and sub_role are required' });
    if (!['super_admin', 'maker', 'checker'].includes(sub_role)) return res.status(400).json({ error: 'sub_role must be super_admin, maker, or checker' });
    const existing = await query('SELECT id FROM users WHERE email = $1', [email]);
    if (existing.rows.length > 0) return res.status(400).json({ error: 'Email already exists' });
    const tempPassword = crypto.randomBytes(8).toString('hex');
    const passwordHash = await hashPassword(tempPassword);
    const result = await query(
      `INSERT INTO users (email, password_hash, role, name, sub_role) VALUES ($1, $2, 'portal_manager', $3, $4) RETURNING id`,
      [email, passwordHash, name, sub_role]
    );
    console.log(`[PORTAL] Admin team member created: ${email} | sub_role: ${sub_role} | Temp Password: ${tempPassword}`);
    res.json({ success: true, userId: result.rows[0].id, tempPassword });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// Portal Manager: Platform Entities
app.get('/api/portal/entities', requireAuth, requireRole('portal_manager' as any), async (req, res) => {
  try {
    const rows = await query(
      `SELECT pe.*, u.email as user_email,
              ob.name as onboarded_by_name,
              ab.name as activated_by_name
       FROM platform_entities pe
       LEFT JOIN users u ON u.id = pe.user_id
       LEFT JOIN users ob ON ob.id = pe.onboarded_by
       LEFT JOIN users ab ON ab.id = pe.activated_by
       ORDER BY pe.created_at DESC`
    );
    res.json({ entities: rows.rows });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

app.post('/api/portal/entities/submit', requireAuth, requireRole('portal_manager' as any), async (req, res) => {
  try {
    const user = (req as any).user;
    if (!user.sub_role || !['maker', 'super_admin'].includes(user.sub_role)) {
      return res.status(403).json({ error: 'Only maker or super_admin can submit entity onboarding' });
    }
    const { name, email, entity_type, notes } = req.body;
    if (!name || !email || !entity_type) return res.status(400).json({ error: 'name, email, and entity_type are required' });
    if (!['did_issuer', 'vc_issuer', 'trust_endorser'].includes(entity_type)) {
      return res.status(400).json({ error: 'entity_type must be did_issuer, vc_issuer, or trust_endorser' });
    }
    const existingUser = await query('SELECT id FROM users WHERE email = $1', [email]);
    if (existingUser.rows.length > 0) return res.status(400).json({ error: 'Email already registered as a user' });
    const existingEntity = await query('SELECT id FROM platform_entities WHERE email = $1', [email]);
    if (existingEntity.rows.length > 0) return res.status(400).json({ error: 'Email already registered as an entity' });

    await query('BEGIN');
    try {
      const entityResult = await query(
        `INSERT INTO platform_entities (name, email, entity_type, notes, onboarded_by)
         VALUES ($1, $2, $3, $4, $5) RETURNING id`,
        [name, email, entity_type, notes || null, user.id]
      );
      const entityId = entityResult.rows[0].id;
      const actionResult = await query(
        `INSERT INTO mc_actions (resource_type, resource_id, maker_id, payload)
         VALUES ('entity_onboarding', $1, $2, $3) RETURNING id`,
        [entityId, user.id, JSON.stringify({ name, email, entity_type })]
      );
      await query('COMMIT');
      res.json({ success: true, entityId, actionId: actionResult.rows[0].id });
    } catch (innerError: any) {
      await query('ROLLBACK');
      throw innerError;
    }
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
      `SELECT u.id, u.email, u.name, u.sub_role, u.created_at,
              er.id AS employee_registry_id
       FROM users u
       LEFT JOIN employee_registry er ON er.user_id = u.id
       WHERE u.org_id = $1
       ORDER BY u.created_at DESC`,
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
    const validSubRoles = ['admin', 'operator', 'maker', 'checker', 'member', 'requester', 'authorized_signatory'];
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

// ── Employee Portal: create user account for an employee ──────────────────────
app.post('/api/corporate/employees/:id/create-account', requireAuth, requireRole('corporate'), async (req, res) => {
  try {
    const user = (req as any).user;
    if (!['super_admin', 'admin'].includes(user.sub_role)) {
      return res.status(403).json({ error: 'Only super_admin or admin can create employee accounts' });
    }
    const { id } = req.params;
    const orgOwner = orgDIDOwner(user);

    // Fetch employee
    const empResult = await query(
      `SELECT er.*, d.did_string FROM employee_registry er
       LEFT JOIN dids d ON er.sub_did_id = d.id
       WHERE er.id = $1 AND er.corporate_user_id = $2`,
      [id, orgOwner]
    );
    if (empResult.rows.length === 0) return res.status(404).json({ error: 'Employee not found' });
    const emp = empResult.rows[0];

    if (emp.user_id) {
      return res.status(400).json({ error: 'Employee already has a user account' });
    }
    if (!emp.email) return res.status(400).json({ error: 'Employee has no email address' });

    const existing = await query('SELECT id FROM users WHERE email = $1', [emp.email]);
    if (existing.rows.length > 0) {
      // Link existing account
      await query(`UPDATE employee_registry SET user_id = $1 WHERE id = $2`, [existing.rows[0].id, id]);
      return res.json({ success: true, userId: existing.rows[0].id, message: 'Linked to existing account' });
    }

    const orgId = user.org_id || user.id;
    const tempPassword = crypto.randomBytes(8).toString('hex');
    const passwordHash = await hashPassword(tempPassword);
    const newUser = await query(
      `INSERT INTO users (email, password_hash, role, name, sub_role, org_id)
       VALUES ($1, $2, 'corporate', $3, 'employee', $4) RETURNING id`,
      [emp.email, passwordHash, emp.name, orgId]
    );
    const newUserId = newUser.rows[0].id;
    await query(`UPDATE employee_registry SET user_id = $1 WHERE id = $2`, [newUserId, id]);

    console.log(`[EMPLOYEE ACCOUNT] Created for: ${emp.email} | Temp Password: ${tempPassword}`);
    res.json({ success: true, userId: newUserId, email: emp.email, tempPassword });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// ─── Ledger / Transaction Trail ───────────────────────────────────────────────

// GET /api/ledger/credential/:id — full blockchain trail for a credential
app.get('/api/ledger/credential/:id', requireAuth, async (req, res) => {
  try {
    const user = (req as any).user;
    const { id } = req.params;

    // Fetch credential — support both DB UUID and VC URI (urn:uuid:...)
    const isVcUri = id.startsWith('urn:uuid:') || id.startsWith('urn%3Auuid%3A');
    const decodedId = decodeURIComponent(id);
    const whereClause = isVcUri ? `c.vc_json->>'id' = $1` : `c.id = $1`;

    const credResult = await query(
      `SELECT c.*,
              hd.did_string AS holder_did_string, hd.polygon_tx_hash AS holder_did_tx, hd.polygon_block_number AS holder_did_block,
              id2.did_string AS issuer_did_string, id2.polygon_tx_hash AS issuer_did_tx, id2.polygon_block_number AS issuer_did_block,
              iu.name AS issuer_name, iu.email AS issuer_email
       FROM credentials c
       LEFT JOIN dids hd ON hd.id = c.holder_did_id
       LEFT JOIN dids id2 ON id2.id = c.issuer_did_id
       LEFT JOIN users iu ON iu.id = (SELECT user_id FROM dids WHERE id = c.issuer_did_id LIMIT 1)
       WHERE ${whereClause}
       LIMIT 1`,
      [decodedId]
    );
    if (credResult.rows.length === 0) return res.status(404).json({ error: 'Credential not found' });
    const cred = credResult.rows[0];

    // Authorization: holder, issuer, or verifier who approved a VP containing this credential
    const userId = user.id;
    const orgId = (user as any).org_id || user.id;
    const holderUserId = cred.holder_did_id
      ? (await query('SELECT user_id FROM dids WHERE id = $1', [cred.holder_did_id])).rows[0]?.user_id
      : null;
    const issuerUserId = cred.issuer_did_id
      ? (await query('SELECT user_id FROM dids WHERE id = $1', [cred.issuer_did_id])).rows[0]?.user_id
      : null;
    const issuerOrgId = issuerUserId
      ? (await query('SELECT org_id FROM users WHERE id = $1', [issuerUserId])).rows[0]?.org_id
      : null;

    const canView =
      userId === holderUserId ||
      (user as any).org_id === holderUserId ||
      userId === issuerUserId ||
      (issuerOrgId && (userId === issuerOrgId || (user as any).org_id === issuerOrgId)) ||
      user.role === 'verifier' ||
      user.role === 'portal_manager';

    if (!canView) return res.status(403).json({ error: 'Access denied' });

    // Fetch verification events that included this credential
    const vcId = (cred.vc_json as any)?.id;
    const verifResult = await query(
      `SELECT vr.id, vr.status, vr.updated_at, vr.rejection_reason,
              vu.name AS verifier_name, vu.email AS verifier_email,
              vd.did_string AS verifier_did
       FROM presentations p
       JOIN verification_requests vr ON vr.id = p.verifier_request_id
       JOIN users vu ON vu.id = vr.verifier_user_id
       LEFT JOIN dids vd ON vd.user_id = vr.verifier_user_id AND vd.did_type = 'parent'
       WHERE p.holder_did_id = $1
         AND p.vp_json::text LIKE $2
       ORDER BY vr.updated_at DESC LIMIT 10`,
      [cred.holder_did_id, `%${vcId}%`]
    );

    // Audit trail entries for this credential
    const auditResult = await query(
      `SELECT event_type, actor_did, subject_did, created_at
       FROM audit_logs
       WHERE (actor_did = $1 OR subject_did = $1 OR metadata::text LIKE $2)
         AND event_type IN ('vc_issued', 'vc_revoked', 'vp_created', 'vp_verified')
       ORDER BY created_at ASC LIMIT 20`,
      [cred.issuer_did_string, `%${vcId?.replace('urn:uuid:', '') || 'x'}%`]
    );

    const network = process.env.BESU_NETWORK || 'dev';
    const explorerBase = process.env.BESU_EXPLORER_URL || null;

    res.json({
      success: true,
      trail: {
        credentialId: cred.id,
        vcId,
        credentialType: cred.credential_type,
        issuedAt: cred.issued_at,
        expiresAt: cred.expires_at,
        revoked: cred.revoked,
        issuer: {
          did: cred.issuer_did_string,
          name: cred.issuer_name,
          email: cred.issuer_email,
          besu: cred.issuer_did_tx ? {
            txHash: cred.issuer_did_tx,
            blockNumber: cred.issuer_did_block,
            explorerUrl: explorerBase ? `${explorerBase}/tx/${cred.issuer_did_tx}` : null,
            mode: cred.issuer_did_block ? 'live' : 'demo',
          } : null,
        },
        holder: {
          did: cred.holder_did_string,
          besu: cred.holder_did_tx ? {
            txHash: cred.holder_did_tx,
            blockNumber: cred.holder_did_block,
            explorerUrl: explorerBase ? `${explorerBase}/tx/${cred.holder_did_tx}` : null,
            mode: cred.holder_did_block ? 'live' : 'demo',
          } : null,
        },
        vcAnchor: cred.polygon_tx_hash ? {
          txHash: cred.polygon_tx_hash,
          vcHash: cred.polygon_vc_hash,
          blockNumber: cred.polygon_block_number,
          anchoredAt: cred.polygon_anchored_at,
          explorerUrl: explorerBase ? `${explorerBase}/tx/${cred.polygon_tx_hash}` : null,
          mode: cred.polygon_block_number ? 'live' : 'demo',
          network,
        } : null,
        verifications: verifResult.rows.map((r: any) => ({
          id: r.id,
          status: r.status,
          verifiedAt: r.updated_at,
          verifierName: r.verifier_name,
          verifierEmail: r.verifier_email,
          verifierDid: r.verifier_did,
          rejectionReason: r.rejection_reason,
        })),
        auditEvents: auditResult.rows,
      },
    });
  } catch (error: any) {
    console.error('[Ledger] Error:', error);
    res.status(500).json({ error: error.message });
  }
});

// GET /api/ledger/did/:did — blockchain trail for a DID
app.get('/api/ledger/did/:did', requireAuth, async (req, res) => {
  try {
    const didString = decodeURIComponent(req.params.did);
    const didResult = await query(
      `SELECT d.*, u.name, u.email, u.role FROM dids d JOIN users u ON u.id = d.user_id WHERE d.did_string = $1`,
      [didString]
    );
    if (didResult.rows.length === 0) return res.status(404).json({ error: 'DID not found' });
    const did = didResult.rows[0];

    const network = process.env.BESU_NETWORK || 'dev';
    const explorerBase = process.env.BESU_EXPLORER_URL || null;

    // Credentials issued by or held by this DID
    const credCount = await query(
      `SELECT COUNT(*) FROM credentials WHERE issuer_did_id = $1 OR holder_did_id = $1`,
      [did.id]
    );

    res.json({
      success: true,
      did: {
        didString,
        ownerName: did.name,
        ownerEmail: did.email,
        role: did.role,
        createdAt: did.created_at,
        besu: did.polygon_tx_hash ? {
          txHash: did.polygon_tx_hash,
          blockNumber: did.polygon_block_number,
          explorerUrl: explorerBase ? `${explorerBase}/tx/${did.polygon_tx_hash}` : null,
          mode: did.polygon_block_number ? 'live' : 'demo',
          network,
        } : null,
        credentialCount: parseInt(credCount.rows[0].count),
      },
    });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// ─── Task 2: Verifier — Corporate org + employee listing ──────────────────────

// Verifier: list all corporate organisations (root users with role=corporate, org_id=self)
app.get('/api/verifier/corporates', requireAuth, requireRole('verifier'), async (req, res) => {
  try {
    const result = await query(
      `SELECT DISTINCT ON (u.id) u.id, u.name, u.email,
              d.did_string,
              (SELECT COUNT(*) FROM employee_registry er WHERE er.corporate_user_id = u.id) AS employee_count
       FROM users u
       LEFT JOIN dids d ON d.user_id = u.id AND d.did_type = 'parent'
       WHERE u.role = 'corporate'
         AND u.sub_role = 'super_admin'
         AND u.org_id = u.id
       ORDER BY u.id, u.name`,
      []
    );
    res.json({ success: true, corporates: result.rows });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

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

// Verifier: available credential types for a specific employee
// Returns employee's own credential types + corporate types they can share
app.get('/api/verifier/corporates/:orgId/employees/:empRegistryId/credential-types', requireAuth, requireRole('verifier'), async (req, res) => {
  try {
    const { orgId, empRegistryId } = req.params;

    const empCheck = await query(
      `SELECT er.id, er.sub_did_id FROM employee_registry er
       WHERE er.id = $1 AND er.corporate_user_id = $2`,
      [empRegistryId, orgId]
    );
    if (empCheck.rows.length === 0) return res.status(404).json({ error: 'Employee not found' });

    const { sub_did_id } = empCheck.rows[0];
    const types: { type: string; source: string }[] = [];

    // Employee's own credential types (from their sub-DID)
    if (sub_did_id) {
      const empCreds = await query(
        `SELECT DISTINCT credential_type FROM credentials
         WHERE holder_did_id = $1 AND revoked = false ORDER BY credential_type`,
        [sub_did_id]
      );
      empCreds.rows.forEach((r: any) => types.push({ type: r.credential_type, source: 'employee' }));
    }

    // Corporate credential types the employee has permission to share
    const corpPerms = await query(
      `SELECT credential_type FROM employee_credential_permissions
       WHERE employee_registry_id = $1 ORDER BY credential_type`,
      [empRegistryId]
    );
    corpPerms.rows.forEach((r: any) => {
      // Only add as corporate if not already present as an employee type
      if (!types.find(t => t.type === r.credential_type)) {
        types.push({ type: r.credential_type, source: 'corporate' });
      }
    });

    res.json({ success: true, credential_types: types });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// ─── Task 3: Corporate — Employee permission read/write ────────────────────────

// Corporate: get credential sharing permissions for an employee
app.get('/api/corporate/employees/:employeeRegistryId/permissions', requireAuth, requireRole('corporate'), async (req, res) => {
  try {
    const user = (req as any).user;
    const { employeeRegistryId } = req.params;
    const orgOwner = user.org_id || user.id;

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

// Corporate: set credential sharing permissions for an employee (admin only, full replace)
app.post('/api/corporate/employees/:employeeRegistryId/permissions', requireAuth, requireRole('corporate'), async (req, res) => {
  try {
    const user = (req as any).user;
    if (!['super_admin', 'admin'].includes(user.sub_role)) {
      return res.status(403).json({ error: 'Only admin or super_admin can manage employee permissions' });
    }
    const { employeeRegistryId } = req.params;
    const { credential_types } = req.body;
    if (!Array.isArray(credential_types)) {
      return res.status(400).json({ error: 'credential_types must be an array of strings' });
    }
    const orgOwner = user.org_id || user.id;

    const empCheck = await query(
      'SELECT id FROM employee_registry WHERE id = $1 AND corporate_user_id = $2',
      [employeeRegistryId, orgOwner]
    );
    if (empCheck.rows.length === 0) return res.status(404).json({ error: 'Employee not found in your organisation' });

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

// ─── Task 4: Holder — Corporate wallet (employee only) ────────────────────────

// Employee: get corporate credentials they are permitted to share
app.get('/api/holder/corporate-wallet', requireAuth, requireRole('corporate'), async (req, res) => {
  try {
    const user = (req as any).user;
    if (user.sub_role !== 'employee') {
      return res.status(403).json({ error: 'Only employees can access corporate wallet' });
    }

    const empResult = await query(
      'SELECT er.id, er.corporate_user_id FROM employee_registry er WHERE er.user_id = $1 LIMIT 1',
      [user.id]
    );
    if (empResult.rows.length === 0) return res.json({ success: true, credentials: [] });

    const { id: empRegistryId, corporate_user_id: orgOwnerId } = empResult.rows[0];

    const permResult = await query(
      'SELECT credential_type FROM employee_credential_permissions WHERE employee_registry_id = $1',
      [empRegistryId]
    );
    const allowedTypes = permResult.rows.map((r: any) => r.credential_type);
    if (allowedTypes.length === 0) return res.json({ success: true, credentials: [] });

    const placeholders = allowedTypes.map((_: any, i: number) => `$${i + 2}`).join(', ');
    const result = await query(
      `SELECT c.id, c.credential_type, c.issued_at, c.expires_at, c.revoked, c.vc_json,
              d.did_string AS issuer_did_string
       FROM credentials c
       LEFT JOIN dids d ON c.issuer_did_id = d.id
       JOIN dids holder_did ON c.holder_did_id = holder_did.id
       WHERE holder_did.user_id = $1
         AND holder_did.did_type = 'parent'
         AND c.credential_type IN (${placeholders})
         AND c.revoked = false
       ORDER BY c.issued_at DESC`,
      [orgOwnerId, ...allowedTypes]
    );
    res.json({ success: true, credentials: result.rows });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// ─── Task 5: Holder — Transactions timeline (employee only) ───────────────────

// Employee: unified transactions timeline (inbound proof requests + outbound presentations)
app.get('/api/holder/transactions', requireAuth, requireRole('corporate'), async (req, res) => {
  try {
    const user = (req as any).user;
    if (user.sub_role !== 'employee') {
      return res.status(403).json({ error: 'Only employees can access transactions' });
    }

    const didRow = await query(
      'SELECT d.id FROM employee_registry er JOIN dids d ON er.sub_did_id = d.id WHERE er.user_id = $1 LIMIT 1',
      [user.id]
    );
    if (didRow.rows.length === 0) return res.json({ success: true, transactions: [] });
    const holderDidId = didRow.rows[0].id;

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

    const all = [...inbound.rows, ...outbound.rows]
      .sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());

    res.json({ success: true, transactions: all });
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
