import bcrypt from 'bcryptjs';
import { query, pool } from './index.js';

async function run() {
  const hash = await bcrypt.hash('Platform@123', 10);
  await query("UPDATE users SET password_hash=$1, sub_role='super_admin' WHERE email='portal@test.com'", [hash]);
  const r = await query("SELECT email, sub_role, role FROM users WHERE email='portal@test.com'");
  console.log('Updated portal@test.com:', r.rows[0]);
  await pool.end();
}
run().catch(e => { console.error(e); process.exit(1); });
