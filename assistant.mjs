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
Changes to how Storyloom itself works (see STORYLOOM'S OWN SETTINGS AND TEXTS in the snapshot for every id, what it does and its current value):
=== ACTION: edit-text
TEXT: an id from the list (narrator-main, narrator-post-history, narrator-card, prompt:…, team:…, template:…)
FIND:
the exact words to change, copied character for character from the current text in the snapshot (leave FIND out to add the new words at the end)
REPLACE:
the new words
=== END
=== ACTION: set-option
NAME: an option id from the list
VALUE: one of the values the list gives for it
=== END
=== ACTION: set-team-member
ROLE: checker | editor | reader
ENABLED: yes | no
=== END
=== ACTION: set-memory
ITEM: sofar | previously | session | scene | chapter | outline | premise
WHERE: off | top | system-end | chat-start | chat-depth
DEPTH: number (only with chat-depth)
ROLE: system | user
=== END
What the writer changes this way becomes their own default: every book, Writing setup and later Storyloom updates use their version (Storyloom offers its own improvements later; it never overwrites theirs). One edit-text card per change, each as small as the change: one sentence or one rule, never a whole text rewritten. Before you propose one, find the sentence that causes what the writer describes and quote it in FIND exactly. If what they want is a setting, use set-option instead of editing a text.
When the writer asks you to change their book or setup, make the change yourself as cards — don't tell them how to do it by hand. Explain manual steps only for things no card can do (sliders, connections, other characters).
TITLE for edit-entry and set-placement must be copied exactly from the list of entries in the snapshot; never guess or invent a title. Anything that isn't in that list yet is add-entry.
To add a person to the book (the writer included, if they ask to be in it): add-entry titled “Character — Full Name”, KEYS their full name, first name and nicknames, CONTENT starting with the line “[Character — Full Name]”, then a full profile under these headings: ROLE IN THE STORY, BASICS, APPEARANCE, PERSONALITY, WANTS AND NEEDS, FLAWS AND FEARS, RELATIONSHIPS, VOICE AND MANNERISMS (how they talk, described — no quoted sample lines and no habits or gestures, because the narrator copies and repeats whatever a profile lists), and KEPT HIDDEN if they hide something. Build it from what the writer tells you and what the book already says; if you don't know who they want to be, ask one short question first. The narrator and Storyloom's checks pick a new person up from their entry.
The writer sees each block as a card with an Apply button; nothing changes until they click it, and the old version is backed up first. Never claim you changed anything yourself. Preset changes only ever touch the “Storyloom Novel” preset, never the writer's own presets: if it doesn't exist yet, tell them to use Writing setup… on the Memory tab. Never propose changes to SillyTavern settings outside these (sliders, connections, other characters) — explain where the writer can change those instead. Never put documentation text into a story lorebook.`;

/** How Storyloom itself delivers its entries; the assistant must not "fix" these. */
const STORYLOOM_DESIGN = `How Storyloom sets up a novel's lorebook (deliberate — never suggest changing it):
- Entries marked "managed by Storyloom" are switched off in the lorebook ON PURPOSE. Planning notes (scale, cast index) are off because the prose doesn't need them. The full outline, "Current Chapter", "Story so far" and "Previously" are sent by Storyloom itself as injected prompts, each wrapped in an instruction (the outline's says to use it for direction and never write ahead) (Storyloom panel → Memory tab, where the writer chooses position and role). "Current Writing Directive" reaches the chat through the Author's Note, which Storyloom keeps in sync. Switching any of these on would send them twice.
- Character and place entries are keyword entries that other entries cannot trigger (excludeRecursion), so they arrive only when named in recent messages or matched by Vector Storage.
- To change what the story sees each chapter, the writer uses the Memory tab or the chapter picker, not these entries' settings.
- Never propose cards for entries managed by Storyloom; they will be refused. Point the writer to the Memory tab or the Author's Note instead.
- Long entry texts in the snapshot may be shortened for space; a marked "[…shortened here…]" is not a problem in the real entry. Never put a shortened text into an edit-entry card — you would cut the real entry short. If you only see part of an entry, describe the change in words instead.`;

/** How Storyloom sets up the story chat for writing — the assistant's map of it. */
const STORYLOOM_SETUP = `HOW STORYLOOM SETS UP WRITING (based on research — details in the STORYLOOM KNOWLEDGE excerpts and docs/ai-prompting-research.md)
Every SillyTavern slot is just text placed somewhere in one long prompt; what matters is what it says, where it sits and its role. The top frames the job and holds reference, the end is followed most strongly, the middle is easily lost. Roles matter by model: DeepSeek moves every system message to the top, Claude and Gemini get mid-chat system text turned into user text, so Storyloom sends instructions for the reply as user, near the end; assistant is only ever the model's own prose.
The narrator receives, in order:
1. The “Storyloom Novel” preset's Main Prompt (system, top): how to write a book, written to the model about the model — what language models get wrong in fiction (rushing, frictionless conflict, named feelings, one shared voice, echoed dialogue, stock phrases, wrap-up endings) and what to do instead — plus a map of the labelled parts of its prompt and which wins when two disagree (the writer's latest message, then this chapter's plan, then SCENE NOW, then PREVIOUSLY, then STORY SO FAR; the book's facts and the writer's rules always hold).
2. BOOK REFERENCE: the book's foundation (sent by Storyloom as “The book”, without the milestones, arcs and ending — models foreshadow what they see) and the lorebook entries, labelled by the preset's World Info format; each entry's first line names what it describes. Characters and places arrive when named in the chat or in the chapter plan / hand-off / scene, which SillyTavern scans.
3. The general narrator card (“Storyloom Narrator”): HOW THIS BOOK IS TOLD — narrator, point of view, tense, voice, tone, genre, the writer's rules — filled from this chat's book settings ({{getvar::storyloom_…}}); a chapter can override them.
4. STORY SO FAR (reference, top of the chat), then PREVIOUSLY (the last chapter's hand-off, as user), THIS CHAPTER (this chapter's plan plus one line per later chapter so it isn't used up) and SCENE NOW (as user, just before the chapter).
5. WHAT TO WRITE NOW (as user, last): the chapter number, its length, the end-of-chapter signal; then the Post-History reminder (as user).
The whole outline is off by default (Memory tab). With the general narrator, the writing directive is kept in the Author's Note as a record but not sent (its insertion frequency is 0), because the card and THIS CHAPTER carry it.
When the writer wants better prose, look for the cause in this order: the latest replies (the model imitates them), the end of the prompt (WHAT TO WRITE NOW and Post-History), the chapter plan, the character entries, then the Main Prompt. Say what you'd change and why, and propose it as a card.`;

/** What each of Storyloom's own prompts is for, so the Assistant changes the right one. */
export const PROMPT_PURPOSE = Object.freeze({
  persona: 'Who Storyloom is when it plans a book with the writer (the Story tab chat).',
  newEntries: 'When the planner may add lorebook entries or headings beyond the planned ones.',
  simple: 'Simple mode: how the wizard asks its questions and acknowledges answers.',
  deep: 'Deep mode: how the planning partner discusses the book topic by topic.',
  ongoing: 'How the Story tab chat behaves after the plan exists.',
  fill: 'Building the plan (foundation, voice, people, places) from the writer’s answers.',
  outlineStyle: 'How the chapter outline is written — what each chapter plan holds.',
  review: 'The fresh-eyes review of the whole plan before writing starts.',
  profileStyle: 'How character profiles are written (what the narrator reads about each person).',
  assistant: 'Your own instructions on the Assistant tab.',
  chapterEnd: 'Finishing a chapter: the seal note and the Story So Far hand-off.',
  background: 'Following the main chat in the background (scene card, running summary).',
});
/** Storyloom options the Assistant may change: id → {values | number:[min,max], what, book?}. */
export const OPTIONS = Object.freeze({
  'how-chapters-get-written': {label: 'How chapters get written', values: ['all-at-once', 'bit-by-bit'], what: 'All at once: one press of Write gives the whole chapter. Bit by bit: each press writes the next part, and the writer steers in between.'},
  'chapter-length': {label: 'Chapter length', number: [0, 30000], what: 'Words per chapter for this book (0 = the length from the book’s plan).', book: true},
  'words-per-press': {label: 'Words each time you press Write', number: [100, 5000], what: 'Bit by bit only: about how many words each press of Write gives.'},
  'keep-going': {label: 'Keep going by itself', values: ['on', 'off'], what: 'All at once: if the narrator stops before the chapter’s end, Storyloom presses Continue by itself.'},
  'keep-going-max': {label: 'Keep going: how many times', number: [1, 20], what: 'How many times Keep going may press Continue in a row.'},
  'scene-card': {label: 'Keep track of the current scene', values: ['on', 'off'], what: 'Keep a card of the current scene (where, when, who is there and in what shape) and send it with each reply.'},
  'scene-every': {label: 'Scene card: update every', number: [1, 20], what: 'Bit by bit: update the scene card every this many replies.'},
  'chapter-summary': {label: 'Keep a summary of this chapter so far', values: ['on', 'off'], what: 'Bit by bit: keep a running summary of the chapter so far, so a long chapter remembers its start.'},
  'chapter-summary-every': {label: 'Chapter summary: update every', number: [6, 100], what: 'Update that summary every this many messages.'},
  'everyone-in-scene': {label: 'Remind the narrator about everyone in the scene', values: ['on', 'off'], what: 'Send the lorebook entries of everyone in the scene with each reply, even if nobody said their name lately.'},
  'faster-checks': {label: 'Make Storyloom’s checks faster', values: ['on', 'off'], what: 'Storyloom’s own checks (Lint, Seal, planning) think less, so they take seconds. The story itself is never affected.'},
  'send-reasoning-effort': {label: 'Use my Reasoning Effort setting with Venice and similar', values: ['on', 'off'], what: 'Send the writer’s Reasoning Effort setting to Venice and similar connections (SillyTavern normally leaves it out there).'},
});
export const TEAM = Object.freeze(['checker', 'editor', 'reader', 'seal']);
/** What testing showed the narrator model does whatever its prompt says — so the Assistant doesn't promise a wording fix for it. */
const KNOWN_LIMITS = `What testing showed (2026-11, DeepSeek V4 Flash and similar), so you can be honest about it:
- Characters saying each other's words back happens in nearly every chapter whatever the Main Prompt and Post-History say. Storyloom's Lint echo check finds it and Revise fixes it after the draft — that's the working fix, not more wording.
- The narrator copies any line written in a profile into the story word for word, and repeats any habit or gesture a profile lists. Profiles describe how people talk instead of quoting them (Lint flags a copied line).
- A rule the narrator keeps breaking is better enforced by a check after the draft than by a stronger or louder rule: capital letters and "CRITICAL" make models over-apply a rule.
- When you write into the narrator's texts or a profile, say what to do instead of quoting an example of the bad habit: a quoted bad line makes the model more likely to write it.`;

/** The Storyloom part of the snapshot: every option, team member and text the Assistant can change, with current values. */
export function formatStoryloom(s) {
  if (!s) return '';
  const lines = ["STORYLOOM'S OWN SETTINGS AND TEXTS (what set-option, set-team-member, set-memory and edit-text change; “yours” = the writer changed it, “Storyloom’s” = the built-in text)"];
  lines.push('Options:');
  for (const [id, o] of Object.entries(OPTIONS)) lines.push(`- ${id} (“${o.label}” in Settings) = ${s.options?.[id] ?? '?'} (${o.values ? o.values.join(' | ') : `a number ${o.number[0]}–${o.number[1]}`}; ${o.book ? 'this book only' : 'all books'}) — ${o.what}`);
  if (s.memory?.length) lines.push(`Memory items (set-memory, this book): ${s.memory.map(m => `${m.key} = ${m.where}${m.where === 'chat-depth' ? ` depth ${m.depth}` : ''} as ${m.role} (${m.label})`).join('; ')}`);
  lines.push(`The chapter team: ${(s.team || []).map(t => `${t.role} (${t.label}) ${t.enabled ? 'on' : 'off'}`).join(', ')}. Lint and Seal always run; set-team-member switches the Editor or Reader off or on.`);
  lines.push('Texts (edit-text TEXT ids), each with its current wording:');
  for (const t of s.texts || []) lines.push(`--- ${t.id} — ${t.label} [${t.yours ? 'yours' : 'Storyloom’s'}] — ${t.what}\n${t.text}`);
  return lines.join('\n');
}

export function assistantSystem() {
  return `${P('assistant')}\n\n${STORYLOOM_SETUP}\n\nYou are given (1) a snapshot of the writer's live SillyTavern setup, (2) excerpts from the official SillyTavern documentation chosen for this question, and (3) the conversation so far. Base answers about how SillyTavern works on the documentation excerpts and name the page you used, like (Docs: Usage › worldinfo). Base answers about the writer's setup on the snapshot. Assistants built on language models fail in known ways: they answer confidently when the documents don't cover the question, and they invent setting names, buttons and options that don't exist. So: if the excerpts and the snapshot don't cover something, say so plainly instead of guessing; never name a setting, button, macro or option you didn't find in them; and say whether a behaviour comes from Storyloom, from SillyTavern itself, or from the model or provider. If the writer's goal is unclear, ask one short question.\n\nYou can change anything in Storyloom the writer could change by hand — how the narrator writes, what each member of the chapter team does, what the wizard asks and builds, every Storyloom setting, the Memory tab, the book's lorebook — always as cards they approve. When the writer says something doesn't work the way they want, find what causes it (a text, an option, an entry), say so in a sentence, and propose the smallest change that fixes it.\n\n${KNOWN_LIMITS}\n\n${STORYLOOM_DESIGN}\n\n${ACTION_FORMAT}`;
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
  if (s.persona) lines.push(`The writer's SillyTavern persona (who they are in chats): ${s.persona}`);
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
  if (s.storyloom) lines.push(formatStoryloom(s.storyloom));
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
    cur.content = inContent === true || (inContent && cur.contentLines.length) ? cur.contentLines.join('\n').trim() : undefined;
    if (cur.findLines) cur.find = cur.findLines.join('\n').trim();
    if (cur.replaceLines) cur.replace = cur.replaceLines.join('\n').replace(/^\n+|\s+$/g, '');
    delete cur.contentLines; delete cur.findLines; delete cur.replaceLines;
    try { actions.push(normalizeAction(cur)); } catch (e) { problems.push(e.message); }
    cur = null; inContent = false;
  };
  for (const line of lines) {
    const start = line.match(/^[\s*_#>]*=+\s*ACTION\s*:\s*([a-z-]+)/i);
    if (start) { finish(); cur = {type: start[1].toLowerCase(), contentLines: []}; continue; }
    if (cur && /^[\s*_#>]*=+\s*END\b/i.test(line)) { finish(); continue; }
    if (!cur) { reply.push(line); continue; }
    const f = line.match(FIELD);
    // edit-text: FIND and REPLACE are multi-line; each runs until the next of the two (or the end of the card).
    if (f && (f[1] === 'FIND' || f[1] === 'REPLACE') && cur.type === 'edit-text') { inContent = f[1].toLowerCase(); cur[inContent + 'Lines'] = f[2].trim() ? [f[2]] : []; continue; }
    if (inContent === 'find' || inContent === 'replace') { cur[inContent + 'Lines'].push(line); continue; }
    if (inContent) { cur.contentLines.push(line); continue; }
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
  'edit-text': a => {
    const id = String(a.text || '').trim();
    if (!/^(narrator-(main|post-history|continue-nudge|new-chat|card)|prompt:[A-Za-z]+|team:(checker|editor|reader|seal)|template:.+)$/.test(id)) throw Error(`edit-text needs TEXT: one of the ids in the snapshot (got “${id || 'nothing'}”).`);
    if (/^prompt:/.test(id) && !PROMPT_PURPOSE[id.slice(7)]) throw Error(`There is no Storyloom prompt “${id.slice(7)}”.`);
    if (a.replace === undefined) throw Error(`edit-text (${id}) needs REPLACE.`);
    if (!a.find && !String(a.replace).trim()) throw Error(`edit-text (${id}) has nothing to change.`);
    return {type: a.type, text: id, find: a.find || '', replace: a.replace};
  },
  'set-option': a => {
    const name = String(a.name || '').trim().toLowerCase(), o = OPTIONS[name], v = String(a.value ?? a.content ?? '').trim().toLowerCase();
    if (!o) throw Error(`set-option needs NAME: one of ${Object.keys(OPTIONS).join(', ')}.`);
    if (o.values && !o.values.includes(v)) throw Error(`${name} must be ${o.values.join(' or ')}.`);
    if (o.number) { const n = Number(v); if (!Number.isFinite(n) || n < o.number[0] || n > o.number[1]) throw Error(`${name} must be a number from ${o.number[0]} to ${o.number[1]}.`); return {type: a.type, name, value: Math.round(n)}; }
    return {type: a.type, name, value: v};
  },
  'set-team-member': a => { const r = String(a.role || '').toLowerCase(); if (!['checker', 'editor', 'reader'].includes(r)) throw Error('set-team-member needs ROLE: checker, editor or reader (Lint and Seal always run).'); if (r === 'checker') throw Error('Lint (the Checker) always runs; its findings can be unticked instead.'); return {type: a.type, role: r, enabled: /^y|^on|^true/i.test(a.enabled || '')}; },
  'set-memory': a => {
    const item = String(a.item || '').toLowerCase(), where = String(a.where || '').toLowerCase();
    if (!['sofar', 'previously', 'session', 'scene', 'chapter', 'outline', 'premise'].includes(item)) throw Error('set-memory needs ITEM: sofar, previously, session, scene, chapter, outline or premise.');
    if (!['off', 'top', 'system-end', 'chat-start', 'chat-depth'].includes(where)) throw Error('set-memory needs WHERE: off, top, system-end, chat-start or chat-depth.');
    const depth = a.depth === undefined || a.depth === '' ? undefined : Number(a.depth); if (depth !== undefined && (!Number.isInteger(depth) || depth < 0 || depth > 100)) throw Error('DEPTH must be a whole number.');
    const role = a.role ? String(a.role).toLowerCase() : undefined; if (role && !['system', 'user'].includes(role)) throw Error('ROLE must be system or user.');
    return {type: a.type, item, where, depth, role};
  },
};
/**
 * Change one stretch of a text: FIND must occur exactly once (quote kinds, dashes and spacing may differ); an empty FIND adds REPLACE at the end.
 * Returns the new text or throws a message the writer can read.
 */
export function applyTextEdit(text, find, replace) {
  const t = String(text ?? '');
  if (!String(find || '').trim()) return `${t.replace(/\s+$/, '')}\n${replace}`;
  const re = new RegExp(String(find).trim().replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/[“”"]/g, '[“”"]').replace(/[‘’']/g, "[‘’']").replace(/[—–]|--/g, '(?:—|–|--)').replace(/\s+/g, '\\s+'), 'g');
  const hits = [...t.matchAll(re)];
  if (hits.length !== 1) throw Error(hits.length ? `The words to change appear ${hits.length} times; the card needs a longer, unique quote. Nothing was changed.` : 'The words to change aren’t in the current text (it may have changed since the Assistant read it). Nothing was changed — ask again.');
  return t.slice(0, hits[0].index) + replace + t.slice(hits[0].index + hits[0][0].length);
}
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

const TEXT_LABEL = id => ({'narrator-main': 'the narrator’s Main Prompt', 'narrator-post-history': 'the narrator’s Post-History reminder', 'narrator-continue-nudge': 'the continue nudge', 'narrator-new-chat': 'the new-chat marker', 'narrator-card': 'the narrator card'})[id]
  || (/^prompt:/.test(id) ? `Storyloom’s “${id.slice(7)}” prompt` : /^team:/.test(id) ? `the ${id.slice(5)}’s personality and standing instructions` : /^template:/.test(id) ? `the “${id.slice(9)}” template` : id);
/** Human-readable summary of what Apply will do. */
const PROMPT_LABELS = {main: 'Main Prompt', 'post-history': 'Post-History Instructions', 'continue-nudge': 'continue nudge', 'new-chat': 'new chat prompt', auxiliary: 'Auxiliary Prompt', 'enhance-definitions': 'Enhance Definitions'};
export function describeAction(a) {
  if (a.type === 'set-preset-prompt') return `Change the ${PROMPT_LABELS[a.prompt]} of the “Storyloom Novel” preset`;
  if (a.type === 'toggle-prompt') return `Turn ${a.enabled ? 'on' : 'off'} ${PROMPT_LABELS[a.prompt]} in the “Storyloom Novel” preset`;
  if (a.type === 'set-book-setting') return `Set this ${a.scope === 'book' ? 'book' : 'chapter'}’s ${a.name} to “${a.content.slice(0, 80)}${a.content.length > 80 ? '…' : ''}”${a.scope === 'book' ? ' (also saved in “Voice and Boundaries”)' : ''}`;
  if (a.type === 'set-narrator-card') return 'Change the general narrator card’s description';
  if (a.type === 'edit-text') return `${a.find ? 'Change' : 'Add to'} ${TEXT_LABEL(a.text)}: ${a.find ? `“${a.find.slice(0, 70)}${a.find.length > 70 ? '…' : ''}” → ` : ''}“${String(a.replace).slice(0, 90)}${String(a.replace).length > 90 ? '…' : ''}” (becomes your default)`;
  if (a.type === 'set-option') { const o = OPTIONS[a.name]; const v = a.value === 'on' ? 'on' : a.value === 'off' ? 'off' : String(a.value).replace(/-/g, ' '); return `Settings: “${o?.label || a.name}” → ${v}${o?.number && a.name !== 'keep-going-max' ? (/every/.test(a.name) ? '' : ' words') : ''} (${o?.book ? 'this book' : 'all books'})`; }
  if (a.type === 'set-team-member') return `Turn the ${a.role === 'editor' ? 'Editor' : 'Reader'} ${a.enabled ? 'on' : 'off'}`;
  if (a.type === 'set-memory') return `Memory tab: send “${a.item}” ${a.where === 'off' ? 'nowhere (off)' : `at ${a.where}${a.depth !== undefined ? ` depth ${a.depth}` : ''}${a.role ? ` as ${a.role}` : ''}`}`;
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
    if (matches.length !== 1) throw Error(matches.length ? `“${a.book}” has more than one “${a.title}”.` : `“${a.book}” has no entry called “${a.title}” — the Assistant got the name wrong. Nothing was changed. Ask it again: it can only edit entries that exist, and anything new is added as a new entry.`);
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
