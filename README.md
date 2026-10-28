<div align="center">
  <img src="assets/icon.png" alt="" width="120" />

  # Enhanced Presence

  Show what you are actually working on in Discord: the app, how long you have been in it, and what your coding agent is doing.

  macOS · Vencord plugin · GPL-3.0-or-later · source beta

  <img src="assets/thumbnail.svg" alt="Enhanced Presence status card" width="760" />
</div>

## Features

- **Your apps, your rules.** Shows the app you are using with its icon and elapsed time. Only apps you allow ever appear.
- **Agent task status.** While Claude Code or Codex works, your timer shows how long the *task* has been running and the status says what is happening: "Squashing bugs" after a failing test, "Running tests", "Writing code", "Shipping changes".
- **Optional AI wording.** Have Claude Haiku or Codex Luna rephrase that status. Off by default.
- **Settings app.** A real settings window (menu bar icon → Settings…) for apps, task status, schedule, output and power. It works with or without Vencord.
- **Works without Vencord.** Standalone mode publishes through Discord's local connection, so nothing in Discord is patched. Text only: app icons need the plugin.
- **Light on battery.** Event-driven detection, a battery saver for Low Power Mode and low battery, and a built-in performance check.
- **Quiet hours and your own phrases.** Hide your activity overnight and replace the built-in phrases for any app.
- **Project names.** Off by default, per app.
- **Music.** Optional Apple Music activity.
- **Settings inside Discord.** Settings → Vencord → Plugins → EnhancedPresenceUniversal.

Enhanced Presence is an independent custom plugin. It is not an official Vencord or Discord product, and modifying Discord's client is against Discord's terms. **You must read and accept the [Terms of Use](TERMS.md) to install it, and you use it at your own risk.**

## Requirements

