<div align="center">
  <img src="assets/icon.png" alt="" width="96" />

# Enhanced Presence

Your apps, activity and task timer on Discord.

macOS · Custom Vencord plugin · Source beta · GPL-3.0-or-later

<img src="assets/thumbnail.svg" alt="Example Enhanced Presence activity" width="760" />
</div>

## What it does

- App name, artwork and elapsed time, with an explicit allowlist.
- Compact native menu: connection, current activity, Pause and Settings.
- Settings in the helper and in **Vencord → Plugins → EnhancedPresenceUniversal**.
- Optional Claude Code/Codex task status: Editing code, Reviewing code, Running tests. Fixed phrases work without model calls.
- Optional Apple Music, quiet hours, custom text and local app-time totals.
- Clears activity on pause, idle, sleep, lock, private apps or detector failure.

**Vencord is the recommended connection:** it supports app names and artwork. Standalone IPC is available as a text-only fallback; Discord may display your Developer Portal application's name there.

This is an independent custom plugin. Vencord requires modifying Discord's client and can violate Discord's terms. Review [Terms of Use](TERMS.md) before installing. Vencord does not support third-party plugins; see its [custom-plugin documentation](https://docs.vencord.dev/installing/custom-plugins/).

## Setup

Requires macOS, Discord desktop, Node.js 22+ (with npm/npx), Git, Xcode command-line tools and CMake. This is a source build; there is no notarized one-click installer.

1. Create a Discord application in the [Developer Portal](https://discord.com/developers/applications). Copy its numeric **Application ID**. No bot, account token or OAuth permissions are needed.
2. Clone and run setup:

```sh
git clone https://github.com/Italian-seasoning/EnhancedPresence.git
cd EnhancedPresence
npm run quickstart -- --application-id YOUR_APPLICATION_ID
```

3. Quit and reopen Discord. Open **Enhanced Presence → Settings** from the menu bar, review the allowed apps, then press **Resume**. Turn on Discord's activity-sharing setting if it is off. The custom plugin is enabled by default on fresh installs; existing explicit plugin choices are preserved.

Setup downloads the exact pnpm version required by its Vencord checkout, builds the detector and music adapter, installs one helper/login service, builds the plugin with a tested Vencord revision, and applies that build to Discord. First installation starts paused and uses Vencord only. Updates preserve settings, pairing and local totals.

Discord's newest settings layout can hide Vencord's sidebar entries even while the plugin works. Use the helper Settings window (also opened by `npm run settings`) in that case; it controls the same companion settings.

The Vencord repair job responds to Discord/Vencord file changes; it does not start Node on a repeating timer. Setup does not request administrator access or disable Gatekeeper.

### Optional task status

Hooks are **opt-in**. Add `--with-hooks` when installing or updating:

```sh
npm run quickstart -- --with-hooks
```

The hooks record tool categories and a project folder name locally, never prompts, commands or full paths. Project names are hidden from Discord by default. Original hook settings are backed up and unrelated hooks are preserved. Codex may require reviewing the added hook in `/hooks`.

AI wording is off by default. Fixed phrases need no CLI/model runs; opting into Haiku or a configured Codex model uses your existing subscription and is rate limited. Model availability depends on your CLI/account.

### Permissions and privacy

**Core app presence needs no Accessibility, Screen Recording, Input Monitoring, Automation or Full Disk Access. Do not grant these permissions to Node, Terminal or your shell for this app.**

Project/document names are optional, per app and off by default. If you want them, run `npm run accessibility` for the named helper instructions. Accessibility attribution can vary by macOS version; if names are unavailable, leave them off. Generic activity still works.

Settings and pairing stay on your Mac in `~/Library/Application Support/EnhancedPresence`. Both local services bind to loopback, authenticate requests, and reject foreign origins. No telemetry or account login. Messages, Mail, Photos, password managers and Discord are always blocked. The plugin may fetch public app artwork through Discord; local icons are never uploaded.

### Other setup options

| Option | Purpose |
| --- | --- |
| `--vencord /absolute/path/to/Vencord` | Build using your own checkout. Its revision and other plugins are preserved. |
| `--standalone` | Skip Vencord and use Discord IPC. Text only; Discord is not modified. |
| `--restart-discord` | Restart Discord after setup. |
| `--accept-terms` | Noninteractive setup after reviewing the terms. |

For manual installation: `npm run build:detector`, `npm run build:music`, `npm run install:companion -- YOUR_APPLICATION_ID --helper`, then `npm run install:vencord -- /absolute/path/to/Vencord`. Rebuild that checkout with `pnpm build --disable-updater`, inject it and restart Discord.

## Check or update

```sh
npm run doctor
git pull --ff-only
npm run quickstart
```

Doctor checks the **live Vencord connection**, not just whether plugin files exist, and measures combined CPU/memory. Pause is expected to disconnect the plugin. Settings also shows the connection state; standalone fallback is labelled explicitly.

There is no automatic code updater. A custom build disables Vencord's updater so it cannot replace the plugin. Repair can reapply your existing build after Discord updates; new compatibility fixes require rebuilding. Apple Music uses a private macOS interface and can break after OS updates.

## Troubleshooting

| Symptom | Check |
| --- | --- |
| Waiting for Vencord | Fully quit/reopen Discord; enable EnhancedPresenceUniversal and Resume. Run doctor. |
| Application name instead of app name | You're using standalone IPC. Select Vencord in Settings and connect the plugin. |
| No activity | Allow the foreground app, Resume, enable Discord activity sharing; account for the configured switch delay. |
| No task status | Install with `--with-hooks`, review Codex hook trust, and use an allowed editor/agent app. |
| Names unavailable | Keep names off or review the optional helper permission. Never grant Node broad access. |

## Uninstall

Remove hooks first, then stop the services:

```sh
npm run install:companion -- --remove-hooks
launchctl bootout "gui/$(id -u)/app.enhancedpresence.engine"
launchctl bootout "gui/$(id -u)/app.enhancedpresence.vencord-repair"
```

Remove the two `app.enhancedpresence.*.plist` files from `~/Library/LaunchAgents` and `~/Applications/EnhancedPresence Helper.app`. Keep or delete `~/Library/Application Support/EnhancedPresence` depending on whether you want to preserve settings and app-time totals.

Use the official Vencord installer to uninstall its Discord patch, or reinstall Discord. Uninstalling Enhanced Presence's helper does not remove Vencord or other plugins.

## Development

`npm test` runs the protocol, privacy, settings, recovery and helper checks. Real-machine checks: `ENHANCED_PRESENCE_NATIVE_SMOKE=1 npm test` (input clock) and `ENHANCED_PRESENCE_PERF=1 npm test` (resource limits). Custom plugins must also be built and checked against a real Vencord checkout.

Report vulnerabilities privately via [SECURITY.md](SECURITY.md). GPL-3.0-or-later; vendored components retain their licenses.
