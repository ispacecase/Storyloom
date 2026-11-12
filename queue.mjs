export function enqueue(queue, job) {
  if (!queue.some(x => x.chat === job.chat && x.index === job.index && x.text === job.text)) queue.push({...job});
}
export function nextJob(queue, chat) {return queue.find(x => x.chat === chat);}
/** An edit to a processed assistant message or its preceding user message changes its source. */
export function requiresReview(processed,index) {return processed.some(job=>job.index===index || job.index-1===index);}
export function wasApplied(history,jobId) {return !!jobId && history.some(item=>item.jobId===jobId);}
export function changedProcessed(processed,chat) {
 return processed.some(job=>chat[job.index]?.mes!==job.raw || (job.previous!==undefined && chat[job.index-1]?.mes!==job.previous));
}
