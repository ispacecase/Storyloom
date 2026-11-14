# Changelog

## 0.24 (2026-11-14)
**Every prompt rewritten to teach the AI its job.** Research first (saved in [docs/ai-prompting-research.md](docs/ai-prompting-research.md): how language models fail at fiction, checking, editing, summarising and planning, and where each piece of a prompt should go), then tested on whole books and read chapter by chapter.
- **The narrator** is told what models get wrong when they write fiction (rushing and stopping at half length, frictionless conflict, named feelings, one shared voice, echoed lines, explained subtext, wrap-up endings) and what to do instead, with a map of every labelled part of its prompt and which one wins when two disagree. Your Storyloom presets and narrator card update themselves (only Storyloom's own text; backed up; you're told).
- **What the narrator is sent, and where:** reference at the top; the hand-off, this chapter's plan and the scene card as the author's notes, right before the chapter; one clear WHAT TO WRITE NOW request last (DeepSeek moves "system" notes to the top, so these go in as user). Every lorebook entry now names what it describes; review marks are gone; the book's foundation is sent without its milestones and ending, and each character's arc lives in a planning entry, because models foreshadow what they can see. The whole outline is off by default. Character entries are sent from a chapter's first line. With Storyloom's narrator the old writing directive is no longer sent twice.
- **The chapter team:** Lint reports only what it can quote and show breaks the book (no "no fault" padding; an echo check; your rules and a person not in the book are hard findings). The Editor makes the few notes that matter, echoes and contradictions first, and leaves your voice alone. The Reader is honest. **Revise makes exact edits** (find this → replace with that) instead of rewriting parts — no more drift, shortening or "incomplete revision"; edits that don't match exactly, or would break quotation marks, are left out and shown. Seal writes for the next chapter's AI and flags rule breaks instead of making them canon.
- **The setup wizard** writes for the narrator AI: no flattery, your tone in your words, profiles that show people through behaviour and describe how they talk (no quoted lines to copy, no habits to repeat), secrets under KEPT HIDDEN, concrete chapter plans with the setback and climax where you put them, and a review that checks the plan against your rules. The lorebook takes the book's title as soon as the plan exists, and the panel always shows which lorebook the book uses.
- **The Assistant** proposes the change itself (as a card) instead of telling you how, uses the real entry names, and knows how to add a person.
- **Second test book, read in full ("Fair Market Value"):** profiles keep the ending and later decisions out of what the narrator sees (Lint flags a line copied from a profile into a chapter); Lint's checker puts everything that's fine in a section Storyloom throws away, so "met / fine / no break" padding is gone; Lint's echo check catches a reply that opens by repeating the last line; "possible new name" findings start unticked; the Editor's no-change notes and the Reader's praise never reach Revise, and only the Reader's "must" reactions are ticked for it; Revise is told not to invent answers, explain, change how numbers are written or follow a note whose claim is wrong; Story so far keeps what's finished and every number the page fixed.
- **Your defaults, and an Assistant that can change anything.** Tell the Assistant how you want something to work — how the narrator writes, what the Checker looks for, how the Editor edits, what the wizard asks, any Storyloom setting, the Memory tab — and it proposes the exact change as a card; Apply makes it your default for every book, Undo puts it back. Your versions are kept by Writing setup and by updates (a Main Prompt you changed by hand is kept as yours instead of being rebuilt over), and when Storyloom later improves its own text you're offered the improvement, added only where you haven't changed those lines. Settings → **Your defaults** lists what's yours, with Show and "Use Storyloom's again". A change to a built-in template makes your own copy, which new books start from.
- **Third test book, read in full ("Dual Brakes", five chapters):** the narrator's habits list now says what to write instead of quoting bad examples; the main character no longer wins every exchange; things keep the look they were given (the hand-off records vehicles, materials, colours and sizes). Profiles list no habits or gestures and **describe how people talk instead of quoting sample lines** — the narrator copied profile lines into every test draft. Each chapter's plan says what goes wrong. Lint catches more: a gesture repeated in a chapter, "and… and… and" chains (fixed when a chapter leans on them), a single sentence in the wrong tense, and many more echoes (a word said back, a pronoun-swapped repeat, a line lifted from the middle of the last one — but not a greeting or a choice picked from the ones offered). **Lint takes a second look at its "hard" findings** before anything is changed: a separate check that sees the chapter and the claim, not the first checker's reasoning; what doesn't hold up stays on screen, unticked, with the reason. Revise is told that trimming an echo is still an echo, says how many echoes are left, and an edit that would cut most of a passage without being asked is left out and shown.
- **A new chat is never a dead end:** the start screens list the books you're writing with an Open button for each.
- **When a reply gets cut off:** the narrator sometimes spends most of the reply limit thinking (9,500 of 12,000 tokens in a test). Storyloom now sizes the room a chapter needs from how much this narrator has actually been thinking, and the bar at the top says how high to raise Max Response Length. If a Continue writes the narrator's own planning notes (`<analysis>`, `<summary>`…) into the chapter, they're taken out and you're told; if it comes back in pieces (a restarted sentence, `###` breaks, all the dialogue in one block), the added part is repaired — the words as written — and you're told.
- **Campaigns:** the bar at the top says what to do next — set up the Game Master if the chat still has the novel narrator, then "your move, in the chat". The player's own character gets only what the player said in its profile, never an invented past or inner life. Lint flags narration where the game master makes the player's character act or speak ("You ease the crawler forward"), and its second look runs on campaign sessions too.
- **Fixed:** swiping a finished chapter for another version asked the narrator for "only the end mark"; sample lines on their own line in a profile weren't checked; the "book is finished — save it?" question held Storyloom busy (an unanswered one blocked everything); a chapter at full length without the end mark was called done on the button and "not finished" in a message.
- **Bit by bit is paced by the plan:** each press is told the chapter's planned events and how many it covers, so the first press no longer runs through the whole chapter; the chapter length setting shows in this mode too; a chapter well past its length counts as finished if the narrator forgets the end mark; stopping while the narrator is still thinking no longer leaves an empty reply.
- **Fixes:** bit by bit no longer says "finished" after one part; the Write button turns into Stop; "Keep writing" never runs past the chapter's planned ending; a chapter at full length counts as finished even if the narrator forgets to say so; live memory follows how you write (scene card after every reply, no pointless running summary for one-reply chapters); Create outline retries an incomplete reply instead of needing a second press; the Story chat saves what you ask for and tells you if the AI claimed a change it didn't make; the scene card is cleared between chapters; "(you said 90%)" no longer claims words you didn't say.

