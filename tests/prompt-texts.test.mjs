import test from 'node:test';
import assert from 'node:assert/strict';
import {P, PROMPT_DEFAULTS, setPromptOverrides} from '../prompt-texts.mjs';
import {planningSystem} from '../prompts.mjs';
import {REPLY_FORMAT} from '../operations.mjs';

test('edited prompt parts replace only the editable wording; locked mechanics stay', () => {
  setPromptOverrides({persona: 'You are a terse planning bot.', bogus: 'ignored', deep: '   '});
  assert.equal(P('persona'), 'You are a terse planning bot.');
  assert.equal(P('deep'), PROMPT_DEFAULTS.deep.text, 'blank edits fall back to the default');
  const sys = planningSystem('simple');
  assert.match(sys, /^You are a terse planning bot\./);
  assert.ok(sys.includes(REPLY_FORMAT), 'reply format is always added');
  assert.match(sys, /must keep NOVEL TITLE/, 'required headings are always added');
  setPromptOverrides({});
  assert.match(planningSystem('simple'), /^You are Storyloom/);
});
