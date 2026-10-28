export interface AppControl {
    id: string; name: string; details: string;
    visibility: "allowed" | "hidden" | "blocked";
    protected: boolean; editable: boolean; custom: boolean;
    defaultName: string; defaultDetails: string;
    supportsName: boolean; supportsContext: boolean; showName: boolean; showContext: boolean;
}
export interface MusicSettings { enabled: boolean; sources: "com.apple.Music"[]; priority: "music" | "app"; }
export interface AppUsage { todaySeconds: number; totalSeconds: number; sessionSeconds: number; }
export interface RuntimeStatus {
    pending: { appId: string; appName: string; since: number; dueAt: number; } | null;
    music: { available: boolean; source?: string; error?: string; };
    updatedAt: number; stale: boolean; usage: Record<string, AppUsage>; usageError?: string;
}
export interface Controls { enabled: boolean; idleSeconds: number; namesAvailable: boolean; switchDelaySeconds: number; trackingEnabled: boolean; music: MusicSettings; usage: Record<string, AppUsage>; usageError?: string; apps: AppControl[]; }
export interface BehaviorUpdate { enabled?: boolean; switchDelaySeconds?: number; trackingEnabled?: boolean; music?: Partial<MusicSettings>; }
export interface AppUpdate { id: string; visibility: AppControl["visibility"]; name?: string; details?: string; reset?: boolean; showName?: boolean; showContext?: boolean; }
export function readControls(root: string): Controls;
export function updateApp(root: string, input: AppUpdate): Controls;
export function updateIdle(root: string, seconds: number): Controls;
export function updateBehavior(root: string, input: BehaviorUpdate): Controls;
export function readRuntimeStatus(root: string, now?: number): RuntimeStatus;
