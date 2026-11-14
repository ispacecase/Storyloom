/**
 * Storyloom Assistant: a chat about SillyTavern and the writer's setup.
 * It reads a snapshot of the live setup plus retrieved SillyTavern docs, and may propose
 * lorebook changes as ACTION blocks. Nothing changes until the writer clicks Apply.
 */
import {P} from './prompt-texts.mjs';

export const POSITIONS = Object.freeze({before: 0, after: 1, 'an-top': 2, 'an-bottom': 3, depth: 4, 'em-top': 5, 'em-bottom': 6, outlet: 7});
const POSITION_NAMES = Object.fromEntries(Object.entries(POSITIONS).map(([k, v]) => [v, k]));
export const ROLES = Object.freeze({system: 0, user: 1, assistant: 2});
const ROLE_NAMES = ['system', 'user', 'assistant'];

const ACTION_FORMAT = `When — and only when — the writer wants a change, propose it as one block per change, after your reply. Lorebook changes:
=== ACTION: add-entry | edit-entry | set-placement
BOOK: exact lorebook name
TITLE: exact entry title (for edit-entry and set-placement, an entry that exists)
KEYS: keyword, keyword            (add-entry / edit-entry; optional for edit)
STRATEGY: always | keyword | off  (optional; vectors also apply when Vector Storage is on for all entries)
POSITION: before | after | an-top | an-bottom | depth | em-top | em-bottom | outlet   (optional)
DEPTH: number                     (only with POSITION: depth)
ROLE: system | user | assistant   (only with POSITION: depth)
RECURSION: yes | no               (no = other entries cannot trigger this one)
ORDER: number                     (optional priority; higher goes first)
CONTENT:
the complete entry text (add-entry; for edit-entry only if the text changes)
=== END
Writing-setup changes (only these; see HOW STORYLOOM SETS UP WRITING):
=== ACTION: set-preset-prompt
PROMPT: main | post-history | continue-nudge | new-chat | auxiliary
CONTENT:
the complete new text
=== END
=== ACTION: toggle-prompt
PROMPT: main | post-history | auxiliary | enhance-definitions
ENABLED: yes | no
=== END
=== ACTION: set-book-setting
NAME: narrator | pov | tense | voice | tone | genre | rules
SCOPE: chapter | book          (chapter = only the current chapter; book = also save it into the book's “Voice and Boundaries” record — only for pov, tense, tone, voice, rules)
CONTENT:
the new value
=== END
=== ACTION: set-narrator-card
CONTENT:
the complete new description of the general narrator card (keep every {{getvar::storyloom_…}} blank in it)
=== END
The writer sees each block as a card with an Apply button; nothing changes until they click it, and the old version is backed up first. Never claim you changed anything yourself. Preset changes only ever touch the “Storyloom Novel” preset, never the writer's own presets: if it doesn't exist yet, tell them to use Writing setup… on the Memory tab. Never propose changes to SillyTavern settings outside these (sliders, connections, other characters) — explain where the writer can change those instead. Never put documentation text into a story lorebook.`;

/** How Storyloom itself delivers its entries; the assistant must not "fix" these. */
const STORYLOOM_DESIGN = `How Storyloom sets up a novel's lorebook (deliberate — never suggest changing it):
- Entries marked "managed by Storyloom" are switched off in the lorebook ON PURPOSE. Planning notes (scale, cast index) are off because the prose doesn't need them. The full outline, "Current Chapter", "Story so far" and "Previously" are sent by Storyloom itself as injected prompts, each wrapped in an instruction (the outline's says to use it for direction and never write ahead) (Storyloom panel → Memory tab, where the writer chooses position and role). "Current Writing Directive" reaches the chat through the Author's Note, which Storyloom keeps in sync. Switching any of these on would send them twice.
- Character and place entries are keyword entries that other entries cannot trigger (excludeRecursion), so they arrive only when named in recent messages or matched by Vector Storage.
- To change what the story sees each chapter, the writer uses the Memory tab or the chapter picker, not these entries' settings.
- Never propose cards for entries managed by Storyloom; they will be refused. Point the writer to the Memory tab or the Author's Note instead.
- Long entry texts in the snapshot may be shortened for space; a marked "[…shortened here…]" is not a problem in the real entry. Never put a shortened text into an edit-entry card — you would cut the real entry short. If you only see part of an entry, describe the change in words instead.`;

