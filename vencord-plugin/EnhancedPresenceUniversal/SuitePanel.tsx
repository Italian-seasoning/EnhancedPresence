/* Licensed under GPL-3.0-or-later. */
import { ChannelRouter, ChannelStore, FocusLock, React, UserStore } from "@webpack/common";
import { extractAccent } from "./palette.mjs";
import type { AlbumPalette } from "./palette.mjs";
import { playbackPosition } from "./music-timing.mjs";
import { searchSavedMessages } from "./collections.mjs";
import type { Collections, SavedMessage, Workspace } from "./collections.mjs";
import type { FeatureSettings } from "./suite-state.mjs";
import type { MusicPlayback } from "./music-player.mjs";
import type { NotificationRule, GroupedNotification } from "./notification-rules.mjs";
import type { VoiceSnapshot } from "./voice-state.mjs";
import type { PluginNative } from "@utils/types";
import { copyWithToast } from "@utils/discord";

type Native = PluginNative<typeof import("./native")> | undefined;
export type SuiteTab = "music" | "shelf" | "workspaces" | "notifications" | "voice" | "appearance";

type Props = {
    accountId: string;
    native: Native;
    tab: SuiteTab;
    setTab(tab: SuiteTab): void;
    onClose(): void;
    collections: Collections | null;
    features: FeatureSettings;
    onFeatureChange(key: keyof FeatureSettings, enabled: boolean): Promise<void>;
    onCreateWorkspace(name: string): Promise<void>;
    onAddCurrentChannel(workspaceId: string): Promise<void>;
    onDeleteSavedMessage(message: SavedMessage): Promise<void>;
    onDeleteWorkspace(id: string): Promise<void>;
    onEditSavedMessage(message: SavedMessage, patch: Partial<Pick<SavedMessage, "note" | "label" | "tags">>): Promise<void>;
    onJumpTo(message: SavedMessage): void;
    onImport(file: File): Promise<void>;
    onExport(): void;
    notificationRules: NotificationRule[];
    notificationGroups: GroupedNotification[];
    onNotificationRulesChange(rules: NotificationRule[]): void;
    voice: VoiceSnapshot | null;
    onSetMute(value: boolean): void;
    onSetDeafen(value: boolean): void;
    onError(message: string): void;
    error: string;
    onDismissError(): void;
};

const tabFeature: Partial<Record<SuiteTab, keyof FeatureSettings>> = {
    music: "musicPlayer", shelf: "messageShelf", workspaces: "workspaces",
    notifications: "notifications", voice: "voice"
};

const tabs: Array<[SuiteTab, string]> = [
    ["music", "Music"], ["shelf", "Shelf"], ["workspaces", "Workspaces"],
    ["notifications", "Notifications"], ["voice", "Voice"], ["appearance", "Appearance"]
];

const durationLabel = (seconds: number) => {
    const value = Math.max(0, Math.floor(seconds));
    return `${Math.floor(value / 60)}:${String(value % 60).padStart(2, "0")}`;
};

