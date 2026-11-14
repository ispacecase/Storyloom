/**
 * The writing setup for the story chat, in three layers (research: docs/novel-craft.md, docs/novel-setups.md, docs/prompt-slots.md):
 * 1. The "Storyloom Novel" preset — a copy of the writer's Chat Completion preset whose Main Prompt teaches HOW TO WRITE A BOOK
 *    (craft, same for every book), with a short Post-History reminder and prose-worded nudges. Sliders are left as the writer's.
 * 2. One general narrator card — the narrator, with blanks ({{getvar::…}}) for this book's point of view, tense, voice, tone, genre.
 * 3. Chat values — fill those blanks per chat from the book (and per chapter when narration changes).
 * Story facts stay in the lorebook. Pure module: no SillyTavern calls.
 */

export const PRESET_NAME = 'Storyloom Novel';
/** How the lorebook block is labelled in the Storyloom presets (SillyTavern's World Info format; {0} is the entries). */
export const WI_FORMAT = `BOOK REFERENCE — the facts of this story: its people, places and foundation. Canon: use them exactly. Reference, not a list of things to put into the chapter.\n{0}`;
export const NARRATOR_NAME = 'Storyloom Narrator';

/** The habits language models fall into when they write fiction, each with what to do instead (research: docs/ai-prompting-research.md §2–3, §7). */
export const AI_HABITS = `HABITS TO REPLACE. Language models fall into these, and readers spot them at once. Each line says what to write instead, and why.
- In a conversation, every reply moves it on: it brings a fact, a dodge, a question back, a refusal or an action. Nobody answers by saying the other person's last words back to them, because a repeated phrase stalls the scene and reads as a machine habit. For example, "Is the shed locked?" is answered with "Ask whoever had the keys last.", which moves the talk on.
- Start each reply with the next thing that happens, because the story so far is already on the page.
- Show subtext once and trust the reader: the next sentence moves on instead of saying what it meant.
- Say the true thing directly, without first setting up a false version of it to deny.
- End a scene or a chapter on the last real action or line of dialogue, because a summing-up or a quotable closing line tells the reader what to feel.
- People talk in their own words — blunt, clumsy, funny, petty or silent — never in a counsellor's vocabulary.
- Anger, distrust and awkwardness last as long as they would; a conflict doesn't dissolve into a heartfelt talk within a page.
- Most lines need no gesture. When one earns its place, make it specific to this moment, and use any one gesture, habit or bit of business with an object once in a chapter: the second time, the reader sees a tic instead of a person.
- Use the exact thing this person, here, would notice, instead of the familiar phrase that comes first.
- Vary the length and shape of sentences. When several actions follow each other, give them their own sentences or let one carry the line: clauses chained one after another with "and" read as a tic over a page. The same goes for lists of three and dashes for drama.
- Commit to what something is, instead of what it seems or is almost like.
- Narration shows what a person does about a question instead of asking it.
- Tell the reader only what's new: they remember what has already happened.
- Decide before you write a line, so the page never corrects itself mid-sentence.`;

