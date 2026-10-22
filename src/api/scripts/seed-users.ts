/**
 * Seed script: generates real argon2id password hashes for demo users.
 * Run with: npm run seed:users
 */
import * as argon2 from 'argon2';
import * as sql from 'mssql';
import * as path from 'path';
import * as fs from 'fs';

const config: sql.config = {
  server: process.env.DB_HOST || 'localhost',
  port: parseInt(process.env.DB_PORT || '1433'),
  database: process.env.DB_NAME || 'UniversityManager',
  authentication: {
    type: 'default',
    options: {
      userName: process.env.DB_USER || 'sa',
      password: process.env.DB_PASS || 'YourStrong!Passw0rd',
    },
  },
  options: {
    encrypt: false,
    trustServerCertificate: true,
  },
};

const demoPasswords: Record<string, string> = {
  'student@bu.edu': 'Student@123!',
  'faculty@bu.edu': 'Faculty@123!',
  'admin@bu.edu': 'Admin@123!',
  'agency@partner.org': 'Agency@123!',
  'superadmin@bu.edu': 'SuperAdmin@123!',
};

async function main() {
  console.log('Connecting to SQL Server...');
  const pool = await sql.connect(config);
  console.log('Connected.\n');

  for (const [email, password] of Object.entries(demoPasswords)) {
    const hash = await argon2.hash(password, {
      type: argon2.argon2id,
      memoryCost: 65536,
      timeCost: 3,
      parallelism: 4,
    });

    const result = await pool.request()
      .input('email', sql.NVarChar(254), email)
      .input('hash', sql.NVarChar(255), hash)
      .query(`UPDATE Users SET PasswordHash = @hash WHERE Email = @email; SELECT @@ROWCOUNT AS Updated`);

    const updated = result.recordset[0]?.Updated ?? 0;
    if (updated > 0) {
      console.log(`✓ ${email} → password set (${password})`);
    } else {
      console.log(`✗ ${email} → user not found`);
    }
  }

  await pool.close();
  console.log('\nDone. All demo user passwords have been hashed with argon2id.');
}

main().catch(err => {
  console.error('Seed failed:', err.message);
  process.exit(1);
});
