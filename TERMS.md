# Terms of Use

Last updated: 28 October 2026

**By installing or using the software you agree to these terms. If you do not agree, do not install or use it.**

Enhanced Presence ("the software") is free, open-source software released under the [GNU GPL v3 or later](LICENSE). These terms explain what you are agreeing to when you install and use it. They are written in plain language and are not legal advice.

## 1. Not affiliated

Enhanced Presence is an independent project. It is not made, endorsed or supported by Discord Inc., Vencord, Apple, Anthropic, OpenAI, Adobe, Blackmagic Design, or any other company whose name or app appears in it. All names, logos and trademarks belong to their owners and are used only to identify the apps you are using.

## 2. Discord and client modifications

The software is a custom Vencord plugin. Modifying the Discord client is against [Discord's Terms of Service](https://discord.com/terms), and Discord may act on accounts that use client modifications. By installing it you accept that risk. The authors are not responsible for any action Discord takes on your account, including warnings, restrictions or bans. Do not use it if that risk is not acceptable to you.

The software works alongside [Vencord](https://vencord.dev), a separate project with its own license and rules, and it patches Discord's installed app so that Vencord can load. Discord updates can overwrite or break that patch. Using the software with a Discord application ID also means you follow Discord's [Developer Terms](https://discord.com/developers/docs/policies-and-agreements/developer-terms-of-service) and [Developer Policy](https://discord.com/developers/docs/policies-and-agreements/developer-policy) for that application.

In standalone mode the software does not modify Discord at all: it only uses the local connection Discord provides for Rich Presence, so the client-modification risk above does not apply to that mode, although the other terms still do.

The plugin never asks for, reads or stores your Discord password, account token or bot token. If anything asks you for one, do not provide it.

## 3. Your responsibility for what you share

You decide which apps, names and labels appear on your profile. Anything you allow, rename or switch on (for example project names or custom activity text) is visible to people who can see your Discord activity. Review the app list before you resume sharing. Do not put private or confidential information in custom labels.

## 4. Privacy

Everything runs on your Mac. The software has no accounts, no analytics and no telemetry, and it does not send your data to the authors.

- It reads which app is in front, how long you have been idle, and, only if you turn it on, a document or project name for supported apps.
- It never reads document contents or full file paths.
- Settings, the pairing key and agent status files stay in `~/Library/Application Support/EnhancedPresence`.
- App icons are loaded by Discord from public image URLs when an icon is shown.

Optional features contact third parties only when you enable them:

- **AI wording** runs the `claude` or `codex` command-line tool you already have, under your own account and that provider's terms. It sends only tool categories, the app name and minutes elapsed.
- **Music** reads the now-playing information from macOS.

Claude Code hook: if you let the installer add it, it writes a short line per Claude Code event (tool category and project folder name) to a local file. It does not store prompts, commands or file paths. You can remove it at any time (see the README).

## 5. No warranty

The software is provided "as is", without warranty of any kind, as set out in sections 15 and 16 of the GPL. It depends on Discord, Vencord and macOS internals that can change without notice, so it may stop working or behave unexpectedly after an update.

## 6. Assumption of risk and limitation of liability

You use the software entirely at your own risk. To the fullest extent the law allows, the authors and contributors are not liable for any loss or damage of any kind arising from the software or its installation, including loss of data, damage to your computer or to the Discord or Vencord installations, loss of access to or action against any account (including by Discord), lost profits, or any indirect, incidental or consequential damages, even if they were told such damage was possible. You release the authors and contributors from all claims relating to your use of the software.

If you share or distribute a modified copy, you are responsible for your changes and for telling recipients about these terms.

## 7. Acceptable use

Do not use the software to mislead others about what you are doing, to harass anyone, to collect other people's information, or to break any law or any third party's terms. If you redistribute or modify it, you must follow the GPL and keep these notices.

## 8. Indemnity

If your use of the software, including anything you choose to publish on your Discord profile, causes a claim against the authors or contributors, you agree to cover their reasonable costs of dealing with it, to the extent the law allows.

## 9. General

If any part of these terms cannot be enforced, the rest still applies. These terms sit alongside the GPL, which governs copying, modification and distribution; if they conflict, the GPL controls what it covers. Nothing here limits a right the law does not let anyone limit.

## 10. Changes

These terms may be updated. The date above shows the latest version, and the history is in the repository. Continued use after a change means you accept the updated terms.

## 11. Contact

Questions, security reports and requests go through the repository's issue tracker.

## Note for users

These terms reduce the authors' exposure and tell you plainly what you are accepting, but no document can promise that nobody will ever be held liable. If you redistribute this software commercially, or you need certainty for your own situation, ask a qualified lawyer in your country to review it.