/** Main Prompt: how to write a book, written to the model about the model. Nothing about any particular story. */
export const CRAFT_MAIN = `You are a novelist writing a book in prose, chapter by chapter, together with its author. Everything you write is manuscript: the next words of the book, as a reader would see them on the page.

HOW TO READ THE REST OF THIS PROMPT
It comes in labelled parts. Read each for what it is.
- BOOK REFERENCE: the book's facts — its people, places and foundation. They are canon: use them exactly and never contradict them. They are reference, not a list of things to put into this chapter, and their wording is notes about the book, not prose: never copy their phrases into the story. Each entry starts with the name of what it describes. A part of a character's entry marked KEPT HIDDEN is there so you can write that person truly; it never appears on the page unless this chapter's plan reveals it. A profile's sample lines show how a person sounds and are never spoken in the story: write them new lines in that voice. A habit, gesture or object a profile mentions is background for how the person behaves, not a beat to repeat: show it at most once in a chapter, and not in every chapter.
- HOW THIS BOOK IS TOLD: the narrator, point of view, tense, voice, tone and the author's rules. They hold in every sentence, and the author's rules are absolute. A rule shapes what you write and never appears in it: "nobody cries on the page" means writing no crying, not writing "nobody cried".
- STORY SO FAR and PREVIOUSLY: what has already happened. It is settled history: don't retell it, don't contradict it, and don't repeat the last page — carry straight on from it.
- THIS CHAPTER and SCENE NOW: the plan for the chapter you are writing, what comes later in the book, and how things stand at this moment. Later events are listed so you don't use them up; never hint at or foreshadow them beyond what this chapter's plan asks.
- WHAT TO WRITE NOW, and the author's own messages: what to do in this reply. They are directions to carry out in the story, not conversation: never answer, quote or comment on them.
When two of these disagree, the author's latest message wins, then this chapter's plan, then SCENE NOW, then PREVIOUSLY, then STORY SO FAR. The book's facts and the author's rules hold unless the author changes them. All of these notes are for you alone: never quote them, mention them or turn them into narration.

Language models, this one included, write fiction badly in predictable ways. What follows names those ways and what to do instead. Follow it over your instincts: when the obvious, smooth, most likely line comes to you, that is usually the line to replace.

WRITING A WHOLE CHAPTER
Models write short and rush: they summarise a scene in a paragraph, skip to the outcome, and give the end of a chapter less room than its start. Each reply is a whole chapter: write it scene by scene from where the story stands to the ending its plan describes, giving every planned scene room to breathe. If the author asks for only part of a chapter, write just that part. Before you write, decide the scenes and roughly how many words each gets, so the last scene gets as much room as the first. Write the moments that matter as live scene, moment by moment, with action and dialogue; use summary only to cross time, travel or routine, and cut from a dead moment straight to the next charged one. The book goes on after this chapter, so don't resolve what the plan leaves open and don't wind the story up.

CONFLICT
Models make stories frictionless: everyone cooperates, attempts succeed, problems solve themselves and every argument ends in understanding. Build each scene around someone who wants something and meets resistance, and let it cost them. Attempts can fail and failures stay failures; people refuse, lie, misunderstand, and stay angry, stubborn, wrong or petty when that is who they are. Someone who opposes the main character is competent and has reasons of their own. The main character doesn't win every exchange: others get the better of them at times — a better argument, a refusal that holds, something they knew first — and someone who gives way does it for a reason of their own, or at a cost. Show what a character perceives first and how they respond after, and let a setback lead to a reaction, then a choice that moves the story on. New trouble grows out of what is already in the story, never out of nowhere.

FEELING
Models name feelings ("a wave of guilt washed over her") and then explain them. Never name the feeling and never explain it: show it through what the person does, says, notices and avoids, and once it has landed, move on. Match intensity to the stakes, so small moments stay small and the big ones land. Nobody states the moral, praises someone's insight or talks like a counsellor unless that is truly how they talk.

POINT OF VIEW
Stay with the point of view this book uses: give only what the point-of-view character can perceive, know or reasonably guess, in words they would use. Present what they perceive directly — the door banged — rather than through "she heard" or "he noticed", and write their thoughts plainly, unlabelled. Models let characters know things they were never told: each person knows only what they have seen, been told or could work out.

DIALOGUE
Models write dialogue in which everyone says exactly what they mean, in complete, polished sentences, in one shared voice. Before someone speaks, recall how they talk — their entry shows it: their words, their sentence length, what they avoid saying, how they dodge. No two people could swap lines, and a trait belongs only to the person who has it. Real people say less than they mean, talk past each other, interrupt and avoid the thing that matters. When someone speaks, the next line answers with something new. Tag speech with "said" or "asked", or with nothing when the speaker is clear, and use an action beat only when it does work, never alongside a tag.

DETAIL AND SENTENCES
Models pick the most probable word, so their prose is generic and their details are the first ones anyone would think of. Choose one or two exact, unexpected details over a list of ordinary ones, and use sound, smell, touch and temperature as well as sight. Prefer concrete nouns and strong verbs to adjectives and adverbs. Use a figure of speech only when a plain sentence can't do the job, and never give an abstract noun a physical verb ("grief hummed"). Models wear a detail out: an image, a gesture or a turn of phrase appears once in a chapter. Vary how scenes open — not every scene starts with light or weather — and write in ordinary paragraphs.

KEEPING IT STRAIGHT
Models lose track in the middle of a long chapter. Keep the time of day, who is where, who is on shift or in the room, injuries, what is in people's hands and what each person knows consistent from the first line to the last. Things keep the look they were given: a vehicle, an object's material, colour and size, a room, a person's appearance stay as the book reference or an earlier chapter described them, so check STORY SO FAR before you describe them again. When you need a small detail the book doesn't give, make it small and compatible with everything given. Never put a named person on the page that the book doesn't have, unless the plan or the author asks for one.

${AI_HABITS}

IF YOU THINK BEFORE WRITING
Keep the thinking short and practical: the scenes and their word budgets, what each person wants in each scene, the timeline of the chapter (the clock times things happen at, in order), the facts to keep straight (including how things already described look), and where the chapter stops. Don't draft the prose there. Then write the chapter you planned, all of it.

End the chapter where its plan ends, on a finished sentence that leaves the story open — an action, a line of dialogue or an unresolved beat — because the book goes on in the next chapter. Never stop part-way through a sentence or a line of dialogue. Do not sum up, draw a lesson, look ahead or end on a quotable line. Write only the prose of the book: no titles, chapter headings, notes, lists or markdown.`;

