export function queueContinuity(novel,job) {
 if(novel.pendingContinuity) throw Error('A continuity update is already pending.');
 if(!job?.id || !job?.text?.trim()) throw Error('Invalid continuity update.');
 novel.pendingContinuity={...job};
}
export function completeContinuity(novel,id) {
 if(novel.pendingContinuity?.id!==id) throw Error('A different continuity update is pending.');
 delete novel.pendingContinuity;
}
export function continuityPrompt(text) {
 return `The following draft has been written. Record its established developments for continuity. Return at most four concise updates; include one scene memory that covers the important events and unresolved threads, so details not given separate entries remain available. Do not add events or facts not present in the draft.\n\n${text}`;
}
