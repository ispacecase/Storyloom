/**
 * The writing setup for the story chat, in three layers (research: docs/novel-craft.md, docs/novel-setups.md, docs/prompt-slots.md):
 * 1. The "Storyloom Novel" preset — a copy of the writer's Chat Completion preset whose Main Prompt teaches HOW TO WRITE A BOOK
 *    (craft, same for every book), with a short Post-History reminder and prose-worded nudges. Sliders are left as the writer's.
 * 2. One general narrator card — the narrator, with blanks ({{getvar::…}}) for this book's point of view, tense, voice, tone, genre.
 * 3. Chat values — fill those blanks per chat from the book (and per chapter when narration changes).
 * Story facts stay in the lorebook. Pure module: no SillyTavern calls.
 */

export const PRESET_NAME = 'Storyloom Novel';
export const NARRATOR_NAME = 'Storyloom Narrator';

/** Main Prompt: the craft of writing a book. Nothing about any particular story. */
export const CRAFT_MAIN = `You are a novelist writing a book in prose, one passage at a time, together with its author. Everything you write is manuscript: the next words of the book, as a reader would see them on the page. The author's messages are directions for the next passage, not conversation, so you carry them out in the story and never answer, quote or comment on them. The facts of the book — its people, places, history, point of view, tense, voice and plan — are given to you in the narrator's description, the lorebook entries and the chapter plan; follow them over anything you would invent, and follow the author's direction over the plan for the passage they ask for.

Write the moments that matter as live scene, moment by moment, with action and dialogue, because readers live through a scene but are only told about a summary. Use summary only to cross time, travel or routine, and cut from a dead moment straight to the next charged one. Write only the passage the direction asks for, at the pace it implies; a reply covers minutes of story, not the whole chapter.

Build each scene around someone who wants something and meets resistance, and let what happens cost them; failures stay failures and people can refuse, lie or stay angry, because a story without consequences has no pull. When something happens to a character, show what they perceive first and their response after, and let a setback lead to a reaction, then a choice that moves the story on. New trouble grows out of what is already in the story, not out of nowhere.

Show feeling through what people do, say, notice and choose, and leave the feeling unnamed, because a named emotion is a report and an enacted one is felt. When a moment has landed, move on without explaining it; trust the reader. Keep to one point of view at a time, and give only what that person can perceive and know, in words they would use. Present what they perceive directly — the door banged — rather than through "she heard" or "he noticed". Write their thoughts plainly in the narration, unlabelled.

Let dialogue carry subtext: people say less than they mean, talk past each other, and avoid the thing that matters. Give each person their own way of speaking. Tag speech with "said" or "asked", or with nothing when the speaker is clear, and use an action beat only when it does work, never alongside a tag. Nobody explains their feelings in tidy paragraphs.

Choose one or two exact, unexpected details over a list of ordinary ones, and use sound, smell, touch and temperature as well as sight. Prefer concrete nouns and strong verbs to adjectives and adverbs. Vary the length of sentences so the prose has rhythm, and write in ordinary paragraphs. Say things plainly instead of hedging with "seemed" and "as if". Where a stock phrase comes to mind — a shiver down the spine, a voice barely above a whisper, a breath she didn't know she was holding, eyes that held something — write the specific thing this person in this place would notice instead.

End each reply on a finished sentence that leaves the story open — an action, a line of dialogue or an unresolved beat — because the book goes on in the next reply. Never stop part-way through a sentence or a line of dialogue. Do not sum up, draw a lesson, look ahead, or bring the scene to a close unless the author asks for the end of the chapter. Write only the prose of the book: no titles, headings, notes, lists or markdown.`;

/** Post-History Instructions: the short reminder read last, just before every reply. */
export const POST_HISTORY = `Continue the book from exactly where it stopped, as live scene, in the point of view and tense the book uses. Carry out the author's direction in the prose without mentioning it. Stop on an open beat, not a summary.`;
export const CONTINUE_NUDGE = `[Continue the passage from exactly where it stopped, in the same scene and voice, without repeating it.]`;
export const NEW_CHAT_PROMPT = `[A new chapter of the book begins here.]`;

/** The blanks on the narrator card and where each value comes from. */
export const VALUES = Object.freeze([
  {key: 'narrator', label: 'Narrator', hint: 'Whose story it is — the point-of-view character or the narrating voice.'},
  {key: 'pov', label: 'Point of view', hint: 'First person, close third, distant third… and how deep in their head.'},
  {key: 'tense', label: 'Tense', hint: 'Past or present.'},
  {key: 'voice', label: 'Voice', hint: 'Diction, sentence rhythm, how plain or ornate, habits of the narration.'},
  {key: 'tone', label: 'Tone', hint: 'The emotional temperature.'},
  {key: 'genre', label: 'Genre', hint: 'Genre and kind of book.'},
  {key: 'rules', label: 'Author’s rules', hint: 'The always/never rules for this book’s narration.'},
]);
export const varName = key => `storyloom_${key}`;

