// GPL-3.0-or-later. Native-only private local pairing reader.
import { lstatSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

export function readLocalPairing(root) {
  try {
    const file = join(root, 'bridge.local.json');
    const stat = lstatSync(file);
    if (!stat.isFile() || stat.size > 2048 || (process.platform !== 'win32' && ((stat.mode & 0o077) !== 0 || stat.uid !== process.getuid?.()))) return null;
    const config = JSON.parse(readFileSync(file, 'utf8'));
    if (typeof config.token !== 'string' || typeof config.applicationId !== 'string' || !/^[a-f0-9]{64}$/.test(config.token) || !/^\d{17,20}$/.test(config.applicationId)) return null;
    return { bridgeToken: config.token, applicationId: config.applicationId };
  } catch {
    return null;
  }
}