macOS, Xcode with its command-line tools, Node.js 22+, Git, pnpm, CMake, and a Discord **Application ID** from the [Developer Portal](https://discord.com/developers/applications) (create an application and copy its Application ID; never use a bot or account token).

## Install

```sh
npm run quickstart -- --application-id YOUR_APPLICATION_ID
```

That one command builds the detector and music adapter, installs the background service, the menu bar helper and the agent hooks, builds Vencord with the plugin at the tested revision, and applies it to Discord. You are asked to accept the Terms of Use first (scripts can pass `--accept-terms`). Add `--restart-discord` to restart Discord for you, or quit and reopen it yourself. Then open **Settings → Vencord → Plugins → EnhancedPresenceUniversal**, review the app list and press **Resume**. Discord's own activity-sharing setting must be on.

A small background agent re-applies the build after Discord updates.

**No Vencord?** Run `npm run quickstart -- --standalone --application-id YOUR_APPLICATION_ID` instead. It skips Vencord entirely and Discord is not modified. In the default *Automatic* output mode the companion also switches to standalone by itself whenever the plugin is not connected, and steps aside when it is.

Open the settings window from the menu bar icon, or with `npm run settings`. Check everything, including CPU and memory use, at any time with:

```sh
npm run doctor
```

<details>
<summary>Manual install (use your own Vencord checkout)</summary>

```sh
npm run build:detector
npm run build:music
npm run install:companion -- YOUR_APPLICATION_ID --helper
npm run install:vencord -- /absolute/path/to/Vencord
```

Then, in your Vencord checkout, run `pnpm install --frozen-lockfile`, `pnpm build --disable-updater` and `pnpm inject`, and restart Discord.

`install:companion` installs the background service and starts it at login (later runs reuse your saved Application ID), adds the agent hooks (skip with `--no-hooks`), and with `--helper` runs everything through the signed menu bar app *EnhancedPresence Helper* so macOS privacy lists show a named app with an icon instead of `node`.
</details>

## Agent task status

The installer adds a tiny hook to `~/.claude/settings.json` (and to `~/.codex/hooks.json` if you use Codex) for these events: prompt submitted, tool finished, tool failed (Claude Code) and stop. Codex asks you to review new hooks, so open Codex and run `/hooks` once to trust it; Codex has no separate failure event, so "Squashing bugs" is Claude Code only. It is a short shell script that appends one line to a local file, so it adds around ten milliseconds per call. It records only the kind of tool used and the project folder name, never prompts, commands or file paths. Your original settings are saved once as `settings.json.enhancedpresence.bak`, and your other hooks are left alone. Remove the hooks any time with `npm run install:companion -- --remove-hooks`.

The status is chosen from a fixed table of phrases, so it costs nothing. It appears while a terminal, editor, Codex or Claude app is in front. It clears on stop or after 15 minutes without activity.

### Optional AI wording

In the plugin settings, or in `config.local.json`:

```json
"agent": { "showProject": false, "ai": { "provider": "haiku", "intervalMinutes": 15 } }
```

| Provider | Runs | Uses |
|---|---|---|
| `off` | nothing | Default. Fixed phrases. |
| `haiku` | `claude -p --model haiku --effort low` | Your Claude Code login |
| `luna` | `codex exec -m luna`, low effort, read-only | Your Codex login. Run `codex exec -m luna "hi"` once to check your install accepts the model name. |

No API keys are read or stored. Neither tool saves a session, scratch files are deleted after each call, and it runs at most once per interval. The model sees only tool categories, the app name and minutes elapsed. If a call fails you keep the fixed phrase.

### Battery and performance

The companion is event-driven and normally sits near 0% CPU. **Battery saver** (Settings → Output and power) stops music polling and AI wording; *Automatic* turns it on in Low Power Mode or at 20% battery or below. If the companion ever uses more than 3% CPU for two minutes it turns the saver on by itself. `npm run doctor` measures CPU and memory of every Enhanced Presence process and flags anything above 2% CPU or 250 MB. Memory and CPU are also shown in the menu bar menu and the settings window.

### Quiet hours and phrases

In `config.local.json`:

```json
"quietHours": { "enabled": true, "start": "23:00", "end": "07:00" },
"phrases": { "com.apple.dt.Xcode": ["Compiling excuses", "One more build"] }
```

Quiet hours clear your activity and may wrap past midnight. Each app takes 1 to 8 phrases of 2 to 64 characters; one is picked per session.

## Privacy

- Messages, Mail, Photos, Passwords, FaceTime, password managers and Discord itself are always blocked.
- Idle, lock, sleep, detector failure and shutdown clear your activity.
- No window titles, URLs, document contents or file paths are read for presence. Names appear only for apps where you switched them on.
- Settings and the pairing key stay on your Mac. The local bridge only accepts an authenticated connection from Discord.
- There is no telemetry and no account.

### Project names

Enable **Show project name** for a supported app in the plugin. Final Cut and Adobe apps also need macOS Accessibility access:

```sh
npm run accessibility -- --open
```

Add the printed paths (or the helper app) under Privacy & Security → Accessibility, then restart the service:

```sh
launchctl kickstart -k "gui/$(id -u)/app.enhancedpresence.engine"
```

## Updating

There is no automatic updater, because Vencord's own updater would replace a custom build. Pull this repository and run `npm run quickstart` again, then restart Discord. Settings and pairing are kept. A Discord or macOS update may need a reinject or a small fix, and the Apple Music integration relies on a private macOS interface that can break.

## Uninstall

```sh
npm run install:companion -- --remove-hooks
launchctl bootout "gui/$(id -u)/app.enhancedpresence.engine"
launchctl bootout "gui/$(id -u)/app.enhancedpresence.vencord-repair"
rm ~/Library/LaunchAgents/app.enhancedpresence.engine.plist ~/Library/LaunchAgents/app.enhancedpresence.vencord-repair.plist
rm -r "$HOME/Applications/EnhancedPresence Helper.app"
rm -r "$HOME/Library/Application Support/EnhancedPresence"
```

To remove Vencord's patch from Discord, reinstall Discord or restore its original archive: the file `_app.asar` in `/Applications/Discord.app/Contents/Resources` is Discord's own and can be renamed back to `app.asar`.

## Troubleshooting

| Problem | Try |
|---|---|
| Nothing shows on Discord | Press **Resume** in the plugin, turn on Discord's activity sharing, and check the app is allowed. |
| Plugin missing | Rebuild with `--disable-updater`, run `pnpm inject`, restart Discord. |
| Nothing shows and Vencord is not installed | Use standalone mode (`--standalone`) and make sure Discord's own activity sharing is on. |
| Anything else | Run `npm run doctor`; it lists what is wrong and how to fix it. Include its output in bug reports. |
| No task timer | Check the hook is installed (`npm run doctor`), that Codex has trusted it (`/hooks`), and that a terminal, editor, Codex or Claude app is in front. |
| Project names empty | Grant Accessibility (above) and restart the service. |

## Development

```sh
npm test
```

Two checks are opt-in because they need real hardware: `ENHANCED_PRESENCE_NATIVE_SMOKE=1` (idle clock) and `ENHANCED_PRESENCE_PERF=1` (idle CPU and memory limits). Tests run in CI on every push. See [SECURITY.md](SECURITY.md) to report a vulnerability.

## License

GPL-3.0-or-later, see [LICENSE](LICENSE). Vendored dependencies keep their own licenses in `vendor/`. Use is subject to the [Terms of Use](TERMS.md).
