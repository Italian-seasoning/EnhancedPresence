import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { updateApp } from '../presence-engine/controls.mjs';
import { PresenceEngine } from '../presence-engine/engine.mjs';
import { defaultConfig } from '../presence-engine/profiles.mjs';
import { selectMusicActivity } from '../presence-engine/music.mjs';
import { message } from '../shared/protocol.mjs';
import { parseActivity } from '../vencord-plugin/EnhancedPresenceUniversal/client.mjs';

test('the full accepted bundle-ID length works from Add App through detection and Vencord', async () => {
  const root = mkdtempSync(join(tmpdir(), 'presence-custom-app-'));
  try {
    const path = join(root, 'config.local.json');
    writeFileSync(path, JSON.stringify(defaultConfig), { mode: 0o600 });
    const id = 'com.example.' + 'a'.repeat(188);
    assert.equal(id.length, 200);
    updateApp(root, { id, create: true, visibility: 'allowed', name: 'Custom App', details: 'Working in Custom App' });
    const config = JSON.parse(readFileSync(path, 'utf8'));
    const now = Date.now(), launch = Math.floor(now / 1000) - 3600;
    const snapshot = { appId: id, pid: 123, launchTimestamp: launch, inactive: false, idleSeconds: 0 };
    const activity = await new PresenceEngine(config).update(snapshot, now);
    assert.equal(activity?.appId, id);
    const discord = parseActivity(JSON.stringify(message(activity)), '12345678901234567');
    assert.equal(discord.name, 'Custom App');
    assert.equal(discord.timestamps.start, launch * 1000);
    const track = { kind: 'music', appId: 'com.apple.Music' };
    config.music.priority = 'music';
    assert.equal(selectMusicActivity(activity, track, config, id, snapshot), track);
  } finally { rmSync(root, { recursive: true, force: true }); }
});
