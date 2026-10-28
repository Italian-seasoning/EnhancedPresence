// Native settings artwork stays local; callers can request only curated bundle IDs.
import { join, resolve, sep } from 'node:path';
import { profiles, blocked } from './profiles.mjs';

const names = {
  'com.apple.Music': 'Music', 'com.apple.finder': 'Finder', 'com.google.Chrome': 'Google Chrome',
  'com.apple.MobileSMS': 'Messages', 'com.apple.mail': 'Mail', 'com.apple.Photos': 'Photos',
  'com.apple.Passwords': 'Passwords', 'com.apple.FaceTime': 'FaceTime', 'com.hnc.Discord': 'Discord',
  'com.hnc.DiscordCanary': 'Discord Canary', 'com.hnc.DiscordPTB': 'Discord PTB', 'dev.vencord.Vesktop': 'Vesktop',
  'com.agilebits.onepassword7': '1Password 7', 'com.1password.1password': '1Password',
  'com.bitwarden.desktop': 'Bitwarden', 'org.keepassxc.keepassxc': 'KeePassXC'
};
export function createInstalledIconLookup({ roots, exists, findBundle, getFileIcon }) {
  const cache = new Map();
  const safePath = path => typeof path === 'string' && path.length < 4096 && path === resolve(path) && path.endsWith('.app') && roots.some(root => path.startsWith(root + sep));
  return async id => {
    if (typeof id !== 'string' || !/^[\w.-]{1,200}$/.test(id) || (!Object.hasOwn(profiles, id) && !blocked.has(id))) return undefined;
    if (!cache.has(id)) cache.set(id, (async () => {
      const name = names[id] || profiles[id]?.[0];
      const direct = name ? roots.map(root => join(root, `${name}.app`)).find(exists) : undefined;
      const path = direct || (await findBundle(id)).slice(0, 8).find(safePath);
      if (!path || !safePath(path)) return undefined;
      const data = await getFileIcon(path);
      return typeof data === 'string' && data.length <= 262144 && /^data:image\/png;base64,[A-Za-z0-9+/=]+$/.test(data) ? data : undefined;
    })().catch(() => undefined));
    return cache.get(id);
  };
}
