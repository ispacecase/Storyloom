import {P} from './prompt-texts.mjs';
/** Full character profiles: one lorebook entry per person, written after the cast list exists. */
export const PROFILE_SECTIONS=Object.freeze([
  'ROLE IN THE STORY',
  'BASICS',
  'APPEARANCE',
  'BACKGROUND AND HISTORY',
  'PERSONALITY',
  'WANTS AND NEEDS',
  'FLAWS AND FEARS',
  'RELATIONSHIPS',
  'VOICE AND MANNERISMS',
  'ARC THROUGH THE NOVEL',
]);

export const MAX_PROFILE_WORDS=1000;
export const characterTitle=name=>`Character — ${String(name).trim()}`;

/** Names from the People cast list (`**Name | Age: … | …`, one per line). */
export function castNames(people) {
  const names=[];
  for(const line of String(people||'').split('\n')) {
    if(!line.includes('|'))continue;
    const name=line.split('|')[0].replace(/\*\*/g,'').replace(/^\s*[-*•]\s*/,'').trim();
    if(name && name.length<=100 && !names.some(n=>n.toLocaleLowerCase()===name.toLocaleLowerCase()))names.push(name);
  }
  return names;
}

const HELP={
  'ROLE IN THE STORY':'why this person matters to the plot and to the focus character when the story opens — not what they will do later.',
  'BASICS':'age, pronouns, occupation, where they live.',
  'APPEARANCE':'one or two distinctive details of how they look and dress, not an inventory — the narrator repeats every detail it is given.',
  'BACKGROUND AND HISTORY':'where they come from, the formative events of their past, and the history that shapes who they are when the story opens.',
  'PERSONALITY':'temperament, contradictions, what they do when pressed and why, what others like or dislike about them.',
  'WANTS AND NEEDS':'what they consciously want, what they actually need, and why the two conflict.',
  'FLAWS AND FEARS':'what gets in their way, and what they are afraid of.',
  'ABILITIES AND GEAR':'skills, powers, class or stats if a game system is used, and notable equipment.',
  'RELATIONSHIPS':'how they relate to each other named character, including history and tension.',
  'VOICE AND MANNERISMS':'how they speak — their words, sentence length, what they avoid saying, how they dodge, what makes them sound like nobody else in the cast — described, never quoted: the narrator copies any ready-made line into the book word for word. Speech only: no habits, gestures or things they do with their hands, because the narrator repeats whatever is listed until it becomes a tic.',
};
export function characterProfilesInstruction(names,cast=names,sections=PROFILE_SECTIONS,unit='Chapter',{player=''}={}) {
  const titles=names.map(n=>`"${characterTitle(n)}"`).join(', ');
  const others=cast.filter(n=>!names.includes(n));
  const units=unit.toLowerCase();
  const help=sections.map(h=>`- ${h}: ${HELP[h] || (/^ARC\b/.test(h)?`where they start, how they change ${units} by ${units} along the saved outline (name the ${units}s), and where they end. Everything this person does, decides or learns later in the book goes here and nowhere else.`:'what this heading asks for, specific to this person.')}`).join('\n');
  return `The outline is saved. Now write a full character profile for: ${titles}.${others.length?` The rest of the cast is ${others.join(', ')}; cover how this person relates to each of them.`:''} Return exactly ${names.length===1?'this entry':'these entries'} as entry blocks, one per person, using ${names.length===1?'that exact title':'those exact titles'}. Each profile must contain every one of these headings on its own line, each followed by real content: ${sections.map(s=>s+':').join(' ')}
What each heading needs:
${help}
If the writer said something specific about this person that none of these headings covers, add your own capitalised heading for it after the others. ${P('profileStyle')}${player && names.some(n=>n.toLocaleLowerCase()===player.toLocaleLowerCase())?` ${player} is the player's own character: the player decides who ${player} is, what ${player} feels and wants, and what ${player} does. Write only what the player said and the plain facts the game needs — role, age, what they do, what they carry, who they work with, how others see them — and leave every other heading at one short line that says the player decides it. Invent no past events, inner life, contradictions, fears, secrets or KEPT HIDDEN for ${player}: the game master reads this profile, and anything invented here gets narrated as if the player had chosen it.`:''} These are characters in a story, not chatbot personas: no greetings, roleplay directions or {{user}}/{{char}} placeholders. Keys: only this person's full name, first name and distinctive nicknames. Never generic words (mother, dog, the vet, her father) and never a surname another character shares — keys decide when the entry is shown in the story chat. Reply with one short sentence; the profiles go in entry blocks.`;
}

function sectionText(content,heading,sections=PROFILE_SECTIONS) {
  const lines=String(content||'').split('\n');
  const strip=x=>x.trim().replace(/^#{1,6}\s*/,'').replace(/^[*_]+|[*_]+$/g,'').trim();
  const start=lines.findIndex(x=>strip(x).toUpperCase().startsWith(heading+':') || strip(x).replace(/[*_]+/g,'').toUpperCase().startsWith(heading+':'));
  if(start<0)return '';
  const first=strip(lines[start]).replace(/[*_]+/g,'').slice(heading.length+1).trim();
  const rest=[];
  for(let i=start+1;i<lines.length;i++) {
    const s=strip(lines[i]).replace(/[*_]+/g,'');
    if(sections.some(h=>s.toUpperCase().startsWith(h+':')))break;
    rest.push(lines[i]);
  }
  return [first,...rest].join('\n').trim();
}

export function validateCharacters(result,names,sections=PROFILE_SECTIONS) {
  const updates=Array.isArray(result?.updates)?result.updates:[];
  const problems=[];
  for(const name of names) {
    const title=characterTitle(name).toLocaleLowerCase();
    const entry=updates.find(u=>String(u.title||'').trim().toLocaleLowerCase()===title);
    if(!entry){problems.push(`missing the entry "${characterTitle(name)}"`);continue;}
    const missing=sections.filter(h=>sectionText(entry.content,h,sections).length<20);
    if(missing.length)problems.push(`"${characterTitle(name)}" is missing or too thin under ${missing.join(', ')}`);
    const words=String(entry.content).split(/\s+/).filter(Boolean).length;
    if(words>MAX_PROFILE_WORDS)problems.push(`"${characterTitle(name)}" is ${words} words; shorten it to under 800`);
  }
  if(problems.length)throw Error('Character profiles incomplete: '+problems.join('; '));
}

/**
 * When the writer named the characters, keep only those in the cast list; anyone else the AI added is returned
 * separately so it can wait for the writer's approval. Names match on the first name, case-insensitively.
 */
export function splitExtraCast(castContent, writerText) {
  const said = String(writerText || '').toLocaleLowerCase();
  const kept = [], extras = [];
  for (const line of String(castContent || '').split('\n')) {
    if (!line.includes('|')) { kept.push(line); continue; }
    const name = line.split('|')[0].replace(/\*\*/g, '').replace(/^\s*[-*•]\s*/, '').trim();
    const first = name.split(/\s+/)[0].toLocaleLowerCase();
    (first && new RegExp(`(^|[^\\p{L}])${first.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}([^\\p{L}]|$)`, 'u').test(said) ? kept : extras).push(line);
  }
  return {kept: kept.join('\n'), extras};
}
