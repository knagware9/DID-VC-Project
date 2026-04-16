/**
 * Platform seed script
 * Creates realistic entities across all roles:
 *   - Portal Manager team (super_admin, maker, checker)
 *   - Platform entities: DID Issuers (DGFT, IBDIC), VC Issuer (NESL), Trust Endorser (Protean)
 *     each with maker/checker team members
 *   - Corporate orgs: XYZ Pvt Ltd (with maker/checker)
 *   - Verifier org: SBI Bank (with maker/checker)
 */
import crypto from 'crypto';
import bcrypt from 'bcryptjs';
import { query, pool } from './index.js';
import { generateKeyPair } from '../utils/crypto.js';

const DEFAULT_PASSWORD = 'Platform@123';

async function hashPw(plain: string) {
  return bcrypt.hash(plain, 10);
}

async function createDID(userId: string, slug: string): Promise<{ did: string; id: string }> {
  const { privateKey, publicKey } = generateKeyPair();
  const publicKeyHex = Buffer.from(publicKey).toString('hex');
  const privateKeyHex = Buffer.from(privateKey).toString('hex');
  const didString = `did:web:didvc.platform:${slug}`;

  const res = await query(
    `INSERT INTO dids (did_string, user_id, public_key, private_key_encrypted, did_type)
     VALUES ($1, $2, $3, $4, 'parent') RETURNING id`,
    [didString, userId, publicKeyHex, privateKeyHex]
  );
  return { did: didString, id: res.rows[0].id };
}

async function createUser(
  email: string,
  name: string,
  role: string,
  opts: { sub_role?: string; authority_type?: string; org_id?: string } = {}
): Promise<string> {
  // Skip if already exists
  const existing = await query('SELECT id FROM users WHERE email = $1', [email]);
  if (existing.rows.length > 0) {
    console.log(`  ↳ skip (exists): ${email}`);
    return existing.rows[0].id;
  }
  const hash = await hashPw(DEFAULT_PASSWORD);
  const res = await query(
    `INSERT INTO users (email, password_hash, role, name, sub_role, authority_type, org_id)
     VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING id`,
    [email, hash, role, name, opts.sub_role ?? null, opts.authority_type ?? null, opts.org_id ?? null]
  );
  const id = res.rows[0].id;
  console.log(`  ✓ created user [${role}${opts.sub_role ? '/' + opts.sub_role : ''}]: ${email}`);
  return id;
}

async function ensureDID(userId: string, slug: string): Promise<{ did: string; id: string }> {
  const existing = await query('SELECT did_string, id FROM dids WHERE user_id = $1 AND did_type = $2', [userId, 'parent']);
  if (existing.rows.length > 0) {
    return { did: existing.rows[0].did_string, id: existing.rows[0].id };
  }
  return createDID(userId, slug);
}

async function ensureEntity(
  name: string, email: string, entityType: string,
  onboardedById: string, activatedById: string,
  userRole: string
): Promise<string> {
  const existing = await query('SELECT id, user_id FROM platform_entities WHERE email = $1', [email]);
  if (existing.rows.length > 0) {
    console.log(`  ↳ skip (exists): ${email} (${entityType})`);
    return existing.rows[0].user_id;
  }

  // Create entity user account as super_admin
  const entityUserId = await createUser(email, name, userRole, { sub_role: 'super_admin' });

  // Self-referencing org_id
  await query('UPDATE users SET org_id = $1 WHERE id = $1', [entityUserId]);

  const slug = name.toLowerCase().replace(/[^a-z0-9]/g, '-').replace(/-+/g, '-');
  const { did } = await ensureDID(entityUserId, slug);

  // Insert platform_entities row (already activated)
  const mcMakerResult = await query(
    `INSERT INTO platform_entities (name, email, entity_type, status, user_id, did, onboarded_by, activated_by)
     VALUES ($1, $2, $3, 'active', $4, $5, $6, $7) RETURNING id`,
    [name, email, entityType, entityUserId, did, onboardedById, activatedById]
  );
  const entityId = mcMakerResult.rows[0].id;

  // Record the mc_action as already approved
  await query(
    `INSERT INTO mc_actions (resource_type, resource_id, maker_id, checker_id, status, payload)
     VALUES ('entity_onboarding', $1, $2, $3, 'approved', $4)`,
    [entityId, onboardedById, activatedById, JSON.stringify({ name, email, entity_type: entityType, seeded: true })]
  );

  console.log(`  ✓ platform entity [${entityType}]: ${name} → DID: ${did}`);
  return entityUserId;
}

