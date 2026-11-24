// Nm7 Apply helper: the service worker. It is the only part that talks to Nm7 (https://nm7-api.onrender.com/api/helper, the Nm7 API server), with the
// token from pairing kept in chrome.storage.local. No other site is ever contacted, no analytics, no remote code.
importScripts('src/config.js');

const API = globalThis.NM7_CONFIG.api;

async function stored() {
  return chrome.storage.local.get(['token', 'expiresAt', 'submitted']);
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
    throw new Error('This browser was signed out of Nm7. Make a new code on Nm7 and paste it.');
  }
  if (!r.ok) {
    let msg = 'Nm7 couldn’t do that right now.';
    try { msg = (await r.json()).error.message || msg; } catch { /* keep the plain message */ }
    throw new Error(msg);
  }
  if (!blob) return r.json();
  const buf = new Uint8Array(await r.arrayBuffer());
  let bin = '';
  for (let i = 0; i < buf.length; i += 0x8000) bin += String.fromCharCode.apply(null, buf.subarray(i, i + 0x8000));
  return btoa(bin);
}

async function handle(msg, sender) {
  switch (msg && msg.type) {
    case 'pair': {
      const got = await api('/pair', { method: 'POST', body: { code: msg.code, device: msg.device || 'Chrome' }, auth: false });
      await chrome.storage.local.set({ token: got.token, expiresAt: got.expiresAt });
      return { ok: true };
    }
    case 'status': {
      const { token, submitted } = await stored();
      if (!token) return { paired: false };
      const me = await api('/me');
      return { paired: true, me, submitted: submitted || null };
    }
    case 'kits':
      return api('/kits');
    case 'kit':
      return api(`/kits/${encodeURIComponent(msg.id)}`);
    case 'resume':
      return { base64: await api(`/kits/${encodeURIComponent(msg.id)}/resume.pdf`, { blob: true }) };
    case 'applied':
    case 'nm7-mark-applied': {
      const id = msg.id || msg.kitId;
      if (!id) throw new Error('Open the helper and choose the job first.');
      await api(`/kits/${encodeURIComponent(id)}/applied`, { method: 'POST' });
      await chrome.storage.local.remove('submitted');
      if (sender && sender.tab) chrome.action.setBadgeText({ tabId: sender.tab.id, text: '' });
      return { ok: true };
    }
    case 'nm7-submitted': {
      if (!sender || !sender.tab) return { ok: false };
      await chrome.storage.local.set({ submitted: { kitId: msg.kitId, tabId: sender.tab.id, at: Date.now() } });
      chrome.action.setBadgeBackgroundColor({ tabId: sender.tab.id, color: '#111827' });
      chrome.action.setBadgeText({ tabId: sender.tab.id, text: 'OK' });
      return { ok: true };
    }
    case 'unpair': {
      try { await api('/unpair', { method: 'POST' }); } catch { /* signed out here either way */ }
      await chrome.storage.local.remove(['token', 'expiresAt', 'submitted']);
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
