/**
 * Seed script: generates real argon2id password hashes for demo users.
 *
 * Usage:
 *   npm run seed:users          # loads .env
 *   npm run seed:users:test     # loads .env.test
 *   npm run seed:users:prod     # loads .env.production
 *
 * Or pass the env file directly:
 *   tsx scripts/seed-users.ts --env .env.test
 */
import * as argon2 from 'argon2';
import * as sql from 'mssql';
import * as fs from 'fs';
import * as path from 'path';

// ── Load env file ─────────────────────────────────────────────
const args = process.argv.slice(2);
const envFlagIdx = args.indexOf('--env');
const explicitEnvFile = envFlagIdx !== -1 ? args[envFlagIdx + 1] : null;

const nodeEnv = process.env.NODE_ENV ?? 'development';
const envFile = explicitEnvFile
  ?? (nodeEnv === 'test'       ? '.env.test'
    : nodeEnv === 'production' ? '.env.production'
    : '.env');

const envPath = path.resolve(__dirname, '..', envFile);
if (fs.existsSync(envPath)) {
  const lines = fs.readFileSync(envPath, 'utf8').split('\n');
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eqIdx = trimmed.indexOf('=');
    if (eqIdx < 0) continue;
    const key = trimmed.slice(0, eqIdx).trim();
    const val = trimmed.slice(eqIdx + 1).trim().replace(/^["']|["']$/g, '');
    if (!(key in process.env)) process.env[key] = val; // don't override shell env
  }
  console.log(`Loaded env: ${envPath}`);
} else {
  console.warn(`Env file not found: ${envPath} — using shell environment`);
}

// ── Build mssql config ────────────────────────────────────────
const trustedConnection = process.env.DB_TRUSTED_CONNECTION === 'true';
const server   = process.env.DB_SERVER   ?? 'localhost';
const database  = process.env.DB_NAME     ?? 'CreditEvalManager';
const port      = parseInt(process.env.DB_PORT ?? '1433', 10);
const encrypt   = process.env.DB_ENCRYPT === 'true';

const dbConfig: sql.config = {
  server,
  database,
  options: {
    encrypt,
    trustServerCertificate: !encrypt,
    trustedConnection,
  },
};

if (!isNaN(port)) dbConfig.port = port;

if (!trustedConnection) {
  dbConfig.user     = process.env.DB_USER     ?? 'sa';
  dbConfig.password = process.env.DB_PASSWORD ?? '';
} else {
  // Windows Integrated Auth — credentials come from the process token
  console.log('Using Windows Integrated Authentication');
}

// ── Demo accounts ─────────────────────────────────────────────
// Emails must exactly match what was inserted in seed/004_demo_users.sql
const demoPasswords: Record<string, string> = {
  'student@test.edu':    'Student@123!',
  'faculty.cs@bu.edu':   'Faculty@123!',
  'admin@bu.edu':        'Admin@123!',
  'agency@partner.org':  'Agency@123!',
  'super_admin@bu.edu':  'SuperAdmin@123!',
};

// ── Main ──────────────────────────────────────────────────────
async function main() {
  console.log(`\nConnecting to ${server}/${database}…`);
  const pool = await sql.connect(dbConfig);
  console.log('Connected.\n');

  for (const [email, password] of Object.entries(demoPasswords)) {
    const hash = await argon2.hash(password, {
      type: argon2.argon2id,
      memoryCost: 65536,   // 64 MB
      timeCost: 3,
      parallelism: 4,
    });

    const result = await pool
      .request()
      .input('email', sql.NVarChar(254), email)
      .input('hash',  sql.NVarChar(500), hash)
      .query(
        `UPDATE Users SET PasswordHash = @hash WHERE Email = @email;
         SELECT @@ROWCOUNT AS Updated;`
      );

    const updated = result.recordset[0]?.Updated ?? 0;
    if (updated > 0) {
      console.log(`  ✓  ${email}  →  ${password}`);
    } else {
      console.log(`  ✗  ${email}  →  user not found (check seed/004_demo_users.sql)`);
    }
  }

  await pool.close();
  console.log('\n✅  Done — all demo user passwords set with argon2id.\n');
}

main().catch((err) => {
  console.error('\n❌  Seed failed:', err.message);
  process.exit(1);
});
