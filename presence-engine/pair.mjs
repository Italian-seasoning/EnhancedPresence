import { randomBytes } from 'node:crypto';
import { writeFileSync } from 'node:fs';
// Local pairing only, not a Discord credential; never print the secret.
writeFileSync('bridge.local.json', JSON.stringify({ token: randomBytes(32).toString('hex') }, null, 2) + '\n', { flag: 'wx', mode: 0o600 });
console.log('Created private bridge.local.json. Copy its token manually into the universal plugin settings.');
