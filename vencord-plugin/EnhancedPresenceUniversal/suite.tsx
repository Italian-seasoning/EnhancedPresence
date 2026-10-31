/* Licensed under GPL-3.0-or-later. */
import * as DataStore from "@api/DataStore";
import { findByPropsLazy } from "@webpack";
import { findGroupChildrenByChildId } from "@api/ContextMenu";
import { Menu } from "@webpack/common";
import { ChannelRouter, ChannelStore, FluxDispatcher, MediaEngineStore, MessageActions, SelectedChannelStore, UserStore } from "@webpack/common";
import type { Message } from "@vencord/discord-types";
import { React, ReactDOM } from "@webpack/common";
import { validateNotificationRules } from "./notification-rules.mjs";
import type { GroupedNotification, NotificationRule } from "./notification-rules.mjs";
import type { VoiceSnapshot } from "./voice-state.mjs";

import {
    emptyCollections,
    parseCollections,
    removeSavedMessage,
    removeWorkspace,
    saveMessage,
    saveWorkspace,
    searchSavedMessages,
    serializeCollections,
    updateSavedMessage,
    validateCollections
} from "./collections.mjs";
import type { Collections, SaveMessageInput, SavedMessage, Workspace } from "./collections.mjs";
import type { FeatureSettings } from "./suite-state.mjs";
import { collectionsKey, featureSettings, featuresKey, notificationRulesKey } from "./suite-state.mjs";
import type { PluginNative } from "@utils/types";
import { SuitePanel } from "./SuitePanel";
import { useChatBackground } from "./useChatBackground";

type Native = PluginNative<typeof import("./native")> | undefined;
type Tab = "music" | "shelf" | "workspaces" | "notifications" | "voice" | "appearance";
type OpenRequest = { tab: Tab };
const VoiceActions: { toggleSelfMute(): void; toggleSelfDeaf(): void } = findByPropsLazy("toggleSelfMute", "toggleSelfDeaf");

const openListeners = new Set<(request: OpenRequest) => void>();
const stateListeners = new Set<() => void>();
let plusGroups: GroupedNotification[] = [];
let plusVoice: VoiceSnapshot | null = null;
let plusRules: NotificationRule[] = [];
let plusFeatures = featureSettings({ musicPlayer: false, messageShelf: false, workspaces: false, notifications: false, voice: false });

export function openPlus(tab: Tab = "music") {
    for (const listener of openListeners) listener({ tab });
}

export function setPlusGroups(groups: GroupedNotification[]) {
    plusGroups = groups;
    for (const listener of stateListeners) listener();
}

export function setPlusVoice(snapshot: VoiceSnapshot | null) {
    plusVoice = snapshot;
    for (const listener of stateListeners) listener();
}

export function setPlusFeatures(features: FeatureSettings) {
    plusFeatures = featureSettings(features);
    for (const listener of stateListeners) listener();
}

export function getPlusRules() { return plusRules; }

export function saveCurrentMessage(input: SaveMessageInput) {
    const accountId = UserStore.getCurrentUser()?.id;
    if (!accountId) return Promise.reject(Error("Sign in to save a message."));
    const key = collectionsKey(accountId);
    return DataStore.update<Collections>(key, previous => {
        const current = previous ? validateCollections(previous, accountId) : emptyCollections(accountId);
        return saveMessage(current, input);
    });
}

export function addChannelToWorkspace(workspaceId: string, input: Workspace["channels"][number]) {
    const accountId = UserStore.getCurrentUser()?.id;
    if (!accountId) return Promise.reject(Error("Sign in to manage workspaces."));
    const key = collectionsKey(accountId);
    return DataStore.update<Collections>(key, previous => {
        const current = previous ? validateCollections(previous, accountId) : emptyCollections(accountId);
        const workspace = current.workspaces.find(item => item.id === workspaceId);
        if (!workspace) throw Error("Workspace is no longer available.");
        return saveWorkspace(current, { ...workspace, channels: [...workspace.channels, input] });
    });
}

