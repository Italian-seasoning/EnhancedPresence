import test from 'node:test';
import assert from 'node:assert/strict';
import { extractAccent, contrastRatio } from '../vencord-plugin/EnhancedPresenceUniversal/palette.mjs';

const solid = (r, g, b, count = 16) => Uint8ClampedArray.from({ length: count * 4 }, (_, i) => [r, g, b, 255][i % 4]);

test('uses a safe Apple blue when artwork is absent or unusable', () => {
  assert.deepEqual(extractAccent(null), { accent: '#006FE6', foreground: '#FFFFFF' });
  assert.deepEqual(extractAccent(new Uint8ClampedArray([1, 2, 3])), { accent: '#006FE6', foreground: '#FFFFFF' });
  assert.deepEqual(extractAccent(solid(128, 128, 128)), { accent: '#006FE6', foreground: '#FFFFFF' });
  assert.ok(contrastRatio('#006FE6', '#FFFFFF') >= 4.5);
});

test('chooses saturated visible artwork and provides readable text', () => {
  const pixels = Uint8ClampedArray.from([
    ...Array(48).fill([250, 250, 250, 255]).flat(),
    ...Array(12).fill([12, 126, 246, 255]).flat()
  ]);
  const result = extractAccent(pixels);
  assert.equal(result.accent, '#0C7EF6');
  assert.ok(['#000000', '#FFFFFF'].includes(result.foreground));
  assert.ok(contrastRatio(result.accent, result.foreground) >= 4.5);
});

test('ignores transparent artwork and bounds malformed inputs', () => {
  assert.deepEqual(extractAccent(solid(245, 40, 80).map((v, i) => i % 4 === 3 ? 0 : v)), { accent: '#006FE6', foreground: '#FFFFFF' });
  assert.deepEqual(extractAccent({ length: 8_000_000, 0: 1 }), { accent: '#006FE6', foreground: '#FFFFFF' });
  assert.ok(contrastRatio('not-a-color', '#fff') >= 4.5);
});
