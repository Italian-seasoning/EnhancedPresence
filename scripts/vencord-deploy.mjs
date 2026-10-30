import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { cpSync, existsSync, lstatSync, mkdirSync, readdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { repair } from '../presence-engine/repair.mjs';

// Installs a built Vencord (dist/) as a managed copy and points Discord at it, without the
// interactive Vencord installer. A small background agent re-applies it after Discord updates.
const source = fileURLToPath(new URL('..', import.meta.url));
export const LABEL = 'app.enhancedpresence.vencord-repair';

// A minimal Electron asar: Discord loads index.js from it, which loads Vencord's patcher.
export function buildLoader(patcher) {
  const files = { 'index.js': Buffer.from(`require(${JSON.stringify(patcher)})`), 'package.json': Buffer.from('{\n\t"name": "discord",\n\t"main": "index.js"\n}') };
  let offset = 0;
  const header = { files: Object.fromEntries(Object.entries(files).map(([name, data]) => { const entry = { size: data.length, offset: String(offset) }; offset += data.length; return [name, entry]; })) };
  const json = Buffer.from(JSON.stringify(header)), pad = (4 - json.length % 4) % 4;
  const prefix = Buffer.alloc(16);
  prefix.writeUInt32LE(4, 0); prefix.writeUInt32LE(json.length + pad + 8, 4); prefix.writeUInt32LE(json.length + pad + 4, 8); prefix.writeUInt32LE(json.length, 12);
  return Buffer.concat([prefix, json, Buffer.alloc(pad), ...Object.values(files)]);
}

export function stage({ dist, managed, patcher }) {
  const names = readdirSync(dist).filter(name => /^(patcher|preload|renderer|vencordDesktop\w*)\.(js|css|js\.LEGAL\.txt)$/.test(name) && lstatSync(join(dist, name)).isFile());
  for (const required of ['patcher.js', 'preload.js', 'renderer.js']) if (!names.includes(required)) throw Error(`Build output is missing ${required}; run pnpm build --disable-updater first.`);
  mkdirSync(managed, { recursive: true, mode: 0o700 });
  const manifest = {};
  const put = (name, data) => { writeFileSync(join(managed, `${name}.new`), data); renameSync(join(managed, `${name}.new`), join(managed, name)); manifest[name] = createHash('sha256').update(data).digest('hex'); };
  put('loader.asar', buildLoader(patcher));
  put('package.json', '{}');
  // Source maps are skipped to save disk space (several MB each).
  for (const name of names) put(name, readFileSync(join(dist, name)));
  writeFileSync(join(managed, 'manifest.json'), JSON.stringify(manifest, null, 2));
  return Object.keys(manifest).filter(name => name !== 'loader.asar');
}

export async function deploy(checkout, { home = homedir(), resources = '/Applications/Discord.app/Contents/Resources', start = true } = {}) {
  const root = join(home, 'Library', 'Application Support', 'EnhancedPresence'), maintenance = join(root, 'maintenance');
  const dist = join(home, 'Library', 'Application Support', 'Vencord', 'dist');
  const files = stage({ dist: join(checkout, 'dist'), managed: join(maintenance, 'managed'), patcher: join(dist, 'patcher.js') });
  cpSync(join(source, 'presence-engine', 'repair.mjs'), join(maintenance, 'repair.mjs'));
  const changed = await repair({ resources, dist, managed: join(maintenance, 'managed'), backups: join(maintenance, 'backups'), files });
  const node = existsSync('/opt/homebrew/bin/node') ? '/opt/homebrew/bin/node' : process.execPath;
  const xml = value => value.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;');
  const plist = join(home, 'Library', 'LaunchAgents', `${LABEL}.plist`);
  mkdirSync(join(home, 'Library', 'LaunchAgents'), { recursive: true });
  writeFileSync(plist, `<?xml version="1.0" encoding="UTF-8"?>\n<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">\n<plist version="1.0"><dict>\n<key>Label</key><string>${LABEL}</string>\n<key>ProcessType</key><string>Background</string>\n<key>ProgramArguments</key><array><string>${xml(node)}</string><string>${xml(join(maintenance, 'repair.mjs'))}</string></array>\n<key>RunAtLoad</key><true/>\n<key>WatchPaths</key><array><string>${xml(resources)}</string><string>${xml(dist)}</string></array>\n<key>StandardErrorPath</key><string>${xml(join(maintenance, 'repair-error.log'))}</string>\n<key>StandardOutPath</key><string>/dev/null</string>\n</dict></plist>\n`, { mode: 0o600 });
  if (start) {
    const domain = `gui/${process.getuid()}`;
    try { execFileSync('launchctl', ['bootout', `${domain}/${LABEL}`], { stdio: 'ignore' }); } catch { /* not loaded yet */ }
    execFileSync('sleep', ['2']);
    execFileSync('launchctl', ['bootstrap', domain, plist], { stdio: 'inherit' });
  }
  return { changed, dist };
}
