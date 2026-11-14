<p align="center"><img src="assets/storyloom-readme-banner.png" alt="Storyloom" width="720"></p>

# Storyloom

**Plan, write and keep straight a whole novel or a long roleplay in SillyTavern.**

Storyloom is a SillyTavern extension that works alongside the main chat. It interviews you about your book or campaign and builds the lorebook. It sets up a narrator (or game master) that knows how to write. Then, while you write, it keeps the story consistent from reply to reply and chapter to chapter. The story is written in SillyTavern's own chat, one chat per chapter or session. Storyloom supplies the right information and checks the result.

- **Setup wizard.** Answer a few questions (Simple) or talk each part through (Deep). Storyloom proposes the story, and once you approve it builds the lorebook: summary, voice and rules, places, cast, a full profile per character, and a chapter-by-chapter outline.
- **A narrator that knows how to write a book.** A "Storyloom Novel" preset is written to the model about the model: how language models write fiction badly, and a list of AI writing habits it must never use (echoed lines, explained subtext, "not X but Y", punchline endings, therapy-speak, stock phrases…), each with what to write instead. A general narrator card fills in your book's point of view, tense, voice, tone, genre and rules. For roleplay there's a **Game Master** that plays the world and everyone in it, and never acts or speaks for your character.
- **Memory that doesn't drop things.**
  - **Seal** writes a hand-off for the next chapter: where things stand (time, weather, who is where and in what shape, who knows what, promises), everything that happened, and the last page word for word.
  - **While you write**, Storyloom keeps a *Scene now* card and a running record of the chapter, and makes sure everyone on stage has their lorebook entry sent.
  - All of it is sent behind the scenes. None of it appears in your chat.
- **A chapter team.** **Lint** checks the chapter against the book (continuity, timeline, character, voice, your rules, the plan, things that belong to later chapters). The **Editor** marks up the pages, the **Reader** reacts, **Revise** fixes what you keep, and **Seal** signs the chapter off. **Auto** runs the lot. Each role can use its own model.
- **Roleplay mode.** Campaign books run in sessions: Lint checks the story and catches the narrator playing your character, and Seal tracks your character between sessions.
- **Export.** The finished book as Word (.docx) or text (.txt), chapter by chapter. For roleplay, both sides of the story.
- **Assistant.** Ask about SillyTavern or your setup. It sees your live settings and the official docs, and can change your setup with **Apply**/**Undo**.
- **Safe by default.** Storyloom backs up anything of yours it changes (presets, character cards, prompts) and never touches your sliders.

## Install

1. In SillyTavern, open **Extensions** (the boxes icon) → **Install extension**.
2. Paste `https://github.com/ispacecase/Storyloom` and install, then reload.
3. Open Storyloom: the **feather** beside the message box, or **Extensions → Storyloom → Open Storyloom panel**.

Requires SillyTavern **1.19.0** or later. Chat Completion connections are recommended (the writing presets and several features use them).

## Quick start: a novel

1. Open Storyloom with no chat open and click **Start a new book**, or open a chat and pick **＋ Start a new novel** under *Lorebook for this chat*.
2. Pick the **Novel** template, then **Simple** or **Deep**, and answer. Approve the proposal; Storyloom builds the lorebook and outline.
3. On the **Memory** tab, click **Writing setup…** and keep all three ticks. You get the *Storyloom Novel* preset, the general narrator, and this book's settings, in a fresh Chapter 1 chat.
4. Press **✍ Write Chapter 1** at the top of the Storyloom panel. The narrator writes the whole chapter. (Want to steer? Type a direction in the chat box first.)
5. When it's done the button says **✓ Chapter 1 is done — Next chapter →**. One click checks and seals it, opens Chapter 2, and starts writing. Repeat.
6. At the end the button offers to save the book as a file (or use **Export book…**).

You don't need to change any settings. If you want to, they're under **Settings** in the panel, in plain words.

## Quick start: a roleplay or campaign

Same as above, but pick the **Campaign (roleplay / D&D)** template. **Writing setup…** then makes a *Storyloom Roleplay* preset and the *Storyloom Game Master*. You play your character in the chat; the steps are **Lint → Seal** (or **Auto**) at the end of each session.

## Works with Dials

[Dials](https://github.com/ispacecase/SillyDials) shows every setting your AI provider supports and counts real token usage. When it's installed:

- Storyloom's own calls (Lint, Editor, Reader, Seal, planning, the Assistant) go through it with their own settings. Pick **Settings for: Storyloom** in Dials.
- By default they also use the settings you set for SillyTavern's chat.
- **Dials settings…** on the Memory tab opens it.

A tip for thinking models: in Dials, set Storyloom's thinking to **none**. Lint, Seal and the live memory then run in seconds instead of minutes.

Storyloom works fully without Dials.

## Documentation

- **[User guide](docs/user-guide.md)**: every feature, setting and troubleshooting tip.
- [Changelog](CHANGELOG.md)
- Design notes in [docs/](docs/): how the prompts are laid out, the craft research behind the narrator, the seal-note and lint formats.

## Privacy

Storyloom sends your story, lorebook and settings to the AI connection you choose, nowhere else. API keys are never written to its log. Check your provider's privacy and pricing terms. Model output can be wrong or inconsistent, so review what it saves; backups and Undo are there for that.

## Development

```
node --test tests/*.test.mjs
```

Test with a separate SillyTavern data directory and fictional material, never your own install. Don't commit real lorebooks or credentials.

## License

[AGPL-3.0-or-later](LICENSE), the same license as SillyTavern.
