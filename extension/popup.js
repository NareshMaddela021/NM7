// Nm7 Apply helper: the small window that opens from the toolbar. Pair with a code from Nm7, choose the job (picked
// by itself from the page address when it can), fill the company's page from the kit, see what was filled (green),
// what to check (yellow) and what is left (red), draft answers for questions the kit doesn't answer (each one waits
// for the candidate's OK on the page), undo, and after the candidate presses Submit, mark it applied on Nm7.
//
// Frames: the page and its frames from the same site are filled with activeTab. A form inside a box from another
// site (an iframe of a hiring system) needs that one site's permission: the helper asks Chrome for it at that moment,
// with one plain line, and if the candidate says no, it offers to open the form on its own page instead.
const app = document.getElementById('app');
const CFG = globalThis.NM7_CONFIG;
const SITE = CFG.site;

function send(msg) {
  return new Promise((resolve, reject) => {
    chrome.runtime.sendMessage(msg, (r) => {
      if (chrome.runtime.lastError) reject(new Error(chrome.runtime.lastError.message));
      else if (r && r.error) reject(new Error(r.error));
      else resolve(r);
    });
  });
}

function el(tag, attrs = {}, ...kids) {
  const n = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (k === 'on') for (const [ev, fn] of Object.entries(v)) n.addEventListener(ev, fn);
    else if (k === 'class') n.className = v;
    else if (v !== false && v != null) n.setAttribute(k, v === true ? '' : v);
  }
  for (const k of kids.flat()) if (k != null && k !== false) n.append(k);
  return n;
}

function show(...nodes) { app.replaceChildren(...nodes.filter((n) => n != null && n !== false)); }

async function activeTab() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  return tab;
}

function hostOf(url) {
  try { const u = new URL(url); return /^https?:$/.test(u.protocol) ? u.hostname.toLowerCase() : ''; } catch { return ''; }
}

function sameSite(a, b) {
  const x = String(a || '').replace(/^www\./, '');
  const y = String(b || '').replace(/^www\./, '');
  return !!x && !!y && (x === y || x.endsWith('.' + y) || y.endsWith('.' + x));
}

// The kit for this page: same site as its apply link, and where several kits share a site, the one whose apply link's
// path matches the page address best (same path, then the most path parts in common).
function pickKit(items, url) {
  let page;
  try { page = new URL(url); } catch { return null; }
  const parts = (p) => p.replace(/\/+$/, '').split('/').filter(Boolean);
  let best = null;
  let bestScore = 0;
  for (const k of items || []) {
    if (!sameSite(k.applyHost, page.hostname)) continue;
    let s = 1;
    try {
      const a = new URL(k.applyUrl);
      if (a.hostname.replace(/^www\./, '') === page.hostname.replace(/^www\./, '')) s += 1;
      const ap = parts(a.pathname);
      const pp = parts(page.pathname);
      let common = 0;
      while (common < ap.length && common < pp.length && ap[common].toLowerCase() === pp[common].toLowerCase()) common += 1;
      if (ap.length && common === ap.length) s += 20 + ap.length; // the page is the apply link, or a step under it
      else s += common * 2;
      if (a.search && page.search && a.search === page.search) s += 1;
    } catch { /* an apply link without a URL */ }
    if (s > bestScore) { best = k; bestScore = s; }
  }
  return best;
}

function plural(n, one, many) { return `${n} ${n === 1 ? one : many}`; }

function pairView(error) {
  const input = el('input', { id: 'code', class: 'code', inputmode: 'text', autocomplete: 'one-time-code', maxlength: '9', placeholder: 'ABCD-EFGH', 'aria-describedby': 'code-help' });
  const msg = el('p', { class: 'small', role: 'alert' }, error || '');
  const go = el('button', { class: 'primary', type: 'submit' }, 'Connect');
  const form = el('form', { class: 'stack', on: { submit: async (e) => {
    e.preventDefault();
    go.disabled = true; msg.textContent = '';
    try { await send({ type: 'pair', code: input.value, device: navigator.userAgent.includes('Android') ? 'Chrome on Android' : 'Chrome' }); await start(); }
    catch (x) { msg.textContent = x.message; go.disabled = false; }
  } } }, el('label', { for: 'code' }, 'Pairing code from Nm7'), input, go);
  show(
    el('p', {}, 'Connect this browser to your Nm7 account with a short code. No password, ever.'),
    el('p', { id: 'code-help', class: 'small muted' }, 'On nm7.si open Auto Apply 2.0, then Jobs ready, then Nm7 Apply helper, then Make a code. The code works once, for 10 minutes.'),
    form, msg,
  );
  input.focus();
}

