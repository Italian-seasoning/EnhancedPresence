// Accept a bounded name, never a path, URL, control sequence, or untitled window.
export function safeName(value) {
  if (typeof value !== 'string') return undefined;
  const name = value.trim().replace(/\s+[—–-]\s+(?:Edited|Locked|TextEdit|Final Cut Pro|DaVinci Resolve|Adobe [^—–]{1,50})$/i, '').replace(/\.(?:txt|rtf|rtfd)$/i, '');
  if (!name || name.length > 80 || /[\x00-\x1f\x7f\u202a-\u202e\u2066-\u2069/\\]/.test(name) || /(?:https?:|file:|^[a-z]:|^untitled(?:\s+\d+)?$|^Final Cut Pro$|^DaVinci Resolve$|^Adobe [^—–]{1,50}$)/i.test(name)) return undefined;
  return name;
}
