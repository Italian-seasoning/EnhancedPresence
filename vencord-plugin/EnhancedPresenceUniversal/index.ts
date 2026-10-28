/* Licensed under GPL-3.0-or-later. */
import { definePluginSettings } from "@api/Settings";
import { getUserSettingLazy } from "@api/UserSettings";
import definePlugin, { OptionType, PluginNative } from "@utils/types";
import { FluxDispatcher, PresenceStore, React, UserStore } from "@webpack/common";
import { AppManager } from "./AppManager";
import { resolveArtwork } from "./artwork";
import { createClient } from "./client.mjs";
import IgnoreActivities from "@plugins/ignoreActivities";
import { fixActivityFilter } from "./compatibility.mjs";

// Run before Vencord applies enabled plugins' patches. Keep the user's filters.
fixActivityFilter(IgnoreActivities);

let active = false;
let connectionStatus = "Stopped";
let lastActivity: { name: string; details: string; } | null = null;
let localPairing: { applicationId: string; bridgeToken: string; } | null = null;
let pairingTimer: ReturnType<typeof setInterval> | undefined;
let behaviorLoaded = false;
const ShowCurrentGame = getUserSettingLazy<boolean>("status", "showCurrentGame")!;
const Native = VencordNative.pluginHelpers.EnhancedPresenceUniversal as PluginNative<typeof import("./native")> | undefined;
async function loadPairing() {
    if (!active || !Native?.getLocalPairing) return;
    try {
        const next = await Native.getLocalPairing();
        if (!active) return;
        if (!behaviorLoaded && Native.getAppControls) {
            const controls = await Native.getAppControls();
            if (!active) return;
            settings.store.paused = !controls.enabled;
            behaviorLoaded = true;
            client.refresh();
        }
        if (JSON.stringify(next) !== JSON.stringify(localPairing)) {
            localPairing = next;
            client.refresh();
        }
    } catch { /* Manual pairing remains available on web clients. */ }
}
function refresh() { if (active) client.refresh(); }
const settings = definePluginSettings({
    apps: { type: OptionType.COMPONENT, component: AppSettings },
    applicationId: { type: OptionType.STRING, description: "Discord application override", default: "", hidden: true, onChange: refresh },
    bridgeToken: { type: OptionType.STRING, description: "Local pairing override", default: "", hidden: true, onChange: refresh },
    paused: { type: OptionType.BOOLEAN, description: "Pause activity sharing", default: true, hidden: true },
    appIcons: { type: OptionType.BOOLEAN, description: "Show app icons", default: true, hidden: true }
});
const client = createClient({
    getSettings: () => ({ applicationId: settings.store.applicationId.trim() || localPairing?.applicationId || "", bridgeToken: settings.store.bridgeToken.trim() || localPairing?.bridgeToken || "", paused: settings.store.paused, appIcons: settings.store.appIcons }),
    socketFactory: (url: string) => new WebSocket(url),
    dispatch: (activity: unknown) => {
        lastActivity = activity as { name: string; details: string; } | null;
        FluxDispatcher.dispatch({ type: "LOCAL_ACTIVITY_UPDATE", socketId: "EnhancedPresenceUniversal", activity });
    },
    resolveAsset: resolveArtwork,
    shouldPublishMusic: () => {
        const user = UserStore.getCurrentUser();
        const ownId = settings.store.applicationId.trim() || localPairing?.applicationId;
        return !user || !PresenceStore.getActivities(user.id).some(activity => activity.type === 2 && activity.application_id !== ownId);
    },
    status: (value: string) => { connectionStatus = value; }
});
function AppSettings() {
    return React.createElement(AppManager, {
        native: Native,
        getStatus: () => ({ connection: connectionStatus, app: lastActivity?.name || "", details: lastActivity?.details || "", paused: settings.store.paused, appIcons: settings.store.appIcons,
            applicationId: settings.store.applicationId.trim() || localPairing?.applicationId || "",
            sharingEnabled: ShowCurrentGame.getSetting(),
            visible: Boolean(lastActivity && PresenceStore.getActivities(UserStore.getCurrentUser().id).some(a => a.application_id === (settings.store.applicationId.trim() || localPairing?.applicationId))) }),
        setPaused: async (value: boolean) => {
            if (!Native?.saveBehavior) throw Error("The desktop companion is required");
            const data = await Native.saveBehavior({ enabled: !value });
            settings.store.paused = value; refresh();
            return data;
        },
        setAppIcons: (value: boolean) => { settings.store.appIcons = value; refresh(); },
        enableSharing: () => ShowCurrentGame.updateSetting(true)
    });
}
export default definePlugin({
    name: "EnhancedPresenceUniversal",
    description: "Shares allowed apps and compatible music, with delayed app switching and local app-time totals.",
    authors: [{ name: "Italian-seasoning", id: 0n }],
    dependencies: ["UserSettingsAPI"],
    settings,
    start() { active = true; client.start(); void loadPairing(); pairingTimer = setInterval(() => void loadPairing(), 15000); },
    stop() { active = false; clearInterval(pairingTimer); pairingTimer = undefined; localPairing = null; behaviorLoaded = false; client.stop(); }
});
