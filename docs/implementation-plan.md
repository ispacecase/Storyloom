# Novel Architect implementation plan

Goal: a standalone SillyTavern extension for side-window story planning, direct World Info maintenance, writing, and continuity.

Scope: no code copied from the three inspected extensions, no changes to the user's installation. Target the installed SillyTavern revision 06bde939f initially; test compatibility before claiming broader support.

1. Define novel state: the user's eleven foundation fields, writing directive defaults, links to the target book and chat, provenance and a change history. Unknown fields remain empty, and additions are unrestricted.
2. Build the side window, persistent conversation, and question-led planning. Route requests either through the active SillyTavern connection or a separately chosen connection profile; never change the main chat's active connection as a side effect.
3. Implement selected-book creation and updates via SillyTavern, with stable entry IDs, validation, deduplication, history, undo, and fresh-read conflict detection. Protect user edits and preserve unknown entry fields. Do not infer firm canon from speculative discussion.
4. Observe main-chat events for relevant changes, handle edits, swipes, deletions and chat switches, and prevent duplicate processing. Provide explicit start/stop controls and clear activity indicators.
5. Synchronize the writing directive with the selected chat's Author's Note in both directions. Identify concurrent edits and pause for conflict resolution; avoid duplicating injected prompt text and preserve unrelated note content. Verify chat-specific note, role, frequency and character-note behavior.
6. Add bounded chapter and scene writing with progress, cancellation, retry and recovery, saving prose before extracting continuity. Carry forward summaries and relevant lore without treating model output as verified fact.
7. Verify end-to-end in a disposable installation and book: direct writes and readback, both synchronization directions, no cross-chat edits, profile isolation, interrupted generation, undo, collision handling and continuity. Only then offer installation.

Novel boundaries: each novel is explicitly associated with its own World Info book, main chat, side conversation and directive. Switching novels switches that context and cancels or isolates in-flight work. Sequels may intentionally share or carry forward selected information; never automatically merge unrelated novels. Exact sequel-sharing UI and conflict behavior need design and verification.

Linked novels: offer an explicit link to an existing novel, including non-sequels. Let the user direct what to extract or ask the AI to select relevant characters, settings, histories or other material. Preserve source and separate current-novel canon from reference material, and allow review and correction of extracted facts. No automatic changes to the source novel. Verify source changes, stale copies, conflicts and unlinking.
