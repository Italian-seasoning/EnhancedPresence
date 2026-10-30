<div align="center">
  <img src="assets/icon.png" alt="" width="96" />

# Enhanced Presence

Your apps, activity and task timer on Discord.

macOS 13.5+ · Custom Vencord plugin · Unsigned beta · GPL-3.0-or-later

<img src="assets/thumbnail.svg" alt="Example Enhanced Presence activity" width="760" />
</div>

## Download and install

[**Download the unsigned beta**](https://github.com/Italian-seasoning/EnhancedPresence/releases/tag/v0.9.0-beta.1)

| Your Mac | Download |
| --- | --- |
| Apple Silicon (M-series) | [Apple Silicon installer](https://github.com/Italian-seasoning/EnhancedPresence/releases/download/v0.9.0-beta.1/EnhancedPresence-0.9.0-beta.1-macOS-arm64.dmg) |
| Intel | [Intel installer](https://github.com/Italian-seasoning/EnhancedPresence/releases/download/v0.9.0-beta.1/EnhancedPresence-0.9.0-beta.1-macOS-x64.dmg) |

**This beta is unsigned and unnotarized. macOS may block it.** Only install it if you trust the release. The installer never disables Gatekeeper, removes quarantine, requests an administrator password, or grants privacy permissions. Checksums accompany the downloads.

1. Open the DMG, then **Install Enhanced Presence.app**.
2. Enter a public **Discord Application ID** from the [Developer Portal](https://discord.com/developers/applications), or keep your existing ID when updating. Never enter a bot/account token. Keep Vencord selected for app icons and the best compatibility; task hooks are optional.
3. Choose **Install**, select the stable **Discord.app** in the macOS file picker and confirm **Choose Discord**. This gives setup access to that app; the helper needs no broad privacy permissions. Quit and reopen Discord, then open the menu bar helper's **Settings**, review allowed apps and press **Resume**. Discord's own activity-sharing setting must be on.

Node, Xcode, Git, pnpm and source builds are **not needed** for the downloaded installer. It includes its own runtime and a tested Vencord build. The helper installs into `~/Applications`; settings, pairing and app-time totals stay in `~/Library/Application Support/EnhancedPresence`. First installation starts paused.

The Vencord option replaces the local Vencord build while preserving its settings. Use the source workflow below if you maintain a build with other custom plugins. Discord's newest settings layout can hide Vencord's sidebar even when the plugin works; the helper Settings window controls the same companion settings.

Enhanced Presence is independent of Discord and Vencord. Vencord modifies Discord's client and can violate Discord's terms. Review [Terms of Use](TERMS.md). Vencord does not support third-party plugins; see its [custom-plugin documentation](https://docs.vencord.dev/installing/custom-plugins/).

## What it does

- Allowed app names, artwork and elapsed time.
- Compact native menu with connection, current activity, Pause and Settings.
- Optional Claude Code/Codex task status such as Editing code, Reviewing code and Running tests. Fixed phrases require no model calls.
- Apple Music song title, artist, album, album cover and available artist portrait; quiet hours, custom text and local app-time totals.
- App activity clears on idle or private apps. Music stays visible while playing; pause, sleep, lock, quiet hours and detector failure clear it.

Choose **Prefer Apple Music** in Settings to keep your track visible in the background.

Vencord supports app names and artwork. Standalone mode avoids modifying Discord and shows text only; Discord may display your Developer Portal application's name there.

## Privacy and efficiency

Core app presence needs **no Accessibility, Screen Recording, Input Monitoring, Automation or Full Disk Access**. Do not grant these permissions to Node, Terminal or your shell for this app.

Project/document names are optional, per app and off by default. Some supported apps need Accessibility for the named EnhancedPresence Helper. If names are unavailable, leave them off; generic presence still works. Settings and pairing remain local. The services use authenticated loopback connections and reject foreign origins. There is no telemetry or account login.

Messages, Mail, Photos, password managers and Discord are always blocked from app tracking. The plugin may fetch public app artwork through Discord; installed local icons are never uploaded. When Apple Music sharing and icons are enabled, a cached Apple catalog lookup uses the shared song title, artist and album to find an exact cover match and a public artist portrait. Album art is the main image; the artist portrait is a small badge whose position Discord controls. No music account, local artwork or library access is required. Unavailable covers fall back to the app icon, and unavailable portraits are omitted. One persistent Node engine runs inside the helper. Vencord repair responds to file changes instead of starting Node on a repeating timer.

### Optional task status

Select **Enable optional task status hooks** in the installer. Hooks record tool categories and a project folder name locally, never prompts, commands or full paths. Project names are hidden from Discord by default; original hook settings are backed up and unrelated hooks are preserved. Codex may require reviewing the added hook in `/hooks`.

AI wording is off by default. Fixed phrases need no CLI/model runs. Opting into AI wording requires your own supported Claude Code/Codex CLI and subscription; availability depends on your account.

## Updating and uninstalling

Download a newer installer and choose **Install**. Existing settings, pairing and local totals are preserved. There is no automatic code updater: Vencord's updater would replace a custom plugin build. Repair can reapply the installed build after Discord updates; a new compatibility fix needs a new Enhanced Presence download. Apple Music relies on a private macOS interface that can change.

To uninstall the companion, reopen **Install Enhanced Presence.app** and choose **Uninstall**. This removes its helper, login services and managed task hooks, while keeping settings, history and Vencord. Use Vencord's official installer if you also want to remove Vencord from Discord.

## Troubleshooting

| Symptom | Check |
| --- | --- |
| macOS blocks the download | This is an unsigned beta, not an Apple-notarized app. Review the release and decide whether to trust it. Do not disable system protections. |
| Waiting for Vencord | Fully quit/reopen Discord, then Resume in helper Settings. Reinstall the bundled plugin if Discord updated. |
| Application name instead of app name | Standalone IPC is active. Use the Vencord option for app names and artwork. |
| No activity | Allow the foreground app, Resume, enable Discord activity sharing, and account for the configured switch delay. |
| No task status | Enable optional hooks, review Codex hook trust, and use an allowed editor/agent app. |
| No album cover or artist portrait | Enable icons in the plugin. Images need an exact Apple catalog match and network access. Unmatched recordings use the app icon; artists without public portraits have no badge. |
| Names unavailable | Keep names off or review the optional helper permission. Never grant Node broad access. |

## Build from source

For development or a Vencord checkout with other custom plugins, install Node.js 22+, Git, Xcode command-line tools and CMake:

```sh
git clone https://github.com/Italian-seasoning/EnhancedPresence.git
cd EnhancedPresence
npm run quickstart -- --application-id YOUR_APPLICATION_ID
```

Add `--with-hooks` to opt into task hooks, `--standalone` to skip Vencord, or `--vencord /absolute/path/to/Vencord` to use your own checkout. Source setup downloads the exact pnpm version required by the tested Vencord revision. Run `npm run doctor` for live connection and resource checks.

`npm test` covers protocol, privacy, settings, recovery, installer and packaging logic. Real-machine checks: `ENHANCED_PRESENCE_NATIVE_SMOKE=1 npm test` (input clock) and `ENHANCED_PRESENCE_PERF=1 npm test` (resource limits).

To package a developer-built Vencord checkout containing the plugin:

```sh
npm run package:macos -- --arch arm64 --vencord /absolute/path/to/Vencord
npm run package:macos -- --arch x64 --vencord /absolute/path/to/Vencord
```

The release workflow builds both downloads from a version tag and verifies checksums before publishing. Bundled dependencies retain their licenses and corresponding-source links. Report vulnerabilities privately via [SECURITY.md](SECURITY.md).
