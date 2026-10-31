# Enhanced Presence+ 0.10.0-beta.2

- Restores delayed app switching, keeps app elapsed time tied to the running app, and suppresses app-card flashes between songs.
- Adds private-by-default Apple Notes and a native Add Application picker with explicit Add and Allow.
- Expands the separate Messages theme across navigation, controls, replies and reactions, with local per-DM background choices.

- Adds a local Apple Music player with accents confined to the player.
- Includes **Messages for Discord** as a separate optional theme. Plus keeps your current Discord theme and uses one normal toolbar button for its tools.
- Adds private message collections, channel/DM workspaces and desktop notification rules.
- Adds voice controls and a native floating HUD with expiring, channel-bound commands.
- Preserves the released song, artist, album, cover and artist-portrait presence features.
- Keeps event-driven Music detection active in automatic Low Power Mode; explicit Always saver and CPU self-protection can still pause it.
- Playback controls use the named helper and an optional Music Automation grant.
- Keeps the bundled installer, runtime, update recovery and settings/history preservation.

This is an unsigned beta. Active-call verification remains dependent on an available live call.

Download the DMG for Apple Silicon (`arm64`) or Intel (`x64`), open **Install Enhanced Presence.app**, and follow setup. Node, Xcode, Git and source builds are not needed.

To use the optional Messages look, copy **PresenceMessages.theme.css** into the folder opened by **Vencord → Themes → Open Themes Folder**. Enable it by itself after turning off other full-client themes. It is also available as a separate download. The installer never changes your selected themes.

This is an **unsigned, unnotarized beta**. macOS may block it. The installer does not disable Gatekeeper, remove quarantine or request administrator access. Review the source and checksums before trusting the download.

- Installs the menu bar helper into your user Applications folder, with its own bundled runtime.
- Includes the tested Vencord plugin build; task status hooks remain optional.
- Apple Music shows song, artist, album and available public album art and artist portraits, without account access or local image uploads. Active music stays visible while unlocked, even after the app idle timeout.
- Select the stable Discord app in the native picker to allow setup to install Vencord. No broad privacy permission is needed by the helper.
- First use needs a public Discord Application ID, never a bot/account token. Sharing starts paused.
- Reopen this installer to uninstall the companion. Settings, app-time history and Vencord are preserved.

Built for macOS 13.5 or newer. Discord and macOS updates can require a later compatibility release. Use helper Settings if Discord hides Vencord's sidebar. Licenses and corresponding-source links are included in the app and source repository.
