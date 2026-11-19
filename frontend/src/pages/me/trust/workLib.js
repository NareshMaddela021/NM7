// Vetting Trust T15: the small pure pieces of the work tests (typing, situational judgement, aptitude) and the
// reliability record, shared by the candidate page (WorkTests.jsx), the one-tap link pages and their tests.
// The server marks everything again: these only drive what the page shows while the person types or answers.

export const BIG_INSERT = 12; // one input event adding more than this = pasted / a long autocomplete (as on the server)
export const LANGS = [['en', 'English'], ['hi', 'हिन्दी'], ['te', 'తెలుగు']];

/** The same normalisation as the server: NFC, no zero-width joiners, single spaces. */
export function norm(s) {
  return String(s || '').normalize('NFC').replace(/\u200c|\u200d|\ufeff/g, '').split(/\s+/).filter(Boolean).join(' ');
}

/** Characters / 5 a minute (code points: in Hindi and Telugu each letter, vowel sign and virama counts). */
export function wpm(text, ms) {
  const n = [...norm(text)].length;
  return ms > 0 ? Math.round(n / 5 / (ms / 60000)) : 0;
}

/** Tracks the typing box: input events, characters that arrived in one big insert, blocked pastes, the first and last
 * key. `change(next)` is called with the box's new value; it returns the value to keep. */
export function typingTracker(now = () => Date.now()) {
  const st = { prev: '', inputs: 0, insertedChars: 0, pasteAttempts: 0, first: 0, last: 0 };
  return {
    st,
    change(next) {
      const added = [...next].length - [...st.prev].length;
      st.inputs += 1;
      if (added > BIG_INSERT) st.insertedChars += added;
      const t = now();
      if (!st.first) st.first = t;
      st.last = t;
      st.prev = next;
      return next;
    },
    paste() { st.pasteAttempts += 1; },
    ms() { return st.first ? Math.max(0, st.last - st.first) : 0; },
    body(typed) { return { typed, ms: this.ms(), inputs: st.inputs, insertedChars: st.insertedChars, pasteAttempts: st.pasteAttempts }; },
  };
}

/** Is every item answered? SJT: a "most" and a different "least"; aptitude: one option. */
export function answered(test, items, answers) {
  return items.filter((it) => {
    const a = answers[it.id];
    return test === 'sjt' ? a && a.most != null && a.least != null && a.most !== a.least : a != null;
  }).length;
}

/** SJT: choosing an option as "most" when it was "least" (or the other way round) moves it. */
export function pickSjt(prev = {}, which, idx) {
  const other = which === 'most' ? 'least' : 'most';
  const next = { ...prev, [which]: idx };
  if (next[other] === idx) delete next[other];
  return next;
}

export const secondsLeft = (deadline, at = Date.now()) => Math.max(0, Math.round((deadline - at) / 1000));
export const clock = (s) => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;

/** The reliability record line a company sees: "Showed up 4/4 · Joined 2/2 · confirmed by employers". */
export function recordLine(rec) {
  if (!rec) return '';
  return rec.empty ? rec.text : `${rec.text} · ${rec.source}`;
}
