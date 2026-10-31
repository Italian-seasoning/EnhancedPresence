import type { ChatBackground } from "./chat-backgrounds.mjs";
export function prepareBackgroundPhoto(file: File): Promise<Extract<ChatBackground, { kind: "photo" }>>;
