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
    assert.match(text, /starting point, not the whole project/);
    assert.match(text, /Fill in every skipped or undecided detail/);
    assert.doesNotMatch(text, /may be exactly Undecided/);
  }
});

test('overlong profiles are sent back to be shortened', () => {
  const long = full('Wren'); long.content += '\n' + 'word '.repeat(1100);
  assert.throws(() => validateCharacters({updates: [long]}, ['Wren']), /shorten it to under 800/);
  assert.match(characterProfilesInstruction(['Wren']), /between 450 and 650 words/);
});
