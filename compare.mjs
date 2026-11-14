/**
 * Compare narrators: the writer's narrator (character card + preset prompts) next to Storyloom's, place by place,
 * with problems found in the writer's version. Pure helpers — no SillyTavern calls.
 */
import {NARRATOR_CARD, isGeneralNarrator, writingKit} from './novelist.mjs';

/** Every place a narrator's instructions live. `on: 'card' | 'preset'` says what "Use Storyloom's" changes. */
export const PLACES = Object.freeze([
  {key: 'description', label: 'Narrator card — Description', on: 'card', what: 'Who is telling the story and how: point of view, tense, voice. Sent near the top of every prompt.'},
  {key: 'cardMain', label: 'Narrator card — Main Prompt override', on: 'card', what: 'Replaces (or adds to, with {{original}}) the preset’s Main Prompt when “Prefer Char. Prompt” is on.'},
  {key: 'charNote', label: 'Narrator card — Character’s Note', on: 'card', what: 'Inserted a few messages from the end of the chat, so it is followed strongly.'},
  {key: 'cardPost', label: 'Narrator card — Post-History override', on: 'card', what: 'Replaces the preset’s Post-History Instructions when “Prefer Char. Instructions” is on.'},
  {key: 'main', label: 'Preset — Main Prompt', on: 'preset', what: 'The standing “how to write” layer at the top of every prompt.'},
  {key: 'postHistory', label: 'Preset — Post-History Instructions', on: 'preset', what: 'The last thing the model reads before it writes — followed most strongly.'},
  {key: 'continueNudge', label: 'Preset — Continue nudge', on: 'preset', what: 'Sent when you press Continue.'},
  {key: 'newChat', label: 'Preset — New Chat prompt', on: 'preset', what: 'Marks where the chat starts.'},
  {key: 'auxiliary', label: 'Preset — Auxiliary prompt', on: 'preset', what: 'An extra instruction block some presets use (often for content rules).'},
  {key: 'enhanceDefinitions', label: 'Preset — Enhance Definitions', on: 'preset', what: 'A switch that tells the model to add its own knowledge about the characters.'},
]);

/** The writer's version of each place, from the character card and the preset in use. */
export function yourPlaces(card = {}, preset = {}) {
  return {
    description: card.description || '',
    cardMain: card.system_prompt || '',
    charNote: card.depth_prompt?.prompt || '',
    cardPost: card.post_history_instructions || '',
    main: preset.mainOn === false ? '' : (preset.main || ''),
    postHistory: preset.postHistoryOn === false ? '' : (preset.postHistory || ''),
    continueNudge: preset.continueNudge || '',
    newChat: preset.newChat || '',
    auxiliary: preset.auxiliary || '',
    enhanceDefinitions: preset.enhanceDefinitions === false ? 'off' : 'on',
  };
}
/** Storyloom's version of each place. `filledCard` is the general narrator with this book's blanks filled in, for display. */
export function storyloomPlaces(filledCard = null, {roleplay = false} = {}) {
  const k = writingKit(roleplay);
  return {description: filledCard ?? k.card, cardMain: '', charNote: '', cardPost: '', main: k.main, postHistory: k.postHistory, continueNudge: k.continueNudge, newChat: k.newChat, auxiliary: '', enhanceDefinitions: 'off'};
}

const ROLEPLAY = /\{\{user\}\}|\brole-?play(?:ing)?\b|\bRP\b|\bin character\b|\breply as\b|\{\{char\}\}'s next reply\b|\byour next reply\b|\bfictional chat\b|\byou (?:are|play|will play|portray)\b(?! a novelist| the narrator| writing)|\bnever (?:speak|act|write) for (?:the user|\{\{user\}\})/i;
const LONG = /\b(?:whole|entire|full|complete) chapter\b|\bat least \d[\d,]* words\b|\b(?:long|lengthy|verbose|extensive)\s+(?:responses?|replies|reply|outputs?)\b|\bas (?:long|much|many words) as (?:possible|you can)\b|\b\d{4,}[\d,]*\s*(?:\+\s*)?words? (?:per|each|every) (?:reply|response)\b/i;
const povOf = t => {
  const s = String(t || '');
  if (/\bfirst[- ]person\b|\b1st person\b/i.test(s)) return 'first';
  if (/\bsecond[- ]person\b/i.test(s)) return 'second';
  if (/\bthird[- ]person\b|\bclose third\b|\bthird limited\b|\bomniscient\b/i.test(s)) return 'third';
  return '';
};
const tenseOf = t => {
  const s = String(t || '');
  const past = /\bpast tense\b|\btense\s*:\s*past\b|\bin the past\b/i.test(s), present = /\bpresent tense\b|\btense\s*:\s*present\b/i.test(s);
  return past && !present ? 'past' : present && !past ? 'present' : '';
};

/**
 * Problems in the writer's places. `values` are this book's settings (pov, tense…); `names` are cast names,
 * which belong in the lorebook, not in the craft layers. Returns {placeKey: [{level:'problem'|'note', text}]}.
 */
