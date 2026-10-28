import { execFile } from 'node:child_process';
import { fileURLToPath } from 'node:url';
const bridge = fileURLToPath(new URL('./resolveBridge.py', import.meta.url));
export function resolveProvider(python = '/usr/bin/python3') {
  let value = null, expires = 0, named = false;
  return async ({ showName = false } = {}) => {
    if (Date.now() < expires && named === showName) return value;
    named = showName;
    expires = Date.now() + 5000;
    value = await new Promise(resolve => execFile(python, [bridge, ...(showName ? ['--include-name'] : [])], { timeout: 1500, maxBuffer: 4096 }, (err, stdout) => {
      if (err) return resolve(null);
      try { resolve(JSON.parse(stdout)); } catch { resolve(null); }
    }));
    return value;
  };
}
