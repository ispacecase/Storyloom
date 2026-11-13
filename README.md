# Storyloom

Storyloom is a SillyTavern extension that acts as an assistant for your lorebooks. In a side panel, it interviews you about a novel, roleplay or campaign, then builds and organises the lorebook that SillyTavern's main chat uses. The story itself is written in the main chat; Storyloom keeps it supplied with the right information.

## Compatibility and installation

Designed for SillyTavern 1.19.0. In **Extensions → Install extension**, use `https://github.com/ispacecase/Storyloom`, then reload SillyTavern.

## Start a project

1. Open the chat you want to use and click the feather beside the message box.
2. In **Lorebook for this chat**, pick an existing lorebook or **＋ Start a new novel**. A new lorebook is renamed to the project's title once the outline is done.
3. Pick a **Template** (Novel, or Campaign for roleplay / D&D), then **Simple** (answer or skip a few questions; the AI fills in the rest) or **Deep** (talk through each topic). Both end with the same full plan.
4. Storyloom saves a summary entry, the template's planning entries, a cast list, an outline, and then a full profile for each character (about 500–800 words each).
5. Storyloom then arranges the lorebook for the main chat:
   - **Always on:** the summary, voice/rules entries, and **Current Chapter**, which holds only the plan for the chapter you're on.
   - **By name:** characters and places, triggered by their names only.
   - **Off (planning only):** the full outline, scale and cast list.
6. Use **Now on** to move to the next chapter. Current Chapter and the writing directive in the Author's Note follow along.

Every button has a tooltip. Errors at the bottom of the panel say which button failed and why; full details go to the browser console.

## Templates

**Settings → Templates** shows what each template asks and saves, as plain text. Built-in templates can't be changed. **Save as new** makes your own copy that you can edit: questions, entries and their fields, whether each entry is always on, by name or off, the outline unit (Chapter, Session…) and the character headings. A project keeps the template it was started with.

## Characters from another lorebook

Under **Reference & characters**, choose a reference lorebook, then **Copy a character into this novel**:

- **Just copy:** the AI writes a fresh entry for this project from what the reference says. The two are separate afterwards.
- **Keep in sync:** the entry is copied exactly, and a shared `Shared — A ↔ B` lorebook is created for it. Editing any copy updates the others. If two copies are edited differently, nothing is overwritten; choose which version to keep under **Linked characters**. **Unlink** stops syncing and leaves every copy in place.

Syncing runs while SillyTavern is open with Storyloom loaded. Edits made while it isn't running are synced the next time it starts.

**Attach reference to this character card** is different: it links the whole reference lorebook to the SillyTavern character you're chatting with, so that character can use it in all their chats.

## Notes and recovery

- The writing directive is stored in the lorebook and in a marked part of the chat's Author's Note. Edits synchronize in either direction; if both changed independently, resolve it in **Settings → More options**.
- **Undo last lorebook change** restores the entries from before Storyloom's last save, as long as you haven't edited them since.
- **Follow the main chat** (off by default) reads new main-chat messages and adds what happens to the lorebook.
- Model output can be incomplete or inconsistent. Review entries, keep backups, and check your provider's privacy and pricing terms.

## Development checks

Run `node --test tests/*.test.mjs` and `node --check index.js`. Test with a separate SillyTavern data directory and fictional material. Do not commit real lorebooks or credentials.
