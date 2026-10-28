import { execFileSync } from 'node:child_process';
import { cpSync, mkdirSync, existsSync, readFileSync, writeFileSync, chmodSync, lstatSync, renameSync, rmSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomBytes } from 'node:crypto';
import { validateConfig } from './profiles.mjs';
import { installHooks, removeHooks } from './hooks.mjs';

// Install the local companion only. Vencord's plugin is built and enabled separately.
if (process.platform !== 'darwin') throw Error('The native app detector currently supports macOS.');
const flags = process.argv.slice(2), helper = flags.includes('--helper'), start = !flags.includes('--no-start'), hooks = !flags.includes('--no-hooks');
const claudeSettings = join(homedir(), '.claude', 'settings.json');
if (flags.includes('--remove-hooks')) { removeHooks(claudeSettings); console.log('Removed the EnhancedPresence hook from Claude Code settings.'); process.exit(0); }
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
// Application ID is public. Pass it once; later installs and updates reuse the saved one.
const applicationId = flags.find(x => !x.startsWith('--')) ?? previousApplicationId;
if (!/^\d{17,20}$/.test(applicationId || '')) throw Error('First install: pass your numeric Discord application ID (never a token): npm run install:companion -- 123456789012345678');
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
if (helper) {
  // A named app bundle gives the engine a stable identity in macOS privacy lists and Login Items.
  const app = join(homedir(), 'Applications', 'EnhancedPresence Helper.app'), exe = join(app, 'Contents', 'MacOS', 'EnhancedPresenceHelper');
  mkdirSync(join(app, 'Contents', 'MacOS'), { recursive: true });
  mkdirSync(join(app, 'Contents', 'Resources'), { recursive: true });
  cpSync(join(source, 'assets', 'AppIcon.icns'), join(app, 'Contents', 'Resources', 'AppIcon.icns'));
  writeFileSync(join(app, 'Contents', 'Info.plist'), `<?xml version="1.0" encoding="UTF-8"?>\n<plist version="1.0"><dict><key>CFBundleIdentifier</key><string>app.enhancedpresence.helper</string><key>CFBundleName</key><string>EnhancedPresence Helper</string><key>CFBundleIconFile</key><string>AppIcon</string><key>CFBundleExecutable</key><string>EnhancedPresenceHelper</string><key>CFBundlePackageType</key><string>APPL</string><key>LSUIElement</key><true/></dict></plist>\n`);
  writeFileSync(exe, `#!/bin/sh\nexec '${node}' "$@"\n`, { mode: 0o755 });
  try { execFileSync('codesign', ['--force', '--sign', '-', app], { stdio: 'ignore' }); } catch { /* Unsigned bundles still run. */ }
  args[0] = exe;
}
const agent = `<?xml version="1.0" encoding="UTF-8"?>\n<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">\n<plist version="1.0"><dict>\n<key>Label</key><string>app.enhancedpresence.engine</string>\n<key>ProgramArguments</key><array>${args.map(arg => `<string>${xml(arg)}</string>`).join('')}</array>\n<key>RunAtLoad</key><true/>\n<key>KeepAlive</key><true/>\n<key>ThrottleInterval</key><integer>30</integer>\n<key>ProcessType</key><string>Standard</string>\n<key>StandardOutPath</key><string>/dev/null</string>\n<key>StandardErrorPath</key><string>${xml(join(root, 'engine-error.log'))}</string>\n</dict></plist>\n`;
writeFileSync(join(agents, 'app.enhancedpresence.engine.plist'), agent, { mode: 0o600 });
const domain = `gui/${process.getuid()}`;
if (start) {
try { execFileSync('launchctl', ['bootout', `${domain}/app.enhancedpresence.engine`], { stdio: 'ignore' }); } catch { /* not loaded yet */ }
execFileSync('sleep', ['2']); // launchd finishes unloading asynchronously
execFileSync('launchctl', ['bootstrap', domain, join(agents, 'app.enhancedpresence.engine.plist')], { stdio: 'inherit' });
}
let hookNote = 'Claude Code hook skipped (--no-hooks); task timer and status will not appear.';
if (hooks) {
  try { installHooks(claudeSettings, `/bin/sh "${join(root, "presence-engine", "agent-hook.sh")}"`); hookNote = 'Added the task-status hook to ~/.claude/settings.json (original saved as settings.json.enhancedpresence.bak). Remove it any time with: npm run install:companion -- --remove-hooks'; }
  catch (error) { hookNote = `Could not update Claude Code settings (${error.message}). Rerun later or use --no-hooks.`; }
}
console.log(`Installed app.enhancedpresence.engine${start ? ' and started it' : ''}. A first install starts paused until you press Resume in Vencord.\n${hookNote}`);
console.log(`For optional project names, enable Accessibility for ${node} and ${join(build, 'detector')}. Node access also applies to other programs run with it.`);
