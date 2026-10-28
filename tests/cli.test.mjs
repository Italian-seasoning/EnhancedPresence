import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { fileURLToPath } from 'node:url';
const cli = fileURLToPath(new URL('../presence-engine/main.mjs', import.meta.url));
test('preview consumes fixtures and clears on EOF without IPC', async () => {
  const child = spawn(process.execPath, [cli]);
  let output = ''; child.stdout.on('data', x => output += x);
  child.stdin.end(JSON.stringify({ appId: 'com.roblox.RobloxPlayer', pid: 123, inactive: false, idleSeconds: 0 }) + '\n');
  const [code] = await once(child, 'exit');
  assert.equal(code, 0);
  const messages = output.trim().split('\n').map(x => JSON.parse(x));
  assert.equal(messages[1].activity.appName, 'Roblox');
  assert.equal(messages.at(-1).type, 'presence_clear');
});
test('publication cannot start without activation flag', async () => {
  const child = spawn(process.execPath, [cli, '--publish'], { stdio: 'ignore' });
  const [code] = await once(child, 'exit'); assert.notEqual(code, 0);
});

test('quiet companion output does not retain foreground app history', async () => {
  const child = spawn(process.execPath, [cli, '--quiet']);
  let output = ''; child.stdout.on('data', x => output += x);
  child.stdin.end(JSON.stringify({ appId: 'com.figma.Desktop', pid: 123, inactive: false, idleSeconds: 0 }) + '\n');
  const [code] = await once(child, 'exit');
  assert.equal(code, 0);
  assert.equal(output, '');
});
test('Vencord bridge cannot start without activation approval', async () => {
  const child = spawn(process.execPath, [cli, '--vencord'], { stdio: 'ignore' });
  const [code] = await once(child, 'exit'); assert.notEqual(code, 0);
});
test('a null detector snapshot clears a previously active preview', async () => {
  const child = spawn(process.execPath, [cli]);
  let output = ''; child.stdout.on('data', x => output += x);
  child.stdin.write(JSON.stringify({ appId: 'com.roblox.RobloxPlayer', pid: 123, inactive: false, idleSeconds: 0 }) + '\n');
  const deadline = Date.now() + 2000;
  while (!output.includes('presence_update')) {
    if (Date.now() > deadline) { child.kill(); throw Error('No preview activity'); }
    await new Promise(r => setTimeout(r, 10));
  }
  child.stdin.end('null\n');
  const [code] = await once(child, 'exit');
  assert.equal(code, 0);
  assert.equal(JSON.parse(output.trim().split('\n').at(-1)).type, 'presence_clear');
});
