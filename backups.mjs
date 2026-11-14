/**
 * Backups: before Storyloom changes anything of the writer's outside the lorebook — SillyTavern's global
 * Main Prompt, a character card, a Storyloom prompt, a role's personality, the narrator template, a template,
 * or chapter text before a revision — it keeps the old version here. Pure helpers; index.js stores the list
 * in extension settings (so it lives on the SillyTavern server, not just this browser) and restores entries.
 */
export const BACKUP_MAX = 200;
export const BACKUP_KINDS = Object.freeze({
  globalMain: 'Global Main Prompt',
  character: 'Character card',
  prompt: 'Storyloom prompt',
  persona: 'Role personality',
  narratorTemplate: 'Narrator template',
  template: 'Template',
  chapter: 'Chapter text',
});

/**
 * Add a backup (newest last), keeping at most `max`. `before` is the old value, copied.
 * `group` ties backups made by one action together (e.g. a narrator change touching a card and the Main Prompt).
 * Returns {list, entry}.
 */
export function addBackup(list, {kind, label, target = {}, before = null, group = null}, {now = new Date(), max = BACKUP_MAX, id = null} = {}) {
  if (!BACKUP_KINDS[kind]) throw Error(`Unknown backup kind: ${kind}`);
  const entry = {
    id: id || `${now.getTime().toString(36)}-${Math.random().toString(36).slice(2, 7)}`,
    at: now.toISOString(), kind, label: String(label || BACKUP_KINDS[kind]),
    target: structuredClone(target ?? {}), before: before == null ? null : structuredClone(before),
    ...(group ? {group} : {}),
  };
  return {list: [...(Array.isArray(list) ? list : []), entry].slice(-max), entry};
}

/** The backups made by the most recent action that had a group (or the newest single backup). */
export function latestGroup(list) {
  const last = (list || []).at(-1);
  if (!last) return [];
  return last.group ? list.filter(b => b.group === last.group) : [last];
}

/** Readable text of what a backup holds, for View and Copy. */
export function backupText(b) {
  const v = b?.before;
  if (v == null) return '(nothing was set — restoring goes back to the default)';
  if (typeof v === 'string') return v || '(empty)';
  if (Array.isArray(v)) return v.map((t, i) => `— part ${i + 1} —\n${typeof t === 'string' ? t : JSON.stringify(t, null, 2)}`).join('\n\n');
  return Object.entries(v).map(([k, x]) => `— ${k} —\n${typeof x === 'string' ? (x || '(empty)') : JSON.stringify(x, null, 2)}`).join('\n\n');
}
