export interface MusicArtworkRequest {
  appId: 'com.apple.Music';
  title: string;
  artist: string;
  album: string;
}

export function createMusicArtworkLookup(options?: {
  fetchImpl?: typeof fetch;
  now?: () => number;
}): (input: unknown) => Promise<string | null>;
