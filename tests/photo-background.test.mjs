import assert from 'node:assert/strict';
import test from 'node:test';
import { prepareBackgroundPhoto } from '../vencord-plugin/EnhancedPresenceUniversal/photo-background.mjs';

test('photo backgrounds reject remote, SVG, empty and oversized input before decoding', async () => {
  for (const file of [null, { type: 'image/svg+xml', size: 100 }, { type: 'image/png', size: 0 }, { type: 'image/jpeg', size: 4000001 }]) {
    await assert.rejects(prepareBackgroundPhoto(file), /PNG, JPEG or WebP/);
  }
});

function browser(t, { width = 4000, height = 2000, decodeError = false } = {}) {
  const previous = { Image: globalThis.Image, document: globalThis.document };
  const revoked = [], drawn = [];
  const normalized = `data:image/webp;base64,${Buffer.from('RIFF0000WEBPnormalized').toString('base64')}`;
  t.mock.method(URL, 'createObjectURL', () => 'blob:local-photo');
  t.mock.method(URL, 'revokeObjectURL', value => revoked.push(value));
  globalThis.Image = class {
    naturalWidth = width; naturalHeight = height;
    async decode() { if (decodeError) throw Error('decode failed'); }
  };
  const canvas = { width: 0, height: 0,
    getContext: () => ({ drawImage: (...args) => drawn.push(args.slice(1)) }),
    toDataURL: type => { assert.equal(type, 'image/webp'); return normalized; }
  };
  globalThis.document = { createElement: name => { assert.equal(name, 'canvas'); return canvas; } };
  t.after(() => {
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) delete globalThis[key]; else globalThis[key] = value;
    }
  });
  return { revoked, drawn, normalized, canvas };
}

test('photos are resized to bounded WebP and temporary image URLs are released', async t => {
  const view = browser(t);
  const result = await prepareBackgroundPhoto({ type: 'image/jpeg', size: 1000 });
  assert.deepEqual(result, { kind: 'photo', data: view.normalized });
  assert.deepEqual(view.drawn, [[0, 0, 1280, 640]]);
  assert.deepEqual(view.revoked, ['blob:local-photo']);
});

test('excessive pixel dimensions release the local URL without drawing', async t => {
  const view = browser(t, { width: 8000, height: 8000 });
  await assert.rejects(prepareBackgroundPhoto({ type: 'image/png', size: 1000 }), /megapixels/);
  assert.deepEqual(view.drawn, []);
  assert.deepEqual(view.revoked, ['blob:local-photo']);
});

test('failed image decoding also releases the local URL', async t => {
  const view = browser(t, { decodeError: true });
  await assert.rejects(prepareBackgroundPhoto({ type: 'image/webp', size: 1000 }), /decode failed/);
  assert.deepEqual(view.revoked, ['blob:local-photo']);
  assert.deepEqual(view.drawn, []);
});
