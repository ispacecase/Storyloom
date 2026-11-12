# Storyloom

Storyloom is a standalone SillyTavern UI extension for developing a novel in a separate conversation, maintaining a World Info book, linking a writing directive to Author's Note, and writing draft segments.

**Initial release (0.1.0).** Tested in a disposable SillyTavern instance with a local dummy model and the configured Venice model. The real-model test covered planning, a draft, and a continuity retry; other providers and long-running writing sessions have not been verified. Keep a backup of your story before enabling automatic updates.

## Compatibility

Developed and tested against SillyTavern 1.19.0, local revision `06bde939f`. Other versions and models have not been verified. Storyloom is original code and does not require any of the three reference extensions.

## Installation

In SillyTavern, open **Extensions → Install extension**, enter `https://github.com/ispacecase/Storyloom`, and install it. Reload SillyTavern if prompted.

## Starting a novel

1. Open the main chat for the novel. Open **Extensions → Storyloom**.
2. In **Novel and connection settings**, choose **Create lorebook**. Storyloom creates the basic foundation and writing directive and, when the chat does not already have a chat lorebook, links the new book to it. For an existing lorebook, choose it, use **Set up foundation and directive**, and use **Link to this chat** if desired.
3. Talk with Storyloom. It can update the foundation and add separate lore entries. Select **Follow the main chat** to let it process new story messages as well.
4. Select the current connection or a saved Connection Manager profile. Storyloom's separate profile requests do not change the main chat's selected API. Connection Manager profiles are limited to API types supported by SillyTavern's request service; other active API types use SillyTavern's raw generation and configured response length. For supported connections the default response budget is 6,000 tokens and can be changed in Storyloom settings if your provider has a lower output limit.
5. Optionally select a linked reference book and tell Storyloom which details to carry into the new novel. The reference book is read, not edited by Storyloom.
6. **Write** generates a bounded number of consecutive draft segments. **Stop** cancels supported requests or discards the current segment after it returns. Download the saved draft as text. If continuity processing fails after saving a segment, use **Retry pending updates** before writing more.

## Notes and recovery

- The directive is stored in World Info and in a marked portion of the current chat's Author's Note. Changes sync in either direction. If both change independently, use the directive version buttons after reviewing them. Other Author's Note text is preserved. Author's Note insertion frequency and character-note settings still control what reaches the model.
- Recent lore updates can be inspected in settings and undone one at a time. Undo refuses to replace an entry that has since changed. Storyloom checks for conflicts before a save, but SillyTavern's World Info interface does not provide an atomic compare-and-swap; simultaneous writers can still race. Keep backups and avoid editing the same book from multiple clients at once.
- Chat edits, deletions, or swipes affecting tracked messages pause automatic tracking for review. Review the affected lore before using **Resume after reviewing changes**. This is not automatic reconciliation.
- Context sent to a model includes selected novel and linked-reference excerpts, recent side conversation, and the current source message or draft. Large books are ranked and bounded; an existing entry that was not fully included cannot be automatically rewritten in that request. The selected model/provider's own privacy terms and costs apply.
- Model-generated content can be mistaken or inconsistent. The extension cannot guarantee literary quality, fact extraction, or continuity. Review work and export backups.

## Development checks

Run `node --test tests/*.test.mjs` and `node --check index.js`. Test with a disposable SillyTavern instance and fictional data. Do not copy real lorebooks or credentials into a test fixture or commit them.
