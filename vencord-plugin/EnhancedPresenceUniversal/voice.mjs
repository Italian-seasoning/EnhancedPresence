import { normalizeVoiceCommand, normalizeVoiceSnapshot, voiceCommandIsCurrent } from './voice-state.mjs';

const publicState = ({ updatedAt: _updatedAt, ...state }) => JSON.stringify(state);

export function createVoiceModule(options) {
  const now = options.now ?? Date.now;
  let running = false, busy = false, generation = 0, timer;
  let current = null, lastWritten = 0, lastVoiceCommand = '';
  let nativeQueue = Promise.resolve();
  const callNative = operation => {
    const result = nativeQueue.then(() => options.native?.[operation.name](...operation.args));
    nativeQueue = result.catch(() => {});
    return result;
  };
  const clearCurrent = async () => {
    current = null;
    lastWritten = 0;
    lastVoiceCommand = '';
    options.onChange?.(null);
    try { await callNative({ name: 'writeVoiceState', args: [null] }); } catch { /* Stop still clears the UI. */ }
  };

  async function refresh() {
    if (!running || busy) return current;
    busy = true;
    const started = generation;
    try {
      if (!options.enabled()) { if (current) await clearCurrent(); return null; }
      const timestamp = now();
      const next = normalizeVoiceSnapshot(options.readSnapshot(), timestamp);
      if (!next) { if (current) await clearCurrent(); return null; }

      const changed = !current || publicState(current) !== publicState(next);
      current = next;
      if (changed || timestamp - lastWritten >= 3000) {
        await callNative({ name: 'writeVoiceState', args: [next] });
        if (!running || started !== generation) return null;
        lastWritten = timestamp;
        if (changed) options.onChange?.(next);
      }

      if (options.native) {
        const raw = await callNative({ name: 'takeVoiceHUDCommand', args: [next.channelId] });
        if (!running || started !== generation) return null;
        const command = normalizeVoiceCommand(raw, now());
        if (!command || command.id === lastVoiceCommand || !voiceCommandIsCurrent(command, current?.channelId ?? null, now())) return current;
        const latest = normalizeVoiceSnapshot(options.readSnapshot(), now());
        if (latest?.channelId !== command.channelId) return current;
        lastVoiceCommand = command.id;
        if (command.action === 'mute' && latest.selfMute !== command.value) options.setSelfMute(command.value);
        if (command.action === 'deafen' && latest.selfDeaf !== command.value) options.setSelfDeaf(command.value);
      }
      return current;
    } catch {
      return current;
    } finally { busy = false; }
  }

  return {
    get snapshot() { return current; },
    async start() {
      if (running) return;
      running = true;
      generation++;
      await refresh();
      if (running) timer = (options.every ?? setInterval)(() => void refresh(), 1000);
    },
    async stop() {
      if (!running) return;
      running = false;
      generation++;
      if (timer) (options.cancel ?? clearInterval)(timer);
      timer = undefined;
      await clearCurrent();
    },
    refresh
  };
}
