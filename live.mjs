/**
 * Live memory, kept up while the chapter or session is being written (not only at Seal):
 *  - Scene now: a small card of where / when / who's here / conditions / what's in hand, refreshed every few replies.
 *  - Earlier this session: a rolling summary of the older part of the chat, so a long chapter doesn't forget its start.
 *  - On stage: the people named in the scene card, whose lorebook entries are pulled into every reply.
 * Pure helpers; index.js calls the model and saves the results as Storyloom memory entries.
 */

export const SCENE_FIELDS = Object.freeze(['WHEN', 'WHERE', "WHO'S HERE", 'CONDITIONS', 'IN HAND', 'JUST HAPPENED']);

/** Ask for the scene card as it stands after the latest messages. */
export function sceneInstruction({scene = '', recent = '', roleplay = false, player = ''} = {}) {
  return `Keep a small card of the scene as it stands right now, at the end of the messages below. Another language model reads it before writing the next reply, to stay consistent — so write plain facts it can use. Update the card you're given: change only what the messages changed, keep everything else exactly, and never invent anything that isn't on the page. Trackers built on language models drift in known ways: they drop people who are still present, forget injuries and objects, and let someone know what they never saw — keep everyone who is still there, and note who knows what when it matters.

Reply with exactly these lines and nothing else:
WHEN: day and time of day (and how long since the last change of scene, if known)
WHERE: the place, as exactly as the page gives it
WHO'S HERE: everyone present, comma-separated, each with a few words on what they're doing and what shape they're in — e.g. "Mara (at the sink, thumb cut), Tom (in the doorway, wet)"${roleplay && player ? `. Include ${player}, the player's character` : ''}
CONDITIONS: weather, light, temperature, sounds — anything in the air
IN HAND: objects being held, worn or in play, and where important ones were left
JUST HAPPENED: one line — the last thing that happened

THE CARD NOW
${String(scene || '').trim() || '(empty — first time)'}

THE LATEST MESSAGES
${recent}`;
}

/** The card text if the reply has the card's lines; otherwise null. */
export function parseScene(raw) {
  const lines = String(raw || '').replace(/\r\n?/g, '\n').split('\n').map(l => l.replace(/^[\s*_#>-]+/, '').replace(/\*\*/g, '').trim());
  const got = {};
  for (const l of lines) {
    const m = l.match(/^(WHEN|WHERE|WHO['’]?S HERE|CONDITIONS|IN HAND|JUST HAPPENED)\s*:\s*(.*)$/i);
    if (m) got[m[1].toUpperCase().replace('’', "'")] = m[2].trim();
  }
  if (!got.WHERE || !got["WHO'S HERE"]) return null;
  return SCENE_FIELDS.filter(f => got[f] != null).map(f => `${f}: ${got[f]}`).join('\n');
}

/** Names of the people in WHO'S HERE ("Mara (at the sink), Tom (wet)" → ["Mara", "Tom"]). */
export function sceneNames(card) {
  const line = String(card || '').split('\n').find(l => /^WHO['’]?S HERE\s*:/i.test(l)) || '';
  const body = line.replace(/^[^:]*:\s*/, '').replace(/\([^)]*\)/g, '');
  return [...new Set(body.split(/[,;]|\band\b/).map(s => s.replace(/[.*_"]/g, '').trim()).filter(s => /^[A-Z]/.test(s) && s.length <= 40 && !/^(no ?one|nobody|none|alone)$/i.test(s)))];
}

/**
 * Which messages to fold into "Earlier this session": the ones older than the last `keep`, once at least `every`
 * new ones have piled up since the last fold. Indexes are into the chat; returns {from, to} (to exclusive) or null.
 */
export function foldRange(chatLength, {start = 0, upto = 0, keep = 16, every = 20} = {}) {
  const from = Math.max(start, upto), to = chatLength - keep;
  return to - from >= every ? {from, to} : null;
}

/** Ask for the rolling summary to be extended with the next stretch of the chat. */
export function sessionInstruction({summary = '', messages = '', unit = 'Chapter', roleplay = false} = {}) {
  const u = roleplay ? 'session' : unit.toLowerCase();
  return `Keep a running record of this ${u} so far, so nothing early on is forgotten as it grows. Another language model reads it while writing the rest of the ${u}, so write plain, specific statements — names, times, places, objects — never style or commentary. Below is the record up to now and the next stretch of the ${u}. Return the whole updated record.

Write it as short lines in story order, one per significant moment: what was done, said, decided, discovered or noticed, and anything left in a state a later page could pick up (injuries, promises, objects, weather, who knows what). Keep every line from the record up to now; add the new stretch after it. If the record grows past about 50 lines, merge the oldest ones into fewer lines without losing a fact. Only what is on the page: keep "doesn't know" and "isn't sure" exactly, never turn a guess into a fact, never merge two people. No headings, no commentary.

THE RECORD UP TO NOW
${String(summary || '').trim() || '(empty — the start of the ' + u + ')'}

THE NEXT STRETCH
${messages}`;
}

/** The summary from the model's reply (bullets kept as lines). */
export function parseSession(raw) {
  const t = String(raw || '').replace(/\r\n?/g, '\n').replace(/^\s*(here(?:'s| is)[^\n]*|the (?:whole )?updated record[^\n]*)\n/i, '').trim();
  const lines = t.split('\n').map(l => l.trim()).filter(Boolean);
  return lines.length ? lines.join('\n') : null;
}
