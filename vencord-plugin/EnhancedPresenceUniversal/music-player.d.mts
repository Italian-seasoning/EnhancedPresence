export type MusicAction = 'play' | 'pause' | 'previous' | 'next';
export type LocalMusicArtworkRequest = { appId: 'com.apple.Music'; title: string; artist: string; album: string };

export type MusicPlayback = {
  version: 1;
  appId: 'com.apple.Music';
  title: string;
  artist: string;
  album: string;
  artworkUrl?: string;
  playing: boolean;
  playbackRate: number;
  durationSeconds?: number;
  elapsedSeconds: number;
  updatedAt: number;
};

export function readLocalPlayback(root: string, now?: number): MusicPlayback | null;
export function isLocalPlayerEnabled(root: string): boolean;
export function setLocalPlayerEnabled(root: string, enabled: boolean): { enabled: boolean };
export function controlMusic(root: string, action: MusicAction): Promise<void>;
export function readLocalMusicArtwork(root: string, input: LocalMusicArtworkRequest): Promise<string | null>;
