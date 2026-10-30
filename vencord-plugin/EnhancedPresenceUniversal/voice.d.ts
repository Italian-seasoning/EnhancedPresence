import type { VoiceCommand, VoiceSnapshot } from "./voice-state.mjs";

interface VoiceNative {
    writeVoiceState(snapshot: VoiceSnapshot | null): Promise<unknown>;
    takeVoiceHUDCommand(channelId: string): Promise<unknown>;
}

interface VoiceModuleOptions {
    enabled(): boolean;
    readSnapshot(): unknown;
    setSelfMute(value: boolean): void;
    setSelfDeaf(value: boolean): void;
    native?: VoiceNative;
    onChange?(snapshot: VoiceSnapshot | null): void;
    now?(): number;
    every?(callback: () => void, milliseconds: number): ReturnType<typeof setInterval>;
    cancel?(timer: ReturnType<typeof setInterval>): void;
}

export declare function createVoiceModule(options: VoiceModuleOptions): {
    readonly snapshot: VoiceSnapshot | null;
    start(): Promise<void>;
    stop(): Promise<void>;
    refresh(): Promise<VoiceSnapshot | null>;
};
export type { VoiceCommand, VoiceSnapshot } from "./voice-state.mjs";
