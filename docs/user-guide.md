<p align="center"><img src="../assets/storyloom-logo.png" alt="Storyloom logo" width="200"></p>

# Storyloom user guide

Everything Storyloom does, where to find it, and what to do when something goes wrong. For a short overview, see the [README](../README.md).

- [How Storyloom fits into SillyTavern](#how-storyloom-fits-into-sillytavern)
- [Opening Storyloom](#opening-storyloom)
- [1. Planning: the setup wizard](#1-planning-the-setup-wizard)
- [2. Writing setup: preset, narrator, book settings](#2-writing-setup-preset-narrator-book-settings)
- [3. Writing a chapter](#3-writing-a-chapter)
- [4. The chapter team: Lint, Editor, Reader, Revise, Seal](#4-the-chapter-team-lint-editor-reader-revise-seal)
- [5. Memory](#5-memory)
- [6. Moving to the next chapter](#6-moving-to-the-next-chapter)
- [7. Roleplay and campaigns](#7-roleplay-and-campaigns)
- [8. Export](#8-export)
- [9. Compare narrators](#9-compare-narrators)
- [10. The Assistant](#10-the-assistant)
- [11. Dials](#11-dials)
- [12. Settings reference](#12-settings-reference)
- [13. Backups, Undo and the log](#13-backups-undo-and-the-log)
- [14. Troubleshooting](#14-troubleshooting)

---

## How Storyloom fits into SillyTavern

Writing a book with an AI goes wrong in predictable ways. It forgets what happened. It contradicts itself, writes ahead of the plan, slips point of view, or answers you like a chatbot instead of writing prose. Storyloom puts each kind of information where the model handles it best:

| Layer | Where it lives | What it holds |
|---|---|---|
| **Craft** | The preset's Main Prompt (*Storyloom Novel* / *Storyloom Roleplay*) | How to write: live scene, subtext, one point of view, ending on an open beat. The same for every book. |
| **Narrator** | A character card (*Storyloom Narrator* / *Storyloom Game Master*) | Who tells the story and how: point of view, tense, voice, tone, genre, your rules. Its blanks fill in from each book. |
| **Facts** | The book's lorebook | People, places, history, the outline, the current chapter's plan. |
| **Memory** | Hidden entries Storyloom sends itself | What happened, how the last chapter ended, the scene right now. |
| **Last word** | Post-History Instructions | A short reminder read just before every reply. |

You write in SillyTavern's own chat, **one chat per chapter** (or session). Storyloom works in a side panel and adds what the model needs to each reply behind the scenes. None of that appears in your chat.

## Opening Storyloom

- The **feather** beside the message box, or **Extensions → Storyloom → Open Storyloom panel**.
- The panel has three tabs: **Story** (planning chat, lorebook tools, suggestions), **Memory** (the chapter team and what the AI remembers) and **Assistant** (questions about SillyTavern).
- **⤢ Full screen** spreads the panel across the page: Story and Memory side by side, with the Assistant on its own tab. **⤡ Side panel** puts it back.
- In the side panel, extra sections fold up (▸). Click to open; each remembers how you left it.

## 1. Planning: the setup wizard

1. With no chat open, click **Start a new book**. It opens a fresh chat with the general narrator. Or open any chat and choose **＋ Start a new novel** under *Lorebook for this chat*.
2. Pick a **template**:
   - **Novel**: chapters, point of view and tense, people, places, plot.
   - **Campaign (roleplay / D&D)**: sessions, table rules, factions, player characters and NPCs. See [Roleplay and campaigns](#7-roleplay-and-campaigns).
   - Your own: Extensions → Storyloom → Templates. **Save as new** copies a built-in one to edit.
3. Pick **Simple** (answer or skip each question; the AI fills in the rest) or **Deep** (talk each topic through).
4. Storyloom writes a **proposal**: what the story is about, the timeline, what happens, the number of chapters and their length, the cast. Nothing is built until you **Approve and build**. To change something, say it and it revises.
5. It builds the lorebook: a summary entry, voice and rules, places, a cast list, an outline, and a full profile for each character. It's arranged so the main chat sees the right entries: some always on, people and places by name, planning notes off.

**Changing the plan later.** Just ask in the Story chat, e.g. "make it 20 chapters" or "make each chapter about 9,000 words". Storyloom merges outline edits chapter by chapter and updates everything that depends on them: the chapter list, the current chapter's plan, the word budget and the book settings.

**Suggestions.** Sometimes the AI thinks the book needs an extra entry or a change. Those wait under **Suggestions** with the reason and the exact text, until you approve or skip them.

## 2. Writing setup: preset, narrator, book settings

On the Memory tab, **Writing setup…** does three things, each with its own tick box:

- **How to write a book** (or **How to run the story** for a campaign). Makes the *Storyloom Novel* (or *Storyloom Roleplay*) preset as a **copy of your current preset**, and switches to it. Only its writing prompts change; your sliders and your own preset stay exactly as they are. Its Main Prompt is written to the model about the model: the ways language models write fiction badly — rushing scenes, frictionless conflict, named feelings, polished same-voice dialogue — and a list of **AI writing habits to never do** (echoed lines like "Lasagne." "Lasagne.", explained subtext, "not X but Y", punchline endings, therapy-speak, body-language autopilot, stock phrases…), each with what to write instead. When Storyloom updates these instructions, it updates your Storyloom presets too — unless you've edited that prompt yourself, in which case it's left alone and you're told.
- **The narrator** (or **The game master**). Uses the general *Storyloom Narrator* (or *Storyloom Game Master*), creating it if needed, and opens this chapter in a fresh chat with it. Everything carries over.
- **This book's settings.** Fills the narrator's blanks from the lorebook.

**Book settings…** shows those blanks for the current chapter: narrator, point of view, tense, voice, tone, genre and your rules, plus **Words for this chapter**. Change any of them for **just this chapter**, e.g. first person for one chapter told by someone else. **Back to the book's settings** undoes that. The book's own record stays in its voice entry.

## 3. Writing a chapter

- **The Write button.** At the top of the Storyloom panel there's one big button. It always says what happens next:
  - **✍ Write Chapter 1** — the narrator writes the whole chapter, from its plan and memory, to the planned ending. Want to steer? Type a direction in the chat box first ("start at the funeral"), then press it. (Pressing SillyTavern's own Send with an empty box does the same.)
  - **✍ Keep writing Chapter 1** — the chapter isn't at its ending yet (or the last reply was cut off); this carries on from where it stopped.
  - **✓ Chapter 1 is done — Next chapter →** — one click checks the chapter (Auto), seals it, opens Chapter 2 in a fresh chat with the same narrator, and starts writing it.
  - The line under the button says where you are: chapter, title, words so far against the chapter's length, and a warning if your Max Response Length is too small for the chapter.
- **Length:** a chapter is written to its length from the book's plan (WORDS PER CHAPTER). Change it for every chapter in Settings → **Chapter length**, or for one chapter in Book settings…. As far as your **Max Response Length** fits.
  - **Your direction always wins.** If your message asks for a length ("about 200 words", "keep it short"), Storyloom leaves its own length instruction out for that reply.
  - *Bit by bit* (Settings → How chapters get written) writes a chapter over several presses instead; there, **Words each time you press Write** sets the size of each part.
- **Knowing when a chapter is done, without reading it:** the narrator ends the chapter with a hidden signal at the plan's ending. Storyloom removes it (it never appears in your story or the export), marks the reply *"✓ End of chapter"*, tells you *"Chapter N is done"*, and the button turns into **Next chapter**.
- **Keep going by itself** (Settings, off by default): if the narrator stops before the chapter's end, Storyloom carries on for you, up to the number of times you set, and stops if you start typing.
- **Under each reply** you'll see a small line, e.g. *1,014 words · 1,320 tokens · thinking 850 · 2,170 of 8,196*. It turns orange near the response limit. (With Dials installed, Dials shows its own line instead.)
- **Cut-off replies:** if a reply stops mid-sentence, Storyloom marks it (*"✂ This reply stopped mid-sentence"*) and tells you why: the response limit (thinking counts against it) or something else. Press **Continue** (☰ beside the message box) to finish it.
- **Dictation:** the 🎤 buttons on Storyloom's message boxes type what you say.

## 4. The chapter team: Lint, Editor, Reader, Revise, Seal

On the Memory tab, once the chapter's written:

| Step | What it does | You |
|---|---|---|
| **Lint** | Checks the chapter against the book. *Book checks:* continuity, timeline, character, voice, period, your rules, the plan (what it hasn't done yet), and anything that belongs to a later chapter. *Exact checks:* point of view, tense, unknown names, misspelt names, repetition, stock phrases, length, a reply cut off. | Untick findings you don't want acted on. |
| **Editor** | Marks up the pages: notes on exact passages saying what should change and why. Nothing is rewritten yet. | |
| **Reader** | Reads like a reader and notes what drags, confuses or doesn't land. | Keep or untick each note. |
| **Revise** | The Editor fixes the notes you kept. You see a word-by-word diff. | **Accept** (the original stays as the previous swipe) or **Discard**. |
| **Seal** | Signs the chapter off and writes the hand-off for the next one (see [Memory](#5-memory)). | Choose what's next. |

- **Auto ▶** runs whatever's left and seals. It's **lenient**: only hard Lint findings and the notes marked MUST get fixed, while style niggles (repeats, stock phrases, length guesses) are skipped. If the chapter stops mid-sentence, Auto stops after Lint.
- **↺ Start over** clears the findings, notes and any unaccepted revision, so you can run it all again from Lint. The chat isn't touched.
- Each role (Checker, Editor, Reader, Seal) has its own personality and can use **its own model**, or be switched off: Extensions → Storyloom → Chapter team.
- Revise refuses a revision that was cut off, came back much shorter, or never reached its end marker, so a broken reply can't replace your chapter.

## 5. Memory

Everything here is stored as switched-off entries in the book's lorebook (so it travels with the book) and sent by Storyloom itself. **It never appears in your chat.** You can read and edit each item on the Memory tab under *What the story AI remembers*. Extensions → Storyloom → Memory placement sets where each goes in the prompt.

### Between chapters (written by Seal)

- **Story so far:** everything settled, chapter by chapter.
- **Previously:** how the last chapter ended:
  - **Where things stand:** when it is; weather, light and sounds; where each person is, what they're doing and what shape they're in; how people stand with each other; who knows what; things left in a state; promises and plans.
  - **What happened:** every significant moment, in order.
  - **Summary,** plus *what changed*, *what the narrator now knows*, *must not drift* and *open threads*.
  - **Last page:** the chapter's final paragraphs, word for word, so the next chapter picks up the exact moment and the voice.
- **Character current state:** injuries, location, knowledge and possessions, written into each character's entry (offered as Suggestions).

The next chapter's narrator is told that everything in *Where things stand* is still true unless the story shows time passing. Lint checks the new chapter against it too, so if it was raining when Chapter 1 ended, Chapter 2 can't open in sunshine on the same day without Lint noticing.

### While you write (live memory)

- **Scene now:** a small card (when, where, who's here and in what shape, conditions, what's in hand, what just happened), refreshed every few replies and sent close to the end of the prompt.
- **Earlier this chapter:** once a chapter gets long, older messages are folded into a running record, so the model doesn't lose the chapter's start when it falls out of the context. Cleared when you Seal.
- **On stage:** before each reply, the lorebook entries of everyone in the scene card are sent, even if nobody has said their name lately.

Each live update is one small call to your model. Turn them on or off and set how often in Extensions → Storyloom → **Live memory**.

### Always

- **This chapter:** the plan for the chapter you're on, its length, and a line for each later chapter, marked "don't write any of this yet".
- **Whole outline:** for orientation, with the same warning.

## 6. Moving to the next chapter

The easy way: press **Next chapter →** on the Write button. Storyloom checks and seals the chapter, opens the next one in a fresh chat with the same narrator, and starts writing. If the Editor's rewrite comes back incomplete, the chapter is kept exactly as written and Seal goes ahead (you're told).

If you run Seal yourself (Memory tab), you choose:

- **Keep working on this chapter.** Nothing moves on.
- **Next chapter in this chat.** Memory moves forward; you keep writing in the same session.
- **Next chapter in a fresh session.** A new chat that opens with only the hand-off, the plan and the lorebook. You'll be asked who narrates it: keep the narrator, reuse an earlier one, or set up a new narration (another point of view, tense or register). Storyloom notices when the outline follows someone who has narrated before.

## 7. Roleplay and campaigns

A book on the **Campaign (roleplay / D&D)** template (or any template that counts sessions) runs as a roleplay:

- **Sessions,** not chapters.
- **The Game Master.** Writing setup makes the *Storyloom Roleplay* preset and the *Storyloom Game Master* card. It plays the world and everyone in it **except your character**. It never speaks, acts, thinks or decides for you, decides uncertain outcomes fairly, keeps the world consistent, and ends each reply where it's your turn.
- **Steps: Lint → Seal** (or Auto). The Editor, Reader and Revise don't apply when you write half the text.
- **Lint** checks the story only: continuity, timeline, character, voice, rules, names and cut-off replies. It adds one more check: **"Acted or spoke for your character"**, which catches the narrator playing you. Your turns are included and marked, so it can tell yours from its own.
- **Seal** also tracks your character between sessions: where they are, their condition, what they carry and know, what they promised, and what they did.
- **Export** includes both sides, with your turns marked with your character's name.
- **Compare narrators** flags a setup that never tells the model to leave your character alone.

## 8. Export

**Export book…** (Memory tab, and offered after you seal the last chapter) saves the whole book:

- **Word (.docx):** title page, each chapter on a new page. Opens in Word, Google Docs and LibreOffice.
- **Text (.txt):** plain text.

It takes the narrator's text only (the swipe that's showing), without your directions or the heading greetings, and leaves out the unfinished end of any reply that was cut off. Chapters written in earlier chats are found from what Seal recorded, or by chat name ("Book — Chapter 3 — …"). Anything it can't find gets a placeholder line, and it tells you which.

## 9. Compare narrators

**Compare narrators…** puts your narrator next to Storyloom's in every place a narrator's instructions live: the card's description, Main Prompt override, Character's Note and Post-History override, plus the preset's Main Prompt, Post-History, continue nudge, new-chat prompt, Auxiliary prompt and Enhance Definitions.

It flags problems in yours, such as:
- roleplay wording in a novel setup;
- demands for very long replies;
- no point of view or tense, or ones that clash with the book or between places;
- story names in the craft layer;
- Enhance Definitions switched on.

Then:
- **Fix mine** (on each flagged place): Storyloom edits *your* text to fix just what's flagged and keeps everything else word for word. You see a word-by-word change view (struck out = removed, highlighted = new) and **Apply** or **Discard**.
- **Fix everything** (at the top): fixes every flagged place at once and shows all the changes together, each with a tick box. Switches (like Enhance Definitions) are just switched; empty places get Storyloom's text.
- **Use Storyloom's**: swaps in Storyloom's whole version of one place instead.
- **Ask the Assistant what's wrong with mine**: a short written review.

Every change is backed up first; **Restore** in Backups puts yours back.

## 10. The Assistant

Ask anything about SillyTavern or your setup. Each question comes with a snapshot of your live settings (prompt order, lorebook scanning, Vector Storage, active lorebooks, Author's Note, the writing setup; **never API keys**) and the relevant sections of the official SillyTavern docs.

It can propose changes to your lorebook, the Storyloom preset's prompts, the book settings or the narrator card. Each one comes back as a card: nothing changes until you click **Apply**, and **Undo** reverses it.

## 11. Dials

[Dials](https://github.com/ispacecase/SillyDials) is a separate extension that shows every setting your provider supports and counts real token usage. With it installed:

- Storyloom's own calls go through Dials with **their own settings**. In Dials, pick **Settings for: Storyloom**; **Dials settings…** on the Memory tab opens it there.
- **Use the same Dials settings as SillyTavern's chat** (on by default): Storyloom's calls also use what you set for SillyTavern's chat on the same connection. Anything set for Storyloom itself wins.
- Dials handles thinking and reasoning settings, so Storyloom stops adding its own.
- Warnings and the log use Dials' real token numbers.

**Recommended:** set Storyloom's thinking to **none** in Dials. Checking, sealing and live memory then take seconds. Your story chat keeps its own thinking setting.

Storyloom works fully without Dials.

## 12. Settings reference

**You don't need to change any settings** — Storyloom works as it is. The everyday ones are in **Storyloom's own Settings** (the Settings button in the panel), in plain words: **How chapters get written** (All at once / Bit by bit, Chapter length, keep going by itself), **Help the narrator remember**, and **Speed**. The same settings, plus the rest, are also in Extensions → Storyloom:

| Setting | What it does |
|---|---|
| **Live memory** | Keep track of the current scene (every N replies), a summary of the chapter so far (every N messages), and reminding the narrator about everyone in the scene. |
| **Dials** (shown when installed) | Use your Dials chat settings for Storyloom too; open Dials. |
| **Write each chapter over several replies** | Off (default): each press writes a whole chapter, to its planned ending. On: bit by bit. Switching updates the Storyloom Novel preset's instructions to match (only Storyloom's own text — anything you edited is left alone and you're told). |
| **Words per narrator reply** | Only for bit-by-bit and roleplay: how long each reply should be. Not used when chapters are written all at once. |
| **Send SillyTavern's Reasoning Effort to Custom endpoints** | SillyTavern leaves its Reasoning Effort out for Custom endpoints such as Venice. This sends it. (Dials does it instead when installed.) |
| **Keep Storyloom's own thinking short** | Makes Lint, Seal and planning faster on thinking models. Your story isn't affected. (Dials decides instead when installed.) |
| **Chapter team** | Each role on or off, its model, and its personality. |
| **Narrator template** | The headings Storyloom uses when it drafts a non-general narrator. |
| **Memory placement** | Where each memory item goes in the prompt, as which role, with what instruction. |
| **Prompts / Templates** | Storyloom's own prompts and templates, editable (with backups). |
| **Backups / Log** | See below. |

## 13. Backups, Undo and the log

- **Backups** (Extensions → Storyloom → Backups): before Storyloom changes anything of yours outside the lorebook (a preset, a character card, a prompt, a role's personality, chapter text before a revision), it keeps the old version. **Restore** puts it back, and the restore can itself be undone.
- **Undo last lorebook change** restores the entries from before Storyloom's last save, as long as you haven't edited them since.
- **Log** (Extensions → Storyloom → Log): what Storyloom did, what failed and why, with the model's token usage when Dials is installed. API keys are never recorded. **Keep full prompts and replies** helps with debugging.

## 14. Troubleshooting

**A reply stopped mid-sentence.** The warning says why:
- *The limit:* thinking plus the reply reached your Max Response Length. Raise it, or lower thinking (in Dials).
- *Well under the limit:* the provider ended the reply early, or a stopping string or Regex script trimmed it. If SillyTavern's terminal shows the full reply, it was trimmed in SillyTavern.

Press Continue either way.

**"The model answered with nothing (spent its whole reply thinking)."** Thinking models can use the whole budget thinking. Storyloom retries once with more room. To stop it happening:
- With **Dials**, set Storyloom's thinking to **none**. On Venice's deepseek, "low" was ignored in testing and "none" worked.
- Without Dials, keep *Keep Storyloom's own thinking short* on.

**Replies are much shorter or longer than I want.** Set **Words per narrator reply**, or say the length in your message ("about 300 words"); your direction wins. If replies stay short, check WORDS PER CHAPTER in the book's Story Scale: a reply won't be longer than the whole chapter is planned to be.

**Lint says "came back in a form Storyloom couldn't read."** Usually the model spent its reply thinking. Same fix as above.

**"Wait for the current Storyloom operation to finish."** Something is still running; watch the status line at the bottom of the panel, or press Stop.

**The narrator writes like a chatbot, or plays my character.** Run **Compare narrators…** and use Storyloom's version where it flags problems. Check that the Storyloom preset is selected.

**Word salad (words joined by dashes, nonsense).** Usually frequency or presence penalties in your preset. Storyloom's own calls use their own sampling, but the story chat uses your preset: lower or remove the penalties there.

**Something else.** Extensions → Storyloom → Log shows what happened. The Assistant can also look at your live setup with you.

---

*Design notes* (how the prompts are laid out and why) are in this folder: [prompt-slots.md](prompt-slots.md), [novel-craft.md](novel-craft.md), [novel-setups.md](novel-setups.md), [seal-note-reference.md](seal-note-reference.md), [lint-report-reference.md](lint-report-reference.md).
