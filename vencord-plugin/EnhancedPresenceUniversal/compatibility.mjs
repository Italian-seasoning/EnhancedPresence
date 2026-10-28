// GPL-3.0-or-later. Preserve IgnoreActivities filtering on current Discord builds.
export function preserveActivityRecalculation(replacement) {
  return replacement.replace('.filter($self.isActivityNotIgnored);', '.filter($self.isActivityNotIgnored),');
}
export function fixActivityFilter(plugin) {
  const patch = plugin?.patches?.find(p => p.find === '"LocalActivityStore"');
  if (!patch) return false;
  const replacements = Array.isArray(patch.replacement) ? patch.replacement : [patch.replacement];
  for (const replacement of replacements) {
    if (typeof replacement?.replace !== 'function' || !String(replacement.replace).includes('.filter($self.isActivityNotIgnored);')) continue;
    const original = replacement.replace;
    replacement.replace = (...args) => preserveActivityRecalculation(original(...args));
    return true;
  }
  return false;
}
