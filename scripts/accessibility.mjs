import { execFileSync } from "node:child_process";
import { homedir } from "node:os";
import { join } from "node:path";
import { realpathSync } from "node:fs";

if (process.platform !== "darwin") throw Error("Accessibility setup is available on macOS.");
const agent = join(homedir(), "Library/LaunchAgents/app.enhancedpresence.engine.plist");
const detector = join(homedir(), "Library/Application Support/EnhancedPresence/build/detector");
try {
  const node = execFileSync("/usr/bin/plutil", ["-extract", "ProgramArguments.0", "raw", "-o", "-", agent], { encoding: "utf8" }).trim();
  console.log("To share project names, add these two files in Privacy & Security > Accessibility:");
  console.log(`  ${realpathSync(node)}\n  ${realpathSync(detector)}`);
  console.log("Node permission also applies to other programs run with that executable. Restart the companion after granting access.");
  if (process.argv.includes("--open")) execFileSync("/usr/bin/open", ["x-apple.systempreferences:com.apple.preference.security?Privacy_Accessibility"]);
} catch { console.error("Install the companion first, then run this command again."); process.exitCode = 1; }
