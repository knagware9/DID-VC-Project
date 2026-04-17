/**
 * Seed: FSV Labs, SBI Bank Employee, HDFC Bank
 * Creates all requested users, org structures, DIDs, and employee registry entries.
 */
import crypto from 'crypto';
import bcrypt from 'bcryptjs';
import { query, pool } from './index.js';
import { generateKeyPair } from '../utils/crypto.js';

const DEFAULT_PASSWORD = 'Platform@123';

async function hashPw(plain: string) {
  return bcrypt.hash(plain, 10);
}

async function createUser(
  email: string,
  name: string,
  role: string,
  subRole: string,
  orgId: string | null = null
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
  console.log(`  ✓ [${role}/${subRole}] ${name} <${email}>`);
  return res.rows[0].id;
}

async function createParentDID(userId: string, slug: string): Promise<{ did: string; id: string }> {
  const existing = await query(
    'SELECT id, did_string FROM dids WHERE user_id = $1 AND did_type = $2',
    [userId, 'parent']
  );
  if (existing.rows.length > 0) return { did: existing.rows[0].did_string, id: existing.rows[0].id };

  const { privateKey, publicKey } = generateKeyPair();
  const publicKeyHex  = Buffer.from(publicKey).toString('hex');
  const privateKeyHex = Buffer.from(privateKey).toString('hex');
  const didString = `did:web:didvc.platform:${slug}`;
  const res = await query(
    `INSERT INTO dids (did_string, user_id, public_key, private_key_encrypted, did_type)
     VALUES ($1, $2, $3, $4, 'parent') RETURNING id`,
    [didString, userId, publicKeyHex, privateKeyHex]
  );
  console.log(`    → DID: ${didString}`);
  return { did: didString, id: res.rows[0].id };
}

async function createSubDID(userId: string, slug: string): Promise<{ did: string; id: string }> {
  const { privateKey, publicKey } = generateKeyPair();
  const publicKeyHex  = Buffer.from(publicKey).toString('hex');
  const privateKeyHex = Buffer.from(privateKey).toString('hex');
  const didString = `did:web:didvc.platform:${slug}`;
  const res = await query(
    `INSERT INTO dids (did_string, user_id, public_key, private_key_encrypted, did_type)
     VALUES ($1, $2, $3, $4, 'sub') RETURNING id`,
    [didString, userId, publicKeyHex, privateKeyHex]
  );
  console.log(`    → Sub-DID: ${didString}`);
  return { did: didString, id: res.rows[0].id };
}

async function ensureOrgApplication(
  orgName: string, adminEmail: string, adminId: string, cin: string
): Promise<void> {
  const existing = await query('SELECT id FROM organization_applications WHERE email = $1', [adminEmail]);
  if (existing.rows.length > 0) return;
  await query(
    `INSERT INTO organization_applications
       (org_name, email, director_full_name, aadhaar_number, dob, gender, state, pincode,
        company_name, cin, company_status, company_category, date_of_incorporation,
        pan_number, gstn, ie_code, director_name, din, designation,
        application_status, user_id)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21)`,
    [
      orgName, adminEmail, 'Seed Director', '123456789012',
      '1980-01-01', 'Male', 'Maharashtra', '400001',
      orgName, cin, 'Active', 'Company limited by shares',
      '2000-01-01', 'ABCDE1234F', '27ABCDE1234F1Z5', '0000000',
      'Seed Director', 'DIN00000001', 'Director',
      'complete', adminId,
    ]
  );
}