/** How Storyloom sets up the story chat for writing — the assistant's map of it. */
const STORYLOOM_SETUP = `HOW STORYLOOM SETS UP WRITING (based on research; details in the STORYLOOM KNOWLEDGE excerpts)
Every SillyTavern slot is just text placed somewhere in one long prompt; what matters is what it says, where it sits and its role. The top frames the job, the end is followed most strongly, the middle is easily lost; system text is followed as instruction, user text is answered, assistant text is imitated.
Three layers keep "how to write" apart from "what's in the story", as NovelAI, Novelcrafter and Sudowrite do:
1. The “Storyloom Novel” preset — a copy of the writer's own Chat Completion preset. Its Main Prompt teaches the craft of writing a book (scenes not summary, show don't tell, subtext, point-of-view discipline, end each reply on an open beat, manuscript text only); its Post-History Instructions are a short reminder read last; its continue-nudge and new-chat prompts speak of passages and chapters; Enhance Definitions is off so the model doesn't invent lore. The sliders are the writer's own and depend on their model.
2. One general narrator card (“Storyloom Narrator”) — the narrator, with blanks {{getvar::storyloom_narrator}}, _pov, _tense, _voice, _tone, _genre, _rules. SillyTavern fills the blanks from this chat's variables, so one card serves every book.
3. Book settings — this chat's values for those blanks. Storyloom fills them from the book's “Voice and Boundaries” entry and the summary entry; a chapter can override them (a different narrator or tense). “Voice and Boundaries” stays saved in the lorebook as the record; while the general narrator carries it, it is switched off there so it can't contradict a chapter's own settings.
Story facts live in the lorebook (characters and places arrive when named). Storyloom's Memory sends Story so far and Previously at the start of the chat, this chapter's plan near the end, and (optionally) the whole outline. The writer's message is the direction for the next passage and comes last.
When the writer wants better prose, look for the cause in this order: the latest replies (the model imitates them), the end of the prompt (Post-History), the chapter plan, then the Main Prompt. Say what you'd change and why, and propose it as a card.`;

export function assistantSystem() {
  return `${P('assistant')}\n\n${STORYLOOM_SETUP}\n\nYou are given (1) a snapshot of the writer's live SillyTavern setup, (2) excerpts from the official SillyTavern documentation chosen for this question, and (3) the conversation so far. Base answers about how SillyTavern works on the documentation excerpts and name the page you used, like (Docs: Usage › worldinfo). If the excerpts don't cover something, say so rather than guessing. Base answers about the writer's setup on the snapshot.\n\n${STORYLOOM_DESIGN}\n\n${ACTION_FORMAT}`;
}

const strategyOf = e => e.disable ? 'off' : e.constant ? 'always' : e.vectorized ? 'vector' : 'keyword';
const words = s => (String(s || '').match(/\S+/g) || []).length;

/** Compact description of one lorebook entry's placement. */
export function describeEntry(e) {
  const pos = POSITION_NAMES[e.position] ?? String(e.position);
  const where = pos === 'depth' ? `depth ${e.depth ?? 4} as ${ROLE_NAMES[e.role ?? 0]}` : pos === 'outlet' ? `outlet “${e.outletName || ''}”` : pos;
  const flags = [e.excludeRecursion && 'not triggered by other entries', e.preventRecursion && 'does not trigger others', e.sticky && `sticky ${e.sticky}`, e.cooldown && `cooldown ${e.cooldown}`, e.delay && `delay ${e.delay}`].filter(Boolean).join(', ');
  return `“${e.comment || '(untitled)'}” — ${strategyOf(e)}, ${where}, order ${e.order ?? 100}, ${words(e.content)} words, keys: ${(e.key || []).slice(0, 8).join(', ') || 'none'}${flags ? `; ${flags}` : ''}`;
}

