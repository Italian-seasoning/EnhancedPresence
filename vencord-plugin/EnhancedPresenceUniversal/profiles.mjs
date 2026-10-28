// Public labels are curated. Document/project names require per-app opt-in.
export const profiles = {
  'com.blackmagic-design.DaVinciResolve': ['DaVinci Resolve', 'Editing video', 'davinci-resolve'],
  'com.roblox.RobloxPlayer': ['Roblox', 'Playing Roblox', 'roblox'],
  'com.Roblox.RobloxStudio': ['Roblox Studio', 'Building in Roblox Studio', 'roblox-studio'],
  'org.blenderfoundation.blender': ['Blender', 'Creating in Blender', 'blender'],
  'com.microsoft.VSCode': ['Visual Studio Code', 'Writing code', 'vscode'],
  'com.todesktop.230313mzl4w4u92': ['Cursor', 'Writing code', 'cursor'],
  'com.apple.dt.Xcode': ['Xcode', 'Developing in Xcode', 'xcode'],
  'com.apple.logic10': ['Logic Pro', 'Producing music', 'logic-pro'],
  'com.apple.Music': ['Apple Music', 'Listening to music', 'apple-music'],
  'com.spotify.client': ['Spotify', 'Listening to music', 'spotify'],
  'com.apple.Safari': ['Safari', 'Browsing the web', 'safari'],
  'com.google.Chrome': ['Google Chrome', 'Browsing the web', 'chrome'],
  'com.apple.Terminal': ['Terminal', 'Working in Terminal', 'terminal'],
  'com.apple.finder': ['Finder', 'Organizing files', 'finder'],
  'com.adobe.Photoshop': ['Adobe Photoshop', 'Editing images', 'photoshop'],
  'com.openai.codex': ['Codex', 'Working in Codex', 'codex'],
  'com.apple.FinalCut': ['Final Cut Pro', 'Editing with Final Cut Pro', 'final-cut-pro'],
  'com.apple.TextEdit': ['TextEdit', 'Editing in TextEdit', 'textedit'],
  'com.apple.motionapp': ['Motion', 'Creating motion graphics', 'motion'],
  'com.apple.Compressor': ['Compressor', 'Encoding media', 'compressor'],
  'com.pixelmatorteam.pixelmator.x': ['Pixelmator Pro', 'Editing images', 'pixelmator-pro'],
  'com.adobe.LightroomClassicCC7': ['Lightroom Classic', 'Editing photos', 'lightroom'],
  'com.adobe.lightroomCC': ['Lightroom', 'Editing photos', 'lightroom'],
  'com.adobe.illustrator': ['Adobe Illustrator', 'Creating artwork', 'illustrator'],
  'com.adobe.InDesign': ['Adobe InDesign', 'Designing layouts', 'indesign'],
  'com.adobe.AfterEffects': ['Adobe After Effects', 'Creating motion graphics', 'after-effects'],
  'com.adobe.PremierePro': ['Adobe Premiere Pro', 'Editing video', 'premiere-pro'],
  'com.figma.Desktop': ['Figma', 'Designing interfaces', 'figma'],
  'com.todesktop.2601167vjw8xe': ['Paper', 'Designing interfaces', 'paper'],
  'com.scenegroup.cavalry': ['Cavalry', 'Creating motion graphics', 'cavalry'],
  'org.godotengine.godot': ['Godot', 'Developing a game', 'godot'],
  'com.unity3d.UnityEditor5.x': ['Unity', 'Developing a game', 'unity'],
  'com.obsproject.obs-studio': ['OBS Studio', 'Working with video', 'obs'],
  'org.videolan.vlc': ['VLC', 'Watching video', 'vlc'],
  'fr.handbrake.HandBrake': ['HandBrake', 'Encoding video', 'handbrake'],
  'net.pixiv.vroid.macosx': ['VRoid Studio', 'Creating a character', 'vroid-studio'],
  'org.siril.Siril': ['Siril', 'Processing astronomy images', 'siril'],
  'org.upscayl.Upscayl': ['Upscayl', 'Enhancing images', 'upscayl'],
  'com.apple.iWork.Pages': ['Pages', 'Writing a document', 'pages'],
  'com.apple.iWork.Numbers': ['Numbers', 'Working with spreadsheets', 'numbers'],
  'com.apple.Numbers': ['Numbers', 'Working with spreadsheets', 'numbers'],
  'com.apple.iWork.Keynote': ['Keynote', 'Creating a presentation', 'keynote'],
  'notion.id': ['Notion', 'Working in Notion', 'notion'],
  'md.obsidian': ['Obsidian', 'Writing notes', 'obsidian'],
  'com.anytype.anytype': ['Anytype', 'Organizing notes', 'anytype'],
  'org.zotero.zotero': ['Zotero', 'Researching', 'zotero'],
  'com.google.antigravity': ['Antigravity', 'Writing code', 'antigravity'],
  'com.microsoft.VSCodeInsiders': ['Visual Studio Code Insiders', 'Writing code', 'vscode'],
  'com.jetbrains.intellij': ['IntelliJ IDEA', 'Writing code', 'intellij'],
  'com.jetbrains.pycharm': ['PyCharm', 'Writing code', 'pycharm'],
  'com.jetbrains.WebStorm': ['WebStorm', 'Writing code', 'webstorm'],
  'com.google.Chrome.canary': ['Chrome Canary', 'Browsing the web', 'chrome'],
  'org.mozilla.firefox': ['Firefox', 'Browsing the web', 'firefox'],
  'com.microsoft.edgemac': ['Microsoft Edge', 'Browsing the web', 'edge'],
  'company.thebrowser.Browser': ['Arc', 'Browsing the web', 'arc'],
  'ai.perplexity.comet': ['Comet', 'Browsing the web', 'comet'],
  'com.openai.atlas': ['ChatGPT Atlas', 'Browsing the web', 'atlas'],
  'com.anthropic.claudefordesktop': ['Claude', 'Working in Claude', 'claude'],
  'com.openai.chat': ['ChatGPT', 'Working in ChatGPT', 'chatgpt'],
  'com.electron.ollama': ['Ollama', 'Working with local models', 'ollama'],
  'com.googlecode.iterm2': ['iTerm2', 'Working in Terminal', 'iterm'],
  'com.mitchellh.ghostty': ['Ghostty', 'Working in Terminal', 'ghostty'],
  'com.italianseasoning.capturely': ['Capturely', 'Working in Capturely', 'capturely'],
  'com.italianseasoning.parakeet-transcriber': ['Parakeet Transcriber', 'Transcribing audio', 'parakeet']
};
export const blocked = new Set(['com.apple.MobileSMS', 'com.apple.mail', 'com.apple.Photos', 'com.apple.Passwords', 'com.apple.FaceTime', 'com.hnc.Discord', 'com.hnc.DiscordCanary', 'com.hnc.DiscordPTB', 'dev.vencord.Vesktop', 'com.agilebits.onepassword7', 'com.1password.1password', 'com.bitwarden.desktop', 'org.keepassxc.keepassxc']);
export const nameApps = new Set(['com.apple.TextEdit', 'com.apple.FinalCut', 'com.blackmagic-design.DaVinciResolve', 'com.adobe.Photoshop', 'com.adobe.lightroomCC', 'com.adobe.LightroomClassicCC7', 'com.adobe.illustrator', 'com.adobe.InDesign', 'com.adobe.AfterEffects', 'com.adobe.PremierePro']);
// Apps where a running coding-agent task replaces the generic label.
export const agentHosts = new Set(['com.apple.Terminal', 'com.googlecode.iterm2', 'com.mitchellh.ghostty', 'com.microsoft.VSCode', 'com.microsoft.VSCodeInsiders', 'com.todesktop.230313mzl4w4u92', 'com.apple.dt.Xcode', 'com.openai.codex', 'com.anthropic.claudefordesktop', 'com.google.antigravity']);
export const defaultConfig = { enabled: true, idleSeconds: 300, switchDelaySeconds: 120, trackingEnabled: true, music: { enabled: true, sources: ['com.apple.Music'], priority: 'app' }, allowlist: Object.keys(profiles), denylist: [], profiles: {}, assets: {}, resolve: { enabled: false }, disclosure: {}, agent: { enabled: true, showProject: false, ai: { provider: 'off', intervalMinutes: 15 } }, quietHours: { enabled: false, start: '23:00', end: '07:00' }, phrases: {}, output: 'auto', power: { saver: 'auto' } };

