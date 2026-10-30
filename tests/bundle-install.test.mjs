import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { accessSync, chmodSync, constants, copyFileSync, cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, renameSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { installBundle, parseArguments, restoreSnapshot, uninstallBundle, validatePayload } from '../scripts/bundle-setup.mjs';
import { buildLoader } from '../scripts/vencord-deploy.mjs';
const discordInfo = '<?xml version="1.0" encoding="UTF-8"?><!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd"><plist version="1.0"><dict><key>CFBundleIdentifier</key><string>com.hnc.Discord</string></dict></plist>';

function makePayload(root) {
  const resources = [
    'runtime/node', 'presence-engine/install.mjs', 'presence-engine/repair.mjs', 'presence-engine/main.mjs',
    'presence-engine/profiles.mjs', 'presence-engine/hooks.mjs', 'presence-engine/agent-hook.sh',
    'shared/protocol.mjs', 'vendor/ws/wrapper.mjs', 'vendor/mediaremote-adapter/bin/mediaremote-adapter.pl', 'vendor/mediaremote-adapter/LICENSE',
    'build/detector', 'build/MediaRemoteAdapter.framework/Versions/A/MediaRemoteAdapter',
    'scripts/bundle-setup.mjs', 'scripts/vencord-deploy.mjs', 'scripts/install-vencord.mjs', 'tools/VencordInstallerCli-darwin',
    'vencord/package.json', 'vencord/REVISION', 'vencord/dist/patcher.js', 'vencord/dist/preload.js',
    'vencord/dist/renderer.js'
  ];
  const files = [...resources.map(file => `Contents/Resources/${file}`), 'Contents/Info.plist', 'Contents/MacOS/EnhancedPresenceHelper', 'Contents/_CodeSignature/CodeResources'];
  for (const file of files) {
    const path = join(root, file); mkdirSync(join(path, '..'), { recursive: true });
    writeFileSync(path, file.endsWith('package.json') ? '{"name":"vencord"}' : file.endsWith('Info.plist') ? '<plist><dict><key>CFBundleIdentifier</key><string>app.enhancedpresence.helper</string><key>CFBundleExecutable</key><string>EnhancedPresenceHelper</string></dict></plist>' : file.endsWith('renderer.js') ? 'EnhancedPresenceUniversal' : file.endsWith('/REVISION') ? 'a'.repeat(40) : file.endsWith('/runtime/node') ? readFileSync(process.execPath) : 'fixture');
  }
  for (const name of ['install.mjs', 'profiles.mjs', 'hooks.mjs', 'agent-hook.sh', 'repair.mjs']) copyFileSync(new URL(`../presence-engine/${name}`, import.meta.url), join(root, 'Contents/Resources/presence-engine', name));
  copyFileSync(new URL('../scripts/vencord-deploy.mjs', import.meta.url), join(root, 'Contents/Resources/scripts/vencord-deploy.mjs'));
  for (const path of ['Contents/Resources/runtime/node', 'Contents/Resources/tools/VencordInstallerCli-darwin', 'Contents/Resources/build/detector', 'Contents/Resources/build/MediaRemoteAdapter.framework/Versions/A/MediaRemoteAdapter', 'Contents/MacOS/EnhancedPresenceHelper']) chmodSync(join(root, path), 0o755);
  const fileHashes = Object.fromEntries(files.map(file => [file, createHash('sha256').update(readFileSync(join(root, file))).digest('hex')]));
  writeFileSync(join(root, '..', '..', 'release.json'), JSON.stringify({ schema: 1, version: '0.9.0-beta.1', arch: process.arch, minimumMacOS: '10.0', nodeVersion: process.versions.node, vencordRevision: 'a'.repeat(40), files: fileHashes }));
  return files;
}

test('bundle CLI rejects missing values and unsafe paths before install', () => {
  assert.throws(() => parseArguments(['install', '--application-id']), /requires a value/);
  assert.throws(() => parseArguments(['install', '--home', 'relative']), /absolute path/);
  assert.throws(() => parseArguments(['install', '--application-id', 'token']), /17 to 20 digits/);
  assert.equal(parseArguments(['install', '--application-id', '123456789012345678']).withHooks, false);
  assert.equal(parseArguments(['install', '--application-id', '123456789012345678', '--standalone', '--with-hooks']).withHooks, true);
});

test('release validation checks pinned files, architecture and helper structure', () => {
  const scratch = mkdtempSync(join(tmpdir(), 'ep-payload-'));
  const payload = join(scratch, 'payload', 'EnhancedPresence Helper.app');
  try {
    makePayload(payload);
    assert.equal(validatePayload(payload, { arch: process.arch, nodeVersion: process.versions.node, macVersion: '15.0' }).version, '0.9.0-beta.1');
    assert.throws(() => validatePayload(payload, { arch: 'mismatch', nodeVersion: process.versions.node, macVersion: '15.0' }), /architecture/);
    writeFileSync(join(payload, 'Contents/Resources/vencord/dist/renderer.js'), 'tampered');
    assert.throws(() => validatePayload(payload, { arch: process.arch, nodeVersion: process.versions.node, macVersion: '15.0' }), /hash/);
  } finally { rmSync(scratch, { recursive: true, force: true }); }
});

test('release validation rejects symlinks that leave the signed helper bundle', () => {
  const scratch = mkdtempSync(join(tmpdir(), 'ep-payload-link-')), payload = join(scratch, 'EnhancedPresence Helper.app');
  try {
    makePayload(payload);
    symlinkSync('/etc/passwd', join(payload, 'Contents/Resources/vendor/ws/escape'));
    assert.throws(() => validatePayload(payload, { arch: process.arch, nodeVersion: process.versions.node, macVersion: '15.0' }), /symlink/);
  } finally { rmSync(scratch, { recursive: true, force: true }); }
});

test('failed archive restore leaves the original file and snapshot intact', () => {
  const root = mkdtempSync(join(tmpdir(), 'ep-restore-')), target = join(root, 'app.asar'), backup = join(root, 'app.asar.snapshot');
  try {
    writeFileSync(target, 'current Discord archive'); writeFileSync(backup, 'saved Discord archive');
    assert.throws(() => restoreSnapshot(target, backup, { rename: (from, to) => {
      if (to === target) { const error = Error('protected destination'); error.code = 'EPERM'; throw error; }
      renameSync(from, to);
    } }), /protected destination/);
    assert.equal(readFileSync(target, 'utf8'), 'current Discord archive');
    assert.equal(readFileSync(backup, 'utf8'), 'saved Discord archive');
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('install stages the signed helper app, preserves settings, and records a receipt', async () => {
    const scratch = mkdtempSync(join(tmpdir(), 'ep-bundle-')), payload = join(scratch, 'payload/EnhancedPresence Helper.app'), home = join(scratch, 'home'), resources = join(scratch, 'Discord.app/Contents/Resources');
  try {
    makePayload(payload); mkdirSync(home); mkdirSync(resources, { recursive: true });
    const settings = join(home, 'Library/Application Support/EnhancedPresence/config.local.json');
    mkdirSync(join(settings, '..'), { recursive: true }); writeFileSync(settings, '{"enabled":false}', { mode: 0o600 });
    const archive = Buffer.concat([Buffer.from('fake discord archive'), Buffer.alloc(2048)]);
    writeFileSync(join(resources, 'app.asar'), archive);
    writeFileSync(join(scratch, 'Discord.app/Contents/Info.plist'), discordInfo);
    mkdirSync(join(home, 'Applications/EnhancedPresence Helper.app/Contents'), { recursive: true });
    const helperAppPath = join(home, 'Applications/EnhancedPresence Helper.app');
    writeFileSync(join(helperAppPath, 'Contents/Info.plist'), '<plist><dict><key>CFBundleIdentifier</key><string>app.enhancedpresence.helper</string></dict></plist>');
    writeFileSync(join(home, 'Library/Application Support/EnhancedPresence/bundle-receipt.json'), JSON.stringify({ schema: 1, helperPath: helperAppPath }), { mode: 0o600 });
    writeFileSync(join(home, 'Applications/EnhancedPresence Helper.app/Contents/old'), 'old app');
    const calls = []; let activationArgs, activationEnvironment, deployedNode;
    await installBundle({ payloadRoot: payload, home, resources, runtimeNode: process.execPath, applicationId: '123456789012345678', noStart: true,
      runInstaller: args => calls.push(args), deployFn: async (_checkout, options) => { deployedNode = options.nodePath; return { changed: true }; },
      activate: (_file, args, env) => { activationArgs = args; activationEnvironment = env; }, verifySignature() {} });
    const helper = join(home, 'Applications/EnhancedPresence Helper.app/Contents/Info.plist');
    assert.equal(readFileSync(helper, 'utf8').includes('EnhancedPresenceHelper'), true);
    assert.equal(readFileSync(settings, 'utf8'), '{"enabled":false}');
    assert.equal(calls.length, 1); assert.equal(existsSync(join(home, 'Applications/EnhancedPresence Helper.app/Contents/old')), false);
    assert.deepEqual(activationArgs.slice(0, 2), ['-install', '-location']);
    assert.equal(activationEnvironment.VENCORD_DEV_INSTALL, '1');
    const support = join(home, 'Library/Application Support/EnhancedPresence');
    assert.equal(JSON.parse(readFileSync(join(support, 'bundle-receipt.json'))).version, '0.9.0-beta.1');
    assert.equal(JSON.parse(readFileSync(join(home, 'Library/Application Support/Vencord/settings/settings.json'))).plugins.EnhancedPresenceUniversal.enabled, true);
    const installedNode = join(helper.replace('/Contents/Info.plist', ''), 'Contents/Resources/runtime/node');
    assert.equal(calls[0][calls[0].indexOf('--node-path') + 1], installedNode);
    assert.equal(deployedNode, installedNode);
  } finally { rmSync(scratch, { recursive: true, force: true }); }
});

test('matching loader skips Vencord activation and Discord write access checks', async () => {
  const scratch = mkdtempSync(join(tmpdir(), 'ep-matching-loader-')), payload = join(scratch, 'payload/EnhancedPresence Helper.app'), home = join(scratch, 'home'), resources = join(scratch, 'Discord.app/Contents/Resources');
  try {
    makePayload(payload); mkdirSync(resources, { recursive: true }); writeFileSync(join(scratch, 'Discord.app/Contents/Info.plist'), discordInfo);
    const dist = join(home, 'Library/Application Support/Vencord/dist'); mkdirSync(dist, { recursive: true }); writeFileSync(join(dist, 'patcher.js'), 'patcher');
    const loader = buildLoader(join(dist, 'patcher.js'));
    writeFileSync(join(resources, 'app.asar'), loader);
    writeFileSync(join(resources, '_app.asar'), Buffer.concat([buildLoader('/discord/original.js'), Buffer.alloc(2048)]));
    chmodSync(resources, 0o555);
    let activated = 0;
    await installBundle({ payloadRoot: payload, home, resources, runtimeNode: process.execPath, applicationId: '123456789012345678', noStart: true,
      activate() { activated++; }, deployFn: async () => ({ changed: false }), verifySignature() {} });
    assert.equal(activated, 0); assert.deepEqual(readFileSync(join(resources, 'app.asar')), loader);
  } finally { try { chmodSync(resources, 0o755); } catch {} rmSync(scratch, { recursive: true, force: true }); }
});

test('fresh patch write denial is detected before app or support files are changed', async () => {
  const scratch = mkdtempSync(join(tmpdir(), 'ep-discord-permission-')), payload = join(scratch, 'payload/EnhancedPresence Helper.app'), home = join(scratch, 'home'), resources = join(scratch, 'Discord.app/Contents/Resources');
  try {
    makePayload(payload); mkdirSync(resources, { recursive: true }); writeFileSync(join(scratch, 'Discord.app/Contents/Info.plist'), discordInfo);
    writeFileSync(join(resources, 'app.asar'), Buffer.alloc(2048)); chmodSync(resources, 0o555);
    await assert.rejects(installBundle({ payloadRoot: payload, home, resources, runtimeNode: process.execPath, applicationId: '123456789012345678', noStart: true, verifySignature() {} }), /not writable/);
    assert.equal(existsSync(join(home, 'Applications/EnhancedPresence Helper.app')), false);
    assert.equal(existsSync(join(home, 'Library/Application Support/EnhancedPresence/config.local.json')), false);
  } finally { try { chmodSync(resources, 0o755); } catch {} rmSync(scratch, { recursive: true, force: true }); }
});

test('invalid payload and failed install leave the existing helper app intact', async () => {
  const scratch = mkdtempSync(join(tmpdir(), 'ep-bundle-rollback-')), payload = join(scratch, 'payload/EnhancedPresence Helper.app'), home = join(scratch, 'home');
  try {
    makePayload(payload); mkdirSync(join(home, 'Applications'), { recursive: true });
    const target = join(home, 'Applications/EnhancedPresence Helper.app'); mkdirSync(target);
    writeFileSync(join(target, 'sentinel'), 'old');
    writeFileSync(join(payload, 'Contents/Resources/build/detector'), 'tampered');
    await assert.rejects(installBundle({ payloadRoot: payload, home, applicationId: '123456789012345678', noStart: true, runInstaller() {}, deployFn() {}, activate() {}, verifySignature() {} }), /hash/);
    assert.equal(readFileSync(join(target, 'sentinel'), 'utf8'), 'old');
    makePayload(payload);
    mkdirSync(join(target, 'Contents'), { recursive: true });
    writeFileSync(join(target, 'Contents/Info.plist'), '<plist><dict><key>CFBundleIdentifier</key><string>app.enhancedpresence.helper</string></dict></plist>');
    mkdirSync(join(home, 'Library/Application Support/EnhancedPresence'), { recursive: true });
    writeFileSync(join(home, 'Library/Application Support/EnhancedPresence/bundle-receipt.json'), JSON.stringify({ schema: 1, helperPath: target }), { mode: 0o600 });
    mkdirSync(join(home, '.claude'), { recursive: true }); mkdirSync(join(home, '.codex'), { recursive: true });
    const userHooks = { hooks: { Stop: [{ hooks: [{ type: 'command', command: 'echo keep' }] }] } };
    const claudeFile = join(home, '.claude/settings.json'), codexFile = join(home, '.codex/hooks.json');
    writeFileSync(claudeFile, JSON.stringify(userHooks)); writeFileSync(codexFile, JSON.stringify(userHooks));
    const resources = join(scratch, 'Discord.app/Contents/Resources'); mkdirSync(resources, { recursive: true });
    writeFileSync(join(resources, 'app.asar'), Buffer.alloc(2048)); writeFileSync(join(scratch, 'Discord.app/Contents/Info.plist'), discordInfo);
    await assert.rejects(installBundle({ payloadRoot: payload, home, runtimeNode: process.execPath, applicationId: '123456789012345678', resources, withHooks: true, noStart: true,
      deployFn() { throw Error('simulated deploy failure'); }, activate() {}, verifySignature() {} }), /simulated deploy failure/);
    assert.equal(readFileSync(join(target, 'sentinel'), 'utf8'), 'old');
    assert.deepEqual(JSON.parse(readFileSync(claudeFile)), userHooks); assert.deepEqual(JSON.parse(readFileSync(codexFile)), userHooks);
    assert.equal(existsSync(`${claudeFile}.enhancedpresence.bak`), false); assert.equal(existsSync(`${codexFile}.enhancedpresence.bak`), false);
  } finally { rmSync(scratch, { recursive: true, force: true }); }
});

test('install refuses to replace an unrecognized helper app destination', async () => {
  const scratch = mkdtempSync(join(tmpdir(), 'ep-unrecognized-')), payload = join(scratch, 'payload/EnhancedPresence Helper.app'), home = join(scratch, 'home');
  try {
    makePayload(payload); const target = join(home, 'Applications/EnhancedPresence Helper.app');
    mkdirSync(target, { recursive: true }); writeFileSync(join(target, 'keep'), 'user file');
    await assert.rejects(installBundle({ payloadRoot: payload, home, runtimeNode: process.execPath, applicationId: '123456789012345678', standalone: true, noStart: true, verifySignature() {} }), /unrecognized app/);
    assert.equal(readFileSync(join(target, 'keep'), 'utf8'), 'user file');
  } finally { rmSync(scratch, { recursive: true, force: true }); }
});

test('an unchecked hook option preserves the prior opt-in so uninstall still removes our hooks', async () => {
  const scratch = mkdtempSync(join(tmpdir(), 'ep-hook-update-')), payload = join(scratch, 'payload/EnhancedPresence Helper.app'), home = join(scratch, 'home');
  try {
    makePayload(payload);
    const app = join(home, 'Applications/EnhancedPresence Helper.app'), support = join(home, 'Library/Application Support/EnhancedPresence');
    mkdirSync(join(app, 'Contents'), { recursive: true }); mkdirSync(join(support, 'presence-engine'), { recursive: true });
    writeFileSync(join(app, 'Contents/Info.plist'), '<plist><dict><key>CFBundleIdentifier</key><string>app.enhancedpresence.helper</string></dict></plist>');
    writeFileSync(join(support, 'presence-engine/hooks.mjs'), 'throw new Error("tampered installed hook module");');
    const receipt = join(support, 'bundle-receipt.json');
    writeFileSync(receipt, JSON.stringify({ schema: 1, helperPath: app, standalone: true, withHooks: true }), { mode: 0o600 });
    mkdirSync(join(home, '.claude'), { recursive: true });
    const claude = join(home, '.claude/settings.json');
    writeFileSync(claude, JSON.stringify({ hooks: { Stop: [
      { hooks: [{ type: 'command', command: 'echo keep' }] },
      { hooks: [{ type: 'command', command: '/bin/sh /old/agent-hook.sh' }] }
    ] } }));
    let installerArgs;
    await installBundle({ payloadRoot: payload, home, runtimeNode: process.execPath, applicationId: '123456789012345678', standalone: true, noStart: true,
      runInstaller: args => { installerArgs = args; }, verifySignature() {} });
    assert.ok(installerArgs.includes('--with-hooks'));
    assert.equal(JSON.parse(readFileSync(receipt)).withHooks, true);
    await uninstallBundle({ home, noStart: true });
    const hooks = JSON.parse(readFileSync(claude)).hooks;
    assert.equal(hooks.Stop.length, 1); assert.equal(hooks.Stop[0].hooks[0].command, 'echo keep');
  } finally { rmSync(scratch, { recursive: true, force: true }); }
});

test('uninstall removes owned runtime while preserving settings and Vencord', async () => {
  const scratch = mkdtempSync(join(tmpdir(), 'ep-uninstall-')), home = join(scratch, 'home');
  try {
    const support = join(home, 'Library/Application Support/EnhancedPresence');
    const app = join(home, 'Applications/EnhancedPresence Helper.app');
    const vc = join(home, 'Library/Application Support/Vencord/dist/renderer.js');
    mkdirSync(support, { recursive: true }); mkdirSync(app, { recursive: true }); mkdirSync(join(vc, '..'), { recursive: true });
    mkdirSync(join(app, 'Contents'), { recursive: true });
    writeFileSync(join(app, 'Contents/Info.plist'), '<plist><dict><key>CFBundleIdentifier</key><string>app.enhancedpresence.helper</string></dict></plist>');
    mkdirSync(join(home, 'Library/Application Support/Vencord/settings'), { recursive: true });
    mkdirSync(join(support, 'presence-engine'), { recursive: true });
    writeFileSync(join(support, 'presence-engine/hooks.mjs'), 'throw new Error("tampered installed hook module");');
    mkdirSync(join(home, '.claude'), { recursive: true }); mkdirSync(join(home, '.codex'), { recursive: true });
    const userHooks = { hooks: { Stop: [{ hooks: [{ type: 'command', command: 'echo keep' }] }, { hooks: [{ type: 'command', command: '/bin/sh agent-hook.sh' }] }] } };
    writeFileSync(join(home, '.claude/settings.json'), JSON.stringify(userHooks)); writeFileSync(join(home, '.codex/hooks.json'), JSON.stringify(userHooks));
    writeFileSync(join(support, 'bundle-receipt.json'), JSON.stringify({ schema: 1, helperPath: app, resources: '/Applications/Discord.app/Contents/Resources', standalone: true, withHooks: false }), { mode: 0o600 });
    writeFileSync(join(home, 'Library/Application Support/Vencord/settings/settings.json'), JSON.stringify({ plugins: { EnhancedPresenceUniversal: { enabled: true }, Other: { enabled: true } } }));
    writeFileSync(join(support, 'config.local.json'), '{}'); writeFileSync(join(support, 'bridge.local.json'), '{}');
    writeFileSync(join(support, 'usage.local.json'), '{"history":true}'); writeFileSync(join(support, 'settings-session.json'), '{"url":"local-token"}'); writeFileSync(vc, 'keep');
    await uninstallBundle({ home, noStart: true });
    assert.equal(existsSync(app), false); assert.equal(existsSync(join(support, 'presence-engine')), false);
    assert.equal(existsSync(join(support, 'config.local.json')), true); assert.equal(existsSync(join(support, 'bridge.local.json')), true);
    assert.equal(existsSync(join(support, 'usage.local.json')), true); assert.equal(existsSync(join(support, 'settings-session.json')), false);
    assert.equal(readFileSync(vc, 'utf8'), 'keep');
    const settings = JSON.parse(readFileSync(join(home, 'Library/Application Support/Vencord/settings/settings.json')));
    assert.equal(settings.plugins.EnhancedPresenceUniversal.enabled, false); assert.equal(settings.plugins.Other.enabled, true);
    assert.equal(JSON.parse(readFileSync(join(home, '.claude/settings.json'))).hooks.Stop.some(entry => entry.hooks.some(hook => hook.command === 'echo keep')), true);
    assert.equal(JSON.parse(readFileSync(join(home, '.claude/settings.json'))).hooks.Stop.some(entry => entry.hooks.some(hook => hook.command.includes('agent-hook'))), false);
  } finally { rmSync(scratch, { recursive: true, force: true }); }
});

test('uninstall refuses a symlinked support root without touching its target', async () => {
  const scratch = mkdtempSync(join(tmpdir(), 'ep-uninstall-link-')), home = join(scratch, 'home'), external = join(scratch, 'external');
  try {
    mkdirSync(join(home, 'Library/Application Support'), { recursive: true }); mkdirSync(external, { recursive: true });
    const app = join(home, 'Applications/EnhancedPresence Helper.app');
    mkdirSync(join(app, 'Contents'), { recursive: true });
    writeFileSync(join(app, 'Contents/Info.plist'), '<plist><dict><key>CFBundleIdentifier</key><string>app.enhancedpresence.helper</string></dict></plist>');
    mkdirSync(join(external, 'presence-engine'), { recursive: true });
    writeFileSync(join(external, 'bundle-receipt.json'), JSON.stringify({ schema: 1, helperPath: app }), { mode: 0o600 });
    writeFileSync(join(external, 'presence-engine/sentinel'), 'keep');
    symlinkSync(external, join(home, 'Library/Application Support/EnhancedPresence'));
    await assert.rejects(uninstallBundle({ home, noStart: true }), /settings folder is unsafe/);
    assert.equal(readFileSync(join(external, 'presence-engine/sentinel'), 'utf8'), 'keep');
    assert.equal(existsSync(app), true);
  } finally { rmSync(scratch, { recursive: true, force: true }); }
});
