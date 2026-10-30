import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

// Reuse the running helper's native window; browser fallback supports headless installs.
const helper = join(homedir(), 'Applications', 'EnhancedPresence Helper.app', 'Contents/MacOS/EnhancedPresenceHelper');
if (existsSync(helper)) { execFileSync(helper, ['--settings']); console.log('Requested the helper’s Settings window. If it is still starting, try again in a moment.'); process.exit(0); }
const file = join(homedir(), 'Library', 'Application Support', 'EnhancedPresence', 'settings-session.json');
let url;
try { url = JSON.parse(readFileSync(file, 'utf8')).url; } catch { /* handled below */ }
if (!url) { console.error('The companion is not running. Start it with: npm run install:companion'); process.exit(1); }
execFileSync('open', [url]);
console.log('Opened the settings app.');
