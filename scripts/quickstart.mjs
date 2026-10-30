import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { isAbsolute, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createInterface } from 'node:readline/promises';
import { installPlugin } from './install-vencord.mjs';
import { deploy } from './vencord-deploy.mjs';

export const VENCORD_REV = '644434941b515a2626a2161e219653cb36e723e7';
const valued = new Set(['--application-id', '--vencord', '--discord-resources']);
const switches = new Set(['--accept-terms', '--restart-discord', '--standalone', '--no-start', '--with-hooks']);

export function parseArguments(args) {
  const options = { standalone: false, withHooks: false, acceptTerms: false, restartDiscord: false, noStart: false };
  for (let i = 0; i < args.length; i++) {
    const key = args[i];
    if (valued.has(key)) {
      const value = args[++i];
      if (!value || value.startsWith('--')) throw Error(`${key} requires a value.`);
      if (key === '--application-id') {
        if (!/^\d{17,20}$/.test(value)) throw Error('The Application ID must be 17 to 20 digits.');
        options.applicationId = value;
      } else if (key === '--vencord') {
        if (!isAbsolute(value)) throw Error('--vencord requires an absolute path.');
        options.vencord = value;
      } else options.resources = value;
      continue;
    }
    if (!switches.has(key)) throw Error(`Unknown option: ${key}`);
    if (key === '--standalone') options.standalone = true;
    if (key === '--with-hooks') options.withHooks = true;
    if (key === '--accept-terms') options.acceptTerms = true;
    if (key === '--restart-discord') options.restartDiscord = true;
    if (key === '--no-start') options.noStart = true;
  }
  if (options.standalone && options.vencord) throw Error('--vencord cannot be used with --standalone.');
  return options;
}

export function requiredTools(standalone) {
  return ['swiftc', 'cmake', ...(standalone ? [] : ['git', 'npx', 'xcodebuild'])];
}

export function pnpmPackage(info) {
  if (!/^pnpm@\d+\.\d+\.\d+$/.test(info.packageManager ?? '')) throw Error('Vencord must specify an exact pnpm version.');
  return info.packageManager;
}

export function companionArgs({ applicationId, standalone, withHooks, noStart }) {
  return [
    ...(applicationId ? [applicationId] : []), '--helper', '--accept-terms',
    ...(standalone ? ['--standalone'] : []), ...(withHooks ? ['--with-hooks'] : ['--no-hooks']),
    ...(noStart ? ['--no-start'] : [])
  ];
}

export function validateManagedRevision(head) {
  if (head.trim() !== VENCORD_REV) throw Error(`The managed Vencord checkout is not at the expected tested Vencord revision (${VENCORD_REV}); it was left unchanged.`);
}

const root = fileURLToPath(new URL('..', import.meta.url));
const run = (command, argv, cwd = root) => execFileSync(command, argv, { cwd, stdio: 'inherit' });
const step = text => console.log(`\n==> ${text}`);