function MusicPanel({ native, enabled, onError }: { native: Native; enabled: boolean; onError(message: string): void; }) {
    const [playback, setPlayback] = React.useState<MusicPlayback | null>(null);
    const [cover, setCover] = React.useState<string | undefined>();
    const [palette, setPalette] = React.useState<AlbumPalette | undefined>();
    const [position, setPosition] = React.useState(0);
    const [pending, setPending] = React.useState("");
    React.useEffect(() => {
        if (!enabled || !native?.readLocalPlayback) { setPlayback(null); return; }
        let alive = true;
        let reading = false;
        const refresh = async () => {
            if (reading || document.visibilityState !== "visible") return;
            reading = true;
            try {
                const value = await native.readLocalPlayback();
                if (alive) setPlayback(value);
            } catch { if (alive) setPlayback(null); }
            finally { reading = false; }
        };
        void refresh();
        const timer = setInterval(() => void refresh(), 1200);
        return () => { alive = false; clearInterval(timer); };
    }, [enabled, native]);

    const identity = playback ? `${playback.appId}\0${playback.title}\0${playback.artist}\0${playback.album}` : "";
    React.useEffect(() => {
        let alive = true;
        setCover(undefined);
        setPalette(undefined);
        if (!playback?.album || !playback.artist || !native?.getLocalMusicArtwork) return;
        void native.getLocalMusicArtwork({ appId: "com.apple.Music", title: playback.title, artist: playback.artist, album: playback.album })
            .then(async url => {
                if (!alive || !url) return;
                setCover(url);
                const image = new Image(); image.src = url;
                await image.decode().catch(() => {});
                if (!alive || image.naturalWidth < 1) return;
                const canvas = document.createElement("canvas"); canvas.width = 16; canvas.height = 16;
                const context = canvas.getContext("2d", { willReadFrequently: true });
                if (!context) return;
                context.drawImage(image, 0, 0, 16, 16);
                setPalette(extractAccent(context.getImageData(0, 0, 16, 16).data));
            }).catch(() => {});
        return () => { alive = false; };
    }, [identity, native]);

    React.useEffect(() => {
        const refreshPosition = () => setPosition(playbackPosition(playback));
        refreshPosition();
        if (!playback?.playing) return;
        const timer = setInterval(refreshPosition, 1000);
        return () => clearInterval(timer);
    }, [playback]);

    const act = async (action: "play" | "pause" | "previous" | "next") => {
        if (!native?.controlMusic) { onError("Music controls need the Mac companion."); return; }
        setPending(action);
        try { await native.controlMusic(action); }
        catch { onError("Couldn’t control Apple Music. Check that it is the current player, then try again."); }
        finally { setPending(""); }
    };

    if (!enabled) return <section className="ep-plus-empty"><h2>Music is off</h2><p>Turn on the local Apple Music player in Appearance to use playback controls.</p></section>;
    const available = playback?.appId === "com.apple.Music" && Date.now() - playback.updatedAt < 90_000;
    const progress = playback?.durationSeconds ? Math.min(100, position / playback.durationSeconds * 100) : 0;
    return <section className="ep-plus-music">
        <div className="ep-plus-player" style={{ "--ep-album-accent": palette?.accent, "--ep-album-accent-foreground": palette?.foreground } as React.CSSProperties}>
            <div className="ep-plus-cover">{cover ? <img src={cover} alt={`${playback?.album || "Album"} cover`} /> : <span aria-hidden="true">♫</span>}</div>
            <div className="ep-plus-track">
                <p className="ep-plus-kicker">APPLE MUSIC</p>
                <h2 title={playback?.title}>{playback?.title || "Nothing playing"}</h2>
                <p className="ep-plus-track-meta">{playback ? [playback.artist, playback.album].filter(Boolean).join(" · ") : "Play a track to see your album and artist"}</p>
                <div className="ep-plus-progress" role="progressbar" aria-label="Track progress" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(progress)}><span style={{ width: `${progress}%` }} /></div>
                <div className="ep-plus-times"><span>{durationLabel(position)}</span><span>{playback?.durationSeconds ? durationLabel(playback.durationSeconds) : "–:––"}</span></div>
                <div className="ep-plus-controls" aria-label="Apple Music controls">
                    <button disabled={!available || !!pending} aria-label="Previous track" onClick={() => void act("previous")}>‹‹</button>
                    <button className="ep-plus-play" disabled={!available || !!pending} aria-label={playback?.playing ? "Pause" : "Play"} onClick={() => void act(playback?.playing ? "pause" : "play")}>{playback?.playing ? "Ⅱ" : "▶"}</button>
                    <button disabled={!available || !!pending} aria-label="Next track" onClick={() => void act("next")}>››</button>
                </div>
                {playback && <button className="ep-plus-link" onClick={() => copyWithToast(`Listening to ${playback.title}${playback.artist ? ` by ${playback.artist}` : ""}${playback.album ? ` on ${playback.album}` : ""}`, "Track text copied")}>Copy track text</button>}
            </div>
        </div>
        <p className="ep-plus-hint">Playback stays on this Mac. Sharing your song on Discord is controlled separately in Enhanced Presence settings.</p>
    </section>;
}

