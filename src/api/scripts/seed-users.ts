/**
 * Seed script: generates real argon2id password hashes for demo users
 * and writes them into the Users table.
 *
 * Usage (PowerShell / CMD):
 *   npm run seed:users               # uses .env (or falls back to LocalDB Windows Auth)
 *   npm run seed:users:test          # uses .env.test
 *   npm run seed:users:prod          # uses .env.production
 *   tsx scripts/seed-users.ts --env .env.test   # explicit file
 *
 * IMPORTANT — LocalDB users:
 *   Node's default SQL driver (tedious) is TCP-only. It cannot reach
 *   "(localdb)\MSSQLLocalDB" directly — that's a named-pipe connection,
 *   the same kind sqlcmd/SSMS use, not a network hostname. If DB_SERVER
 *   starts with "(localdb)" you must also set DB_DRIVER=msnodesqlv8 in
 *   your .env and run "npm install msnodesqlv8" once (native addon —
 *   needs Windows build tools the first time it compiles). You may also
 *   need DB_ODBC_DRIVER to match an ODBC driver actually installed on
 *   your machine (check with: Get-OdbcDriver | Select-Object Name).
 */
import * as argon2 from 'argon2';
import * as dotenv from 'dotenv';
import * as fs    from 'fs';
import * as path  from 'path';
import { buildSqlConfig, loadSqlDriver } from '../src/common/sql-connection.util';

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
  // dotenv correctly handles inline comments ("KEY=value  # comment"),
  // quoted values, etc. — a hand-rolled parser previously broke on these.
  dotenv.config({ path: envPath });
} else {
  console.warn(`⚠  Env file not found: ${envPath}`);
  console.warn('   Falling back to: (localdb)\\MSSQLLocalDB / Windows Auth');
  console.warn('   Run "npm run setup:env" to create a .env file first.\n');
}

// ── 2. Build mssql config from env (Windows Auth by default) ─
const trustedConnection = (process.env.DB_TRUSTED_CONNECTION ?? 'true') === 'true';
const server     = process.env.DB_SERVER     ?? '(localdb)\\MSSQLLocalDB';
const database   = process.env.DB_NAME       ?? 'CreditEvalManager';
const portStr    = process.env.DB_PORT;
const port       = portStr ? parseInt(portStr, 10) : undefined;
const encrypt    = (process.env.DB_ENCRYPT ?? 'false') === 'true';
const driverName = process.env.DB_DRIVER ?? 'tedious';
const odbcDriver = process.env.DB_ODBC_DRIVER;

console.log(`\nTarget: ${server} / ${database}`);
console.log(`Auth  : ${trustedConnection ? 'Windows Integrated' : 'SQL login'}`);
console.log(`Driver: ${driverName}${driverName === 'msnodesqlv8' ? `  (ODBC: ${odbcDriver ?? '(default) ODBC Driver 17 for SQL Server'})` : ''}\n`);

const sql = loadSqlDriver(driverName);
const dbConfig = buildSqlConfig({
  driver: driverName,
  server,
  database,
  port,
  trustedConnection,
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  encrypt,
  odbcDriver,
});

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

  const msg = err.message ?? '';
  const isLocalDbAddr   = /^\(localdb\)/i.test(server);
  const isAddrNotFound  = /ENOTFOUND/i.test(msg) || /sequence/i.test(msg);
  const isOdbcDriverErr = /driver manager/i.test(msg) || /data source name/i.test(msg);

  if (isLocalDbAddr && isAddrNotFound && driverName !== 'msnodesqlv8') {
    console.error('\n⚠  This is the classic "Node can\'t reach (localdb)\\..." problem.');
    console.error('   Node\'s default SQL driver (tedious) only speaks TCP — it cannot');
    console.error('   resolve "(localdb)\\..." the way sqlcmd/SSMS do (named pipes).');
    console.error('\n   Fix:');
    console.error('     1. cd src/api');
    console.error('     2. npm install msnodesqlv8      (one-time native build)');
    console.error('     3. In your .env, add:  DB_DRIVER=msnodesqlv8');
    console.error('     4. Re-run: npm run seed:users');
  } else if (driverName === 'msnodesqlv8' && isOdbcDriverErr) {
    console.error('\n⚠  The ODBC driver name does not match one installed on this machine.');
    console.error(`   Tried: "${odbcDriver ?? 'ODBC Driver 17 for SQL Server'}"`);
    console.error('\n   Fix:');
    console.error('     1. In PowerShell, run:  Get-OdbcDriver | Select-Object Name');
    console.error('     2. Find the SQL Server driver listed, e.g.:');
    console.error('          "ODBC Driver 17 for SQL Server"');
    console.error('          "ODBC Driver 18 for SQL Server"');
    console.error('     3. Add to your .env:  DB_ODBC_DRIVER=<exact name from step 2>');
    console.error('     4. Re-run: npm run seed:users');
  } else {
    console.error('\nCheck:');
    console.error('  1. DB_SERVER in your .env matches your SQL Server instance name');
    console.error('  2. SQL Server (or LocalDB) is actually running');
    console.error('  3. Run "npm run setup:env" if .env is missing');
  }
  process.exit(1);
});
