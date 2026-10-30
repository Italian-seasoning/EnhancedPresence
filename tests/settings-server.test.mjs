import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { request } from 'node:http';
import { startSettingsServer } from '../presence-engine/settings-server.mjs';

async function setup(t) {
  const root = mkdtempSync(join(tmpdir(), 'ep-settings-'));
  writeFileSync(join(root, 'config.local.json'), '{}', { mode: 0o600 });
  const server = await startSettingsServer({ root, port: 0 });
  t.after(() => server.close());
  const url = new URL(server.url);
  return { root, server, base: url.origin, token: url.searchParams.get('t') };
}
const post = (base, token, name, body, headers = {}) => fetch(`${base}/api/${name}`, { method: 'POST', headers: { 'x-ep-token': token, 'content-type': 'application/json', ...headers }, body: JSON.stringify(body) });

test('serves the page only with the token and writes a private session file', async t => {
  const { base, token, root } = await setup(t);
  assert.equal((await fetch(`${base}/`)).status, 403);
  assert.equal((await fetch(`${base}/?t=${'0'.repeat(48)}`)).status, 403);
  const page = await fetch(`${base}/?t=${token}`);
  assert.equal(page.status, 200); assert.match(await page.text(), new RegExp(token));
  assert.match(page.headers.get('content-security-policy'), /default-src 'none'/);
  assert.equal(JSON.parse(readFileSync(join(root, 'settings-session.json'), 'utf8')).url.includes(token), true);
});

test('API needs the token, a loopback Host and no foreign Origin', async t => {
  const { base, token } = await setup(t);
  assert.equal((await fetch(`${base}/api/state`)).status, 403);
  assert.equal((await fetch(`${base}/api/state`, { headers: { 'x-ep-token': token } })).status, 200);
  // fetch() will not let tests forge Origin or Host, so send raw requests.
  const raw = headers => new Promise((resolve, reject) => request(`${base}/api/state`, { headers: { 'x-ep-token': token, ...headers } }, res => { res.resume(); resolve(res.statusCode); }).on('error', reject).end());
  assert.equal(await raw({}), 200);
  assert.equal(await raw({ origin: 'https://evil.example' }), 403);
  assert.equal(await raw({ host: 'evil.example' }), 403);
});

test('settings changes validate and persist', async t => {
  const { base, token, root } = await setup(t);
  assert.equal((await post(base, token, 'general', { output: 'ipc', powerSaver: 'on', quietHours: { enabled: true, start: '22:00' } })).status, 200);
  const saved = JSON.parse(readFileSync(join(root, 'config.local.json'), 'utf8'));
  assert.equal(saved.output, 'ipc'); assert.equal(saved.power.saver, 'on'); assert.equal(saved.quietHours.start, '22:00');
  assert.equal((await post(base, token, 'general', { output: 'nonsense' })).status, 400);
  assert.equal((await post(base, token, 'agent', { provider: 'haiku', intervalMinutes: 30, showProject: false })).status, 200);
  assert.equal((await post(base, token, 'app', { id: 'com.blackmagic-design.DaVinciResolve', visibility: 'blocked' })).status, 200);
  assert.equal((await post(base, token, 'nope', {})).status, 404);
  assert.equal((await fetch(`${base}/api/general`, { method: 'POST', headers: { 'x-ep-token': token, 'content-type': 'text/plain' }, body: '{}' })).status, 404);
});

test('malformed requests and unavailable settings do not terminate the companion', async t => {
  const { base, token, root } = await setup(t);
  assert.equal((await fetch(`${base}/?t=${encodeURIComponent('é'.repeat(48))}`)).status, 403);
  writeFileSync(join(root, 'config.local.json'), '{broken', { mode: 0o600 });
  assert.equal((await fetch(`${base}/api/state`, { headers: { 'x-ep-token': token } })).status, 503);
  writeFileSync(join(root, 'config.local.json'), '{}', { mode: 0o600 });
  assert.equal((await fetch(`${base}/api/state`, { headers: { 'x-ep-token': token } })).status, 200);
});