function ShelfPanel({ data, onDelete, onEdit, onJump, onError }: {
    data: Collections | null;
    onDelete(message: SavedMessage): Promise<void>;
    onEdit(message: SavedMessage, patch: Partial<Pick<SavedMessage, "note" | "label" | "tags">>): Promise<void>;
    onJump(message: SavedMessage): void;
    onError(message: string): void;
}) {
    const [query, setQuery] = React.useState("");
    const messages = data ? searchSavedMessages(data, query) : [];
    return <section className="ep-plus-section">
        <div className="ep-plus-section-head"><div><h2>Your shelf</h2><p>Messages you chose to keep, saved on this device.</p></div><span className="ep-plus-count">{data?.savedMessages.length ?? 0}</span></div>
        <label className="ep-plus-label">Search saved notes and tags<input className="ep-plus-input" maxLength={256} value={query} onChange={event => setQuery(event.currentTarget.value)} placeholder="Search your shelf" /></label>
        <div className="ep-plus-list">
            {messages.map(message => <article className="ep-plus-item" key={`${message.channelId}:${message.messageId}`}>
                <div className="ep-plus-item-head"><strong>{message.label || "Saved message"}</strong><button className="ep-plus-link" onClick={() => onJump(message)}>Open message</button></div>
                <label className="ep-plus-label">Note<textarea className="ep-plus-input ep-plus-note" maxLength={2000} defaultValue={message.note || ""} onBlur={event => {
                    const value = event.currentTarget.value;
                    if (value !== (message.note || "")) void onEdit(message, { note: value }).catch(error => onError(error instanceof Error ? error.message : "Couldn’t update that note."));
                }} /></label>
                <label className="ep-plus-label">Tags<input className="ep-plus-input" defaultValue={message.tags.join(", ")} placeholder="comma separated" onBlur={event => {
                    const tags = event.currentTarget.value.split(",").map(value => value.trim()).filter(Boolean);
                    if (JSON.stringify(tags) !== JSON.stringify(message.tags)) void onEdit(message, { tags }).catch(error => onError(error instanceof Error ? error.message : "Couldn’t update those tags."));
                }} /></label>
                <button className="ep-plus-muted-button" onClick={() => void onDelete(message).catch(error => onError(error instanceof Error ? error.message : "Couldn’t remove that message."))}>Remove from shelf</button>
            </article>)}
            {!messages.length && <p className="ep-plus-empty">{data?.savedMessages.length ? "No saved messages match that search." : "Right-click a message and choose Save to Presence+ shelf."}</p>}
        </div>
    </section>;
}

