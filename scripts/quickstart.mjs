import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createInterface } from 'node:readline/promises';
import { installPlugin } from './install-vencord.mjs';
import { deploy } from './vencord-deploy.mjs';

// --standalone skips Vencord entirely and publishes through Discord's local connection (text only, nothing patched).
// One command: npm run quickstart -- --application-id ID [--vencord DIR] [--accept-terms] [--restart-discord]
// Builds everything, installs the companion, helper app and agent hooks, builds Vencord with the plugin,
// and applies it to Discord without the interactive Vencord installer.
const VENCORD_REV = '7f0c10cc29fd789f2f4828ae3dc947623e837920'; // Vencord revision this plugin is tested against
const args = process.argv.slice(2);
const option = key => { const i = args.indexOf(key); return i < 0 ? undefined : args[i + 1]; };
const resources = option('--discord-resources') ?? '/Applications/Discord.app/Contents/Resources', start = !args.includes('--no-start'); // the last two are for testing
const root = fileURLToPath(new URL('..', import.meta.url));
const run = (command, argv, cwd = root) => execFileSync(command, argv, { cwd, stdio: 'inherit' });
const step = text => console.log(`\n==> ${text}`);

if (process.platform !== 'darwin') throw Error('Enhanced Presence currently supports macOS only.');
if (Number(process.versions.node.split('.')[0]) < 22) throw Error('Node.js 22 or newer is required.');
const missing = ['swiftc', 'git', 'pnpm', 'cmake', 'xcodebuild'].filter(tool => { try { execFileSync('which', [tool], { stdio: 'ignore' }); return false; } catch { return true; } });
if (missing.length) throw Error(`Install these first: ${missing.join(', ')} (Xcode command-line tools: xcode-select --install; others via Homebrew).`);
if (!existsSync(resources)) throw Error('Discord.app was not found in /Applications.');

const terminal = createInterface({ input: process.stdin, output: process.stdout });
if (!args.includes('--accept-terms')) {
  console.log("Enhanced Presence modifies the Discord client through Vencord, which is against Discord's Terms of Service, and is provided without warranty. You use it at your own risk. Read TERMS.md first.");
  if ((await terminal.question('Type "yes" to accept the Terms of Use: ')).trim().toLowerCase() !== 'yes') { console.error('Terms not accepted; nothing was installed.'); process.exit(1); }
}
let applicationId = option('--application-id');
if (!applicationId && !existsSync(join(homedir(), 'Library', 'Application Support', 'EnhancedPresence', 'bridge.local.json'))) {
  applicationId = (await terminal.question('Discord Application ID (numbers only, from the Developer Portal; never a token): ')).trim();
}
terminal.close();
if (applicationId && !/^\d{17,20}$/.test(applicationId)) throw Error('The Application ID must be 17 to 20 digits.');

step('Building the app detector and music adapter');
run('npm', ['run', 'build:detector']);
run('npm', ['run', 'build:music']);

step('Installing the companion, helper app and agent hooks');
run('node', ['presence-engine/install.mjs', ...(applicationId ? [applicationId] : []), '--helper', '--accept-terms', ...(args.includes('--standalone') ? ['--standalone'] : []), ...(start ? [] : ['--no-start'])]);

if (args.includes('--standalone')) {
  console.log('\nStandalone mode: Discord is not modified. Open Discord, then use the menu bar icon > Settings… and press Resume sharing.');
  process.exit(0);
}
step('Preparing Vencord');
const checkout = option('--vencord') ?? join(homedir(), 'Library', 'Application Support', 'EnhancedPresence', 'vencord-src');
if (!existsSync(join(checkout, 'package.json'))) {
  mkdirSync(checkout, { recursive: true });
  run('git', ['init', '-q'], checkout);
  run('git', ['remote', 'add', 'origin', 'https://github.com/Vendicated/Vencord.git'], checkout); // the Vencord build reads it
  run('git', ['fetch', '--depth', '1', 'origin', VENCORD_REV], checkout);
  run('git', ['checkout', '-q', 'FETCH_HEAD'], checkout);
}
console.log(installPlugin(checkout));
run('pnpm', ['install', '--frozen-lockfile'], checkout);
run('pnpm', ['build', '--disable-updater'], checkout);

step('Applying the build to Discord');
const { changed } = await deploy(checkout, { resources, start });
console.log(changed ? 'Discord now loads the build; a background agent keeps it applied after Discord updates.' : 'Already up to date.');

if (args.includes('--restart-discord')) {
  try { execFileSync('osascript', ['-e', 'tell application "Discord" to quit'], { stdio: 'ignore' }); } catch { /* not running */ }
  execFileSync('sleep', ['5']);
  execFileSync('open', ['-a', 'Discord']);
} else console.log('\nQuit and reopen Discord to finish.');
console.log('Then open Settings → Vencord → Plugins → EnhancedPresenceUniversal and press Resume.');