export const collectionContextMenu = {
    message(children: Array<React.ReactElement | null>, props: { message?: Message }) {
        if (!plusFeatures.messageShelf) return;
        const message = props?.message;
        if (!message || !/^\d{17,20}$/.test(message.id) || !/^\d{17,20}$/.test(message.channel_id)) return;
        const currentUserId = UserStore.getCurrentUser()?.id;
        if (!currentUserId) return;
        const channel = ChannelStore.getChannel(message.channel_id);
        if (!channel) return;
        const group = findGroupChildrenByChildId("devmode-copy-id", children, true) ?? children;
        group.push(
            <Menu.MenuItem
                key="ep-plus-save-message"
                id="ep-plus-save-message"
                label="Save to Presence+ shelf"
                action={() => {
                    void saveCurrentMessage({
                        channelId: message.channel_id,
                        messageId: message.id,
                        ...(channel.guild_id ? { guildId: channel.guild_id } : {}),
                        label: `${message.author?.globalName || message.author?.username || "Message"} in #${channel.name}`
                    }).then(() => reportMessageSave(true), () => reportMessageSave(false));
                }}
            />
        );
    }
};

function loadAccountData(accountId: string) {
    return Promise.all([
        DataStore.get<unknown>(collectionsKey(accountId)).then(value => value ? validateCollections(value, accountId) : emptyCollections(accountId)),
        DataStore.get<unknown>(featuresKey(accountId)).then(value => featureSettings(value)),
        DataStore.get<unknown>(notificationRulesKey(accountId)).then(value => value === undefined ? [] : validateNotificationRules(value))
    ]).then(([collections, features, rules]) => ({ collections, features, rules }));
}

async function writeCollections(accountId: string, update: (value: Collections) => Collections) {
    let result = emptyCollections(accountId);
    await DataStore.update<Collections>(collectionsKey(accountId), previous => {
        result = update(previous ? validateCollections(previous, accountId) : emptyCollections(accountId));
        return result;
    });
    return result;
}

async function writeFeatures(accountId: string, update: (value: FeatureSettings) => FeatureSettings) {
    let result = featureSettings(undefined);
    await DataStore.update<FeatureSettings>(featuresKey(accountId), previous => {
        result = update(featureSettings(previous));
        return result;
    });
    return result;
}

function navigate(channelId: string, message?: SavedMessage, onError: (message: string) => void = () => {}) {
    if (!/^\d{17,20}$/.test(channelId) || !ChannelStore.getChannel(channelId)) { onError("This channel is unavailable to your account."); return; }
    if (!message) { ChannelRouter.transitionToChannel(channelId); return; }
    let checks = 0;
    const timer = setInterval(() => {
        if (SelectedChannelStore.getChannelId() === channelId) {
            clearInterval(timer);
            MessageActions.jumpToMessage({ channelId, messageId: message.messageId, flash: true, jumpType: "INSTANT" });
        } else if (++checks >= 100) {
            clearInterval(timer);
            onError("Discord couldn’t open that saved message.");
        }
    }, 50);
    ChannelRouter.transitionToChannel(channelId);
}