/** Plain-text snapshot of the setup. `s` is gathered by the extension; this only formats it. */
export function formatSnapshot(s) {
  const lines = [];
  lines.push(`Character: ${s.character?.name || '(none)'}${s.character?.description ? ` — description (${words(s.character.description)} words): ${s.character.description.slice(0, 600)}` : ''}`);
  if (s.character?.lorebook) lines.push(`Character's own lorebook: ${s.character.lorebook}`);
  lines.push(`Chat lorebook: ${s.chatLorebook || '(none)'}; global lorebooks: ${(s.globalLorebooks || []).join(', ') || '(none)'}; all lorebooks: ${(s.allLorebooks || []).join(', ')}`);
  if (s.worldInfo) lines.push(`Lorebook scanning: scan depth ${s.worldInfo.depth} messages, budget ${s.worldInfo.budget}% of context, recursive ${s.worldInfo.recursive ? 'on' : 'off'}, case-sensitive ${s.worldInfo.caseSensitive ? 'on' : 'off'}, whole words ${s.worldInfo.wholeWords ? 'on' : 'off'}`);
  if (s.vectors) lines.push(`Vector Storage: source ${s.vectors.source || 'none'}; for lorebooks ${s.vectors.enabled_world_info ? 'on' : 'off'}${s.vectors.enabled_for_all ? ' (all entries)' : ''}, max ${s.vectors.max_entries} entries, threshold ${s.vectors.score_threshold}; for chats ${s.vectors.enabled_chats ? 'on' : 'off'}`);
  if (s.prompts?.length) lines.push(`Prompt order (chat completion): ${s.prompts.map(p => `${p.enabled ? '' : '[off] '}${p.name}`).join(' → ')}`);
  for (const p of s.prompts || []) if (p.content && p.enabled) lines.push(`${p.name} text: ${p.content.slice(0, 1200)}`);
  if (s.authorsNote) lines.push(`Author's Note: ${s.authorsNote.text ? `${words(s.authorsNote.text)} words${/Novel Architect|Storyloom writing directive/.test(s.authorsNote.text) ? ', contains the Storyloom writing directive' : ''}` : 'empty'}, position ${s.authorsNote.position}, depth ${s.authorsNote.depth}, role ${s.authorsNote.role}`);
  if (s.memory?.length) lines.push(`Sent by Storyloom itself each reply (Memory tab): ${s.memory.map(m => `${m.label} — ${m.words ? `${m.words} words, ${m.where}` : 'empty, not sent'}`).join('; ')}`);
  if (s.connection) lines.push(`Main connection: ${s.connection}`);
  if (s.writing) {
    const w = s.writing;
    lines.push(`Preset in use: “${w.preset || '?'}”${w.isNovel ? ' (the Storyloom Novel preset)' : w.hasNovel ? ' (a Storyloom Novel preset exists but is not in use)' : ' (no Storyloom Novel preset yet)'}`);
    if (w.prompts) lines.push(`Preset prompts — Main Prompt${w.prompts.mainOn ? '' : ' [off]'}: ${w.prompts.main.slice(0, 1500) || '(empty)'}\nPost-History Instructions${w.prompts.postHistoryOn ? '' : ' [off]'}: ${w.prompts.postHistory || '(empty)'}\nAuxiliary: ${w.prompts.auxiliary || '(empty)'}\nContinue nudge: ${w.prompts.continueNudge}\nNew chat prompt: ${w.prompts.newChat}\nEnhance Definitions: ${w.prompts.enhanceDefinitions ? 'on' : 'off'}`);
    lines.push(`Narrator card: ${w.general ? 'the general Storyloom Narrator (blanks filled by book settings)' : 'not the general narrator'}`);
    if (w.values) lines.push(`Book settings in this chat (chapter ${w.chapter}): ${Object.entries(w.values).map(([k, v]) => `${k}: ${v || '(empty)'}`).join(' | ')}`);
  }
  if (s.novel) lines.push(`Storyloom project: ${s.novel}`);
  if (s.entries?.length) {
    lines.push(`Entries in the chat lorebook “${s.chatLorebook}”:`);
    const managed = new Map((s.managed || []).map(m => [m.title.toLocaleLowerCase(), m.how]));
    for (const e of s.entries) { const how = managed.get(String(e.comment || '').toLocaleLowerCase()); lines.push(`- ${describeEntry(e)}${how ? ` — managed by Storyloom: ${how}` : ''}`); }
  }
  for (const e of s.entryTexts || []) lines.push(`${e.shortened ? 'Start of the text' : 'Full text'} of “${e.comment}”:\n${e.content}${e.shortened ? '\n[…shortened here for space; the real entry continues]' : ''}`);
  return lines.join('\n');
}

