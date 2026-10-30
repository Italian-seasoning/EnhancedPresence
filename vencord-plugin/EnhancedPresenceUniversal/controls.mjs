// GPL-3.0-or-later. Native-only, bounded settings operations for the companion.
import { lstatSync, readFileSync, writeFileSync, renameSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { profiles, blocked, nameApps, validateConfig } from './profiles.mjs';

function load(root) {
  const file = join(root, 'config.local.json');
  const stat = lstatSync(file);
  if (!stat.isFile() || stat.size > 131072 || (process.platform !== 'win32' && ((stat.mode & 0o077) !== 0 || stat.uid !== process.getuid?.()))) throw Error('Private companion settings unavailable');
  return validateConfig(JSON.parse(readFileSync(file, 'utf8')));
}
function save(root, config) {
  const temporary = join(root, `.controls-${randomUUID()}.tmp`);
  try {
    writeFileSync(temporary, JSON.stringify(validateConfig(config), null, 2) + '\n', { flag: 'wx', mode: 0o600 });
    renameSync(temporary, join(root, 'config.local.json'));
  } finally {
    try { unlinkSync(temporary); } catch { /* Already renamed, or not created. */ }
  }
}
function readPrivate(root, name, limit = 262144) {
  const file = join(root, name);
  let stat;
  try { stat = lstatSync(file); } catch (error) { if (error.code === 'ENOENT') return null; throw error; }
  if (!stat.isFile() || stat.size > limit || (process.platform !== 'win32' && ((stat.mode & 0o077) !== 0 || stat.uid !== process.getuid?.()))) throw Error('Private companion status unavailable');
  return JSON.parse(readFileSync(file, 'utf8'));
}
const validText = value => typeof value === 'string' && value.length > 0 && value.length <= 128 && !/[\x00-\x1f]/.test(value);
const validSeconds = value => Number.isFinite(value) && value >= 0 && value <= Number.MAX_SAFE_INTEGER;
export function readRuntimeStatus(root, now = Date.now()) {
  const c = load(root);
  const allowed = id => c.allowlist.includes(id) && !c.denylist.includes(id) && !blocked.has(id);
  let persisted, usageError;
  try { persisted = readPrivate(root, 'usage.local.json'); } catch { usageError = 'App time data could not be loaded. Existing totals were preserved.'; }
  const usage = {};
  try { if (persisted) {
    if (persisted.version !== 1 || !persisted.totals || !persisted.days) throw Error('Invalid local usage totals');
    const date = new Date(now);
    const day = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
    for (const [id, total] of Object.entries(persisted.totals)) {
      if (!allowed(id)) continue;
      const today = persisted.days[day]?.[id] ?? 0;
      if (!validSeconds(total) || !validSeconds(today)) throw Error('Invalid local usage totals');
      usage[id] = { todaySeconds: today / 1000, totalSeconds: total / 1000, sessionSeconds: 0 };
    }
  } } catch { usageError = 'App time data could not be loaded. Existing totals were preserved.'; }
  const raw = readPrivate(root, 'status.local.json');
  const result = { activity: null, pending: null, music: { available: false, error: 'Companion status unavailable' }, updatedAt: 0, stale: true, usage };
  if (usageError) result.usageError = usageError;
  if (!raw) return result;
  if (!Number.isSafeInteger(raw.updatedAt) || raw.updatedAt <= 0 || raw.updatedAt > now + 60000 || !raw.music || typeof raw.music.available !== 'boolean') throw Error('Invalid companion status');
  result.updatedAt = raw.updatedAt; result.stale = now - raw.updatedAt > 90000;
  if (c.enabled && !result.stale && raw.activity && allowed(raw.activity.appId)) {
    const a = raw.activity;
    if (!validText(a.appName) || !validText(a.details)) throw Error('Invalid current activity');
    result.activity = { appId: a.appId, appName: a.appName, details: a.details };
  }
  result.music = { available: raw.music.available };
  if (raw.music.source !== undefined) {
    if (!validText(raw.music.source) || !/^[\w.-]+$/.test(raw.music.source)) throw Error('Invalid music status');
    result.music.source = raw.music.source;
  }
  if (raw.music.error !== undefined) {
    if (!validText(raw.music.error)) throw Error('Invalid music status');
    result.music.error = raw.music.error;
  }
  if (raw.perf && typeof raw.perf === 'object') {
    const p = raw.perf, num = x => Number.isFinite(x) && x >= 0 && x < 1e6;
    if (num(p.cpuPercent) && num(p.rssMB)) result.perf = {
      cpuPercent: p.cpuPercent, rssMB: p.rssMB, saver: p.saver === true, selfProtect: p.selfProtect === true, onBattery: p.onBattery === true, lowPower: p.lowPower === true,
      percent: Number.isInteger(p.percent) && p.percent >= 0 && p.percent <= 100 ? p.percent : null, source: ['vencord', 'ipc', 'none'].includes(p.source) ? p.source : 'none'
    };
  }
  if (raw.usageError !== undefined) {
    if (!validText(raw.usageError)) throw Error('Invalid usage status');
    result.usageError = raw.usageError;
  }
  if (raw.pending && allowed(raw.pending.appId)) {
    const p = raw.pending;
    if (!validText(p.appName) || !Number.isSafeInteger(p.since) || !Number.isSafeInteger(p.dueAt) || p.since <= 0 || p.dueAt < p.since || p.dueAt - p.since > 300000) throw Error('Invalid pending app');
    result.pending = { appId: p.appId, appName: p.appName, since: p.since, dueAt: p.dueAt };
  }
  if (!result.stale && raw.usage && typeof raw.usage === 'object' && !Array.isArray(raw.usage)) for (const [id, times] of Object.entries(raw.usage)) {
    if (!allowed(id)) continue;
    if (!times || !['todaySeconds', 'totalSeconds', 'sessionSeconds'].every(key => validSeconds(times[key]))) throw Error('Invalid runtime usage totals');
    result.usage[id] = { todaySeconds: times.todaySeconds, totalSeconds: times.totalSeconds, sessionSeconds: times.sessionSeconds };
  }
  return result;
}
export function readControls(root) {
  const c = load(root);
  let usage = {}, usageError;
  try { const runtime = readRuntimeStatus(root); usage = runtime.usage; usageError = runtime.usageError; }
  catch { usageError = 'App time status is unavailable. Companion settings still work.'; }
  let namesAvailable = false;
  try {
    const path = join(root, 'metadata.status.json');
    const stat = lstatSync(path);
    if (stat.isFile() && stat.size < 128 && (process.platform === 'win32' || ((stat.mode & 0o077) === 0 && stat.uid === process.getuid?.()))) namesAvailable = JSON.parse(readFileSync(path, 'utf8')).namesAvailable === true;
  } catch { /* The companion has not reported access yet. */ }
  const privateNames = { 'com.apple.MobileSMS': 'Messages', 'com.apple.mail': 'Mail', 'com.apple.Photos': 'Photos', 'com.apple.Passwords': 'Passwords', 'com.apple.FaceTime': 'FaceTime', 'com.hnc.Discord': 'Discord', 'com.hnc.DiscordCanary': 'Discord Canary', 'com.hnc.DiscordPTB': 'Discord PTB', 'dev.vencord.Vesktop': 'Vesktop', 'com.agilebits.onepassword7': '1Password 7', 'com.1password.1password': '1Password', 'com.bitwarden.desktop': 'Bitwarden', 'org.keepassxc.keepassxc': 'KeePassXC' };
  const ids = [...new Set([...Object.keys(profiles), ...blocked, ...Object.keys(c.profiles), ...c.allowlist, ...c.denylist])];
  return {
    enabled: c.enabled, idleSeconds: c.idleSeconds, namesAvailable, agent: { provider: c.agent.ai.provider, intervalMinutes: c.agent.ai.intervalMinutes, showProject: c.agent.showProject },
    switchDelaySeconds: c.switchDelaySeconds, trackingEnabled: c.trackingEnabled, music: c.music,
    quietHours: c.quietHours, output: c.output, powerSaver: c.power.saver,
    usage, ...(usageError ? { usageError } : {}),
    apps: ids.map(id => {
      const base = profiles[id];
      const custom = c.profiles[id];
      return { id, name: privateNames[id] || custom?.name || base?.[0] || id, details: custom?.details || base?.[1] || '',
        visibility: blocked.has(id) || c.denylist.includes(id) ? 'blocked' : c.allowlist.includes(id) ? 'allowed' : 'hidden',
        protected: blocked.has(id), editable: Boolean(base || custom), custom: Boolean(custom),
        defaultName: base?.[0] || '', defaultDetails: base?.[1] || '',
        supportsName: nameApps.has(id), supportsContext: id === 'com.blackmagic-design.DaVinciResolve',
        showName: c.disclosure[id]?.showName === true, showContext: c.disclosure[id]?.showContext === true };
    }).sort((a, b) => a.name.localeCompare(b.name))
  };
}
export function updateApp(root, input) {
  const c = load(root);
  if (!input || typeof input.id !== 'string' || !/^[\w.-]{1,200}$/.test(input.id) || !['allowed', 'hidden', 'blocked'].includes(input.visibility)) throw Error('Invalid app setting');
  const { id, visibility } = input;
  if (input.showName !== undefined || input.showContext !== undefined) {
    if (!nameApps.has(id) || (input.showName !== undefined && typeof input.showName !== 'boolean') || (input.showContext !== undefined && (typeof input.showContext !== 'boolean' || (input.showContext && id !== 'com.blackmagic-design.DaVinciResolve')))) throw Error('Invalid name or workspace setting');
    c.disclosure[id] = { showName: false, showContext: false, ...c.disclosure[id], ...(input.showName !== undefined ? { showName: input.showName } : {}), ...(input.showContext !== undefined ? { showContext: input.showContext } : {}) };
  }
  if (blocked.has(id) && visibility !== 'blocked') throw Error('This app always stays private');
  if (visibility === 'allowed' && !Object.hasOwn(profiles, id) && !Object.hasOwn(c.profiles, id)) throw Error('App has no public profile');
  if (input.reset === true && Object.hasOwn(profiles, id)) delete c.profiles[id];
  else if (input.name !== undefined || input.details !== undefined) {
    if (blocked.has(id) || (!Object.hasOwn(profiles, id) && !Object.hasOwn(c.profiles, id))) throw Error('App is not editable');
    c.profiles[id] = { name: input.name, details: input.details };
  }
  c.allowlist = c.allowlist.filter(x => x !== id);
  c.denylist = c.denylist.filter(x => x !== id);
  if (visibility === 'allowed') c.allowlist.push(id);
  if (visibility === 'blocked') c.denylist.push(id);
  save(root, c);
  return readControls(root);
}
export function updateIdle(root, seconds) {
  if (![300, 600, 900, 1800].includes(seconds)) throw Error('Invalid idle duration');
  const c = load(root); c.idleSeconds = seconds; save(root, c); return readControls(root);
}
export function updateBehavior(root, input) {
  if (!input || typeof input !== 'object' || Array.isArray(input) || !Object.keys(input).length || Object.keys(input).some(key => !['enabled', 'switchDelaySeconds', 'trackingEnabled', 'music'].includes(key))) throw Error('Invalid behavior settings');
  if (input.enabled !== undefined && typeof input.enabled !== 'boolean') throw Error('Invalid sharing setting');
  if (input.trackingEnabled !== undefined && typeof input.trackingEnabled !== 'boolean') throw Error('Invalid tracking setting');
  if (input.switchDelaySeconds !== undefined && (!Number.isInteger(input.switchDelaySeconds) || input.switchDelaySeconds < 0 || input.switchDelaySeconds > 300)) throw Error('Invalid switch delay');
  const c = load(root);
  if (input.music !== undefined) {
    const music = input.music;
    if (!music || typeof music !== 'object' || Array.isArray(music) || Object.keys(music).some(key => !['enabled', 'sources', 'priority'].includes(key)) ||
      (music.enabled !== undefined && typeof music.enabled !== 'boolean') ||
      (music.priority !== undefined && !['music', 'app'].includes(music.priority)) ||
      (music.sources !== undefined && (!Array.isArray(music.sources) || music.sources.length > 1 || music.sources.some(source => source !== 'com.apple.Music')))) throw Error('Invalid music settings');
    c.music = { ...c.music, ...music };
  }
  for (const key of ['enabled', 'switchDelaySeconds', 'trackingEnabled']) if (input[key] !== undefined) c[key] = input[key];
  save(root, c);
  return readControls(root);
}
export function updateAgent(root, input) {
  if (!input || !['off', 'haiku', 'luna'].includes(input.provider) || !Number.isInteger(input.intervalMinutes) || typeof input.showProject !== 'boolean') throw Error('Invalid AI status setting');
  const c = load(root);
  c.agent = { ...c.agent, showProject: input.showProject, ai: { ...c.agent.ai, provider: input.provider, intervalMinutes: input.intervalMinutes } };
  save(root, c); return readControls(root);
}
export function updateGeneral(root, input) {
  const keys = ['quietHours', 'output', 'powerSaver'];
  if (!input || typeof input !== 'object' || Array.isArray(input) || !Object.keys(input).length || Object.keys(input).some(key => !keys.includes(key))) throw Error('Invalid setting');
  const c = load(root);
  if (input.quietHours !== undefined) c.quietHours = { ...c.quietHours, ...input.quietHours };
  if (input.output !== undefined) c.output = input.output;
  if (input.powerSaver !== undefined) c.power = { ...c.power, saver: input.powerSaver };
  save(root, c); // validation rejects bad values before anything is written
  return readControls(root);
}