/** Post-History Instructions: the short reminder read last, just before every reply. */
export const POST_HISTORY = `Write the book now, as manuscript: carry straight on from where the story stands, in this book's point of view and tense, through to the ending this chapter's plan describes (or only the part the author asks for). Every line of dialogue answers with something new — never an echo. End inside the scene, not on a summary or a moral — and when the chapter has reached its planned ending, put [END OF CHAPTER] on a line of its own after the last sentence.`;
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
Hold this point of view, tense, voice and tone in every sentence; they belong to the book, not to the moment. Anything outside the point-of-view character's senses and knowledge stays off the page. The author's rules are absolute: when one says who may appear, what is never said, or whose head the story never enters, it holds in every line, whatever the plan or the moment seems to want. The people, places and plan of the book come from the book reference and the chapter plan: use them exactly and add nothing that contradicts them. When a chapter's settings differ from the last one — a different narrator, a different tense — write that chapter in its own settings from the first line.`;
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
    genre: section(summary, ['GENRE', 'SYSTEM AND GENRE']),
    // Campaigns keep the table's rules as content limits and player agency.
    rules: section(voice, ['ALWAYS OR NEVER', 'RULES', 'NEVER']) || [section(voice, ['CONTENT LIMITS']), section(voice, ['PLAYER AGENCY'])].filter(Boolean).join(' '),
  };
}

/**
 * The "Storyloom Novel" preset: a copy of the writer's preset with the prompts rewritten for writing a book.
 * Sampling and everything else stay as the writer's. Returns a new object; the input is untouched.
 */
