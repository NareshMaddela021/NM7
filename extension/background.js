// Nm7 Apply helper: the service worker. It is the only part that talks to Nm7 (https://nm7-api.onrender.com/api/helper,
// the Nm7 API server), with the token from pairing kept in chrome.storage.local. No other site is ever contacted, no
// analytics, no remote code. What it sends besides the candidate's own actions: the number of fields filled out of the
// fields on the page with each fill (counts only), and, only when the candidate switched on "Help improve the helper",
// the labels of fields it couldn't fill (label, field type and hiring system: never what was typed, never the address).
//
// Per tab it remembers which kit was filled and on which step (chrome.storage.session, gone when the browser closes;
// removed when the tab closes), so after the candidate moves to the next page the helper offers "Fill this step".
importScripts('src/config.js');

const API = globalThis.NM7_CONFIG.api;
const PAUSED = 'Smart answers are paused for today, type this one yourself.';

async function stored() {
  return chrome.storage.local.get(['token', 'expiresAt', 'submitted', 'missReports', 'installedAt', 'ratingAsked', 'storeUrl']);
}

class ApiError extends Error {
  constructor(message, status, code) { super(message); this.status = status; this.code = code; }
}

async function api(path, { method = 'GET', body, blob = false, auth = true } = {}) {
  const headers = { Accept: blob ? 'application/pdf' : 'application/json' };
  if (body) headers['Content-Type'] = 'application/json';
  if (auth) {
    const { token } = await stored();
    if (!token) throw new Error('Pair the helper with Nm7 first.');
    headers.Authorization = `Bearer ${token}`;
  }
  const r = await fetch(API + path, { method, headers, body: body ? JSON.stringify(body) : undefined, credentials: 'omit', cache: 'no-store' });
  if (r.status === 401 && auth) {
    await chrome.storage.local.remove(['token', 'expiresAt']);
    throw new ApiError('This browser was signed out of Nm7. Make a new code on Nm7 and paste it.', 401, 'not_paired');
  }
  if (!r.ok) {
    let msg = 'Nm7 couldn’t do that right now.';
    let code = '';
    try { const e = (await r.json()).error; msg = e.message || msg; code = e.code || ''; } catch { /* keep the plain message */ }
    throw new ApiError(msg, r.status, code);
  }
  if (!blob) return r.json();
  const buf = new Uint8Array(await r.arrayBuffer());
  let bin = '';
  for (let i = 0; i < buf.length; i += 0x8000) bin += String.fromCharCode.apply(null, buf.subarray(i, i + 0x8000));
  return btoa(bin);
}

const tabKey = (id) => `tab:${id}`;

async function tabState(tabId) {
  if (tabId == null) return null;
  const k = tabKey(tabId);
  return (await chrome.storage.session.get(k))[k] || null;
}

async function setTabState(tabId, patch) {
  const k = tabKey(tabId);
  const next = { ...((await tabState(tabId)) || {}), ...patch, at: Date.now() };
  await chrome.storage.session.set({ [k]: next });
  return next;
}

const kitPath = (id) => `/kits/${encodeURIComponent(id)}`;

