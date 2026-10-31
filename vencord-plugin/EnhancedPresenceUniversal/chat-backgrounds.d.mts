export type ChatBackground = { kind: "preset"; id: "sky" | "sage" | "dusk" | "charcoal" } | { kind: "photo"; data: string };
export type ChatBackgrounds = { version: 1; accountId: string; chats: Record<string, ChatBackground> };
export const BACKGROUND_PRESETS: Readonly<Record<Extract<ChatBackground, { kind: "preset" }>["id"], { name: string; css: string }>>;
export function backgroundKey(accountId: string): string;
export function emptyBackgrounds(accountId: string): ChatBackgrounds;
export function validateBackgrounds(value: unknown, accountId: string): ChatBackgrounds;
export function setBackground(value: ChatBackgrounds, channelId: string, next: ChatBackground | null): ChatBackgrounds;
export function backgroundCss(value?: ChatBackground): string | undefined;
