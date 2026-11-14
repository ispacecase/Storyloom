# Changelog

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
