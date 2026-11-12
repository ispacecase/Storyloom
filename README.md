# Storyloom

Storyloom is a standalone SillyTavern extension for planning a novel in a separate side conversation, maintaining its lorebook and writing directive, and drafting story segments.

## Compatibility and installation

Designed for SillyTavern 1.19.0. In **Extensions → Install extension**, use `https://github.com/ispacecase/Storyloom`, then reload SillyTavern. Storyloom does not require the reference extensions.

## Start a novel

1. Open the SillyTavern chat you want to use for your book, then click the feather beside the message box to open Storyloom.
2. The lorebook picker shows which book Storyloom is using and whether it is linked to this chat. If none exists, starting an interview creates and links one. If the chat already has a Storyloom writing directive, open a different chat before choosing another novel. Otherwise, replacing an existing chat lorebook requires confirmation.
3. Choose **Simple** to answer or skip a sequence of questions, or **Deep** to explore each topic together. In Deep mode use **Next topic** when you're ready. At the end, Storyloom creates a chapter-by-chapter outline and saves the plan in the lorebook. You can keep talking afterward.
4. In **Settings**, use the current AI connection, a supported Connection Manager profile, or choose another provider and model. A manually entered session key is not saved. Supported direct providers depend on SillyTavern's backend and your available credentials; individual providers and models may behave differently.
5. Turn on **Follow the main chat** to capture established developments as the story progresses. The **Writing desk** can generate draft segments, draft one chapter toward an approximate word target, and download the saved prose as text. Chapter targets are approximate and you can stop a run at any time. If a continuity update fails, retry it in **More options**.

## Reuse a character

Select a previous book under **Use another book for reference**, then choose **Bring a character into this book** and enter the character's name. Storyloom creates a character entry in the current novel and a separate character lorebook, preserving the source as a reference. The two copies are independent: later edits are not automatically synchronized. Review the imported facts and any marked suggestions.

To attach a reference lorebook to the currently open SillyTavern character card, choose **Link reference to character card** and confirm the card and book names. Character-card links can apply to that character's other chats; a novel character does not have to be a SillyTavern character card.

## Notes and recovery

- The writing directive is stored in the lorebook and in a marked part of the chat's Author's Note. Edits synchronize in either direction; if both changed independently, resolve the conflict in **More options**. Other Author's Note text is preserved.
- Storyloom records changes and can undo the last update if its entries have not changed since. SillyTavern does not offer an atomic compare-and-swap for lorebooks, so simultaneous edits from different clients can still race.
- Edited, deleted, or swiped tracked chat messages can require review before tracking resumes. Context is bounded; a partially supplied entry is not automatically rewritten.
- Model output can be incomplete, inconsistent, or misattribute suggestions. Review the plan and memories, keep backups, and check your provider's privacy and pricing terms.

## Development checks

Run `node --test tests/*.test.mjs` and `node --check index.js`. Test with a separate SillyTavern data directory and fictional material. Do not commit real lorebooks or credentials.
