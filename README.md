<div align="center">
  <img src="assets/thumbnail.svg" alt="Enhanced Presence — a little more you, on Discord" width="900" />
</div>

# Enhanced Presence

**Source beta:** setup requires building Vencord and the macOS companion. Automatic updates and a packaged installer are not available yet.

A macOS companion and Vencord user plugin that share the app you’re using on Discord. Choose which apps can appear, show an app’s icon and elapsed open time, and optionally share supported project names. Creative apps get short, varied activity text.

**This is a custom Vencord plugin**, not an official Vencord release or a Discord product. It requires a source build of Vencord. The companion currently supports macOS; Windows and Linux app detection are not available.

## Install

You need macOS, Xcode with its command-line tools, Node.js 22 or newer, Git, pnpm, CMake, a [Vencord source checkout](https://docs.vencord.dev/installing/), and a Discord application ID. Create an application in the [Discord Developer Portal](https://discord.com/developers/applications) and copy its **Application ID**. Do not use a bot token or a Discord account token.

From this repository:

```sh
npm run build:detector
npm run build:music
npm run install:companion -- YOUR_APPLICATION_ID
npm run install:vencord -- /absolute/path/to/Vencord
```

The Vencord installer refuses to overwrite an unmanaged plugin and keeps other user plugins intact. Now, from your Vencord checkout:

```sh
pnpm install --frozen-lockfile
pnpm build --disable-updater
pnpm inject
```

Use the installer to patch Discord, then fully restart Discord. Start the companion with:

```sh
launchctl bootstrap "gui/$(id -u)" "$HOME/Library/LaunchAgents/app.enhancedpresence.engine.plist"
```

The first install starts **paused**. Open **Discord Settings → Vencord → Plugins → EnhancedPresenceUniversal**, enable it, open its settings, review the app allowlist, and select **Resume**. Discord’s activity-sharing setting must also be enabled. The default switch delay is two minutes; the foreground app takes priority, and opening Discord keeps the last allowed app while it remains open. The display timer uses the app’s launch time, including background time.

## Optional project names

Project and document names are off by default. In the plugin settings, select a supported app and enable **Show project name** only if you want that name visible on Discord. Adobe names can be switched off individually. Resolve also offers a separate page and render-status switch and requires its local scripting interface to be available.

For Final Cut and supported Adobe apps, the companion needs macOS Accessibility access to read the relevant window or project control. Run:

```sh
npm run accessibility -- --open
```

The command prints the exact **Node executable and detector** paths and opens Privacy & Security → Accessibility. Use **+**, press **Shift–Command–G**, enter each path, and enable both entries. Granting Node access also grants Accessibility access to other programs launched through that Node executable. After granting access, restart the companion:

```sh
launchctl kickstart -k "gui/$(id -u)/app.enhancedpresence.engine"
```

The companion reads no document content or full file paths for presence. Names are disclosed only when the switch for that app is on. Private apps, lock, sleep, and the idle timeout clear activity. The local pairing key and settings stay on your Mac.

## Updating

This source release does **not** include Sparkle or an automatic custom-plugin updater. Vencord’s stock updater can replace a custom build, so this build disables it. To update, pull the latest source for this repository and Vencord, rerun the install and build commands above, then restart Discord. Reinstalling the companion preserves existing settings and pairing when the application ID is unchanged. The installer saves backups of its own previously managed plugin source before replacing it.

Discord updates or a Vencord reinstall may require reinjecting the custom build. A future Discord or macOS update may require compatibility fixes. The optional Apple Music integration uses Apple’s private MediaRemote interface and may stop working after macOS updates.

## Development

```sh
npm test
```

The loopback bridge accepts only an authenticated local connection from Discord origins. Project-name detection, Resolve scripting, and remote icon rendering can vary by app and OS version; unsupported cases fall back to generic activity.

## License

GPL-3.0-or-later. Vendored dependencies have their own licenses in `vendor/`.