// ---------- filling (every frame the helper may reach) ----------

async function inject(tabId, files) {
  try {
    await chrome.scripting.executeScript({ target: { tabId, allFrames: true }, files });
    return true;
  } catch {
    await chrome.scripting.executeScript({ target: { tabId }, files }); // the top page alone
    return false;
  }
}

async function run(tabId, func, args = []) {
  let res;
  try { res = await chrome.scripting.executeScript({ target: { tabId, allFrames: true }, func, args }); } catch { res = await chrome.scripting.executeScript({ target: { tabId }, func, args }); }
  return (res || []).map((r) => r && r.result).filter(Boolean);
}

function combine(results) {
  const out = { filled: 0, attached: false, total: 0, counts: { sure: 0, check: 0, left: 0, draft: 0 }, list: [], questions: 0, sensitive: 0,
    more: { work: 0, education: 0 }, frames: [], hosts: new Set(), blocked: false, login: false, captcha: false, password: false, resumeField: false, site: '' };
  for (const r of results) {
    out.hosts.add(r.host);
    if (r.blocked) { if (r.top) out.blocked = true; continue; }
    if (r.login) { out.login = true; continue; }
    out.filled += r.filled || 0;
    out.total += r.total || 0;
    out.attached = out.attached || !!r.attached;
    for (const k of Object.keys(out.counts)) out.counts[k] += (r.counts && r.counts[k]) || 0;
    out.list = out.list.concat(r.list || []);
    out.questions += r.questions || 0;
    out.sensitive += r.sensitive || 0;
    out.more.work = Math.max(out.more.work, (r.more && r.more.work) || 0);
    out.more.education = Math.max(out.more.education, (r.more && r.more.education) || 0);
    out.captcha = out.captcha || !!r.captcha;
    out.password = out.password || !!r.password;
    out.resumeField = out.resumeField || !!r.resumeField;
    out.site = out.site || r.site || '';
    if (r.top) out.frames = r.frames || [];
  }
  return out;
}

// frames from another site that the helper couldn't reach (no permission for that site yet)
async function missingFrames(sum) {
  const out = [];
  for (const f of sum.frames) {
    if (sum.hosts.has(f.host) || globalThis.Nm7Blocklist.isBlocked(f.host)) continue;
    let has = false;
    try { has = await chrome.permissions.contains({ origins: [`${f.origin}/*`] }); } catch { has = false; }
    out.push({ ...f, has });
  }
  return out;
}

async function fill(tab, kit, again) {
  const out = el('div', { class: 'stack' }, el('p', { class: 'muted' }, 'Filling…'));
  show(out);
  try {
    const full = await send({ type: 'kit', id: kit.id });
    let pdf = null;
    if (full.resume) {
      try { pdf = { name: full.resume.name, base64: (await send({ type: 'resume', id: kit.id })).base64 }; } catch { pdf = null; }
    }
    await inject(tab.id, CFG.pageFiles);
    const results = await run(tab.id, (k, p) => globalThis.Nm7Fill(k, p), [full, pdf]);
    const sum = combine(results);
    const prev = (await send({ type: 'tab-state', tabId: tab.id })).state;
    const step = prev && prev.kitId === kit.id ? (prev.step || 1) + (again ? 0 : 1) : 1;
    await send({ type: 'remember', tabId: tab.id, kitId: kit.id, host: hostOf(tab.url), step, filled: sum.filled + (sum.attached ? 1 : 0) });
    for (const r of results) {
      if (r.blocked || r.login) continue;
      send({ type: 'fill-done', kitId: kit.id, filled: (r.filled || 0) + (r.attached ? 1 : 0), total: r.total || 0, misses: r.misses || [], host: r.host, adapter: r.adapter || '' }).catch(() => {});
    }
    out.replaceChildren(...(await resultLines(tab, kit, sum)), appliedBlock(kit, tab), el('button', { class: 'link', type: 'button', on: { click: start } }, 'Back'));
  } catch (x) {
    out.replaceChildren(el('p', { class: 'warn' }, x.message), el('button', { class: 'link', type: 'button', on: { click: start } }, 'Back'));
  }
}

