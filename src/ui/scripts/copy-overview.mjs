// Publishes the team/project overview page (_designs/ClopayCodeCrafters.html) with the site, at /clopay-codecrafters.html.
// _designs stays the single source; this copy runs before every dev/build and is git-ignored. Missing source = skip quietly.
import { cpSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ui = join(dirname(fileURLToPath(import.meta.url)), '..');
const designs = join(ui, '..', '..', '_designs');
const html = join(designs, 'ClopayCodeCrafters.html');

if (!existsSync(html)) {
  console.log('[copy-overview] _designs/ClopayCodeCrafters.html not found - skipped');
} else {
  // The site's CSP (helmet: script-src-attr 'none') blocks inline handlers, so drop the offline onerror fallbacks;
  // on the site the images load straight from Azure Storage.
  const page = readFileSync(html, 'utf8').replace(/\s+onerror="[^"]*"/g, '');
  writeFileSync(join(ui, 'public', 'clopay-codecrafters.html'), page);
  const images = join(designs, 'team', 'web');
  if (existsSync(images)) {
    mkdirSync(join(ui, 'public', 'team'), { recursive: true });
    cpSync(images, join(ui, 'public', 'team', 'web'), { recursive: true });
  }
  console.log('[copy-overview] published /clopay-codecrafters.html');
}