const FIELD = /^\s*([A-Z]+)\s*:\s*(.*)$/;
/** Split a reply into the text to show and the proposed actions. Malformed blocks become notes, not actions. */
export function parseActions(text) {
  const lines = String(text || '').replace(/\r\n?/g, '\n').split('\n');
  const reply = [], actions = [], problems = [];
  let cur = null, inContent = false;
  const finish = () => {
    if (!cur) return;
    cur.content = inContent ? cur.contentLines.join('\n').trim() : undefined;
    delete cur.contentLines;
    try { actions.push(normalizeAction(cur)); } catch (e) { problems.push(e.message); }
    cur = null; inContent = false;
  };
  for (const line of lines) {
    const start = line.match(/^[\s*_#>]*=+\s*ACTION\s*:\s*([a-z-]+)/i);
    if (start) { finish(); cur = {type: start[1].toLowerCase(), contentLines: []}; continue; }
    if (cur && /^[\s*_#>]*=+\s*END\b/i.test(line)) { finish(); continue; }
    if (!cur) { reply.push(line); continue; }
    if (inContent) { cur.contentLines.push(line); continue; }
    const f = line.match(FIELD);
    if (f && f[1] === 'CONTENT') { inContent = true; if (f[2].trim()) cur.contentLines.push(f[2]); continue; }
    if (f) cur[f[1].toLowerCase()] = f[2].trim();
  }
  finish();
  return {reply: reply.join('\n').trim(), actions, problems};
}

const SETUP_ACTIONS = {
  'set-preset-prompt': a => { const p = String(a.prompt || '').toLowerCase(); if (!['main', 'post-history', 'continue-nudge', 'new-chat', 'auxiliary'].includes(p)) throw Error('set-preset-prompt needs PROMPT: main, post-history, continue-nudge, new-chat or auxiliary.'); if (!a.content) throw Error(`set-preset-prompt (${p}) needs CONTENT.`); return {type: a.type, prompt: p, content: a.content}; },
  'toggle-prompt': a => { const p = String(a.prompt || '').toLowerCase(); if (!['main', 'post-history', 'auxiliary', 'enhance-definitions'].includes(p)) throw Error('toggle-prompt needs PROMPT: main, post-history, auxiliary or enhance-definitions.'); return {type: a.type, prompt: p, enabled: /^y/i.test(a.enabled || '')}; },
  'set-book-setting': a => { const n = String(a.name || '').toLowerCase(); if (!['narrator', 'pov', 'tense', 'voice', 'tone', 'genre', 'rules'].includes(n)) throw Error('set-book-setting needs NAME: narrator, pov, tense, voice, tone, genre or rules.'); const scope = /^b/i.test(a.scope || '') ? 'book' : 'chapter'; return {type: a.type, name: n, scope, content: String(a.content ?? a.value ?? '').trim()}; },
  'set-narrator-card': a => { if (!a.content) throw Error('set-narrator-card needs CONTENT.'); if (!/\{\{getvar::storyloom_pov\}\}/.test(a.content)) throw Error('The narrator card must keep its {{getvar::storyloom_…}} blanks.'); return {type: a.type, content: a.content}; },
};
function normalizeAction(a) {
  if (SETUP_ACTIONS[a.type]) return SETUP_ACTIONS[a.type](a);
  const types = ['add-entry', 'edit-entry', 'set-placement'];
  if (!types.includes(a.type)) throw Error(`Unknown action “${a.type}”.`);
  if (!a.book) throw Error(`A ${a.type} card is missing BOOK.`);
  if (!a.title) throw Error(`A ${a.type} card is missing TITLE.`);
  if (a.type === 'add-entry' && !a.content) throw Error(`“${a.title}”: add-entry needs CONTENT.`);
  const out = {type: a.type, book: a.book, title: a.title};
  if (a.keys !== undefined) out.keys = a.keys.split(',').map(k => k.trim()).filter(Boolean);
  if (a.content !== undefined) out.content = a.content;
  if (a.strategy) { if (!['always', 'keyword', 'off'].includes(a.strategy.toLowerCase())) throw Error(`“${a.title}”: STRATEGY must be always, keyword or off.`); out.strategy = a.strategy.toLowerCase(); }
  if (a.position) { const p = a.position.toLowerCase(); if (!(p in POSITIONS)) throw Error(`“${a.title}”: unknown POSITION “${a.position}”.`); out.position = p; }
  if (a.depth !== undefined && a.depth !== '') { const d = Number(a.depth); if (!Number.isInteger(d) || d < 0 || d > 1000) throw Error(`“${a.title}”: DEPTH must be a whole number.`); out.depth = d; }
  if (a.role) { const r = a.role.toLowerCase(); if (!(r in ROLES)) throw Error(`“${a.title}”: ROLE must be system, user or assistant.`); out.role = r; }
  if (a.recursion) out.recursion = /^y/i.test(a.recursion);
  if (a.order !== undefined && a.order !== '') { const o = Number(a.order); if (!Number.isFinite(o)) throw Error(`“${a.title}”: ORDER must be a number.`); out.order = o; }
  return out;
}

/** Human-readable summary of what Apply will do. */
const PROMPT_LABELS = {main: 'Main Prompt', 'post-history': 'Post-History Instructions', 'continue-nudge': 'continue nudge', 'new-chat': 'new chat prompt', auxiliary: 'Auxiliary Prompt', 'enhance-definitions': 'Enhance Definitions'};
export function describeAction(a) {
  if (a.type === 'set-preset-prompt') return `Change the ${PROMPT_LABELS[a.prompt]} of the “Storyloom Novel” preset`;
  if (a.type === 'toggle-prompt') return `Turn ${a.enabled ? 'on' : 'off'} ${PROMPT_LABELS[a.prompt]} in the “Storyloom Novel” preset`;
  if (a.type === 'set-book-setting') return `Set this ${a.scope === 'book' ? 'book' : 'chapter'}’s ${a.name} to “${a.content.slice(0, 80)}${a.content.length > 80 ? '…' : ''}”${a.scope === 'book' ? ' (also saved in “Voice and Boundaries”)' : ''}`;
  if (a.type === 'set-narrator-card') return 'Change the general narrator card’s description';
  const parts = [];
  if (a.strategy) parts.push(a.strategy === 'always' ? 'always on' : a.strategy === 'off' ? 'switched off' : 'triggered by keywords');
  if (a.position) parts.push(a.position === 'depth' ? `placed at depth ${a.depth ?? 4}${a.role ? ` as ${a.role}` : ''}` : `placed: ${a.position}`);
  if (a.recursion !== undefined) parts.push(a.recursion ? 'can be triggered by other entries' : 'not triggered by other entries');
  if (a.order !== undefined) parts.push(`priority ${a.order}`);
  if (a.keys) parts.push(`keys: ${a.keys.join(', ') || 'none'}`);
  const verb = a.type === 'add-entry' ? 'Add entry' : a.type === 'edit-entry' ? 'Edit entry' : 'Change placement of';
  return `${verb} “${a.title}” in “${a.book}”${parts.length ? ` — ${parts.join('; ')}` : ''}${a.content && a.type !== 'add-entry' ? ' — new text' : ''}`;
}

/** Apply one action to a copy of a lorebook. `create(book)` adds and returns a new entry. Returns {book, uid}.
 * `managed` lists entries Storyloom delivers itself; switching those on is refused (it would send them twice). */
export function applyAction(source, a, create, managed = []) {
  const guard = managed.find(m => m.title.toLocaleLowerCase() === a.title.trim().toLocaleLowerCase());
  if (guard) throw Error(`“${a.title}” is managed by Storyloom (${guard.how}), so the assistant can’t change it. Edit it in Storyloom’s Memory tab or the Author’s Note instead.`);
  const book = structuredClone(source);
  const matches = Object.values(book.entries || {}).filter(e => String(e.comment || '').trim().toLocaleLowerCase() === a.title.trim().toLocaleLowerCase());
  let entry;
  if (a.type === 'add-entry') {
    if (matches.length) throw Error(`“${a.book}” already has an entry called “${a.title}”. Ask for an edit instead.`);
    entry = create(book);
    if (!entry) throw Error('Could not create the entry.');
    entry.comment = a.title.trim();
  } else {
    if (matches.length !== 1) throw Error(matches.length ? `“${a.book}” has more than one “${a.title}”.` : `“${a.book}” has no entry called “${a.title}”.`);
    entry = matches[0];
  }
  if (a.content !== undefined) {
    // The assistant may only see a shortened copy of an entry; refuse an edit that would cut the real one short.
    const old = String(entry.content || '').trim(), next = String(a.content).trim();
    if (a.type === 'edit-entry' && old && next.length < old.length * 0.8 && old.startsWith(next.slice(0, Math.min(120, next.length))))
      throw Error(`This would cut “${a.title}” from ${old.length.toLocaleString()} to ${next.length.toLocaleString()} characters — it looks like the assistant only saw part of it. Nothing was changed.`);
    entry.content = a.content;
  }
  if (a.keys) entry.key = a.keys;
  if (a.strategy) { entry.disable = a.strategy === 'off'; entry.constant = a.strategy === 'always'; }
  if (a.position) entry.position = POSITIONS[a.position];
  if (a.depth !== undefined) entry.depth = a.depth;
  if (a.role) entry.role = ROLES[a.role];
  if (a.recursion !== undefined) entry.excludeRecursion = !a.recursion;
  if (a.order !== undefined) entry.order = a.order;
  return {book, uid: entry.uid};
}

/** Older turns get folded into a running summary once the conversation is long. */
export function needsCompaction(messages, keep = 16, limit = 30) {
  return (messages || []).length > limit ? messages.length - keep : 0;
}
export function compactionPrompt(previousSummary, oldMessages) {
  return `Update the running summary of a conversation between a writer and their SillyTavern assistant. Keep decisions, preferences, facts about their setup and story, open questions, and what was changed. Drop small talk. At most 300 words.\n\nCurrent summary:\n${previousSummary || '(none)'}\n\nMessages to fold in:\n${oldMessages.map(m => `${m.role === 'user' ? 'Writer' : 'Assistant'}: ${m.content}`).join('\n\n')}\n\nReply with only the new summary.`;
}
