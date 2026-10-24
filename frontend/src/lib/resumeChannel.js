// Tells other open tabs of this site that a resume was saved, so an open Templates page shows the edit within about
// a second (the builder saves 0.8 s after typing stops). Same-origin only (BroadcastChannel); nothing leaves the
// browser. Browsers without BroadcastChannel simply show the edit the next time the page opens.
const NAME = 'nm7-resume';
let out;
const sender = () => {
  if (out === undefined) { try { out = typeof BroadcastChannel === 'undefined' ? null : new BroadcastChannel(NAME); } catch { out = null; } }
  return out;
};

/** A resume of this account was saved in this tab. */
export function announceResume(id, data) {
  try { sender()?.postMessage({ id, data }); } catch { /* a closed or unsupported channel: nothing to tell */ }
}

/** Calls f({ id, data }) for every save in another tab; returns the unsubscribe. */
export function onResumeSaved(f) {
  if (typeof BroadcastChannel === 'undefined') return () => {};
  let ch;
  try { ch = new BroadcastChannel(NAME); } catch { return () => {}; }
  ch.onmessage = (e) => { if (e.data?.id && e.data?.data) f(e.data); };
  return () => ch.close();
}