function WorkspacesPanel({ data, onCreate, onAddCurrent, onDelete, onError }: {
    data: Collections | null;
    onCreate(name: string): Promise<void>;
    onAddCurrent(id: string): Promise<void>;
    onDelete(id: string): Promise<void>;
    onError(message: string): void;
}) {
    const [name, setName] = React.useState("");
    const [busy, setBusy] = React.useState(false);
    const create = async () => {
        if (!name.trim() || busy) return;
        setBusy(true);
        try { await onCreate(name); setName(""); }
        catch (error) { onError(error instanceof Error ? error.message : "Couldn’t create a workspace."); }
        finally { setBusy(false); }
    };
    return <section className="ep-plus-section">
        <div className="ep-plus-section-head"><div><h2>Workspaces</h2><p>Save channel shortcuts for the way you use Discord.</p></div></div>
        <div className="ep-plus-create"><label className="ep-plus-label">New workspace<input className="ep-plus-input" maxLength={64} value={name} onChange={event => setName(event.currentTarget.value)} placeholder="Game night, projects…" /></label><button className="ep-plus-primary" disabled={busy || !name.trim()} onClick={() => void create()}>Create from open channel</button></div>
        <div className="ep-plus-list">
            {data?.workspaces.map(workspace => <article className="ep-plus-item" key={workspace.id}>
                <div className="ep-plus-item-head"><strong>{workspace.name}</strong><button className="ep-plus-link" onClick={() => void onAddCurrent(workspace.id).catch(error => onError(error instanceof Error ? error.message : "Couldn’t add this channel."))}>Add open channel</button></div>
                <div className="ep-plus-shortcuts">{workspace.channels.map(channel => <button key={channel.channelId} className="ep-plus-shortcut" onClick={() => {
                    if (!ChannelStore.getChannel(channel.channelId)) { onError("This channel is unavailable to your account."); return; }
                    ChannelRouter.transitionToChannel(channel.channelId);
                }}># {channel.label || ChannelStore.getChannel(channel.channelId)?.name || "Unavailable channel"}</button>)}</div>
                <button className="ep-plus-muted-button" onClick={() => void onDelete(workspace.id)}>Remove workspace</button>
            </article>)}
            {!data?.workspaces.length && <p className="ep-plus-empty">Create a workspace from the channel you have open.</p>}
        </div>
    </section>;
}

function NotificationsPanel({ enabled, rules, groups, onChange, onError }: {
    enabled: boolean;
    rules: NotificationRule[];
    groups: GroupedNotification[];
    onChange(rules: NotificationRule[]): void;
    onError(message: string): void;
}) {
    const [personId, setPersonId] = React.useState("");
    const [channelId, setChannelId] = React.useState("");
    const [keyword, setKeyword] = React.useState("");
    const add = (action: "mute" | "group") => {
        if (!personId.trim() && !channelId.trim() && !keyword.trim()) { onError("Add a person ID, channel ID or keyword so this rule matches something specific."); return; }
        onChange([...rules, { id: crypto.randomUUID(), enabled: true, action, ...(personId.trim() ? { personId: personId.trim() } : {}), ...(channelId.trim() ? { channelId: channelId.trim() } : {}), ...(keyword.trim() ? { keyword: keyword.trim() } : {}) }]);
        setPersonId(""); setChannelId(""); setKeyword("");
    };
    return <section className="ep-plus-section">
        <div className="ep-plus-section-head"><div><h2>Notification rules</h2><p>Rules affect this desktop notification only. Unmatched messages stay unchanged.</p></div></div>
        {!enabled && <p className="ep-plus-empty">Notifications are off. Enable them in Appearance to apply rules.</p>}
        <div className="ep-plus-rule-form">
            <label className="ep-plus-label">Person ID, optional<input className="ep-plus-input" value={personId} onChange={event => setPersonId(event.currentTarget.value)} placeholder="Copy a user ID from Discord" /></label>
            <label className="ep-plus-label">Channel ID, optional<input className="ep-plus-input" value={channelId} onChange={event => setChannelId(event.currentTarget.value)} placeholder="Copy a channel ID" /></label>
            <label className="ep-plus-label">Keyword, optional<input className="ep-plus-input" maxLength={80} value={keyword} onChange={event => setKeyword(event.currentTarget.value)} placeholder="literal words" /></label>
            <div className="ep-plus-actions"><button className="ep-plus-primary" disabled={!enabled} onClick={() => add("group")}>Group matches</button><button className="ep-plus-secondary" disabled={!enabled} onClick={() => add("mute")}>Mute matching desktop alerts</button></div>
        </div>
        <div className="ep-plus-list">
            {rules.map(rule => <article className="ep-plus-item ep-plus-rule" key={rule.id}>
                <strong>{rule.action === "mute" ? "Mute desktop alert" : "Group desktop alert"}</strong>
                <p>{[rule.personId ? `Person ${rule.personId}` : "", rule.channelId ? `Channel ${rule.channelId}` : "", rule.keyword ? `Contains “${rule.keyword}”` : ""].filter(Boolean).join(" · ")}</p>
                <button className="ep-plus-muted-button" onClick={() => onChange(rules.filter(value => value.id !== rule.id))}>Remove rule</button>
            </article>)}
            {!rules.length && <p className="ep-plus-empty">No notification rules yet. Add a person or keyword rule above.</p>}
        </div>
        <div className="ep-plus-list"><h3>Grouped alerts</h3>
            {groups.map((group, index) => <div className="ep-plus-grouped" key={`${group.ruleId}:${group.channelId}:${group.authorId}:${index}`}><strong>{group.authorName}</strong><span>{group.count} notifications in #{group.channelName}</span><button className="ep-plus-link" onClick={() => {
                if (ChannelStore.getChannel(group.channelId)) ChannelRouter.transitionToChannel(group.channelId);
                else onError("That channel is no longer available.");
            }}>Open channel</button></div>)}
            {!groups.length && <p className="ep-plus-empty">Grouped alerts you receive during this session appear here.</p>}
        </div>
    </section>;
}

