/**
 * Your defaults: the writer's own copy of Storyloom's built-in texts (the narrator's writing instructions and card,
 * the planning and chapter-team instructions). Storyloom uses the writer's copy everywhere once it exists — Writing setup,
 * new books, updates — and offers its own later improvements to it, never forcing them. Pure module: no SillyTavern calls.
 */

/** The narrator texts a writer can own, per kind of book. */
export const NARRATOR_FIELDS = Object.freeze(['main', 'postHistory', 'continueNudge', 'newChat', 'card']);
export const NARRATOR_LABELS = Object.freeze({main: 'Main Prompt (how to write a book)', postHistory: 'Post-History reminder', continueNudge: 'Continue nudge', newChat: 'New chat marker', card: 'Narrator card'});

const norm = t => String(t ?? '').replace(/\r\n?/g, '\n');

/**
 * Carry one edit across to another version of the same text: whatever changed between `before` and `after`
 * (one stretch of text) is changed the same way in `other`. Returns the new `other`, or null when the changed
 * stretch can't be found exactly once there (the caller keeps the versions apart and says so).
 */
export function carryEdit(before, after, other) {
  const a = norm(before), b = norm(after), o = norm(other);
  if (a === b) return o;
  let i = 0; while (i < a.length && i < b.length && a[i] === b[i]) i++;
  let j = 0; while (j < a.length - i && j < b.length - i && a[a.length - 1 - j] === b[b.length - 1 - j]) j++;
  const gone = a.slice(i, a.length - j), added = b.slice(i, b.length - j);
  // Anchor on the changed stretch with a little context either side, shrinking the context until it is found exactly once.
  for (const ctx of [80, 40, 20, 0]) {
    const pre = a.slice(Math.max(0, i - ctx), i), post = a.slice(a.length - j, a.length - j + ctx), find = pre + gone + post;
    if (!find) continue;
    const at = o.indexOf(find);
    if (at < 0) continue;
    if (o.indexOf(find, at + 1) >= 0) continue;
    return o.slice(0, at) + pre + added + post + o.slice(at + find.length);
  }
  // A pure addition: place it after the words before it, or before the words after it, whichever is found exactly once.
  if (!gone) for (const ctx of [80, 40, 20]) {
    const pre = a.slice(Math.max(0, i - ctx), i), post = a.slice(a.length - j, a.length - j + ctx);
    for (const [anchor, after] of [[pre, true], [post, false]]) {
      if (anchor.trim().length < 12) continue;
      const at = o.indexOf(anchor);
      if (at < 0 || o.indexOf(anchor, at + 1) >= 0) continue;
      const cut = after ? at + anchor.length : at;
      return o.slice(0, cut) + added + o.slice(cut);
    }
  }
  return null;
}

/** Line-level differences from `a` to `b` as hunks {from, to, lines}: lines a[from..to) became `lines`. */
export function lineHunks(a, b) {
  const x = norm(a).split('\n'), y = norm(b).split('\n'), n = x.length, m = y.length;
  const L = Array.from({length: n + 1}, () => new Int32Array(m + 1));
  for (let i = n - 1; i >= 0; i--) for (let k = m - 1; k >= 0; k--) L[i][k] = x[i] === y[k] ? L[i + 1][k + 1] + 1 : Math.max(L[i + 1][k], L[i][k + 1]);
  const hunks = []; let i = 0, k = 0, cur = null;
  const flush = () => { if (cur) { hunks.push(cur); cur = null; } };
  while (i < n || k < m) {
    if (i < n && k < m && x[i] === y[k]) { flush(); i++; k++; }
    else if (k < m && (i >= n || L[i][k + 1] >= L[i + 1][k])) { cur ??= {from: i, to: i, lines: []}; cur.lines.push(y[k]); k++; }
    else { cur ??= {from: i, to: i, lines: []}; cur.to = i + 1; i++; }
  }
  flush();
  return hunks;
}

/**
 * Bring Storyloom's improvements into the writer's copy: every change from `base` (the built-in text the copy was made from)
 * to `theirs` (Storyloom's new built-in text) is applied to `mine` where the lines it touches are still as they were.
 * Returns {text, applied, conflicts}: a conflict is a change whose lines the writer had changed too — left as the writer has it.
 */
export function mergeImprovements(base, mine, theirs) {
  const b = norm(base).split('\n');
  let text = norm(mine);
  const out = {applied: 0, conflicts: []};
  for (const h of lineHunks(base, theirs)) {
    const old = b.slice(h.from, h.to), neu = h.lines;
    let next = null;
    if (old.length) {
      const find = old.join('\n'), at = text.indexOf(find);
      if (at >= 0 && text.indexOf(find, at + 1) < 0) next = text.slice(0, at) + neu.join('\n') + text.slice(at + find.length);
    } else {
      // A pure insertion: place it after the line before it (or before the line after it), if that line is still there once.
      const prev = b[h.from - 1], after = b[h.from];
      const once = s => s !== undefined && s.trim() && text.split('\n').filter(l => l === s).length === 1;
      if (once(prev)) { const lines = text.split('\n'), at = lines.indexOf(prev); lines.splice(at + 1, 0, ...neu); next = lines.join('\n'); }
      else if (once(after)) { const lines = text.split('\n'), at = lines.indexOf(after); lines.splice(at, 0, ...neu); next = lines.join('\n'); }
    }
    if (next === null) out.conflicts.push({was: old.join('\n'), now: neu.join('\n')});
    else { text = next; out.applied++; }
  }
  return {text, ...out};
}

/** One owned text: {text, base} — the writer's version and the built-in text it was made from. Accepts a bare string (older settings). */
export const ownedText = v => typeof v === 'string' ? {text: v, base: ''} : (v && typeof v.text === 'string' ? {text: v.text, base: String(v.base || '')} : null);

/** Whether Storyloom's built-in text moved on since the writer's copy was made (there's an improvement to offer). */
export const hasImprovement = (owned, builtIn) => !!owned && !!owned.base && norm(owned.base).trim() !== norm(builtIn).trim() && norm(owned.text).trim() !== norm(builtIn).trim();
