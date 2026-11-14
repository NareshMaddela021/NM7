// The query string as the address bar has it right now. React Router 7 updates the address at once but renders the
// new page state a moment later (a transition), so `useSearchParams()` can still hold the previous values when a
// second filter is changed quickly: building on it brought a filter just turned off back (round L, /jobs). Filter
// setters build on this instead. Works with BrowserRouter (?…) and HashRouter (#/path?… in the preview build).
export function liveParams() {
  if (typeof window === 'undefined') return new URLSearchParams();
  const { search, hash } = window.location;
  if (search) return new URLSearchParams(search);
  const q = hash.indexOf('?');
  return new URLSearchParams(q >= 0 ? hash.slice(q + 1) : '');
}
