export type ComposerAction = { button: HTMLElement & { disabled?: boolean }; label: string };
export type ComposerContext = { accountId: string | undefined; channelId: string | undefined };
export function bindComposerActions(root: HTMLElement, trigger: HTMLElement): { refresh(): ComposerAction[]; dispose(): void };
export function activateComposerAction(action: ComposerAction, root: HTMLElement, expected: ComposerContext, current: ComposerContext): boolean;
export function composerActionPresentation(action: ComposerAction): { label: string; icon: string; color: string };
