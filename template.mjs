import {createNovel} from './state.mjs';
export const FOUNDATION_FIELDS=['NOVEL TITLE','GENRE','SETTING','PREMISE','PROTAGONIST','MAJOR CHARACTERS','CENTRAL CONFLICT','RELATIONSHIP ARCS','NARRATIVE STYLE','MAJOR PLOT MILESTONES','ENDING DIRECTION'];
export function foundationTemplate(fields=FOUNDATION_FIELDS) {
  return `${fields.map(field=>`${field}:`).join('\n')}\n\n${createNovel().directive.consistency}`;
}
export function initialDirective() {
  const x=createNovel().directive;
  return `CURRENT WRITING DIRECTIVE\nChapter: ${x.chapter}\nScene: ${x.scene}\nPOV: ${x.pov}\nTense: ${x.tense}\nTone: ${x.tone}\nPacing: ${x.pacing}\n\n${x.consistency}\n\n${x.instructions}`;
}

export function validFoundation(content,fields=FOUNDATION_FIELDS) {
  return fields.every(field=>new RegExp(`^${field}:`, 'm').test(content)) && content.includes(createNovel().directive.consistency);
}


const consistency = createNovel().directive.consistency;

function foundationSections(text,fields=FOUNDATION_FIELDS) {
  const sections = new Map();
  let active = null;
  for (const line of String(text ?? '').split(/\r?\n/)) {
    if (line.trim().replace(/^[*_]+|[*_]+$/g, '') === consistency) {
      active = null;
      continue;
    }
    const heading = line.match(/^\s*(?:#{1,6}\s+)?(?:[-*]\s+)?[*_]*([A-Z][A-Z ]*?)[*_]*\s*:[*_]*\s*(.*)$/i);
    const field = heading?.[1].trim().toUpperCase();
    // A heading written in capitals that the template doesn't have is the writer's own addition: keep it as its own section.
    const extra = heading && !fields.includes(field) && /^[A-Z][A-Z &/'-]{2,39}$/.test(heading[1].trim());
    if (fields.includes(field) || extra) {
      active = field;
      sections.set(field, [heading[2]]);
    } else if (active) {
      sections.get(active).push(line);
    }
  }
  return new Map([...sections].map(([field, lines]) => [field, lines.join('\n').trim()]));
}

export function normalizeFoundation(content, previous = '', fields = FOUNDATION_FIELDS) {
  const proposed = foundationSections(content, fields);
  if (![...proposed.values()].some(Boolean)) return content;
  const prior = foundationSections(previous, fields);
  const lines = fields.map(field => {
    const value = proposed.get(field) || prior.get(field);
    return value ? field + ': ' + value : field + ':';
  });
  // Extra headings the writer asked for: new ones from this update, then earlier ones it didn't repeat.
  const extras = [...new Set([...proposed.keys(), ...prior.keys()])].filter(field => !fields.includes(field));
  for (const field of extras) {
    const value = proposed.get(field) || prior.get(field);
    if (value) lines.push(field + ': ' + value);
  }
  return lines.join('\n') + '\n\n' + consistency;
}

export function foundationTitle(content,fields=FOUNDATION_FIELDS) {
  const field=fields.find(f=>/TITLE/.test(f))||'NOVEL TITLE';
  const title=foundationSections(content,fields).get(field)?.split('\n')[0] ?? '';
  return title.trim()
    .replace(/^\*+|\*+$/g,'')
    .replace(/\s*(?:\(AI[- ]suggested[^)]*\)|\[AI[- ]suggested[^\]]*\]|[—–-]\s*AI[- ]suggested)\s*$/i,'')
    .replace(/^["“]|["”]$/g,'')
    .trim();
}
