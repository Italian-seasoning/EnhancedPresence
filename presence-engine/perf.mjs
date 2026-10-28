import { execFile } from 'node:child_process';

// Resource use of Enhanced Presence's own processes, measured from cumulative CPU time so a short
// window gives a true average (ps's instantaneous %CPU is a decayed lifetime figure).
const ours = /presence-engine\/main\.mjs|build\/detector|EnhancedPresenceHelper|mediaremote/i;

export function parseCpuTime(text) {
  const match = /^(?:(\d+)-)?(?:(\d+):)?(\d+):(\d+(?:\.\d+)?)$/.exec(text.trim());
  if (!match) return NaN;
  const [, days = 0, hours = 0, minutes, seconds] = match;
  return ((Number(days) * 24 + Number(hours)) * 60 + Number(minutes)) * 60 + Number(seconds);
}

export function parsePs(output) {
  return output.split('\n').flatMap(line => {
    const m = /^\s*(\d+)\s+(\d+)\s+(\S+)\s+(.*)$/.exec(line);
    if (!m || !ours.test(m[4])) return [];
    const cpu = parseCpuTime(m[3]);
    return Number.isFinite(cpu) ? [{ pid: Number(m[1]), rssMB: Number(m[2]) / 1024, cpuSeconds: cpu, command: m[4].split('/').pop().slice(0, 40) }] : [];
  });
}

const snapshot = () => new Promise(resolve => execFile('/bin/ps', ['-axo', 'pid=,rss=,time=,command='], { maxBuffer: 4 << 20, timeout: 5000 }, (error, stdout) => resolve(error ? [] : parsePs(stdout))));

// Averages CPU over `ms` and reports total memory.
export async function measure(ms = 3000) {
  const first = await snapshot(), started = Date.now();
  await new Promise(resolve => setTimeout(resolve, ms));
  const second = await snapshot(), seconds = (Date.now() - started) / 1000;
  const before = new Map(first.map(p => [p.pid, p.cpuSeconds]));
  const processes = second.map(p => ({ ...p, cpuPercent: before.has(p.pid) ? Math.max(0, (p.cpuSeconds - before.get(p.pid)) / seconds * 100) : 0 }));
  return { processes, cpuPercent: processes.reduce((sum, p) => sum + p.cpuPercent, 0), rssMB: processes.reduce((sum, p) => sum + p.rssMB, 0) };
}

// Limits for a background utility: it should be close to idle.
export const limits = { cpuPercent: 2, rssMB: 250 };
