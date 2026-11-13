/**
 * Templates decide what Storyloom asks and what it saves. The built-in Novel template
 * reproduces the original fixed behaviour; users edit templates as plain text in Settings.
 */
export const SHOW=Object.freeze(['always','by name','off']);

export const NOVEL=Object.freeze({
  name:'Novel',
  unit:'Chapter',
  summary:{title:'Novel Foundation',fields:['NOVEL TITLE','GENRE','SETTING','PREMISE','PROTAGONIST','MAJOR CHARACTERS','CENTRAL CONFLICT','RELATIONSHIP ARCS','NARRATIVE STYLE','MAJOR PLOT MILESTONES','ENDING DIRECTION']},
  questions:[
    {id:'idea', text:'What is the premise in two or three sentences? What pressure is driving the story, and what is wanted?'},
    {id:'scale', text:'What scale do you want: the span of the story, number of chapters, words per chapter, and target total words?'},
    {id:'voice', text:'What voice should it have: POV and tense, register, tone, and roughness policy? Is there an age the subject must never read as?'},
    {id:'people', text:'Who are the people? Give one per line: name, age, pronouns, who they are to each other, and what they want. Mark the focus character with **.'},
    {id:'place', text:'Where does it take place? Which rooms matter, and what sensory details should ground the setting?'},
    {id:'foundation', text:'What else have you decided about the title, genre, central conflict, and relationship arcs?'},
    {id:'plot', text:'What major plot milestones or ending direction do you have in mind?'},
  ],
  entries:[
    {title:'Story Scale',show:'off',fields:['SPAN','CHAPTERS','WORDS PER CHAPTER','TARGET WORDS']},
    {title:'Voice and Boundaries',show:'always',fields:['POV','TENSE','REGISTER','TONE','ROUGHNESS POLICY','AGE THE SUBJECT MUST NEVER READ AS']},
    {title:'Place and Sensory Details',show:'by name',fields:['LOCATION','IMPORTANT ROOMS','SENSORY DETAILS']},
  ],
  cast:'People',
  outline:{title:'Novel Outline',lines:['Events','Characters and relationships','Consequences and threads']},
  characterSections:['ROLE IN THE STORY','BASICS','APPEARANCE','BACKGROUND AND HISTORY','PERSONALITY','WANTS AND NEEDS','FLAWS AND FEARS','RELATIONSHIPS','VOICE AND MANNERISMS','ARC THROUGH THE NOVEL'],
});

export const CAMPAIGN=Object.freeze({
  name:'Campaign (roleplay / D&D)',
  unit:'Session',
  summary:{title:'Campaign Overview',fields:['CAMPAIGN TITLE','SYSTEM AND GENRE','SETTING','PREMISE','PLAYER CHARACTERS','MAJOR NPCS','CENTRAL THREAT','FACTIONS','THEMES','ENDGAME']},
  questions:[
    {id:'idea', text:'What is the hook? In two or three sentences, what pulls the characters in and what is at stake?'},
    {id:'scale', text:'How long should it run: number of sessions or arcs, and how long is a session?'},
    {id:'voice', text:'What tone and rules: game system (if any), POV and tense for narration, tone, and content limits?'},
    {id:'people', text:'Who are the player characters and important NPCs? One per line: name, age, pronouns, who they are to each other, and what they want. Mark the main character with **.'},
    {id:'place', text:'Where does it happen? Which regions, towns, dungeons or rooms matter, and what do they feel like?'},
    {id:'foundation', text:'What else is decided: factions, the central threat, themes?'},
    {id:'plot', text:'What big beats or endgame do you have in mind?'},
  ],
  entries:[
    {title:'Campaign Scale',show:'off',fields:['SPAN','SESSIONS','SESSION LENGTH']},
    {title:'Table Rules and Voice',show:'always',fields:['SYSTEM','POV','TENSE','TONE','CONTENT LIMITS','PLAYER AGENCY']},
    {title:'World and Locations',show:'by name',fields:['REGIONS','KEY LOCATIONS','SENSORY DETAILS']},
    {title:'Factions',show:'by name',fields:['FACTIONS','GOALS','ALLIANCES AND RIVALRIES']},
  ],
  cast:'Cast',
  outline:{title:'Campaign Arc',lines:['Events','Characters and relationships','Consequences and threads']},
  characterSections:['ROLE IN THE STORY','BASICS','APPEARANCE','BACKGROUND AND HISTORY','PERSONALITY','WANTS AND NEEDS','FLAWS AND FEARS','ABILITIES AND GEAR','RELATIONSHIPS','VOICE AND MANNERISMS','ARC THROUGH THE CAMPAIGN'],
});

export const BUILT_IN=Object.freeze([NOVEL,CAMPAIGN]);

