/**
 * Add two employees to XYZ Private Limited and grant them
 * access to specific corporate credentials.
 *
 * Employee 1 – Vikram Singh (Trade Finance Officer)
 *   Permissions: DGFTImporterExporterCodeCredential, NESLBusinessRegistrationCredential,
 *                ProteanTrustEndorsementCredential
 *
 * Employee 2 – Sneha Patel (Compliance Manager)
 *   Permissions: IBDICDigitalIdentityCredential, NESLBusinessRegistrationCredential,
 *                GSTINCredential, CompanyRegistrationCredential
 */
import bcrypt from 'bcryptjs';
import { query, pool } from './index.js';
import { generateKeyPair } from '../utils/crypto.js';

const DEFAULT_PASSWORD = 'Platform@123';

async function hashPw(plain: string) {
  return bcrypt.hash(plain, 10);
}

async function createUserIfNotExists(
  email: string, name: string, role: string,
  subRole: string, orgId: string
): Promise<string> {
  const existing = await query('SELECT id FROM users WHERE email = $1', [email]);
  if (existing.rows.length > 0) {
    console.log(`  ↳ skip (exists): ${email}`);
    return existing.rows[0].id;
  }
  const hash = await hashPw(DEFAULT_PASSWORD);
  const res = await query(
    `INSERT INTO users (email, password_hash, role, name, sub_role, org_id)
     VALUES ($1, $2, $3, $4, $5, $6) RETURNING id`,
    [email, hash, role, name, subRole, orgId]
  );
  console.log(`  ✓ created user [${role}/${subRole}]: ${name} <${email}>`);
  return res.rows[0].id;
}

async function createSubDID(userId: string, slug: string): Promise<string> {
  const { privateKey, publicKey } = generateKeyPair();
  const res = await query(
    `INSERT INTO dids (did_string, user_id, public_key, private_key_encrypted, did_type)
     VALUES ($1, $2, $3, $4, 'sub') RETURNING id`,
    [
      `did:web:didvc.platform:${slug}`,
      userId,
      Buffer.from(publicKey).toString('hex'),
      Buffer.from(privateKey).toString('hex'),
    ]
  );
  console.log(`    → Sub-DID: did:web:didvc.platform:${slug}`);
  return res.rows[0].id;
}

async function registerEmployee(
  corporateAdminId: string, empId: string,
  name: string, email: string, userId: string, subDidId: string
): Promise<string> {
  const existing = await query(
    'SELECT id FROM employee_registry WHERE corporate_user_id = $1 AND employee_id = $2',
    [corporateAdminId, empId]
  );
  if (existing.rows.length > 0) {
    console.log(`  ↳ skip registry (exists): ${empId}`);
    return existing.rows[0].id;
  }
  const res = await query(
    `INSERT INTO employee_registry (corporate_user_id, employee_id, name, email, sub_did_id, user_id)
     VALUES ($1, $2, $3, $4, $5, $6) RETURNING id`,
    [corporateAdminId, empId, name, email, subDidId, userId]
  );
  console.log(`    → Registered in employee_registry: ${empId}`);
  return res.rows[0].id;
}

async function grantCredentialPermissions(
  empRegistryId: string, grantedBy: string, credTypes: string[]
): Promise<void> {
  for (const ct of credTypes) {
    await query(
      `INSERT INTO employee_credential_permissions (employee_registry_id, credential_type, granted_by)
       VALUES ($1, $2, $3)
       ON CONFLICT (employee_registry_id, credential_type) DO NOTHING`,
      [empRegistryId, ct, grantedBy]
    );
    console.log(`    → Permission granted: ${ct}`);
  }
}

// ─────────────────────────────────────────────────────────────────────────────

