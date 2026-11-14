# Teaching the AI: research behind Storyloom's prompts

Research notes (2026-11-14) behind every prompt Storyloom sends to a model: the narrator (Main Prompt, Post-History, narrator card), what the narrator is sent each reply and where, the setup wizard, the chapter team (Lint, Editor, Reader, Revise, Seal), live memory and the Assistant.

**The principle.** Every one of these is read by a language model, not a person. So each prompt has to (1) tell the model its job, why it matters, and who uses what it writes — often another model; (2) teach it what language models specifically get wrong at that job, and what to do instead; (3) make every piece of context it receives say what it is, how to use it, and which source wins when two disagree; (4) never contradict another piece; (5) put each piece in the slot and role that makes the model read it the right way.

**How this was gathered.** An audit of the prompt the narrator actually received (dry run, test install); a close reading of three chapters the narrator actually wrote; four web research passes (fiction failures, placement and roles, the chapter team, the wizard and lorebook) and one pass over published anti-slop lists. Evidence labels: [paper], [preprint], [vendor] / [vendor docs] / [vendor source], [ST docs] / [ST source], [survey], [consensus] / [community], [opinion]. Sources are paraphrased; URLs are given so each claim can be checked.

Contents: 1. Audit · 2. Reading what it wrote · 3. Fiction · 4. Placement and roles · 5. The chapter team · 6. The wizard, the lorebook and the Assistant · 7. Anti-slop lists.


## 1. Audit: what the narrator actually received (0.23, test book "Fixed Light", Chapter 4, dry run)

The prompt, in order, as SillyTavern sent it (13 messages):

