import { execFileSync } from "node:child_process";
import { homedir } from "node:os";
import { join } from "node:path";
import { existsSync } from "node:fs";

if (process.platform !== "darwin") throw Error("Accessibility setup is available on macOS.");
const helper = join(homedir(), 'Applications/EnhancedPresence Helper.app');
try {
  if (!existsSync(helper)) throw Error();
  console.log('Basic app presence needs no macOS privacy permissions. Accessibility is optional, only for project/document names you enable.');
  console.log(`If you choose to share names, add only the named helper in Privacy & Security > Accessibility:\n  ${helper}`);
  console.log('Never add Node, Terminal, or your shell for Enhanced Presence. If names remain unavailable, keep them off; generic presence still works.');
  if (process.argv.includes("--open")) execFileSync("/usr/bin/open", ["x-apple.systempreferences:com.apple.preference.security?Privacy_Accessibility"]);
} catch { console.error("Install the companion first, then run this command again."); process.exitCode = 1; }
