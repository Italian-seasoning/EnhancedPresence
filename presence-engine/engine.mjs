import { foregroundProfile, publicProfile, validateConfig, nameApps, agentHosts, inQuietHours } from './profiles.mjs';
import { safeName } from './names.mjs';
import { agentActivity } from './agent.mjs';
import { StatusWriter } from './ai.mjs';
export const isDiscord = id => ['com.hnc.Discord', 'com.hnc.DiscordCanary', 'com.hnc.DiscordPTB', 'dev.vencord.Vesktop'].includes(id);
const creative = id => id === 'com.apple.FinalCut' || id === 'com.blackmagic-design.DaVinciResolve' || id?.startsWith('com.adobe.');
const phrases = {
  'com.openai.codex': ['Cooking with Codex', 'Negotiating with bugs', 'Wrangling semicolons', 'It works on my Mac'],
  'com.microsoft.VSCode': ['Cooking up code', 'Chasing the last bug', 'Wrangling semicolons', 'One more tiny tweak'],
  'com.todesktop.230313mzl4w4u92': ['Cooking up code', 'Chasing the last bug', 'Wrangling semicolons', 'One more tiny tweak'],
  'com.apple.dt.Xcode': ['Cooking up code', 'Chasing the last bug', 'Wrangling semicolons', 'One more tiny tweak'],
  'com.Roblox.RobloxStudio': ['Building block by block', 'Cooking up a world', 'Placing one more brick', 'One more tiny tweak'],
  'org.blenderfoundation.blender': ['Cooking in 3D', 'Moving the cube again', 'Rendering my patience', 'One more tiny tweak'],
  'com.figma.Desktop': ['Pushing pixels', 'Cooking up screens', 'Aligning the universe', 'One more tiny tweak'],
  'com.todesktop.2601167vjw8xe': ['Pushing pixels', 'Cooking up screens', 'Aligning the universe', 'One more tiny tweak'],
  'org.godotengine.godot': ['Cooking up a game', 'Chasing the last bug', 'Making pixels move', 'One more tiny tweak'],
  'com.pixelmatorteam.pixelmator.x': ['Cooking up pixels', 'Layer by layer', 'Making pixels behave', 'One more tiny tweak'],
  'com.apple.motionapp': ['Keyframing chaos', 'Cooking up motion', 'Making pixels dance', 'One more tiny tweak'],
  'com.apple.logic10': ['Cooking up a beat', 'Chasing the groove', 'One more take', 'Making waves'],
  'com.apple.FinalCut': ['Cooking up a cut', 'Cutting to the good part', 'Frames in the oven', 'One more tiny tweak'],
  'com.blackmagic-design.DaVinciResolve': ['Cooking up a cut', 'Coloring outside the lines', 'Making frames behave', 'One more tiny tweak'],
  'com.adobe.Photoshop': ['Cooking up pixels', 'Layer by layer', 'Making pixels behave', 'One more tiny tweak'],
  'com.adobe.lightroomCC': ['Cooking up colors', 'Chasing the light', 'Pixels on the menu', 'One more tiny tweak'],
  'com.adobe.LightroomClassicCC7': ['Cooking up colors', 'Chasing the light', 'Pixels on the menu', 'One more tiny tweak'],
  'com.adobe.illustrator': ['Bending vectors', 'Cooking up curves', 'Making points behave', 'One more tiny tweak'],
  'com.adobe.InDesign': ['Taming the margins', 'Cooking up layouts', 'Moving pixels around', 'One more tiny tweak'],
  'com.adobe.AfterEffects': ['Keyframing chaos', 'Cooking up motion', 'Making pixels dance', 'One more tiny tweak'],
  'com.adobe.PremierePro': ['Cooking up a cut', 'Cutting to the good part', 'Frames in the oven', 'One more tiny tweak']
};
const pages = { media: 'Managing media', cut: 'Cutting video', edit: 'Editing video', fusion: 'Compositing', color: 'Color grading', fairlight: 'Mixing audio', deliver: 'Preparing delivery' };