function listOf(sum) {
  const groups = [['check', 'Please check'], ['left', 'Left for you'], ['draft', 'Drafts to approve'], ['sure', 'Filled']];
  const items = [];
  for (const [state, title] of groups) {
    const rows = sum.list.filter((x) => x.state === state && x.label);
    if (!rows.length) continue;
    items.push(el('li', {}, el('strong', {}, `${title}: `), rows.slice(0, 12).map((x) => x.label).join('; ') + (rows.length > 12 ? ' …' : '')));
  }
  return items.length ? el('details', {}, el('summary', {}, 'Which fields'), el('ul', { class: 'small' }, items)) : null;
}

async function resultLines(tab, kit, sum) {
  const lines = [];
  if (sum.blocked) return [el('p', { class: 'warn' }, 'This is a job board. The helper does nothing here.')];
  if (sum.login && !sum.filled) {
    return [el('p', { class: 'warn' }, 'This is a sign-in or create-account page. The helper never signs in or creates accounts. Sign in yourself, then tap Fill this page again.')];
  }
  const c = sum.counts;
  lines.push(el('p', { class: 'ok' }, `Filled ${plural(sum.filled, 'field', 'fields')}${sum.attached ? ' and attached your resume' : ''}.`));
  lines.push(el('p', { class: 'small', 'data-testid': 'summary' },
    el('span', { class: 'dot sure' }, `${c.sure} filled`), ', ', el('span', { class: 'dot check' }, `${c.check} to check`), ', ',
    el('span', { class: 'dot left' }, `${c.left} for you`), '. On the page: green is filled, yellow please check, red left for you.'));
  const list = listOf(sum);
  if (list) lines.push(list);
  if (sum.resumeField && !sum.attached) lines.push(el('p', { class: 'small' }, 'Attach your resume yourself: download it from Nm7 (Jobs ready, then the job, then Download resume).'));
  if (sum.password) lines.push(el('p', { class: 'warn small' }, 'This page asks for a password or an account. The helper never signs in or creates accounts.'));
  if (sum.captcha) lines.push(el('p', { class: 'small' }, 'There is a “I’m not a robot” check. Do it yourself; the helper never touches it.'));
  if (sum.sensitive) lines.push(el('p', { class: 'small' }, `${plural(sum.sensitive, 'personal question was', 'personal questions were')} left for you (like gender or date of birth).`));
  const more = [];
  if (sum.more.work) more.push(plural(sum.more.work, 'more job', 'more jobs'));
  if (sum.more.education) more.push(plural(sum.more.education, 'more education entry', 'more education entries'));
  if (more.length) lines.push(el('p', { class: 'small' }, `Your kit has ${more.join(' and ')}. Press the page’s own Add button for each, then tap Fill this step.`));
  if (sum.questions) lines.push(draftBlock(tab, sum.questions));
  for (const f of await missingFrames(sum)) lines.push(frameBlock(tab, kit, f));
  if (sum.filled || sum.attached) lines.push(el('div', { class: 'row' }, el('button', { class: 'plain', type: 'button', on: { click: async (e) => {
    e.target.disabled = true;
    const r = await run(tab.id, () => globalThis.Nm7Undo && globalThis.Nm7Undo());
    e.target.textContent = r.length ? 'Undone: the fields are back as they were' : 'Nothing to undo';
  } } }, 'Undo')));
  lines.push(el('p', {}, el('strong', {}, 'Check everything, then press the company’s Submit button yourself. When the page moves to the next step, tap Fill this step.')));
  return lines;
}