## 0.23 (2026-11-14)
- **The narrator is taught how *not* to write like an AI.** The Storyloom Novel (and Roleplay) Main Prompt is rewritten as instructions to the model about the model's own failings, with a list of **AI writing habits — never do these**: echoed lines ("Lasagne." "Lasagne."), explained subtext, "not X but Y", punchline endings, therapy-speak, conflicts that melt into a hug, body-language autopilot, stock phrases, rhythms of three, hedging, recaps — each with what to write instead. Existing Storyloom presets are updated automatically when you update (backed up first); a prompt you edited yourself is left alone and you're told.
- Auto: if the Editor's rewrite comes back incomplete, the chapter is kept as written and Auto goes on to Seal (you're told) instead of stopping.
- **One button to write the book.** At the top of the Storyloom panel: **✍ Write Chapter 1**. Press it and the narrator writes the chapter. When the chapter reaches its ending the button turns into **✓ Chapter 1 is done — Next chapter →**: one click checks and seals it, opens Chapter 2 in a fresh chat with the same narrator, and starts writing. A line under the button says where you are (chapter, title, words so far, and a warning if your response limit is too small).
- Fixed: **Words per reply no longer caps a chapter** when chapters are written all at once. The chapter's length comes from the book's plan; you can change it for every chapter in Settings (**Chapter length**).
- Settings reworded in plain words and marked as optional: *How chapters get written* (All at once / Bit by bit), *Help the narrator remember*, *Speed*.
- Switching All at once / Bit by bit updates the Storyloom Novel preset itself — only Storyloom's own text; anything you edited is left alone and you're told.

## 0.22 (2026-11-14)
- The writing settings (chapter length, keep going, live memory, thinking) are in Storyloom's own Settings, grouped and explained in plain words; still in the Extensions menu too.
- One calculation for how many words fit the response limit.

