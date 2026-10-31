/* Licensed under GPL-3.0-or-later. */
import { React } from "@webpack/common";
import { BACKGROUND_PRESETS, backgroundCss } from "./chat-backgrounds.mjs";
import type { ChatBackground } from "./chat-backgrounds.mjs";
import { prepareBackgroundPhoto } from "./photo-background.mjs";

export function ChatBackgroundPanel({ channelId, background, onChange, onError }: {
    channelId: string | null;
    background?: ChatBackground;
    onChange(value: ChatBackground | null): Promise<void>;
    onError(message: string): void;
}) {
    const input = React.useRef<HTMLInputElement>(null);
    const [busy, setBusy] = React.useState(false);
    const save = async (value: ChatBackground | null) => {
        setBusy(true);
        try { await onChange(value); }
        catch (error) { onError(error instanceof Error ? error.message : "Couldn’t save this background."); }
        finally { setBusy(false); }
    };
    const choosePhoto = async (event: React.ChangeEvent<HTMLInputElement>) => {
        const file = event.currentTarget.files?.[0]; event.currentTarget.value = "";
        if (!file) return;
        setBusy(true);
        try { await onChange(await prepareBackgroundPhoto(file)); }
        catch (error) { onError(error instanceof Error ? error.message : "Couldn’t read this photo."); }
        finally { setBusy(false); }
    };
    return <section className="ep-plus-section ep-plus-backgrounds">
        <div><h3>This DM’s background</h3><p className="ep-plus-hint">Saved on this Mac for this chat and account. Visible only with Messages for Discord enabled.</p></div>
        {channelId ? <>
            <div className="ep-plus-wallpaper-preview" style={{ backgroundImage: backgroundCss(background) }} aria-label="Current chat background preview"><span>Message preview</span></div>
            <div className="ep-plus-background-presets" role="group" aria-label="Chat background presets">
                {Object.entries(BACKGROUND_PRESETS).map(([id, preset]) => <button className="ep-plus-secondary" key={id} disabled={busy} aria-pressed={background?.kind === "preset" && background.id === id} onClick={() => void save({ kind: "preset", id: id as Extract<ChatBackground, { kind: "preset" }>["id"] })}><span style={{ backgroundImage: preset.css }} aria-hidden="true" />{preset.name}</button>)}
            </div>
            <div className="ep-plus-actions"><button className="ep-plus-secondary" disabled={busy} onClick={() => input.current?.click()}>{busy ? "Saving…" : "Choose photo…"}</button><button className="ep-plus-muted-button" disabled={busy || !background} onClick={() => void save(null)}>Reset background</button></div>
            <input ref={input} type="file" accept="image/png,image/jpeg,image/webp" hidden onChange={event => void choosePhoto(event)} />
            <p className="ep-plus-hint">Photos are resized and stripped of metadata. No photo, file path or chat ID is sent through activity sharing.</p>
        </> : <p className="ep-plus-empty">Open a direct or group message to choose its background.</p>}
    </section>;
}
