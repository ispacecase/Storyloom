import test from 'node:test';
import assert from 'node:assert/strict';
import {NOVEL, CAMPAIGN, templateToText, parseTemplate} from '../templates.mjs';
import {startInterview, currentQuestion, advanceInterview, finalizeInstruction, validateOutline} from '../interview.mjs';
import {layoutBook} from '../lorebook-layout.mjs';

test('built-in templates survive a round trip through the editor text', () => {
  for (const t of [NOVEL, CAMPAIGN]) {
    const back = parseTemplate(templateToText(t));
    assert.equal(back.name, t.name);
    assert.deepEqual(back.summary, t.summary);
    assert.deepEqual(back.entries, t.entries);
    assert.deepEqual(back.questions.map(q => q.text), t.questions.map(q => q.text));
    assert.deepEqual(back.characterSections, t.characterSections);
    assert.equal(templateToText(back), templateToText(t));
  }
});

test('editor errors point at the problem', () => {
  const text = templateToText(NOVEL);
  assert.throws(() => parseTemplate(text.replace('- Story Scale (off):', '- Story Scale (sometimes):')), /Line \d+: write entries as/);
  assert.throws(() => parseTemplate(text.replace(/Summary fields: [^\n]+/, 'Summary fields: GENRE, SETTING')), /TITLE/);
  assert.throws(() => parseTemplate(text.replace('Cast list: People', 'Cast list: Novel Outline')), /different title/);
  assert.throws(() => parseTemplate(text + '\nBanana: yes'), /don’t recognise/);
});

test('the interview asks the template’s own questions', () => {
  let x = startInterview('simple', CAMPAIGN);
  assert.match(currentQuestion(x), /hook/);
  let n = 0; while (x.phase === 'asking') { x = advanceInterview(x); n++; }
  assert.equal(n, CAMPAIGN.questions.length);
});

const campaignPlan = () => [
  {title: 'Campaign Overview', content: CAMPAIGN.summary.fields.map(f => `${f}: A real detail`).join('\n')},
  {title: 'Campaign Scale', content: 'SPAN: A season\nSESSIONS: 2\nSESSION LENGTH: Three hours'},
  {title: 'Table Rules and Voice', content: 'SYSTEM: 5e\nPOV: Second person\nTENSE: Present\nTONE: Grim\nCONTENT LIMITS: No gore\nPLAYER AGENCY: High'},
  {title: 'World and Locations', content: 'REGIONS: The Marches\nKEY LOCATIONS: Fort Ash\nSENSORY DETAILS: Smoke'},
  {title: 'Factions', content: 'FACTIONS: The Grey Order\nGOALS: Control the pass\nALLIANCES AND RIVALRIES: Hates the guild'},
  {title: 'Cast', content: '**Kael | Age: 30 | Pronouns: he/him | Relationships: leader | Wants: revenge\nIra | Age: 25 | Pronouns: she/her | Relationships: scout | Wants: gold'},
  {title: 'Campaign Arc', content: 'Session 1 — Smoke\nEvents: Fort Ash burns.\nCharacters and relationships: Kael meets Ira.\nConsequences and threads: The Order notices.\n\nSession 2 — Pass\nEvents: They hold the pass.\nCharacters and relationships: Ira betrays.\nConsequences and threads: Open.'},
  {title: 'Current Writing Directive', content: 'Chapter: 1\nScene: 1\nPOV: Second person\nTense: Present\nTone: Grim\nPacing: Brisk'},
];

test('a Campaign plan is checked against Campaign entries and Session headings', () => {
  assert.doesNotThrow(() => validateOutline({updates: campaignPlan()}, 'simple', CAMPAIGN));
  const wrongCount = campaignPlan(); wrongCount[1].content = wrongCount[1].content.replace('SESSIONS: 2', 'SESSIONS: 5');
  assert.throws(() => validateOutline({updates: wrongCount}, 'simple', CAMPAIGN), /2 sessions but Campaign Scale specifies 5/);
  const text = finalizeInstruction('simple', {}, CAMPAIGN);
  assert.match(text, /"Campaign Overview"/);
  assert.match(text, /Session 1 — Title/);
  assert.doesNotMatch(text, /Novel Foundation|Story Scale/);
});

test('layout follows the template’s show settings', () => {
  const entries = {};
  campaignPlan().forEach((u, i) => { entries[i] = {uid: i, comment: u.title, content: u.content, key: []}; });
  entries[20] = {uid: 20, comment: 'Character — Kael', content: 'x', key: ['Kael']};
  const out = layoutBook({entries}, {chapter: 2, template: CAMPAIGN, create: b => (b.entries[30] = {uid: 30})});
  const by = t => Object.values(out.entries).find(e => e.comment === t);
  assert.equal(by('Campaign Overview').constant, true);
  assert.equal(by('Table Rules and Voice').constant, true);
  assert.equal(by('Campaign Scale').disable, true);
  assert.equal(by('Campaign Arc').disable, true);
  assert.equal(by('Cast').disable, true);
  assert.equal(by('Factions').constant, false);
  assert.match(by('Current Chapter').content, /Session 2 of 2/);
});
