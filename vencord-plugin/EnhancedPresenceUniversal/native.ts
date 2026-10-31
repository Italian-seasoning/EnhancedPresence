/* Licensed under GPL-3.0-or-later. */
import { homedir } from "os";
import { join } from "path";
import { randomUUID } from "crypto";
import { readLocalPairing } from "./pairing.mjs";
import { AgentControl, AppUpdate, updateAgent, BehaviorUpdate, readControls, readRuntimeStatus, updateApp, updateIdle, updateBehavior } from "./controls.mjs";
import { app, dialog, shell } from "electron";
import { existsSync, lstatSync, readFileSync, writeFileSync, renameSync, unlinkSync } from "fs";
import { execFile } from "child_process";
import { createInstalledIconLookup } from "./installed-icons.mjs";
import { createMusicImagesLookup } from "./music-artwork.mjs";
import { controlMusic as issueMusicControl, readLocalMusicArtwork, readLocalPlayback as readPlayback, setLocalPlayerEnabled } from "./music-player.mjs";
import type { MusicAction } from "./music-player.mjs";
import type { LocalMusicArtworkRequest } from "./music-player.mjs";
import type { MusicArtworkRequest } from "./music-artwork.mjs";
import { normalizeVoiceCommand, normalizeVoiceSnapshot, voiceCommandIsCurrent } from "./voice-state.mjs";
import type { VoiceCommand, VoiceSnapshot } from "./voice-state.mjs";

// Read only the installed companion's local pairing file, never Discord credentials.
function companionRoot() {
    return process.platform === "darwin"
        ? join(homedir(), "Library", "Application Support", "EnhancedPresence")
        : process.platform === "win32"
            ? join(process.env.APPDATA || join(homedir(), "AppData", "Roaming"), "EnhancedPresence")
            : join(process.env.XDG_CONFIG_HOME || join(homedir(), ".config"), "EnhancedPresence");
}
export function getLocalPairing(_event: Electron.IpcMainInvokeEvent) { return readLocalPairing(companionRoot()); }
export function getAppControls(_event: Electron.IpcMainInvokeEvent) { return readControls(companionRoot()); }
export function getRuntimeStatus(_event: Electron.IpcMainInvokeEvent) { return readRuntimeStatus(companionRoot()); }
export function saveAppControl(_event: Electron.IpcMainInvokeEvent, input: AppUpdate) { return updateApp(companionRoot(), input); }
export type ApplicationChoice = { id: string; name: string };
export async function chooseApplication(_event: Electron.IpcMainInvokeEvent): Promise<ApplicationChoice | null> {
    if (process.platform !== "darwin") throw Error("Application picker is available on macOS");
    const result = await dialog.showOpenDialog({
        title: "Add an Application",
        buttonLabel: "Choose Application",
        properties: ["openFile"],
        filters: [{ name: "Applications", extensions: ["app"] }]
    });
    if (result.canceled || result.filePaths.length !== 1) return null;
    const path = result.filePaths[0];
    if (!path.toLowerCase().endsWith(".app")) throw Error("Select a macOS application bundle");
    const bundle = lstatSync(path), infoPath = join(path, "Contents", "Info.plist"), info = lstatSync(infoPath);
    if (!bundle.isDirectory() || bundle.isSymbolicLink() || !info.isFile() || info.isSymbolicLink() || info.size > 65536) throw Error("Application information is unavailable");
    const plist = await new Promise<string>((resolve, reject) => execFile("/usr/bin/plutil", ["-convert", "json", "-o", "-", infoPath], { timeout: 3000, maxBuffer: 131072, encoding: "utf8" }, (error, stdout) => error ? reject(error) : resolve(stdout)));
    const metadata = JSON.parse(plist) as Record<string, unknown>;
    const id = metadata.CFBundleIdentifier;
    const rawName = metadata.CFBundleDisplayName ?? metadata.CFBundleName;
    const name = typeof rawName === "string" ? rawName : path.slice(path.lastIndexOf("/") + 1, -4);
    if (typeof id !== "string" || id.length > 200 || !/^[A-Za-z0-9_-]+(?:\.[A-Za-z0-9_-]+)+$/.test(id)
        || typeof name !== "string" || name.length < 2 || name.length > 128 || /[\x00-\x1f\x7f-\x9f]/.test(name) || !name.trim()) throw Error("Application name or identifier is invalid");
    return { id, name };
}
export function saveIdleDuration(_event: Electron.IpcMainInvokeEvent, seconds: number) { return updateIdle(companionRoot(), seconds); }
export function saveBehavior(_event: Electron.IpcMainInvokeEvent, input: BehaviorUpdate) { return updateBehavior(companionRoot(), input); }
const roots = ["/Applications", "/Applications/Utilities", "/System/Applications", "/System/Applications/Utilities", "/System/Library/CoreServices", join(homedir(), "Applications")];
const installedIcon = createInstalledIconLookup({
    roots, exists: existsSync,
    findBundle: id => new Promise(resolve => execFile("/usr/bin/mdfind", [...roots.flatMap(root => ["-onlyin", root]), `kMDItemCFBundleIdentifier == "${id}"`], { timeout: 3000, maxBuffer: 32768 }, (error, stdout) => resolve(error ? [] : stdout.trim().split("\n")))),
    getFileIcon: async path => (await app.getFileIcon(path, { size: "normal" })).toDataURL()
});
export function getInstalledAppIcon(_event: Electron.IpcMainInvokeEvent, id: string) { return process.platform === "darwin" ? installedIcon(id) : Promise.resolve(undefined); }
const musicImages = createMusicImagesLookup();
export function getMusicImages(_event: Electron.IpcMainInvokeEvent, input: MusicArtworkRequest) { return musicImages(input); }
export function saveAgentSettings(_event: Electron.IpcMainInvokeEvent, input: AgentControl) { return updateAgent(companionRoot(), input); }
export function openNamePermissions(_event: Electron.IpcMainInvokeEvent) {
    if (process.platform !== "darwin") return;
    return shell.openExternal("x-apple.systempreferences:com.apple.preference.security?Privacy_Accessibility");
}

