import { cpSync, mkdirSync, existsSync, readFileSync, writeFileSync, chmodSync, lstatSync, renameSync, rmSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomBytes } from 'node:crypto';
import { validateConfig } from './profiles.mjs';

// Install the local companion only. Vencord's plugin is built and enabled separately.
if (process.platform !== 'darwin') throw Error('The native app detector currently supports macOS.');
const applicationId = process.argv[2];
if (!/^\d{17,20}$/.test(applicationId || '')) throw Error('Pass an existing numeric Discord application ID, never a token.');
const source = fileURLToPath(new URL('../', import.meta.url));
const root = join(homedir(), 'Library', 'Application Support', 'EnhancedPresence');
const agents = join(homedir(), 'Library', 'LaunchAgents');
const node = existsSync('/opt/homebrew/bin/node') ? '/opt/homebrew/bin/node' : process.execPath;
if (!existsSync(join(source, 'build', 'detector'))) throw Error('Build the detector before installation.');
if (!existsSync(join(source, 'build', 'MediaRemoteAdapter.framework'))) throw Error('Run npm run build:music before installation.');
mkdirSync(root, { recursive: true, mode: 0o700 });
if (!lstatSync(root).isDirectory() || lstatSync(root).isSymbolicLink()) throw Error('Companion destination must be a regular directory.');
const configPath = join(root, 'config.local.json');
const bridgePath = join(root, 'bridge.local.json');
for (const file of [configPath, bridgePath]) {
  if (existsSync(file) && (!lstatSync(file).isFile() || lstatSync(file).isSymbolicLink())) throw Error('Settings must be regular local files.');
}
const config = existsSync(configPath) ? validateConfig(JSON.parse(readFileSync(configPath, 'utf8'))) : validateConfig({ enabled: false });
const bridge = existsSync(bridgePath) ? JSON.parse(readFileSync(bridgePath, 'utf8')) : { token: randomBytes(32).toString('hex') };
if (!/^[a-f0-9]{64}$/.test(bridge.token)) throw Error('Existing pairing configuration is invalid; it was preserved.');
const previousApplicationId = bridge.applicationId;
bridge.applicationId = applicationId;
for (const directory of ['presence-engine', 'shared', 'vendor']) cpSync(join(source, directory), join(root, directory), { recursive: true, verbatimSymlinks: true });
const build = join(root, 'build');
mkdirSync(build, { recursive: true });
if (!lstatSync(build).isDirectory() || lstatSync(build).isSymbolicLink()) throw Error('Build destination must be a regular directory.');
const sourceFramework = join(source, 'build', 'MediaRemoteAdapter.framework');
cpSync(join(source, 'build', 'detector'), join(build, 'detector'));
const framework = join(build, 'MediaRemoteAdapter.framework');
const stage = join(build, `.MediaRemoteAdapter-${randomBytes(8).toString('hex')}.framework`);
const previous = `${stage}.previous`;
let movedPrevious = false;
try {
  cpSync(sourceFramework, stage, { recursive: true, verbatimSymlinks: true });
  if (existsSync(framework)) {
    if (!lstatSync(framework).isDirectory() || lstatSync(framework).isSymbolicLink()) throw Error('Framework destination must be a regular directory.');
    renameSync(framework, previous);
    movedPrevious = true;
  }
  try { renameSync(stage, framework); }
  catch (error) {
    if (movedPrevious) renameSync(previous, framework);
    throw error;
  }
  if (movedPrevious) rmSync(previous, { recursive: true });
} finally { rmSync(stage, { recursive: true, force: true }); }
if (!existsSync(configPath)) writeFileSync(configPath, JSON.stringify(config, null, 2) + '\n', { mode: 0o600 });
if (!existsSync(bridgePath) || previousApplicationId !== applicationId) writeFileSync(bridgePath, JSON.stringify(bridge, null, 2) + '\n', { mode: 0o600 });
chmodSync(configPath, 0o600); chmodSync(bridgePath, 0o600);
mkdirSync(agents, { recursive: true });
const xml = value => value.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;');
const args = [node, join(root, 'presence-engine', 'main.mjs'), '--detect', '--quiet', '--config', configPath, '--vencord', '--activation-approved', '--bridge-config', bridgePath];
const agent = `<?xml version="1.0" encoding="UTF-8"?>\n<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">\n<plist version="1.0"><dict>\n<key>Label</key><string>app.enhancedpresence.engine</string>\n<key>ProgramArguments</key><array>${args.map(arg => `<string>${xml(arg)}</string>`).join('')}</array>\n<key>RunAtLoad</key><true/>\n<key>KeepAlive</key><true/>\n<key>ThrottleInterval</key><integer>30</integer>\n<key>ProcessType</key><string>Standard</string>\n<key>StandardOutPath</key><string>/dev/null</string>\n<key>StandardErrorPath</key><string>${xml(join(root, 'engine-error.log'))}</string>\n</dict></plist>\n`;
writeFileSync(join(agents, 'app.enhancedpresence.engine.plist'), agent, { mode: 0o600 });
console.log('Installed the companion and private pairing in a paused state. Start app.enhancedpresence.engine with launchctl; enable EnhancedPresenceUniversal in Vencord.');
console.log(`For optional project names, enable Accessibility for ${node} and ${join(build, 'detector')}. Node access also applies to other programs run with it.`);
