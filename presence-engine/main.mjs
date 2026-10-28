import { readFileSync, existsSync, watch, lstatSync, writeFileSync, renameSync, rmSync } from 'node:fs';
import { dirname, join, basename } from 'node:path';
import { spawn } from 'node:child_process';
import { createInterface } from 'node:readline';
import { fileURLToPath } from 'node:url';
import { PresenceEngine, isDiscord } from './engine.mjs';
import { validateConfig, foregroundProfile, profiles } from './profiles.mjs';
import { resolveProvider } from './resolve.mjs';
import { message } from '../shared/protocol.mjs';
import { DiscordRPC } from './rpc.mjs';
import { PresenceBridge } from './websocket.mjs';
import { UsageTracker } from './usage.mjs';
import { createMusicProvider, selectMusicActivity } from './music.mjs';

const args = process.argv.slice(2);
function option(key) { const i = args.indexOf(key); return i < 0 ? undefined : args[i + 1]; }
const publish = args.includes('--publish');
const useVencord = args.includes('--vencord');
if (useVencord && (!args.includes('--activation-approved') || !args.includes('--detect'))) throw Error('Vencord bridge requires explicit activation approval and native detection');
if (useVencord && publish) throw Error('Choose Vencord or direct IPC, not both');
if (publish && !args.includes('--activation-approved')) throw Error('Live publication requires explicit activation approval; use preview first');
if (publish && !args.includes('--detect')) throw Error('Publishing synthetic fixtures is disabled');
const configPath = option('--config');
const engine = new PresenceEngine({}, resolveProvider(option('--python')));
const root = configPath ? dirname(configPath) : null;
let usage = null, usageError;
try { if (root && args.includes('--detect')) usage = new UsageTracker({ root }); }
catch { usageError = 'App time data could not be loaded. Existing totals were preserved.'; }
const rpc = publish ? new DiscordRPC(option('--application-id')) : null;
const bridge = useVencord ? new PresenceBridge(JSON.parse(readFileSync(option('--bridge-config'), 'utf8')).token) : null;
if (bridge) await bridge.start();
let last = undefined, lastInput = Date.now(), busy = false, queued = undefined, stopping = false;
let latest, child, source, deadline, configWatcher, reloadTimer, statusKey, lastStatus = 0;
let musicStatus = { available: false };
const music = createMusicProvider({
  onChange: () => { if (latest) void receive(currentSnapshot(), false); },
  onStatus: status => {
    musicStatus = { available: !['error', 'stopped'].includes(status.state), ...(status.reason ? { error: status.reason } : {}) };
    if (latest) void receive(currentSnapshot(), false);
  }
});
function currentSnapshot() {
  if (!latest || typeof latest !== 'object') return latest;
  return { ...latest, idleSeconds: latest.idleSeconds + (Date.now() - lastInput) / 1000 };
}
function selectedActivity(activity, snapshot) {
  if (foregroundProfile(snapshot, engine.config) || (isDiscord(snapshot?.appId) && activity)) return selectMusicActivity(activity, music.current, engine.config, activity?.appId);
  return null;
}
function track(action, ...values) {
  try { return usage?.[action](...values); }
  catch { usageError = 'App time data could not be saved. Existing totals were preserved.'; usage = null; }
}
function saveStatus(force = false) {
  if (!root || !args.includes('--detect')) return;
  const pending = engine.pending ? { appId: engine.pending.id, appName: engine.config.profiles[engine.pending.id]?.name || profiles[engine.pending.id]?.[0] || 'App', since: engine.pending.start, dueAt: engine.pending.dueAt } : null;
  const state = { pending, music: musicStatus, usage: track('summary') || {}, ...(usageError ? { usageError } : {}) };
  const key = JSON.stringify({ pending, music: musicStatus });
  if (!force && key === statusKey && Date.now() - lastStatus < 60000) return;
  const path = join(root, 'status.local.json'), temp = `${path}.${process.pid}.tmp`;
  try {
    if (existsSync(path) && (!lstatSync(path).isFile() || lstatSync(path).isSymbolicLink())) throw Error();
    writeFileSync(temp, JSON.stringify({ ...state, updatedAt: Date.now() }), { mode: 0o600, flag: 'wx' });
    renameSync(temp, path); statusKey = key; lastStatus = Date.now();
  } catch { /* Status is advisory; publication and usage remain independent. */ }
  finally { try { rmSync(temp, { force: true }); } catch {} }
}
function emit(activity) {
  const serialized = JSON.stringify(message(activity));
  if (serialized === last) return;
  if (!args.includes('--quiet')) console.log(serialized);
  last = serialized; rpc?.update(activity); bridge?.update(activity);
}
async function receive(snapshot, fromDetector = true) {
  if (stopping) return;
  if (fromDetector) { latest = snapshot; lastInput = Date.now(); }
  queued = snapshot;
  if (busy) return;
  busy = true;
  try {
    while (queued !== undefined && !stopping) {
      const current = Date.now() - lastInput < 45000 ? queued : null; queued = undefined;
      try {
        track('observe', current, engine.config);
        const activity = await engine.update(current);
        // A newer activation or shutdown must not publish an old provider response.
        if (queued === undefined && !stopping && Date.now() - lastInput < 45000) emit(selectedActivity(activity, current));
        clearTimeout(deadline);
        const wait = engine.nextDeadline();
        if (wait !== null) deadline = setTimeout(() => void receive(currentSnapshot(), false), Math.max(1, wait));
        saveStatus();
      } catch { engine.session = null; track('suspend'); emit(null); console.error('Invalid settings or detector data; presence cleared'); }
    }
  } finally { busy = false; }
}
function reloadConfig() {
  try {
    if (configPath) {
      const stat = lstatSync(configPath);
      if (!stat.isFile() || stat.isSymbolicLink() || stat.size > 131072 || (stat.mode & 0o777) !== 0o600 || stat.uid !== process.getuid()) throw Error();
    }
    engine.config = validateConfig(configPath ? JSON.parse(readFileSync(configPath, 'utf8')) : {});
  } catch { engine.config = validateConfig({ enabled: false }); }
  if (args.includes('--detect') && engine.config.enabled && engine.config.music.enabled) music.start();
  else music.stop();
  child?.kill('SIGUSR1');
  if (latest !== undefined) void receive(currentSnapshot(), false);
}
reloadConfig();
if (configPath) configWatcher = watch(dirname(configPath), (_event, file) => {
  if (file && file.toString() !== basename(configPath)) return;
  clearTimeout(reloadTimer); reloadTimer = setTimeout(reloadConfig, 30);
});
emit(null);
if (args.includes('--detect')) {
  const binary = fileURLToPath(new URL('../build/detector', import.meta.url));
  if (!existsSync(binary)) throw Error('Run npm run build:detector first');
  child = spawn(binary, configPath ? ['--config', configPath] : [], { stdio: ['ignore', 'pipe', 'ignore'] });
  child.on('error', () => { emit(null); shutdown(1); });
  child.on('exit', () => { emit(null); shutdown(1); });
  source = child.stdout;
} else {
  // Fixtures are supplied by stdin; no native detection or Discord connection.
  source = process.stdin;
}
const lines = createInterface({ input: source });
lines.on('line', line => {
  try { if (line.length > 4096) throw Error(); receive(JSON.parse(line)); }
  catch { receive({}); }
});
rpc?.start();
const watchdog = setInterval(() => {
  if (Date.now() - lastInput >= 45000) { engine.session = null; engine.pending = null; track('suspend', lastInput); emit(null); }
  track('flush'); saveStatus();
}, 15000);
async function shutdown(code = 0) {
  if (stopping) return;
  stopping = true; clearInterval(watchdog); clearTimeout(deadline); clearTimeout(reloadTimer); configWatcher?.close(); music.stop(); lines.close(); child?.kill();
  track('suspend'); saveStatus(true);
  emit(null); await rpc?.stop(); await bridge?.stop(); process.exit(code);
}
process.on('SIGINT', () => shutdown());
process.on('SIGTERM', () => shutdown());
if (!child) lines.on('close', async () => {
  while (busy) await new Promise(r => setTimeout(r, 10));
  shutdown();
});
