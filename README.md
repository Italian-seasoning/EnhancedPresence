<div align="center">
  <img src="assets/icon.png" alt="" width="120" />

  # Enhanced Presence

  Show what you are actually working on in Discord: the app, how long you have been in it, and what your coding agent is doing.

  macOS · Vencord plugin · GPL-3.0-or-later · source beta

  <img src="assets/thumbnail.svg" alt="Enhanced Presence status card" width="760" />
</div>

## Features

- **Your apps, your rules.** Shows the app you are using with its icon and elapsed time. Only apps you allow ever appear.
- **Agent task status.** While Claude Code works, your timer shows how long the task has been running and the status says what is happening: "Squashing bugs" after a failing test, "Running tests", "Writing code", "Shipping changes".
- **Optional AI wording.** Have Claude Haiku or Codex Luna rephrase that status. Off by default.
- **Project names.** Off by default, per app.
- **Music.** Optional Apple Music activity.
- **Settings inside Discord.** Settings → Vencord → Plugins → EnhancedPresenceUniversal.

Enhanced Presence is an independent custom plugin. It is not an official Vencord or Discord product, and modifying Discord's client is against Discord's terms. Read the [Terms of Use](TERMS.md) before installing.

## Requirements

macOS, Xcode command-line tools, Node.js 22+, Git, pnpm, CMake, a [Vencord source checkout](https://docs.vencord.dev/installing/), and a Discord **Application ID** from the [Developer Portal](https://discord.com/developers/applications). Never use a bot or account token.

## Install

From this repository:

```sh
npm run build:detector
npm run build:music
npm run install:companion -- YOUR_APPLICATION_ID --helper
npm run install:vencord -- /absolute/path/to/Vencord
```

Then, in your Vencord checkout:

```sh
pnpm install --frozen-lockfile
pnpm build --disable-updater
pnpm inject
```

Restart Discord, open the plugin settings, review the app list and press **Resume**. Discord's own activity-sharing setting must be on.

What `install:companion` does:

- Installs the background service and starts it at login. Later runs reuse your saved Application ID.
- With `--helper`, runs it through a small signed app, *EnhancedPresence Helper*, so macOS privacy lists show a named app with an icon instead of `node`.
- Adds the Claude Code hook (below). Use `--no-hooks` to skip it.

## Agent task status

The installer adds a tiny hook to `~/.claude/settings.json` for four events: prompt submitted, tool finished, tool failed and stop. It is a short shell script that appends one line to a local file, so it adds around ten milliseconds per call. It records only the kind of tool used and the project folder name, never prompts, commands or file paths. Your original settings are saved once as `settings.json.enhancedpresence.bak`, and your other hooks are left alone.

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

There is no automatic updater, because Vencord's own updater would replace a custom build. Pull this repository and Vencord, rerun the install and build commands, and restart Discord. Settings and pairing are kept. A Discord or macOS update may need a reinject or a small fix, and the Apple Music integration relies on a private macOS interface that can break.

## Uninstall

```sh
npm run install:companion -- --remove-hooks
launchctl bootout "gui/$(id -u)/app.enhancedpresence.engine"
rm ~/Library/LaunchAgents/app.enhancedpresence.engine.plist
rm -r "$HOME/Applications/EnhancedPresence Helper.app"
rm -r "$HOME/Library/Application Support/EnhancedPresence"
```

Then delete `src/userplugins/EnhancedPresenceUniversal` from your Vencord checkout and rebuild.

## Troubleshooting

| Problem | Try |
|---|---|
| Nothing shows on Discord | Press **Resume** in the plugin, turn on Discord's activity sharing, and check the app is allowed. |
| Plugin missing | Rebuild with `--disable-updater`, run `pnpm inject`, restart Discord. |
| No task timer | Check the hook is in `~/.claude/settings.json` and that a terminal, editor, Codex or Claude app is in front. |
| Project names empty | Grant Accessibility (above) and restart the service. |

## Development

```sh
npm test
```

## License

GPL-3.0-or-later, see [LICENSE](LICENSE). Vendored dependencies keep their own licenses in `vendor/`. Use is subject to the [Terms of Use](TERMS.md).
