import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, statSync } from 'node:fs';
import { createConnection } from 'node:net';
import { homedir } from 'node:os';
import { limits, measure } from './perf.mjs';
import { readPower } from './power.mjs';
import { join } from 'node:path';
import { readRuntimeStatus } from './controls.mjs';

// Read-only health checks for the whole installation. Never prints keys, settings values or file contents.
const read = path => { try { return readFileSync(path, 'utf8'); } catch { return ''; } };
const has = tool => { try { execFileSync('which', [tool], { stdio: 'ignore' }); return true; } catch { return false; } };
const loaded = label => { try { execFileSync('launchctl', ['print', `gui/${process.getuid()}/${label}`], { stdio: 'ignore' }); return true; } catch { return false; } };
const listening = port => new Promise(resolve => {
  const socket = createConnection({ port, host: '127.0.0.1' }, () => { socket.destroy(); resolve(true); });
  socket.on('error', () => resolve(false)); socket.setTimeout(1000, () => { socket.destroy(); resolve(false); });
});

export async function diagnose({ home = homedir(), resources = '/Applications/Discord.app/Contents/Resources', perf = false } = {}) {
  const root = join(home, 'Library', 'Application Support', 'EnhancedPresence');
  const checks = [];
  const add = (name, ok, fix) => checks.push({ name, ok: Boolean(ok), ...(ok ? {} : { fix }) });
  add('Companion service is running', loaded('app.enhancedpresence.engine'), 'npm run install:companion');
  add('Bridge is accepting connections on 127.0.0.1:43821', await listening(43821), 'Start the service: npm run install:companion');
  add('Helper app is installed', existsSync(join(home, 'Applications', 'EnhancedPresence Helper.app')), 'npm run install:companion -- --helper');
  add('Settings app is reachable (menu bar icon > Settings…, or npm run settings)', await listening(43822), 'Restart the service: npm run install:companion');
  const standalone = /"output":\s*"ipc"/.test(read(join(root, 'config.local.json')));
  if (!standalone) {
    add('Discord is patched to load Vencord', read(join(resources, 'app.asar')).includes('Vencord/dist/patcher.js'), 'npm run quickstart, then quit and reopen Discord.');
    add('Plugin is in the installed Vencord build', read(join(home, 'Library', 'Application Support', 'Vencord', 'dist', 'renderer.js')).includes('EnhancedPresenceUniversal'), 'npm run quickstart');
    add('Vencord repair agent is running (re-applies after Discord updates)', loaded('app.enhancedpresence.vencord-repair'), 'npm run quickstart');
    let runtime, enabled = true;
    try { runtime = readRuntimeStatus(root); enabled = JSON.parse(read(join(root, 'config.local.json'))).enabled !== false; } catch { /* Report unavailable connection below. */ }
    add(enabled ? 'Vencord plugin is connected' : 'Sharing is paused', !enabled || (runtime && !runtime.stale && runtime.perf?.source === 'vencord'), 'Open Discord, enable EnhancedPresenceUniversal in Vencord Plugins, press Resume, then wait 15 seconds.');
  }
  add('Activity detector is built', existsSync(join(root, 'build', 'detector')), 'npm run build:detector && npm run install:companion');
  const settings = join(root, 'config.local.json');
  add('Settings file is private (mode 600)', existsSync(settings) && (statSync(settings).mode & 0o077) === 0, `chmod 600 "${settings}"`);
  const config = read(settings);
  if (/"provider":\s*"haiku"/.test(config)) add('claude command is available for Haiku wording', has('claude'), 'Install Claude Code or set the provider to off');
  if (/"provider":\s*"luna"/.test(config)) add('codex command is available for Luna wording', has('codex'), 'Install Codex or set the provider to off');
  if (perf) {
    // Averaged over a few seconds of cumulative CPU time; a background utility should be nearly idle.
    const use = await measure(3000), power = await readPower();
    add(`Companion CPU use is low (${use.cpuPercent.toFixed(2)}% across ${use.processes.length} processes)`, use.processes.length > 0 && use.cpuPercent < limits.cpuPercent, 'Open Settings > Output and power, turn Battery saver on, and report this in an issue');
    add(`Companion memory is modest (${Math.round(use.rssMB)} MB)`, use.rssMB < limits.rssMB, 'Restart the service: launchctl kickstart -k gui/$(id -u)/app.enhancedpresence.engine');
    checks.info = `Power: ${power.onBattery ? `battery${power.percent === null ? '' : ` ${power.percent}%`}` : 'plugged in'}${power.lowPower ? ', Low Power Mode' : ''}`;
  }
  return checks;
}
