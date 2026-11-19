// Vetting Trust T14: the code editor's keystroke recorder and the replay maths (shared by the coding task, the Admin
// replay and the company replay). The format is the server's (backend/app/trust/code/replay.py), version 1:
//   { v: 1, start, lang, truncated, events: [[dtMs, kind, pos, deleted, text], …] }
//   kind: "e" typed edit · "p" paste · "s" set (language switch / reset: the whole text) · "b" editor left · "f" back
// Only the editor is recorded, and only when the person ticked the "Coding replay" consent.

export const MAX_EVENTS = 20_000;
export const MAX_BYTES = 200_000;
export const IDLE_CAP_MS = 3000; // a long pause plays as 3 s at 1x
export const SPEEDS = [1, 4, 16];
export const BIG_PASTE = 200;

/** The single edit that turns `prev` into `next`: { pos, del, ins } (common prefix and suffix kept). */
export function diffEdit(prev, next) {
  if (prev === next) return null;
  let a = 0;
  const max = Math.min(prev.length, next.length);
  while (a < max && prev[a] === next[a]) a += 1;
  let b = 0;
  while (b < max - a && prev[prev.length - 1 - b] === next[next.length - 1 - b]) b += 1;
  return { pos: a, del: prev.length - a - b, ins: next.slice(a, next.length - b) };
}

const evBytes = (e) => 24 + (e[4] ? new TextEncoder().encode(e[4]).length * 1.2 : 0); // JSON escapes, roughly

/** A recorder: `edit(prev, next, pasted)`, `mark("b" | "f")`, `set(text, lang)`, `data()`, `counters()`. Always counts
 * typed / pasted characters (sent even without the consent: the skill-check monitoring); keeps events only when `keep`. */
export function createRecorder(start, lang, { keep = true, maxEvents = MAX_EVENTS, maxBytes = MAX_BYTES, clock = () => Date.now() } = {}) {
  let last = clock();
  let bytes = 60 + start.length;
  const events = [];
  let truncated = false;
  const c = { typed: 0, pasted: 0, largestPaste: 0 };
  const push = (e) => {
    if (!keep || truncated) return;
    const n = evBytes(e);
    if (events.length >= maxEvents || bytes + n > maxBytes - 200) { truncated = true; return; }
    bytes += n;
    events.push(e);
  };
  const dt = () => { const t = clock(); const d = Math.max(0, Math.round(t - last)); last = t; return d; };
  return {
    edit(prev, next, pasted = false) {
      const d = diffEdit(prev, next);
      if (!d) return;
      if (pasted) { c.pasted += d.ins.length; c.largestPaste = Math.max(c.largestPaste, d.ins.length); } else c.typed += d.ins.length;
      push([dt(), pasted ? 'p' : 'e', d.pos, d.del, d.ins]);
    },
    mark(kind) { push([dt(), kind, 0, 0, '']); },
    set(text, newLang) { lang = newLang || lang; push([dt(), 's', 0, 0, text]); },
    data() { return keep ? { v: 1, start, lang, truncated, events: events.slice() } : null; },
    counters() { return { ...c }; },
  };
}

export function apply(text, e) {
  const [, kind, pos, del, ins] = e;
  if (kind === 'b' || kind === 'f') return text;
  if (kind === 's') return ins;
  const p = Math.min(pos, text.length);
  return text.slice(0, p) + ins + text.slice(p + del);
}

/** Text after the first `n` events. */
export function textAt(replay, n) {
  let t = replay.start;
  for (let i = 0; i < n && i < replay.events.length; i += 1) t = apply(t, replay.events[i]);
  return t;
}

/** The time (ms, idle gaps capped) at which each event plays at 1x, and the total. */
export function timeline(replay) {
  let at = 0;
  const times = replay.events.map((e) => { at += Math.min(e[0], IDLE_CAP_MS); return at; });
  return { times, total: at };
}

/** How long to wait before event i at this speed. */
export const delayFor = (replay, i, speed) => Math.min(replay.events[i]?.[0] || 0, IDLE_CAP_MS) / speed;

/** Paste moments: [{ i, at (fraction 0–1 of the timeline), size, big }]. */
export function pasteMarks(replay, big = BIG_PASTE) {
  const { times, total } = timeline(replay);
  return replay.events.flatMap((e, i) => (e[1] === 'p' ? [{ i, at: total ? times[i] / total : 0, size: e[4].length, big: e[4].length >= big }] : []));
}

/** The text split around the span the event at `i` (if it is a paste) put in, for highlighting. */
export function pasteSpan(replay, n) {
  const text = textAt(replay, n);
  const e = replay.events[n - 1];
  if (!e || e[1] !== 'p') return { before: text, mark: '', after: '' };
  const p = Math.min(e[2], text.length);
  return { before: text.slice(0, p), mark: text.slice(p, p + e[4].length), after: text.slice(p + e[4].length) };
}

export function statsLine(st = {}) {
  const s = Math.round((st.durationMs || 0) / 1000);
  const dur = s >= 60 ? `${Math.floor(s / 60)} min ${s % 60} s` : `${s} s`;
  return `Typed ${st.typed ?? 0} characters · pasted ${st.pasted ?? 0} (largest paste ${st.largestPaste ?? 0}) · left the editor ${st.blurs ?? 0} times · ${dur} in all`;
}
