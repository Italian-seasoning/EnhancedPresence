// Public, fixed artwork only. App metadata cannot choose an arbitrary URL.
import { profiles } from './profiles.mjs';
const dashboard = 'https://cdn.jsdelivr.net/gh/homarr-labs/dashboard-icons@104a791794ef68b31bfecac676ddace8c223fd27/png/';
const selfhosted = 'https://cdn.jsdelivr.net/gh/selfhst/icons@2053b70b283ffed5f2cc1424d1e17d9c554a846d/png/';
const icons = Object.fromEntries(Object.entries({
  paper: 'paper', atlas: 'chatgpt', blender: 'blender', vscode: 'visual-studio-code', safari: 'safari', chrome: 'chrome',
  terminal: 'terminal', codex: 'codex', indesign: 'adobe-indesign', figma: 'figma',
  godot: 'godot', unity: 'unity', handbrake: 'handbrake', upscayl: 'upscayl',
  notion: 'notion', obsidian: 'obsidian', anytype: 'anytype', zotero: 'zotero',
  intellij: 'intellij', firefox: 'firefox', edge: 'edge', claude: 'claude-ai',
  chatgpt: 'chatgpt', ollama: 'ollama', ghostty: 'ghostty', comet: 'perplexity',
  spotify: 'spotify', 'apple-music': 'apple-music'
}).map(([key, file]) => [key, `${dashboard}${file}.png`]));
Object.assign(icons, Object.fromEntries(Object.entries({
  roblox: 'roblox', 'roblox-studio': 'roblox', photoshop: 'adobe-photoshop',
  lightroom: 'adobe-lightroom', illustrator: 'adobe-illustrator', 'premiere-pro': 'adobe-premiere-pro', antigravity: 'google-antigravity'
}).map(([key, file]) => [key, `${selfhosted}${file}.png`])));
Object.assign(icons, {
  codex: 'https://raw.githubusercontent.com/backnotprop/orchestrator/583acf4b469b91131f96ae2136797749c788b4c7/assets/providers/codex-icon-dark.png',
  finder: 'https://upload.wikimedia.org/wikipedia/commons/b/b9/Finder_Icon_macOS_Tahoe.png',
  cavalry: 'https://cavalry.studio/apple-touch-icon-precomposed.png',
  siril: 'https://siril.org/apple-touch-icon.png',
  'vroid-studio': 'https://is1-ssl.mzstatic.com/image/thumb/Purple221/v4/12/5d/11/125d111c-0b1b-e717-df60-20ac95276bc3/AppIcon-0-0-1x_U007emarketing-0-6-0-85-220.png/512x512bb.jpg',
  capturely: 'https://raw.githubusercontent.com/Italian-seasoning/Capturely/1653d2d0b3abe1ca3542213093b12d4a1703890c/Assets/AppIcon.iconset/icon_512x512.png',
  parakeet: 'https://raw.githubusercontent.com/Italian-seasoning/ParakeetTranscriber/fd8514aa6a4e00d5809d5a681611aa8559b8500c/Resources/AppIcon.png',
  vlc: 'https://is1-ssl.mzstatic.com/image/thumb/Purple221/v4/22/5a/7c/225a7c89-472a-8fa7-fe11-ed6aaa8a5c21/AppIcon-1x_U007emarketing-0-0-0-7-0-0-85-220.png/512x512bb.jpg',
  'after-effects': 'https://icons.iconarchive.com/icons/simpleicons-team/simple/128/adobe-after-effects-icon.png',
  textedit: 'https://ipcdn-web.apple.com/assets/v2/web/deff8244-5b75-4d83-a5f1-3071b9841315',
  'davinci-resolve': 'https://is1-ssl.mzstatic.com/image/thumb/Purple211/v4/9e/d6/45/9ed6457a-79a7-f2ee-1bbd-b172a3ae2151/Resolve.png/512x512bb.png',
  'final-cut-pro': 'https://is1-ssl.mzstatic.com/image/thumb/Purple221/v4/ce/35/ba/ce35ba64-0d95-921f-3d11-ff503cd73f1d/AppIcon-0-85-220-0-6-0-0-2x-sRGB-0-0.png/512x512bb.png',
  motion: 'https://is1-ssl.mzstatic.com/image/thumb/Purple211/v4/6f/b2/f4/6fb2f489-a06f-aec7-99fd-154a92c68f37/AppIcon-0-85-220-0-6-0-0-2x-P3-0-0.png/512x512bb.png',
  compressor: 'https://is1-ssl.mzstatic.com/image/thumb/Purple211/v4/fa/10/68/fa106822-d60c-9841-bb2d-0ced2a1612f7/AppIcon-0-85-220-0-6-0-0-2x-sRGB-0-0.png/512x512bb.png',
  xcode: 'https://is1-ssl.mzstatic.com/image/thumb/Purple211/v4/e0/4c/e9/e04ce9a1-ad15-881d-d02d-598fe624bd94/Xcode-0-85-220-0-6-0-0-2x-P3-0-0.png/512x512bb.png',
  'logic-pro': 'https://is1-ssl.mzstatic.com/image/thumb/Purple221/v4/ab/ad/6f/abad6fff-cdec-45d3-5eae-4c443b1da652/AppIcon-0-85-220-0-6-0-0-2x-0-0-0-0-0.png/512x512bb.png',
  notes: 'https://upload.wikimedia.org/wikipedia/commons/1/18/Notes_%28iOS_26%29_app_icon.png',
  'pixelmator-pro': 'https://is1-ssl.mzstatic.com/image/thumb/Purple211/v4/a1/e9/19/a1e91908-afba-6b30-d789-b03300253ab2/AppIcon-0-0-85-220-0-0-5-0-2x-0-0-0.png/512x512bb.png',
  pages: 'https://is1-ssl.mzstatic.com/image/thumb/Purple211/v4/e4/d1/99/e4d19916-72b3-3559-72da-d4c43d26c525/AppIcon-0-0-1x_U007epad-0-0-0-1-0-0-P3-0-0-85-220-0.png/512x512bb.jpg',
  numbers: 'https://is1-ssl.mzstatic.com/image/thumb/Purple211/v4/ca/f2/53/caf253e3-c61a-7606-b270-e263cac05534/AppIcon-0-0-1x_U007epad-0-0-0-1-0-0-P3-0-0-85-220-0.png/512x512bb.jpg',
  keynote: 'https://is1-ssl.mzstatic.com/image/thumb/Purple221/v4/86/eb/64/86eb64db-d97c-f697-92fb-60b30b9b3d9d/AppIcon-0-0-1x_U007epad-0-0-0-1-0-0-P3-0-0-85-220-0.png/512x512bb.jpg',
  cursor: 'https://cursor.com/apple-touch-icon.png',
  obs: 'https://obsproject.com/assets/images/new_icon_small-r.png',
  pycharm: 'https://resources.jetbrains.com/storage/products/pycharm/img/meta/pycharm_logo_300x300.png',
  webstorm: 'https://resources.jetbrains.com/storage/products/webstorm/img/meta/webstorm_logo_300x300.png',
  iterm: 'https://iterm2.com/img/logo2x.jpg',
  arc: 'https://arc.net/favicon.png'
});
export function appIcon(id) {
  return Object.hasOwn(profiles, id) ? icons[profiles[id][2]] : undefined;
}
export function validMusicArtwork(value) {
  if (typeof value !== 'string' || value.length > 2048) return false;
  try {
    const url = new URL(value);
    return url.protocol === 'https:' && !url.username && !url.password && !url.port && !url.hash &&
      (/^is\d+-ssl\.mzstatic\.com$/.test(url.hostname) || ['i.scdn.co', 'image-cdn-ak.spotifycdn.com'].includes(url.hostname));
  } catch { return false; }
}
