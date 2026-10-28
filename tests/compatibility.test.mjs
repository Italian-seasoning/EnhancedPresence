import test from 'node:test';
import assert from 'node:assert/strict';
import { fixActivityFilter, preserveActivityRecalculation } from '../vencord-plugin/EnhancedPresenceUniversal/compatibility.mjs';

test('activity filtering preserves Discord return-expression recalculation', () => {
  const tail = 'items.push(activity),items=items.filter($self.isActivityNotIgnored);';
  const source = `return ${preserveActivityRecalculation(tail)} (retained.value=items,true)`;
  const recalculate = new Function('items', 'activity', '$self', 'retained', source);
  const retained = { value: [] };
  assert.equal(recalculate([], { name: 'TextEdit' }, { isActivityNotIgnored: () => true }, retained), true);
  assert.deepEqual(retained.value, [{ name: 'TextEdit' }]);
  recalculate([], { name: 'Blocked app' }, { isActivityNotIgnored: () => false }, retained);
  assert.deepEqual(retained.value, []);
});
test('compatibility fix targets only the known IgnoreActivities patch', () => {
  const plugin = { patches: [{ find: '"LocalActivityStore"', replacement: [{ replace: (match, activities) => `${match}${activities}=${activities}.filter($self.isActivityNotIgnored);` }] }] };
  assert.equal(fixActivityFilter(plugin), true);
  assert.equal(plugin.patches[0].replacement[0].replace('return ', 'items'), 'return items=items.filter($self.isActivityNotIgnored),');
  assert.equal(fixActivityFilter(plugin), false);
  assert.equal(fixActivityFilter({ patches: [{ find: 'unrelated', replacement: { replace: () => 'unchanged;' } }] }), false);
});