| # | Role | What | Size |
|---|---|---|---|
| 0 | system | Main Prompt (craft + AI habits) | 6.2k chars |
| 1 | system | FULL OUTLINE (memory item, end of system prompt) | 9.2k |
| 2 | system | Lorebook entries, glued together: setting, places, Tom's profile, Mara's profile, the summary entry | 15.2k |
| 3 | system | Narrator card (blanks filled) | 1.7k |
| 4 | system | New-chat prompt "[A new chapter of the book begins here.]" | — |
| 5 | system | PREVIOUSLY (Chapter 3 seal note + where things stand + what happened + last page) | 10.8k |
| 6 | system | Author's Note: Current Writing Directive, wrapped in HTML comments | 0.7k |
| 7 | system | THIS CHAPTER (plan + "still to come") | 1.8k |
| 8 | assistant | "Chapter 4 — Slack Water" (the chat's first message) | — |
| 9 | system | SCENE NOW | 1.6k |
| 10 | assistant | the chapter so far | — |
| 11 | user | END OF CHAPTER signal + REPLY LENGTH | 0.5k |
| 12 | system | Post-History | 0.3k |

What makes no sense to the model reading it:

1. **Lorebook entries arrive unlabelled.** Only an entry's content is sent, never its title. Mara's profile begins "ROLE IN THE STORY: Mara is…"; Tom's begins the same way straight after the places entry. The model has to guess where one entry ends and whose profile it is reading.
2. **"(AI-suggested)" markers inside the facts.** Written by the setup wizard for the writer's review; the narrator reads them as part of the book.
3. **The ending is sent three times on every reply**: the full outline (#1), "Still to come" in THIS CHAPTER (#7), and MAJOR PLOT MILESTONES + ENDING DIRECTION in the summary entry (#2). Novelcrafter withholds the whole-book summary from the writing prompt because models foreshadow and spoil (docs/novel-setups.md).
4. **Two contradicting lengths.** THIS CHAPTER: "about 9,000 words in total, across all the replies that make it up" (old passage wording). REPLY LENGTH: "write this whole chapter in this reply, about 1100 words".
5. **A stale scene card.** SCENE NOW still describes Chapter 3 (Saturday evening, Denny in the room) while PREVIOUSLY says Chapter 3 ended at first light on Day 3. The scene card is not reset when a chapter is sealed.
6. **The writing directive repeats and contradicts.** POV/tense/tone again (tone is the old default "Atmospheric, intimate, psychologically complex", not the book's), "Scene: 1", "Continue the current scene without recapping or prematurely ending it" (pulls against ending the chapter), wrapped in HTML comments meant for the writer.
7. **The hand-off talks about the narrator.** "WHAT THE NARRATOR NOW KNOWS: … The narrator's earlier reading that Mara would … was right" — a note for a human editor, meaningless to the model that reads it next chapter.
8. **The consistency line twice** at the end of the summary entry.
9. **Everything is "system".** Eleven system blocks; the only user message is Storyloom's own note. Nothing tells the model which block is reference, which is the plan, which is an order, or which wins when two disagree.
10. **The planner never learns who reads its entries.** The wizard's prompts never say that another model reads the lorebook while writing, that only content is sent, or that entries arrive when a key name appears. So it writes for a human reader (and adds review markers).

## 2. Baseline: reading what the narrator actually wrote ("Fixed Light", Chapters 1–3, DeepSeek V4 Flash via Venice, Storyloom 0.14–0.22)

Read in full by me (Claude) plus counted with a script.

**Rule broken, and every checker let it through.** The book's rules: "Never put a third person on the page"; the summary entry: "Mara and Tom, and no one else on the page." In Chapter 2 the narrator had Tom fetch a builder, Denny Pascoe, who then appears on the page with dialogue. Lint did not flag it (RULE / UNLISTED). Seal recorded it as canon ("He fetches Denny Pascoe"). The scene tracker carried Denny into Chapter 4's SCENE NOW. → Checkers need the author's rules and the cast list as hard, explicit checks, and "a named person not in the cast" must be a hard finding; Seal must not launder a rule break into canon.

**The author's length direction ignored.** "Continue. Keep this reply short, about 200 words." → 3,224 words. (Earlier "Write about 3,000 words" → 2,762 and 2,785.)

**Each reply restates the last line of the previous one.** Reply 2 opens "She took the letter off the sill and went down." — the exact last line of reply 1. Caused by "continue from exactly where it stopped" + LAST PAGE, read by the model as "repeat it".

**A motif run into the ground.** "She put the kettle on" / the kettle four times in one reply; "her thumb" throbbing/bleeding in every reply; "The X was there. The Y was there. The Z was there."

**Polysyndeton as a tic.** 6.9 "and" per 100 words; sentences chained "and … and … and …" paragraph after paragraph (the Hemingway pastiche DeepSeek falls into for "quiet, exact" voices). Top trigrams: "and did not", "in the middle of", "the whole of", "and looked at".

**Dialogue tics.** "‘Right,’ he said." three times; characters echo each other's figures and words ("‘Three days.’" twice; "Lasagne." "Lasagne." in the owner's own book).

**Wrong dialect.** A Cornish builder says "Aye" (northern/Scots) — stock "working man" dialect, not the place.

**Formatting junk.** "## Chapter 2" markdown heading at the top of a reply (manuscript-only rule broken); "<ds_safety>[Internal thinking]" provider junk (now cleaned).

**What was good** (keep): concrete objects carrying feeling (the oilskin, the polished hand's width of brass), restraint, short declaratives where they land, chapter endings on an image rather than a moral.

### 2b. Baseline run on 0.23: a new book ("Small Hours") through every step, read in full

**Wizard.** Opened every reply with praise ("Good premise — that's a real pressure cooker", "a lovely, eerie detail", "exactly right"). The proposal said "Core: 90% (you said 90%)" — the author never said it. Profiles came out at 763–974 words against the 450–650 asked. Each profile has an ARC THROUGH THE NOVEL section narrating the character's future chapter by chapter ("In Chapter 4 Ines tells him she will report him and he does not argue") — sent whenever the name appears. Walter's profile explains his hidden motive (his father's watch) and his inner fears, though the rules say he is only seen from outside and the reader is never told whether he is right. "AI-suggested:" appears a dozen times in one profile. The always-on foundation lists all five nights' events and the ending. The book's tone setting came out as the old default ("Atmospheric, intimate, psychologically complex"), not the author's "dry, a bit funny".

**Chapter 1 (2,487 of 3,000 words).** Good: specific ward detail, the dry humour asked for, restraint. Wrong: seven echoed lines ("Gone missing," Ines said; "I know about Friday."; "It's on the chart," Dev said; "The policy," Walter said; "She'll want it back" twice); Dev — the night charge nurse, present all shift — "came on at half six with his coat still on"; antibiotics "three o'clock" at handover and "two o'clock" later; Dev correcting himself mid-speech ("the daughter — no. The daughter's already been and gone. The wife.").

**Lint (26 findings).** Caught the antibiotic time. Missed Dev "coming on", every echo, the self-correction. About a third of its findings say "no fault" and are listed anyway, some marked hard ("fine… so no fault — noted"; "a 2019 basement flood is plausible… no fault"). Nitpicks deliberate style ("'the smell of the place started' has no complement"). Treats the plan literally (an extra midnight visit flagged as a timeline error). Exact-check bug: "Yellowed" (a paragraph's first word) flagged as an unknown name.

**Editor (106 notes on 2,487 words).** About half are "good, keep" / "leave". Turned Lint's nitpicks into MUST notes. Asked to cut the midnight visit because the plan didn't list it. Flagged none of the echoes.

**Reader (14 reactions).** The best of the three: caught Dev's self-correction and a real story problem (Ines finds the ring gone and asks whether the wife will want it back instead of "where's the ring?").

**Revise (118 notes applied).** Made it worse: added a contradiction ("you're on bay four, not bay three" right after giving her both); turned an error into nonsense ("the two o'clock antibiotic done early, at two"); scrambled the property book's chronology; invented an event (a dead wife's phone); changed meaning ("he's gone off" → "the patient's gone off"); left every echo and the Dev error in place.

**Seal.** Detailed, but recorded the narrator's error as fact ("At 06:30 Dev came on", CONTRADICTION: none), added inferences not on the page ("Walter knows she saw", "Ines avoiding Dev"), got a detail backwards ("coat off"). LAST PAGE was three tiny lines.

### 2c. After the rewrite (0.24): "Ditch Night", a new book through the new wizard and five chapters, read in full

**Wizard.** Simple mode answered plainly ("Got it: … Left open: …"), no flattery; the proposal said "ADDED: nothing". The lorebook took its title as soon as the plan existed. Profiles showed people through behaviour with sample lines ("Can we not do the big talk in a gas station.") and a KEPT HIDDEN section; the tone setting was the author's own words. One leak: Danny's BACKGROUND gave away Chapter 4's reveal (where he was going) outside KEPT HIDDEN — the profile instruction now says later reveals go only there. Arcs moved to a planning entry; no review marks anywhere.

**Narrator.** First person held throughout; the author's five rules held (the car's owner never named, nobody said "I love you", no crying). Profiles reached the narrator from the first line. Echoes fell sharply but didn't vanish (the prompt alone doesn't stop them — Lint's echo check and Revise do). Length came in at 1,433 → 1,769 (Chapter 1, two tries), then 1,687, 1,891, 1,969, 1,931 against 2,500 — the known two-thirds habit; the request now states a floor and how to reach it. "Carry on" once wrote past the plan's ending and used up Chapter 5's turning point; it now never runs past the ending and just marks a finished chapter done. After the team's edits the five chapters measured: echoes 0/0/1/1/0, no restated openings, no markdown, "and" 4.9–5.5 per 100 words (baseline 6.9), 10,857 of 12,500 words.

**Checkers.** Lint caught real continuity slips (the chain already rigged, the trouble light left in the ditch, the sneaker, the dent, a key for a car with no ignition, a new "brother", a new toothpick habit) and every echo it was built for. Its misses: a contradiction inside a chapter ("You had the key" a page after the broken ignition), and once a later chapter's reveal happening early. Two of Storyloom's own exact checks did damage before they were fixed: the first-person "no I in this paragraph" check (eight false hard findings, which Revise then "fixed" by inserting "I watched…", "I knew…") and sentence-start words taken for names ("Jeans", "Small"). Padding came back in a new wording ("No finding.", "In voice.", "Consistent.") — now filtered in any wording, with every drop logged. Revise's exact edits applied cleanly (14/17, 8/9, 11/12) and kept length; its failures were naming the subtext once ("The lie came out easy") and "correcting" a character's deliberate lie — both now forbidden in its instructions — and fixing one of two places a detail appeared.

**Seal.** Wrote plain facts for the next model, kept "doesn't know" and "isn't sure", described the point-of-view character's knowledge as facts about him. It recorded an early plot event as canon because it was on the page — catching that is Lint's job.

### 2d. Second round on 0.24: "Fair Market Value", three chapters (two all at once, one bit by bit), read in full

**Wizard.** Answers acknowledged plainly; the plan step listed what it invented, including the ending the author left open ("Wynn's report goes out with the copy recorded as genuine"). Two leaks into what the narrator sees from Chapter 1: Wynn's profile put **the ending** under KEPT HIDDEN (the old instruction invited "what the outline reveals later" there), and Teodora's ROLE line hinted at the lie ("the one who put the lie on its wall"). KEPT HIDDEN is now only what a person already knows or did when the story opens; later decisions and the ending go only under ARC (kept from the narrator); every other heading must be safe on page one. The fresh-eyes review runs before profiles exist, so the profile instruction has to carry this alone. Sample lines were written about plot moments ("Four hundred's low for that piano") and the narrator used all three of Teodora's word for word — samples must now be about everyday things outside the plan, and Lint flags a sample line that turns up in a chapter (SAMPLE, exact check).

**Narrator (all at once).** Chapter 1: 2,559 of 2,500 words; Chapter 2: 3,197 — length is no longer short. Rules held. Echoes persist (2 and 5–6); listed habits (drying hands, turning keys) repeat 3 times a chapter despite "once at most"; a frame "stained dark" became "plain gilt" a chapter later.

**Narrator (bit by bit, 800 a press, 3,000 a chapter).** Told only to "cover the next stretch of the plan", the first press wrote 1,679 words and used up three of the chapter's four planned events. With the plan's events listed and the press told how many it covers ("about one of these: the next one the text hasn't reached"), five presses came in at 716 / 745 / 805 / 881 / 680, each covering one event, and the chapter ended on the report as the author wanted. The narrator didn't mark the end; the next request now tells it to write only the end mark if the ending is already written, and a bit-by-bit chapter well past its length counts as finished. Stop works mid-reply; stopping during thinking left an empty reply, now removed. Chapter 3 redid work Chapter 1 had finished (the upstairs) and changed its numbers (freezer $60 → $150, quilts 3 → 11): Story So Far listed events, not finished work or numbers, and a chapter's MUST NOT DRIFT only reaches the next chapter. The ledger instruction now records what is done and every number the page fixed (Chapter 3's section went from a few lines to the prices and amounts).

**Checkers.** Padding returned in new wordings each run ("Possible: fine", "no break", "within register", "met", "lines 70–75 do this"). Filtering wordings is an arms race; the structural fix that worked: the checker writes everything fine under CHECKED (thrown away) and only problems under FINDINGS — the next run had no padding. Remaining false positives are over-literal or wrong: a clock "can't run ten minutes slow", a misread speaker, an unexplained afternoon called a contradiction, and in Chapter 3 Wynn's **deliberate false line in the report** and his bluff to Clem flagged hard. Findings also vary run to run (the real "varnish noticed a chapter early" was found in two runs of four). Hard false findings become "must" notes and Revise follows notes over its own rules: Chapter 1 ended up with "after four o'clock" before Clem's 3:40 arrival. Research (FlawedFictions: a separate verifier pass 0.35 → 0.50; Chain-of-Verification) points to a short second check of hard findings — proposed, not built. The Editor answered every "possible name" finding with "keep it"; those are now unticked by default and no-change notes are dropped. The Reader praised without its "Worked:" label; unlabelled praise is now recognised and never sent to Revise, and only the Reader's "must" reactions go to Revise by default. Revise, given 30 notes, invented facts (Alberta plates, "a day early"), explained ("he is the one who is dead"), turned "a hundred and forty" into "140" and "forty" (a speed) into "forty kilometres"; its instructions now name each of these. A doubled REPLACE label once put "REPLACE:" into the chapter (parser fixed); a short FIND that occurs twice is placed by its note's line.

### 2e. Third round on 0.24: "Dual Brakes", five chapters (1, 2, 4, 5 all at once; 3 bit by bit), read in full — the writing first

**How it writes now.** The best prose of the three test books. Specific, true-to-place detail (the tire-shop calendar, the dual brake "cold through the boot", Ammar knocking salt off the wheel arches with the flat of his hand); feeling carried by things people do (Ostap pulling the office door twice until it catches); distinct voices (Ammar: "Three is not rolling." / "Three is rolling. Zero is stopped."; Ostap: "It's the one thing you're good at and it's got a hole in it, so you've put the whole school in front of it."). Conflict held: Ostap never gives in, Denise refuses to move the date, Halyna loses arguments. Chapters open in motion after the author's new default rule (added through the Assistant). The ending stays open as the author asked.

**What the narrator still does, and what actually fixes it.**
- *Echoed dialogue* in every chapter (1–10 per draft). A/B of the habits wording on Chapter 1 (2 drafts each): echoes 1 and 5 with the new wording, 3 and 3 with the old; the Post-History already said "never an echo". **Wording does not move it.** What works is after the draft: the widened echo check (pronoun swaps, mid-line lifts, one-word repeats, opening repeats; greetings and picking an offered option exempt) found 8 of 8 in Chapter 2, and with Revise told that a trimmed repeat is still an echo, Revise took Chapter 3 from 10 to 1, Chapter 4 from 8 to 2.
- *Profile sample lines copied word for word* in all four Chapter 1 drafts (Walt's "Forty years I backed a trailer into that yard…" in every one, six lifts in one draft). Samples about "everyday things" didn't help. Profiles now describe how a person talks, with no quoted lines.
- *Listed habits*: profiles no longer list gestures, and the hand-drying/key-turning tics of the last book are gone; one pet verb ("squared") still recurs across the book — Lint's gesture check counts it.
- *"and… and… and" chains*: 6.0–6.4 per 100 narration words whatever the wording; Lint now marks the worst sentences and Revise splits them (it did, cleanly).
- *Details between chapters*: the hand-off now records how things look; the Corolla's "198,000 km and a scuff of grey salt on the wheel arch" carried from Chapter 1 into Chapter 2 unprompted.

**Failures found in the machinery, fixed.**
- Swiping a finished chapter asked the narrator for "only the end mark" (the old version's words were counted).
- On a Continue after a cut-off, the narrator (DeepSeek V4) wrote its planning notes into the chapter — an `<analysis>` plan and a `<summary>` in the format of a conversation compaction — and Storyloom counted them as prose. Notes are now removed (and the writer told). A second Continue came back as one block with `###` breaks and a restarted sentence; that is now repaired mechanically, words untouched.
- The cut-off itself: the narrator spent 9,532 of 12,000 tokens thinking on Chapter 4 and 8,800 on Chapter 5 (1,500 was assumed). The room estimate now uses the most thinking seen in the book and the write bar says how high to raise Max Response Length.
- Revise "fixed" an echo by replacing a whole paragraph with three words; an edit that would cut most of a passage without being asked is now left out and shown. Another echo fix invented a time ("the third, at nine-twenty") that a later chapter contradicted; the echo instructions no longer suggest "information", and say never to add a fact the book doesn't have.
- The button said a chapter was done while a message said it wasn't (no end mark, full length); they now agree.

**Lint's second look** (a separate check of hard findings that sees the claim, not the first checker's reasoning): Chapter 3 — 2 of 2 dropped, both correctly (a "clash" that wasn't one; a lesson "running long" with no length ever set); Chapter 4 — kept a real one (Halyna says "nine o'clock" for a nine-twenty test), dropped a false one; Chapter 5 — kept 2 real, dropped a formatting slip. About 6 seconds each. Before it, a false "out of character" finding had softened Ostap's refusal in Chapter 2.

**The Assistant, live.** Asked in plain words, it proposed the right change every time, as a card: an added rule for the Editor (leave how people talk alone), three settings for writing Chapter 3 bit by bit (and Undo worked), an added question in the Novel template (saved as "Novel (yours)", which new books then start from), and a Main Prompt rule about chapter openings — saved as the writer's default and kept when switching between bit by bit and all at once. When asked to stop echoes it said plainly that wording hasn't stopped them in testing and that Lint and Revise fix them. Faults fixed: it said all three settings were "this book only", and cards showed internal ids.

**A new chat** with a book set up showed only "start a new book"; the start screens now list the books being written with an Open button.

**Roleplay ("Unregistered", one session, two turns).** The game master wrote in voice and kept the conflict live (the dispatcher evasive, the crew split), and its second reply handed the choice back ("Say the word, Reyes."). Its first reply moved the player's crawler for her ("You ease the Marrowhawk forward…"), which Lint's model check missed; an exact check for narration that makes the player act now catches it (perception — you see, you feel — is allowed). Both replies ended on the same closing line, a templated closer. The wizard had written an invented past and inner life for the player's own character (a lost crewmate, "what she needs"); the player's profile now holds only what the player said and plain facts. A campaign started from a novel chat kept the novel narrator with nothing on screen saying what to do; the top bar now offers "Set up the game master →", then "your move, in the chat".

## 3. How language models fail at long fiction, and what helps (research agent report, 2026-11-14) — condensed, sources kept

Labels: [paper] [vendor] [survey] (structured community data) [consensus] [opinion].

### Failure modes
- **Setback and climax too early, the end rushed; less suspense after the midpoint** (Tian et al., arxiv 2407.13248). **Strong start, weak end** — "high-starting, low-ending" (ACL Findings 2025.1114).
- **Wrapping it up with a bow:** EQ-Bench's longform pipeline asks the model to critique its own plan for "common LLM failings… write safely… always wrap things up with a bow…"; rubrics penalise "Unearned Transformations", "Incongruent Ending Positivity" (github EQ-bench/longform-writing-bench, creative-writing-bench). Anthropic: Claude may try to close its work as it nears the context limit. Statuo: models wrap scenes too neatly; frame the story as ongoing.
- **Templated scene shapes and "golden-line" closers:** a 861-case survey of DeepSeek V4 roleplay feedback (471 users; github victorchen96/deepseek_v4_rolepaly_instruct): the top complaint is templated output — the same portrait-then-analysis opening, a block of setting description first, nearly every reply ending on a meaningless uplifting line ("They have a lifetime. Love slowly."). Watts Martin: one phrase used 45 times in one novel (coyotetracks.org).
- **Positivity bias:** "Riches to Rags" in 1.3% of GPT-4 stories vs 14.6% of human ones (2407.13248); character networks strongly positive (0.24–0.66 vs −0.06 human; arxiv 2510.18932). **Villains flattened** into surface aggression; tough protagonists fragile (arxiv 2511.04962). **Sycophancy and moralising in co-writing** (arxiv 2604.04735). V4 survey: conflicts talked down in two lines, characters "too correct", forced happy endings, counsellor-speak, lecturing narration. Statuo: "user always wins".
- **Everyone sounds alike** (V4 survey; ACL 2026.675). **One character's trait spreads to everyone**; info-dump dialogue; stereotyped experts (Kaj Sotala, substack + LessWrong).
- **Echo dialogue and restating the last message** — Marinara's preset has standing rules against parroting, "rhetorical echo", and "Continue directly from the last line".
- **Characters know what they shouldn't**; NPCs know secrets; one shared memory pool (V4 survey). Novelcrafter: spoilers in codex entries get used.
- **What professional editors fix** (arxiv 2409.14509, CHI 2025): awkward word choice 28%, poor sentence structure 20%, unnecessary/redundant exposition 18% (= over-explaining subtext), cliché 17%, purple prose, lack of specificity, tense inconsistency. Self-editing prompts don't work well at long-form scale.
- **Overwriting and melodrama:** four metaphors in five sentences, life-advice endings, melodrama at low stakes (Surge Hemingway-bench); LLM judges favoured the overwritten text. **"Hydrogen jukeboxes"** — abstract noun + concrete verb ("grief hums"), constant personification, pet words echoes/whispers/humming (nostalgebraist on R1). "It's not X, it's Y" 6.3× human rate; some patterns >1,000× (arxiv 2510.15061).
- **Contradictions cluster 40–60% through**, contradicting facts set up at 15–30%; grow linearly with length (ConStory-Bench, arxiv 2603.05890). V4: posture changes, forgotten ages and relationships, one detail repeated for a dozen turns.
- **POV and tense slips** (editors' taxonomy; ConStory "perspective confusion"; V3.1 drifts; V4 switches "I" to "he").
- **Writing too short:** LIFEBench (arxiv 2505.16234) — models deteriorate sharply past a threshold, stop early; reasoning models follow length best. LongWriter (2408.07055): ~2,000-word ceiling from fine-tuning; plan-then-write by sections with word budgets reaches 20,000+. WritingBench (2503.05244): most cap ~3,000 tokens; length is the hardest requirement. V4: "ask for long and it gets shorter and shorter".
- **Beats:** one moment per beat, or the AI rushes (Novelcrafter); detailed outlines help (DOC); "open new hooks" prompts produce unmotivated ominous events (Sotala).

### What helps
- **Ban lists:** no controlled fiction study; negated prompts hurt older large models (arxiv 2209.12711); "Suppressing Pink Elephants" (2402.07896) needed fine-tuning; Antislop (2510.15061): prompt bans have limited efficacy and may backfire — samplers/regex work. V4 users: ban lists "almost don't work". Anthropic/Google: say what to do; show patterns, not antipatterns. Statuo: pair any negative with the wanted behaviour. Gwern: anti-examples work when the model first explains why they're bad. → Keep the list short, pair each with the replacement and a reason; enforce the rest outside the prompt (Lint), visibly.
- **Give the reason** — the model generalises from it (Anthropic: "NEVER use ellipses" < same rule + why).
- **Calm wording; write the prompt in the style you want back** (CAPS and "CRITICAL" cause over-application in newer Claude models).
- **Examples:** among the most reliable steering; few-shot beats zero-shot for style, 2→10 samples adds little (arxiv 2509.14543); too many → copying.
- **Longer complete chapters:** plan first with per-scene word budgets; reasoning follows length best; tell the model the story continues after this chapter.
- **Keep conflict alive:** marking Point of No Return, Major Setback and Climax in the plan raised "best for suspense" 7.9% → 48.3% and overall preference 13.5% → 43.8% (2407.13248). Actions are attempts that can fail (Marinara, Statuo).
- **Distinct dialogue:** EQ-Bench has the model write sample dialogue per character before drafting; specific detail beats trait labels (Sotala).
- **Thinking models:** mixed — R1 beat V3 on Literature (WritingBench); a reasoning model had fewest consistency errors (ConStory); but R1's flashy tics, Marinara recommends reasoning off, V4 users report the chain of thought and the prose drifting apart. → Use thinking for planning, budgets and continuity, not for drafting prose; tie the plan to the page.

### DeepSeek
- R1: temperature 0.6; "avoid a system prompt; all instructions in the user prompt" (R1-0528 supports system). V3 API maps temperature (1.0 → 0.3); API docs recommend 1.5 for creative writing. **V4 thinking mode: temperature and penalties have no effect.** V4 drops earlier turns' reasoning. A semi-official V4 roleplay thinking-style switch goes at the end of the first user message ("the injection position during training"). V4 quirks (survey): templated openings/endings, golden-line closers, conflict avoidance, one voice, ban lists ineffective, shrinking length, omniscience, "not X but Y", CoT disconnected from prose.

### Community recipes
- EQ-Bench longform: brainstorm → reflect → plan chapters → critique the plan for "telltale LLM approaches" → final plan → character profiles with "flavour dialogue" → each chapter "Follow your plan." Rubric: Weak Dialogue, Tell-Don't-Show, Purple Prose, Forced Poetry or Metaphor, Amateurish, Unsurprising, Well-earned Lightness or Darkness, Followed Chapter Plan.
- Marinara Universal Preset: user agency; every action an attempt; each NPC a distinct voice; introduce conflicts; show don't tell with a concrete image; everyday language; trust subtext; anti-echo; continue from the last line; ban "it's not just X, it's Y"; reasoning off.
- Statuo: about three key goals; avoid negatives; models mirror recent messages' length and style; plan conflict in. Sotala: thin prompts get median, trope-heavy output; the model infers your expertise from your prompt. Gwern: extract a style manual from good samples; critique anti-examples first. Novelcrafter: specific beats, one moment each.

### What the narrator is told (adopted, each with its reason)
1. This is one chapter of a longer book; the story goes on after it — don't resolve what the plan leaves open; end inside the scene on the plan's last beat.
2. A word target with a reason; plan scenes with word budgets first; give the last scene as much room as the first; don't compress remaining beats into summary.
3. Each beat gets scene time.
4. Later events are for consistency only — no hints or foreshadowing beyond the plan; characters know only what they've seen or been told.
5. Wants clash and ground is given slowly and at a cost; attempts fail; people stay stubborn, wrong, petty.
6. No morals, no praising insight, no counsellor talk unless it's the character's voice.
7. When an action shows a feeling, don't name it too.
8. Before drafting, recall how each speaker talks; no two could swap lines; a trait belongs to its owner.
9. Answer with new information, evasion or action; never repeat the previous speaker or the last chapter; pick up where it ended.
10. Keep time, place, injuries, what's in hand consistent, especially mid-chapter.
11. Hold POV and tense; only what the POV character could perceive or infer.
12. One figure of speech when a plain sentence can't do it; no abstraction + sensory verb.
13. Intensity matched to stakes.
14. Vary scene openings and endings; no image, gesture or phrase twice.
15. Violence, grief, desire written as specifically as the rest (within the book's limits); antagonists competent.
16. Thinking: short and practical (scenes, budgets, goals, continuity facts, where it stops); no prose drafting in thinking; the chapter carries out the plan.

## 4. Placement and roles (research agent report, 2026-11-14) — condensed, sources kept

Labels: [paper] [vendor docs] [vendor source] [ST docs] [ST source] [community].

**Why the DeepSeek length note failed as system:** DeepSeek's chat templates (V3-0324, V3.1, V3.2-Exp, R1-0528) gather every `system` message, wherever it is, and put them at the very start. A depth-0 system note lands at the top and loses its recency. V4-Flash's reference encoder pastes system text bare with no role marker. [vendor source] huggingface.co/deepseek-ai/DeepSeek-V3.1 tokenizer_config.json; huggingface.co/deepseek-ai/DeepSeek-V4-Flash encoding/encoding_dsv4.py. A r/SillyTavernAI PSA (May 2025) advised sending preset prompts, Author's Notes and depth entries as `user` for DeepSeek [community]. DeepSeek-R1: "Avoid adding a system prompt; all instructions should be contained within the user prompt" [vendor docs].

**A mid-chat system message is treated four different ways:** SillyTavern turns it into `user` for Claude, Gemini and the built-in DeepSeek source; DeepSeek templates move it to the top; Qwen 3.5/3.6 templates reject it with an error ("System message must be at the beginning"); GPT, GLM-5.1, Kimi K2.6 and Gemma 4 keep it in place [ST source prompt-converters.js; vendor source]. Only the leading block behaves the same everywhere. → Long reference = leading system; instructions for this turn = `user` near the end; `assistant` only for prose the model really wrote.

**Roles are not authority.** OpenAI's instruction hierarchy (arxiv 2404.13208) and Model Spec rank system > developer > user; quoted/delimited material and assistant text count as information. But "Control Illusion" (arxiv 2502.15851): across six models the system/user split doesn't reliably set priority; explicit authority framing in words does more. → Write the precedence out in words.

**Position:** Lost in the Middle (arxiv 2307.03172) — start and end used best. GPT-4.1 guide: in long context put instructions before and after; on conflict the model follows the later one. Anthropic: long documents at the top, the query at the end (up to 30% better), XML tags, give the reason. Gemini: context first, specific instructions at the very end. ST docs: closer to the bottom = more effect; Post-History is usually weighted above Main; WI After Char Defs has more impact than Before.

**Negative rules prime the thing they name** — 87.5% of violations in one study involved the named thing (arxiv 2601.08070). → Phrase as what to do; when a list of banned habits is needed, pair each with the replacement and keep the replacement in focus.

**Length:** LIFEBench (arxiv 2505.16234): models handle short targets and under-shoot long ones, often stopping early; reasoning models follow length best. LongWriter (arxiv 2408.07055): output length is capped by fine-tuning example length (~2,000 words). → Make sure max tokens covers thinking + prose; state the number with a reason; plan-then-write helps.

**Assistant role:** a trailing assistant message is treated as the start of the model's own reply; fake dialogue steers by in-context learning. Prefill errors on Claude 4.6+ and is converted on the newest Gemini Flash. ST joins same-depth same-role injections, and Claude/Merge converters join consecutive same-role messages — an assistant-role note next to the chapter is appended into the chapter text. → Never inject instructions as assistant.

**Labelling:** Anthropic: one tag per kind of content (`<instructions>`, `<document>`…); OpenAI: Markdown or XML, JSON poor; Gemini: pick one format and keep to it. Spotlighting (arxiv 2403.14720): marking where reference text starts and ends makes the model treat it as data. Formatting alone can swing accuracy by up to 76 points and the best format varies by model (arxiv 2310.11324) — test on the target model. Marinara's universal preset wraps card fields in `<setting>`, `<characters>` tags [community].

**Thinking models:** don't ask for chain-of-thought (OpenAI, Gemini); reasoning can cost constraint adherence (arxiv 2505.11423, 2505.14810); DeepSeek V4 drops earlier reasoning. Notes must be clearly marked as non-story or a reasoning model may narrate them.

**Prompt Post-Processing** (ST) replaces "squash system messages": None / Merge / Semi-strict (one leading system, rest become user) / Strict / Single user. For Custom endpoints (Venice), Semi-strict is the safe setting.

### Placement rules adopted for Storyloom
| Content | Slot / role / depth | Label |
|---|---|---|
| Standing craft (how to write a book) | Main Prompt, system, top | its own headed sections, reasons given |
| Narrator voice for this book | narrator card (system, top) | HOW THIS BOOK IS TOLD |
| Book facts, profiles | World Info, system, top (wrapped by the preset's World Info format) | "BOOK REFERENCE — facts, not instructions"; each entry names its subject on its first line |
| Story so far | top-of-chat, system | "reference: settled history" |
| Previous-chapter hand-off, this chapter's plan, scene now | in-chat, **user**, depth 1, one labelled block | `<writer_notes>`-style labels; precedence stated |
| Length + end signal + "write chapter N" | in-chat, **user**, depth 0 (last) | "WHAT TO WRITE NOW" |
| Author's own message | real user message, untouched | named as top authority |
| Post-History | one or two lines | — |
Precedence, stated in words in the Main Prompt: the author's latest message > this chapter's plan > scene now > the hand-off > story so far; book facts are canon unless the author changes them; notes are for the writer, never quoted or narrated.

## 5. The chapter team: how AI checkers, editors, readers, revisers and summarisers fail (research agent report, 2026-11-14) — condensed, sources kept

Labels: [paper], [preprint] (unreviewed 2026), [vendor docs], [community], [single opinion].

### Critics and checkers (Lint, Editor)
- **Over-correction:** asked whether correct code meets its spec, models reject much of it; adding "explain" and "propose a fix" made it far worse (GPT-4o acceptance of correct solutions 52.4% → 11%). arxiv 2508.12358 [paper]
- **Invented problems grow with thoroughness** (CriticGPT): more nitpicks and invented bugs than humans; longer critiques catch more real and more fake issues; severity overstated; every point tied to a quoted highlight. arxiv 2407.00215 [paper]
- **Sycophancy:** feedback is more positive when the text is "mine/liked", more negative when disliked. arxiv 2310.13548; judges are lenient and length-sensitive, arxiv 2406.12624 [paper]
- **Self-preference:** judges favour their own outputs. arxiv 2404.13076 [paper] → use a different model from the writer where possible.
- **Reference-guided judging** beats chain-of-thought alone (failures 70% → 30% CoT → 15% with a reference); with CoT alone the judge copied the flawed reasoning. arxiv 2306.05685 [paper]
- **Criteria bleed:** one error lowers unrelated criteria; detailed definitions help somewhat. arxiv 2402.12055 [paper]
- **Inconsistent severity:** low self-agreement; binary pass/fail per criterion beats 1–5 scales. arxiv 2510.27106 [paper]; hamel.dev evals FAQ [community]
- **Checklists** raise judge–human agreement (46.4% → 52.2%). arxiv 2410.03608 [paper]
- **Finding is the weak step, fixing is easy once located**; self-correction without outside signal can make things worse. arxiv 2311.08516, 2310.01798 [paper]
- **Grounding:** allow "nothing found"; pull verbatim quotes first; retract claims without a supporting quote; use only the provided documents (Anthropic, reduce-hallucinations docs). Chain-of-Verification: answer verification questions without seeing the draft (arxiv 2309.11495).
- **Long inputs:** middle used worst; reliability falls with length and with similar-but-wrong passages (Chroma "context rot"); put instructions before and after the long text (GPT-4.1 guide).

### Continuity in long fiction
- **ConStory-Bench** (arxiv 2603.05890, ACL Findings 2026): 5 categories / 19 subtypes (timeline & plot logic; characterisation incl. memory/knowledge; world rules & geography; factual detail incl. names/quantities; narrative & style incl. POV). Factual-detail and timeline errors dominate; errors grow with length and cluster 40–60% through. Best checker: extract contradiction-prone spans by category → pairwise consistent/contradictory → evidence chain with quotes. Precision 0.88, recall 0.55 (professional writers 0.17). Deliberate twists can be flagged.
- **FlawedFictions** (arxiv 2504.11900): plot-hole detection collapses with length (0.67 → 0.35 at ~2,700 words); more reasoning didn't reliably help; a separate verifier pass did (0.35 → 0.50). False positives: reading a bluff as inconsistency, genre magic as a logic error, over-literal rule reading. Tracking errors: miscounting characters, elapsed time.
- **FactTrack** (arxiv 2407.16347): atomic facts with a validity interval, so a changed fact isn't a contradiction.
- **TimeChara** (arxiv 2405.18027): models leak future events and knowledge a character can't have yet.
- **Belief tracking** (OpenToM arxiv 2402.06044): physical state OK, mental state weak; models update beliefs of characters who weren't there.

### Editing and revision
- **Voice Under Revision** (arxiv 2604.22142 [preprint], personal narratives): every model moved every style marker the same way — contractions −31%, first-person −9%, vocabulary diversity +53%, commas +67%, dashes +326%, emotion words +14%, longer words and sentences; narration became retrospective and distanced. A voice-preserving prompt cut the change ~32% but not its direction.
- **Meaning drift** even in "grammar only" edits (arxiv 2603.18161 [preprint]); **style flattening** (arxiv 2502.11266).
- **What professional writers flag in LLM prose** (arxiv 2409.14509): cliché, unnecessary exposition, purple prose, poor sentence structure, lack of specificity, awkward word choice, tense inconsistency. Detection separated from rewriting.
- **Over-correction in minimal-edit tasks:** fluency rewrites when asked only to correct; restricting to allowed edit types helps (arxiv 2609.10810 [preprint]).
- **Dialect "corrected"** into standard English; prompting a weak fix (arxiv 2607.06845 [preprint]).
- **Edit formats:** exact old text → new text, no line numbers (OpenAI GPT-4.1 guide; Aider). Whole-chapter rewrites risk compression — output length is capped near ~2,000 words by fine-tuning (LongWriter arxiv 2408.07055).
- **Homogeneity:** different LLMs write far more alike than different humans (arxiv 2501.19361).

### Beta reader
- **Help Me Write a Story** (arxiv 2507.16007): feedback specific and mostly accurate, but models miss the biggest problem, misjudge when to praise, comment on style over coherence, misread intent; a bulleted taxonomy prompt worked best; examples get echoed.
- LLMs track suspense direction but not turning points (arxiv 2508.15794 [preprint]); LLM judges don't match experts on creativity (arxiv 2309.14556); personas flatten into stereotypes (arxiv 2402.01908); asking for distinct reactions raises diversity (verbalized sampling, arxiv 2510.01171). AI beta reports open with praise and tack on timid criticism [single opinion].

### Summaries for story memory (Seal, live memory)
- **FABLES** (arxiv 2404.01261): unfaithful claims mostly about character/relationship state (39%) and events (32%); omissions common; chronology errors in 33–62%; over-weighting the ending; LLM raters poor at catching it.
- **BooookScore** (arxiv 2310.00785): running summaries keep detail but add coherence errors; most common error = an entity mentioned without the context to understand it; then missing details and causes.
- **Circumstantial inference:** ~38% of summary errors are plausible but unstated inferences (inventing a relationship); misattribution (arxiv 2406.03487).
- **Hedges dropped, claims hardened** (66% of distortions) (ACL AACL 2026.223).
- **Chain of Density** (arxiv 2309.04269): add missing specific entities without lengthening.
- Summaries create continuity errors (+50%, FlawedFictions). Anthropic context engineering: maximise recall, then trim; keep decisions and open issues; structured notes. ST docs: summaries lose details or hallucinate.

### What each role is told (adopted)
- **Lint:** check only against supplied sources (no general advice, no realism, no taste); every finding quotes the chapter AND the source it breaks — no quote, no finding; "no problems" is a normal result; two passes (list the chapter's assertions by category: who is where, injured, holding, knowing; times; names; world rules; POV — then compare each); a fact that changes on the page isn't a contradiction; ask "could this be deliberate?" (lie, bluff, dialect, twist); check who-knows-what and later-chapter leaks; binary severity; no rewrites; instructions before and after the chapter. Code: drop findings whose quote isn't an exact substring.
- **Editor:** only these note types: the author's rules + cliché, unnecessary exposition, purple prose, sentence structure, vagueness, word choice, tense; anchor to a short exact span; must only with a citable rule/plan/clear error; lead with the single biggest problem; never mark the author's voice markers as problems; never suggest dashes, fancier words, emotion words or explanations; "no notes" is fine; don't say who wrote it; no example notes.
- **Reader:** concrete persona, only earlier chapters + hand-off; reactions quote a line and are one of expecting / confused / bored / invested / surprised / didn't believe it; praise quoted like criticism, no opening compliments; end with "what I think happens next" and "what I'm worried about".
- **Revise:** apply only the listed notes; return exact old → new pairs (old copied verbatim), not whole parts; keep contractions, sentence lengths, punctuation, vocabulary, dialect, tense, immediacy; add no dashes, emotion words, explanation; don't change meaning or length.
- **Seal:** fixed fields — per-character state (where, condition, holding, feeling toward whom, KNOWS, DOES NOT KNOW), timeline, open threads, must-not-drift with quotes; specifics (names, numbers, objects); only what's stated, keep negations and uncertainty; cover the whole chapter, not mainly the ending; never merge characters; plain notes for another model; last page copied in code.
- **Scene tracker / running summary:** update only what changed; who's present and who knows what; never drop open threads or negations.

## 6. The wizard, the lorebook and outlines written for another model; the Assistant (research agent report, 2026-11-14) — condensed, sources kept

### Brainstorming partners
- Tuned models make co-written text more alike (arxiv 2309.05196); AI ideas raise individual quality but lower collective diversity (Science Advances 2024, PMC11244532); ChatGPT users converge and feel less ownership (C&C 2024, Kreminski).
- **Stock names and settings:** "Elias in the Lighthouse, Again?" (Hamilton & Mimno, EMNLP 2026, via Cornell press release): ~20,000 stories from ChatGPT, Claude, Gemini, OLMo; ~90% contain at least one of 11 recurring words incl. *Elias, Mara, Elara, lighthouse, keeper*; over half had a lighthouse. Instruct models put ~77% of probability on 10 names (HF blog, ChuckMcSneed). (Storyloom's own old test book was literally Mara in a lighthouse.)
- Asking for several candidates with probabilities restores diversity 1.6–2.1× (Verbalized Sampling, arxiv 2510.01171); step-by-step distinct ideas widen the pool (SSRN 4708466).
- **LLM stories place the setback and climax too early, avoid "riches to rags", default to happy uniform arcs; planning turning points explicitly raised suspense preference 7.9% → 48.3%** (arxiv 2407.13248, EMNLP 2024).
- Sycophancy: feedback follows the user's stated opinion (arxiv 2310.13548); OpenAI rolled back a too-agreeable GPT-4o (Apr 2025); Claude's consumer prompt forbids opening by calling an idea good/great/fascinating.
- Lost in conversation: when a request is revealed over turns, models settle assumptions early and don't recover (−39%, arxiv 2505.06120) → restate decisions after each topic.
- Questioning: model-asked questions elicit better specs (arxiv 2310.11589); one question at a time, no double-barrelled questions (Pew); open questions without example answers first, then 2–3 options, say defaults aloud.
- Ownership: writers want suggestions they can accept/reject; direct insertion feels like losing ownership (arxiv 2504.12488, DIS 2022, arxiv 2601.10236).

### Entries another model reads (lorebook, profiles)
- **ST World Info:** only Content is inserted — title and keys never reach the model; each entry must stand alone and name its subject. Keys match whole words, case-insensitive; constant entries first, then higher Order nearer the end; budget cuts off later entries; recursion; timed effects count messages, not chapters; WI guides but doesn't guarantee. (docs.sillytavern.app worldinfo) NovelAI: the title is invisible, so the name must be in the text; verbose entries make verbose prose.
- **Novelcrafter Codex:** start small; scale to importance (1–3 sentences minor, 3–4 paragraphs main characters); prose vs headings matters little; keep physical description out unless you want it repeated (the AI latches onto details); **keep spoilers and future plot out — the AI reads the whole entry whatever chapter it is**; record change as progressions; link, don't duplicate. Anything mentioned early resurfaces (the red ball). **Keep the whole-book summary away from the writing AI; it foreshadows endings.**
- Character guides (kingbri, Ali:Chat, JED, pixi, Moki, Sukino): show traits through behaviour and sample speech, not adjective lists; give each trait a reason so the model generalises; contrast surface vs inside; speech quirks because models give everyone the same voice; "When [situation]: how they act"; relationships one line each; word choice leaks into prose; naming a concept, even negatively, pulls it in.
- Secrets: a profile is injected whenever the name matches, so anything in it is visible from chapter 1; ST Delay counts messages, not chapters → reveal facts must be withheld by chapter (Storyloom-side), not left in the profile.

### Outlines for drafting
- Re3 (arxiv 2210.06774), DOC (2212.10077): plan, then draft with the plan injected; more detailed hierarchical outlines move creative work into planning (+22.5% coherence).
- CONCOCT (2311.04459): LLM outlines pace unevenly; expand the vaguest items first so every item is equally concrete.
- DOME (2412.13575): rough outline, then alternate detailed chapter outline and chapter text so later plans adapt to what was written.
- Sudowrite: each beat needs "somebody, somewhere, something that changes"; mood beats give the model nothing; too many beats = overlong chapter; fix causality first, the drafting step follows the plan's flaws faithfully.

### Voice
- Examples steer tone most reliably; explain why; say what to do; match the prompt's own style (Anthropic). Sample phrases get reused verbatim (OpenAI). A few samples beat none, more add little, output drifts generic (arxiv 2509.14543). Novelcrafter: style = how, genre = what; POV and language first; few rules, bounded; an author-written opening passage keeps the AI truer to style.
- Seven recurring LLM prose problems (arxiv 2409.14509, CHI 2025): cliché, unnecessary exposition, purple prose, poor sentence structure, lack of specificity, awkward word choice, tense inconsistency — in GPT-4o, Claude 3.5, Llama 3.1.

### The setup Assistant
- Allow "I don't know"; quote then answer; restrict to provided docs (Anthropic). Models answer wrongly rather than abstain when retrieved context is insufficient (arxiv 2411.06037). Citation support incomplete about half the time (2305.14627). Models invent package names and policies (USENIX 2025; Cursor "Sam"; Moffatt v. Air Canada). Ask for missing information (OpenAI). Make errors easy to correct; disambiguate when unsure (Microsoft HAI G9/G10). Confirm risky actions.

### What each prompt is told (adopted)
- **Simple interviewer:** acknowledge without compliments; record the author's words; if vague, one short follow-up; "don't know" stays open; no name suggestions unless asked, and then names that fit the place and era, never the stock list.
- **Deep partner:** the author's ideas are canon; name a problem once with the reason, then follow the author; set the obvious idea aside and offer distinct options on a named axis, one unexpected; mark contributions as suggestions; push for setbacks, costs and turning points; restate what was decided after each topic; no flattery.
- **Proposal:** only agreed facts, author's phrasing; list what you added; turning points placed, the setback not too early.
- **Foundation / lorebook:** written for another model; the subject named in the first line; plain present tense; the foundation is the story **as it stands at chapter 1** — no ending, no later twists (those live in the outline, which the narrator sees only a chapter at a time); places 2–5 sentences with one sensory anchor; no duplication; keys = proper names.
- **Voice and rules:** POV, tense, distance first; rules phrased as what to do, each with its reason; aimed at the known LLM problems.
- **Profiles:** as at story start; traits as behaviour ("When X, she does Y, because Z"); one contradiction; speech rhythm, vocabulary, what they avoid saying, 2–3 sample lines unlike the others (voice only, not to reuse); appearance 1–2 anchors; relationships one line each; secrets as behaviour, reveal facts kept out of the profile.
- **Outline:** per chapter: starting situation, concrete beats (who, where, what changes), cause and effect, end state, what stays unrevealed; equal concreteness; no mood beats; turning points where the author put them, payoffs not before their chapter.
- **Fresh-eyes review:** check contradictions, future events visible in always-on entries or profiles, additions not traceable to the author, stock names, pacing (early climax, over-packed chapters, nothing-changes chapters), duplication; quote, smallest fix; nothing found is fine.
- **Assistant:** answer from the snapshot and the docs, name the page; never name a setting not in them; say when unsure; propose changes as cards with why; say whether behaviour comes from Storyloom, SillyTavern or the model.

## 7. Anti-slop lists, consolidated (fiction-relevant parts)

Sources read: tropes.fyi (gist.github.com/ossa-ma/f3baa9d25154c33095e22272c631f5a1) [G]; anti-slop-writing writing.md v7 (github.com/mradamcole/anti-slop-writing) [AS]; stop-slop SKILL.md + phrases + structures (github.com/hardikpandya/stop-slop) [SS]; slop-score data files slop_list.json and slop_list_trigrams.json (github.com/sam-paech/slop-score) [SP]. [AS] treats its list as "warning lights, not forbidden tokens" and warns against adding fragments or quirks just to sound human; [SS] bans bluntly (no em dashes at all, kill all adverbs). Blanket bans can hurt fiction; check against the book's voice.

- **Sentence patterns:** negative parallelism ("It's not X. It's Y.", "not because X, but because Y") [G, SS]; countdown negation ("Not X. Not Y. Just Z.") [G, SS]; self-posed rhetorical questions ("The worst part? Nobody saw it coming.") [G]; rule of three, often chained [G, SS]; trailing -ing clauses ("…, underscoring his role") [G, AS]; staccato fragments for drama [G, SS]; three sentences of equal length in a row [SS]; every paragraph ending on a punchy one-liner or a quotable line [SS]; em-dash clusters (a human uses 2–3 per piece; AI 20+) [G].
- **Dialogue:** stacked "said, voice X" tags — the slop-score trigrams are dominated by them: voice barely (a) whisper, said voice low/steady/soft/tight/trembling/laced/tinged [SP]; tag adverbs (cautiously, warily, grimly, absently…) and stock speech verbs (barked, hissed, murmured, rasped, growled, scoffed…) [SP]; throat-clearing ("Here's the thing", "Look,", "The truth is") [SS]; chatbot residue and compliment sandwiches in characters' mouths [AS, G].
- **Emotion and interiority:** heart pounding/hammering, blood ran cold, a chill/shiver ran down the spine, a growing sense of dread/unease, a glimmer of hope, knuckles white, mind racing, breath caught in the throat, took a deep breath, eyes wide with fear, tears streaming, felt like an eternity, a renewed sense of purpose [SP]; emotion nouns (dread, unease, trepidation, disbelief, bewilderment) [SP]; vague declaratives ("The stakes were high") [SS].
- **Description:** casting long shadows, the sun dipped below the horizon, the air thick with the scent of…, dust motes danced, a dimly lit room, painting the sky in hues of…, the room fell silent, the door creaked open [SP]; light and atmosphere words (shimmering, ethereal, flickering, gleaming, tendrils, palpable, otherworldly, iridescent) [SP]; stock setting nouns (cobblestones, lamplight, floorboards, windowpane) [SP]; one metaphor repeated through the piece [G].
- **Characterisation:** smirked, grinned, scowled, chuckled, sighed, a smile playing on her lips, brow furrowed in concern, eyes locked onto, never leaving [SP]; stock invented names — the slop list is dominated by them (Elara, Lyra, Kaelen, Seraphina, Aethelgard, Elias, Silas, Evelyn…) [SP].
- **Structure and endings:** recap and callback closers ("And so we return to where we began") [G]; restating one point many ways [G]; meta signposting ("Plot twist:", "As we'll see") [SS].
- **Word choice:** delve, tapestry, testament to, pivotal, intricate, vibrant, unwavering, profound, palpable, a dance of… [G, AS, SP]; magic understatement adverbs ("quietly", "deeply") [G]; "serves as / stands as" for "is" [G].

The scoring benchmark behind slop-score weights words 60%, "not X but Y" 25%, trigrams 15% (EQ-Bench). Its "top N" lists are file order, not frequency.

---

## How Storyloom uses this

- Prompts are written to the model about the model: what models do at this job, what to do instead, and why. Calm prose, no capitals for emphasis; the prompt's own style matches what we want back.
- Lists of banned habits are short and every item carries its replacement (prompt bans alone "almost don't work" and naming a thing can prime it); the rest is caught by Lint's exact checks, visibly, never silently rewritten.
- Long reference goes at the top as system; what to do now goes last as **user**; assistant is only ever the model's own prose. Every block says what it is; the precedence is written out in words.
- Each checker gets only the sources it checks against, must quote the chapter and the source, may report nothing, and is told what models wrongly flag. Revise edits exact passages instead of rewriting whole parts.
- The setup wizard writes for the narrator model: entries name their subject, hold no review markers and no future plot, profiles show behaviour and speech, and the outline gives each chapter concrete beats with causes and an end state.
