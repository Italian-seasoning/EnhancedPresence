/* Licensed under GPL-3.0-or-later. */
export function isRepeatedAuthor(messages, message) {
  if (!Array.isArray(messages) || !/^\d{17,20}$/.test(message?.id ?? '')) return false;
  let low = 0, high = messages.length - 1;
  // MessageStore keeps snowflakes ordered; avoid rescanning a channel for each rendered row.
  while (low <= high) {
    const index = (low + high) >>> 1;
    const id = messages[index]?.id;
    if (typeof id !== 'string') return false;
    if (id === message.id) {
      const previous = messages[index - 1];
      for (const item of [previous, message]) {
        if (!item || ![0, 19].includes(item.type) || item.blocked || item.webhookId || item.webhook_id
          || !/^\d{17,20}$/.test(item.author?.id ?? '') || !/^\d{17,20}$/.test(item.channel_id ?? '')) return false;
      }
      if (previous.author.id !== message.author.id || previous.channel_id !== message.channel_id) return false;
      const before = new Date(previous.timestamp), current = new Date(message.timestamp);
      return Number.isFinite(before.getTime()) && Number.isFinite(current.getTime())
        && before <= current && before.toDateString() === current.toDateString();
    }
    if (id.length < message.id.length || id.length === message.id.length && id < message.id) low = index + 1;
    else high = index - 1;
  }
  return false;
}