function draftBlock(tab, n) {
  const msg = el('p', { class: 'small', role: 'status' });
  const b = el('button', { class: 'plain', type: 'button', on: { click: async () => {
    b.disabled = true;
    msg.textContent = 'Drafting from your profile…';
    const r = await run(tab.id, () => globalThis.Nm7Draft && globalThis.Nm7Draft());
    const drafted = r.reduce((s, x) => s + (x.drafted || 0), 0);
    if (r.some((x) => x.paused)) msg.textContent = 'Smart answers are paused for today, type this one yourself.';
    else msg.textContent = drafted ? `${plural(drafted, 'draft is', 'drafts are')} on the page in purple. Use, edit or discard each one there.` : 'Your profile doesn’t answer these. Type them yourself.';
  } } }, `Draft ${plural(Math.min(n, 5), 'answer', 'answers')} from my profile`);
  return el('div', { class: 'stack' }, el('p', { class: 'small' }, `${plural(n, 'question', 'questions')} your kit doesn’t answer.`), b, msg);
}

function frameBlock(tab, kit, f) {
  const open = el('button', { class: 'link', type: 'button', on: { click: () => chrome.tabs.create({ url: f.src }) } }, 'Open the form on its own page');
  if (f.has) return el('p', { class: 'small' }, 'Part of the form is inside a box the helper couldn’t reach. ', open, ' and tap Fill there.');
  const msg = el('p', { class: 'small', role: 'status' });
  const allow = el('button', { class: 'primary', type: 'button', on: { click: async () => {
    let ok = false;
    try { ok = await chrome.permissions.request({ origins: [`${f.origin}/*`] }); } catch { ok = false; }
    if (ok) return fill(tab, kit, true);
    msg.replaceChildren('OK, nothing changed. ', open, ' and tap Fill there.');
  } } }, 'Allow and fill');
  return el('div', { class: 'stack', 'data-testid': 'frame-ask' },
    el('p', { class: 'small' }, `Part of this form is inside a box from ${f.host}. To fill it, Chrome will ask you to let the helper read and change that one site.`),
    el('div', { class: 'row' }, allow), open, msg);
}

function ratingBlock(url) {
  const box = el('div', { class: 'stack', 'data-testid': 'rating' });
  box.append(
    el('p', { class: 'small' }, 'Did the helper save you time? A rating helps others find it.'),
    el('div', { class: 'row' },
      el('button', { class: 'plain', type: 'button', on: { click: () => { chrome.tabs.create({ url }); box.remove(); } } }, 'Rate it'),
      el('button', { class: 'link', type: 'button', on: { click: () => { send({ type: 'rating-dismiss' }).catch(() => {}); box.remove(); } } }, 'No thanks')),
  );
  return box;
}

function appliedBlock(kit, tab) {
  const msg = el('p', { class: 'small', role: 'status' });
  const wrap = el('div', { class: 'stack' });
  const b = el('button', { class: 'plain', type: 'button', on: { click: async () => {
    b.disabled = true;
    try {
      const r = await send({ type: 'applied', id: kit.id, tabId: tab && tab.id });
      msg.textContent = 'Marked as applied on Nm7.'; msg.className = 'small ok';
      if (r && r.askRating && r.storeUrl) wrap.append(ratingBlock(r.storeUrl));
    } catch (x) { msg.textContent = x.message; b.disabled = false; }
  } } }, 'Mark as applied on Nm7');
  wrap.append(el('p', { class: 'small muted' }, 'Pressed Submit on the company’s page?'), b, msg);
  return wrap;
}

