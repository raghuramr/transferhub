/**
 * Seed script: generates real argon2id password hashes for demo users
 * and writes them into the Users table.
 *
 * Usage (PowerShell / CMD):
 *   npm run seed:users               # uses .env (or falls back to LocalDB Windows Auth)
 *   npm run seed:users:test          # uses .env.test
 *   npm run seed:users:prod          # uses .env.production
 *   tsx scripts/seed-users.ts --env .env.test   # explicit file
 */
import * as argon2 from 'argon2';
import * as sql   from 'mssql';
import * as fs    from 'fs';
import * as path  from 'path';

// ── 1. Resolve which .env file to load ───────────────────────
const args        = process.argv.slice(2);
const envFlagIdx  = args.indexOf('--env');
const explicitEnv = envFlagIdx !== -1 ? args[envFlagIdx + 1] : null;

const nodeEnv = process.env.NODE_ENV ?? 'development';
const envFile = explicitEnv
  ?? (nodeEnv === 'test'       ? '.env.test'
    : nodeEnv === 'production' ? '.env.production'
    : '.env');

const apiRoot = path.resolve(__dirname, '..');   // src/api/
const envPath = path.join(apiRoot, envFile);

if (fs.existsSync(envPath)) {
  console.log(`Loading env: ${envPath}`);
  for (const line of fs.readFileSync(envPath, 'utf8').split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eqIdx = trimmed.indexOf('=');
    if (eqIdx < 0) continue;
    const key = trimmed.slice(0, eqIdx).trim();
    const raw = trimmed.slice(eqIdx + 1).trim();
    const val = raw.replace(/^["']|["']$/g, '');     // strip optional quotes
    if (!(key in process.env)) process.env[key] = val;
  }
} else {
  console.warn(`⚠  Env file not found: ${envPath}`);
  console.warn('   Falling back to: (localdb)\\MSSQLLocalDB / Windows Auth');
  console.warn('   Run "npm run setup:env" to create a .env file first.\n');
}

// ── 2. Build mssql config from env (Windows Auth by default) ─
const trustedConnection = (process.env.DB_TRUSTED_CONNECTION ?? 'true') === 'true';
const server   = process.env.DB_SERVER   ?? '(localdb)\\MSSQLLocalDB';
const database  = process.env.DB_NAME     ?? 'CreditEvalManager';
const portStr   = process.env.DB_PORT;
const port      = portStr ? parseInt(portStr, 10) : undefined;
const encrypt   = (process.env.DB_ENCRYPT ?? 'false') === 'true';

console.log(`\nTarget: ${server} / ${database}`);
console.log(`Auth  : ${trustedConnection ? 'Windows Integrated' : 'SQL login'}\n`);

const dbConfig: sql.config = {
  server,
  database,
  options: {
    encrypt,
    trustServerCertificate: true,   // always trust for dev / LocalDB
    trustedConnection,
  },
};

if (port && !isNaN(port)) dbConfig.port = port;
if (!trustedConnection) {
  dbConfig.user     = process.env.DB_USER     ?? '';
  dbConfig.password = process.env.DB_PASSWORD ?? '';
}

// ── 3. Demo accounts — emails must match seed/004_demo_users.sql ─
const demoPasswords: Record<string, string> = {
  'student@test.edu':    'Student@123!',
  'faculty.cs@bu.edu':   'Faculty@123!',
  'admin@bu.edu':        'Admin@123!',
  'agency@partner.org':  'Agency@123!',
  'super_admin@bu.edu':  'SuperAdmin@123!',
};

// ── 4. Run ────────────────────────────────────────────────────
async function main() {
  console.log('Connecting…');
  const pool = await sql.connect(dbConfig);
  console.log('Connected.\n');

  for (const [email, password] of Object.entries(demoPasswords)) {
    const hash = await argon2.hash(password, {
      type: argon2.argon2id,
      memoryCost: 65536,   // 64 MB
      timeCost: 3,
      parallelism: 4,
    });

    const res = await pool
      .request()
      .input('email', sql.NVarChar(254), email)
      .input('hash',  sql.NVarChar(500), hash)
      .query(`UPDATE Users SET PasswordHash = @hash WHERE Email = @email;
              SELECT @@ROWCOUNT AS Updated;`);

    const updated = res.recordset[0]?.Updated ?? 0;
    console.log(updated > 0
      ? `  ✓  ${email}  →  password = ${password}`
      : `  ✗  ${email}  →  user not found (check seed/004_demo_users.sql)`);
  }

  await pool.close();
  console.log('\n✅  Done — demo passwords set with argon2id.\n');
  console.log('Demo credentials:');
  for (const [email, pw] of Object.entries(demoPasswords)) {
    console.log(`   ${email.padEnd(26)} ${pw}`);
  }
}

main().catch(err => {
  console.error('\n❌  Seed failed:', err.message);
  if (err.message?.includes('connect') || err.message?.includes('sequence')) {
    console.error('\nCould not reach SQL Server. Check:');
    console.error('  1. DB_SERVER in your .env file matches your SQL Server instance name');
    console.error('  2. For LocalDB: DB_SERVER=(localdb)\\MSSQLLocalDB  and  DB_TRUSTED_CONNECTION=true');
    console.error('  3. Run "npm run setup:env" to create a .env from the example template');
  }
  process.exit(1);
});
