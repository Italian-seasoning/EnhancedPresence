/* Licensed under GPL-3.0-or-later. */
import { definePluginSettings } from "@api/Settings";
import { disableStyle, enableStyle } from "@api/Styles";
import { ChatBarButton } from "@api/ChatButtons";
import * as DataStore from "@api/DataStore";
import { getUserSettingLazy } from "@api/UserSettings";
import { findByPropsLazy } from "@webpack";
import definePlugin, { OptionType, PluginNative } from "@utils/types";
import type { IconComponent } from "@utils/types";
import { ChannelRTCStore, ChannelStore, FluxDispatcher, PresenceStore, React, SelectedChannelStore, UserStore, VoiceStateStore } from "@webpack/common";
import type { Message } from "@vencord/discord-types";
import { AppManager } from "./AppManager";
import { ComposerMenu } from "./ComposerMenu";
import { resolveArtwork } from "./artwork";
import { createClient } from "./client.mjs";
import type { MusicArtworkRequest } from "./music-artwork.mjs";
import IgnoreActivities from "@plugins/ignoreActivities";
import { fixActivityFilter } from "./compatibility.mjs";
import { collectionContextMenu, SuiteEntry, setPlusFeatures, setPlusGroups, setPlusVoice, openPlus } from "./suite";
import { featureSettings, featuresKey, notificationRulesKey } from "./suite-state.mjs";
import { createVoiceModule } from "./voice.mjs";
import { createNotificationRouter, shouldShowDesktopNotification as shouldShowRuleNotification, validateNotificationRules } from "./notification-rules.mjs";
import { desktopNotificationPatch } from "./notifications";
import type { NotificationRule } from "./notification-rules.mjs";
import suiteStyle from "./suite.css?managed";

// Run before Vencord applies enabled plugins' patches. Keep the user's filters.
fixActivityFilter(IgnoreActivities);

