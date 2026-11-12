/** Initial in-memory model; not yet connected to SillyTavern. */
export function createNovel() {
  return {
    foundation: {
      title: '', genre: '', setting: '', premise: '', protagonist: '',
      majorCharacters: '', centralConflict: '', relationshipArcs: '',
      narrativeStyle: '', majorPlotMilestones: '', endingDirection: '',
    },
    directive: {
      chapter: 1, scene: 1, pov: 'Third-person limited', tense: 'Past',
      tone: 'Atmospheric, intimate, psychologically complex',
      pacing: 'Slow development with purposeful plot progression',
      instructions: 'Maintain continuous literary prose. Give characters independent agency and let their choices produce consequences. Develop adult relationships through believable emotional and interpersonal dynamics.\n\nContinue the current scene without recapping or prematurely ending it.',
      consistency: 'All established events and character histories must remain consistent unless explicitly revised.',
    },
    entries: {},
  };
}

export function applyFact(novel, fact, options = {}) {
  if (!fact?.id || !fact.title || !fact.content || !fact.source) throw new Error('A fact requires an id, title, content, and source');
  const current = novel.entries[fact.id];
  if (current && current.content !== fact.content && !options.explicitRevision) throw new Error('An explicit revision is required to change established canon');
  return { ...novel, entries: { ...novel.entries, [fact.id]: { ...fact } } };
}
export function selectNovel(root, book) {
  if (!root || typeof root !== 'object') throw new Error('Novel state is required');
  root.novels ??= {};
  const key=String(book || '');
  if (!Object.hasOwn(root.novels,key)) Object.defineProperty(root.novels,key,{value:{book:key,profile:'',messages:[],drafts:[],watch:false,reference:''},writable:true,enumerable:true,configurable:true});
  root.selected=key;
  return root.novels[key];
}
