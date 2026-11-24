// Nm7 Apply helper: the hiring-system adapters. Each file in this folder registers one hiring system's public apply
// form: the hosts it runs on, a DOM signature (the same system on a company's own domain), field selectors by
// attribute, the step heading of multi-page forms, repeating work / education sections, its type-to-search option
// lists and the marks of its sign-in page. Data plus tiny pure functions only: nothing here writes to the page,
// clicks or submits anything. fieldmap.js and content.js read them through Nm7Adapters.
(function () {
  if (globalThis.Nm7Adapters) return;
  const list = [];

  function siteOf(host) {
    return String(host || '').toLowerCase().replace(/\.$/, '').replace(/^www\./, '');
  }

  function register(a) {
    if (!list.some((x) => x.name === a.name)) list.push(a);
    return a;
  }

  function byName(name) {
    return list.find((a) => a.name === name) || null;
  }

  function forHost(host) {
    const h = siteOf(host);
    return (h && list.find((a) => a.hosts.some((re) => re.test(h)))) || null;
  }

  function matches(doc, selector) {
    try { return !!(selector && doc.querySelector(selector)); } catch { return false; }
  }

  // by host first; then by the page's own structure (a hiring system on the company's domain, or a practice page)
  function detect(host, doc) {
    const a = forHost(host);
    if (a || !doc || !doc.querySelector) return a;
    return list.find((x) => matches(doc, x.signature)) || null;
  }

  globalThis.Nm7Adapters = { list, register, byName, forHost, detect, siteOf };
})();
