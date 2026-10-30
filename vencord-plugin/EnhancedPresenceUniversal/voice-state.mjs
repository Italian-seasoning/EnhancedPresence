const channelIdPattern = /^\d{1,20}$/;
const commandIdPattern = /^[a-f\d]{8}(?:-[a-f\d]{4}){3}-[a-f\d]{12}$/i;
const cleanLabel = value => typeof value === 'string'
  ? value.replace(/[\u0000-\u001f\u007f-\u009f\u200b-\u200f\u202a-\u202e\u2060-\u206f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 80)
  : '';

export function normalizeVoiceSnapshot(value, now = Date.now()) {
  if (!value || typeof value !== 'object' || Array.isArray(value) || value.version !== 1
    || !Number.isSafeInteger(value.updatedAt) || !Number.isSafeInteger(now) || value.updatedAt > now
    || now - value.updatedAt > 5000 || typeof value.channelId !== 'string' || !channelIdPattern.test(value.channelId)
    || typeof value.selfMute !== 'boolean' || typeof value.selfDeaf !== 'boolean' || !Array.isArray(value.speakers)
    || value.speakers.length > 32) return null;
  const channelName = cleanLabel(value.channelName);
  if (!channelName) return null;
  const seen = new Set();
  const speakers = [];
  for (const speaker of value.speakers) {
    if (!speaker || typeof speaker !== 'object' || Array.isArray(speaker) || typeof speaker.id !== 'string'
      || !channelIdPattern.test(speaker.id) || typeof speaker.speaking !== 'boolean') return null;
    const name = cleanLabel(speaker.name);
    if (!name || seen.has(speaker.id)) return null;
    seen.add(speaker.id);
    if (speakers.length < 8) speakers.push({ id: speaker.id, name, speaking: speaker.speaking });
  }
  return { version: 1, updatedAt: value.updatedAt, channelId: value.channelId, channelName,
    selfMute: value.selfMute, selfDeaf: value.selfDeaf, speakers };
}

export function normalizeVoiceCommand(value, now = Date.now()) {
  if (!value || typeof value !== 'object' || Array.isArray(value) || value.version !== 1
    || typeof value.id !== 'string' || !commandIdPattern.test(value.id)
    || !Number.isSafeInteger(value.createdAt) || !Number.isSafeInteger(now) || value.createdAt > now
    || now - value.createdAt > 2000 || typeof value.channelId !== 'string' || !channelIdPattern.test(value.channelId)
    || !['mute', 'deafen'].includes(value.action) || typeof value.value !== 'boolean') return null;
  return { version: 1, id: value.id.toLowerCase(), createdAt: value.createdAt,
    channelId: value.channelId, action: value.action, value: value.value };
}

export function voiceCommandIsCurrent(value, channelId, now = Date.now()) {
  const command = normalizeVoiceCommand(value, now);
  return Boolean(command && typeof channelId === 'string' && channelIdPattern.test(channelId)
    && command.channelId === channelId);
}
