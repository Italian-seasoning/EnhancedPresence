import net from 'node:net';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { discordActivity } from '../shared/protocol.mjs';

export function ipcPaths(env = process.env) {
  const directories = [...new Set([env.XDG_RUNTIME_DIR, env.TMPDIR, env.TMP, env.TEMP, '/tmp'].filter(Boolean))];
  return directories.flatMap(dir => Array.from({ length: 10 }, (_, i) => path.join(dir, `discord-ipc-${i}`)));
}
export function frame(op, payload) {
  const body = Buffer.isBuffer(payload) ? payload : Buffer.from(JSON.stringify(payload));
  const header = Buffer.alloc(8);
  header.writeUInt32LE(op, 0); header.writeUInt32LE(body.length, 4);
  return Buffer.concat([header, body]);
}
export class Decoder {
  constructor() { this.buffer = Buffer.alloc(0); }
  push(data) {
    this.buffer = Buffer.concat([this.buffer, data]);
    const messages = [];
    while (this.buffer.length >= 8) {
      const op = this.buffer.readUInt32LE(0), length = this.buffer.readUInt32LE(4);
      if (length > 65536) throw Error('Oversized RPC frame');
      if (this.buffer.length < length + 8) break;
      messages.push({ op, body: this.buffer.subarray(8, length + 8) });
      this.buffer = this.buffer.subarray(length + 8);
    }
    return messages;
  }
}

// Only handshake, SET_ACTIVITY, and PONG. No token, OAuth, account, or message APIs.
export class DiscordRPC {
  constructor(clientId, { paths = ipcPaths(), onStatus = () => {}, interval = 15000, retryDelay = 1000 } = {}) {
    if (!/^\d{17,20}$/.test(clientId)) throw Error('A numeric Discord application ID is required');
    Object.assign(this, { clientId, paths, onStatus, interval, retryDelay });
    this.desired = null; this.ready = false; this.closed = false; this.lastSent = 0; this.lifecycle = 0;
  }
  start() { this.lifecycle++; this.closed = false; this.retryDelay = 1000; if (!this.ready) this.connect(0); }
  connect(index) {
    if (this.closed) return;
    const socket = net.createConnection(this.paths[index]);
    this.socket = socket;
    const decoder = new Decoder();
    let wasReady = false;
    socket.setTimeout(3000, () => socket.destroy());
    socket.on('connect', () => socket.write(frame(0, { v: 1, client_id: this.clientId })));
    socket.on('error', () => {});
    socket.on('data', data => {
      try {
        for (const msg of decoder.push(data)) {
          if (msg.op === 3) { socket.write(frame(4, msg.body)); continue; }
          if (msg.op === 2) { socket.destroy(); continue; }
          if (msg.op !== 1) continue;
          const payload = JSON.parse(msg.body);
          if (payload.evt === 'ERROR') { this.onStatus('RPC rejected activity'); socket.destroy(); break; }
          if (payload.evt === 'READY') {
            wasReady = true; this.ready = true; socket.setTimeout(0);
            this.onStatus('RPC ready'); this.lastSent = 0; this.sent = undefined; this.flush();
          } else if (payload.nonce === this.pending?.nonce) {
            clearTimeout(this.ackTimer); this.pending = undefined; this.flush();
          }
        }
      } catch { socket.destroy(); }
    });
    socket.on('close', () => {
      this.ready = false; this.pending = undefined;
      clearTimeout(this.ackTimer); clearTimeout(this.sendTimer);
      if (this.closed) return;
      if (!wasReady && index + 1 < this.paths.length) this.connect(index + 1);
      else {
        this.onStatus('RPC disconnected; retrying');
        this.retryTimer = setTimeout(() => this.connect(0), this.retryDelay);
        this.retryDelay = Math.min(this.retryDelay * 2, 30000);
      }
    });
  }
  update(activity) { this.desired = discordActivity(activity); this.flush(); }
  flush() {
    if (!this.ready || this.closed || this.pending) return;
    const serialized = JSON.stringify(this.desired);
    if (serialized === this.sent) return;
    clearTimeout(this.sendTimer);
    // Privacy clears bypass rate coalescing. Normal updates stay below RPC limits.
    const delay = this.desired === null ? 0 : Math.max(0, this.interval - (Date.now() - this.lastSent));
    if (delay) { this.sendTimer = setTimeout(() => this.flush(), delay); return; }
    const nonce = randomUUID();
    this.pending = { nonce }; this.sent = serialized; this.lastSent = Date.now();
    this.socket.write(frame(1, { cmd: 'SET_ACTIVITY', args: { pid: process.pid, activity: this.desired }, nonce }));
    this.ackTimer = setTimeout(() => this.socket.destroy(), 3000);
  }
  async stop() {
    const lifecycle = this.lifecycle;
    this.update(null);
    const deadline = Date.now() + 1000;
    while (this.ready && (this.pending || this.sent !== 'null') && Date.now() < deadline) await new Promise(r => setTimeout(r, 20));
    if (lifecycle !== this.lifecycle) return;
    this.closed = true;
    clearTimeout(this.retryTimer); clearTimeout(this.sendTimer); clearTimeout(this.ackTimer);
    this.socket?.destroy();
  }
}
