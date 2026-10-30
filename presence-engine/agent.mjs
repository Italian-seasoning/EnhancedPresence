import { closeSync, fstatSync, openSync, readFileSync, readSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

// Coding-agent activity without any model calls. The hook (agent-hook.sh) appends one line
// per event; a fixed phrase table turns the recent categories into an accurate status.
export const agentDir = process.env.EP_AGENT_DIR || join(homedir(), 'Library', 'Application Support', 'EnhancedPresence');
const WINDOW = 12, STALE_MS = 15 * 60_000;

export function phrase(events = []) {
  const recent = events.slice(-5);
  const failed = recent.some(e => e.f && (e.c === 'test' || e.c === 'build'));
  const count = c => events.filter(e => e.c === c).length;
  if (failed && recent.some(e => e.c === 'edit')) return 'Squashing bugs';
  if (failed) return 'Chasing a failing ' + (recent.findLast(e => e.f).c === 'test' ? 'test' : 'build');
  const last = events.at(-1)?.c;
  if (last === 'test') return 'Running tests';
  if (last === 'build') return 'Building the project';
  if (last === 'git') return 'Working with Git';
  if (last === 'install') return 'Installing dependencies';
  if (last === 'delegate') return 'Coordinating agents';
  if (last === 'research') return 'Researching';
  if (last === 'edit') return 'Editing code';
  if (last === 'read') return 'Reviewing code';
  if (count('edit') >= 3) return 'Writing code';
  if (count('read') > count('edit') && count('read') >= 3) return 'Reading the codebase';
  return events.length ? 'Working on code' : 'Thinking';
}

// Reads only the last few KB of the log, so a task that runs for days stays cheap.
function tail(path, bytes = 2048) {
  const fd = openSync(path, 'r');
  try {
    const size = fstatSync(fd).size, length = Math.min(size, bytes), buffer = Buffer.alloc(length);
    readSync(fd, buffer, 0, length, size - length);
    return buffer.toString('utf8');
  } finally { closeSync(fd); }
}

// Returns {details, state?, startTimestamp, categories} for an active, fresh task; otherwise null.
export function agentActivity(config = {}, now = Date.now(), dir = agentDir) {
  if (config.enabled === false) return null;
  try {
    const [start, ...rest] = readFileSync(join(dir, 'agent-task'), 'utf8').trim().split(' ');
    const lines = tail(join(dir, 'agent-events.log')).split('\n').filter(Boolean).slice(-WINDOW - 1)
      .map(line => line.split(' ')).filter(p => /^\d+$/.test(p[0]) && p.length === 3);
    const last = lines.at(-1);
    const updated = Math.max(Number(start), last ? Number(last[0]) : 0) * 1000;
    if (!/^\d+$/.test(start) || last?.[1] === 'stop' || now - updated > STALE_MS) return null;
    const events = lines.filter(p => p[1] !== 'stop').slice(-WINDOW).map(p => ({ c: p[1], f: p[2] === '1' }));
    const project = rest.join(' ');
    const result = { details: phrase(events), startTimestamp: Number(start), categories: events.map(e => e.c) };
    // Project name is opt-in and limited to a plain folder name.
    if (config.showProject && /^[\w .-]{1,40}$/.test(project)) result.state = `Project: ${project}`;
    return result;
  } catch { return null; }
}
