import {createNovel} from './state.mjs';
export const FOUNDATION_FIELDS=['NOVEL TITLE','GENRE','SETTING','PREMISE','PROTAGONIST','MAJOR CHARACTERS','CENTRAL CONFLICT','RELATIONSHIP ARCS','NARRATIVE STYLE','MAJOR PLOT MILESTONES','ENDING DIRECTION'];
export function foundationTemplate() {
  return `${FOUNDATION_FIELDS.map(field=>`${field}:`).join('\n')}\n\n${createNovel().directive.consistency}`;
}
export function initialDirective() {
  const x=createNovel().directive;
  return `CURRENT WRITING DIRECTIVE\nChapter: ${x.chapter}\nScene: ${x.scene}\nPOV: ${x.pov}\nTense: ${x.tense}\nTone: ${x.tone}\nPacing: ${x.pacing}\n\n${x.consistency}\n\n${x.instructions}`;
}

export function validFoundation(content) {
  return FOUNDATION_FIELDS.every(field=>new RegExp(`^${field}:`, 'm').test(content)) && content.includes(createNovel().directive.consistency);
}
