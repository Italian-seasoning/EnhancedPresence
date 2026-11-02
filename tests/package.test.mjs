import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdirSync, mkdtempSync, writeFileSync, readFileSync, existsSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { verifyDownload, checksumFor, stagePayload, payloadManifest } from '../scripts/package-macos.mjs';
import { APPLE_MUSIC_AUTOMATION_DESCRIPTION } from '../shared/helper-metadata.mjs';

test('release downloads require the expected digest and exact official filename', () => {
  const bytes = Buffer.from('download');
  const sum = createHash('sha256').update(bytes).digest('hex');
  assert.equal(checksumFor(`${sum}  node.tar.gz\n`, 'node.tar.gz'), sum);
  assert.equal(verifyDownload(bytes, sum, 'node.tar.gz'), bytes);
  assert.throws(() => verifyDownload(bytes, '0'.repeat(64), 'node.tar.gz'), /checksum/i);
  assert.throws(() => checksumFor(`${sum}  other.tar.gz`, 'node.tar.gz'), /checksum/i);
});

test('optional themes stage as standalone downloads with explicit manual selection', async () => {
  const { stageOptionalThemes } = await import('../scripts/package-macos.mjs');
  const stage = mkdtempSync(join(tmpdir(), 'presence-themes-'));
  try {
    stageOptionalThemes(stage);
    for (const name of ['PresenceMessages.theme.css', 'PresenceSnapchat.theme.css']) {
      assert.equal(readFileSync(join(stage, name), 'utf8'), readFileSync(new URL(`../themes/${name}`, import.meta.url), 'utf8'));
    }
    const instructions = readFileSync(join(stage, 'Optional themes.txt'), 'utf8');
    assert.match(instructions, /enable only one/i);
    assert.match(instructions, /does not select or enable/i);
  } finally { rmSync(stage, { recursive: true, force: true }); }
});

test('payload staging includes runtime and licenses, excludes private state and source maps', () => {
  const temp = mkdtempSync(join(tmpdir(), 'presence-package-'));
  const repo = join(temp, 'source'), inputs = join(temp, 'inputs'), app = join(temp, 'EnhancedPresence Helper.app');
  const put = (path, contents = 'fixture') => { mkdirSync(join(path, '..'), { recursive: true }); writeFileSync(path, contents); };
  try {
    for (const name of ['presence-engine/main.mjs', 'presence-engine/config.local.json', 'shared/protocol.mjs', 'vendor/ws/wrapper.mjs', 'vendor/ws/package.json', 'vendor/ws/LICENSE', 'vendor/mediaremote-adapter/bin/mediaremote-adapter.pl', 'vendor/mediaremote-adapter/LICENSE', 'assets/AppIcon.icns', 'LICENSE', 'TERMS.md', 'scripts/bundle-setup.mjs', 'scripts/vencord-deploy.mjs', 'scripts/install-vencord.mjs']) put(join(repo, name));
    for (const name of ['node', 'node-LICENSE', 'helper', 'detector', 'installer', 'framework/Versions/A/MediaRemoteAdapter', 'vencord/dist/patcher.js', 'vencord/dist/preload.js', 'vencord/dist/renderer.js', 'vencord/dist/renderer.js.map', 'vencord/LICENSE']) put(join(inputs, name));
    stagePayload({ repo, app, arch: 'arm64', version: '0.9.0', node: join(inputs, 'node'), nodeLicense: join(inputs, 'node-LICENSE'), helper: join(inputs, 'helper'), detector: join(inputs, 'detector'), framework: join(inputs, 'framework'), vencord: join(inputs, 'vencord'), installer: join(inputs, 'installer') });
    const resources = join(app, 'Contents/Resources');
    assert.equal(existsSync(join(resources, 'runtime/node')), true);
    assert.equal(existsSync(join(resources, 'runtime/LICENSE')), true);
    assert.equal(existsSync(join(resources, 'presence-engine/config.local.json')), false);
    assert.equal(existsSync(join(resources, 'vencord/dist/renderer.js.map')), false);
    const helperInfo = readFileSync(join(app, 'Contents/Info.plist'), 'utf8');
    assert.match(helperInfo, /13\.5/);
    assert.ok(helperInfo.includes(`<key>NSAppleEventsUsageDescription</key><string>${APPLE_MUSIC_AUTOMATION_DESCRIPTION}</string>`));
    const manifest = payloadManifest(app, { version: '0.9.0', arch: 'arm64' });
    assert.equal(manifest.schema, 1);
    assert.equal(manifest.files['Contents/Resources/runtime/node'], createHash('sha256').update('fixture').digest('hex'));
    assert.ok(manifest.files['Contents/MacOS/EnhancedPresenceHelper']);
  } finally { rmSync(temp, { recursive: true, force: true }); }
});
