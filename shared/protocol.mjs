export function message(activity) {
  return activity ? { type: 'presence_update', protocol: 1, activity } : { type: 'presence_clear', protocol: 1 };
}
export function discordActivity(activity) {
  if (!activity) return null;
  const music = activity.kind === 'music';
  const result = { details: (music ? activity.details : `${activity.appName}: ${activity.details}`).slice(0, 128), timestamps: { start: activity.startTimestamp } };
  if (music) { result.type = 2; if (activity.endTimestamp) result.timestamps.end = activity.endTimestamp; }
  const album = typeof activity.album === 'string' ? activity.album.slice(0, 62) : '';
  if (music && album) {
    const artist = typeof activity.state === 'string' ? activity.state.slice(0, 62) : '';
    result.state = [artist, album].filter(Boolean).join(' • ').slice(0, 128);
  } else if (activity.state) result.state = activity.state;
  if (activity.largeImage) result.assets = { large_image: activity.largeImage, large_text: activity.largeText };
  if (music && activity.artworkUrl) result.assets = { large_image: activity.artworkUrl, large_text: album || activity.details };
  return result;
}