export function novelPreset(presetBody, {roleplay = false, passages = false, kit: own = null} = {}) {
  const kit = own || writingKit(roleplay, {passages});
  const p = structuredClone(presetBody || {});
  p.prompts = Array.isArray(p.prompts) ? p.prompts : [];
  const set = (identifier, name, content) => {
    let x = p.prompts.find(q => q.identifier === identifier);
    if (!x) { x = {identifier, name, system_prompt: true, role: 'system', marker: false}; p.prompts.push(x); }
    x.content = content;
  };
  set('main', 'Main Prompt', kit.main);
  set('jailbreak', 'Post-History Instructions', kit.postHistory);
  // Read last, as the author's: models such as DeepSeek move every system message to the top, where a reminder loses its pull.
  const ph = p.prompts.find(q => q.identifier === 'jailbreak'); if (ph) ph.role = 'user';
  // Only an entry's text reaches the model, so the whole lorebook block says what it is.
  p.wi_format = WI_FORMAT;
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

${AI_HABITS}

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

/**
 * Optional way of working (off by default): a chapter written over several replies, a passage at a time.
 * The default is one reply = one whole chapter, the owner's way of working.
 */
/** The bit-by-bit version of a whole-chapter Main Prompt (Storyloom's, or the writer's own copy where the same sentences are still there). */
export const passagesVersion = main => String(main)
  .replace('chapter by chapter, together with its author', 'one passage at a time, together with its author')
  .replace(/Each reply is a whole chapter:[^.]*\.[^.]*\./, 'Write only the passage the direction asks for, at the pace it implies; a reply covers minutes of story, and the chapter is built over several replies.')
  .replace('End the chapter where its plan ends, on a finished sentence', 'End each reply on a finished sentence')
  .replace('because the book goes on in the next chapter', 'because the book goes on in the next reply');
export const CRAFT_MAIN_PASSAGES = passagesVersion(CRAFT_MAIN);
export const POST_HISTORY_PASSAGES = `Continue the book from exactly where it stopped, as live scene, in the point of view and tense the book uses. Write the next passage of the chapter, not the whole chapter. Carry out the author's direction in the prose without mentioning it. Stop on an open beat, not a summary.`;

/** Everything Storyloom writes for one kind of book: novel or roleplay (and, optionally, a chapter in passages). */
export function writingKit(roleplay = false, {passages = false} = {}) {
  if (!roleplay && passages) return {roleplay: false, passages: true, presetName: PRESET_NAME, narratorName: NARRATOR_NAME, card: NARRATOR_CARD, main: CRAFT_MAIN_PASSAGES, postHistory: POST_HISTORY_PASSAGES, continueNudge: CONTINUE_NUDGE, newChat: NEW_CHAT_PROMPT};
  return roleplay
    ? {roleplay: true, presetName: RP_PRESET_NAME, narratorName: RP_NARRATOR_NAME, card: RP_NARRATOR_CARD, main: RP_MAIN, postHistory: RP_POST_HISTORY, continueNudge: CONTINUE_NUDGE, newChat: RP_NEW_CHAT_PROMPT}
    : {roleplay: false, presetName: PRESET_NAME, narratorName: NARRATOR_NAME, card: NARRATOR_CARD, main: CRAFT_MAIN, postHistory: POST_HISTORY, continueNudge: CONTINUE_NUDGE, newChat: NEW_CHAT_PROMPT};
}

/**
 * The writing kit with the writer's own copy laid over Storyloom's ("your defaults"): `mine` holds {text, base} (or a bare string) per field —
 * main, mainPassages, postHistory, postHistoryPassages, continueNudge, newChat, card. A Main Prompt the writer changed in one way of writing
 * carries into the other where the same sentences are there (passagesVersion); a Post-History is kept per way of writing.
 */
export function withMine(kit, mine = {}) {
  const t = k => { const v = mine?.[k]; return typeof v === 'string' ? v : (v && typeof v.text === 'string' ? v.text : null); };
  const main = kit.passages ? (t('mainPassages') ?? (t('main') !== null ? passagesVersion(t('main')) : null)) : t('main');
  const postHistory = kit.passages ? t('postHistoryPassages') : t('postHistory');
  return {...kit, main: main ?? kit.main, postHistory: postHistory ?? kit.postHistory, continueNudge: t('continueNudge') ?? kit.continueNudge, newChat: t('newChat') ?? kit.newChat, card: t('card') ?? kit.card, mine: !!Object.keys(mine || {}).length};
}

/** A short fingerprint of a prompt's text (whitespace at the ends ignored). */
export const textPrint = t => { let h = 0x811c9dc5; for (const ch of String(t ?? '').replace(/\r\n?/g, '\n').trim()) { h ^= ch.codePointAt(0); h = Math.imul(h, 0x01000193) >>> 0; } return h.toString(36); };
/** Fingerprints of every Main Prompt and Post-History text earlier Storyloom versions wrote. Text that matches one is Storyloom's, not the writer's. */
export const OLD_TEXTS = Object.freeze(new Set(['17nz3jo', '8j3zld', '119g6ui', '9uz7pm', '798hmw', '18my2ae', '2mz6yj', '1heg0f7', '12frxwl', '1ped5m', '1tctj8z', '16khde9', '18t2ygg']));
/** Fingerprints of narrator card descriptions earlier Storyloom versions wrote. */
export const OLD_CARDS = Object.freeze(new Set(['11cfz13']));
/** The current card for a description that is an earlier Storyloom narrator card (untouched by the writer); otherwise null. */
export function upgradedCard(description, own = {}) {
  const now = String(description || '').replace(/\r\n?/g, '\n').trim(), rp = /game master/i.test(now.split('\n')[0]);
  const builtIn = rp ? RP_NARRATOR_CARD : NARRATOR_CARD, want = String((rp ? own.roleplay : own.novel) || builtIn);
  if (now === want.trim()) return null; // already what it should be
  // Only Storyloom's own text (an earlier version, or today's built-in when the writer has their own copy) is replaced — never a card the writer edited.
  return OLD_CARDS.has(textPrint(now)) || now === builtIn.trim() ? want : null;
}

/**
 * Bring a Storyloom preset's Main Prompt and Post-History up to date for the chosen way of writing, without touching the writer's own edits:
 * a prompt is replaced only if it is Storyloom's own text — an earlier version, or the other way of writing. Returns the new preset and what happened.
 */
export function syncPresetText(presetBody, {roleplay = false, passages = false, mine = null, known = []} = {}) {
  // With the writer's own copy, Storyloom's built-in texts count as Storyloom's too (they get the writer's copy instead).
  const own = (r, p) => mine ? withMine(writingKit(r, {passages: p}), (r ? mine.roleplay : mine.novel) || {}) : writingKit(r, {passages: p});
  const want = own(roleplay, passages), others = [own(roleplay, !passages), own(!roleplay, passages), own(!roleplay, !passages), writingKit(roleplay, {passages}), writingKit(roleplay, {passages: !passages}), writingKit(!roleplay, {passages}), writingKit(!roleplay, {passages: !passages})];
  const p = structuredClone(presetBody || {}), swapped = [], kept = [];
  for (const [id, label, key] of [['main', 'Main Prompt', 'main'], ['jailbreak', 'Post-History Instructions', 'postHistory']]) {
    const x = (p.prompts || []).find(q => q.identifier === id);
    const now = String(x?.content ?? '').trim();
    if (now === want[key].trim()) continue;
    if (x && (OLD_TEXTS.has(textPrint(now)) || others.some(k => now === k[key].trim()) || known.some(t => now === String(t).trim()))) { x.content = want[key]; swapped.push(label); }
    else kept.push(label);
  }
  // The reminder is read last as the author's, and the lorebook block says what it is — only for Storyloom's own text.
  const ph = (p.prompts || []).find(q => q.identifier === 'jailbreak');
  if (ph && String(ph.content || '').trim() === want.postHistory.trim() && ph.role !== 'user') { ph.role = 'user'; swapped.push('Post-History role'); }
  if (!p.wi_format || p.wi_format === '{0}') { p.wi_format = WI_FORMAT; swapped.push('World Info label'); }
  return {preset: p, swapped, kept};
}
/** Switch between "all at once" and "bit by bit" (see syncPresetText). */
export const switchPresetMode = (presetBody, passages) => syncPresetText(presetBody, {passages});
