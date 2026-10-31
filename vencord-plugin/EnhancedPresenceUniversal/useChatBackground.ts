/* Licensed under GPL-3.0-or-later. */
import * as DataStore from "@api/DataStore";
import { ChannelStore, React, SelectedChannelStore, UserStore, useStateFromStores } from "@webpack/common";
import { backgroundCss, backgroundKey, emptyBackgrounds, setBackground, validateBackgrounds } from "./chat-backgrounds.mjs";
import type { ChatBackground, ChatBackgrounds } from "./chat-backgrounds.mjs";

export function useChatBackground(accountId: string) {
    const channelId = useStateFromStores([SelectedChannelStore, ChannelStore], () => {
        const id = SelectedChannelStore.getChannelId();
        const channel = ChannelStore.getChannel(id);
        return channel && [1, 3].includes(channel.type) ? id : null;
    });
    const [state, setState] = React.useState<ChatBackgrounds | null>(null);
    const [error, setError] = React.useState("");
    React.useEffect(() => {
        let alive = true;
        setState(null); setError("");
        if (!accountId) return;
        void DataStore.get<unknown>(backgroundKey(accountId)).then(raw => {
            const value = raw === undefined ? emptyBackgrounds(accountId) : validateBackgrounds(raw, accountId);
            if (alive && UserStore.getCurrentUser()?.id === accountId) setState(value);
        }).catch(() => {
            if (alive && UserStore.getCurrentUser()?.id === accountId) setError("Saved backgrounds could not be read. Existing data was left unchanged.");
        });
        return () => { alive = false; };
    }, [accountId]);
    const background = state?.accountId === accountId && channelId ? state.chats[channelId] : undefined;
    React.useLayoutEffect(() => {
        const root = document.documentElement;
        root.toggleAttribute("data-ep-direct-message", Boolean(channelId && ChannelStore.getChannel(channelId)?.type === 1 && UserStore.getCurrentUser()?.id === accountId));
        const css = backgroundCss(background);
        if (css && UserStore.getCurrentUser()?.id === accountId) {
            root.style.setProperty("--ep-dm-wallpaper", css);
            root.setAttribute("data-ep-dm-wallpaper", "true");
        } else {
            root.style.removeProperty("--ep-dm-wallpaper");
            root.removeAttribute("data-ep-dm-wallpaper");
        }
        return () => { root.style.removeProperty("--ep-dm-wallpaper"); root.removeAttribute("data-ep-dm-wallpaper"); root.removeAttribute("data-ep-direct-message"); };
    }, [accountId, channelId, background]);
    const save = async (next: ChatBackground | null) => {
        if (!state || state.accountId !== accountId || !channelId || UserStore.getCurrentUser()?.id !== accountId
            || SelectedChannelStore.getChannelId() !== channelId) throw Error("The current account or DM changed. Choose the background again.");
        let saved: ChatBackgrounds | null = null;
        await DataStore.update<ChatBackgrounds>(backgroundKey(accountId), previous => {
            saved = setBackground(previous === undefined ? emptyBackgrounds(accountId) : validateBackgrounds(previous, accountId), channelId, next);
            return saved;
        });
        if (UserStore.getCurrentUser()?.id === accountId) { setState(saved); setError(""); }
    };
    return { channelId, background, error, save };
}