async function createEmployee(
  corporateAdminId: string,
  empId: string,
  name: string,
  email: string,
  orgSlug: string
): Promise<void> {
  // Create employee user account
  const userId = await createUser(email, name, 'corporate', 'employee', corporateAdminId);

  // Create sub-DID for the employee
  const empSlug = `${orgSlug}-emp-${empId.toLowerCase()}`;
  const { id: subDidId } = await createSubDID(userId, empSlug);

  // Register in employee_registry
  const existing = await query(
    'SELECT id FROM employee_registry WHERE corporate_user_id = $1 AND employee_id = $2',
    [corporateAdminId, empId]
  );
  if (existing.rows.length === 0) {
    await query(
      `INSERT INTO employee_registry (corporate_user_id, employee_id, name, email, sub_did_id, user_id)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [corporateAdminId, empId, name, email, subDidId, userId]
    );
    console.log(`    → Registered in employee_registry: ${empId}`);
  }
}

// ─────────────────────────────────────────────────────────────────────────────

async function seedFSVLabs(): Promise<void> {
  console.log('\n━━━ FSV Labs (Corporate) ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');

  // 1. Super Admin
  const adminId = await createUser(
    'admin@fsvlabs.com', 'FSV Labs Admin', 'corporate', 'super_admin'
  );
  // Self-reference org_id
  await query('UPDATE users SET org_id = $1 WHERE id = $1', [adminId]);

  // 2. Parent DID
  await createParentDID(adminId, 'fsv-labs');

  // 3. Org application record
  await ensureOrgApplication('FSV Labs Pvt Ltd', 'admin@fsvlabs.com', adminId, 'U72900MH2015PTC001234');

  // 4. Corporate Requester
  await createUser('requester@fsvlabs.com', 'Rohan Desai',         'corporate', 'requester',            adminId);

  // 5. Authorized Signatory
  await createUser('signatory@fsvlabs.com', 'Neha Kapoor',         'corporate', 'authorized_signatory', adminId);

  // 6. Maker
  await createUser('maker@fsvlabs.com',     'Arjun Mehta',         'corporate', 'maker',                adminId);

  // 7. Checker
  await createUser('checker@fsvlabs.com',   'Pooja Iyer',          'corporate', 'checker',              adminId);

  // 8. Employee 1
  await createEmployee(adminId, 'FSV-EMP-001', 'Priya Sharma', 'priya.sharma@fsvlabs.com', 'fsv-labs');

  // 9. Employee 2
  await createEmployee(adminId, 'FSV-EMP-002', 'Rahul Mehta',  'rahul.mehta@fsvlabs.com',  'fsv-labs');

  console.log('  ✅ FSV Labs done');
}

async function seedSBIEmployee(): Promise<void> {
  console.log('\n━━━ SBI Bank — Employee ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');

  // SBI corporate admin already exists — look it up
  const sbiAdminResult = await query('SELECT id FROM users WHERE email = $1', ['admin@sbi.co.in']);
  if (sbiAdminResult.rows.length === 0) {
    console.log('  ⚠ SBI corporate admin not found — skipping employee creation');
    return;
  }
  const sbiAdminId = sbiAdminResult.rows[0].id;

  await createEmployee(sbiAdminId, 'SBI-EMP-001', 'Kavita Nair', 'kavita.nair@sbi.co.in', 'state-bank-of-india');
  console.log('  ✅ SBI Employee done');
}

async function seedHDFCBank(): Promise<void> {
  console.log('\n━━━ HDFC Bank (Corporate) ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');

  // 1. Admin
  const adminId = await createUser(
    'admin@hdfc.co.in', 'HDFC Bank Admin', 'corporate', 'super_admin'
  );
  await query('UPDATE users SET org_id = $1 WHERE id = $1', [adminId]);

  // 2. Parent DID
  await createParentDID(adminId, 'hdfc-bank');

  // 3. Org application record
  await ensureOrgApplication('HDFC Bank Ltd', 'admin@hdfc.co.in', adminId, 'L65920MH1994PLC080618');

  // 4. Maker
  await createUser('maker@hdfc.co.in',   'Sanjay Patil',   'corporate', 'maker',   adminId);

  // 5. Checker
  await createUser('checker@hdfc.co.in', 'Divya Menon',    'corporate', 'checker', adminId);

  // 6. Employee
  await createEmployee(adminId, 'HDFC-EMP-001', 'Amit Joshi', 'amit.joshi@hdfc.co.in', 'hdfc-bank');

  console.log('  ✅ HDFC Bank done');
}

// ─────────────────────────────────────────────────────────────────────────────

async function main() {
  console.log('\n══════════════════════════════════════════════════════════════');
  console.log('  Seeding: FSV Labs + SBI Employee + HDFC Bank');
  console.log('══════════════════════════════════════════════════════════════');

  await seedFSVLabs();
  await seedSBIEmployee();
  await seedHDFCBank();

  console.log('\n══════════════════════════════════════════════════════════════');
  console.log('  ✅  All done — password for all accounts: Platform@123');
  console.log('══════════════════════════════════════════════════════════════\n');

  await pool.end();
}

main().catch(err => {
  console.error('\n❌ Seed failed:', err.message);
  pool.end();
  process.exit(1);
});