function VoicePanel({ enabled, voice, onError, onSetMute, onSetDeafen }: { enabled: boolean; voice: VoiceSnapshot | null; onError(message: string): void; onSetMute(value: boolean): void; onSetDeafen(value: boolean): void; }) {
    return <section className="ep-plus-section">
        <div className="ep-plus-section-head"><div><h2>Voice</h2><p>See the current call state without recording call audio.</p></div></div>
        <p className="ep-plus-hint">Open the companion’s menu-bar item and choose “Show Voice HUD” to float this call information over other apps.</p>
        {!enabled && <p className="ep-plus-empty">Voice tools are off in Appearance.</p>}
        {voice ? <article className="ep-plus-item ep-plus-voice">
            <div className="ep-plus-item-head"><strong>{voice.channelName}</strong><span className="ep-plus-live">In voice</span></div>
            <div className="ep-plus-actions"><button className="ep-plus-secondary" onClick={() => onSetMute(!voice.selfMute)}>{voice.selfMute ? "Unmute" : "Mute"}</button><button className="ep-plus-secondary" onClick={() => onSetDeafen(!voice.selfDeaf)}>{voice.selfDeaf ? "Undeafen" : "Deafen"}</button></div>
            <ul>{voice.speakers.map(person => <li key={person.id} aria-current={person.speaking}>{person.name}{person.speaking ? " · Speaking" : ""}</li>)}</ul>
        </article> : <p className="ep-plus-empty">Join a voice channel to see speakers and call controls.</p>}
    </section>;
}

function AppearancePanel({ features, onChange }: { features: FeatureSettings; onChange(key: keyof FeatureSettings, enabled: boolean): Promise<void>; }) {
    const rows: Array<[keyof FeatureSettings, string, string]> = [
        ["musicPlayer", "Apple Music player", "Local artwork, track info and controls"],
        ["messageShelf", "Message shelf", "Right-click a message to save it locally"],
        ["workspaces", "Channel workspaces", "Save channel shortcut groups"],
        ["notifications", "Desktop notification rules", "Group or mute only messages matching your rules"],
        ["voice", "Voice tools", "Show speakers and call controls; enable the native Mac panel"]
    ];
    return <section className="ep-plus-section"><div className="ep-plus-section-head"><div><h2>Appearance and features</h2><p>Each switch controls its feature independently for this Discord account.</p></div></div>
        <div className="ep-plus-switches">{rows.map(([key, title, description]) => <label className="ep-plus-toggle" key={key}><span><strong>{title}</strong><small>{description}</small></span><input type="checkbox" checked={features[key]} onChange={event => void onChange(key, event.currentTarget.checked)} /></label>)}</div>
        <p className="ep-plus-hint">Messages for Discord is a separate optional theme in Vencord → Themes. Enable it by itself when you want the Messages look. Presence+ never changes your selected themes.</p>
    </section>;
}