async function main(rawArgs = process.argv.slice(2)) {
  const options = parseArguments(rawArgs);
  if (process.platform !== 'darwin') throw Error('Enhanced Presence currently supports macOS only.');
  if (Number(process.versions.node.split('.')[0]) < 22) throw Error('Node.js 22 or newer is required.');
  const missing = requiredTools(options.standalone).filter(tool => {
    try { execFileSync('which', [tool], { stdio: 'ignore' }); return false; } catch { return true; }
  });
  if (missing.length) throw Error(`Install these first: ${missing.join(', ')} (Xcode command-line tools: xcode-select --install; others via Homebrew).`);
  const resources = options.resources ?? '/Applications/Discord.app/Contents/Resources';
  if (!options.standalone && !existsSync(resources)) throw Error('Discord.app was not found in /Applications.');
  if (options.vencord && !existsSync(join(options.vencord, 'package.json'))) throw Error('The Vencord checkout must contain package.json; it was left unchanged.');

  let terminal;
  const ask = question => {
    if (!process.stdin.isTTY) throw Error('This setup step needs a terminal. Rerun with the required option after reviewing the prompt.');
    terminal ??= createInterface({ input: process.stdin, output: process.stdout });
    return terminal.question(question);
  };
  try {
    if (!options.standalone && !options.acceptTerms) {
      console.log("Enhanced Presence modifies Discord through Vencord, which may violate Discord's Terms of Service. Read TERMS.md first.");
      if ((await ask('Type "yes" to continue: ')).trim().toLowerCase() !== 'yes') throw Error('Terms not accepted; nothing was installed.');
    }
    let applicationId = options.applicationId;
    const bridge = join(homedir(), 'Library', 'Application Support', 'EnhancedPresence', 'bridge.local.json');
    if (!applicationId && existsSync(bridge)) {
      try { applicationId = JSON.parse(readFileSync(bridge, 'utf8')).applicationId; } catch { /* ask below */ }
    }
    if (!applicationId) applicationId = (await ask('Discord Application ID (17 to 20 digits; never a token): ')).trim();
    if (!/^\d{17,20}$/.test(applicationId)) throw Error('The Application ID must be 17 to 20 digits.');

    step('Building the app detector and music adapter');
    run('npm', ['run', 'build:detector']);
    run('npm', ['run', 'build:music']);

    step('Installing the companion and helper app');
    run('node', ['presence-engine/install.mjs', ...companionArgs({ applicationId, standalone: options.standalone, withHooks: options.withHooks, noStart: options.noStart })]);
    if (options.standalone) {
      console.log('\nStandalone mode: Discord was not modified. Open Discord, then use the menu bar icon > Settings… and press Resume sharing.');
      return;
    }

    step('Preparing Vencord');
    const managed = !options.vencord;
    const checkout = options.vencord ?? join(homedir(), 'Library', 'Application Support', 'EnhancedPresence', 'vencord-src');
    if (!existsSync(join(checkout, 'package.json'))) {
      if (existsSync(checkout)) throw Error('The managed Vencord directory exists but is not a checkout; it was left unchanged.');
      mkdirSync(checkout, { recursive: true });
      run('git', ['init', '-q'], checkout);
      run('git', ['remote', 'add', 'origin', 'https://github.com/Vendicated/Vencord.git'], checkout);
      run('git', ['fetch', '--depth', '1', 'origin', VENCORD_REV], checkout);
      run('git', ['checkout', '-q', 'FETCH_HEAD'], checkout);
    } else if (managed) {
      validateManagedRevision(execFileSync('git', ['rev-parse', 'HEAD'], { cwd: checkout, encoding: 'utf8' }));
    }
    console.log(installPlugin(checkout));
    // Use the checkout's exact build tool; pnpm's macOS version-switching shim can fail with ENOEXEC.
    const pnpm = pnpmPackage(JSON.parse(readFileSync(join(checkout, 'package.json'), 'utf8')));
    run('npx', ['--yes', pnpm, 'install', '--frozen-lockfile'], checkout);
    run('npx', ['--yes', pnpm, 'build', '--disable-updater'], checkout);

    step('Applying the build to Discord');
    const { changed } = await deploy(checkout, { resources, start: !options.noStart });
    console.log(changed ? 'Discord now loads the build; a background agent reapplies it after Discord updates.' : 'Already up to date.');

    if (options.restartDiscord) {
      try { execFileSync('osascript', ['-e', 'tell application "Discord" to quit'], { stdio: 'ignore' }); } catch { /* not running */ }
      execFileSync('sleep', ['5']);
      execFileSync('open', ['-a', 'Discord']);
    } else console.log('\nQuit and reopen Discord to finish.');
    console.log('Open Enhanced Presence → Settings from the menu bar, review your allowed apps, then press Resume. The plugin is enabled by default on fresh installs.');
  } finally { terminal?.close(); }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main().catch(error => { console.error(error.message); process.exitCode = 1; });
