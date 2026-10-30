export function playbackPosition(playback, now = Date.now()) {
  if (!playback || !Number.isFinite(playback.elapsedSeconds)) return 0;
  const limit = Number.isFinite(playback.durationSeconds) && playback.durationSeconds > 0 ? playback.durationSeconds : 86400;
  const rate = Number.isFinite(playback.playbackRate) ? Math.max(0, Math.min(4, playback.playbackRate)) : 1;
  const seconds = playback.playing && Number.isFinite(playback.updatedAt) && Number.isFinite(now)
    ? Math.max(0, now - playback.updatedAt) / 1000 * rate : 0;
  return Math.min(limit, Math.max(0, playback.elapsedSeconds) + seconds);
}
