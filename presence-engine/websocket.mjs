import { createServer } from 'node:http';
import { timingSafeEqual } from 'node:crypto';
import { WebSocketServer, WebSocket } from '../vendor/ws/wrapper.mjs';
import { message } from '../shared/protocol.mjs';

export class PresenceBridge {
  constructor(token, { port = 43821 } = {}) {
    if (!/^[a-f0-9]{64}$/.test(token)) throw Error('Bridge needs a 32-byte hex pairing key');
    this.token = token; this.port = port; this.activity = null;
    this.server = createServer((req, res) => { res.writeHead(404); res.end(); });
    this.ws = new WebSocketServer({ noServer: true, maxPayload: 1024, perMessageDeflate: false });
    this.server.on('upgrade', (req, socket, head) => {
      // Exact host/path/origin prevents browser pages from using the local service.
      const origins = new Set(['https://discord.com', 'https://canary.discord.com', 'https://ptb.discord.com']);
      if (req.socket.remoteAddress !== '127.0.0.1' || req.url !== '/' || req.headers.host !== `127.0.0.1:${this.server.address()?.port}` || !origins.has(req.headers.origin) || this.ws.clients.size >= 4) {
        socket.end('HTTP/1.1 403 Forbidden\r\nConnection: close\r\n\r\n'); return;
      }
      this.ws.handleUpgrade(req, socket, head, client => this.ws.emit('connection', client));
    });
    this.ws.on('connection', client => {
      client.authenticated = false;
      const deadline = setTimeout(() => client.close(1008, 'Pairing required'), 3000);
      client.on('error', () => {});
      client.on('close', () => clearTimeout(deadline));
      client.on('message', (bytes, binary) => {
        if (client.authenticated || binary) { client.close(1008, 'Read only'); return; }
        try {
          const hello = JSON.parse(bytes.toString());
          if (hello.type !== 'hello' || hello.protocol !== 1 || typeof hello.token !== 'string' || !/^[a-f0-9]{64}$/.test(hello.token) || !timingSafeEqual(Buffer.from(hello.token), Buffer.from(this.token))) throw Error();
          client.authenticated = true; clearTimeout(deadline);
          client.send(JSON.stringify(message(this.activity)));
        } catch { client.close(1008, 'Invalid pairing'); }
      });
    });
  }
  async start() {
    await new Promise((resolve, reject) => {
      const fail = error => reject(error);
      this.server.once('error', fail);
      this.server.listen(this.port, '127.0.0.1', () => { this.server.off('error', fail); resolve(); });
    });
    this.heartbeat = setInterval(() => this.broadcast({ type: 'heartbeat', protocol: 1 }), 15000);
    return this.server.address().port;
  }
  broadcast(payload) {
    const encoded = JSON.stringify(payload);
    for (const client of this.ws.clients) if (client.authenticated && client.readyState === WebSocket.OPEN) {
      if (client.bufferedAmount > 16384) client.terminate();
      else client.send(encoded);
    }
  }
  update(activity) { this.activity = activity; this.broadcast(message(activity)); }
  async stop() {
    clearInterval(this.heartbeat); this.update(null);
    for (const client of this.ws.clients) client.close(1000, 'Engine stopped');
    const timer = setTimeout(() => { for (const client of this.ws.clients) client.terminate(); }, 300);
    await new Promise(r => this.ws.close(r)); clearTimeout(timer);
    if (this.server.listening) await new Promise(r => this.server.close(r));
  }
}
