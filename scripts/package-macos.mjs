import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { chmodSync, cpSync, existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { VENCORD_REV } from './quickstart.mjs';
import { APPLE_MUSIC_AUTOMATION_DESCRIPTION } from '../shared/helper-metadata.mjs';

export const NODE_VERSION = 'v24.22.2';
export const MINIMUM_MACOS = '13.5';
export const INSTALLER_VERSION = '1.4.2';
const INSTALLER_SHA256 = 'f4c77a9dddd4a12deaae270b3dadfda25969dfcfa141cc2354cafe6344044b75';
const source = fileURLToPath(new URL('..', import.meta.url));
const digest = bytes => createHash('sha256').update(bytes).digest('hex');
const xml = text => text.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;');
const run = (command, args, cwd = source) => execFileSync(command, args, { cwd, stdio: 'inherit' });

export function verifyDownload(bytes, expected, name) {
  if (!/^[a-f0-9]{64}$/.test(expected ?? '') || digest(bytes) !== expected) throw Error(`Checksum mismatch: ${name}`);
  return bytes;
}

export function checksumFor(text, filename) {
  const matches = text.split('\n').map(line => line.trim().split(/\s+/)).filter(parts => parts[1] === filename);
  if (matches.length !== 1 || !/^[a-f0-9]{64}$/.test(matches[0][0])) throw Error(`Missing or ambiguous checksum: ${filename}`);
  return matches[0][0];
}

function bundleInfo(name, executable, identifier, version, background) {
  return `<?xml version="1.0" encoding="UTF-8"?>\n<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">\n<plist version="1.0"><dict>
<key>CFBundleName</key><string>${xml(name)}</string><key>CFBundleDisplayName</key><string>${xml(name)}</string>
<key>CFBundleIdentifier</key><string>${identifier}</string><key>CFBundleExecutable</key><string>${executable}</string>
<key>CFBundlePackageType</key><string>APPL</string><key>CFBundleIconFile</key><string>AppIcon</string>
<key>CFBundleShortVersionString</key><string>${xml(version.split('-')[0])}</string><key>CFBundleVersion</key><string>${xml(version.split('-')[0])}</string>
<key>LSMinimumSystemVersion</key><string>${MINIMUM_MACOS}</string><key>NSPrincipalClass</key><string>NSApplication</string>
${background ? `<key>LSUIElement</key><true/><key>NSAppleEventsUsageDescription</key><string>${xml(APPLE_MUSIC_AUTOMATION_DESCRIPTION)}</string>` : ''}<key>NSAppTransportSecurity</key><dict><key>NSAllowsLocalNetworking</key><true/></dict>
</dict></plist>\n`;
}

export function stagePayload({ repo, app, arch, version, node, nodeLicense, helper, detector, framework, vencord, installer }) {
  if (!['arm64', 'x64'].includes(arch)) throw Error('Choose arm64 or x64.');
  if (existsSync(app)) throw Error('Payload destination already exists.');
  const resources = join(app, 'Contents', 'Resources');
  mkdirSync(join(app, 'Contents', 'MacOS'), { recursive: true });
  mkdirSync(resources, { recursive: true });
  const copy = (from, to) => { mkdirSync(dirname(to), { recursive: true }); cpSync(from, to, { recursive: true, verbatimSymlinks: true }); };
  for (const directory of ['presence-engine', 'shared']) {
    cpSync(join(repo, directory), join(resources, directory), { recursive: true,
      filter: path => lstatSync(path).isDirectory() || /\.(?:mjs|py|sh|html)$/.test(path) });
  }
  for (const path of ['vendor/ws', 'vendor/mediaremote-adapter/bin', 'vendor/mediaremote-adapter/LICENSE', 'assets/AppIcon.icns', 'LICENSE', 'TERMS.md', 'scripts/bundle-setup.mjs', 'scripts/vencord-deploy.mjs', 'scripts/install-vencord.mjs']) copy(join(repo, path), join(resources, path));
  copy(node, join(resources, 'runtime', 'node')); copy(nodeLicense, join(resources, 'runtime', 'LICENSE'));
  copy(helper, join(app, 'Contents', 'MacOS', 'EnhancedPresenceHelper'));
  copy(detector, join(resources, 'build', 'detector'));
  copy(framework, join(resources, 'build', 'MediaRemoteAdapter.framework'));
  copy(installer, join(resources, 'tools', 'VencordInstallerCli-darwin'));
  copy(join(repo, 'assets', 'AppIcon.icns'), join(resources, 'AppIcon.icns'));
  const dist = join(resources, 'vencord', 'dist');
  mkdirSync(dist, { recursive: true });
  const names = readdirSync(join(vencord, 'dist')).filter(name => /^(patcher|preload|renderer|vencordDesktop\w*)\.(js|css|js\.LEGAL\.txt)$/.test(name));
  for (const name of ['patcher.js', 'preload.js', 'renderer.js']) if (!names.includes(name)) throw Error(`Vencord build missing ${name}`);
  for (const name of names) copy(join(vencord, 'dist', name), join(dist, name));
  copy(join(vencord, 'LICENSE'), join(resources, 'vencord', 'LICENSE'));
  writeFileSync(join(resources, 'vencord', 'package.json'), JSON.stringify({ name: 'vencord', revision: VENCORD_REV }) + '\n');
  writeFileSync(join(resources, 'vencord', 'REVISION'), VENCORD_REV + '\n');
  writeFileSync(join(app, 'Contents', 'Info.plist'), bundleInfo('EnhancedPresence Helper', 'EnhancedPresenceHelper', 'app.enhancedpresence.helper', version, true));
  writeFileSync(join(resources, 'THIRD_PARTY.md'), `# Licenses and corresponding source\n\nEnhanced Presence: GPL-3.0-or-later. Source and build scripts: https://github.com/Italian-seasoning/EnhancedPresence/tree/v${version}\n\nNode.js ${NODE_VERSION}: license in runtime/LICENSE; source https://nodejs.org/dist/${NODE_VERSION}/node-${NODE_VERSION}.tar.gz\n\nVencord ${VENCORD_REV}: GPL-3.0-or-later; license in vencord/LICENSE; source https://github.com/Vendicated/Vencord/tree/${VENCORD_REV}. The EnhancedPresenceUniversal addition is in the Enhanced Presence source above.\n\nVencord Installer ${INSTALLER_VERSION}: GPL-3.0-or-later; source https://github.com/Vencord/Installer/tree/v${INSTALLER_VERSION}\n\nMediaRemoteAdapter and ws retain their license files in vendor/. Corresponding source is included in the Enhanced Presence source repository.\n`);
  for (const file of [join(resources, 'runtime', 'node'), join(resources, 'build', 'detector'), join(resources, 'tools', 'VencordInstallerCli-darwin'), join(app, 'Contents', 'MacOS', 'EnhancedPresenceHelper')]) chmodSync(file, 0o755);
}

export function payloadManifest(app, metadata) {
  const root = realpathSync(app), files = {};
  function walk(path) {
    const info = lstatSync(path);
    if (info.isSymbolicLink()) {
      const target = realpathSync(path), rel = relative(root, target);
      if (rel.startsWith(`..${sep}`) || rel === '..' || isAbsolute(rel)) throw Error('Payload symlink escapes its bundle.');
      return;
    }
    if (info.isDirectory()) { for (const name of readdirSync(path).sort()) walk(join(path, name)); return; }
    if (!info.isFile()) throw Error('Unexpected payload entry.');
    const rel = relative(root, path).split(sep).join('/');
    if (/config\.local|bridge\.local|settings-session|usage\.local|agent-events|\.DS_Store|\.log$|(?:^|\/)\.git(?:\/|$)/.test(rel)) throw Error(`Private or generated state in payload: ${rel}`);
    files[rel] = digest(readFileSync(path));
  }
  walk(root);
  return { schema: 1, ...metadata, minimumMacOS: MINIMUM_MACOS, nodeVersion: NODE_VERSION.slice(1), vencordRevision: VENCORD_REV, installerVersion: INSTALLER_VERSION, files };
}

async function downloaded(url, path, expected) {
  if (!existsSync(path)) {
    const response = await fetch(url);
    if (!response.ok) throw Error(`Download failed (${response.status}): ${new URL(url).pathname}`);
    writeFileSync(path, Buffer.from(await response.arrayBuffer()));
  }
  return verifyDownload(readFileSync(path), expected, new URL(url).pathname);
}

function verifyArchitecture(binary, arch) {
  const expected = arch === 'x64' ? 'x86_64' : arch;
  const found = execFileSync('/usr/bin/lipo', ['-archs', binary], { encoding: 'utf8' }).trim().split(/\s+/);
  if (!found.includes(expected)) throw Error(`Wrong architecture in ${binary.split(sep).pop()}`);
}

function cleanSigningMetadata(app) {
  // Finder/iCloud can attach signing-incompatible metadata. Quarantine and security attributes are preserved.
  for (const attribute of ['com.apple.FinderInfo', 'com.apple.ResourceFork']) {
    try { execFileSync('/usr/bin/xattr', ['-dr', attribute, app], { stdio: 'ignore' }); } catch { /* The attribute may be absent. Codesign still verifies the result. */ }
  }
}

async function main(args = process.argv.slice(2)) {
  const options = {};
  for (let i = 0; i < args.length; i++) {
    if (!['--arch', '--vencord', '--output', '--cache'].includes(args[i]) || !args[i + 1] || args[i + 1].startsWith('--')) throw Error('Usage: npm run package:macos -- --arch arm64|x64 --vencord /path/to/built/Vencord [--output DIR] [--cache DIR]');
    options[args[i].slice(2)] = args[++i];
  }
  if (process.platform !== 'darwin' || !['arm64', 'x64'].includes(options.arch) || !options.vencord) throw Error('Build on macOS and provide --arch arm64|x64 and a built --vencord checkout.');
  const arch = options.arch, target = arch === 'x64' ? 'x86_64' : arch;
  const vencord = realpathSync(options.vencord);
  const revision = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: vencord, encoding: 'utf8' }).trim();
  if (revision !== VENCORD_REV) throw Error('Vencord checkout does not match the tested release revision.');
  const plugins = join(vencord, 'src', 'userplugins');
  if (existsSync(plugins) && readdirSync(plugins).some(name => !name.startsWith('.') && name !== 'EnhancedPresenceUniversal')) throw Error('Release builds must not include unrelated custom Vencord plugins.');
  if (!readFileSync(join(vencord, 'dist', 'renderer.js'), 'utf8').includes('EnhancedPresenceUniversal')) throw Error('Vencord build does not contain EnhancedPresenceUniversal.');
  const version = JSON.parse(readFileSync(join(source, 'package.json'), 'utf8')).version;
  const output = resolve(options.output ?? join(source, 'build', 'release'));
  const cache = resolve(options.cache ?? join(source, 'build', 'downloads'));
  mkdirSync(output, { recursive: true }); mkdirSync(cache, { recursive: true });
  const nodeName = `node-${NODE_VERSION}-darwin-${arch}`;
  const base = `https://nodejs.org/dist/${NODE_VERSION}/`;
  const sums = await fetch(`${base}SHASUMS256.txt`);
  if (!sums.ok) throw Error('Could not fetch Node.js release checksums.');
  const expected = checksumFor(await sums.text(), `${nodeName}.tar.gz`);
  const archive = join(cache, `${nodeName}.tar.gz`);
  await downloaded(`${base}${nodeName}.tar.gz`, archive, expected);
  const nodeRoot = join(cache, nodeName);
  rmSync(nodeRoot, { recursive: true, force: true });
  run('/usr/bin/tar', ['-xzf', archive, '-C', cache, `${nodeName}/bin/node`, `${nodeName}/LICENSE`]);
  const installer = join(cache, 'VencordInstallerCli-darwin');
  await downloaded(`https://github.com/Vencord/Installer/releases/download/v${INSTALLER_VERSION}/VencordInstallerCli-darwin`, installer, INSTALLER_SHA256);
  chmodSync(installer, 0o755);

  const native = join(source, 'build', 'package-native', arch);
  mkdirSync(native, { recursive: true });
  const swiftFlags = ['-target', `${target}-apple-macosx${MINIMUM_MACOS}`, '-module-cache-path', join(native, 'cache'), '-file-prefix-map', `${source}=.`, '-debug-prefix-map', `${source}=.`];
  const helper = join(native, 'EnhancedPresenceHelper'), detector = join(native, 'detector'), gui = join(native, 'EnhancedPresenceInstaller');
  run('swiftc', [...swiftFlags, join(source, 'native', 'Helper.swift'), '-o', helper]);
  run('swiftc', [...swiftFlags, join(source, 'native', 'Detector.swift'), '-o', detector]);
  run('swiftc', [...swiftFlags, '-parse-as-library', join(source, 'native', 'Installer.swift'), '-o', gui]);
  if (arch === process.arch || (process.arch === 'arm64' && arch === 'x64' && existsSync('/Library/Apple/usr/libexec/oah/libRosettaRuntime'))) {
    run(helper, ['--self-test']); run(gui, ['--self-test']);
  }
  const music = join(native, 'music');
  run('cmake', ['-S', join(source, 'vendor', 'mediaremote-adapter'), '-B', music, '-G', 'Xcode', `-DCMAKE_OSX_DEPLOYMENT_TARGET=${MINIMUM_MACOS}`, `-DCMAKE_OSX_ARCHITECTURES=${target}`]);
  run('cmake', ['--build', music, '--config', 'Release', '--target', 'MediaRemoteAdapter', '--', '-quiet']);

  // Keep signing outside synced folders so File Provider cannot reattach Finder metadata mid-signature.
  const stage = mkdtempSync(join(tmpdir(), `enhanced-presence-package-${arch}-`));
  try {
  const outer = join(stage, 'Install Enhanced Presence.app'), resources = join(outer, 'Contents', 'Resources');
  const app = join(resources, 'payload', 'EnhancedPresence Helper.app');
  stagePayload({ repo: source, app, arch, version, node: join(nodeRoot, 'bin', 'node'), nodeLicense: join(nodeRoot, 'LICENSE'), helper, detector, framework: join(music, 'Release', 'MediaRemoteAdapter.framework'), vencord, installer });
  const appResources = join(app, 'Contents', 'Resources');
  for (const binary of [join(app, 'Contents', 'MacOS', 'EnhancedPresenceHelper'), join(appResources, 'runtime', 'node'), join(appResources, 'build', 'detector'), join(appResources, 'tools', 'VencordInstallerCli-darwin')]) verifyArchitecture(binary, arch);
  const framework = join(appResources, 'build', 'MediaRemoteAdapter.framework');
  verifyArchitecture(join(framework, 'MediaRemoteAdapter'), arch);
  // Sign inside out. The external manifest hashes the completed helper signature, avoiding a hash/signature cycle.
  cleanSigningMetadata(app);
  run('/usr/bin/codesign', ['--force', '--sign', '-', framework]);
  run('/usr/bin/codesign', ['--force', '--sign', '-', join(appResources, 'tools', 'VencordInstallerCli-darwin')]);
  run('/usr/bin/codesign', ['--force', '--sign', '-', app]);
  run('/usr/bin/codesign', ['--verify', '--deep', '--strict', app]);
  writeFileSync(join(resources, 'release.json'), JSON.stringify(payloadManifest(app, { version, arch }), null, 2) + '\n');
  run(join(appResources, 'runtime', 'node'), [join(source, 'tests', 'packaged-runtime.mjs'), app]);
  cpSync(join(source, 'TERMS.md'), join(resources, 'TERMS.md'));
  cpSync(join(source, 'assets', 'AppIcon.icns'), join(resources, 'AppIcon.icns'));
  mkdirSync(join(outer, 'Contents', 'MacOS'), { recursive: true });
  cpSync(gui, join(outer, 'Contents', 'MacOS', 'EnhancedPresenceInstaller'));
  writeFileSync(join(outer, 'Contents', 'Info.plist'), bundleInfo('Install Enhanced Presence', 'EnhancedPresenceInstaller', 'app.enhancedpresence.installer', version, false));
  cleanSigningMetadata(outer);
  run('/usr/bin/codesign', ['--force', '--sign', '-', outer]);
  run('/usr/bin/codesign', ['--verify', '--deep', '--strict', outer]);
  cpSync(join(source, 'themes', 'PresenceMessages.theme.css'), join(stage, 'PresenceMessages.theme.css'));
  writeFileSync(join(stage, 'Read Me.txt'), `Enhanced Presence ${version} — unsigned beta\n\nOpen Install Enhanced Presence.app. It installs the helper in your user Applications folder and bundles all runtime dependencies. No source build, Node installation, Xcode or administrator password is needed.\n\nmacOS may block this unsigned, unnotarized beta. No script disables Gatekeeper or clears quarantine. Only proceed if you trust this release.\n\nFirst use needs a public Discord Application ID, never an account/bot token. Review allowed apps before resuming sharing. Core app presence needs no Accessibility or screen/input monitoring.\n\nTo uninstall the companion, reopen this installer and choose Uninstall. Settings/history and Vencord remain.\n\nSource, licenses and current instructions: https://github.com/Italian-seasoning/EnhancedPresence\n`);
  writeFileSync(join(stage, 'Messages theme.txt'), 'Optional Messages for Discord theme\n\nIn Discord, open Settings > Vencord > Themes > Open Themes Folder. Copy PresenceMessages.theme.css into that folder, then select it in Themes. Turn off other full-client themes before enabling Messages. Your other theme files and settings are kept.\n\nFor native macOS frost, open Settings > Vencord > Vencord > MacOS Window vibrancy style and choose Sidebar. Leave Enable window transparency off, then fully quit and reopen Discord. CSS blur supplies the floating controls inside the window.\n\nBlue outgoing bubbles use Enhanced Presence+ or the built-in Vencord ThemeAttributes plugin. No remote CSS, fonts or images are loaded by the theme. The Plus installer does not select or enable themes.\n');
  const name = `EnhancedPresence-${version}-macOS-${arch}.dmg`, dmg = join(output, name);
  run('/usr/bin/hdiutil', ['create', '-volname', 'Enhanced Presence', '-srcfolder', stage, '-format', 'UDZO', '-ov', dmg]);
  writeFileSync(`${dmg}.sha256`, `${digest(readFileSync(dmg))}  ${name}\n`);
  console.log(JSON.stringify({ version, arch, dmg, bytes: lstatSync(dmg).size, signed: 'ad-hoc', notarized: false }));
  } finally { rmSync(stage, { recursive: true, force: true }); }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main().catch(error => { console.error(error.message); process.exitCode = 1; });
