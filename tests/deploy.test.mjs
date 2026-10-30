import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { buildLoader, deploy } from '../scripts/vencord-deploy.mjs';
import { repair } from '../presence-engine/repair.mjs';

test('loader is a valid asar whose index.js loads the patcher', () => {
  const asar = buildLoader('/home/x/Library/Application Support/Vencord/dist/patcher.js');
  const jsonLength = asar.readUInt32LE(12), header = JSON.parse(asar.subarray(16, 16 + jsonLength));
  assert.equal(asar.readUInt32LE(0), 4);
  assert.equal(asar.readUInt32LE(4), asar.readUInt32LE(8) + 4);
  const body = asar.subarray(16 + jsonLength + (4 - jsonLength % 4) % 4);
  const { size, offset } = header.files['index.js'];
  assert.equal(body.subarray(Number(offset), Number(offset) + size).toString(), 'require("/home/x/Library/Application Support/Vencord/dist/patcher.js")');
});

test('deploy patches a Discord archive once, keeps the original, and is idempotent', async () => {
  const home = mkdtempSync(join(tmpdir(), 'ep-home-')), checkout = mkdtempSync(join(tmpdir(), 'ep-vc-')), resources = mkdtempSync(join(tmpdir(), 'ep-res-'));
  mkdirSync(join(checkout, 'dist'));
  for (const name of ['patcher.js', 'preload.js', 'renderer.js', 'renderer.css', 'renderer.js.map']) writeFileSync(join(checkout, 'dist', name), `// ${name}`);
  // A stand-in for Discord's own archive: a valid asar padded past the 1 KB sanity floor.
  const discord = Buffer.concat([buildLoader('/discord/original.js'), Buffer.alloc(2048)]);
  writeFileSync(join(resources, 'app.asar'), discord);
  const first = await deploy(checkout, { home, resources, start: false, nodePath: '/payload/runtime/node' });
  assert.equal(first.changed, true);
  assert.deepEqual(readFileSync(join(resources, '_app.asar')), discord);
  assert.match(readFileSync(join(resources, 'app.asar')).toString('latin1'), /Vencord\/dist\/patcher\.js/);
  assert.equal(readFileSync(join(first.dist, 'renderer.js'), 'utf8'), '// renderer.js');
  assert.equal(existsSync(join(first.dist, 'renderer.js.map')), false);
  const repairPlist = readFileSync(join(home, 'Library', 'LaunchAgents', 'app.enhancedpresence.vencord-repair.plist'), 'utf8');
  assert.doesNotMatch(repairPlist, /StartInterval/);
  assert.match(repairPlist, /<string>\/payload\/runtime\/node<\/string>/);
  assert.match(repairPlist, new RegExp(resources.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  assert.equal((await deploy(checkout, { home, resources, start: false })).changed, false);
});

test('repair restores the original archive if activating the staged loader fails', async () => {
  const root = mkdtempSync(join(tmpdir(), 'ep-rollback-'));
  const resources = join(root, 'Resources'), managed = join(root, 'managed'), dist = join(root, 'dist');
  mkdirSync(resources); mkdirSync(managed); mkdirSync(dist);
  const originalBytes = Buffer.concat([buildLoader('/discord/original.js'), Buffer.alloc(2048)]);
  const loader = buildLoader('/Vencord/dist/patcher.js');
  writeFileSync(join(resources, 'app.asar'), originalBytes);
  writeFileSync(join(managed, 'loader.asar'), loader);
  let failed = false;
  await assert.rejects(repair({ resources, dist, managed, backups: join(root, 'backups'), files: [], rename: async (from, to) => {
    if (!failed && to === join(resources, 'app.asar') && from.includes('.presence-')) { failed = true; throw Error('simulated activation failure'); }
    return (await import('node:fs/promises')).rename(from, to);
  }}), /simulated activation failure/);
  assert.deepEqual(readFileSync(join(resources, 'app.asar')), originalBytes);
});

test('deploy refuses an incomplete build', async () => {
  const checkout = mkdtempSync(join(tmpdir(), 'ep-vc-')); mkdirSync(join(checkout, 'dist'));
  await assert.rejects(deploy(checkout, { home: mkdtempSync(join(tmpdir(), 'ep-home-')), start: false }), /missing/);
});
