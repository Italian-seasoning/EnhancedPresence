export interface VoiceSpeaker {
  id: string;
  name: string;
  speaking: boolean;
}

export interface VoiceSnapshot {
  version: 1;
  updatedAt: number;
  channelId: string;
  channelName: string;
  selfMute: boolean;
  selfDeaf: boolean;
  speakers: VoiceSpeaker[];
}

export interface VoiceCommand {
  version: 1;
  id: string;
  createdAt: number;
  channelId: string;
  action: 'mute' | 'deafen';
  value: boolean;
}

export function normalizeVoiceSnapshot(value: unknown, now?: number): VoiceSnapshot | null;
export function normalizeVoiceCommand(value: unknown, now?: number): VoiceCommand | null;
export function voiceCommandIsCurrent(value: unknown, channelId: string | null, now?: number): boolean;
