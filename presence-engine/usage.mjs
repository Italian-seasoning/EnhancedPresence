import { foregroundProfile } from './profiles.mjs';
import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';

const localDate = time => {
  const d = new Date(time);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

export class UsageTracker {
  constructor({ root, clock = Date.now }) {
    this.root = root;
    this.clock = clock;
    this.totals = Object.create(null);
    this.days = Object.create(null);
    this.active = null;
    this.dirty = false;
    this.lastFlush = -Infinity;
    this.file = path.join(root, 'usage.local.json');
    try {
      const stored = JSON.parse(fs.readFileSync(this.file, 'utf8'));
      const record = value => value && typeof value === 'object' && !Array.isArray(value);
      const durations = value => record(value) && Object.entries(value).every(([id, duration]) => /^[\w.-]{1,200}$/.test(id) && Number.isFinite(duration) && duration >= 0 && duration <= Number.MAX_SAFE_INTEGER);
      if (stored.version !== 1 || !durations(stored.totals) || !record(stored.days) || !Object.entries(stored.days).every(([day, totals]) => /^\d{4}-\d{2}-\d{2}$/.test(day) && durations(totals))) throw Error('Invalid local usage data');
      this.totals = Object.assign(Object.create(null), stored.totals);
      this.days = Object.fromEntries(Object.entries(stored.days).map(([day, totals]) => [day, Object.assign(Object.create(null), totals)]));
    } catch (error) {
      if (error.code !== 'ENOENT') throw Error('Cannot load local usage data', { cause: error });
    }
  }
  accrue(now) {
    if (this.active) now = Math.min(now, this.active.idleUntil, this.active.observedAt + 45000);
    if (!this.active || now <= this.active.last) return;
    const elapsed = now - this.active.last;
    const id = this.active.id;
    this.totals[id] = (this.totals[id] || 0) + elapsed;
    for (let cursor = this.active.last; cursor < now;) {
      const midnight = new Date(cursor);
      midnight.setHours(24, 0, 0, 0);
      const end = Math.min(now, midnight.getTime());
      const day = this.days[localDate(cursor)] ||= Object.create(null);
      day[id] = (day[id] || 0) + end - cursor;
      cursor = end;
    }
    this.active.session += elapsed;
    this.active.last = now;
    this.dirty = true;
  }
  observe(snapshot, config, now = this.clock()) {
    const previous = this.active;
    const idleUntil = Number.isFinite(snapshot?.idleSeconds) ? now + (config.idleSeconds - snapshot.idleSeconds) * 1000 : now;
    this.accrue(Math.min(now, idleUntil));
    const profile = config.trackingEnabled && foregroundProfile(snapshot, config);
    if (!profile) this.active = null;
    else {
      if (this.active?.id !== snapshot.appId || this.active?.pid !== snapshot.pid) this.active = { id: snapshot.appId, pid: snapshot.pid, session: 0, last: now };
      this.active.last = now;
      this.active.idleUntil = idleUntil;
      this.active.observedAt = now;
    }
    this.flush(now, previous !== null && previous !== this.active);
  }
  summary(now = this.clock()) {
    this.accrue(now);
    const today = this.days[localDate(now)] || {};
    return Object.fromEntries(Object.entries(this.totals).map(([id, total]) => [id, { todaySeconds: (today[id] || 0) / 1000, totalSeconds: total / 1000, sessionSeconds: this.active?.id === id ? this.active.session / 1000 : 0 }]));
  }
  flush(now = this.clock(), force = false) {
    this.accrue(now);
    if (!this.dirty || (!force && now - this.lastFlush < 60000)) return false;
    fs.mkdirSync(this.root, { recursive: true, mode: 0o700 });
    const temp = path.join(this.root, `.usage-${randomUUID()}.tmp`);
    try {
      fs.writeFileSync(temp, JSON.stringify({ version: 1, totals: this.totals, days: this.days }) + '\n', { mode: 0o600, flag: 'wx' });
      fs.renameSync(temp, this.file);
      this.lastFlush = now;
      this.dirty = false;
      return true;
    } finally {
      fs.rmSync(temp, { force: true });
    }
  }
  suspend(now = this.clock()) {
    this.accrue(now);
    this.active = null;
    this.flush(now, true);
  }
}
