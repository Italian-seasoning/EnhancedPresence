import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

// Opens the settings app in your browser (the menu bar icon opens it in its own window).
const file = join(homedir(), 'Library', 'Application Support', 'EnhancedPresence', 'settings-session.json');
let url;
try { url = JSON.parse(readFileSync(file, 'utf8')).url; } catch { /* handled below */ }
if (!url) { console.error('The companion is not running. Start it with: npm run install:companion'); process.exit(1); }
execFileSync('open', [url]);
console.log('Opened the settings app.');