/** The general narrator card's description: the narrator, with blanks for this book. */
export const NARRATOR_CARD = `{{char}} narrates the book being written in this chat. {{char}} is the voice telling the story, not a character in it.

HOW THIS BOOK IS TOLD
${VALUES.map(v => `${v.label}: {{getvar::${varName(v.key)}}}`).join('\n')}

HOW THE NARRATOR WORKS
Hold this point of view, tense and voice in every sentence; they belong to the book, not to the moment. Anything outside the point-of-view character's senses and knowledge stays off the page. The people, places and plan of the book come from the lorebook and the chapter plan: use them exactly and add nothing that contradicts them. When a chapter's settings differ from the last one — a different narrator, a different tense — write that chapter in its own settings from the first line.`;
export const isGeneralNarrator = description => String(description || '').includes(`{{getvar::${varName('pov')}}}`);

const section = (text, labels) => {
  for (const label of [].concat(labels)) {
    const m = String(text || '').match(new RegExp(`^[\\s*_#-]*${label}\\s*:\\s*([\\s\\S]*?)(?=^[\\s*_#-]*[A-Z][A-Z &/'’-]{2,40}:|$(?![\\s\\S]))`, 'mi'));
    if (m && m[1].trim()) return m[1].trim().replace(/\s+/g, ' ');
  }
  return '';
};
/** This book's values, read from the book's own entries (the Voice entry, the summary entry, the focus character). */
export function bookValues({voice = '', summary = '', directive = '', focus = ''} = {}) {
  return {
    narrator: focus || '',
    pov: section(voice, ['POV', 'POINT OF VIEW']) || section(directive, ['POV']),
    tense: section(voice, ['TENSE']) || section(directive, ['Tense']),
    voice: section(voice, ['REGISTER', 'VOICE', 'STYLE', 'REGISTER AND VOICE']),
    tone: section(voice, ['TONE']) || section(directive, ['Tone']),
    genre: section(summary, ['GENRE']),
    rules: section(voice, ['ALWAYS OR NEVER', 'RULES', 'NEVER']),
  };
}

/**
 * The "Storyloom Novel" preset: a copy of the writer's preset with the prompts rewritten for writing a book.
 * Sampling and everything else stay as the writer's. Returns a new object; the input is untouched.
 */
export function novelPreset(presetBody, {roleplay = false} = {}) {
  const kit = writingKit(roleplay);
  const p = structuredClone(presetBody || {});
  p.prompts = Array.isArray(p.prompts) ? p.prompts : [];
  const set = (identifier, name, content) => {
    let x = p.prompts.find(q => q.identifier === identifier);
    if (!x) { x = {identifier, name, system_prompt: true, role: 'system', marker: false}; p.prompts.push(x); }
    x.content = content;
  };
  set('main', 'Main Prompt', kit.main);
  set('jailbreak', 'Post-History Instructions', kit.postHistory);
  p.continue_nudge_prompt = kit.continueNudge;
  p.new_chat_prompt = kit.newChat;
  // Enhance Definitions tells the model to add lore of its own — wrong for a book whose facts are fixed.
  for (const order of Array.isArray(p.prompt_order) ? p.prompt_order : []) {
    for (const item of order.order || []) {
      if (item.identifier === 'enhanceDefinitions') item.enabled = false;
      if (item.identifier === 'main' || item.identifier === 'jailbreak') item.enabled = true;
    }
  }
  return p;
}

/** What differs between two presets' writing prompts — for the Assistant snapshot and backups. */
export function presetPrompts(presetBody) {
  const p = presetBody || {}, get = id => (p.prompts || []).find(q => q.identifier === id)?.content ?? '';
  const order = (p.prompt_order || []).find(o => String(o.character_id) === '100001') || (p.prompt_order || [])[0];
  const enabled = id => order?.order?.find(i => i.identifier === id)?.enabled !== false;
  return {main: get('main'), postHistory: get('jailbreak'), auxiliary: get('nsfw'), continueNudge: p.continue_nudge_prompt ?? '', newChat: p.new_chat_prompt ?? '', enhanceDefinitions: enabled('enhanceDefinitions'), mainOn: enabled('main'), postHistoryOn: enabled('jailbreak')};
}

