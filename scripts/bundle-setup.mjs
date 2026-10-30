import { createHash, randomBytes } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { accessSync, constants, cpSync, existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, realpathSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { removeHooks } from '../presence-engine/hooks.mjs';

const HELPER_NAME = 'EnhancedPresence Helper.app';
const PLUGIN = 'EnhancedPresenceUniversal';
const JOBS = ['app.enhancedpresence.engine', 'app.enhancedpresence.vencord-repair'];
const ownedRuntime = ['presence-engine', 'shared', 'vendor/ws', 'vendor/mediaremote-adapter/bin', 'vendor/mediaremote-adapter/LICENSE', 'build/detector', 'build/MediaRemoteAdapter.framework', 'maintenance/managed', 'maintenance/repair.mjs'];

export function parseArguments(args) {
  const command = args[0];
  if (!['install', 'uninstall'].includes(command)) throw Error('Use install or uninstall.');
  const options = { command, withHooks: false, standalone: false, noStart: false };
  const values = new Set(['--application-id', '--home', '--discord-resources', '--manifest']);
  for (let i = 1; i < args.length; i++) {
    const key = args[i];
    if (values.has(key)) {
      const value = args[++i];
      if (!value || value.startsWith('--')) throw Error(`${key} requires a value.`);
      if (key === '--application-id') {
        if (!/^\d{17,20}$/.test(value)) throw Error('Application ID must be 17 to 20 digits.');
        options.applicationId = value;
      } else {
        if (!isAbsolute(value)) throw Error(`${key} requires an absolute path.`);
        options[key === '--discord-resources' ? 'resources' : key.slice(2)] = value;
      }
      continue;
    }
    if (key === '--with-hooks') options.withHooks = true;
    else if (key === '--standalone') options.standalone = true;
    else if (key === '--no-start') options.noStart = true;
    else throw Error(`Unknown option: ${key}`);
  }
  if (command === 'install' && !options.applicationId) throw Error('Install requires --application-id.');
  return options;
}

function safePath(root, path) {
  if (typeof path !== 'string' || !path || path.includes('\\') || path.startsWith('/')) throw Error('Invalid payload file path.');
  const parts = path.split('/');
  if (parts.some(part => !part || part === '.' || part === '..')) throw Error('Invalid payload file path.');
  const full = resolve(root, ...parts);
  const rel = relative(root, full);
  if (!rel || rel.startsWith(`..${sep}`) || rel === '..' || isAbsolute(rel)) throw Error('Payload path escapes the signed bundle.');
  return full;
}

function inside(root, path) {
  const rel = relative(root, path);
  return rel === '' || (!rel.startsWith(`..${sep}`) && rel !== '..' && !isAbsolute(rel));
}

const requiredFiles = [
  'Contents/Resources/runtime/node', 'Contents/Resources/presence-engine/install.mjs',
  'Contents/Resources/presence-engine/main.mjs', 'Contents/Resources/presence-engine/repair.mjs',
  'Contents/Resources/presence-engine/profiles.mjs', 'Contents/Resources/presence-engine/hooks.mjs', 'Contents/Resources/presence-engine/agent-hook.sh',
  'Contents/Resources/shared/protocol.mjs', 'Contents/Resources/shared/helper-metadata.mjs', 'Contents/Resources/vendor/ws/wrapper.mjs',
  'Contents/Resources/vendor/mediaremote-adapter/bin/mediaremote-adapter.pl', 'Contents/Resources/vendor/mediaremote-adapter/LICENSE',
  'Contents/Resources/build/detector',
  'Contents/Resources/build/MediaRemoteAdapter.framework/Versions/A/MediaRemoteAdapter',
  'Contents/Resources/scripts/bundle-setup.mjs', 'Contents/Resources/scripts/vencord-deploy.mjs',
  'Contents/Resources/scripts/install-vencord.mjs', 'Contents/Resources/tools/VencordInstallerCli-darwin',
  'Contents/Resources/vencord/package.json', 'Contents/Resources/vencord/REVISION',
  'Contents/Resources/vencord/dist/patcher.js', 'Contents/Resources/vencord/dist/preload.js',
  'Contents/Resources/vencord/dist/renderer.js', 'Contents/Info.plist',
  'Contents/MacOS/EnhancedPresenceHelper', 'Contents/_CodeSignature/CodeResources'
];
const executableFiles = ['Contents/Resources/runtime/node', 'Contents/Resources/tools/VencordInstallerCli-darwin',
  'Contents/Resources/build/detector', 'Contents/Resources/build/MediaRemoteAdapter.framework/Versions/A/MediaRemoteAdapter', 'Contents/MacOS/EnhancedPresenceHelper'];

function assertNoEscapingLinks(root) {
  const walk = dir => {
    for (const name of readdirSync(dir)) {
      const path = join(dir, name), stat = lstatSync(path);
      if (stat.isSymbolicLink()) {
        const rel = relative(root, path).split(sep).join('/');
        if (!rel.startsWith('Contents/Resources/build/MediaRemoteAdapter.framework/')) throw Error('Unexpected symlink in helper payload.');
        let target;
        try { target = realpathSync(path); } catch { target = null; }
        if (!target || !inside(root, target)) throw Error('Payload contains a link that escapes its signed bundle.');
      } else if (stat.isDirectory()) walk(path);
    }
  };
  walk(root);
}

export function validatePayload(payloadRoot, { manifestPath = join(dirname(dirname(payloadRoot)), 'release.json'), arch = process.arch, nodeVersion, macVersion } = {}) {
  const root = realpathSync(payloadRoot);
  const manifestStat = lstatSync(manifestPath);
  if (!manifestStat.isFile() || manifestStat.isSymbolicLink()) throw Error('Release manifest is unavailable.');
  const release = JSON.parse(readFileSync(manifestPath, 'utf8'));
  if (release.schema !== 1 || !/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/.test(release.version ?? '') || !['arm64', 'x64'].includes(release.arch) || release.arch !== arch) throw Error('Release metadata does not match this Mac architecture.');
  if (typeof release.minimumMacOS !== 'string' || typeof release.nodeVersion !== 'string' || !/^[a-f0-9]{40}$/i.test(release.vencordRevision ?? '') || !release.files || typeof release.files !== 'object' || Array.isArray(release.files)) throw Error('Release metadata is incomplete.');
  const mac = value => value.split('.').map(part => Number(part));
  if (nodeVersion && nodeVersion !== release.nodeVersion) throw Error(`This bundle requires Node ${release.nodeVersion}.`);
  if (macVersion) {
    const a = mac(macVersion), b = mac(release.minimumMacOS);
    for (let i = 0; i < Math.max(a.length, b.length); i++) {
      if ((a[i] ?? 0) === (b[i] ?? 0)) continue;
      if ((a[i] ?? 0) < (b[i] ?? 0)) throw Error(`This bundle requires macOS ${release.minimumMacOS} or newer.`);
      break;
    }
  }
  const keys = Object.keys(release.files);
  for (const required of requiredFiles) if (!Object.hasOwn(release.files, required)) throw Error(`Release manifest is missing ${required}.`);
  for (const path of keys) {
    const expected = release.files[path];
    if (!/^[a-f0-9]{64}$/i.test(expected ?? '')) throw Error('Release manifest contains an invalid file hash.');
    const file = safePath(root, path);
    const declared = lstatSync(file);
    if (!declared.isFile() || declared.isSymbolicLink()) throw Error(`Release file is not a regular file: ${path}.`);
    let real;
    try { real = realpathSync(file); } catch { throw Error(`Release file is missing: ${path}.`); }
    if (!inside(root, real)) throw Error(`Release file resolves outside its signed bundle: ${path}.`);
    const stat = lstatSync(real);
    if (!stat.isFile()) throw Error(`Release file is not regular: ${path}.`);
    if (executableFiles.includes(path) && (stat.mode & 0o111) === 0) throw Error(`Release executable is not marked executable: ${path}.`);
    const hash = createHash('sha256').update(readFileSync(real)).digest('hex');
    if (hash.toLowerCase() !== expected.toLowerCase()) throw Error(`Release file hash mismatch: ${path}.`);
  }
  assertNoEscapingLinks(root);
  const infoPath = safePath(root, 'Contents/Info.plist');
  const info = readFileSync(infoPath, 'utf8');
  const executable = info.match(/<key>CFBundleExecutable<\/key>\s*<string>([^<]+)<\/string>/)?.[1];
  const bundleId = info.match(/<key>CFBundleIdentifier<\/key>\s*<string>([^<]+)<\/string>/)?.[1];
  if (bundleId !== 'app.enhancedpresence.helper' || executable !== 'EnhancedPresenceHelper' || !existsSync(safePath(root, `Contents/MacOS/${executable}`))) throw Error('Helper application bundle is incomplete.');
  if (!info.match(/<key>NSAppleEventsUsageDescription<\/key>\s*<string>([^<]+)<\/string>/)?.[1]?.trim()) throw Error('Helper Music Automation explanation is missing.');
  const revision = readFileSync(safePath(root, 'Contents/Resources/vencord/REVISION'), 'utf8').trim();
  if (revision !== release.vencordRevision) throw Error('Prebuilt Vencord revision does not match the release manifest.');
  const renderer = readFileSync(safePath(root, 'Contents/Resources/vencord/dist/renderer.js'), 'utf8');
  if (!renderer.includes(PLUGIN)) throw Error('Prebuilt Vencord build does not include EnhancedPresenceUniversal.');
  return { ...release, payloadRoot: root, resourcesRoot: join(root, 'Contents', 'Resources') };
}

export function setPluginEnabled(home, enabled, createIfMissing = true) {
  const file = join(home, 'Library/Application Support/Vencord/settings/settings.json');
  let settings = {};
  if (existsSync(file)) {
    const stat = lstatSync(file);
    if (!stat.isFile() || stat.isSymbolicLink() || stat.size > 1_048_576) throw Error('Vencord settings file is unsafe; left unchanged.');
    settings = JSON.parse(readFileSync(file, 'utf8'));
    if (!settings || typeof settings !== 'object' || Array.isArray(settings)) throw Error('Vencord settings format is invalid; left unchanged.');
  } else if (!createIfMissing) return false;
  settings.plugins ??= {};
  if (!settings.plugins || typeof settings.plugins !== 'object' || Array.isArray(settings.plugins)) throw Error('Vencord plugin settings are invalid; left unchanged.');
  const current = settings.plugins[PLUGIN];
  if (current !== undefined && (!current || typeof current !== 'object' || Array.isArray(current))) throw Error('Enhanced Presence Vencord settings are invalid; left unchanged.');
  settings.plugins[PLUGIN] = { ...(settings.plugins[PLUGIN] ?? {}), enabled };
  const temporary = `${file}.${process.pid}.tmp`;
  mkdirSync(dirname(file), { recursive: true });
  try { writeFileSync(temporary, JSON.stringify(settings, null, 2) + '\n', { flag: 'wx', mode: 0o600 }); renameSync(temporary, file); }
  finally { try { rmSync(temporary); } catch {} }
  return true;
}

function isFileOrDir(path) { try { lstatSync(path); return true; } catch (error) { if (error.code === 'ENOENT') return false; throw error; } }
function readReceipt(path) {
  const stat = lstatSync(path);
  if (!stat.isFile() || stat.isSymbolicLink() || stat.size > 8192 || (stat.mode & 0o077) !== 0 || stat.uid !== process.getuid()) throw Error('Install receipt is unsafe; no files were changed.');
  return JSON.parse(readFileSync(path, 'utf8'));
}
function helperBundleInfo(app) {
  const appStat = lstatSync(app);
  if (!appStat.isDirectory() || appStat.isSymbolicLink()) return '';
  const info = join(app, 'Contents/Info.plist');
  try {
    const infoStat = lstatSync(info);
    if (!infoStat.isFile() || infoStat.isSymbolicLink() || infoStat.size > 65536) return '';
    return readFileSync(info, 'utf8');
  } catch { return ''; }
}
function snapshot(path, backup) { if (isFileOrDir(path)) cpSync(path, backup, { recursive: true, verbatimSymlinks: true }); }
export function restoreSnapshot(path, backup, operations = {}) {
  const copy = operations.copy ?? cpSync, rename = operations.rename ?? renameSync, removePath = operations.remove ?? rmSync;
  if (!isFileOrDir(backup)) { removePath(path, { recursive: true, force: true }); return; }
  mkdirSync(dirname(path), { recursive: true });
  const stage = `${path}.restore-${process.pid}-${Date.now()}.tmp`;
  const backupStat = lstatSync(backup);
  try {
    copy(backup, stage, { recursive: true, verbatimSymlinks: true });
    if (!backupStat.isSymbolicLink() && backupStat.isDirectory() && isFileOrDir(path)) {
      const displaced = `${path}.rollback-${process.pid}-${Date.now()}`;
      rename(path, displaced);
      try { rename(stage, path); }
      catch (error) {
        try { rename(displaced, path); }
        catch (restoreError) { throw new AggregateError([error, restoreError], `Restore failed for ${path}; the original remains at ${displaced}.`); }
        throw error;
      }
      removePath(displaced, { recursive: true, force: true });
    } else rename(stage, path);
  } finally { removePath(stage, { recursive: true, force: true }); }
}
function remove(path) { rmSync(path, { recursive: true, force: true }); }
function hasOwnedHook(path) {
  let settings;
  try {
    const stat = lstatSync(path);
    if (!stat.isFile() || stat.isSymbolicLink()) throw Error('Hook settings file is unsafe; left unchanged.');
    settings = JSON.parse(readFileSync(path, 'utf8'));
  } catch (error) { if (error.code === 'ENOENT') return false; throw error; }
  return Object.values(settings?.hooks ?? {}).some(entries => Array.isArray(entries) && entries.some(entry => entry?.hooks?.some(hook => typeof hook?.command === 'string' && hook.command.includes('agent-hook'))));
}

function bootout(home, labels = JOBS, strict = false) {
  for (const label of labels) {
    try { execFileSync('/bin/launchctl', ['bootout', `gui/${process.getuid()}/${label}`], { stdio: 'ignore' }); }
    catch { if (strict) throw Error(`Could not stop the existing ${label} service safely.`); }
  }
}

function loadedJobs() {
  return JOBS.filter(label => { try { execFileSync('/bin/launchctl', ['print', `gui/${process.getuid()}/${label}`], { stdio: 'ignore' }); return true; } catch { return false; } });
}

function ensureDiscordWritable(resources) {
  const probe = join(resources, `.enhanced-presence-check-${process.pid}-${randomBytes(6).toString('hex')}`);
  try { accessSync(resources, constants.W_OK); writeFileSync(probe, '', { flag: 'wx', mode: 0o600 }); rmSync(probe); }
  catch { try { rmSync(probe, { force: true }); } catch {} throw Error('Discord.app Resources is not writable. Choose a Discord app you can modify or use standalone mode.'); }
}

function bootstrap(home, labels = JOBS) {
  for (const label of labels) {
    const plist = join(home, 'Library/LaunchAgents', `${label}.plist`);
    if (existsSync(plist)) execFileSync('/bin/launchctl', ['bootstrap', `gui/${process.getuid()}`, plist], { stdio: 'ignore' });
  }
}

export async function installBundle({ payloadRoot, home = homedir(), resources, applicationId, withHooks = false, standalone = false, noStart = false, manifestPath, runInstaller, deployFn, activate, runtimeNode, verifySignature = path => execFileSync('/usr/bin/codesign', ['--verify', '--deep', '--strict', path], { stdio: 'ignore' }), environment = process.env } = {}) {
  if (!isAbsolute(home) || (resources && !isAbsolute(resources))) throw Error('Install paths must be absolute.');
  if (!/^\d{17,20}$/.test(applicationId ?? '')) throw Error('Application ID must be 17 to 20 digits.');
  const release = validatePayload(payloadRoot, { manifestPath, arch: process.arch, nodeVersion: undefined, macVersion: undefined });
  const payload = release.payloadRoot, assets = release.resourcesRoot;
  try { verifySignature(payload); } catch { throw Error('The signed helper app failed validation.'); }
  const payloadRuntime = runtimeNode ?? join(assets, 'runtime/node');
  const nodeVersion = execFileSync(payloadRuntime, ['--version'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim().replace(/^v/, '');
  if (nodeVersion !== release.nodeVersion) throw Error(`Bundled runtime version does not match the release manifest (requires ${release.nodeVersion}).`);
  if (process.platform !== 'darwin') throw Error('The installer bundle requires macOS.');
  const actualMac = execFileSync('/usr/bin/sw_vers', ['-productVersion'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
  const macParts = value => value.split('.').map(part => Number(part));
  const macCompare = (left, right) => { const a = macParts(left), b = macParts(right); for (let i = 0; i < Math.max(a.length, b.length); i++) if ((a[i] ?? 0) !== (b[i] ?? 0)) return (a[i] ?? 0) - (b[i] ?? 0); return 0; };
  if (macCompare(actualMac, release.minimumMacOS) < 0) throw Error(`This bundle requires macOS ${release.minimumMacOS} or newer.`);
  const discordResources = resources ?? '/Applications/Discord.app/Contents/Resources';
  let deployer, matchingLoader = false;
  if (!standalone) {
    const asar = join(discordResources, 'app.asar'), info = join(dirname(discordResources), 'Info.plist');
    if (basename(discordResources) !== 'Resources' || basename(dirname(discordResources)) !== 'Contents' || !existsSync(asar) || !existsSync(info) || !lstatSync(asar).isFile() || !lstatSync(info).isFile()) throw Error('Discord.app Resources folder was not found.');
    let bundleId;
    try { bundleId = execFileSync('/usr/bin/plutil', ['-extract', 'CFBundleIdentifier', 'raw', '-o', '-', info], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim(); }
    catch (error) { throw Error(`Could not validate the selected Discord app: ${error.message}`); }
    if (bundleId !== 'com.hnc.Discord') throw Error('Select the standard Discord app.');
    deployer = await import(pathToFileURL(join(assets, 'scripts/vencord-deploy.mjs')).href);
    const dist = join(home, 'Library/Application Support/Vencord/dist'), original = join(discordResources, '_app.asar');
    const appStat = lstatSync(asar), originalStat = existsSync(original) ? lstatSync(original) : null;
    const expectedLoader = deployer.buildLoader(join(dist, 'patcher.js'));
    matchingLoader = appStat.isFile() && !appStat.isSymbolicLink() && originalStat?.isFile() && !originalStat.isSymbolicLink()
      && readFileSync(asar).equals(expectedLoader);
    if (!matchingLoader) ensureDiscordWritable(discordResources);
  }
  const app = join(home, 'Applications', HELPER_NAME), support = join(home, 'Library/Application Support/EnhancedPresence');
  const installedRuntime = join(app, 'Contents/Resources/runtime/node');
  const launchAgents = join(home, 'Library/LaunchAgents'), vcSettings = join(home, 'Library/Application Support/Vencord/settings/settings.json');
  const receiptPath = join(support, 'bundle-receipt.json');
  if (existsSync(support)) { const supportStat = lstatSync(support); if (!supportStat.isDirectory() || supportStat.isSymbolicLink()) throw Error('Companion settings folder is unsafe; nothing was changed.'); }
  const previousReceipt = existsSync(receiptPath) ? readReceipt(receiptPath) : null;
  const effectiveWithHooks = withHooks || previousReceipt?.withHooks === true;
  if (existsSync(app)) {
    if (!helperBundleInfo(app).includes('<string>app.enhancedpresence.helper</string>') || (previousReceipt && (previousReceipt.schema !== 1 || previousReceipt.helperPath !== app))) throw Error('An unrecognized app already exists at the helper destination; it was left unchanged.');
  }
  const targets = [app, ...ownedRuntime.map(path => join(support, path)), join(support, 'bundle-receipt.json'),
    join(support, 'config.local.json'), join(support, 'bridge.local.json'),
    join(launchAgents, `${JOBS[0]}.plist`), join(launchAgents, `${JOBS[1]}.plist`), vcSettings];
  if (effectiveWithHooks) targets.push(join(home, '.claude/settings.json'), join(home, '.claude/settings.json.enhancedpresence.bak'), join(home, '.codex/hooks.json'), join(home, '.codex/hooks.json.enhancedpresence.bak'));
  if (!standalone) {
    for (const name of readdirSync(join(assets, 'vencord/dist'))) if (/^(patcher|preload|renderer|vencordDesktop\w*)\.(js|css|js\.LEGAL\.txt)$/.test(name)) targets.push(join(home, 'Library/Application Support/Vencord/dist', name));
    targets.push(join(discordResources, 'app.asar'), join(discordResources, '_app.asar'));
  }
  const snapshotRoot = mkdtempSync(join(tmpdir(), 'ep-install-'));
  const backupFor = path => join(snapshotRoot, String(targets.indexOf(path)).replace('-', 'm'));
  const saved = [];
  for (const target of targets) { const backup = backupFor(target); snapshot(target, backup); saved.push([target, backup]); }
  const previouslyLoaded = noStart ? [] : loadedJobs();
  try {
    if (!noStart && previouslyLoaded.length) {
      bootout(home, previouslyLoaded, true);
      await new Promise(resolve => setTimeout(resolve, 2000));
    }
    mkdirSync(dirname(app), { recursive: true });
    if (resolve(app) !== resolve(payload)) {
      const stagedApp = `${app}.bundle-${process.pid}.tmp`;
      try {
        cpSync(payload, stagedApp, { recursive: true, verbatimSymlinks: true, dereference: false, force: true });
        verifySignature(stagedApp); remove(app); renameSync(stagedApp, app); verifySignature(app);
      }
      finally { remove(stagedApp); }
    }
    const installer = join(assets, 'presence-engine/install.mjs');
    const installArgs = [installer, applicationId, '--prebuilt', '--helper-app', app, '--node-path', installedRuntime, '--home', home, '--no-start', '--accept-terms', ...(standalone ? ['--standalone'] : []), ...(effectiveWithHooks ? ['--with-hooks'] : ['--no-hooks'])];
    (runInstaller ?? ((args, env) => execFileSync(payloadRuntime, args, { env, stdio: 'ignore' })))(installArgs, { ...environment, HOME: home });
    if (!standalone) {
      const checkout = join(assets, 'vencord');
      const dist = join(checkout, 'dist'), destination = join(home, 'Library/Application Support/Vencord/dist');
      mkdirSync(destination, { recursive: true });
      for (const name of readdirSync(dist)) {
        if (!/^(patcher|preload|renderer|vencordDesktop\w*)\.(js|css|js\.LEGAL\.txt)$/.test(name)) continue;
        cpSync(join(dist, name), join(destination, name));
      }
      const discordApp = dirname(dirname(discordResources));
      const cli = join(assets, 'tools/VencordInstallerCli-darwin');
      const activationEnv = { ...environment, HOME: home, VENCORD_USER_DATA_DIR: join(home, 'Library/Application Support/Vencord'), VENCORD_DEV_INSTALL: '1' };
      if (!matchingLoader) (activate ?? ((file, args, env) => execFileSync(file, args, { env, stdio: 'ignore' })))(cli, ['-install', '-location', discordApp], activationEnv);
      const deployerRun = deployFn ?? deployer.deploy;
      await deployerRun(checkout, { home, resources: discordResources, start: false, nodePath: installedRuntime });
      setPluginEnabled(home, true);
    }
    const receipt = { schema: 1, version: release.version, arch: release.arch, vencordRevision: release.vencordRevision,
      helperPath: app, resources: resources ?? '/Applications/Discord.app/Contents/Resources', standalone, withHooks: effectiveWithHooks, installedAt: new Date().toISOString() };
    const temporary = `${receiptPath}.${process.pid}.tmp`;
    mkdirSync(support, { recursive: true });
    writeFileSync(temporary, JSON.stringify(receipt, null, 2) + '\n', { flag: 'wx', mode: 0o600 }); renameSync(temporary, receiptPath);
    if (!noStart) bootstrap(home);
    rmSync(snapshotRoot, { recursive: true, force: true });
    return { message: standalone ? 'Enhanced Presence is installed in standalone mode.' : 'Enhanced Presence is installed. Open Discord and press Resume in Vencord.' };
  } catch (error) {
    if (!noStart) bootout(home);
    const rollbackErrors = [];
    for (const [target, backup] of saved.reverse()) try { restoreSnapshot(target, backup); } catch (restoreError) { rollbackErrors.push(restoreError); }
    try {
      const stillLoaded = new Set(loadedJobs());
      if (previouslyLoaded.some(label => !stillLoaded.has(label))) bootstrap(home, previouslyLoaded.filter(label => !stillLoaded.has(label)));
    } catch (serviceError) { rollbackErrors.push(serviceError); }
    if (rollbackErrors.length) throw new AggregateError([error, ...rollbackErrors], `Install failed: ${error.message}. Rollback was incomplete; recovery snapshot kept at ${snapshotRoot}. ${rollbackErrors.map(item => item.message).join(' ')}`);
    rmSync(snapshotRoot, { recursive: true, force: true });
    throw error;
  }
}

export async function uninstallBundle({ home = homedir(), noStart = false } = {}) {
  const support = join(home, 'Library/Application Support/EnhancedPresence'), receiptPath = join(support, 'bundle-receipt.json');
  let supportStat;
  try { supportStat = lstatSync(support); } catch (error) { if (error.code === 'ENOENT') throw Error('Enhanced Presence install receipt is missing; nothing was removed.'); throw error; }
  if (!supportStat.isDirectory() || supportStat.isSymbolicLink()) throw Error('Companion settings folder is unsafe; nothing was removed.');
  if (!existsSync(receiptPath)) throw Error('Enhanced Presence install receipt is missing; nothing was removed.');
  const receipt = readReceipt(receiptPath);
  const app = join(home, 'Applications', HELPER_NAME);
  if (receipt.schema !== 1 || receipt.helperPath !== app) throw Error('Install receipt does not match the managed helper app; nothing was removed.');
  if (existsSync(app)) {
    if (!helperBundleInfo(app).includes('<string>app.enhancedpresence.helper</string>')) throw Error('Managed helper app identity changed; nothing was removed.');
  }
  if (!noStart) {
    const running = loadedJobs();
    if (running.length) { bootout(home, running, true); await new Promise(resolve => setTimeout(resolve, 2000)); }
  }
  for (const path of [join(home, '.claude/settings.json'), join(home, '.codex/hooks.json')]) if (hasOwnedHook(path)) removeHooks(path);
  setPluginEnabled(home, false, false);
  remove(app);
  remove(join(home, 'Library/LaunchAgents', `${JOBS[0]}.plist`));
  remove(join(home, 'Library/LaunchAgents', `${JOBS[1]}.plist`));
  for (const path of ownedRuntime) remove(join(support, path));
  for (const name of ['settings-session.json', 'status.local.json', 'metadata.status.json', 'engine-error.log', 'maintenance/repair-error.log']) remove(join(support, name));
  remove(receiptPath);
  return { message: 'Enhanced Presence helper and background services were removed. Restart Discord to apply its plugin disable. Your settings, history, pairing, Discord and other Vencord plugins were kept.' };
}

function systemMacVersion() { return execFileSync('/usr/bin/sw_vers', ['-productVersion'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim(); }
async function main(argv = process.argv.slice(2)) {
  const options = parseArguments(argv), home = options.home ?? homedir();
  if (options.command === 'uninstall') {
    const result = await uninstallBundle({ home, noStart: options.noStart });
    process.stdout.write(`${JSON.stringify({ success: true, message: result.message })}\n`); return;
  }
  const scriptPath = fileURLToPath(import.meta.url);
  const payloadRoot = resolve(dirname(scriptPath), '../../..');
  console.log('Validating the signed helper payload…');
  console.log('Preparing the per-user installation…');
  const result = await installBundle({ payloadRoot, home, resources: options.resources, applicationId: options.applicationId, withHooks: options.withHooks, standalone: options.standalone, noStart: options.noStart, manifestPath: options.manifest, macVersion: systemMacVersion() });
  process.stdout.write(`${JSON.stringify({ success: true, message: result.message })}\n`);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main().catch(error => { console.error(error.message); process.exitCode = 1; });
