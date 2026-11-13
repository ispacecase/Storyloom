import test from 'node:test';
import assert from 'node:assert/strict';
import { foundationTemplate, initialDirective } from '../template.mjs';
test('foundation includes all agreed headings with blank values', () => {
  const value=foundationTemplate();
  for (const x of ['NOVEL TITLE','GENRE','SETTING','PREMISE','PROTAGONIST','MAJOR CHARACTERS','CENTRAL CONFLICT','RELATIONSHIP ARCS','NARRATIVE STYLE','MAJOR PLOT MILESTONES','ENDING DIRECTION']) assert.match(value,new RegExp(`^${x}:$`,'m'));
  assert.match(value,/All established events and character histories must remain consistent unless explicitly revised\./);
});
test('writing directive preserves the specified starting settings',()=>{
 const v=initialDirective(); for (const item of ['Chapter: 1','Scene: 1','POV: Third-person limited','Tense: Past','Tone: Atmospheric, intimate, psychologically complex','Pacing: Slow development with purposeful plot progression','Continue the current scene without recapping or prematurely ending it.']) assert.ok(v.includes(item));
});


test('reads markdown headings and preserves fields omitted by the model', async () => {
  const {normalizeFoundation, validFoundation, foundationTitle} = await import('../template.mjs');
  const prior = foundationTemplate().replace('GENRE:', 'GENRE: Mystery');
  const normalized = normalizeFoundation('## **Novel title:** Salt Ledger\n**Premise**: Mara finds a ledger.', prior);
  assert.equal(validFoundation(normalized), true);
  assert.equal(foundationTitle(normalized), 'Salt Ledger');
  assert.equal(foundationTitle('NOVEL TITLE: The Salt Index [AI-suggested]'), 'The Salt Index');
  assert.match(normalized, /GENRE: Mystery/);
  assert.equal(validFoundation(normalizeFoundation('A chat reply with no fields.')), false);
});

test('extra headings the writer asked for are kept as their own sections', async () => {
  const {normalizeFoundation, FOUNDATION_FIELDS} = await import('../template.mjs');
  const proposed = FOUNDATION_FIELDS.map(f => `${f}: value for ${f}`).join('\n') + '\nTHEMES: grief and salt\nRECURRING MOTIFS: tide tables';
  const out = normalizeFoundation(proposed, '');
  assert.match(out, /^THEMES: grief and salt$/m);
  assert.match(out, /^RECURRING MOTIFS: tide tables$/m);
  assert.match(out, /^ENDING DIRECTION: value for ENDING DIRECTION$/m, 'last template field is not swallowed into');
  const later = normalizeFoundation(FOUNDATION_FIELDS.map(f => `${f}: new ${f}`).join('\n'), out);
  assert.match(later, /^THEMES: grief and salt$/m, 'an earlier added heading survives a later update');
  const mixed = normalizeFoundation(FOUNDATION_FIELDS.map(f => `${f}: v`).join('\n') + '\nNote: just a sentence.', '');
  assert.doesNotMatch(mixed, /^NOTE:/m, 'ordinary sentences with a colon are not headings');
});