async function handle(msg, sender) {
  const fromPage = !!(sender && sender.tab); // a content script in a page; the popup has no tab
  switch (msg && msg.type) {
    case 'pair': {
      const { installedAt } = await stored();
      const got = await api('/pair', { method: 'POST', body: { code: msg.code, device: msg.device || 'Chrome', installedAt: installedAt || null, version: chrome.runtime.getManifest().version }, auth: false });
      await chrome.storage.local.set({ token: got.token, expiresAt: got.expiresAt });
      return { ok: true };
    }
    case 'status': {
      const { token, submitted } = await stored();
      if (!token) return { paired: false };
      const me = await api('/me');
      await chrome.storage.local.set({ missReports: !!me.missReports, storeUrl: me.storeUrl || '' });
      return { paired: true, me, submitted: submitted || null };
    }
    case 'kits':
      return api('/kits');
    case 'kit':
      return api(kitPath(msg.id));
    case 'resume':
      return { base64: await api(`${kitPath(msg.id)}/resume.pdf`, { blob: true }) };
    case 'tab-state':
      return { state: await tabState(msg.tabId) };
    case 'remember':
      return { state: await setTabState(msg.tabId, { kitId: msg.kitId, host: msg.host || '', step: msg.step || 1, filled: msg.filled || 0 }) };
    case 'nm7-step': {
      if (!fromPage) return { ok: false };
      await setTabState(sender.tab.id, { kitId: msg.kitId, step: msg.step || 1 });
      return { ok: true };
    }
    case 'fill-done': {
      // counts only: how many fields were filled out of the fields on the page
      const filled = Math.max(0, Math.min(500, Number(msg.filled) || 0));
      const total = Math.max(filled, Math.min(500, Number(msg.total) || 0));
      try { await api(`${kitPath(msg.kitId)}/filled`, { method: 'POST', body: { filled, total, adapter: String(msg.adapter || '').slice(0, 30) } }); } catch { /* counts are not worth an error */ }
      const { missReports } = await stored();
      let reported = false;
      if (missReports && Array.isArray(msg.misses) && msg.misses.length && msg.host) {
        const items = msg.misses.slice(0, 30).map((m) => ({ label: String(m.label || '').slice(0, 120), type: String(m.type || '').slice(0, 20) }));
        try { await api('/misses', { method: 'POST', body: { host: String(msg.host).slice(0, 253), adapter: String(msg.adapter || '').slice(0, 30), items } }); reported = true; } catch (e) {
          if (e.status === 403) await chrome.storage.local.set({ missReports: false });
        }
      }
      return { ok: true, reported };
    }
    case 'draft':
    case 'nm7-draft': {
      try {
        const r = await api(`${kitPath(msg.kitId)}/answer`, { method: 'POST', body: { question: String(msg.question || '').slice(0, 300) } });
        return { answer: typeof r.answer === 'string' ? r.answer : '', note: r.note || '' };
      } catch (e) {
        if (e.status === 429 || e.code === 'answers_paused') return { paused: true, message: PAUSED };
        return { answer: '', note: e.message };
      }
    }
    case 'save-answer':
    case 'nm7-save-answer':
      await api(`${kitPath(msg.kitId)}/answers`, { method: 'POST', body: { question: String(msg.question || '').slice(0, 300), answer: String(msg.answer || '').slice(0, 2000), how: msg.how === 'edited' ? 'edited' : 'approved' } });
      return { ok: true };
    case 'settings': {
      if (fromPage) throw new Error('Unknown request.');
      if (typeof msg.missReports === 'boolean') {
        const r = await api('/settings', { method: 'POST', body: { missReports: msg.missReports } });
        await chrome.storage.local.set({ missReports: !!r.missReports });
        return { missReports: !!r.missReports };
      }
      const { missReports } = await stored();
      return { missReports: !!missReports };
    }
    case 'applied':
    case 'nm7-mark-applied': {
      const id = msg.id || msg.kitId;
      if (!id) throw new Error('Open the helper and choose the job first.');
      await api(`${kitPath(id)}/applied`, { method: 'POST' });
      await chrome.storage.local.remove('submitted');
      if (sender && sender.tab) chrome.action.setBadgeText({ tabId: sender.tab.id, text: '' });
      // the store rating request: once ever, only after a fill that typed something and Mark as applied
      const { ratingAsked, storeUrl } = await stored();
      const st = await tabState(msg.tabId != null ? msg.tabId : sender && sender.tab && sender.tab.id);
      const askRating = !ratingAsked && !!storeUrl && !!(st && st.filled > 0);
      if (askRating) await chrome.storage.local.set({ ratingAsked: Date.now() });
      return { ok: true, askRating, storeUrl: askRating ? storeUrl : '' };
    }
    case 'rating-dismiss':
      await chrome.storage.local.set({ ratingAsked: Date.now() });
      return { ok: true };
    case 'nm7-submitted': {
      if (!fromPage) return { ok: false };
      await chrome.storage.local.set({ submitted: { kitId: msg.kitId, tabId: sender.tab.id, at: Date.now() } });
      chrome.action.setBadgeBackgroundColor({ tabId: sender.tab.id, color: '#111827' });
      chrome.action.setBadgeText({ tabId: sender.tab.id, text: 'OK' });
      return { ok: true };
    }
    case 'unpair': {
      try { await api('/unpair', { method: 'POST' }); } catch { /* signed out here either way */ }
      await chrome.storage.local.remove(['token', 'expiresAt', 'submitted', 'missReports']);
      return { ok: true };
    }
    default:
      throw new Error('Unknown request.');
  }
}

chrome.runtime.onMessage.addListener((msg, sender, reply) => {
  if (sender.id !== chrome.runtime.id) return false;
  handle(msg, sender).then((r) => reply(r), (e) => reply({ error: e.message }));
  return true;
});

// the kit and step remembered for a tab go with the tab
chrome.tabs.onRemoved.addListener((tabId) => { chrome.storage.session.remove(tabKey(tabId)); });

// first run: a short guide page inside the extension (no remote code), and when it was installed (sent once, with
// pairing, so Nm7 can count installs that connect within a day)
chrome.runtime.onInstalled.addListener(async (details) => {
  if (details.reason !== 'install') return;
  await chrome.storage.local.set({ installedAt: Date.now() });
  chrome.tabs.create({ url: chrome.runtime.getURL('welcome.html') });
});
