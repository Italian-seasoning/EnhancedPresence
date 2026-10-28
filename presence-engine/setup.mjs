import { readFileSync, writeFileSync, existsSync, lstatSync, renameSync, unlinkSync } from 'node:fs';
import { resolve, dirname, join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { profiles, blocked, validateConfig } from './profiles.mjs';
import { diagnose } from './doctor.mjs';

const args = process.argv.slice(2);
const command = args[0];
const option = key => { const i = args.indexOf(key); return i < 0 ? undefined : args[i + 1]; };
const configPath = resolve(option('--config') ?? 'config.local.json');
function load() {
  if (lstatSync(configPath).isSymbolicLink()) throw Error('Use a regular configuration file');
  return validateConfig(JSON.parse(readFileSync(configPath, 'utf8')));
}
function save(config, create = false) {
  const encoded = JSON.stringify(validateConfig(config), null, 2) + '\n';
  if (create) { writeFileSync(configPath, encoded, { flag: 'wx', mode: 0o600 }); return; }
  const temporary = join(dirname(configPath), `.presence-${randomUUID()}.tmp`);
  try {
    writeFileSync(temporary, encoded, { flag: 'wx', mode: 0o600 });
    renameSync(temporary, configPath);
  } finally { if (existsSync(temporary)) unlinkSync(temporary); }
}
try {
  if (command === 'doctor') {
    const pairing = resolve(option('--bridge-config') ?? 'bridge.local.json');
    let configuration = 'missing', paired = 'missing';
    if (existsSync(configPath)) { try { load(); configuration = 'valid'; } catch { configuration = 'invalid'; } }
    if (existsSync(pairing)) {
      try { paired = /^[a-f0-9]{64}$/.test(JSON.parse(readFileSync(pairing, 'utf8')).token) ? 'valid' : 'invalid'; } catch { paired = 'invalid'; }
    }
    console.log(JSON.stringify({ configuration, detector: existsSync(fileURLToPath(new URL('../build/detector', import.meta.url))) ? 'built' : 'missing', pairing: paired, vencordAdapter: 'source ready; installation not checked', activation: 'manual approval required', checks: await diagnose() }, null, 2));
  } else if (command === 'init') {
    save({ enabled: false }, true);
    console.log('Created private local settings; presence starts paused.');
  } else if (['pause', 'resume', 'allow', 'deny'].includes(command)) {
    const config = load();
    if (command === 'pause' || command === 'resume') config.enabled = command === 'resume';
    else {
      const id = args[1];
      if (!id || !/^[\w.-]{1,200}$/.test(id)) throw Error('A bundle identifier is required');
      if (command === 'deny') { if (!config.denylist.includes(id)) config.denylist.push(id); }
      else {
        if (blocked.has(id)) throw Error('Sensitive/Discord apps remain blocked');
        const name = option('--name'), details = option('--details');
        if (name !== undefined || details !== undefined) config.profiles[id] = { name, details };
        else if (!Object.hasOwn(profiles, id) && !Object.hasOwn(config.profiles, id)) throw Error('Unknown apps require static public --name and --details');
        if (!config.allowlist.includes(id)) config.allowlist.push(id);
        config.denylist = config.denylist.filter(x => x !== id);
      }
    }
    save(config);
    console.log('Saved local settings. The engine reloads them on its next snapshot.');
  } else {
    throw Error('Usage: setup.mjs init|doctor|pause|resume|allow BUNDLE_ID|deny BUNDLE_ID [--config FILE] [--name PUBLIC_LABEL --details PUBLIC_TEXT]');
  }
} catch (error) {
  // Do not echo malformed configuration, private labels, or pairing file contents.
  console.error(error.code === 'EEXIST' ? 'Settings already exist; no files changed.' : error.code === 'ENOENT' ? 'Settings file missing; run init first.' : error instanceof SyntaxError ? 'Invalid configuration JSON; no files changed.' : 'Settings operation failed; check the command and public profile fields.');
  process.exitCode = 1;
}
