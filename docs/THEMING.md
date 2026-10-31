# Theme maintenance map

`themes/PresenceMessages.theme.css` is a standalone Vencord theme. It is copied into the release DMG for users to install separately. The presence plugin must not select it, mutate the user's theme settings, or bundle its selectors into `suite.css`. Keep the theme local: no `@import`, network URLs, remote fonts, or scripts.

## Tokens

Theme-owned palette and material tokens live under `--ep-messages-*`:

- `--ep-messages-chat`, `--ep-messages-sidebar`, `--ep-messages-floating`, `--ep-messages-glass`, `--ep-messages-backdrop`
- `--ep-messages-text`, `--ep-messages-muted`, `--ep-messages-incoming`, `--ep-messages-blue`, `--ep-messages-blue-high-contrast`, `--ep-messages-border`
- `--ep-messages-wallpaper-veil` for the opt-in DM photo/preset layer

Discord's `--chat-background-default`, `--background-base-*`, `--background-surface-*`, and `--background-mod-*` aliases map to these surfaces. Keep the core chat/sidebar/floating colors moderately translucent so macOS Sidebar vibrancy can show through; text and controls stay opaque and readable.

Light and dark root selectors set these tokens. The normal palette uses platform Messages blues (`#007aff` light, `#0a84ff` dark); `prefers-contrast: more` switches to the darker `--ep-messages-blue-high-contrast` so white bubble text reaches 4.5:1. Discord's noncritical surface, text, control, and input tokens map to these theme tokens. Leave status, error, connected, and disabled tokens alone. Don't use translucency or blur as the only state cue.

## Native macOS vibrancy

The CSS leaves `html`, `body` and the app backing transparent and layers translucent chat, sidebar and floating surfaces above them. For the native frosted material across the full Discord window, open **Discord Settings → Vencord → Vencord → MacOS Window vibrancy style** and select **Sidebar**. Leave **Enable window transparency** off: the Sidebar vibrancy style supplies a transparent window backing without changing Discord's resizing behavior. Fully quit and reopen Discord to apply the native setting. Native vibrancy blurs content behind the window; CSS `backdrop-filter` blurs content behind the floating controls inside Discord. Gradients do not simulate the glass material. Reduce Transparency uses solid surfaces instead.

## Selector map

- **App surfaces:** `#app-mount` backdrop; Discord class stems for channel/chat, sidebars, member list, user panels, composer, popouts, and menus. Float the chat heading capsules over the conversation with top clearance for the message list. Style only direct `toolbar_` children matching clickable `iconWrapper_` role-buttons; preserve disabled icons, the search field, native actions and layout responsiveness. Use class stems such as `[class*="sidebarList_"]`, not build hashes. Keep chat-content transparent rather than stacking its tint on the chat wrapper.
- **Settings modal:** scope to the current structural signature: dialog → `outerContainer_` → `container_` + `modal_` → `modalContent_` → `modalContentInner_` → `container_` → adjacent `sidebar__` and `content_`. The sidebar uses `fixedContent__`, `nav__`, `navScroller__`; main header uses `contentHeader_`. This reaches both current Vencord and standard settings pages. Keep the legacy selectors as fallbacks and avoid styling unrelated dialogs.
- **Message bubbles:** only regular rows under `[data-list-id="chat-messages"]`, excluding `.systemMessage_`, targeting the direct `contents_` → `[id^="message-content-"]` child when it either has `.markup_` itself or contains `.markup_`. This covers Discord's current plain-text node. Keep the row, avatar, attachment, embed, reaction, code, and accessibility structure intact. Draw tails with pointer-inert pseudo elements.
- **Replies and reactions:** style the `repliedMessage_` quote surface; preserve the native `messageSpine_` and `repliedMessageClickableSpine_` connector and expanded hit target. Clipping belongs to the native `repliedTextPreview_`/`repliedTextContent_` children. Style `reaction_` as compact rounded chips without hiding emoji, counts, or buttons. The quick-reaction menu is a `wrapper_` group of `customItem_` menu items containing `button_` controls; keep their existing actions and keyboard focus. Message hover actions use `buttonsInner_`.
- **Direct-message density:** `:root[data-ep-direct-message]` applies only to one-to-one DMs. Repeated avatars and their decorations are visually clipped. Message metadata appears on hover or keyboard focus without changing row height; never apply this selector to group DMs or server channels.
- **Composer menu:** Plus adds a trigger through Vencord's ChatBarButton API and portals its own button into the native attachment-button slot. The original Discord/plugin controls stay mounted. Only bounded, labeled actions in the current composer's attachment/button areas are grouped; Send, disabled actions and unknown controls retain their native safeguards. Actions check the account, channel and connected composer before invoking the original handler synchronously, including native file-picker activation. Local line icons avoid dependencies on Discord's animated/masked SVG geometry; unknown actions retain their original labels and use a generic apps icon. The compact rows have colored hover/focus accents and a brief opening motion, disabled with Reduce Motion. Grouping is enabled solely by this theme's CSS and a successful `data-ep-composer-ready` binding. Disabling the theme or plugin restores the original controls. There is no new permission, network call or message-content access.
- **Per-DM wallpaper:** `:root[data-ep-dm-wallpaper]` is distinct from the direct-message marker and is set only for a selected 1:1 or group DM with a saved background. Use the prevalidated `--ep-dm-wallpaper` value only on the chat-content backdrop pseudo layer; don't apply it to servers or the message list itself.
- **Presence+ panel:** `.ep-plus-*` rules may refine the panel while this theme is selected. Don't let the standalone theme change the panel's data, actions, or ownership of local background settings.

