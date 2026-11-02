export interface MusicArtworkRequest {
  appId: 'com.apple.Music';
  title: string;
  artist: string;
  album: string;
}

export interface MusicImages {
  albumArtworkUrl: string;
  artistArtworkUrl?: string;
}

export function createMusicImagesLookup(options?: {
  fetchImpl?: typeof fetch;
  now?: () => number;
  /** Two-letter store country; anything else searches the US store. */
  country?: string;
}): (input: unknown) => Promise<MusicImages | null>;