export function findProblems(yours, {values = {}, names = [], roleplay = false} = {}) {
  const out = Object.fromEntries(PLACES.map(p => [p.key, []]));
  const add = (k, text, level = 'problem') => out[k].push({level, text});
  const textKeys = PLACES.map(p => p.key).filter(k => k !== 'enhanceDefinitions');
  for (const k of textKeys) {
    const t = String(yours[k] || '');
    if (!t.trim()) continue;
    const m = roleplay ? null : t.match(ROLEPLAY);
    if (m) add(k, `Roleplay wording (“${m[0]}”): it tells the model it is in a chat with you, so it answers you instead of writing the book.`);
    const l = t.match(LONG), negated = l && /\b(?:not|never|don'?t|no)\b[^.]{0,25}$/i.test(t.slice(Math.max(0, l.index - 30), l.index));
    if (l && !negated) add(k, `Asks for very long replies (“${l[0]}”). A chapter is written over many replies; asking for it all at once is what gets replies cut off part-way.`);
    if (['main', 'postHistory', 'continueNudge', 'newChat', 'auxiliary'].includes(k)) {
      const hit = names.filter(n => n && n.length > 2 && new RegExp(`\\b${n.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`).test(t));
      if (hit.length) add(k, `Names story people (${hit.slice(0, 4).join(', ')}). This layer is for how to write; facts about the story belong in the lorebook, where they can change per chapter.`);
    }
  }
  // The description must say how the book is told.
  const desc = String(yours.description || '');
  if (!desc.trim()) add('description', 'Empty: nothing tells the model whose point of view or which tense to use.');
  else if (!isGeneralNarrator(desc)) {
    if (!povOf(desc) && !/\bpoint of view\b|\bPOV\b/i.test(desc)) add('description', 'No point of view (first person, close third…). The model will drift between viewpoints.');
    if (!tenseOf(desc) && !/\btense\b/i.test(desc)) add('description', 'No tense (past or present). The model may switch tense mid-chapter.');
  }
  // Point of view / tense said differently in different places, or differently from the book's settings.
  const bookPov = povOf(values.pov), bookTense = tenseOf(`tense: ${values.tense || ''}`) || tenseOf(values.tense);
  for (const k of textKeys) {
    const t = yours[k]; if (!t) continue;
    const p = povOf(t), te = tenseOf(t);
    if (p && bookPov && p !== bookPov) add(k, `Says ${p} person, but this book is set to ${values.pov}.`);
    if (te && bookTense && te !== bookTense) add(k, `Says ${te} tense, but this book is set to ${values.tense}.`);
  }
  const claims = k => ({p: povOf(yours[k]), t: tenseOf(yours[k])});
  for (let i = 0; i < textKeys.length; i++) for (let j = i + 1; j < textKeys.length; j++) {
    const a = claims(textKeys[i]), b = claims(textKeys[j]), A = PLACES[i].label, B = PLACES[j].label;
    if (a.p && b.p && a.p !== b.p) { add(textKeys[i], `Says ${a.p} person; ${B} says ${b.p} person.`); add(textKeys[j], `Says ${b.p} person; ${A} says ${a.p} person.`); }
    if (a.t && b.t && a.t !== b.t) { add(textKeys[i], `Says ${a.t} tense; ${B} says ${b.t} tense.`); add(textKeys[j], `Says ${b.t} tense; ${A} says ${a.t} tense.`); }
  }
  if (!String(yours.main || '').trim() && !String(yours.cardMain || '').trim()) add('main', roleplay ? 'No Main Prompt: nothing tells the model how to run the story — play everyone but you, keep the world consistent, leave your character to you.' : 'No Main Prompt: nothing tells the model it is writing a book rather than chatting.');
  if (roleplay) {
    const all = ['main', 'cardMain', 'postHistory', 'cardPost', 'description', 'charNote'].map(k => yours[k] || '').join('\n');
    if (!/never\s+(?:speak|act|write|decide|play|control|narrate)\b[^.]{0,60}(?:\{\{user\}\}|the user|the player|player'?s)/i.test(all)) add('main', 'Nothing says to leave your character alone: without “never speak or act for {{user}}”, the model will start playing your character for you.');
  }
  if (!String(yours.postHistory || '').trim() && !String(yours.cardPost || '').trim()) add('postHistory', 'Nothing is read last. A short reminder here (continue the book, keep POV and tense) is the strongest place for it.', 'note');
  if (yours.enhanceDefinitions === 'on') add('enhanceDefinitions', 'On: it tells the model to add what it “knows” about your characters, which invents facts your book doesn’t have.');
  return out;
}

/** Ask the model for a short review of the writer's narrator against Storyloom's. */
export function compareInstruction({yours, storyloom, problems}) {
  const block = (o, k) => `${PLACES.find(p => p.key === k).label}:\n${String(o[k] || '(empty)').slice(0, 6000)}`;
  const found = PLACES.flatMap(p => (problems[p.key] || []).map(x => `- ${p.label}: ${x.text}`)).join('\n') || '- none found';
  return `A writer uses an AI to write a novel. Below is their narrator setup, and Storyloom's reference setup built from research on how to prompt a model to write a book (craft in the Main Prompt, the book's facts in the lorebook, point of view and tense on the narrator card, a short reminder read last).

Review the writer's setup. Be specific and brief:
1. What in it will make the writing worse, and why (quote the words).
2. What it does better than Storyloom's or that is worth keeping.
3. The three changes that would help most, each in one line.
Do not rewrite the prompts in full.

PROBLEMS STORYLOOM ALREADY FOUND
${found}

THE WRITER'S SETUP
${PLACES.map(p => block(yours, p.key)).join('\n\n')}

STORYLOOM'S SETUP
${PLACES.map(p => block(storyloom, p.key)).join('\n\n')}`;
}
