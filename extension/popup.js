// Nm7 Apply helper: the small window that opens from the toolbar. Pair with a code from Nm7, choose the job, fill the
// company's page from the kit, and after the candidate presses Submit, mark it applied on Nm7.
const app = document.getElementById('app');
const SITE = globalThis.NM7_CONFIG.site;

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

function show(...nodes) {
  app.replaceChildren(...nodes);
}

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

async function fill(tab, kit) {
  const out = el('div', { class: 'stack' }, el('p', { class: 'muted' }, 'Filling…'));
  show(out);
  try {
    const full = await send({ type: 'kit', id: kit.id });
    let pdf = null;
    if (full.resume) {
      try { pdf = { name: full.resume.name, base64: (await send({ type: 'resume', id: kit.id })).base64 }; } catch { pdf = null; }
    }
    await chrome.scripting.executeScript({ target: { tabId: tab.id }, files: ['src/blocklist.js', 'src/fieldmap.js', 'src/content.js'] });
    const [{ result }] = await chrome.scripting.executeScript({ target: { tabId: tab.id }, func: (k, p) => globalThis.Nm7Fill(k, p), args: [full, pdf] });
    const lines = [];
    if (result.blocked) lines.push(el('p', { class: 'warn' }, 'This is a job board. The helper does nothing here.'));
    else {
      lines.push(el('p', { class: 'ok' }, `Filled ${result.filled} field${result.filled === 1 ? '' : 's'}${result.attached ? ' and attached your resume' : ''}.`));
      if (result.resumeField && !result.attached) lines.push(el('p', { class: 'small' }, 'Attach your resume yourself: download it from Nm7 (Jobs ready, then the job, then Download resume).'));
      if (result.password) lines.push(el('p', { class: 'warn small' }, 'This page asks for a password or an account. The helper never signs in or creates accounts. Sign in yourself, then tap Fill again.'));
      if (result.captcha) lines.push(el('p', { class: 'small' }, 'There is a “I’m not a robot” check. Do it yourself; the helper never touches it.'));
      if (result.sensitive) lines.push(el('p', { class: 'small' }, `${result.sensitive} personal question${result.sensitive === 1 ? ' was' : 's were'} left for you (like gender or date of birth).`));
      if (result.left) lines.push(el('p', { class: 'small' }, `${result.left} field${result.left === 1 ? '' : 's'} left for you. Copy from your kit on Nm7 if you need to.`));
      if (result.frame) lines.push(el('p', { class: 'small' }, 'Part of the form is inside a box from another site. ', el('button', { class: 'link', type: 'button', on: { click: () => chrome.tabs.create({ url: result.frame }) } }, 'Open the form on its own page'), ' and tap Fill there.'));
      lines.push(el('p', {}, el('strong', {}, 'Check everything, then press the company’s Submit button yourself.')));
    }
    out.replaceChildren(...lines, appliedBlock(kit), el('button', { class: 'link', type: 'button', on: { click: start } }, 'Back'));
  } catch (x) {
    out.replaceChildren(el('p', { class: 'warn' }, x.message), el('button', { class: 'link', type: 'button', on: { click: start } }, 'Back'));
  }
}

function appliedBlock(kit) {
  const msg = el('p', { class: 'small', role: 'status' });
  const b = el('button', { class: 'plain', type: 'button', on: { click: async () => {
    b.disabled = true;
    try { await send({ type: 'applied', id: kit.id }); msg.textContent = 'Marked as applied on Nm7.'; msg.className = 'small ok'; }
    catch (x) { msg.textContent = x.message; b.disabled = false; }
  } } }, 'Mark as applied on Nm7');
  return el('div', { class: 'stack' }, el('p', { class: 'small muted' }, 'Pressed Submit on the company’s page?'), b, msg);
}

async function mainView(status) {
  const tab = await activeTab();
  const host = hostOf(tab && tab.url);
  const head = el('p', { class: 'small muted' }, `Signed in as ${status.me.firstName || 'you'} on Nm7.`);
  const out = el('button', { class: 'link', type: 'button', on: { click: async () => { await send({ type: 'unpair' }); pairView(); } } }, 'Sign this browser out');
  if (!host) return show(head, el('p', {}, 'Open the company’s apply page, then tap the helper again.'), out);
  if (globalThis.Nm7Blocklist.isBlocked(host)) return show(head, el('p', { class: 'warn' }, 'This is a job board. The Nm7 Apply helper does nothing on job boards.'), out);
  const { items } = await send({ type: 'kits' });
  if (!items.length) {
    return show(head, el('p', {}, 'No jobs ready right now. New ones come each morning.'), el('button', { class: 'link', type: 'button', on: { click: () => chrome.tabs.create({ url: `${SITE}/me/auto-apply/v2?tab=ready` }) } }, 'Open Jobs ready on Nm7'), out);
  }
  const match = items.find((k) => sameSite(k.applyHost, host));
  const pick = el('select', { id: 'kit' }, items.map((k) => el('option', { value: k.id, selected: match && match.id === k.id }, `${k.job.title} · ${k.job.company}`)));
  const chosen = () => items.find((k) => k.id === pick.value);
  const pending = status.submitted && status.submitted.tabId === tab.id ? items.find((k) => k.id === status.submitted.kitId) : null;
  show(
    head,
    pending ? el('div', { class: 'stack' }, el('p', { class: 'ok' }, `You pressed Submit for ${pending.job.title}.`), appliedBlock(pending)) : null,
    el('label', { for: 'kit' }, 'Which job is this page for?'),
    pick,
    match ? null : el('p', { class: 'small muted' }, 'This page isn’t the job’s apply link on Nm7. Check it’s the right company.'),
    el('div', { class: 'row' }, el('button', { class: 'primary', type: 'button', on: { click: () => fill(tab, chosen()) } }, 'Fill this page')),
    el('p', { class: 'small muted' }, 'The helper only types your own details from Nm7. It never presses Submit, never signs in and never touches a robot check.'),
    pending ? null : appliedBlock({ get id() { return chosen().id; } }),
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
