import { readFileSync, existsSync, watch, lstatSync, writeFileSync, renameSync, rmSync } from 'node:fs';
import { dirname, join, basename } from 'node:path';
import { spawn } from 'node:child_process';
import { createInterface } from 'node:readline';
import { fileURLToPath } from 'node:url';
import { PresenceEngine, publicActivity } from './engine.mjs';
import { validateConfig, profiles, inQuietHours } from './profiles.mjs';
import { resolveProvider } from './resolve.mjs';
import { message } from '../shared/protocol.mjs';
import { DiscordRPC } from './rpc.mjs';
import { PresenceBridge } from './websocket.mjs';
import { UsageTracker } from './usage.mjs';
import { createMusicGapSuppressor, createMusicProvider, selectMusicActivity } from './music.mjs';
import { clearLocalPlayback, readLocalPlayerEnabled, writeLocalPlayback } from './local-music.mjs';
import { OutputController } from './output.mjs';
import { readPower, saverActive, musicSuspended } from './power.mjs';
import { startSettingsServer } from './settings-server.mjs';

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
const bridgeConfig = useVencord ? JSON.parse(readFileSync(option('--bridge-config'), 'utf8')) : null;
// With a saved application ID the engine can publish through Discord's local IPC when the Vencord plugin is not connected.
const rpc = publish ? new DiscordRPC(option('--application-id')) : (/^\d{17,20}$/.test(bridgeConfig?.applicationId ?? '') ? new DiscordRPC(bridgeConfig.applicationId) : null);
const bridge = useVencord ? new PresenceBridge(bridgeConfig.token, option('--bridge-port') ? { port: Number(option('--bridge-port')) } : {}) : null;
if (bridge) await bridge.start();
const output = useVencord ? new OutputController({ bridge, rpc, mode: () => engine.config.output }) : null;
let last = undefined, lastInput = Date.now(), busy = false, queued = undefined, stopping = false;
let latest, child, source, deadline, configWatcher, reloadTimer, musicReloadTimer, statusKey, lastStatus = 0, currentActivity = null;
let musicStatus = { available: false };
let localMusicEnabled = false;
const musicGapSuppressor = createMusicGapSuppressor();
let musicGapTimer;
function clearMusicGap() {
  musicGapSuppressor.clear();
  clearTimeout(musicGapTimer);
  musicGapTimer = undefined;
}
function beginMusicGap() {
  if (currentActivity?.kind !== 'music' || !engine.config.enabled || !engine.config.music.enabled || engine.config.music.priority !== 'music') return;
  if (musicGapTimer) return;
  musicGapSuppressor.begin();
  musicGapTimer = setTimeout(() => {
    musicGapTimer = undefined;
    musicGapSuppressor.clear();
    void receive(currentSnapshot(), false);
  }, 2000);
  musicGapTimer.unref?.();
}
const music = createMusicProvider({
  onChange: value => {
    if (value) clearMusicGap();
    else beginMusicGap();
    if (latest) void receive(currentSnapshot(), false);
  },
  onPlayback: playback => {
    if (!root) return;
    try { if (localMusicEnabled && playback) writeLocalPlayback(root, playback); else clearLocalPlayback(root); }
    catch { /* Local playback details are optional; public presence remains independent. */ }
  },
  onStatus: status => {
    musicStatus = { available: !['error', 'stopped'].includes(status.state), ...(status.reason ? { error: status.reason } : {}) };
    if (['error', 'stopped'].includes(status.state)) clearMusicGap();
    if (latest) void receive(currentSnapshot(), false);
  }
});
function currentSnapshot() {
  if (!latest || typeof latest !== 'object') return latest;
  return { ...latest, idleSeconds: latest.idleSeconds + (Date.now() - lastInput) / 1000 };
}
function selectedActivity(activity, snapshot) {
  const allowedActivity = publicActivity(activity, engine.config);
  const quietHours = inQuietHours(engine.config.quietHours, new Date());
  if (musicGapSuppressor.shouldSuppress({ activity: allowedActivity, activityAllowed: !!allowedActivity,
    config: engine.config, snapshot, quietHours })) return null;
  if (musicGapTimer) clearMusicGap();
  return selectMusicActivity(allowedActivity, music.current, engine.config, snapshot?.appId, snapshot, quietHours);
}
function track(action, ...values) {
  try { return usage?.[action](...values); }
  catch { usageError = 'App time data could not be saved. Existing totals were preserved.'; usage = null; }
}
function saveStatus(force = false) {
  if (!root || !args.includes('--detect')) return;
  const pending = engine.pending ? { appId: engine.pending.id, appName: engine.config.profiles[engine.pending.id]?.name || profiles[engine.pending.id]?.[0] || 'App', since: engine.pending.start, dueAt: engine.pending.dueAt } : null;
  const activity = currentActivity && { appId: currentActivity.appId, appName: currentActivity.appName, details: currentActivity.details };
  const state = { activity, pending, music: musicStatus, perf: { ...perf, saver, selfProtect, source: output?.source ?? 'none', ...(power ?? {}) }, usage: track('summary') || {}, ...(usageError ? { usageError } : {}) };
  const key = JSON.stringify({ activity, pending, music: musicStatus, saver, source: output?.source });
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
  currentActivity = activity;
  const serialized = JSON.stringify(message(activity));
  if (serialized === last) return;
  if (!args.includes('--quiet')) console.log(serialized);
  last = serialized;
  if (output) output.update(activity); else { rpc?.update(activity); bridge?.update(activity); }
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
// Automatic battery saving pauses AI work; explicit saving and CPU protection also stop Music.
let power = null, saver = false, selfProtect = false, perf = { cpuPercent: 0, rssMB: 0 }, busyMinutes = 0, lastCpu = process.cpuUsage(), lastSample = Date.now();
function applyMusic() {
  if (args.includes('--detect') && !musicSuspended(engine.config.power.saver, selfProtect) && (localMusicEnabled || (engine.config.enabled && engine.config.music.enabled))) music.start(); else music.stop();
}
async function sample() {
  power = await readPower();
  const now = Date.now(), cpu = process.cpuUsage(lastCpu), seconds = (now - lastSample) / 1000;
  perf = { cpuPercent: Math.round((cpu.user + cpu.system) / 1e4 / seconds) / 100, rssMB: Math.round(process.memoryUsage().rss / 1048576) };
  lastCpu = process.cpuUsage(); lastSample = now;
  busyMinutes = perf.cpuPercent > 3 ? busyMinutes + 1 : 0;
  if (busyMinutes >= 2) selfProtect = true;
  const next = saverActive(engine.config.power.saver, power) || selfProtect;
  if (next !== saver) { saver = next; engine.powerSaver = saver; saveStatus(true); }
  applyMusic();
}
const sampler = setInterval(() => void sample(), 60000);
function reloadConfig() {
  try {
    if (configPath) {
      const stat = lstatSync(configPath);
      if (!stat.isFile() || stat.isSymbolicLink() || stat.size > 131072 || (stat.mode & 0o777) !== 0o600 || stat.uid !== process.getuid()) throw Error();
    }
    engine.config = validateConfig(configPath ? JSON.parse(readFileSync(configPath, 'utf8')) : {});
  } catch { engine.config = validateConfig({ enabled: false }); }
  localMusicEnabled = Boolean(root && readLocalPlayerEnabled(root));
  if (!localMusicEnabled) { try { clearLocalPlayback(root); } catch { /* A malformed private file is left untouched. */ } }
  applyMusic();
  child?.kill('SIGUSR1');
  if (latest !== undefined) void receive(currentSnapshot(), false);
}
reloadConfig();
void sample();
const settings = args.includes('--settings') && root ? await startSettingsServer({ root, ...(option('--settings-port') ? { port: Number(option('--settings-port')) } : {}) }).catch(() => null) : null;
if (configPath) configWatcher = watch(dirname(configPath), (_event, file) => {
  const name = file?.toString();
  if (name === 'music.local.settings.json') {
    clearTimeout(musicReloadTimer);
    musicReloadTimer = setTimeout(() => {
      localMusicEnabled = readLocalPlayerEnabled(root);
      if (!localMusicEnabled) { try { clearLocalPlayback(root); } catch { /* Leave malformed private state untouched. */ } }
      applyMusic();
    }, 30);
    return;
  }
  if (name && name !== basename(configPath)) return;
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
if (publish) rpc.start();
const watchdog = setInterval(() => {
  if (Date.now() - lastInput >= 45000) { engine.session = null; engine.pending = null; track('suspend', lastInput); emit(null); }
  track('flush'); output?.update(); saveStatus();
}, 15000);
async function shutdown(code = 0) {
  if (stopping) return;
  stopping = true; clearMusicGap(); clearInterval(watchdog); clearTimeout(deadline); clearTimeout(reloadTimer); clearTimeout(musicReloadTimer); configWatcher?.close(); music.stop(); lines.close(); child?.kill();
  track('suspend'); emit(null); saveStatus(true);
  clearInterval(sampler); settings?.close(); if (output) await output.stop(); else { await rpc?.stop(); await bridge?.stop(); } process.exit(code);
}
process.on('SIGINT', () => shutdown());
process.on('SIGTERM', () => shutdown());
if (!child) lines.on('close', async () => {
  while (busy) await new Promise(r => setTimeout(r, 10));
  shutdown();
});
