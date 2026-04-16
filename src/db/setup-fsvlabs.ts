/**
 * One-time setup script: FSV Labs Pvt Ltd onboarding
 * - Creates parent DID for FSV Labs super_admin
 * - Creates team members: requester, maker, checker, authorized_signatory
 */
import crypto from 'crypto';
import bcrypt from 'bcryptjs';
import { query, pool } from './index.js';
import { generateKeyPair } from '../utils/crypto.js';

const FSV_ADMIN_ID = '3143d5e5-0ae4-4676-b457-bca9675ac12f';
const FSV_ADMIN_EMAIL = 'fsvlabs@admin.com';

async function hashPw(plain: string) {
  return bcrypt.hash(plain, 10);
}

async function createDIDForUser(userId: string, slug: string): Promise<{ did: string; id: string }> {
  const existing = await query(
    `SELECT did_string, id FROM dids WHERE user_id = $1 AND did_type = 'parent'`,
    [userId]
  );
  if (existing.rows.length > 0) {
    console.log(`  ↳ DID already exists: ${existing.rows[0].did_string}`);
    return { did: existing.rows[0].did_string, id: existing.rows[0].id };
  }

  const { privateKey, publicKey } = generateKeyPair();
  const publicKeyHex = Buffer.from(publicKey).toString('hex');
  const privateKeyHex = Buffer.from(privateKey).toString('hex');
  const didString = `did:web:didvc.platform:${slug}`;

  const res = await query(
    `INSERT INTO dids (did_string, user_id, public_key, private_key_encrypted, did_type)
     VALUES ($1, $2, $3, $4, 'parent') RETURNING id`,
    [didString, userId, publicKeyHex, privateKeyHex]
  );
  console.log(`  ✓ Created DID: ${didString}`);
  return { did: didString, id: res.rows[0].id };
}

async function createTeamMember(
  email: string,
  name: string,
  password: string,
  subRole: string,
  orgId: string
): Promise<string> {
  const existing = await query(`SELECT id FROM users WHERE email = $1`, [email]);
  if (existing.rows.length > 0) {
    console.log(`  ↳ skip (exists): ${email}`);
    return existing.rows[0].id;
  }
  const hash = await hashPw(password);
  const res = await query(
    `INSERT INTO users (email, password_hash, role, name, sub_role, org_id)
     VALUES ($1, $2, 'corporate', $3, $4, $5) RETURNING id`,
    [email, hash, name, subRole, orgId]
  );
  const id = res.rows[0].id;
  console.log(`  ✓ Created [${subRole}]: ${email} / ${password}`);
  return id;
}

async function main() {
  console.log('\n=== FSV Labs Pvt Ltd Setup ===\n');

  // 1. Create parent DID for FSV Labs super_admin
  console.log('1. Creating parent DID for FSV Labs super_admin...');
  const { did: fsvDID } = await createDIDForUser(FSV_ADMIN_ID, 'fsv-labs-pvt-ltd');
  console.log(`   DID: ${fsvDID}`);

  // 2. Create team members
  console.log('\n2. Creating FSV Labs team members...');
  const reqId = await createTeamMember(
    'fsv.requester@fsvlabs.com',
    'FSV Requester',
    'FSV@req2024',
    'requester',
    FSV_ADMIN_ID
  );
  const makerId = await createTeamMember(
    'fsv.maker@fsvlabs.com',
    'FSV Maker',
    'FSV@maker2024',
    'maker',
    FSV_ADMIN_ID
  );
  const checkerId = await createTeamMember(
    'fsv.checker@fsvlabs.com',
    'FSV Checker',
    'FSV@checker2024',
    'checker',
    FSV_ADMIN_ID
  );
  const signId = await createTeamMember(
    'fsv.signatory@fsvlabs.com',
    'FSV Authorized Signatory',
    'FSV@sign2024',
    'authorized_signatory',
    FSV_ADMIN_ID
  );

  console.log('\n=== FSV Labs Setup Complete ===');
  console.log('\nStakeholder Summary:');
  console.log('  Super Admin:           fsvlabs@admin.com         / FSV@admin2024');
  console.log('  Requester:             fsv.requester@fsvlabs.com  / FSV@req2024');
  console.log('  Maker (Reviewer):      fsv.maker@fsvlabs.com      / FSV@maker2024');
  console.log('  Checker:               fsv.checker@fsvlabs.com    / FSV@checker2024');
  console.log('  Authorized Signatory:  fsv.signatory@fsvlabs.com  / FSV@sign2024');
  console.log(`\n  Parent DID: ${fsvDID}`);
  console.log(`  Admin User ID: ${FSV_ADMIN_ID}`);
  console.log('\nNext steps:');
  console.log('  - Login as requester and submit IBDICDigitalIdentityCredential request');
  console.log('  - Flow through: maker → checker → signatory → IBDIC issues DID credential');
  console.log('  - Then request: PANCredential (Protean), MCARegistration, GSTINCredential, IECCredential (DGFT)');

  await pool.end();
}

main().catch(e => { console.error(e); process.exit(1); });