export class PresenceEngine {
  constructor(config = {}, provider = async () => null, agentDir, runner) {
    this.agentDir = agentDir;
    this.writer = new StatusWriter(runner);
    this.config = validateConfig(config);
    this.provider = provider;
    this.session = null;
    this.pending = null;
    this.activity = null;
    this.discordUntil = null;
    this.sessionPhrases = new Map();
  }
  details(id, pid, start, profile, config) {
    const list = config.phrases[id] ?? phrases[id];
    if (!list || Object.hasOwn(config.profiles, id)) return profile.details;
    const key = `${id}:${pid}:${start}`;
    if (!this.sessionPhrases.has(key)) {
      if (this.sessionPhrases.size >= 128) this.sessionPhrases.delete(this.sessionPhrases.keys().next().value);
      this.sessionPhrases.set(key, list[Math.floor(Math.random() * list.length)]);
    }
    return this.sessionPhrases.get(key);
  }
  retained(config) {
    const profile = publicProfile(this.session.id, config);
    const disclosure = config.disclosure[this.session.id];
    if (!this.activity || !disclosure?.showName || (this.activity.state && !disclosure.showContext)) {
      this.activity = { appId: this.session.id, appName: profile.name, details: this.details(this.session.id, this.session.pid, this.session.start, profile, config), startTimestamp: this.session.start, privacyLevel: 'limited' };
      if (config.assets[this.session.id]) { this.activity.largeImage = config.assets[this.session.id]; this.activity.largeText = profile.name; }
    }
    return this.activity;
  }
  nextDeadline(now = Date.now()) {
    const deadline = this.discordUntil ?? this.pending?.dueAt;
    return deadline == null ? null : Math.max(0, deadline - now);
  }
  // A running coding-agent task (from the hook) replaces the label and timer in agent host apps.
  async update(snapshot, now = Date.now()) {
    if (inQuietHours(this.config.quietHours, new Date(now))) { this.session = this.pending = this.activity = null; return null; }
    const activity = await this.baseUpdate(snapshot, now);
    const task = activity && agentHosts.has(activity.appId) ? agentActivity(this.config.agent, now, this.agentDir) : null;
    if (!task) return activity;
    const { categories, ...shown } = task;
    const minutes = Math.round((now / 1000 - shown.startTimestamp) / 60);
    const details = this.writer.get(this.config.agent.ai, { phrase: shown.details, app: activity.appName, minutes, categories: categories.slice(-6) }, now) ?? shown.details;
    return { ...activity, ...shown, details };
  }
  async baseUpdate(snapshot, now = Date.now()) {
    const c = this.config;
    const profile = foregroundProfile(snapshot, c);
    if (!profile) {
      const canWait = isDiscord(snapshot?.appId) && this.session && c.enabled && snapshot.inactive === false && Number.isFinite(snapshot.idleSeconds) && snapshot.idleSeconds < c.idleSeconds && publicProfile(this.session.id, c);
      if (canWait) {
        const running = snapshot.runningApps;
        this.pending = null;
        if (running && typeof running === 'object' && !Array.isArray(running)) {
          this.discordUntil = null;
          if (Array.isArray(running[this.session.id]) && running[this.session.id].includes(this.session.pid)) return this.retained(c);
        } else {
          this.discordUntil ??= now + c.switchDelaySeconds * 1000;
          if (now < this.discordUntil) return this.retained(c);
        }
      }
      this.discordUntil = null;
      this.session = null;
      this.pending = null;
      this.activity = null;
      return null;
    }
    this.discordUntil = null;
    const id = snapshot.appId;
    const launch = snapshot.launchTimestamp;
    const started = Number.isSafeInteger(launch) && launch > 0 && launch <= Math.floor(now / 1000) ? launch : Math.floor(now / 1000);
    if (this.session && !publicProfile(this.session.id, c)) { this.session = null; this.activity = null; }
    if (this.session?.id === id && this.session?.pid === snapshot.pid) this.pending = null;
    else if (!this.session && !this.pending) this.session = { id, pid: snapshot.pid, start: started };
    else {
      if (this.pending?.id !== id || this.pending?.pid !== snapshot.pid) this.pending = { id, pid: snapshot.pid, start: now, dueAt: now + c.switchDelaySeconds * 1000 };
      this.pending.dueAt = this.pending.start + c.switchDelaySeconds * 1000;
      if (now < this.pending.dueAt) {
        if (!this.session) return null;
        return this.retained(c);
      }
      this.session = { id, pid: snapshot.pid, start: Number.isSafeInteger(snapshot.launchTimestamp) && snapshot.launchTimestamp > 0 && snapshot.launchTimestamp <= Math.floor(now / 1000) ? snapshot.launchTimestamp : Math.floor(this.pending.start / 1000) };
      this.pending = null;
    }
    const activity = { appId: id, appName: profile.name, details: this.details(id, snapshot.pid, this.session.start, profile, c), startTimestamp: this.session.start, privacyLevel: 'limited' };
    // Assets only appear after a local mapping confirms a Discord-hosted key.
    if (c.assets[id]) { activity.largeImage = c.assets[id]; activity.largeText = profile.name; }
    const disclosure = c.disclosure[id] || { showName: false, showContext: false };
    if (disclosure.showName && (nameApps.has(id) && id !== 'com.blackmagic-design.DaVinciResolve')) {
      const title = id === 'com.adobe.Photoshop' && typeof snapshot.documentName === 'string' ? snapshot.documentName.replace(/\s+@\s+\d+(?:\.\d+)?%.*$/, '') : snapshot.documentName;
      const name = safeName(title);
      if (name) activity.details = `${activity.details} · “${name}”`.slice(0, 128);
    }
    if (id === 'com.blackmagic-design.DaVinciResolve' && (c.resolve.enabled || disclosure.showContext || disclosure.showName)) {
      try {
        const metadata = await this.provider({ showName: disclosure.showName });
        if ((c.resolve.enabled || disclosure.showContext) && pages[metadata?.page]) activity.details = pages[metadata.page];
        if ((c.resolve.enabled || disclosure.showContext) && metadata?.rendering === true) activity.details = 'Rendering video';
        const name = disclosure.showName ? safeName(metadata?.projectName) : undefined;
        if (name) activity.details = `${activity.details.replace(/ video$/, '')} “${name}”`.slice(0, 128);
        if (disclosure.showContext && pages[metadata?.page]) activity.state = `${metadata.page[0].toUpperCase()}${metadata.page.slice(1)} page`;
      } catch { /* Provider failure leaves generic activity; errors contain no metadata. */ }
    }
    this.activity = activity;
    return activity;
  }
}
