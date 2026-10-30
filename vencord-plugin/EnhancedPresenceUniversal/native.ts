/* Licensed under GPL-3.0-or-later. */
import { homedir } from "os";
import { join } from "path";
import { readLocalPairing } from "./pairing.mjs";
import { AgentControl, AppUpdate, updateAgent, BehaviorUpdate, readControls, readRuntimeStatus, updateApp, updateIdle, updateBehavior } from "./controls.mjs";
import { app, shell } from "electron";
import { existsSync } from "fs";
import { execFile } from "child_process";
import { createInstalledIconLookup } from "./installed-icons.mjs";
import { createMusicArtworkLookup } from "./music-artwork.mjs";
import type { MusicArtworkRequest } from "./music-artwork.mjs";

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
export function saveIdleDuration(_event: Electron.IpcMainInvokeEvent, seconds: number) { return updateIdle(companionRoot(), seconds); }
export function saveBehavior(_event: Electron.IpcMainInvokeEvent, input: BehaviorUpdate) { return updateBehavior(companionRoot(), input); }
const roots = ["/Applications", "/Applications/Utilities", "/System/Applications", "/System/Applications/Utilities", "/System/Library/CoreServices", join(homedir(), "Applications")];
const installedIcon = createInstalledIconLookup({
    roots, exists: existsSync,
    findBundle: id => new Promise(resolve => execFile("/usr/bin/mdfind", [...roots.flatMap(root => ["-onlyin", root]), `kMDItemCFBundleIdentifier == "${id}"`], { timeout: 3000, maxBuffer: 32768 }, (error, stdout) => resolve(error ? [] : stdout.trim().split("\n")))),
    getFileIcon: async path => (await app.getFileIcon(path, { size: "normal" })).toDataURL()
});
export function getInstalledAppIcon(_event: Electron.IpcMainInvokeEvent, id: string) { return process.platform === "darwin" ? installedIcon(id) : Promise.resolve(undefined); }
const musicArtwork = createMusicArtworkLookup();
export function getMusicArtwork(_event: Electron.IpcMainInvokeEvent, input: MusicArtworkRequest) { return musicArtwork(input); }
export function saveAgentSettings(_event: Electron.IpcMainInvokeEvent, input: AgentControl) { return updateAgent(companionRoot(), input); }
export function openNamePermissions(_event: Electron.IpcMainInvokeEvent) {
    if (process.platform !== "darwin") return;
    return shell.openExternal("x-apple.systempreferences:com.apple.preference.security?Privacy_Accessibility");
}