export function getApplicationId(_event: Electron.IpcMainInvokeEvent) { return readLocalPairing(companionRoot())?.applicationId ?? ""; }
export function readLocalPlayback(_event: Electron.IpcMainInvokeEvent) { return readPlayback(companionRoot()); }
export function setLocalPlayer(_event: Electron.IpcMainInvokeEvent, enabled: boolean) { return setLocalPlayerEnabled(companionRoot(), enabled); }
export function controlMusic(_event: Electron.IpcMainInvokeEvent, action: MusicAction) { return issueMusicControl(companionRoot(), action); }
export function getLocalMusicArtwork(_event: Electron.IpcMainInvokeEvent, input: LocalMusicArtworkRequest) { return readLocalMusicArtwork(companionRoot(), input); }

function privateVoiceFile(name: string, limit: number) {
    const root = companionRoot();
    const folder = lstatSync(root);
    if (!folder.isDirectory() || folder.isSymbolicLink()
        || (process.platform !== "win32" && ((folder.mode & 0o077) !== 0 || folder.uid !== process.getuid?.()))) throw Error("Private voice state unavailable");
    const path = join(root, name);
    let stat;
    try { stat = lstatSync(path); }
    catch (error) { if (errorCode(error) === "ENOENT") return { path, value: null }; throw error; }
    if (!stat.isFile() || stat.isSymbolicLink() || stat.size > limit
        || (process.platform !== "win32" && ((stat.mode & 0o077) !== 0 || stat.uid !== process.getuid?.()))) throw Error("Private voice state unavailable");
    return { path, value: JSON.parse(readFileSync(path, "utf8")) };
}

function writePrivateVoice(name: string, value: unknown) {
    const root = companionRoot();
    const folder = lstatSync(root);
    if (!folder.isDirectory() || folder.isSymbolicLink()
        || (process.platform !== "win32" && ((folder.mode & 0o077) !== 0 || folder.uid !== process.getuid?.()))) throw Error("Private voice state unavailable");
    const destination = join(root, name);
    try {
        const existing = lstatSync(destination);
        if (!existing.isFile() || existing.isSymbolicLink()
            || (process.platform !== "win32" && ((existing.mode & 0o077) !== 0 || existing.uid !== process.getuid?.()))) throw Error("Private voice state unavailable");
    } catch (error) { if (errorCode(error) !== "ENOENT") throw error; }
    const temporary = join(root, `.voice.${randomUUID()}.tmp`);
    try {
        writeFileSync(temporary, JSON.stringify(value) + "\n", { flag: "wx", mode: 0o600 });
        renameSync(temporary, destination);
    } finally { try { unlinkSync(temporary); } catch { /* Already renamed or not created. */ } }
}

function errorCode(error: unknown): string | undefined {
    if (!(error instanceof Error) || !("code" in error)) return undefined;
    return typeof error.code === "string" ? error.code : undefined;
}

export function writeVoiceState(_event: Electron.IpcMainInvokeEvent, input: VoiceSnapshot | null) {
    if (input === null) return clearVoiceState();
    const state = normalizeVoiceSnapshot(input);
    if (!state) throw Error("Invalid voice state");
    writePrivateVoice("voice.local.json", state);
    return state;
}

export function clearVoiceState(_event?: Electron.IpcMainInvokeEvent) {
    const { path } = privateVoiceFile("voice.local.json", 4096);
    try { unlinkSync(path); } catch (error) { if (errorCode(error) !== "ENOENT") throw error; }
}

export function takeVoiceHUDCommand(_event: Electron.IpcMainInvokeEvent, channelId: string): VoiceCommand | null {
    if (typeof channelId !== "string" || !/^\d{17,20}$/.test(channelId)) return null;
    const { path, value } = privateVoiceFile("voice-command.local.json", 1024);
    if (!value) return null;
    const command = normalizeVoiceCommand(value);
    try { unlinkSync(path); } catch (error) { if (errorCode(error) !== "ENOENT") throw error; }
    return voiceCommandIsCurrent(command, channelId) ? command : null;
}
