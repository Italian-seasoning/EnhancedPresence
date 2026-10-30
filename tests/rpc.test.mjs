import test from 'node:test';
import assert from 'node:assert/strict';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { mkdtemp, rm } from 'node:fs/promises';
import { once } from 'node:events';
import { DiscordRPC, Decoder, frame, ipcPaths } from '../presence-engine/rpc.mjs';
import { PresenceEngine } from '../presence-engine/engine.mjs';
const waitFor = async predicate => {
  const deadline = Date.now() + 3000;
  while (!predicate()) { if (Date.now() > deadline) throw Error('Timed out'); await new Promise(r => setTimeout(r, 10)); }
};
test('decoder handles fragmentation, multiple frames, and bounded input', () => {
  const d = new Decoder(), bytes = frame(1, { evt: 'READY' });
  assert.deepEqual(d.push(bytes.subarray(0, 3)), []);
  assert.equal(d.push(Buffer.concat([bytes.subarray(3), frame(3, Buffer.from('ping'))])).length, 2);
  const oversized = Buffer.alloc(8); oversized.writeUInt32LE(65537, 4);
  assert.throws(() => new Decoder().push(oversized));
  assert.equal(ipcPaths({ TMPDIR: '/fixture' })[0], '/fixture/discord-ipc-0');
  assert.throws(() => new DiscordRPC('token'));
});
test('synthetic detector → engine → IPC handshake, ACK, clear, reconnect and shutdown', async t => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'ep-rpc-'));
  const socketPath = path.join(dir, 'mock.sock');
  const received = [], clients = new Set(); let connections = 0;
  const server = net.createServer(socket => {
    connections++; clients.add(socket); socket.on('close', () => clients.delete(socket));
    const d = new Decoder();
    socket.on('data', data => {
      for (const f of d.push(data)) {
        if (f.op === 4) { received.push({ pong: f.body.toString() }); continue; }
        const p = JSON.parse(f.body); received.push(p);
        if (f.op === 0) {
          const ready = frame(1, { evt: 'READY' });
          socket.write(ready.subarray(0, 5)); socket.write(ready.subarray(5));
          socket.write(frame(3, Buffer.from('fixture-ping')));
        } else socket.write(frame(1, { cmd: p.cmd, nonce: p.nonce, data: {} }));
      }
    });
  });
  server.listen(socketPath); await once(server, 'listening');
  const rpc = new DiscordRPC('123456789012345678', { paths: [path.join(dir, 'missing'), socketPath], interval: 20, retryDelay: 20 });
  t.after(async () => { await rpc.stop(); for (const c of clients) c.destroy(); await new Promise(r => server.close(r)); await rm(dir, { recursive: true }); });
  const engine = new PresenceEngine();
  rpc.update(await engine.update({ appId: 'com.roblox.RobloxPlayer', pid: 12, idleSeconds: 0, inactive: false }, 100000));
  rpc.start();
  await waitFor(() => received.some(p => p.args?.activity?.details.includes('Roblox')));
  assert.deepEqual(received[0], { v: 1, client_id: '123456789012345678' });
  await waitFor(() => received.some(p => p.pong === 'fixture-ping'));
  rpc.update(await engine.update({ appId: 'com.apple.mail', pid: 13, idleSeconds: 0, inactive: false }));
  await waitFor(() => received.some(p => p.cmd === 'SET_ACTIVITY' && p.args.activity === null));
  for (const c of clients) c.destroy();
  await waitFor(() => connections === 2);
  await waitFor(() => received.filter(p => p.cmd === 'SET_ACTIVITY' && p.args.activity === null).length >= 2);
  rpc.update(await engine.update({ appId: 'com.apple.Safari', pid: 14, idleSeconds: 0, inactive: false }));
  await waitFor(() => received.some(p => p.args?.activity?.details.includes('Safari')));
  await rpc.stop();
  assert.equal(received.filter(p => p.cmd === 'SET_ACTIVITY').at(-1).args.activity, null);
  assert.equal(received.every(p => !p.cmd || p.cmd === 'SET_ACTIVITY'), true);
});

test('a rapid output resume cancels an in-flight graceful stop', async t => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'ep-rpc-resume-'));
  const socketPath = path.join(dir, 'mock.sock'), received = [];
  const server = net.createServer(socket => {
    const d = new Decoder();
    socket.on('data', data => {
      for (const f of d.push(data)) {
        const payload = JSON.parse(f.body);
        if (f.op === 0) socket.write(frame(1, { evt: 'READY' }));
        else {
          received.push(payload.args.activity);
          const ack = () => socket.write(frame(1, { cmd: payload.cmd, nonce: payload.nonce, data: {} }));
          setTimeout(ack, payload.args.activity === null ? 100 : 0);
        }
      }
    });
  });
  server.listen(socketPath); await once(server, 'listening');
  const rpc = new DiscordRPC('123456789012345678', { paths: [socketPath], interval: 0 });
  t.after(async () => { await rpc.stop(); await new Promise(r => server.close(r)); await rm(dir, { recursive: true }); });
  const engine = new PresenceEngine();
  const first = { ...await engine.update({ appId: 'com.apple.Xcode', pid: 1, inactive: false, idleSeconds: 0 }, 100000), details: 'Building' };
  const resumed = { ...await new PresenceEngine({ switchDelaySeconds: 0 }).update({ appId: 'com.apple.Safari', pid: 2, inactive: false, idleSeconds: 0 }, 100000), details: 'Browsing' };
  rpc.start(); rpc.update(first);
  await waitFor(() => received.some(a => a?.details?.includes('Building')));
  await waitFor(() => !rpc.pending);
  const stopping = rpc.stop(); rpc.start(); rpc.update(resumed);
  await waitFor(() => received.some(a => a?.details?.includes('Browsing')));
  await stopping;
  assert.equal(rpc.closed, false);
  assert.equal(rpc.ready, true);
});
