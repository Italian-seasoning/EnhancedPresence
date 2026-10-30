import { createHash } from "node:crypto";
import { constants } from "node:fs";
import { access, copyFile, lstat, mkdir, open, readFile, readdir, rename, rm, stat, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { homedir } from "node:os";
import { fileURLToPath } from "node:url";

const same = (a, b) => a.equals(b);
const exists = async p => access(p).then(() => true, e => { if (e.code === "ENOENT") return false; throw e; });
async function regular(p) {
  const s = await lstat(p);
  if (!s.isFile() || s.isSymbolicLink()) throw Error(`Unsafe file: ${p}`);
  return s;
}
async function archive(p) {
  const s = await regular(p);
  if (s.size < 1024) return false;
  const f = await open(p, "r");
  try {
    const h = Buffer.alloc(16); if ((await f.read(h, 0, 16, 0)).bytesRead !== 16) return false;
    const n = h.readUInt32LE(12);
    if (h.readUInt32LE(0) !== 4 || n < 2 || n > 1024 * 1024 || 16 + n > s.size) return false;
    const body = Buffer.alloc(n); if ((await f.read(body, 0, n, 16)).bytesRead !== n) return false;
    const files = JSON.parse(body.toString()).files;
    return !!files && typeof files === "object" && !Array.isArray(files);
  } catch { return false; } finally { await f.close(); }
}
async function atomicCopy(source, dest) {
  const tmp = `${dest}.presence-${process.pid}.tmp`;
  try { await copyFile(source, tmp, constants.COPYFILE_EXCL); await rename(tmp, dest); }
  finally { await rm(tmp, { force: true }); }
}
async function backupFile(source, backups, label) {
  if (!(await exists(source))) return;
  await regular(source);
  await mkdir(backups, { recursive: true, mode: 0o700 });
  await copyFile(source, join(backups, `${Date.now()}-${process.pid}-${label}`), constants.COPYFILE_EXCL);
}
export async function repair({ resources, dist, managed, backups, files, rename: move = rename }) {
  const app = join(resources, "app.asar"), original = join(resources, "_app.asar"), loader = join(managed, "loader.asar");
  await regular(loader);
  const loaderBytes = await readFile(loader);
  if (loaderBytes.length > 4096 || !loaderBytes.includes(Buffer.from("Vencord/dist/patcher.js"))) throw Error("Invalid managed loader");
  let changed = false;
  if (await exists(app)) {
    await regular(app);
    const current = await stat(app);
    const isLoader = current.size === loaderBytes.length && same(await readFile(app), loaderBytes);
    if (!isLoader) {
      if (!(await archive(app))) throw Error("Unrecognized Discord app.asar; refusing to replace it");
      const staged = `${app}.presence-${process.pid}.tmp`;
      try {
        await copyFile(loader, staged, constants.COPYFILE_EXCL);
        if (await exists(original)) {
          if (!(await archive(original))) throw Error("Unrecognized Discord _app.asar; refusing to replace it");
          await backupFile(original, backups, "previous-discord.asar");
        }
        await move(app, original);
        try { await move(staged, app); }
        catch (error) { await move(original, app); throw error; }
      } finally {
        await rm(staged, { force: true });
      }
      changed = true;
    } else if (!(await exists(original)) || !(await archive(original))) {
      throw Error("Discord original archive missing or invalid");
    }
  } else {
    if (!(await exists(original)) || !(await archive(original))) throw Error("Discord archive not ready");
    await atomicCopy(loader, app);
    changed = true;
  }
  await mkdir(dist, { recursive: true });
  for (const name of files) {
    if (name !== name.split("/").pop() || name.startsWith(".")) throw Error("Invalid managed filename");
    const src = join(managed, name), dst = join(dist, name);
    await regular(src);
    if (await exists(dst)) {
      await regular(dst);
      if (same(await readFile(src), await readFile(dst))) continue;
      await backupFile(dst, backups, `vencord-${name}`);
    }
    await atomicCopy(src, dst);
    changed = true;
  }
  return changed;
}
async function main() {
  const home = process.env.ENHANCED_PRESENCE_HOME || homedir();
  const base = join(home, "Library/Application Support/EnhancedPresence/maintenance"), managed = join(base, "managed");
  const lock = join(base, "repair.lock");
  try { await mkdir(lock, { mode: 0o700 }); }
  catch (e) {
    if (e.code !== "EEXIST") throw e;
    const age = Date.now() - (await stat(lock)).mtimeMs;
    if (age < 300000) return;
    let pid = 0;
    try { pid = Number(await readFile(join(lock, "pid"), "utf8")); } catch {}
    if (Number.isInteger(pid) && pid > 0) {
      try { process.kill(pid, 0); return; } catch (err) { if (err.code !== "ESRCH") return; }
    }
    await rm(lock, { recursive: true, force: true });
    try { await mkdir(lock, { mode: 0o700 }); } catch (err) { if (err.code === "EEXIST") return; throw err; }
  }
  try {
    await writeFile(join(lock, "pid"), String(process.pid));
    const manifest = JSON.parse(await readFile(join(managed, "manifest.json"), "utf8"));
    for (const [name, expected] of Object.entries(manifest)) {
      if (name !== name.split("/").pop() || name.startsWith(".")) throw Error("Invalid manifest");
      const p = join(managed, name); await regular(p);
      const hash = createHash("sha256").update(await readFile(p)).digest("hex");
      if (hash !== expected) throw Error("Managed build integrity check failed");
    }
    if (!manifest["loader.asar"] || !manifest["renderer.js"] || !manifest["patcher.js"]) throw Error("Incomplete managed build");
    const resources = process.env.ENHANCED_PRESENCE_RESOURCES || "/Applications/Discord.app/Contents/Resources";
    // shortcut: waits for recent updater writes, increase the delay if Discord changes its update process.
    if (!(await exists(resources)) || Date.now() - (await stat(resources)).mtimeMs < 30000) return;
    for (const name of ["app.asar", "_app.asar"]) {
      const p = join(resources, name);
      if (await exists(p) && Date.now() - (await stat(p)).mtimeMs < 30000) return;
    }
    const dist = join(home, "Library/Application Support/Vencord/dist");
    if (await exists(dist) && Date.now() - (await stat(dist)).mtimeMs < 30000) return;
    await repair({ resources, dist, managed, backups: join(base, "backups"), files: Object.keys(manifest).filter(n => n !== "loader.asar") });
  } finally { await rm(lock, { recursive: true, force: true }); }
}
if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) main().catch(e => { console.error(`EnhancedPresence repair: ${e.message}`); process.exitCode = 1; });
