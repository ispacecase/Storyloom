import test from 'node:test';
import assert from 'node:assert/strict';
import {castNames, characterProfilesInstruction, validateCharacters, PROFILE_SECTIONS, characterTitle} from '../characters.mjs';
import {finalizeInstruction} from '../interview.mjs';

const people = `All details AI-suggested.\n\n**Wren Halász | Age: 34 | Pronouns: she/her | Relationships: daughter | Wants: to finish\nMárk Halász | Age: 39 | Pronouns: he/him | Relationships: brother | Wants: recognition\n- Nadia | Age: 16 | Pronouns: she/her | Relationships: niece | Wants: her own thing`;

test('cast names come from the People list, focus markers removed', () => {
  assert.deepEqual(castNames(people), ['Wren Halász', 'Márk Halász', 'Nadia']);
  assert.deepEqual(castNames(''), []);
});

test('profile instruction names every entry and every heading', () => {
  const text = characterProfilesInstruction(['Wren', 'Nadia']);
  assert.match(text, /"Character — Wren"/);
  assert.match(text, /"Character — Nadia"/);
  for (const h of PROFILE_SECTIONS) assert.ok(text.includes(h + ':'), h);
});

const full = name => ({title: characterTitle(name), content: PROFILE_SECTIONS.map(h => `**${h}:** ${name} has a long and specific answer for this section.`).join('\n\n'), keys: [name]});

test('complete profiles pass; missing or thin ones fail with a specific reason', () => {
  validateCharacters({updates: [full('Wren'), full('Nadia')]}, ['Wren', 'Nadia']);
  assert.throws(() => validateCharacters({updates: [full('Wren')]}, ['Wren', 'Nadia']), /missing the entry "Character — Nadia"/);
  const thin = full('Wren'); thin.content = thin.content.replace(/ARC THROUGH THE NOVEL:\*\* .*/, 'ARC THROUGH THE NOVEL:** grows');
  assert.throws(() => validateCharacters({updates: [thin]}, ['Wren']), /ARC THROUGH THE NOVEL/);
});

test('simple and deep both build out beyond the writer’s answers', () => {
  for (const mode of ['simple', 'deep']) {
    const text = finalizeInstruction(mode, {});
    assert.match(text, /Hard limits: if the writer gave a number of chapters, a length, or named who the characters are or how many there are, the plan uses exactly that/);
    assert.match(text, /Size everything to the story’s length/);
    assert.match(text, /Answer every interview question the writer skipped/);
    assert.doesNotMatch(text, /may be exactly Undecided/);
  }
});

test('overlong profiles are sent back to be shortened', () => {
  const long = full('Wren'); long.content += '\n' + 'word '.repeat(1100);
  assert.throws(() => validateCharacters({updates: [long]}, ['Wren']), /shorten it to under 800/);
  assert.match(characterProfilesInstruction(['Wren']), /between 450 and 650 words/);
});

test('when the writer named the cast, extra people are split out for approval', async () => {
  const {splitExtraCast, castNames} = await import('../characters.mjs');
  const cast = 'Cast index note\n**Lily | Age: 7 | Pronouns: she/her | Relationships: x | Wants: y\nJim | Age: 27 | Pronouns: he/him | Relationships: x | Wants: y\nCath | Age: 26 | Pronouns: she/her | Relationships: x | Wants: y\nMrs Ovey | Age: 71 | Pronouns: she/her | Relationships: x | Wants: y';
  const {kept, extras} = splitExtraCast(cast, 'Two people: Lily, a seven-year-old, and jim the lodger.');
  assert.deepEqual(castNames(kept), ['Lily', 'Jim']);
  assert.match(kept, /^Cast index note/);
  assert.deepEqual(extras.map(l => l.split('|')[0].trim()), ['Cath', 'Mrs Ovey']);
  assert.deepEqual(splitExtraCast(cast, 'Jimmy and Lilyanne').extras.length, 4, 'partial name matches do not count');
});