export function publicProfile(id, config) {
  if (typeof id !== 'string' || blocked.has(id) || config.denylist.includes(id) || !config.allowlist.includes(id)) return null;
  return Object.hasOwn(config.profiles, id) ? config.profiles[id] : (Object.hasOwn(profiles, id) ? { name: profiles[id][0], details: profiles[id][1] } : null);
}

export function foregroundProfile(snapshot, config) {
  if (!config.enabled || !snapshot || !Number.isInteger(snapshot.pid) || snapshot.pid <= 0 || !Number.isFinite(snapshot.idleSeconds) || snapshot.idleSeconds < 0 || snapshot.inactive !== false || snapshot.idleSeconds >= config.idleSeconds) return null;
  return publicProfile(snapshot.appId, config);
}

export function validateConfig(input = {}) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw Error('Invalid configuration');
  const c = { ...defaultConfig, ...input };
  if (typeof c.enabled !== 'boolean' || !Number.isFinite(c.idleSeconds) || c.idleSeconds < 30 || c.idleSeconds > 3600) throw Error('Invalid enable/idle settings');
  if (!Number.isInteger(c.switchDelaySeconds) || c.switchDelaySeconds < 0 || c.switchDelaySeconds > 300 || typeof c.trackingEnabled !== 'boolean') throw Error('Invalid delay/tracking settings');
  if (!c.music || typeof c.music !== 'object' || Array.isArray(c.music)) throw Error('Invalid music settings');
  c.music = { ...defaultConfig.music, ...c.music };
  if (typeof c.music.enabled !== 'boolean' || !['music', 'app'].includes(c.music.priority) || !Array.isArray(c.music.sources) || c.music.sources.some(id => !defaultConfig.music.sources.includes(id)) || new Set(c.music.sources).size !== c.music.sources.length) throw Error('Invalid music settings');
  c.music.sources = [...c.music.sources];
  for (const key of ['allowlist', 'denylist']) {
    if (!Array.isArray(c[key]) || c[key].some(x => typeof x !== 'string' || !/^[\w.-]{1,200}$/.test(x))) throw Error(`Invalid ${key}`);
    c[key] = [...c[key]];
  }
  for (const key of ['profiles', 'assets', 'resolve', 'disclosure']) if (!c[key] || typeof c[key] !== 'object' || Array.isArray(c[key])) throw Error(`Invalid ${key}`);
  for (const p of Object.values(c.profiles)) if (!p || typeof p.name !== 'string' || p.name.length < 2 || p.name.length > 128 || typeof p.details !== 'string' || p.details.length < 2 || p.details.length > 128 || /[\x00-\x1f]/.test(p.name + p.details)) throw Error('Invalid custom profile');
  for (const asset of Object.values(c.assets)) if (typeof asset !== 'string' || !/^[a-z0-9_-]{1,64}$/.test(asset)) throw Error('Invalid uploaded asset key');
  if (typeof c.resolve.enabled !== 'boolean') throw Error('Invalid Resolve setting');
  for (const [id, options] of Object.entries(c.disclosure)) {
    if (!nameApps.has(id) || !options || typeof options !== 'object' || Array.isArray(options) || typeof options.showName !== 'boolean' || typeof options.showContext !== 'boolean' || (options.showContext && id !== 'com.blackmagic-design.DaVinciResolve')) throw Error('Invalid name or workspace setting');
  }
  c.agent = { ...defaultConfig.agent, ...c.agent, ai: { ...defaultConfig.agent.ai, ...c.agent?.ai } };
  const ai = c.agent.ai;
  if (typeof c.agent.enabled !== 'boolean' || typeof c.agent.showProject !== 'boolean' || !['off', 'haiku', 'luna'].includes(ai.provider) || !Number.isInteger(ai.intervalMinutes) || ai.intervalMinutes < 5 || ai.intervalMinutes > 120 || [ai.model, ai.effort].some(x => x !== undefined && !/^[\w.-]{1,40}$/.test(x))) throw Error('Invalid agent setting');
  c.quietHours = { ...defaultConfig.quietHours, ...c.quietHours };
  const q = c.quietHours, clock = /^([01]\d|2[0-3]):[0-5]\d$/;
  if (typeof q.enabled !== 'boolean' || !clock.test(q.start) || !clock.test(q.end)) throw Error('Invalid quiet hours');
  if (!c.phrases || typeof c.phrases !== 'object' || Array.isArray(c.phrases)) throw Error('Invalid phrases');
  for (const [id, list] of Object.entries(c.phrases)) if (!/^[\w.-]{1,200}$/.test(id) || !Array.isArray(list) || list.length < 1 || list.length > 8 || list.some(x => typeof x !== 'string' || x.length < 2 || x.length > 64 || /[\x00-\x1f]/.test(x))) throw Error('Invalid phrases');
  if (!['auto', 'vencord', 'ipc'].includes(c.output)) throw Error('Invalid output setting');
  c.power = { ...defaultConfig.power, ...c.power };
  if (!['auto', 'on', 'off'].includes(c.power.saver)) throw Error('Invalid battery saver setting');
  c.disclosure = Object.fromEntries(Object.entries(c.disclosure).map(([id, options]) => [id, { ...options }]));
  return c;
}

// Quiet hours may wrap past midnight (for example 23:00 to 07:00).
export function inQuietHours(quiet, date = new Date()) {
  if (!quiet?.enabled) return false;
  const minutes = date.getHours() * 60 + date.getMinutes(), at = text => Number(text.slice(0, 2)) * 60 + Number(text.slice(3));
  const start = at(quiet.start), end = at(quiet.end);
  return start === end ? false : start < end ? minutes >= start && minutes < end : minutes >= start || minutes < end;
}