## 0.20 (2026-11-14)
- **Chapter done / not finished** notices, so you don't have to read a chapter to know where it stands: the narrator signals the planned ending (the signal is removed from the text and the export), Storyloom marks the reply and tells you. Optional **Keep going until the chapter is done** (off by default).
- **One reply = one whole chapter** by default: the narrator's instructions no longer say "one passage at a time", and the hidden 1,500-word cap is gone. Writing a chapter over several replies is now an option (Extensions → Storyloom), off by default. Existing Storyloom Novel presets: run Writing setup… (first box) to update them.

## 0.19 (2026-11-14)
- Fixed: a chapter length written in words ("one evening's worth") was read as 1 word, so replies were asked for "about 1 word". Lengths under 200 words are now ignored, roleplay replies don't follow the session length, and the line under *Words per narrator reply* says exactly what cap is used and why.
- **Compare narrators fixes your narrator:** *Fix mine* and *Fix everything* edit your own text to fix only what's flagged, with a change view before anything is saved, and a backup of the old version.
- The Compare window follows your SillyTavern theme, so its buttons are readable.

## 0.18 (2026-11-14)
- **Live memory:** a *Scene now* card refreshed while you write, a running record of the chapter (*Earlier this chapter*), and on-stage characters' lorebook entries sent with every reply.
- Your own length direction ("about 200 words") overrides Storyloom's reply-length instruction.
- Roleplay fixes from an end-to-end campaign test: chapter headings set reliably, campaign genre and rules fill the game master's blanks, the player's character is named in the hand-off.

## 0.17
- **Roleplay mode** for Campaign books: sessions, the Storyloom Game Master and Roleplay preset, Lint with a "spoke or acted for your character" check, Seal tracking the player's character, two-sided export.
- Dials 0.2: **Dials settings…** opens Dials on Storyloom's settings; Dials shows the combined settings when Storyloom uses SillyTavern's.

## 0.16
- **Dials support:** Storyloom's calls go through Dials with their own settings (optionally the same as SillyTavern's chat), and real token usage appears in warnings and the log. Storyloom steps aside on reasoning settings and the per-reply counter.
- Full screen shows Book (Story + Memory) and Assistant tabs; the thinking box is bigger and resizable; no scroll boxes inside scroll boxes.

## 0.15
- **Full screen** mode; folding sections in the side panel.
- **Word and token counter** under each narrator reply, and chapter words against the plan.
- **Words per reply** follows the chapter's planned length from setup, with a per-chapter override in Book settings.
- `<ds_safety>` junk from Venice's deepseek is removed from replies and the export.

## 0.14
- **Chapter hand-off:** Seal records *where things stand*, *what happened* and the *last page* word for word; Lint checks the next chapter against them.
- **Words per narrator reply** setting, sent so the model actually follows it.
- Lenient **Auto**; cut-off and name-check fixes.

## 0.13
- **Compare narrators.**
- Short thinking for Storyloom's own calls; SillyTavern's Reasoning Effort sent to Custom endpoints such as Venice.
- **Start over** for the chapter steps.

## 0.12
- **Auto** runs the whole chapter workflow.
- Replies that stop mid-sentence are marked, explained and left out of the export; Revise never accepts a cut-off revision.

## 0.11
- **Export book** as Word (.docx) or text (.txt).

## 0.10
- **Writing setup:** the Storyloom Novel preset, the general narrator, and per-book settings, all changeable through the Assistant.
- Start a new book with no chat open; plan changes carry through everything that depends on them; Lint checks the plan and things meant for later chapters.

## 0.9
- **Backups** of everything Storyloom changes outside the lorebook; a narrator set up in all five places it can live; editable narrator template.

## 0.8
- **The chapter team** (Lint, Editor, Reader, Revise, Seal) with personalities and per-role models; settings in the Extensions menu; the log; dictation.

## 0.7 and earlier
- The proposal before building and the word budget; Lint and seal notes; the Memory tab, one chat per chapter; the Assistant with the SillyTavern docs; suggestions you approve; editable prompts and templates; the lorebook assistant itself.
