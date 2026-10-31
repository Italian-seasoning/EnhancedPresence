import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { phrase, agentActivity } from '../presence-engine/agent.mjs';
import { PresenceEngine } from '../presence-engine/engine.mjs';

const hook = join(import.meta.dirname, '../presence-engine/agent-hook.sh');
const fire = (dir, payload, env = {}) => execFileSync('/bin/sh', [hook], { input: JSON.stringify(payload), env: { ...process.env, EP_AGENT_DIR: dir, ...env } });
const tool = (dir, event, name, command) => fire(dir, { hook_event_name: event, tool_name: name, tool_input: command ? { command } : {} });
const fresh = () => mkdtempSync(join(tmpdir(), 'ep-'));

test('hook records categories only, never prompts, paths or commands', () => {
  const dir = fresh();
  fire(dir, { hook_event_name: 'UserPromptSubmit', cwd: '/x/demo', prompt: 'SECRET PROMPT' });
  tool(dir, 'PostToolUse', 'Edit'); tool(dir, 'PostToolUse', 'Bash', 'npm test --secret-flag'); tool(dir, 'PostToolUseFailure', 'Bash', 'git commit -m hidden');
  const files = readFileSync(join(dir, 'agent-task'), 'utf8') + readFileSync(join(dir, 'agent-events.log'), 'utf8');
  assert.doesNotMatch(files, /SECRET|secret-flag|hidden|\/x\//);
  assert.match(readFileSync(join(dir, 'agent-events.log'), 'utf8'), / edit 0\n.* test 0\n.* git 1\n/);
  assert.match(readFileSync(join(dir, 'agent-task'), 'utf8'), /^\d+ demo\n$/);
});

test('hook ignores its own status-writer calls', () => {
  const dir = fresh();
  fire(dir, { hook_event_name: 'UserPromptSubmit', cwd: '/x/demo' }, { EP_AI: '1' });
  assert.throws(() => readFileSync(join(dir, 'agent-task')));
});

test('failing test then edit reads as squashing bugs; otherwise accurate phrases', () => {
  assert.equal(phrase([{ c: 'edit' }]), 'Editing code');
  assert.equal(phrase([{ c: 'read' }]), 'Reviewing code');
  assert.equal(phrase([{ c: 'test', f: true }, { c: 'edit', f: false }]), 'Squashing bugs');
  assert.equal(phrase([{ c: 'test', f: false }]), 'Running tests');
  assert.equal(phrase([]), 'Thinking');
});

test('task timer, opt-in project, staleness and stop', () => {
  const dir = fresh(), t0 = Math.floor(Date.now() / 1000);
  writeFileSync(join(dir, 'agent-task'), `${t0} demo\n`); writeFileSync(join(dir, 'agent-events.log'), '');
  const now = t0 * 1000 + 1000;
  assert.deepEqual(agentActivity({}, now, dir), { details: 'Thinking', startTimestamp: t0, categories: [] });
  assert.equal(agentActivity({ showProject: true }, now, dir).state, 'Project: demo');
  assert.equal(agentActivity({}, t0 * 1000 + 16 * 60_000, dir), null);
  tool(dir, 'PostToolUse', 'Read'); fire(dir, { hook_event_name: 'Stop' });
  assert.equal(agentActivity({}, Date.now(), dir), null);
});

test('engine uses task wording only in agent host apps and preserves app launch time', async () => {
  const dir = fresh(), t0 = Math.floor(Date.now() / 1000) - 60, appStart = t0 - 600;
  writeFileSync(join(dir, 'agent-task'), `${t0} demo\n`); writeFileSync(join(dir, 'agent-events.log'), `${t0} test 0\n`);
  const snap = appId => ({ appId, pid: 1, launchTimestamp: appStart, idleSeconds: 0, inactive: false });
  const term = await new PresenceEngine({}, undefined, dir).update(snap('com.apple.Terminal'));
  assert.equal(term.details, 'Running tests'); assert.equal(term.startTimestamp, appStart);
  const other = await new PresenceEngine({}, undefined, dir).update(snap('com.apple.Safari'));
  assert.equal(other.details, 'Browsing the web');
});

test('agent task age is used for AI wording while Discord timer stays at validated app launch', async () => {
  const dir = fresh(), taskStart = Math.floor(Date.now() / 1000) - 180, appStart = taskStart - 1200;
  writeFileSync(join(dir, 'agent-task'), `${taskStart} demo\n`); writeFileSync(join(dir, 'agent-events.log'), `${taskStart} test 0\n`);
  const prompts = [];
  const engine = new PresenceEngine({ agent: { ai: { provider: 'haiku', intervalMinutes: 15 } } }, undefined, dir,
    async (_bin, args) => { prompts.push(args.at(-1)); return ''; });
  const activity = await engine.update({ appId: 'com.openai.codex', pid: 9, launchTimestamp: appStart, idleSeconds: 0, inactive: false }, taskStart * 1000 + 60000);
  assert.equal(activity.startTimestamp, appStart);
  assert.match(prompts[0], /Task running: 1 min/);
});

import { command, clean, buildPrompt } from '../presence-engine/ai.mjs';

test('haiku and luna use cheapest settings and the prompt carries no private data', () => {
  const [bin, args] = command({ provider: 'haiku' }, 'p', 'o');
  assert.equal(bin, 'claude'); assert.deepEqual(args.slice(0, 5), ['-p', '--model', 'haiku', '--effort', 'low']);
  const [codex, cargs] = command({ provider: 'luna' }, 'p', 'o');
  assert.equal(codex, 'codex'); assert.ok(cargs.includes('luna') && cargs.includes('model_reasoning_effort="low"') && cargs.includes('--ephemeral'));
  assert.doesNotMatch(buildPrompt({ phrase: 'Running tests', app: 'Terminal', minutes: 3, categories: ['test'] }), /\/|project/i);
  assert.equal(clean('"Taming flaky tests."\nextra'), 'Taming flaky tests');
  assert.equal(clean('see https://x.y'), undefined);
});

test('AI rewrite runs once per interval, then is used', async () => {
  const dir = fresh(), t0 = Math.floor(Date.now() / 1000) - 60;
  writeFileSync(join(dir, 'agent-task'), `${t0} demo\n`); writeFileSync(join(dir, 'agent-events.log'), `${t0} test 0\n`);
  let calls = 0;
  const engine = new PresenceEngine({ agent: { ai: { provider: 'haiku' } } }, undefined, dir, async () => { calls++; return 'Testing the waters'; });
  const snap = { appId: 'com.apple.Terminal', pid: 1, idleSeconds: 0, inactive: false };
  assert.equal((await engine.update(snap)).details, 'Running tests');
  await new Promise(r => setTimeout(r, 20));
  assert.equal((await engine.update(snap, Date.now() + 1000)).details, 'Testing the waters');
  await engine.update(snap, Date.now() + 2000);
  assert.equal(calls, 1);
});

import { readControls, updateAgent } from '../vencord-plugin/EnhancedPresenceUniversal/controls.mjs';
import { mkdirSync } from 'node:fs';

test('plugin controls read and save AI status settings, rejecting bad values', () => {
  const root = mkdtempSync(join(tmpdir(), 'ep-')); writeFileSync(join(root, 'config.local.json'), '{}', { mode: 0o600 });
  assert.equal(readControls(root).agent.provider, 'off');
  const saved = updateAgent(root, { provider: 'luna', intervalMinutes: 30, showProject: true }).agent;
  assert.deepEqual(saved, { provider: 'luna', intervalMinutes: 30, showProject: true });
  assert.throws(() => updateAgent(root, { provider: 'gpt', intervalMinutes: 30, showProject: false }));
  assert.throws(() => updateAgent(root, { provider: 'haiku', intervalMinutes: 1, showProject: false }));
});

test('hook understands Codex payloads: apply_patch and array commands', () => {
  const dir = fresh();
  fire(dir, { hook_event_name: 'UserPromptSubmit', cwd: '/x/demo' });
  fire(dir, { hook_event_name: 'PostToolUse', tool_name: 'apply_patch', tool_input: { command: '*** Begin Patch' } });
  fire(dir, { hook_event_name: 'PostToolUse', tool_name: 'Bash', tool_input: { command: ['bash', '-lc', 'npm test'] }, tool_response: 'build' });
  assert.match(readFileSync(join(dir, 'agent-events.log'), 'utf8'), / edit 0\n.* test 0\n$/);
});
