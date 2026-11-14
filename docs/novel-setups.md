# How novel-writing tools arrange what the model sees

Research notes (2026-11-14). Focus: which content blocks long-form prose setups use, and where in the prompt each sits. (Reddit could not be fetched; Marinara/pixijb/Celia/Avani preset contents unverified.)

## What each tool does
- **KoboldAI** (github.com/KoboldAI/KoboldAI-Client/wiki/Memory,-Author's-Note-and-World-Info): Memory at the top (~200 tokens: setting, conflict, protagonist; weakest pull); Author's Note just above the newest text (<50 tokens: genre, tone, writing style; strongest pull); World Info entries inserted when a keyword appears.
- **NovelAI** (docs.novelai.net/en/text/specialsymbols; rentry.org/novelai-quick-start; tapwavezodiac.github.io/novelaiUKB/Context.html): Memory top (ATTG `[ Author: ; Title: ; Tags: ; Genre: ]`, POV tag), lorebook for facts, Author's Note ~3 paragraphs from the end — guides warn it is so strong it causes looping, so keep it light. The user's own prose is the biggest style influence.
- **Sudowrite Story Bible** (docs.sudowrite.com): Genre, Style, Synopsis, Characters, Worldbuilding, Outline, Scenes/Beats. Characters/worldbuilding only reach a chapter when named. **POV and tense are their own setting** (book-wide, per-chapter overrides; default 3rd limited past) — moved out of the Style box in 2025.
- **Novelcrafter** (novelcrafter.com help/FAQ, codex-cookbook): always-included Style and Genre entries; Codex (characters, locations, objects, lore, subplots) pulled in when mentioned; **POV and tense as settings**; previous scene summaries + previous text, then the scene beat as the final instruction. **Keeps the whole-book summary out of the writing prompt "because AI models tend to foreshadow or suggest endings".**
- **Mikupad guide** (rentry.org/MikupadIntroGuide): Memory at top for writing instructions and permanent facts; Author's Note for the immediate direction, removed once written; World Info for lore.
- **Re3** (Yang et al., EMNLP 2022, arxiv.org/abs/2210.06774): relevant facts at the top, then earlier outline, recent story summary, current section outline, then the last passage verbatim — "coarse to fine". POV enforced as a hard rule.
- **Anthropic** long-context tips: long material near the top, the instruction at the end (up to 30% better). **Lost in the Middle** (Liu et al., arxiv.org/abs/2307.03172): start and end are used best, the middle worst.

## Common pattern
| Block | Where | How many sources |
|---|---|---|
| Story facts (characters, places, lore) | pulled in when relevant | 5/5 |
| Premise / setting | always on, top | 4 |
| Craft and style ("how to write") | standing block, separate from facts (top in 3; near the end in Kobold/Mikupad) | 5 |
| POV and tense | their own book setting, chapter overrides; never a lorebook fact | Sudowrite, Novelcrafter; Re3 enforces |
| Outline | broad outline earlier; **current** chapter/scene plan right before the latest text | Re3, Novelcrafter, Sudowrite |
| Recent memory | summary of earlier parts, then the latest text verbatim | Re3, Novelcrafter, Mikupad |
| Immediate direction | last | 5/5 |
| Ending / whole-book summary | withheld from the writing prompt | Novelcrafter |