const TEAM_NAMES: Record<string, { maker: string; checker: string }> = {
  'dgft.gov.in':   { maker: 'Amit Verma',   checker: 'Sunita Devi' },
  'ibdic.org.in':  { maker: 'Rajesh Kumar', checker: 'Meera Nair' },
  'nesl.co.in':    { maker: 'Vikram Patel', checker: 'Rekha Gupta' },
  'protean.co.in': { maker: 'Aditya Rao',   checker: 'Kavita Sharma' },
};

async function createIssuerTeam(adminUserId: string, domain: string): Promise<void> {
  const makerEmail = `maker@${domain}`;
  const checkerEmail = `checker@${domain}`;
  const names = TEAM_NAMES[domain] ?? { maker: domain + ' Maker', checker: domain + ' Checker' };
  await createUser(makerEmail, names.maker, 'government_agency', { sub_role: 'maker', org_id: adminUserId });
  await createUser(checkerEmail, names.checker, 'government_agency', { sub_role: 'checker', org_id: adminUserId });
}

async function createCorporateOrg(
  orgName: string,
  emailPrefix: string,
  cin: string
): Promise<void> {
  const adminEmail = `admin@${emailPrefix}`;
  const makerEmail = `maker@${emailPrefix}`;
  const checkerEmail = `checker@${emailPrefix}`;

  // Check if org admin already exists
  const existing = await query('SELECT id FROM users WHERE email = $1', [adminEmail]);
  if (existing.rows.length > 0) {
    console.log(`  ↳ skip (exists): ${orgName}`);
    return;
  }

  const slug = orgName.toLowerCase().replace(/[^a-z0-9]/g, '-').replace(/-+/g, '-');

  // Create super_admin (org root)
  const adminId = await createUser(adminEmail, orgName + ' Admin', 'corporate', { sub_role: 'super_admin' });
  // self-reference org_id
  await query('UPDATE users SET org_id = $1 WHERE id = $1', [adminId]);

  // Create DID for the org
  const { did } = await ensureDID(adminId, slug);

  // Corporate org person names
  const corpTeamNames: Record<string, { maker: string; checker: string }> = {
    'xyz.co.in': { maker: 'Suresh Shah', checker: 'Ananya Joshi' },
  };
  const slug2 = emailPrefix.split('.').slice(-2).join('.');
  const corpNames = corpTeamNames[emailPrefix] ?? corpTeamNames[slug2] ?? { maker: orgName + ' Maker', checker: orgName + ' Checker' };
  // Create maker & checker under the org
  await createUser(makerEmail, corpNames.maker, 'corporate', { sub_role: 'maker', org_id: adminId });
  await createUser(checkerEmail, corpNames.checker, 'corporate', { sub_role: 'checker', org_id: adminId });

  // Minimal organization_application record so portal dashboard sees the org
  const appCheck = await query('SELECT id FROM organization_applications WHERE email = $1', [adminEmail]);
  if (appCheck.rows.length === 0) {
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

  console.log(`  ✓ corporate org [${orgName}]: admin=${adminEmail}, maker=${makerEmail}, checker=${checkerEmail}, DID=${did}`);
}

async function createVerifierOrg(
  orgName: string,
  domain: string
): Promise<void> {
  const adminEmail = `verifier@${domain}`;
  const makerEmail = `maker-v@${domain}`;
  const checkerEmail = `checker-v@${domain}`;

  const slug = orgName.toLowerCase().replace(/[^a-z0-9]/g, '-').replace(/-+/g, '-') + '-verifier';

  const adminId = await createUser(adminEmail, orgName + ' Verifier', 'verifier', { sub_role: 'super_admin' });
  await query('UPDATE users SET org_id = $1 WHERE id = $1 AND org_id IS NULL', [adminId]);
  await ensureDID(adminId, slug);

  const verifierTeamNames: Record<string, { maker: string; checker: string }> = {
    'sbi.co.in': { maker: 'Ramesh Kumar', checker: 'Deepa Pillai' },
  };
  const verifierNames = verifierTeamNames[domain] ?? { maker: orgName + ' Verifier Maker', checker: orgName + ' Verifier Checker' };
  await createUser(makerEmail, verifierNames.maker, 'verifier', { sub_role: 'maker', org_id: adminId });
  await createUser(checkerEmail, verifierNames.checker, 'verifier', { sub_role: 'checker', org_id: adminId });

  console.log(`  ✓ verifier org [${orgName}]: ${adminEmail}, ${makerEmail}, ${checkerEmail}`);
}

// ─── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  console.log('\n━━━ DID-VC Platform Seed ━━━\n');

  // ── 1. Portal Manager Team ─────────────────────────────────────────────────
  console.log('📋 Portal Manager Team');

  // Ensure existing portal@test.com has super_admin and org_id=self
  await query(`UPDATE users SET sub_role = 'super_admin' WHERE email = 'portal@test.com' AND sub_role IS NULL`);
  await query(`UPDATE users SET org_id = id WHERE email = 'portal@test.com' AND org_id IS NULL`);

  const superAdminRes = await query(`SELECT id FROM users WHERE email = 'portal@test.com'`);
  let superAdminId: string;
  if (superAdminRes.rows.length > 0) {
    superAdminId = superAdminRes.rows[0].id;
    console.log('  ↳ super_admin: portal@test.com (existing)');
  } else {
    superAdminId = await createUser('portal@test.com', 'Portal Super Admin', 'portal_manager', { sub_role: 'super_admin' });
  }

  const pmMakerId = await createUser('pm-maker@didvc.in', 'Rahul Sharma', 'portal_manager', { sub_role: 'maker' });
  const pmCheckerId = await createUser('pm-checker@didvc.in', 'Priya Singh', 'portal_manager', { sub_role: 'checker' });

  // ── 2. Platform Entities ───────────────────────────────────────────────────
  console.log('\n🌐 Platform Entities');

  // DID Issuers
  const dgftId = await ensureEntity(
    'DGFT \u2014 Directorate General of Foreign Trade',
    'admin@dgft.gov.in',
    'did_issuer',
    pmMakerId, pmCheckerId,
    'government_agency'
  );
  await createIssuerTeam(dgftId, 'dgft.gov.in');

  const ibdicId = await ensureEntity(
    "IBDIC \u2014 Indian Banks' Digital Infrastructure Company",
    'admin@ibdic.org.in',
    'did_issuer',
    pmMakerId, pmCheckerId,
    'government_agency'
  );
  await createIssuerTeam(ibdicId, 'ibdic.org.in');

  // VC Issuer
  const neslId = await ensureEntity(
    'NeSL \u2014 National e-Governance Services Ltd',
    'admin@nesl.co.in',
    'vc_issuer',
    pmMakerId, pmCheckerId,
    'government_agency'
  );
  await createIssuerTeam(neslId, 'nesl.co.in');

  // Trust Endorser
  const proteanId = await ensureEntity(
    'Protean eGov Technologies',
    'admin@protean.co.in',
    'trust_endorser',
    pmMakerId, pmCheckerId,
    'government_agency'
  );
  await createIssuerTeam(proteanId, 'protean.co.in');

  // ── 3. Corporate Organisations ─────────────────────────────────────────────
  console.log('\n🏢 Corporate Organisations');

  await createCorporateOrg('XYZ Private Limited', 'xyz.co.in', 'U12345MH2000PTC123456');

  // ── 4. Verifier Organisations ──────────────────────────────────────────────
  console.log('\n🔍 Verifier Organisations');

  await createVerifierOrg('State Bank of India', 'sbi.co.in');

  // ── Done ───────────────────────────────────────────────────────────────────
  console.log('\n━━━ Seed complete ━━━');
  console.log(`\nAll accounts use password: ${DEFAULT_PASSWORD}`);
  console.log('\nPortal Manager:');
  console.log('  super_admin : portal@test.com');
  console.log('  maker       : pm-maker@didvc.in');
  console.log('  checker     : pm-checker@didvc.in');
  console.log('\nPlatform Entities (government_agency role, all super_admin):');
  console.log('  DGFT    : admin@dgft.gov.in    | maker@dgft.gov.in    | checker@dgft.gov.in');
  console.log('  IBDIC   : admin@ibdic.org.in   | maker@ibdic.org.in   | checker@ibdic.org.in');
  console.log('  NESL    : admin@nesl.co.in     | maker@nesl.co.in     | checker@nesl.co.in');
  console.log('  Protean : admin@protean.co.in  | maker@protean.co.in  | checker@protean.co.in');
  console.log('\nCorporate Orgs:');
  console.log('  XYZ : admin@xyz.co.in | maker@xyz.co.in | checker@xyz.co.in');
  console.log('\nVerifier Orgs:');
  console.log('  SBI : verifier@sbi.co.in | maker-v@sbi.co.in | checker-v@sbi.co.in');

  await pool.end();
}

main().catch(err => {
  console.error('\n❌ Seed failed:', err.message);
  process.exit(1);
});