export function SuiteEntry({ native }: { native: Native }) {
    const [currentAccount, setCurrentAccount] = React.useState(() => UserStore.getCurrentUser()?.id ?? "");
    const chatBackground = useChatBackground(currentAccount);
    const [shown, setShown] = React.useState(false);
    const [tab, setTab] = React.useState<Tab>("music");
    const [collections, setCollections] = React.useState<Collections | null>(null);
    const [features, setFeatures] = React.useState<FeatureSettings>(() => featureSettings(undefined));
    const [notificationRules, setNotificationRules] = React.useState<NotificationRule[]>([]);
    const [groups, setGroups] = React.useState(plusGroups);
    const [voice, setVoice] = React.useState(plusVoice);
    const [error, setError] = React.useState("");
    const requestNumber = React.useRef(0);

    React.useEffect(() => {
        const changed = () => setCurrentAccount(UserStore.getCurrentUser()?.id ?? "");
        UserStore.addChangeListener(changed);
        return () => UserStore.removeChangeListener(changed);
    }, []);

    React.useEffect(() => {
        setCollections(null);
        setNotificationRules([]);
        setFeatures(featureSettings({ musicPlayer: false, messageShelf: false, workspaces: false, notifications: false, voice: false }));
        if (!currentAccount) {
            plusRules = [];
            setPlusFeatures(featureSettings({ musicPlayer: false, messageShelf: false, workspaces: false, notifications: false, voice: false }));
            return;
        }
        const request = ++requestNumber.current;
        void loadAccountData(currentAccount).then(result => {
            if (request !== requestNumber.current) return;
            setCollections(result.collections);
            setFeatures(result.features);
            setNotificationRules(result.rules);
            plusRules = result.rules;
            setPlusFeatures(result.features);
            for (const listener of stateListeners) listener();
            setError("");
        }).catch(() => {
            if (request !== requestNumber.current) return;
            setCollections(null);
            setNotificationRules([]);
            plusRules = [];
            setPlusFeatures(featureSettings({ musicPlayer: false, messageShelf: false, workspaces: false, notifications: false, voice: false }));
            setError("Your saved Presence+ data could not be read. Existing data was left unchanged.");
        });
        return () => { requestNumber.current++; };
    }, [currentAccount]);

    React.useEffect(() => {
        const listener = () => { setGroups(plusGroups); setVoice(plusVoice); };
        stateListeners.add(listener);
        return () => { stateListeners.delete(listener); };
    }, []);

    React.useEffect(() => {
        const listener = (request: OpenRequest) => { setTab(request.tab); setShown(true); };
        openListeners.add(listener);
        return () => { openListeners.delete(listener); };
    }, []);

    React.useEffect(() => {
        const handler = (event: Event) => {
            const detail = (event as CustomEvent<{ success?: boolean }>).detail;
            setError(detail?.success ? "Saved to your shelf." : "Couldn’t save this message. Your saved data was left unchanged.");
            const id = UserStore.getCurrentUser()?.id;
            if (detail?.success && id) void DataStore.get<unknown>(collectionsKey(id)).then(value => {
                if (UserStore.getCurrentUser()?.id === id && value) setCollections(validateCollections(value, id));
            }).catch(() => {});
        };
        document.addEventListener("ep-plus-save-result", handler);
        return () => document.removeEventListener("ep-plus-save-result", handler);
    }, []);

    const changeFeatures = async (key: keyof FeatureSettings, enabled: boolean) => {
        if (!currentAccount) return;
        const saved = await writeFeatures(currentAccount, current => ({ ...current, [key]: enabled }));
        setFeatures(saved);
        try {
            if (key === "musicPlayer") await native?.setLocalPlayer(enabled);
        } catch {
            setError("The Mac companion could not update that feature.");
        }
        FluxDispatcher.dispatch({ type: "ENHANCED_PRESENCE_PLUS_FEATURES_CHANGED" });
    };

    const changeNotificationRules = async (rules: NotificationRule[]) => {
        if (!currentAccount) return;
        try {
            const next = validateNotificationRules(rules);
            await DataStore.set(notificationRulesKey(currentAccount), next);
            plusRules = next;
            setNotificationRules(next);
            FluxDispatcher.dispatch({ type: "ENHANCED_PRESENCE_PLUS_RULES_CHANGED" });
        } catch {
            setError("That notification rule was not saved. Check its IDs and try again.");
        }
    };

    const createWorkspace = async (name: string) => {
        if (!currentAccount || !name.trim()) return;
        const channelId = SelectedChannelStore.getChannelId();
        if (!channelId) throw Error("Open a channel before adding it to a workspace.");
        const channel = ChannelStore.getChannel(channelId);
        if (!channel) throw Error("The open channel is no longer available.");
        const input: Workspace = {
            id: crypto.randomUUID(),
            name: name.trim(),
            channels: [{ channelId, ...(channel.guild_id ? { guildId: channel.guild_id } : {}), label: channel.name }]
        };
        const next = await writeCollections(currentAccount, current => saveWorkspace(current, input));
        if (UserStore.getCurrentUser()?.id === currentAccount) setCollections(next);
    };

    const addCurrentChannel = async (workspaceId: string) => {
        if (!currentAccount) return;
        const channelId = SelectedChannelStore.getChannelId();
        if (!channelId) throw Error("Open a channel before adding it to a workspace.");
        const channel = ChannelStore.getChannel(channelId);
        if (!channel) throw Error("The open channel is no longer available.");
        const item = { channelId, ...(channel.guild_id ? { guildId: channel.guild_id } : {}), label: channel.name };
        const next = await writeCollections(currentAccount, current => {
            const workspace = current.workspaces.find(value => value.id === workspaceId);
            if (!workspace) throw Error("Workspace was not found.");
            return saveWorkspace(current, { ...workspace, channels: [...workspace.channels.filter(value => value.channelId !== channelId), item] });
        });
        if (UserStore.getCurrentUser()?.id === currentAccount) setCollections(next);
    };

    const deleteSavedMessage = async (message: SavedMessage) => {
        if (!currentAccount) return;
        const next = await writeCollections(currentAccount, current => removeSavedMessage(current, message));
        if (UserStore.getCurrentUser()?.id === currentAccount) setCollections(next);
    };

    const deleteWorkspace = async (id: string) => {
        if (!currentAccount) return;
        const next = await writeCollections(currentAccount, current => removeWorkspace(current, id));
        if (UserStore.getCurrentUser()?.id === currentAccount) setCollections(next);
    };

    const editSavedMessage = async (message: SavedMessage, patch: Partial<Pick<SavedMessage, "note" | "label" | "tags">>) => {
        if (!currentAccount) return;
        const next = await writeCollections(currentAccount, current => updateSavedMessage(current, { ...message, ...patch }));
        if (UserStore.getCurrentUser()?.id === currentAccount) setCollections(next);
    };

    const importCollections = async (file: File) => {
        const accountId = currentAccount;
        if (!accountId || UserStore.getCurrentUser()?.id !== accountId) throw Error("Sign in to import a collection.");
        if (file.size > 2_000_000) throw Error("This export is too large to import.");
        const imported = parseCollections(await file.text(), accountId);
        if (UserStore.getCurrentUser()?.id !== accountId) throw Error("The Discord account changed. Select the file again to import it.");
        await DataStore.set(collectionsKey(accountId), imported);
        if (UserStore.getCurrentUser()?.id === accountId) setCollections(imported);
    };

    const exportCollections = () => {
        if (!collections || !currentAccount || UserStore.getCurrentUser()?.id !== currentAccount || collections.accountId !== currentAccount) return;
        let url: string;
        try { url = URL.createObjectURL(new Blob([serializeCollections(collections)], { type: "application/json" })); }
        catch { setError("Couldn’t export these collections. Your saved data is unchanged."); return; }
        const link = document.createElement("a");
        link.href = url;
        link.download = "presence-plus-collections.json";
        link.click();
        setTimeout(() => URL.revokeObjectURL(url), 1000);
    };

    const jumpTo = (message: SavedMessage) => navigate(message.channelId, message, setError);
    return shown ? ReactDOM.createPortal(<SuitePanel
            accountId={currentAccount}
            backgroundChannelId={chatBackground.channelId}
            background={chatBackground.background}
            backgroundError={chatBackground.error}
            onBackgroundChange={chatBackground.save}
            native={native}
            tab={tab}
            setTab={setTab}
            onClose={() => setShown(false)}
            collections={collections}
            features={features}
            notificationRules={notificationRules}
            notificationGroups={groups}
            voice={voice}
            onNotificationRulesChange={rules => { void changeNotificationRules(rules); }}
            onSetMute={value => { try { if (SelectedChannelStore.getVoiceChannelId() && MediaEngineStore.isSelfMute() !== value) VoiceActions.toggleSelfMute(); } catch { setError("Couldn’t update mute state."); } }}
            onSetDeafen={value => { try { if (SelectedChannelStore.getVoiceChannelId() && MediaEngineStore.isSelfDeaf() !== value) VoiceActions.toggleSelfDeaf(); } catch { setError("Couldn’t update deafen state."); } }}
            onFeatureChange={changeFeatures}
            onCreateWorkspace={createWorkspace}
            onAddCurrentChannel={addCurrentChannel}
            onDeleteSavedMessage={deleteSavedMessage}
            onDeleteWorkspace={deleteWorkspace}
            onEditSavedMessage={editSavedMessage}
            onJumpTo={jumpTo}
            onImport={importCollections}
            onExport={exportCollections}
            error={error}
            onDismissError={() => setError("")}
            onError={message => setError(message)}
        />, document.body) : null;
}

export function reportMessageSave(success: boolean) {
    document.dispatchEvent(new CustomEvent("ep-plus-save-result", { detail: { success } }));
}
