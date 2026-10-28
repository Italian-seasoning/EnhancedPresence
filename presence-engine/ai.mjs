import { execFile } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// Optional flavor rewrite of the fixed status. The model sees only tool categories, the
// public app label and minutes elapsed: no prompts, paths, commands or project names.
// Runs at most once per interval, never blocks presence, and falls back to the fixed phrase.
export const providers = ['off', 'haiku', 'luna'];

export function command(ai, prompt, outFile) {
  // Cheapest settings: lowest effort, one turn, nothing persisted, no user config or hooks.
  if (ai.provider === 'haiku') return ['claude', ['-p', '--model', ai.model || 'haiku', '--effort', ai.effort || 'low', '--no-session-persistence', '--disable-slash-commands', prompt]];
  return ['codex', ['exec', '-m', ai.model || 'luna', '-c', `model_reasoning_effort="${ai.effort || 'low'}"`, '--ephemeral', '--skip-git-repo-check', '--ignore-user-config', '--ignore-rules', '-s', 'read-only', '-o', outFile, prompt]];
}

export function buildPrompt({ phrase, app, minutes, categories }) {
  return `Rewrite this developer status as a playful Discord presence line, 2-5 words, max 32 characters, no emoji, no quotes. Stay accurate to the facts. Reply with the line only.\nApp: ${app}\nCurrent status: ${phrase}\nRecent activity: ${categories.join(', ') || 'none'}\nTask running: ${minutes} min`;
}

export function clean(text) {
  const line = String(text ?? '').split('\n').map(x => x.trim()).find(Boolean)?.replace(/^["'“”`]+|["'“”`.]+$/g, '');
  return line && line.length >= 3 && line.length <= 40 && !/[\x00-\x1f\x7f/\\]|https?:|@/.test(line) ? line : undefined;
}

export class StatusWriter {
  constructor(run = defaultRun) { this.run = run; this.cache = null; this.busy = false; }
  // Returns the cached rewrite synchronously and starts a refresh when due.
  get(ai, facts, now = Date.now()) {
    if (!ai || ai.provider === 'off') return undefined;
    const stale = !this.cache || now - this.cache.at >= (ai.intervalMinutes ?? 15) * 60_000;
    if (stale && !this.busy) this.refresh(ai, facts, now);
    // A new task or different base phrase invalidates old text so it can't describe stale work.
    return this.cache?.phrase === facts.phrase ? this.cache.text : undefined;
  }
  refresh(ai, facts, now) {
    this.busy = true;
    const dir = mkdtempSync(join(tmpdir(), 'ep-ai-')), out = join(dir, 'out.txt');
    const [bin, args] = command(ai, buildPrompt(facts), out);
    this.run(bin, args, dir, out).then(text => {
      this.cache = { at: now, phrase: facts.phrase, text: clean(text) };
    }).catch(() => { this.cache = { at: now, phrase: facts.phrase, text: undefined }; }).finally(() => { this.busy = false; rmSync(dir, { recursive: true, force: true }); });
  }
}

function defaultRun(bin, args, cwd, out) {
  return new Promise((resolve, reject) => {
    // EP_AI stops the user's own hooks from treating this call as an agent task.
    execFile(bin, args, { cwd, timeout: 60_000, maxBuffer: 65536, env: { ...process.env, EP_AI: '1' } }, (error, stdout) => {
      if (error) return reject(error);
      try { resolve(bin === 'codex' ? readFileSync(out, 'utf8') : stdout); } catch (e) { reject(e); }
    });
  });
}
