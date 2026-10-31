/* Licensed under GPL-3.0-or-later. */
import { ChatBarButton } from "@api/ChatButtons";
import ErrorBoundary from "@components/ErrorBoundary";
import { Menu, Popout, React, ReactDOM, SelectedChannelStore, UserStore, useStateFromStores } from "@webpack/common";
import { activateComposerAction, bindComposerActions, composerActionPresentation } from "./composer-actions.mjs";
import type { ComposerAction, ComposerContext } from "./composer-actions.mjs";

const paths: Record<string, string> = {
    attachment: "m21 11-8.7 8.7a5 5 0 0 1-7.1-7.1L14 4.5a3 3 0 0 1 4.2 4.2l-8.8 8.8a1 1 0 0 1-1.4-1.4L16 8",
    keyboard: "M4 6h16v12H4zM7 10h1m3 0h1m3 0h1M7 14h10M3 3l18 18",
    translate: "M3 5h12M9 3v2M6 5c0 6 4 9 8 10M12 5c0 5-4 9-9 10m10 5 4-10 4 10m-7-3h6",
    presence: "M2 12h5l3-8 4 16 3-8h5",
    gift: "M3 9h18v4H3zM5 13v8h14v-8M12 9v12M12 9H8a3 3 0 1 1 3-3l1 3h4a3 3 0 1 0-3-3l-1 3",
    gif: "M3 5h18v14H3zM10 9l5 3-5 3z",
    sticker: "M5 3h14a2 2 0 0 1 2 2v10l-6 6H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2Zm10 18v-6h6",
    emoji: "M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0ZM8 9h.01M16 9h.01M8 14c1 4 7 4 8 0",
    apps: "M3 3h7v7H3zM14 3h7v7h-7zM3 14h7v7H3zM14 14h7v7h-7z"
};

export const ComposerMenu = ErrorBoundary.wrap(function ComposerMenu({ channelId }: { channelId: string }) {
    const anchor = React.useRef<HTMLSpanElement>(null);
    const icon = React.useRef<SVGSVGElement>(null);
    const trigger = React.useRef<HTMLDivElement>(null);
    const binding = React.useRef<ReturnType<typeof bindComposerActions> | null>(null);
    const [host, setHost] = React.useState<HTMLElement | null>(null);
    const [menu, setMenu] = React.useState<{ root: HTMLElement; actions: ComposerAction[]; expected: ComposerContext } | null>(null);
    const accountId = useStateFromStores([UserStore], () => UserStore.getCurrentUser()?.id);
    React.useLayoutEffect(() => {
        setMenu(null);
        const root = anchor.current?.closest<HTMLElement>('[class*="channelTextArea_"]');
        const target = root?.querySelector<HTMLElement>('[class*="attachWrapper_"]') ?? null;
        if (host !== target) { setHost(target); return; }
        const button = icon.current?.closest<HTMLDivElement>('[role="button"]');
        trigger.current = button ?? null;
        if (!root) return;
        const actions = button && root.contains(button) ? bindComposerActions(root, button) : null;
        if (actions) button?.setAttribute("data-ep-composer-toggle", "");
        binding.current = actions;
        const observer = new MutationObserver(() => {
            const nextHost = root.querySelector<HTMLElement>('[class*="attachWrapper_"]');
            if (nextHost !== host) setHost(nextHost);
            else actions?.refresh();
        });
        observer.observe(root, { childList: true, subtree: true, attributes: true, attributeFilter: ["aria-label", "aria-disabled", "disabled"] });
        return () => {
            observer.disconnect(); actions?.dispose(); button?.removeAttribute("data-ep-composer-toggle"); binding.current = null;
        };
    }, [accountId, channelId, host]);
    const close = () => { setMenu(null); trigger.current?.focus(); };
    const open = (event: React.MouseEvent) => {
        event.preventDefault(); event.stopPropagation();
        if (menu) { setMenu(null); return; }
        const button = trigger.current;
        const root = anchor.current?.closest<HTMLElement>('[class*="channelTextArea_"]');
        if (!button || !root || !root.contains(button) || !binding.current || !accountId || UserStore.getCurrentUser()?.id !== accountId
            || SelectedChannelStore.getChannelId() !== channelId) return;
        setMenu({ root, actions: binding.current.refresh(), expected: { accountId, channelId } });
    };
    return <><span ref={anchor} hidden />{host && ReactDOM.createPortal(<Popout
        position="top"
        align="left"
        animation={Popout.Animation.NONE}
        shouldShow={Boolean(menu)}
        onRequestClose={() => setMenu(null)}
        targetElementRef={trigger}
        renderPopout={({ closePopout }) => menu && (
            <Menu.Menu navId="ep-composer-actions" aria-label="Message actions" onClose={() => { closePopout(); close(); }}>
                {menu.actions.map((action, index) => {
                    const display = composerActionPresentation(action);
                    return (
                    <Menu.MenuItem
                        id={`ep-composer-action-${index}`}
                        key={index}
                        label={<span className="ep-plus-composer-label">
                            <span className="ep-plus-composer-icon" style={{ color: display.color }} aria-hidden="true">
                                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round"><path d={paths[display.icon]} /></svg>
                            </span>
                            <span>{display.label}</span>
                        </span>}
                        disabled={action.button.getAttribute("aria-disabled") === "true" || Boolean(action.button.disabled)}
                        action={() => {
                            closePopout(); close();
                            activateComposerAction(action, menu.root, menu.expected, {
                                accountId: UserStore.getCurrentUser()?.id,
                                channelId: SelectedChannelStore.getChannelId()
                            });
                        }}
                    />
                    );
                })}
            </Menu.Menu>
        )}
    >
        {() => <ChatBarButton
            tooltip={menu ? "" : "Message actions"}
            onClick={open}
            buttonProps={{ "aria-label": "Message actions", "aria-haspopup": "menu", "aria-expanded": Boolean(menu) }}
        >
            <svg ref={icon} width="22" height="22" viewBox="0 0 24 24" aria-hidden="true"><path fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" d="M12 4v16M4 12h16" /></svg>
        </ChatBarButton>}
    </Popout>, host)}</>;
}, { noop: true });