let active = false;
let connectionStatus = "Stopped";
let lastActivity: { name: string; details: string; } | null = null;
let localPairing: { applicationId: string; bridgeToken: string; } | null = null;
let pairingTimer: ReturnType<typeof setInterval> | undefined;
let accountListener: (() => void) | undefined;
let activeAccountId: string | null = null;
let activeFeatures = featureSettings({ musicPlayer: false, messageShelf: false, workspaces: false, notifications: false, voice: false });
let activeNotificationRules: NotificationRule[] = [];
let featureGeneration = 0;
const ShowCurrentGame = getUserSettingLazy<boolean>("status", "showCurrentGame")!;
const Native = VencordNative.pluginHelpers.EnhancedPresenceUniversal as PluginNative<typeof import("./native")> | undefined;
const MediaEngineActions: { toggleSelfMute(): void; toggleSelfDeaf(): void } = findByPropsLazy("toggleSelfMute", "toggleSelfDeaf");
const notificationRouter = createNotificationRouter({
    getRules: () => activeNotificationRules,
    getEnabled: () => active && activeFeatures.notifications,
    emitGroup: () => setPlusGroups(notificationRouter.snapshot())
});
const voiceModule = createVoiceModule({
    enabled: () => active && activeFeatures.voice,
    native: Native ? {
        writeVoiceState: value => Native.writeVoiceState(value),
        takeVoiceHUDCommand: channelId => Native.takeVoiceHUDCommand(channelId)
    } : undefined,
    readSnapshot: () => {
        const channelId = SelectedChannelStore.getVoiceChannelId();
        if (!channelId) return null;
        const channel = ChannelStore.getChannel(channelId);
        const ownState = VoiceStateStore.getVoiceStateForChannel(channelId);
        if (!channel || !ownState) return null;
        const states = VoiceStateStore.getVoiceStatesForChannel(channelId) ?? {};
        const speaking = new Set((ChannelRTCStore.getSpeakingParticipants(channelId) as Array<{ id?: string; user?: { id?: string } }>).map(participant => participant.user?.id ?? participant.id).filter((id): id is string => !!id));
        return {
            version: 1 as const,
            updatedAt: Date.now(),
            channelId,
            channelName: channel.name ?? "Voice channel",
            selfMute: ownState.selfMute === true,
            selfDeaf: ownState.selfDeaf === true,
            speakers: Object.entries(states).slice(0, 8).map(([id]) => {
                const user = UserStore.getUser(id);
                return { id, name: user?.globalName || user?.username || "Member", speaking: speaking.has(id) };
            })
        };
    },
    setSelfMute: value => {
        const channelId = SelectedChannelStore.getVoiceChannelId();
        if (channelId && VoiceStateStore.getVoiceStateForChannel(channelId)?.selfMute !== value) MediaEngineActions.toggleSelfMute();
    },
    setSelfDeaf: value => {
        const channelId = SelectedChannelStore.getVoiceChannelId();
        if (channelId && VoiceStateStore.getVoiceStateForChannel(channelId)?.selfDeaf !== value) MediaEngineActions.toggleSelfDeaf();
    },
    onChange: snapshot => setPlusVoice(snapshot)
});
async function syncAccountFeatures() {
    const generation = ++featureGeneration;
    const accountId = UserStore.getCurrentUser()?.id;
    const requestIsCurrent = () => active && generation === featureGeneration && (UserStore.getCurrentUser()?.id ?? null) === (accountId ?? null);
    if (!active) return;
    if ((accountId ?? null) !== activeAccountId) {
        activeAccountId = accountId ?? null;
        activeFeatures = featureSettings({ musicPlayer: false, messageShelf: false, workspaces: false, notifications: false, voice: false });
        activeNotificationRules = []; notificationRouter.clearGroups(); setPlusGroups([]);
        setPlusFeatures(activeFeatures);
        try { await Native?.setLocalPlayer(false); await voiceModule.stop(); setPlusVoice(null); } catch { /* Account switches still clear Discord-side state. */ }
    }
    if (!accountId) {
        return;
    }
    try {
        const [rawFeatures, rawRules] = await Promise.all([
            DataStore.get<unknown>(featuresKey(accountId)),
            DataStore.get<unknown>(notificationRulesKey(accountId))
        ]);
        if (!active || generation !== featureGeneration || UserStore.getCurrentUser()?.id !== accountId) return;
        activeFeatures = featureSettings(rawFeatures);
        activeNotificationRules = rawRules === undefined ? [] : validateNotificationRules(rawRules);
        setPlusFeatures(activeFeatures);
        await Native?.setLocalPlayer(activeFeatures.musicPlayer);
        if (!requestIsCurrent()) return;
        if (activeFeatures.voice) await voiceModule.start();
        else { await voiceModule.stop(); setPlusVoice(null); }
    } catch {
        if (!requestIsCurrent()) return;
        activeFeatures = featureSettings({ musicPlayer: false, messageShelf: false, workspaces: false, notifications: false, voice: false });
        activeNotificationRules = []; activeAccountId = null;
        setPlusFeatures(activeFeatures);
        notificationRouter.clearGroups();
        setPlusGroups([]);
        try { await Native?.setLocalPlayer(false); await voiceModule.stop(); } catch { /* Keep UI usable when companion access is unavailable. */ }
        setPlusVoice(null);
    }
}
async function loadPairing() {
    if (!active || !Native?.getLocalPairing) return;
    try {
        const next = await Native.getLocalPairing();
        if (!active) return;
        if (Native.getAppControls) {
            const controls = await Native.getAppControls();
            if (!active) return;
            if (settings.store.paused !== !controls.enabled) {
                settings.store.paused = !controls.enabled;
                client.refresh();
            }
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
    lookupMusicImages: (request: MusicArtworkRequest) => Native?.getMusicImages ? Native.getMusicImages(request) : Promise.resolve(null),
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
const PlusIcon: IconComponent = ({ width = 20, height = 20, className }) => React.createElement(
    "svg",
    { width, height, className, viewBox: "0 0 24 24", "aria-hidden": true },
    React.createElement("path", { fill: "currentColor", d: "M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20Zm1 5v4h4v2h-4v4h-2v-4H7v-2h4V7h2Z" })
);
function PlusChatButton({ isMainChat, channel }: { isMainChat: boolean; channel: { id: string } }) {
    if (!isMainChat) return null;
    return React.createElement(React.Fragment, null,
        React.createElement(SuiteEntry, { native: Native }),
        React.createElement(ComposerMenu, { channelId: channel.id }),
        React.createElement(ChatBarButton, { tooltip: "Open Enhanced Presence+", onClick: () => openPlus("music"), children: React.createElement(PlusIcon, {}) })
    );
}

function notificationAllowed(message: unknown) {
    const userId = UserStore.getCurrentUser()?.id;
    return shouldShowRuleNotification(message, notificationRouter, {
        getChannel: id => ChannelStore.getChannel(id), currentUserId: userId
    });
}
export default definePlugin({
    name: "EnhancedPresenceUniversal",
    description: "Shares allowed apps and compatible music, with delayed app switching and local app-time totals.",
    authors: [{ name: "Italian-seasoning", id: 0n }],
    enabledByDefault: true,
    dependencies: ["UserSettingsAPI"],
    settings,
    patches: [desktopNotificationPatch],
    chatBarButton: { icon: PlusIcon, render: PlusChatButton },
    contextMenus: { message: collectionContextMenu.message },
    renderMessageAccessory({ message }: Record<string, any>) {
        if (message?.author?.id !== UserStore.getCurrentUser()?.id) return null;
        return React.createElement("span", { className: "ep-plus-own-marker", "aria-hidden": true });
    },
    shouldShowDesktopNotification: notificationAllowed,
    flux: {
        ENHANCED_PRESENCE_PLUS_FEATURES_CHANGED: syncAccountFeatures,
        ENHANCED_PRESENCE_PLUS_RULES_CHANGED: async () => {
            const accountId = UserStore.getCurrentUser()?.id;
            if (!accountId) return;
            const generation = featureGeneration;
            try {
                const rules = validateNotificationRules(await DataStore.get<unknown>(notificationRulesKey(accountId)) ?? []);
                if (active && generation === featureGeneration && UserStore.getCurrentUser()?.id === accountId) activeNotificationRules = rules;
            } catch {
                if (active && generation === featureGeneration && UserStore.getCurrentUser()?.id === accountId) activeNotificationRules = [];
            }
        },
        VOICE_STATE_UPDATES: () => { void voiceModule.refresh(); },
        AUDIO_TOGGLE_SELF_MUTE: () => { void voiceModule.refresh(); },
        AUDIO_TOGGLE_SELF_DEAF: () => { void voiceModule.refresh(); }
    },
    async start() {
        active = true; enableStyle(suiteStyle); client.start(); notificationRouter.start(); void loadPairing();
        accountListener = () => { void syncAccountFeatures(); };
        UserStore.addChangeListener(accountListener);
        pairingTimer = setInterval(() => void loadPairing(), 15000);
        await syncAccountFeatures();
    },
    async stop() {
        active = false; activeAccountId = null; featureGeneration++;
        clearInterval(pairingTimer); pairingTimer = undefined;
        if (accountListener) UserStore.removeChangeListener(accountListener);
        accountListener = undefined; localPairing = null; client.stop();
        notificationRouter.stop(); activeNotificationRules = []; setPlusGroups([]);
        await voiceModule.stop(); setPlusVoice(null);
        disableStyle(suiteStyle);
        await Native?.setLocalPlayer(false).catch(() => {});
    }
});
