import assert from 'node:assert/strict';
import test from 'node:test';
import { backgroundKey, emptyBackgrounds, validateBackgrounds, setBackground, backgroundCss } from '../vencord-plugin/EnhancedPresenceUniversal/chat-backgrounds.mjs';

const account = '12345678901234567', chat = '23456789012345678';
const photo = `data:image/webp;base64,${Buffer.from('RIFF0000WEBPfixture').toString('base64')}`;

test('DM backgrounds are partitioned by account and changed only for the chosen chat', () => {
  const initial = emptyBackgrounds(account);
  const saved = setBackground(initial, chat, { kind: 'preset', id: 'sky' });
  assert.deepEqual(initial.chats, {});
  assert.deepEqual(saved.chats[chat], { kind: 'preset', id: 'sky' });
  assert.notEqual(backgroundKey(account), backgroundKey(chat));
  assert.throws(() => validateBackgrounds(saved, chat), /account/i);
  assert.deepEqual(setBackground(saved, chat, null).chats, {});
});

test('backgrounds accept only closed presets or bounded local WebP data, never paths, URLs or CSS', () => {
  assert.match(backgroundCss({ kind: 'preset', id: 'sky' }), /^linear-gradient/);
  assert.equal(backgroundCss({ kind: 'photo', data: photo }), `url("${photo}")`);
  for (const value of [
    { kind: 'preset', id: 'url(https://example.com)' },
    { kind: 'photo', data: 'https://example.com/image.webp' },
    { kind: 'photo', data: 'file:///private/photo.jpg' },
    { kind: 'photo', data: 'data:image/svg+xml;base64,PHN2Zz4=' },
    { kind: 'photo', data: 'data:image/webp;base64,AAAA' },
    { kind: 'photo', data: photo + 'A'.repeat(650000) },
    { kind: 'preset', id: 'sky', path: '/private/image' }
  ]) assert.throws(() => setBackground(emptyBackgrounds(account), chat, value));
  assert.throws(() => setBackground(emptyBackgrounds(account), '../chat', { kind: 'preset', id: 'sky' }));
});

test('background storage rejects extra fields and remains bounded across chats', () => {
  assert.throws(() => validateBackgrounds({ ...emptyBackgrounds(account), token: 'hidden' }, account));
  let value = emptyBackgrounds(account);
  for (let i = 0; i < 32; i++) value = setBackground(value, String(12345678901234000n + BigInt(i)), { kind: 'preset', id: 'sage' });
  assert.throws(() => setBackground(value, chat, { kind: 'preset', id: 'sky' }), /limit/i);
  const large = { kind: 'photo', data: `data:image/webp;base64,${Buffer.concat([Buffer.from('RIFF0000WEBP'), Buffer.alloc(420000)]).toString('base64')}` };
  value = emptyBackgrounds(account);
  for (let i = 0; i < 10; i++) value = setBackground(value, String(12345678901234000n + BigInt(i)), large);
  assert.throws(() => setBackground(value, chat, large), /limit/i);
});
