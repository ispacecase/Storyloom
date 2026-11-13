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
  'ROLE IN THE STORY':'why this person matters to the plot and to the focus character.',
  'BASICS':'age, pronouns, occupation, where they live.',
  'APPEARANCE':'how they look, dress and carry themselves, in concrete detail.',
  'BACKGROUND AND HISTORY':'where they come from, the formative events of their past, and the history that shapes who they are when the story opens.',
  'PERSONALITY':'temperament, habits, contradictions, what others like or dislike about them.',
  'WANTS AND NEEDS':'what they consciously want, what they actually need, and why the two conflict.',
  'FLAWS AND FEARS':'what gets in their way, and what they are afraid of.',
  'ABILITIES AND GEAR':'skills, powers, class or stats if a game system is used, and notable equipment.',
  'RELATIONSHIPS':'how they relate to each other named character, including history and tension.',
  'VOICE AND MANNERISMS':'how they speak and behave, so a writer can tell their dialogue apart.',
};
export function characterProfilesInstruction(names,cast=names,sections=PROFILE_SECTIONS,unit='Chapter') {
  const titles=names.map(n=>`"${characterTitle(n)}"`).join(', ');
  const others=cast.filter(n=>!names.includes(n));
  const units=unit.toLowerCase();
  const help=sections.map(h=>`- ${h}: ${HELP[h] || (/^ARC\b/.test(h)?`where they start, how they change ${units} by ${units} along the saved outline (name the ${units}s), and where they end.`:'what this heading asks for, specific to this person.')}`).join('\n');
  return `The outline is saved. Now write a full character profile for: ${titles}.${others.length?` The rest of the cast is ${others.join(', ')}; cover how this person relates to each of them.`:''} Return exactly ${names.length===1?'this entry':'these entries'} as entry blocks, one per person, using ${names.length===1?'that exact title':'those exact titles'}. Each profile must contain every one of these headings on its own line, each followed by real content: ${sections.map(s=>s+':').join(' ')}
What each heading needs:
${help}
Write each heading as two to four full sentences, not a phrase. Keep each whole profile between 450 and 650 words (never over 800): it is injected into the story chat whenever the character is mentioned, so make every sentence specific and useful rather than long. Keep every fact the writer gave and everything already saved in the outline and summary; build out everything else yourself so each person feels like a real character. Mark details you invented as AI-suggested so the writer can change them. These are characters in a story, not chatbot personas: no greetings, roleplay directions or {{user}}/{{char}} placeholders. Keys: only this person's full name, first name and distinctive nicknames. Never generic words (mother, dog, the vet, her father) and never a surname another character shares — keys decide when the entry is shown in the story chat. Reply with one short sentence; the profiles go in entry blocks.`;
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
