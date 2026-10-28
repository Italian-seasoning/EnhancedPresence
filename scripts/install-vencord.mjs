import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { randomBytes } from "node:crypto";

const source = fileURLToPath(new URL("../vencord-plugin/EnhancedPresenceUniversal", import.meta.url));
const marker = ".enhanced-presence-managed";
const markerContents = "EnhancedPresenceUniversal\n";
export function installPlugin(checkout) {
  const root = fs.realpathSync(checkout);
  const info = JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf8"));
  if (info.name !== "vencord") throw Error("Choose a Vencord source checkout.");
  const src = path.join(root, "src"), parent = path.join(src, "userplugins");
  if (!fs.lstatSync(src).isDirectory() || fs.lstatSync(src).isSymbolicLink()) throw Error("Invalid Vencord source directory.");
  fs.mkdirSync(parent, { recursive: true });
  if (!fs.lstatSync(parent).isDirectory() || fs.lstatSync(parent).isSymbolicLink()) throw Error("Invalid userplugins directory.");
  const target = path.join(parent, "EnhancedPresenceUniversal");
  const suffix = randomBytes(8).toString("hex");
  const stage = path.join(parent, `.enhanced-presence-${suffix}`);
  let backup;
  if (fs.existsSync(target)) {
    if (!fs.lstatSync(target).isDirectory() || fs.lstatSync(target).isSymbolicLink()) throw Error("Existing plugin is not managed; it was not changed.");
    const oldMarker = path.join(target, marker);
    if (!fs.existsSync(oldMarker) || fs.lstatSync(oldMarker).isSymbolicLink() || fs.readFileSync(oldMarker, "utf8") !== markerContents) throw Error("Existing plugin is not managed; it was not changed.");
  }
  try {
    fs.cpSync(source, stage, { recursive: true, errorOnExist: true });
    fs.writeFileSync(path.join(stage, marker), markerContents);
    if (fs.existsSync(target)) {
      const backups = path.join(root, ".enhanced-presence-backups");
      fs.mkdirSync(backups, { recursive: true, mode: 0o700 });
      if (!fs.lstatSync(backups).isDirectory() || fs.lstatSync(backups).isSymbolicLink()) throw Error("Invalid backup directory.");
      backup = path.join(backups, suffix);
      fs.renameSync(target, backup);
    }
    try { fs.renameSync(stage, target); }
    catch (error) { if (backup) fs.renameSync(backup, target); throw error; }
  } finally { fs.rmSync(stage, { recursive: true, force: true }); }
  return target;
}
if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  try {
    if (!process.argv[2]) throw Error("Usage: npm run install:vencord -- /path/to/Vencord");
    console.log(`Installed plugin source: ${installPlugin(process.argv[2])}`);
    console.log("Next: rebuild Vencord with --disable-updater and restart Discord.");
  } catch (error) { console.error(error.message); process.exitCode = 1; }
}