## Snapchat theme

`themes/PresenceSnapchat.theme.css` reuses the selector map above with its own `--ep-snapchat-*` tokens. Never share tokens or rules between the two theme files or `suite.css`.

- **Tokens:** `--ep-snapchat-yellow` and `--ep-snapchat-on-yellow` (always black), surface tokens (`chat`, `sidebar`, `glass`, `floating`, `field`, `border`), `text`/`muted`, and sender colors `--ep-snapchat-me` (red) and `--ep-snapchat-friend` (blue) with `-high-contrast` variants that `prefers-contrast: more` swaps in along with a thicker `--ep-snapchat-rail`. Light-mode sender colors must reach 4.5:1 on white and on the field surface; `tests/theme.test.mjs` checks this.
- **Yellow rule:** Snap Yellow is only a fill behind black text (selected DM row, primary buttons, your reactions, the expanded composer toggle and hovered menu icons). Yellow has about 1.1:1 contrast with white, so a yellow fill also gets the `--ep-snapchat-selected-edge` inset edge, and yellow is never used for text, focus rings or hairlines.
- **Messages:** no bubbles. Regular message text gets a left rail colored by sender; usernames become uppercase sender labels. Discord's inline role colors in servers still win over the label color. One-to-one DMs clip avatars (as Messages does) but keep the name header visible. The header and composer stay in their native positions, so there are no scroll-spacer or floating-header offsets to maintain.
- **Shared hooks:** the composer-menu, DM-density and DM-wallpaper rules use the same plugin attributes as Messages, with `--ep-snapchat-wallpaper-veil`.

Class stems and structural relationships are compatibility hooks, not a public Discord API. Recheck them after Discord updates rather than copying generated suffixes into a new theme. Keep a new theme's palette separate from its component rules so the same surface map can guide another design.

## Update workflow

Before changing selectors after a Discord update, inspect the live element hierarchy and computed styles, record stable class stems and parent relationships, then scope selectors to those relationships. Keep selectors free of generated suffixes. Check the current Vencord modal as well as a legacy Settings layout, regular and system messages, attachment-only rows, one-to-one and group DMs, reactions, reply references, menus, light/dark mode, Reduce Transparency, and forced colors. Verify that each DM marker clears when its chat or account changes and that disabling the standalone theme restores normal Discord styling.
