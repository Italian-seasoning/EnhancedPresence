import test from 'node:test';
import assert from 'node:assert/strict';
import { createNotificationRouter, matchNotificationRule, previewNotificationRule, shouldShowDesktopNotification, validateNotificationRules } from '../vencord-plugin/EnhancedPresenceUniversal/notification-rules.mjs';

const rule = (fields = {}) => ({ id: 'rule-1', enabled: true, action: 'mute', ...fields });
const message = (fields = {}) => ({ id: '900', userId: '100', channelId: '200', authorId: '300', authorName: 'Riley', channelName: 'general', content: 'Hello there', ...fields });

test('validates bounded explicit rules and rejects unsafe matchers', () => {
  assert.deepEqual(validateNotificationRules([rule({ personId: '300' })]), [rule({ personId: '300' })]);
  assert.throws(() => validateNotificationRules([rule()]), /criterion/);
  assert.throws(() => validateNotificationRules([rule({ regex: '.*' })]), /rule/);
  assert.throws(() => validateNotificationRules(Array.from({ length: 25 }, (_, i) => rule({ id: `rule-${i}`, channelId: '200' }))), /Too many/);
});

test('matches configured person, channel and literal keyword criteria conjunctively', () => {
  const configured = rule({ personId: '300', channelId: '200', keyword: 'launch day' });
  assert.equal(matchNotificationRule([configured], message({ content: 'LAUNCH DAY is today' }))?.id, 'rule-1');
  assert.equal(matchNotificationRule([configured], message({ channelId: '201' })), null);
  assert.equal(matchNotificationRule([configured], message({ authorId: '301' })), null);
  assert.equal(matchNotificationRule([configured], message({ content: 'launch the product' })), null);
});

test('preview and runtime use the same safe matcher', () => {
  const configured = rule({ channelId: '200', action: 'group' });
  assert.deepEqual(previewNotificationRule(configured, message()), { matches: true, action: 'group' });
  assert.deepEqual(previewNotificationRule(configured, message({ channelId: '201' })), { matches: false, action: null });
  assert.deepEqual(previewNotificationRule({ ...configured, keyword: '[' }, message()), { matches: false, action: null });
});

test('router leaves messages untouched while disabled, stopped, unknown or unmatched', () => {
  let enabled = false;
  const router = createNotificationRouter({ getRules: () => [rule({ channelId: '200' })], getEnabled: () => enabled });
  assert.equal(router.route(message()), 'notify');
  enabled = true;
  assert.equal(router.route(null), 'notify');
  assert.equal(router.route(message({ channelId: '201' })), 'notify');
  router.start();
  router.stop();
  assert.equal(router.route(message()), 'notify');
});

test('only an explicit matching mute rule suppresses a desktop notification', () => {
  const router = createNotificationRouter({ getRules: () => [rule({ channelId: '200' })], getEnabled: () => true });
  router.start();
  assert.equal(router.route(message()), 'muted');
  assert.equal(router.route(message({ authorId: '301', channelId: '201' })), 'notify');
  assert.equal(router.route(message({ mentionEveryone: true, channelId: '201' })), 'notify');
});

test('Discord message adapter suppresses only a matched rule and fails open for unknown data', () => {
  const router = createNotificationRouter({ getRules: () => [rule({ action: 'group', channelId: '200' })], getEnabled: () => true });
  router.start();
  const raw = { id: '901', channel_id: '200', author: { id: '300', username: 'Riley' }, content: 'Hello' };
  assert.equal(shouldShowDesktopNotification(raw, router, { getChannel: () => ({ name: 'general' }), currentUserId: '100' }), false);
  assert.equal(shouldShowDesktopNotification(raw, router, { currentUserId: '300' }), true);
  assert.equal(shouldShowDesktopNotification({ ...raw, channel_id: undefined }, router), true);
  assert.equal(shouldShowDesktopNotification(null, router), true);
  assert.equal(shouldShowDesktopNotification(raw, router, { getChannel() { throw Error('unavailable'); } }), true);
});

test('group rules coalesce locally without retaining message content', () => {
  let now = 1000;
  const groups = [];
  const router = createNotificationRouter({
    getRules: () => [rule({ action: 'group', channelId: '200' })],
    getEnabled: () => true,
    emitGroup: value => groups.push(value),
    now: () => now
  });
  router.start();
  assert.equal(router.route(message()), 'grouped');
  now += 1000;
  assert.equal(router.route(message({ id: '901', content: 'Private follow-up' })), 'grouped');
  assert.equal(groups.length, 2);
  assert.equal(groups.at(-1).count, 2);
  assert.equal(groups.at(-1).authorId, '300');
  assert.equal(Object.hasOwn(groups.at(-1), 'content'), false);
  assert.equal(router.snapshot()[0].count, 2);
});

test('group inbox is capped and cleared when the module stops', () => {
  const groups = [];
  const router = createNotificationRouter({
    getRules: () => [rule({ action: 'group', personId: '300' })],
    getEnabled: () => true,
    emitGroup: value => groups.push(value),
    maxGroups: 2
  });
  router.start();
  for (let i = 0; i < 3; i++) router.route(message({ id: String(900 + i), channelId: String(200 + i) }));
  assert.equal(router.snapshot().length, 2);
  router.stop();
  assert.deepEqual(router.snapshot(), []);
});
