# How a model should write a book — craft research

Research notes (2026-11-14) behind Storyloom's novelist Main Prompt. **[E]** established craft (consistent across sources), **[O]** practitioner opinion, **[U]** unverified. Craft books were read through secondary summaries, not the books themselves.

## Craft principles (as positive instructions)
1. Write important moments as live scene; use summary only for travel, routine and time skips — readers experience scenes, they are only informed by summary. [E] savannahgilbo.com/blog/scene-vs-summary; Browne & King, *Self-Editing for Fiction Writers*
2. Show emotion through action, body, speech and choice; leave it unnamed. [E] Browne & King (editorialdepartment.com/part-iii-showing-vs-telling/)
3. Resist the urge to explain (R.U.E.): once a beat lands, move on. [E] Browne & King
4. Interior thought direct and unlabelled ("He was lying."), not "she supposed". [E] Browne & King
5. Characters say less than they mean — subtext. [E] Browne & King
6. "Said"/"asked", or no tag when the speaker is clear; no adverbs on tags. [E] Reedsy, Ali Luke
7. Action beats sparingly; never a beat and a tag together; let some exchanges run bare. [E] Writer's Digest; Browne & King
8. Each scene: a POV character wants something, meets opposition, ends worse off or facing a new problem (goal/conflict/disaster). [E] Swain, scene and sequel
9. After a setback: reaction, dilemma, decision that drives the next scene (sequel). [E] Swain
10. Within a scene, stimulus then response, in that order. [E]; exact feeling→reflex→action order [U]
11. One POV per scene; only what they perceive and know, in their words. [E] Browne & King; Le Guin, *Steering the Craft*
12. Perceptions directly ("The door banged"), not filtered through "she saw/heard/felt". [E] thewritepractice.com/filter-words
13. One or two specific, unexpected sensory details beat a list; use more than sight. [E]/[O]
14. Concrete nouns, strong verbs; few adjectives and adverbs. [E] Le Guin
15. Vary sentence length for rhythm. [E] Le Guin, "The Sound of Your Writing"
16. Leave things out — cut from the dead moment to the next charged one ("crowding and leaping"). [E] Le Guin
17. Each character speaks distinctly; nobody talks in therapy language or tidy explanatory paragraphs. [O] jasoncraft.org/workbench/posts/03-style-engineering/
18. Let conflict cost something; don't soften outcomes (LLM positivity bias). [O] rentry.org/iy46hksf
19. New complications grow from what is already set up. [O] kajsotala.substack.com/p/creative-writing-with-llms-part-2
20. Write only the passage the direction asks for, at its pace — not the whole arc. [O]/research arxiv.org/html/2409.14509v5
21. End each reply mid-flow, on action, dialogue or an open beat — the chapter goes on. [O, inferred]

## Common model failures → what to ask for instead
Summarising → live scene. Naming emotions → a tell or a line. Slop phrases ("shivers down her spine", "voice barely above a whisper", "tapestry", "testament to", "not X but Y", the name Elara) → plain words from the POV character's world (antislop, arxiv.org/abs/2510.15061; github.com/sam-paech/slop-score). Purple prose → one precise image per beat. Moral/epiphany endings and recaps → end on action or open tension. Wrapping up each reply → continue next time. Explaining, "seemed"/"as if" hedging → say it plainly. Em-dash overuse, one-line staccato paragraphs → normal paragraphs. Headings, markdown, author notes, "Sure! Here's…" → manuscript text only. Positivity bias → let people refuse, fail, stay hostile.

## Author directions in a co-writing chat [mostly O]
Each message is a direction for the next passage, not conversation; carry it out in prose without quoting or acknowledging it; no meta comments or questions; lorebook facts outrank invention; the direction outranks the outline for that passage.

## Writing the prompt itself
Positive framing; prose, not markdown; a reason with each rule; 3–5 varied examples steer style (one example gets copied) [Anthropic]; models follow literally, so no contradictions [OpenAI]; ban lists work poorly while generating — keep them short and pair each item with its replacement [O]; short per-reply reminders go late (Post-History / Author's Note) [O]; a few hundred to ~1,000 words is the working range [O].