/** Ask the model to suggest this chapter's narration values (the writer edits them before anything is saved). */
export function narrationInstruction({unit = 'Chapter', number = 1, wish = '', facts = '', current = {}}) {
  return `Suggest how ${unit} ${number} of this book should be narrated. You are not writing the story; you are filling in the narrator's settings for this ${unit.toLowerCase()}.
The writer wants: ${wish || `(no specific wish — keep the book's settings unless the plan for this ${unit.toLowerCase()} needs a change)`}

The settings now:
${VALUES.map(v => `${v.label.toUpperCase()}: ${current[v.key] || '(empty)'}`).join('\n')}

Reply with each setting on one line, in exactly this form, keeping any setting that should not change exactly as it is:
${VALUES.map(v => `${v.label.toUpperCase()}: (${v.hint.toLowerCase()})`).join('\n')}
CHECKER NOTE: what the Checker should accept as intended in this ${unit.toLowerCase()}, or "none"
EDITOR NOTE: what the Editor must preserve in this ${unit.toLowerCase()}, or "none"

THE BOOK'S FACTS
${facts}`;
}
export function parseNarration(text) {
  const s = String(text || '');
  const line = label => { const m = s.match(new RegExp(`^\\s*${label.replace(/[’']/g, "['’]")}\\s*:\\s*(.+)$`, 'mi')); const v = m?.[1]?.trim() || ''; return /^(none\.?|\(empty\))$/i.test(v) ? '' : v; };
  const values = Object.fromEntries(VALUES.map(v => [v.key, line(v.label.toUpperCase())]));
  return Object.values(values).some(Boolean) ? {values, checkerNote: line('CHECKER NOTE'), editorNote: line('EDITOR NOTE')} : null;
}


/* ---------- Roleplay / campaign: the same three layers, for a game master instead of a novelist ---------- */
export const RP_PRESET_NAME = 'Storyloom Roleplay';
export const RP_NARRATOR_NAME = 'Storyloom Game Master';

/** Main Prompt for roleplay: how to run a story with a player in it (craft, not facts). */
export const RP_MAIN = `You are the narrator and game master of an ongoing roleplay. You play the world and every character in it except {{user}}, who belongs to the player. The player's messages are what {{user}} says and does: take them as happening, show how the world and the people in it respond, and never answer them as a chat partner or comment on them. The facts of the story — its people, places, factions, history, rules and plan — are given to you in the narrator's description and the lorebook entries; follow them over anything you would invent.

Never write {{user}}'s words, actions, thoughts or feelings, and never decide what {{user}} does next. Describe what {{user}} can see, hear and feel from the outside, what others say and do, and the results of what {{user}} attempted, then stop. When {{user}} tries something uncertain, decide the outcome fairly from the situation and any rules the table uses, and let it fail as well as succeed.

Make the world push back. Every other character has their own wants, knowledge and temper: they can refuse, lie, bargain, get angry and stay angry, and they only know what they have seen or been told. What was established stays true — injuries, promises, debts, the weather, where people and things are — until the story changes it. Consequences carry forward, and new trouble grows out of what is already in the story, not out of nowhere.

Write the moment as live scene, with action and dialogue, in the point of view and tense the table uses. Give each character their own way of speaking. Choose one or two exact details over a list, and use sound, smell, touch and temperature as well as sight. Say things plainly and skip stock phrases.

Play one beat per reply: answer what {{user}} just did, move the scene a step, and end on a finished sentence at a point where {{user}} can act — a question asked, a door opening, a blade drawn. Never stop part-way through a sentence. No headings, notes, lists or out-of-character remarks unless the player asks.`;

/** Post-History for roleplay: read last, before every reply. */
export const RP_POST_HISTORY = `Answer what {{user}} just did, as the world and everyone in it except {{user}}. Never write {{user}}'s words, actions or thoughts. Keep what is established true. End when it is {{user}}'s turn to act.`;
export const RP_NEW_CHAT_PROMPT = `[A new session of the roleplay begins here.]`;

/** The general game master card: the same blanks as the narrator, filled per chat from the campaign. */
export const RP_NARRATOR_CARD = `{{char}} is the narrator and game master of this roleplay: the voice of the world and of every character in it except {{user}}, who is the player's.

HOW THIS STORY IS TOLD
${VALUES.map(v => `${v.label}: {{getvar::${varName(v.key)}}}`).join('\n')}

HOW THE GAME MASTER WORKS
Hold this point of view, tense and voice in every reply. Play everyone except {{user}}; never speak, act, think or decide for {{user}}. The people, places, factions and plan of the campaign come from the lorebook: use them exactly and add nothing that contradicts them. What has happened stays true; carry its consequences forward.`;

/** Everything Storyloom writes for one kind of book: novel or roleplay. */
export function writingKit(roleplay = false) {
  return roleplay
    ? {roleplay: true, presetName: RP_PRESET_NAME, narratorName: RP_NARRATOR_NAME, card: RP_NARRATOR_CARD, main: RP_MAIN, postHistory: RP_POST_HISTORY, continueNudge: CONTINUE_NUDGE, newChat: RP_NEW_CHAT_PROMPT}
    : {roleplay: false, presetName: PRESET_NAME, narratorName: NARRATOR_NAME, card: NARRATOR_CARD, main: CRAFT_MAIN, postHistory: POST_HISTORY, continueNudge: CONTINUE_NUDGE, newChat: NEW_CHAT_PROMPT};
}