const list=x=>x.join(', ');
/** Plain text the user edits in Settings. */
export function templateToText(t) {
  return [
    `Name: ${t.name}`,
    `Unit: ${t.unit}`,
    `Summary entry: ${t.summary.title}`,
    `Summary fields: ${list(t.summary.fields)}`,
    '',
    'Questions:',
    ...t.questions.map(q=>`- ${q.text}`),
    '',
    'Entries (always / by name / off):',
    ...t.entries.map(e=>`- ${e.title} (${e.show}): ${list(e.fields)}`),
    '',
    `Cast list: ${t.cast}`,
    `Outline: ${t.outline.title}`,
    `Outline lines: ${list(t.outline.lines)}`,
    `Character headings: ${list(t.characterSections)}`,
  ].join('\n');
}

const fieldsOf=text=>String(text).split(',').map(x=>x.trim().replace(/:$/,'')).filter(Boolean);
const upper=x=>x.map(f=>f.toUpperCase());

export function parseTemplate(text) {
  const lines=String(text||'').split(/\r?\n/);
  const t={questions:[],entries:[]};
  let section=null;
  const value=(line,label)=>line.slice(label.length).trim();
  for(const [i,raw] of lines.entries()) {
    const line=raw.trim();
    if(!line)continue;
    const at=`Line ${i+1}`;
    const label=line.match(/^([A-Za-z ]+?)(?:\s*\([^)]*\))?:\s*(.*)$/);
    const key=label?.[1].toLowerCase();
    if(line.startsWith('-')) {
      const item=line.slice(1).trim();
      if(section==='questions') {if(item)t.questions.push({id:`q${t.questions.length+1}`,text:item});continue;}
      if(section==='entries') {
        const m=item.match(/^(.+?)\s*\((always|by name|off)\)\s*:\s*(.+)$/i);
        if(!m)throw Error(`${at}: write entries as “- Title (always|by name|off): FIELD, FIELD”.`);
        t.entries.push({title:m[1].trim(),show:m[2].toLowerCase(),fields:upper(fieldsOf(m[3]))});
        continue;
      }
      throw Error(`${at}: a “-” item must be under Questions or Entries.`);
    }
    if(key==='questions'){section='questions';continue;}
    if(key==='entries'){section='entries';continue;}
    section=null;
    const v=label?.[2]??'';
    if(key==='name')t.name=v;
    else if(key==='unit')t.unit=v;
    else if(key==='summary entry')(t.summary??={}).title=v;
    else if(key==='summary fields')(t.summary??={}).fields=upper(fieldsOf(v));
    else if(key==='cast list')t.cast=v;
    else if(key==='outline')(t.outline??={}).title=v;
    else if(key==='outline lines')(t.outline??={}).lines=fieldsOf(v);
    else if(key==='character headings')t.characterSections=upper(fieldsOf(v));
    else throw Error(`${at}: I don’t recognise “${line.slice(0,40)}”.`);
  }
  return validateTemplate(t);
}

export function validateTemplate(t) {
  const need=(ok,msg)=>{if(!ok)throw Error(msg);};
  need(t.name?.trim(),'The template needs a Name.');
  need(/^[A-Za-z][A-Za-z ]{1,20}$/.test(t.unit||''),'Unit must be one word or two, like Chapter, Session or Part.');
  need(t.summary?.title?.trim() && t.summary.fields?.length,'The template needs a Summary entry and Summary fields.');
  need(t.summary.fields.some(f=>/TITLE/.test(f)),'Summary fields need one with TITLE in it (the lorebook is named after it).');
  need(t.questions.length>=1,'Add at least one question under Questions.');
  need(t.cast?.trim(),'The template needs a Cast list entry name.');
  need(t.outline?.title?.trim() && t.outline.lines?.length,'The template needs an Outline and Outline lines.');
  need(t.characterSections?.length>=3,'Give at least three Character headings.');
  const titles=[t.summary.title,...t.entries.map(e=>e.title),t.cast,t.outline.title].map(x=>x.toLowerCase());
  need(new Set(titles).size===titles.length,'Every entry needs a different title.');
  need(!titles.includes('current writing directive') && !titles.includes('current chapter'),'“Current Writing Directive” and “Current Chapter” are reserved for Storyloom.');
  for(const e of t.entries)need(SHOW.includes(e.show) && e.fields.length,`Entry “${e.title}” needs a show setting and at least one field.`);
  return t;
}

/** The summary field holding the title (NOVEL TITLE, CAMPAIGN TITLE, TITLE…). */
export const titleField=t=>t.summary.fields.find(f=>/TITLE/.test(f));
/** Entry fields that must agree with the writing directive. */
export const voiceEntry=t=>t.entries.find(e=>['POV','TENSE','TONE'].every(f=>e.fields.includes(f)));
/** Field in a scale entry that states how many units there are (CHAPTERS, SESSIONS…). */
export function unitCountField(t) {
  const plural=t.unit.toUpperCase()+'S';
  for(const e of t.entries)if(e.fields.includes(plural))return {entry:e.title,field:plural};
  return null;
}
