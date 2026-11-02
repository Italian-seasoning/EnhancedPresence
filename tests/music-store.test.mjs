import test from 'node:test';
import assert from 'node:assert/strict';
import { storeCountryFromStorefront } from '../vencord-plugin/EnhancedPresenceUniversal/music-store.mjs';

test('maps Apple Music storefront identifiers to store countries', () => {
  for (const [identifier, country] of [['143455-6,42', 'CA'], ['143441-1,32', 'US'], ['143441', 'US'], ['143444-2,32', 'GB'], ['143503-15,32', 'BR'], ['143462-9,32', 'JP']]) {
    assert.equal(storeCountryFromStorefront(identifier), country, identifier);
  }
});

test('returns null for unknown or malformed storefronts so callers fall back to the Mac region', () => {
  for (const identifier of ['', '999999-1,32', '1434555', '14345', 'CA', ' 143455', '143455x', null, undefined, 143455, `143455-${'9'.repeat(64)}`]) {
    assert.equal(storeCountryFromStorefront(identifier), null, String(identifier));
  }
});
