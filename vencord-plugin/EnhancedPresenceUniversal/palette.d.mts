export type AlbumPalette = { accent: string; foreground: string };
export const DEFAULT_PALETTE: Readonly<AlbumPalette>;
export function contrastRatio(background: string, foreground: string): number;
export function extractAccent(rgba: Uint8Array | Uint8ClampedArray | null): AlbumPalette;