async function main() {
  console.log('\n══════════════════════════════════════════════════════════════');
  console.log('  XYZ Private Limited — Add Employees & Grant Credential Access');
  console.log('══════════════════════════════════════════════════════════════');

  // Fetch XYZ admin (corporate super_admin → org root)
  const xyzAdminResult = await query(
    'SELECT id FROM users WHERE email = $1', ['admin@xyz.co.in']
  );
  if (xyzAdminResult.rows.length === 0) {
    throw new Error('XYZ admin (admin@xyz.co.in) not found');
  }
  const xyzAdminId: string = xyzAdminResult.rows[0].id;
  console.log(`\n  XYZ Admin ID: ${xyzAdminId}`);

  // ── Employee 1: Vikram Singh (Trade Finance Officer) ────────────────────
  console.log('\n  ── Employee 1: Vikram Singh (Trade Finance Officer) ──────────');

  const vikramUserId = await createUserIfNotExists(
    'vikram.singh@xyz.co.in', 'Vikram Singh', 'corporate', 'employee', xyzAdminId
  );
  const vikramSubDidId = await createSubDID(vikramUserId, 'xyz-emp-vikram-singh');
  const vikramRegId = await registerEmployee(
    xyzAdminId, 'XYZ-EMP-001', 'Vikram Singh',
    'vikram.singh@xyz.co.in', vikramUserId, vikramSubDidId
  );

  // Vikram handles trade/export — give access to trade-related credentials
  await grantCredentialPermissions(vikramRegId, xyzAdminId, [
    'DGFTImporterExporterCodeCredential',   // IE Code for import/export ops
    'DGFTExportLicense',                    // Export license
    'NESLBusinessRegistrationCredential',   // Company registration proof
    'ProteanTrustEndorsementCredential',    // Trust endorsement for trade partners
  ]);

  // ── Employee 2: Sneha Patel (Compliance Manager) ─────────────────────────
  console.log('\n  ── Employee 2: Sneha Patel (Compliance Manager) ─────────────');

  const snehaUserId = await createUserIfNotExists(
    'sneha.patel@xyz.co.in', 'Sneha Patel', 'corporate', 'employee', xyzAdminId
  );
  const snehaSubDidId = await createSubDID(snehaUserId, 'xyz-emp-sneha-patel');
  const snehaRegId = await registerEmployee(
    xyzAdminId, 'XYZ-EMP-002', 'Sneha Patel',
    'sneha.patel@xyz.co.in', snehaUserId, snehaSubDidId
  );

  // Sneha handles compliance/KYC — give access to identity & regulatory credentials
  await grantCredentialPermissions(snehaRegId, xyzAdminId, [
    'IBDICDigitalIdentityCredential',       // Digital identity / KYC
    'NESLBusinessRegistrationCredential',   // Company registration proof
    'GSTINCredential',                      // GST compliance
    'CompanyRegistrationCredential',        // MCA registration
  ]);

  // ── Summary ──────────────────────────────────────────────────────────────
  console.log('\n══════════════════════════════════════════════════════════════');
  console.log('  ✅  Done');
  console.log('══════════════════════════════════════════════════════════════');
  console.log('\n  Employees added to XYZ Private Limited:\n');

  console.log('  👤 Vikram Singh — Trade Finance Officer');
  console.log('     Email   : vikram.singh@xyz.co.in');
  console.log('     Password: Platform@123');
  console.log('     Emp ID  : XYZ-EMP-001');
  console.log('     Sub-DID : did:web:didvc.platform:xyz-emp-vikram-singh');
  console.log('     Access  : DGFTImporterExporterCodeCredential');
  console.log('               DGFTExportLicense');
  console.log('               NESLBusinessRegistrationCredential');
  console.log('               ProteanTrustEndorsementCredential');

  console.log('\n  👤 Sneha Patel — Compliance Manager');
  console.log('     Email   : sneha.patel@xyz.co.in');
  console.log('     Password: Platform@123');
  console.log('     Emp ID  : XYZ-EMP-002');
  console.log('     Sub-DID : did:web:didvc.platform:xyz-emp-sneha-patel');
  console.log('     Access  : IBDICDigitalIdentityCredential');
  console.log('               NESLBusinessRegistrationCredential');
  console.log('               GSTINCredential');
  console.log('               CompanyRegistrationCredential');
  console.log('');

  await pool.end();
}

main().catch(err => {
  console.error('\n❌ Failed:', err.message);
  pool.end();
  process.exit(1);
});
