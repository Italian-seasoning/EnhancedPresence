/* Licensed under GPL-3.0-or-later. */
import { ApplicationAssetUtils } from "@webpack/common";
const cache = new Map<string, Promise<string | undefined>>();
export function resolveArtwork(id: string, key: string): Promise<string | undefined> {
    const cacheKey = `${id}:${key}`;
    if (!cache.has(cacheKey)) {
        const request = ApplicationAssetUtils.fetchAssetIds(id, [key]).then(ids => ids[0] as string | undefined).catch(() => undefined);
        cache.set(cacheKey, request);
        void request.then(value => { if (!value) setTimeout(() => cache.delete(cacheKey), 30000); });
    }
    return cache.get(cacheKey)!;
}
export async function previewArtwork(id: string, url: string) {
    const asset = await resolveArtwork(id, url);
    return asset ? ApplicationAssetUtils.getAssetImage(id, asset, 256) as string : undefined;
}
