import assert from 'node:assert/strict';
import test from 'node:test';
import { isRepeatedAuthor } from '../vencord-plugin/EnhancedPresenceUniversal/message-layout.mjs';

const base = { channel_id: '100000000000000001', author: { id: '200000000000000001' }, type: 0, timestamp: new Date(2026, 10, 1, 12) };
const message = (id, fields = {}) => ({ ...base, id: String(id), ...fields });
const first = message('300000000000000001');
const second = message('300000000000000002', { timestamp: new Date(2026, 10, 1, 12, 23) });

test('consecutive cached messages share one avatar across native timed group breaks', () => {
  assert.equal(isRepeatedAuthor([first, second], first), false);
  assert.equal(isRepeatedAuthor([first, second], second), true);
  const reply = { ...second, type: 19 };
  assert.equal(isRepeatedAuthor([first, reply], reply), true);
});

test('sender, channel, day, system and webhook boundaries keep the avatar', () => {
  for (const fields of [
    { author: { id: '200000000000000002' } },
    { channel_id: '100000000000000002' },
    { timestamp: new Date(2026, 10, 2, 12) },
    { timestamp: new Date(2026, 9, 31, 12) },
    { type: 7 }, { blocked: true }, { webhookId: '400000000000000001' }, { webhook_id: '400000000000000001' }
  ]) {
    const current = { ...second, ...fields };
    assert.equal(isRepeatedAuthor([first, current], current), false, JSON.stringify(fields));
    const previous = { ...first, ...fields };
    assert.equal(isRepeatedAuthor([previous, second], second), false, JSON.stringify(fields));
  }
});

test('missing history, invalid metadata and uncached messages leave identity visible', () => {
  for (const messages of [undefined, [], [first]]) assert.equal(isRepeatedAuthor(messages, second), false);
  for (const fields of [{ id: 'pending' }, { author: null }, { timestamp: new Date(NaN) }, { channel_id: null }]) {
    const current = { ...second, ...fields };
    assert.equal(isRepeatedAuthor([first, current], current), false);
  }
});

test('predecessor lookup reads logarithmically rather than scanning every message per row', () => {
  let reads = 0;
  const messages = new Proxy(Array.from({ length: 4096 }, (_, i) => message(String(300000000000000000n + BigInt(i)))), {
    get(target, key, receiver) { if (/^\d+$/.test(String(key))) reads++; return Reflect.get(target, key, receiver); }
  });
  const current = messages[2048];
  reads = 0;
  assert.equal(isRepeatedAuthor(messages, current), true);
  assert.ok(reads < 20, `read ${reads} messages`);
});
