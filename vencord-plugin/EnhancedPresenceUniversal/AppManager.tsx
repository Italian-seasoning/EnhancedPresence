/* Licensed under GPL-3.0-or-later. */
import { React, useEffect, useState } from "@webpack/common";
import type { AppControl, BehaviorUpdate, Controls, RuntimeStatus } from "./controls.mjs";
import type { PluginNative } from "@utils/types";
import "./manager.css";
import { appIcon } from "./icons.mjs";
import { previewArtwork } from "./artwork";

type Props = {
    native: PluginNative<typeof import("./native")> | undefined;
    getStatus(): { connection: string; app: string; details: string; paused: boolean; appIcons: boolean; applicationId: string; sharingEnabled: boolean; visible: boolean; };
    setPaused(value: boolean): Promise<Controls>;
    setAppIcons(value: boolean): void;
    enableSharing(): void;
};
function AppIcon({ id, name, applicationId, native }: { id: string; name: string; applicationId: string; native: Props["native"]; }) {
    const [failed, setFailed] = useState(false);
    const url = appIcon(id);
    const [source, setSource] = useState<string | undefined>();
    useEffect(() => {
        let alive = true;
        setSource(undefined); setFailed(false);
        void (async () => {
            let local: string | undefined;
            try { local = await native?.getInstalledAppIcon(id); } catch { /* Public artwork remains available. */ }
            const fallback = !local && url?.includes("mzstatic.com") ? await previewArtwork(applicationId, url) : url;
            if (alive) setSource(local || fallback);
        })().catch(() => {});
        return () => { alive = false; };
    }, [id, url, applicationId, native]);
    return source && !failed ? <img className="ep-icon" src={source} alt="" title={source.startsWith("data:") ? "Installed app icon" : "Public app artwork"} loading="lazy" onError={() => setFailed(true)} /> : <span className="ep-icon ep-initial" title="Icon unavailable" aria-hidden>{name.slice(0, 1)}</span>;
}
const timeLabel = (seconds: number) => seconds < 60 ? `${Math.floor(seconds)}s` : seconds < 3600 ? `${Math.floor(seconds / 60)}m` : `${Math.floor(seconds / 3600)}h ${Math.floor(seconds % 3600 / 60)}m`;
export function AppManager({ native, getStatus, setPaused, setAppIcons, enableSharing }: Props) {
    const [data, setData] = useState<Controls | null>(null);
    const [status, setStatus] = useState(getStatus);
    const [query, setQuery] = useState("");
    const [filter, setFilter] = useState("all");
    const [selected, setSelected] = useState("com.blackmagic-design.DaVinciResolve");
    const [name, setName] = useState("");
    const [details, setDetails] = useState("");
    const [busy, setBusy] = useState(false);
    const [notice, setNotice] = useState("");
    const [error, setError] = useState("");
    const [runtime, setRuntime] = useState<RuntimeStatus | null>(null);
    const [runtimeError, setRuntimeError] = useState("");
    useEffect(() => {
        let alive = true, reading = false;
        if (native?.getAppControls) native.getAppControls().then(value => { if (alive) setData(value); }).catch(() => { if (alive) setError("App settings are unavailable. Make sure the EnhancedPresence companion is installed."); });
        else setError("App controls need the desktop version of Discord.");
        async function refreshRuntime() {
            if (!alive || reading || document.visibilityState !== "visible") return;
            setStatus(getStatus());
            if (!native?.getRuntimeStatus) return;
            reading = true;
            try { const value = await native.getRuntimeStatus(); if (alive) { setRuntime(value); setRuntimeError(""); } }
            catch { if (alive) setRuntimeError("Companion status is unavailable. Check that EnhancedPresence is running."); }
            finally { reading = false; }
        }
        void refreshRuntime();
        const timer = setInterval(() => void refreshRuntime(), 15000);
        return () => { alive = false; clearInterval(timer); };
    }, []);
    const app = data?.apps.find(item => item.id === selected);
    useEffect(() => { if (app) { setName(app.name); setDetails(app.details); } }, [app?.id, app?.name, app?.details]);
    async function save(visibility: AppControl["visibility"], reset = false, text = false) {
        if (!native || !app || busy) return;
        setBusy(true); setError(""); setNotice("");
        try {
            setData(await native.saveAppControl({ id: app.id, visibility, reset, ...(text ? { name: name.trim(), details: details.trim() } : {}) }));
            setNotice(text ? "Public text saved." : reset ? "Default text restored." : "App visibility saved.");
        } catch { setError("Couldn’t save. Use 2–128 characters for each public text field and try again."); }
        finally { setBusy(false); }
    }
    async function saveDisclosure(key: "showName" | "showContext", value: boolean) {
        if (!native || !app || busy) return;
        setBusy(true); setError(""); setNotice("");
        try {
            setData(await native.saveAppControl({ id: app.id, visibility: app.visibility, [key]: value }));
            setNotice(value ? key === "showName" ? "Names will appear only for this app." : "Workspace details enabled for this app." : "Sharing option turned off.");
        } catch { setError("Couldn’t save this sharing option. Try again."); }
        finally { setBusy(false); }
    }
    async function saveBehavior(input: BehaviorUpdate) {
        if (!native || busy) return;
        setBusy(true); setError(""); setNotice("");
        try { setData(await native.saveBehavior(input)); setNotice("Settings saved."); }
        catch { setError("Couldn’t save these settings. Check that the companion is installed and try again."); }
        finally { setBusy(false); }
    }
    async function pause() {
        if (busy) return;
        setBusy(true); setError(""); setNotice("");
        try { setData(await setPaused(!status.paused)); setStatus(getStatus()); setNotice(status.paused ? "Sharing resumed." : "Sharing and app tracking paused."); }
        catch { setError("Couldn’t update the companion. Sharing settings were not changed."); }
        finally { setBusy(false); }
    }
    async function saveAgent(change: Partial<Controls["agent"]>) {
        if (!native || !data || busy) return;
        setBusy(true); setError(""); setNotice("");
        try { setData(await native.saveAgentSettings({ ...data.agent, ...change })); setNotice("Task status settings saved."); }
        catch { setError("Couldn’t save task status settings. Try again."); }
        finally { setBusy(false); }
    }
    const visible = data?.apps.filter(item => (filter === "all" || item.visibility === filter) && `${item.name} ${item.details}`.toLowerCase().includes(query.toLowerCase())) || [];
    const headline = status.paused ? "Activity paused" : !status.sharingEnabled ? "Discord activity sharing is off" : status.app ? `${status.visible ? "Sharing" : "Detected"} ${status.app}` : status.connection === "Connected" ? "Ready when you are" : "Connecting to your companion";
    return <section className="ep-manager" aria-label="EnhancedPresence app manager">
        <div className="ep-live">
            <div><span className={`ep-dot ${status.paused ? "ep-paused" : ""}`} /><strong>{headline}</strong><p>{status.paused ? "Your activity is hidden." : status.app ? status.details : "Only allowed apps appear on your profile."}</p></div>
            <button className="ep-button" disabled={busy || !native} onClick={() => void pause()}>{status.paused ? "Resume" : "Pause"}</button>
        </div>
        {!status.sharingEnabled && <div className="ep-live"><p>Turn on Discord activity sharing so others can see your presence.</p><button className="ep-button ep-primary" onClick={() => { enableSharing(); setStatus(getStatus()); }}>Enable activity sharing</button></div>}
        {runtime?.pending && !runtime.stale && !status.paused && <p className="ep-hint" role="status">Switching to {runtime.pending.appName} in about {Math.max(0, Math.ceil((runtime.pending.dueAt - Date.now()) / 1000))} seconds if it stays active.</p>}
        {data && <div className="ep-editor" aria-label="Presence behavior">
            <h3>Presence behavior</h3>
            <label className="ep-idle">Wait before switching apps<select value={data.switchDelaySeconds} disabled={busy} onChange={event => void saveBehavior({ switchDelaySeconds: Number(event.target.value) })}>{![0, 15, 30, 60, 120, 300].includes(data.switchDelaySeconds) && <option value={data.switchDelaySeconds}>{data.switchDelaySeconds} seconds</option>}{[0, 15, 30, 60, 120, 300].map(seconds => <option key={seconds} value={seconds}>{seconds ? `${seconds} seconds` : "Switch immediately"}</option>)}</select></label>
            <label className="ep-idle">Track app time locally<input type="checkbox" disabled={busy} checked={data.trackingEnabled} onChange={event => void saveBehavior({ trackingEnabled: event.target.checked })} /></label>
            <p className="ep-hint">Counts actual foreground use of allowed apps. Pausing sharing, idle time, sleep and private apps do not add time. Totals stay on this Mac.</p>
            <label className="ep-idle">Share Apple Music<input type="checkbox" disabled={busy} checked={data.music.enabled && data.music.sources.includes("com.apple.Music")} onChange={event => void saveBehavior({ music: { enabled: event.target.checked, sources: ["com.apple.Music"] } })} /></label>
            {data.music.enabled && <>
                <label className="ep-idle">When Apple Music is playing<select value={data.music.priority} disabled={busy} onChange={event => void saveBehavior({ music: { priority: event.target.value as "music" | "app" } })}><option value="music">Prefer Apple Music</option><option value="app">Prefer the active app</option></select></label>
                <p className="ep-hint">Apple Music must also be allowed in Your apps. With icons enabled, song, artist and album names are sent to Apple to find public album covers and artist portraits. Prefer Apple Music keeps a playing track visible in the background while your Mac is unlocked.</p>
                <p className="ep-hint">{runtime?.stale ? "Apple Music status is out of date. Check that the companion is running." : runtime?.music.available ? "Apple Music provider ready." : runtime?.music.error || "Waiting for Apple Music…"}</p>
            </>}
        </div>}
        <div className="ep-heading"><h3>Your apps</h3><span>{data?.apps.filter(item => item.visibility === "allowed").length ?? "–"} allowed</span></div>
        <input className="ep-input" type="search" aria-label="Search apps" placeholder="Search apps…" value={query} onChange={event => setQuery(event.target.value)} />
        <div className="ep-filters" aria-label="Filter apps">{[["all", "All"], ["allowed", "Allowed"], ["blocked", "Blocked"], ["hidden", "Hidden"]].map(([value, label]) => <button key={value} aria-pressed={filter === value} onClick={() => setFilter(value)}>{label}</button>)}</div>
        <div className="ep-apps" aria-label="Apps">{visible.map(item => <button key={item.id} disabled={busy} aria-pressed={selected === item.id} onClick={() => { setSelected(item.id); setNotice(""); setError(""); }}><span className="ep-app-name"><AppIcon id={item.id} name={item.name} applicationId={status.applicationId} native={native} />{item.name}</span><span className={`ep-badge ep-${item.visibility}`}>{item.visibility === "allowed" ? "Allowed" : item.visibility === "blocked" ? "Blocked" : "Hidden"}</span></button>)}{!visible.length && <p className="ep-empty">{data ? "No apps match. Try another search or filter." : "Loading app settings…"}</p>}</div>
        {app && <div className="ep-editor">
            <h3>{app.name}</h3>
            {app.visibility === "allowed" && <dl className="ep-usage" aria-label={`${app.name} app time`}>{[["Session", (runtime?.usage || data?.usage)?.[app.id]?.sessionSeconds || 0], ["Today", (runtime?.usage || data?.usage)?.[app.id]?.todaySeconds || 0], ["All time", (runtime?.usage || data?.usage)?.[app.id]?.totalSeconds || 0]].map(([label, seconds]) => <div key={label}><dt>{label}</dt><dd>{timeLabel(Number(seconds))}</dd></div>)}</dl>}
            <div className="ep-visibility" aria-label={`Visibility for ${app.name}`}>{[["allowed", "Allow"], ["hidden", "Hide"], ["blocked", "Block"]].map(([value, label]) => <button key={value} disabled={busy || app.protected || (!app.editable && value === "allowed")} aria-pressed={app.visibility === value} onClick={() => void save(value as AppControl["visibility"])}>{label}</button>)}</div>
            <p className="ep-hint">{app.protected ? "This app always stays private." : app.visibility === "blocked" ? "Blocked even if it is on the allowlist." : app.visibility === "hidden" ? "Hidden until you allow it." : "Visible while you use this app."}</p>
            {app.editable && !app.protected && <>
                <label className="ep-label">Public app name<input className="ep-input" maxLength={128} value={name} onChange={event => setName(event.target.value)} /></label>
                <label className="ep-label">Activity text<input className="ep-input" maxLength={128} value={details} onChange={event => setDetails(event.target.value)} /></label>
                {app.supportsName && <>
                    <label className="ep-idle">Show {app.id === "com.apple.TextEdit" ? "document" : "project"} name<input type="checkbox" disabled={busy} checked={app.showName} onChange={event => void saveDisclosure("showName", event.target.checked)} /></label>
                    <p className="ep-hint">{app.showName ? "The current name will be visible to people who can see your Discord activity." : "Names stay private. Only the app and activity text are shared."}</p>
                    {app.showName && app.id !== "com.blackmagic-design.DaVinciResolve" && !data?.namesAvailable && <div className="ep-live"><div><strong>Allow names in macOS</strong><p>Optional names need Accessibility for EnhancedPresence Helper. Never grant it to Node or Terminal. Until then, generic activity still works. Document contents are never read.</p></div><button className="ep-button" onClick={() => void native?.openNamePermissions()}>Open Accessibility settings</button><button className="ep-button" onClick={() => void native?.getAppControls().then(setData)}>Check access</button></div>}
                </>}
                {app.supportsContext && <><label className="ep-idle">Show current page and render status<input type="checkbox" disabled={busy} checked={app.showContext} onChange={event => void saveDisclosure("showContext", event.target.checked)} /></label><p className="ep-hint">Uses Resolve’s local scripting connection when available. If unavailable, your normal activity text appears.</p></>}
                <div className="ep-preview"><span>Profile preview</span><div className="ep-preview-content">{status.appIcons && <AppIcon key={app.id} id={app.id} name={name} applicationId={status.applicationId} native={native} />}<div><strong>{name || "App name"}</strong><p>{app.showName ? `${app.showContext ? "Color grading" : "Editing"} “${app.id === "com.apple.TextEdit" ? "Document name" : "Project name"}”${app.id !== "com.blackmagic-design.DaVinciResolve" ? ` in ${name}` : ""}` : app.showContext ? "Color grading" : details || "Activity text"}</p>{app.showContext && <p>Color page</p>}</div></div>{(app.showName || app.showContext) && <p className="ep-hint">Example shown. Actual names and workspace appear when available.</p>}</div>
                <div className="ep-actions"><button className="ep-button ep-primary" disabled={busy || name.trim().length < 2 || details.trim().length < 2 || (name === app.name && details === app.details)} onClick={() => void save(app.visibility, false, true)}>Save text</button><button className="ep-button" disabled={busy || !app.custom || !app.defaultName} onClick={() => void save(app.visibility, true)}>Restore default</button></div>
            </>}
        </div>}
        {data && <div className="ep-editor">
            <h3>Task status wording</h3>
            <label className="ep-idle">AI wording (uses your Claude or ChatGPT subscription)<select value={data.agent.provider} disabled={busy} onChange={event => void saveAgent({ provider: event.target.value as Controls["agent"]["provider"] })}>{[["off", "Off (fixed phrases, no usage)"], ["haiku", "Claude Haiku"], ["luna", "Codex Luna"]].map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
            {data.agent.provider !== "off" && <label className="ep-idle">Refresh at most every<select value={data.agent.intervalMinutes} disabled={busy} onChange={event => void saveAgent({ intervalMinutes: Number(event.target.value) })}>{[15, 30, 60, 120].map(minutes => <option key={minutes} value={minutes}>{minutes} minutes</option>)}</select></label>}
            <label className="ep-idle">Show project folder name<input type="checkbox" disabled={busy} checked={data.agent.showProject} onChange={event => void saveAgent({ showProject: event.target.checked })} /></label>
            <p className="ep-hint">The model only sees tool categories, the app name and minutes elapsed, never prompts, paths or the project name.</p>
        </div>}
        <label className="ep-idle">Show app icons<input type="checkbox" checked={status.appIcons} onChange={event => { setAppIcons(event.target.checked); setStatus(getStatus()); }} /></label>
        <p className="ep-hint">Settings use installed app icons when available. Discord uses cached public artwork{app?.editable && !appIcon(app.id) ? `; remote artwork is unavailable for ${app.name}` : ""}. Local icons are never uploaded.</p>
        {data && <label className="ep-idle">Hide activity after no input<select value={data.idleSeconds} disabled={busy} onChange={async event => {
            const seconds = Number(event.target.value); setBusy(true); setError("");
            try { setData(await native!.saveIdleDuration(seconds)); setNotice("Idle timeout saved."); } catch { setError("Couldn’t save the idle timeout. Try again."); } finally { setBusy(false); }
        }}>{![300, 600, 900, 1800].includes(data.idleSeconds) && <option value={data.idleSeconds}>{data.idleSeconds / 60} minutes</option>}{[5, 10, 15, 30].map(minutes => <option key={minutes} value={minutes * 60}>{minutes} minutes</option>)}</select></label>}
        <p className="ep-hint">Unknown apps stay hidden. Password managers, messages and other private apps are always blocked. Names stay private unless you turn them on for a supported app. Document contents and file paths are never shared.</p>
        <p role="status" className="ep-notice">{notice}</p>{(runtime?.usageError || data?.usageError) && <p role="alert" className="ep-error">{runtime?.usageError || data?.usageError}</p>}{runtimeError && <p role="alert" className="ep-error">{runtimeError}</p>}{error && <p role="alert" className="ep-error">{error}</p>}
    </section>;
}
