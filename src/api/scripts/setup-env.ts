/**
 * Creates a local .env file by copying .env.example if it doesn't exist.
 * Run: npm run setup:env
 */
import * as fs   from 'fs';
import * as path from 'path';

const root   = path.resolve(__dirname, '..');
const src    = path.join(root, '.env.example');
const dest   = path.join(root, '.env');

if (!fs.existsSync(src)) {
  console.error('❌  .env.example not found at', src);
  process.exit(1);
}

if (fs.existsSync(dest)) {
  console.log(`✓  .env already exists at ${dest}`);
  console.log('   Edit it if you need to change DB_SERVER or DB_NAME.');
} else {
  fs.copyFileSync(src, dest);
  console.log(`✅  Created ${dest} from .env.example`);
  console.log('\n   Next steps:');
  console.log('   1. Open src/api/.env');
  console.log('   2. Confirm DB_SERVER=(localdb)\\MSSQLLocalDB and DB_NAME=TransferHubDB');
  console.log('   3. If using SQL login instead of Windows Auth set DB_TRUSTED_CONNECTION=false');
  console.log('      and fill in DB_USER / DB_PASSWORD');
  console.log('   4. Run: npm run seed:users');
}