function settingsView(status) {
  const box = el('input', { type: 'checkbox', id: 'misses', checked: !!status.me.missReports });
  const msg = el('p', { class: 'small', role: 'status' });
  box.addEventListener('change', async () => {
    box.disabled = true;
    try { const r = await send({ type: 'settings', missReports: box.checked }); box.checked = !!r.missReports; msg.textContent = r.missReports ? 'On. Thank you.' : 'Off.'; }
    catch (x) { box.checked = !box.checked; msg.textContent = x.message; }
    box.disabled = false;
  });
  show(
    el('p', {}, el('strong', {}, 'Settings')),
    el('div', { class: 'check' }, box, el('label', { for: 'misses' }, 'Help improve the helper')),
    el('p', { class: 'small muted' }, 'When it can’t fill a field, send Nm7 only that field’s label, its type and the hiring system’s name, so the helper learns it. Never what you typed, never the page address. Off unless you switch it on; you can switch it off here or in Privacy & consent on Nm7.'),
    msg,
    el('button', { class: 'link', type: 'button', on: { click: start } }, 'Back'),
  );
}

async function mainView(status) {
  const tab = await activeTab();
  const host = hostOf(tab && tab.url);
  const head = el('p', { class: 'small muted' }, `Signed in as ${status.me.firstName || 'you'} on Nm7.`);
  const out = el('button', { class: 'link', type: 'button', on: { click: async () => { await send({ type: 'unpair' }); pairView(); } } }, 'Sign this browser out');
  const settings = el('button', { class: 'link', type: 'button', on: { click: () => settingsView(status) } }, 'Settings');
  if (!host) return show(head, el('p', {}, 'Open the company’s apply page, then tap the helper again.'), settings, out);
  if (globalThis.Nm7Blocklist.isBlocked(host)) return show(head, el('p', { class: 'warn' }, 'This is a job board. The Nm7 Apply helper does nothing on job boards.'), out);
  const { items } = await send({ type: 'kits' });
  if (!items.length) {
    return show(head, el('p', {}, 'No jobs ready right now. New ones come each morning.'), el('button', { class: 'link', type: 'button', on: { click: () => chrome.tabs.create({ url: `${SITE}/me/auto-apply/v2?tab=ready` }) } }, 'Open Jobs ready on Nm7'), out);
  }
  const state = ((await send({ type: 'tab-state', tabId: tab.id })) || {}).state;
  const remembered = state && sameSite(state.host, host) ? items.find((k) => k.id === state.kitId) : null;
  const match = remembered || pickKit(items, tab.url);
  const pick = el('select', { id: 'kit' }, items.map((k) => el('option', { value: k.id, selected: match && match.id === k.id }, `${k.job.title} · ${k.job.company}`)));
  const chosen = () => items.find((k) => k.id === pick.value);
  const pending = status.submitted && status.submitted.tabId === tab.id ? items.find((k) => k.id === status.submitted.kitId) : null;
  show(
    head,
    pending ? el('div', { class: 'stack' }, el('p', { class: 'ok' }, `You pressed Submit for ${pending.job.title}.`), appliedBlock(pending, tab)) : null,
    el('label', { for: 'kit' }, 'Which job is this page for?'),
    pick,
    match ? null : el('p', { class: 'small muted' }, 'This page isn’t the job’s apply link on Nm7. Check it’s the right company.'),
    remembered ? el('p', { class: 'small', 'data-testid': 'step' }, `Step ${state.step || 1} done on this page. Moved to the next step? Fill it too.`) : null,
    el('div', { class: 'row' },
      remembered ? el('button', { class: 'primary', type: 'button', on: { click: () => fill(tab, chosen()) } }, 'Fill this step') : null,
      el('button', { class: remembered ? 'plain' : 'primary', type: 'button', on: { click: () => fill(tab, chosen(), !!remembered) } }, 'Fill this page')),
    el('p', { class: 'small muted' }, 'The helper only types your own details from Nm7. It never presses Submit or Next, never signs in and never touches a robot check.'),
    pending ? null : appliedBlock({ get id() { return chosen().id; } }, tab),
    settings,
    out,
  );
}

async function start() {
  try {
    const status = await send({ type: 'status' });
    if (!status.paired) return pairView();
    await mainView(status);
  } catch (x) {
    pairView(x.message);
  }
}

start();
