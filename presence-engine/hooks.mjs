import { copyFileSync, existsSync, lstatSync, readFileSync, renameSync, writeFileSync } from 'node:fs';

// Adds or removes the task-status hook in Claude Code's settings. Our entries are
// recognised by the script name, so other hooks are never touched and reruns don't duplicate.
export const claudeEvents = ['UserPromptSubmit', 'PostToolUse', 'PostToolUseFailure', 'Stop'];
// Codex has no separate failure event.
export const codexEvents = ['UserPromptSubmit', 'PostToolUse', 'Stop'];
const ours = entry => entry?.hooks?.some(h => typeof h?.command === 'string' && h.command.includes('agent-hook'));

function load(path) {
  if (!existsSync(path)) return {};
  if (!lstatSync(path).isFile()) throw Error('Claude Code settings must be a regular file.');
  const settings = JSON.parse(readFileSync(path, 'utf8'));
  if (!settings || typeof settings !== 'object' || Array.isArray(settings) || (settings.hooks && typeof settings.hooks !== 'object')) throw Error('Unexpected Claude Code settings format; left unchanged.');
  return settings;
}
function save(path, settings) {
  // One backup of the original, then an atomic replace.
  if (existsSync(path) && !existsSync(`${path}.enhancedpresence.bak`)) copyFileSync(path, `${path}.enhancedpresence.bak`);
  const temporary = `${path}.enhancedpresence.tmp`;
  writeFileSync(temporary, JSON.stringify(settings, null, 2) + '\n');
  renameSync(temporary, path);
}

export function installHooks(path, command, events = claudeEvents, extra = {}) {
  const settings = load(path);
  settings.hooks ??= {};
  for (const event of events) {
    const kept = (settings.hooks[event] ?? []).filter(entry => !ours(entry));
    settings.hooks[event] = [...kept, { hooks: [{ type: 'command', command, timeout: 3, ...extra }] }];
  }
  save(path, settings);
}

export function removeHooks(path) {
  if (!existsSync(path)) return;
  const settings = load(path);
  for (const event of Object.keys(settings.hooks ?? {})) {
    settings.hooks[event] = settings.hooks[event].filter(entry => !ours(entry));
    if (!settings.hooks[event].length) delete settings.hooks[event];
  }
  save(path, settings);
}
