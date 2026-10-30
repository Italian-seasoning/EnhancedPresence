import type { MusicArtworkRequest } from './music-artwork.mjs';

export function createClient(options: {
  getSettings: () => { applicationId: string; bridgeToken: string; paused: boolean; appIcons?: boolean };
  dispatch: (activity: unknown) => void;
  socketFactory: (url: string) => WebSocket;
  resolveAsset?: (applicationId: string, key: string) => Promise<string | undefined>;
  lookupMusicArtwork?: (request: MusicArtworkRequest) => Promise<string | null>;
  shouldPublishMusic?: (activity: unknown) => boolean;
  status?: (value: string) => void;
}): { start(): void; stop(): void; refresh(): void };
