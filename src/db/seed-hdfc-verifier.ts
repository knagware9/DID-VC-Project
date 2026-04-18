/**
 * Seed: HDFC Bank as a Verifier Organisation
 *
 * Creates:
 *   verifier@hdfc.bank       (super_admin)
 *   maker-v@hdfc.bank        (maker)
 *   checker-v@hdfc.bank      (checker)
 *
 * Run: DATABASE_URL=postgresql://... npx tsx src/db/seed-hdfc-verifier.ts
 */

import { Pool } from 'pg';
import crypto from 'crypto';

const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const query = (sql: string, params?: any[]) => pool.query(sql, params);

const BCRYPT_HASH = '$2b$10$GZuRbCHIkiE7R5j8gnTaVuZVEj/FHK7n5hN0S.DnxBbmgNY0cCKgm'; // Platform@123

async function upsertUser(
  email: string, name: string, role: string,
  opts: { sub_role?: string; org_id?: string } = {}
): Promise<string> {
  const existing = await query(`SELECT id FROM users WHERE email = $1`, [email]);
  if (existing.rows.length > 0) {
    console.log(`  ⏭  already exists: ${email}`);
    return existing.rows[0].id;
  }
  const res = await query(
    `INSERT INTO users (email, password_hash, role, name, sub_role, org_id)
     VALUES ($1, $2, $3, $4, $5, $6) RETURNING id`,
    [email, BCRYPT_HASH, role, name, opts.sub_role || null, opts.org_id || null]
  );
  return res.rows[0].id;
}

async function ensureDID(userId: string, slug: string): Promise<string> {
  const existing = await query(
    `SELECT id, did_string FROM dids WHERE user_id = $1 AND did_type = 'parent' LIMIT 1`,
    [userId]
  );
  if (existing.rows.length > 0) return existing.rows[0].did_string;

  const didString = `did:web:didvc.platform:${slug}`;
  const privateKey = crypto.randomBytes(32).toString('hex');
  // Derive a compressed public key stub (33 bytes = 66 hex chars, starts with 02/03)
  const pubKey = '02' + crypto.randomBytes(32).toString('hex');
  const res = await query(
    `INSERT INTO dids (user_id, did_string, did_type, public_key, private_key_encrypted)
     VALUES ($1, $2, 'parent', $3, $4) RETURNING did_string`,
    [userId, didString, pubKey, privateKey]
  );
  return res.rows[0].did_string;
}

async function main() {
  console.log('\n══════════════════════════════════════════════════════════════');
  console.log('  Seeding: HDFC Bank as Verifier Organisation');
  console.log('══════════════════════════════════════════════════════════════\n');

  // 1. Super-admin (org root)
  const adminId = await upsertUser(
    'verifier@hdfc.bank', 'HDFC Bank Verifier', 'verifier',
    { sub_role: 'super_admin' }
  );
  // org_id points to self
  await query(`UPDATE users SET org_id = $1 WHERE id = $1 AND org_id IS NULL`, [adminId]);

  // 2. DID for verifier
  const did = await ensureDID(adminId, 'hdfc-bank-verifier');
  console.log(`  ✓ [verifier/super_admin] HDFC Bank Verifier <verifier@hdfc.bank>`);
  console.log(`    → DID: ${did}`);

  // 3. Maker
  const makerId = await upsertUser(
    'maker-v@hdfc.bank', 'HDFC Verifier Maker', 'verifier',
    { sub_role: 'maker', org_id: adminId }
  );
  console.log(`  ✓ [verifier/maker] HDFC Verifier Maker <maker-v@hdfc.bank>`);

  // 4. Checker
  const checkerId = await upsertUser(
    'checker-v@hdfc.bank', 'HDFC Verifier Checker', 'verifier',
    { sub_role: 'checker', org_id: adminId }
  );
  console.log(`  ✓ [verifier/checker] HDFC Verifier Checker <checker-v@hdfc.bank>`);

  console.log('\n══════════════════════════════════════════════════════════════');
  console.log('  ✅  HDFC Bank Verifier seeded — password: Platform@123');
  console.log('══════════════════════════════════════════════════════════════\n');
  console.log('  verifier@hdfc.bank   (super_admin)');
  console.log('  maker-v@hdfc.bank    (maker)');
  console.log('  checker-v@hdfc.bank  (checker)\n');

  await pool.end();
}

main().catch(err => {
  console.error('❌', err.message);
  process.exit(1);
});
