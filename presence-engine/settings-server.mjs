import { createServer } from 'node:http';
import { randomBytes, timingSafeEqual } from 'node:crypto';
import { readFileSync, renameSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { readControls, readRuntimeStatus, updateAgent, updateApp, updateBehavior, updateGeneral, updateIdle } from './controls.mjs';

// Local settings app. Listens on loopback only, and every request needs the per-run token that the
// helper reads from settings-session.json. Host and Origin are checked so web pages cannot reach it.
const page = fileURLToPath(new URL('./settings-ui.html', import.meta.url));
const actions = {
  app: (root, body) => updateApp(root, body),
  idle: (root, body) => updateIdle(root, body.seconds),
  behavior: (root, body) => updateBehavior(root, body),
  agent: (root, body) => updateAgent(root, body),
  general: (root, body) => updateGeneral(root, body)
};

export function state(root) {
  let runtime = null;
  try { runtime = readRuntimeStatus(root); } catch { /* Settings still work without live status. */ }
  return { controls: readControls(root), runtime };
}

export async function startSettingsServer({ root, port = 43822 }) {
  const token = randomBytes(24).toString('hex');
  const valid = value => typeof value === 'string' && value.length === token.length && timingSafeEqual(Buffer.from(value), Buffer.from(token));
  const send = (res, status, body, type = 'application/json') => {
    res.writeHead(status, { 'content-type': `${type}; charset=utf-8`, 'cache-control': 'no-store', 'x-content-type-options': 'nosniff', 'referrer-policy': 'no-referrer', 'content-security-policy': "default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; connect-src 'self'; img-src 'self' data:; base-uri 'none'; form-action 'none'; frame-ancestors 'none'" });
    res.end(typeof body === 'string' ? body : JSON.stringify(body));
  };
  const server = createServer((req, res) => {
    const origin = `127.0.0.1:${server.address().port}`;
    const url = new URL(req.url, `http://${origin}`);
    if (req.headers.host !== origin || (req.headers.origin && req.headers.origin !== `http://${origin}`)) return send(res, 403, { error: 'forbidden' });
    if (req.method === 'GET' && url.pathname === '/') {
      if (!valid(url.searchParams.get('t'))) return send(res, 403, { error: 'forbidden' });
      return send(res, 200, readFileSync(page, 'utf8').replace('__EP_TOKEN__', token), 'text/html');
    }
    if (!valid(req.headers['x-ep-token'])) return send(res, 403, { error: 'forbidden' });
    if (req.method === 'GET' && url.pathname === '/api/state') return send(res, 200, state(root));
    const action = url.pathname.startsWith('/api/') ? actions[url.pathname.slice(5)] : undefined;
    if (req.method !== 'POST' || !action || !/^application\/json/.test(req.headers['content-type'] ?? '')) return send(res, 404, { error: 'not found' });
    let body = '';
    req.on('data', chunk => { body += chunk; if (body.length > 16384) req.destroy(); });
    req.on('end', () => {
      try {
        action(root, JSON.parse(body));
        send(res, 200, state(root));
      } catch { send(res, 400, { error: 'That change was not accepted. Check the values and try again.' }); }
    });
  });
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(port, '127.0.0.1', resolve); });
  const address = server.address().port, link = `http://127.0.0.1:${address}/?t=${token}`;
  const file = join(root, 'settings-session.json'), temporary = `${file}.${process.pid}.tmp`;
  writeFileSync(temporary, JSON.stringify({ url: link }), { mode: 0o600 });
  renameSync(temporary, file);
  return { url: link, close: () => server.close() };
}