export function SuitePanel(props: Props) {
    const panelRef = React.useRef<HTMLElement>(null);
    const [importing, setImporting] = React.useState(false);
    const [groups, setGroups] = React.useState(props.notificationGroups);
    const shown = props.collections?.accountId === props.accountId;

    React.useEffect(() => {
        const onKey = (event: KeyboardEvent) => { if (event.key === "Escape") props.onClose(); };
        document.addEventListener("keydown", onKey);
        return () => document.removeEventListener("keydown", onKey);
    }, [props.onClose]);

    React.useEffect(() => {
        const sync = () => setGroups(props.notificationGroups);
        const timer = setInterval(sync, 1500);
        return () => clearInterval(timer);
    }, [props.notificationGroups]);

    const onImportFile = async (event: React.ChangeEvent<HTMLInputElement>) => {
        const file = event.currentTarget.files?.[0];
        event.currentTarget.value = "";
        if (!file) return;
        if (!shown || UserStore.getCurrentUser()?.id !== props.accountId) { props.onError("Wait for this Discord account’s local data to load before importing."); return; }
        if (props.collections?.savedMessages.length || props.collections?.workspaces.length) {
            if (!window.confirm("Replace this account’s local shelf and workspaces with the selected export?")) return;
        }
        setImporting(true);
        try { await props.onImport(file); props.onError("Shelf and workspaces imported."); }
        catch (error) { props.onError(error instanceof Error ? error.message : "Import failed; your saved data is unchanged."); }
        finally { setImporting(false); }
    };

    const activeMessages = shown ? searchSavedMessages(props.collections!, "") : [];
    const panel = <FocusLock containerRef={panelRef}><div className="ep-plus-backdrop" onMouseDown={event => { if (event.target === event.currentTarget) props.onClose(); }}>
        <section ref={panelRef} tabIndex={-1} className="ep-plus-panel" role="dialog" aria-modal="true" aria-label="Enhanced Presence Plus" onMouseDown={event => event.stopPropagation()}>
            <header className="ep-plus-header"><div><span className="ep-plus-symbol">P+</span><span><strong>Enhanced Presence+</strong><small>Local tools for Discord</small></span></div><button className="ep-plus-close" aria-label="Close Presence+" onClick={props.onClose}>×</button></header>
            <nav className="ep-plus-tabs" aria-label="Presence+ features">{tabs.map(([key, label]) => <button key={key} className={props.tab === key ? "ep-plus-tab ep-plus-tab-active" : "ep-plus-tab"} aria-current={props.tab === key ? "page" : undefined} disabled={!!tabFeature[key] && !props.features[tabFeature[key]!]} onClick={() => props.setTab(key)}>{label}</button>)}</nav>
            {props.error && <div className="ep-plus-notice" role="status"><span>{props.error}</span><button aria-label="Dismiss notice" onClick={props.onDismissError}>×</button></div>}
            <main className="ep-plus-content" key={`${props.accountId}:${props.tab}`}>
                {!shown ? <p className="ep-plus-empty">Loading this Discord account’s local collection…</p> : <>
                    {props.tab === "music" && <MusicPanel native={props.native} enabled={props.features.musicPlayer} onError={props.onError} />}
                    {props.tab === "shelf" && (props.features.messageShelf ? <ShelfPanel data={props.collections} onDelete={props.onDeleteSavedMessage} onEdit={props.onEditSavedMessage} onJump={props.onJumpTo} onError={props.onError} /> : <p className="ep-plus-empty">Turn on the message shelf in Appearance to access your saved messages.</p>)}
                    {props.tab === "workspaces" && (props.features.workspaces ? <WorkspacesPanel data={props.collections} onCreate={props.onCreateWorkspace} onAddCurrent={props.onAddCurrentChannel} onDelete={props.onDeleteWorkspace} onError={props.onError} /> : <p className="ep-plus-empty">Turn on workspaces in Appearance to access your saved channels.</p>)}
                    {props.tab === "notifications" && <NotificationsPanel enabled={props.features.notifications} rules={props.notificationRules} groups={groups} onChange={props.onNotificationRulesChange} onError={props.onError} />}
                    {props.tab === "voice" && <VoicePanel enabled={props.features.voice} voice={props.voice} onError={props.onError} onSetMute={props.onSetMute} onSetDeafen={props.onSetDeafen} />}
                    {props.tab === "appearance" && <><AppearancePanel features={props.features} onChange={props.onFeatureChange} /><div className="ep-plus-section ep-plus-transfer"><h3>Local collections</h3><p>{activeMessages.length} saved messages · {props.collections?.workspaces.length ?? 0} workspaces</p><div className="ep-plus-actions"><button className="ep-plus-secondary" disabled={!shown || importing} onClick={props.onExport}>Export</button><label className="ep-plus-secondary ep-plus-file">{importing ? "Importing…" : "Import"}<input type="file" accept="application/json,.json" disabled={!shown || importing} onChange={event => void onImportFile(event)} /></label></div></div></>}
                </>}
            </main>
            <footer className="ep-plus-footer"><span>{props.accountId ? "Saved locally for this Discord account" : "Sign in to use local collections"}</span><button className="ep-plus-link" disabled={!shown || importing} onClick={props.onExport}>Export data</button></footer>
        </section>
    </div></FocusLock>;
    return panel;
}
