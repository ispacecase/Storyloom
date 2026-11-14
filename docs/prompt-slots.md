# What belongs in each SillyTavern prompt slot — for a novel narrator

Research notes (2026-11-13) behind how Storyloom writes a narrator. SillyTavern's own docs are written for roleplay, so they are used here for **mechanics only** (where a slot lands, its role, what overrides what). What to *write* in each slot comes from model-provider prompting guides and fiction-prompting practice. Labels: **[SRC]** SillyTavern source (commit 06bde939f), **[DOC]** SillyTavern docs, **[VENDOR]** Anthropic/OpenAI prompting guides, **[COMMUNITY]** opinion.

## Order of the final Chat Completion prompt [SRC PromptManager.js]
Main Prompt → World Info (before) → Persona → Char Description → Personality → Scenario → (Enhance Definitions, off) → Auxiliary → World Info (after) → Example Messages → **chat history** (with in-chat injections at depth N = N messages after them) → Post-History Instructions. All system role by default. The docs: the closer to the bottom, the more impact [DOC].

## The slots

| Slot | Mechanics | For a novel narrator, put here |
|---|---|---|
| **Global Main Prompt** (`main`) | First, system. Belongs to the **preset** (Chat Completion settings): it applies to chats using that preset, and a character's own Main Prompt replaces it when “Prefer Char. Prompt” is on — so in practice it does not reach every chat. Edits have "limited effect" once a chat has history [DOC]. Default: "Write {{char}}'s next reply in a fictional chat…" | A book-neutral narrator role: you write prose chapters; the user's messages are the author's directions, not dialogue; plain prose paragraphs; follow the description, lorebook and chapter plan. The docs themselves suggest rewriting it for a narrator ("You are {{char}}, a skilled and versatile storyteller…") [DOC]. |
| **Character Main Prompt override** (`data.system_prompt`) | Replaces `main` in place, only if "Prefer Char. Prompt" is on [SRC]. `{{original}}` inserts the preset's Main Prompt [DOC, SRC]. A per-chat `chat_metadata.system_prompt` beats it (source only). | This book's narrator: who narrates, POV, tense, voice, reply length — each with a reason [VENDOR]. Start with `{{original}}` to layer on the user's preset instead of discarding it. |
| **Description** | Always sent, system, after Main Prompt. "All important facts"; 200–2000 tokens is fine [DOC]. | The always-present reference: premise, cast essentials, setting canon, the narrator's voice, and a **short sample passage in the target voice** (examples steer style more reliably than rules [VENDOR Anthropic]; Novelcrafter style entries use sample prose). Nothing that changes chapter to chapter. |
| **Character's Note** (`data.extensions.depth_prompt`) | In-chat at depth (default 4, system), always when non-empty, no toggle [SRC]. | A 1–3 line restatement of POV, tense and voice, so it stays near the recent text. |
| **Post-History Instructions** (`data.post_history_instructions`) | Last, after chat history; replaces the preset's PHI if "Prefer Char. Instructions" is on; `{{original}}` works [SRC]. Models usually weight it above the Main Prompt [DOC]. | 2–4 short lines: the rules most often broken — reply length, tense, the few phrases to avoid. Must not contradict the Main Prompt: the later one wins [VENDOR OpenAI]. |
| **Author's Note** | Per chat (`chat_metadata`), doesn't carry to new chats; in-chat depth 4 by default [SRC]. | The current chapter / scene brief. Storyloom already puts the writing directive here and sends the chapter plan through Memory. |
| **First message** | Top of the chat history as assistant; scrolls out later. The model "is more likely to pick up the style and length constraints from the first message than anything else" [DOC]. | Ideally a real opening passage at the right POV, tense, register and length. A one-line heading teaches short replies. |
| **Personality / Scenario** | Always sent, wrapped by the preset's format [SRC]. | Scenario can hold the current situation; Personality is little use for a narrator [COMMUNITY]. Storyloom leaves both alone. |
| **Example messages** | `<START>` blocks sent as system `example_user` / `example_assistant`; dropped when context runs out [SRC]. | Chat-format examples don't fit prose; put the sample passage in the Description instead. Sample phrases get copied verbatim [VENDOR OpenAI], so keep it short and varied. |
| **Lorebook** | Keyword-triggered or constant entries; only Content is sent [DOC]. | Secondary characters, places, lore — episodic material, not the narrator's rules. |

## Rules for writing the text [VENDOR]
- One clear role sentence; brief the model like a capable new colleague; give the **reason** behind each rule.
- Say what to do, not what not to do ("plain, concrete verbs" beats a list of banned words); write the prompt in the style you want back (prose, no markdown).
- In long context, put instructions near the end as well as the start; never let two places disagree — the later one wins.
- Don't repeat the same rule in several slots in different words.

## Roleplay advice that does NOT carry over to a novel
"Never speak or act for {{user}}" (only if the writer plays a character); Ali:Chat dialogue in the Description; second-person greetings; `{{user}}:`/`{{char}}:` examples; the ~600-token card budget (from small-context models).

## Caveats
- Some community authors advise against AI-generated prompts at all [COMMUNITY Marinara]; Storyloom always shows the draft for the writer to edit before saving.
- No official length limits for slots except the Description note above.

## Sources
- SillyTavern docs: docs.sillytavern.app/usage/prompts/ (and prompt-manager, characterdesign, Author's Note, worldinfo, advancedformatting pages; markdown at github.com/SillyTavern/SillyTavern-Docs)
- SillyTavern source: public/scripts/openai.js, PromptManager.js, script.js, authors-note.js
- Anthropic: platform.claude.com/docs/en/build-with-claude/prompt-engineering/claude-prompting-best-practices
- OpenAI: developers.openai.com/cookbook/examples/gpt4-1_prompting_guide
- Community: rentry.org/NG_Context2RAGs, rentry.org/kingbri-chara-guide, rentry.org/marinara-spaghetti; novelcrafter.com/courses/codex-cookbook/effective-style-entries
