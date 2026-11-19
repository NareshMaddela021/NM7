// Vetting V2 (skill checks), the page's own helpers: dates and clocks, labels, the device check (a short hash), the
// running totals of what the test page notices (leaving the page, copy / paste, right-click, developer tools) and a
// photo shrunk in the browser before it is sent. Nothing here blocks the person: it only counts.
import { useEffect, useRef } from 'react';

export const API = '/api/me/skill-checks';

export const LANGS = { en: 'English', te: 'తెలుగు (Telugu)', hi: 'हिन्दी (Hindi)' };
export const SPEECH_LANG = { en: 'en-IN', te: 'te-IN', hi: 'hi-IN' };
export const GROUPS = [['tech', 'Tech'], ['business', 'Business and office'], ['trades', 'Trades and field work'], ['health', 'Health']];
export const TASKS = {
  tech: 'Short practical task (written)',
  written: 'Written task',
  voice: 'Speaking task',
  proof: 'Work situations + optional photo',
};

export const day = (ms) => (ms ? new Date(ms).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' }) : '');
export const monthYear = (ms) => (ms ? new Date(ms).toLocaleDateString('en-IN', { month: 'short', year: 'numeric' }) : '');
/** 75 -> "1:15"; never negative. */
export const clock = (s) => { const v = Math.max(0, Math.ceil(s)); return `${Math.floor(v / 60)}:${String(v % 60).padStart(2, '0')}`; };
export const words = (t) => (t || '').trim().split(/\s+/).filter(Boolean).length;

/** The line a verified badge reads as. */
export function badgeLine(v, role) {
  if (!v) return '';
  return `Skill verified · ${role || v.role} · ${v.bandLabel} · ${v.score}/100 · task ${v.taskStars}/5 · ${monthYear(v.at)}`;
}

/* ---------- re-verify (Vetting V5) ---------- */

const DAY_MS = 86_400_000;
export const RENEW_BEFORE_DAYS = 15; // the refresher opens on day 75 of a 90-day badge
export const RENEW_AFTER_DAYS = 30; // and stays open up to 30 days after the badge ended

/**
 * Whether a badge can be renewed with the short refresher now: { open, daysLeft, expired }. `daysLeft` is whole days
 * until the badge ends (negative once it has ended). Held badges are never renewable.
 */
export function renewState(v, nowMs = Date.now()) {
  if (!v?.expiresAt || v.held) return { open: false, daysLeft: null, expired: !!v?.expired };
  const daysLeft = Math.ceil((v.expiresAt - nowMs) / DAY_MS);
  const expired = !!v.expired || v.expiresAt <= nowMs;
  return { open: daysLeft <= RENEW_BEFORE_DAYS && daysLeft >= -RENEW_AFTER_DAYS, daysLeft, expired };
}

/** When to say how much time is left, out loud (not every second): seconds -> message, or ''. */
export function questionAnnounce(left) {
  return [60, 30, 10].includes(left) ? `${left} seconds left for this question` : '';
}
export function totalAnnounce(left) {
  if (left === 300) return '5 minutes left for the whole test';
  if (left === 120) return '2 minutes left for the whole test';
  if (left === 60) return '1 minute left for the whole test';
  return '';
}

/* ---------- the device check ---------- */

const hex = (buf) => [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');

/** A short hash of the browser and screen (no names, nothing stored in the clear): SHA-256 hex, first 32 characters. */
export async function fingerprint(win = typeof window !== 'undefined' ? window : undefined) {
  if (!win) return '';
  const n = win.navigator || {};
  let tz = '';
  try { tz = Intl.DateTimeFormat().resolvedOptions().timeZone || ''; } catch { /* old browser */ }
  const raw = [n.userAgent, `${win.screen?.width}x${win.screen?.height}`, tz, n.language, n.hardwareConcurrency].join('|');
  try {
    const sub = win.crypto?.subtle;
    if (sub) return hex(await sub.digest('SHA-256', new TextEncoder().encode(raw))).slice(0, 32);
  } catch { /* not a secure page */ }
  let h = 0; // fallback (http in development): a plain string hash, still never the raw values
  for (let i = 0; i < raw.length; i += 1) h = (Math.imul(31, h) + raw.charCodeAt(i)) | 0;
  return `x${(h >>> 0).toString(16)}`.padEnd(32, '0').slice(0, 32);
}

/* ---------- what the page notices ---------- */

export const emptySignals = () => ({ blurs: 0, blurMs: 0, copies: 0, pastes: 0, contextMenus: 0, devtools: 0 });

/** Developer tools docked open: the window is much bigger than the page (desktop only; phones have toolbars). */
export const devtoolsOpen = (win) => (win.outerWidth - win.innerWidth > 160 || win.outerHeight - win.innerHeight > 160);

/**
 * Keeps running totals in `ref.current` (blurs, blurMs, copies, pastes, contextMenus, devtools) while `on`. Each time
 * away counts once (the tab hidden or the window losing focus), with how long. `onPaste(chars)` gets each paste's
 * length. Nothing is prevented.
 */
export function useSignals(ref, { on = true, onPaste } = {}) {
  const pasteCb = useRef(onPaste);
  pasteCb.current = onPaste;
  useEffect(() => {
    if (!on) return undefined;
    const s = ref.current;
    let awayAt = 0;
    const leave = () => { if (!awayAt) { awayAt = Date.now(); s.blurs += 1; } };
    const back = () => { if (awayAt) { s.blurMs += Date.now() - awayAt; awayAt = 0; } };
    const vis = () => (document.visibilityState === 'hidden' ? leave() : back());
    const copy = () => { s.copies += 1; };
    const paste = (e) => { s.pastes += 1; pasteCb.current?.((e.clipboardData?.getData('text') || '').length); };
    const menu = () => { s.contextMenus += 1; };
    document.addEventListener('visibilitychange', vis);
    window.addEventListener('blur', leave);
    window.addEventListener('focus', back);
    document.addEventListener('copy', copy);
    document.addEventListener('paste', paste);
    document.addEventListener('contextmenu', menu);
    let wasOpen = false;
    const fine = typeof window.matchMedia === 'function' && window.matchMedia('(pointer: fine)').matches;
    const id = fine ? setInterval(() => {
      const open = devtoolsOpen(window);
      if (open && !wasOpen && s.devtools < 100) s.devtools += 1;
      wasOpen = open;
    }, 2000) : null;
    return () => {
      back();
      document.removeEventListener('visibilitychange', vis);
      window.removeEventListener('blur', leave);
      window.removeEventListener('focus', back);
      document.removeEventListener('copy', copy);
      document.removeEventListener('paste', paste);
      document.removeEventListener('contextmenu', menu);
      if (id) clearInterval(id);
    };
  }, [on, ref]);
}

/* ---------- saved in this tab, so a reload resumes ---------- */

export const RUN_KEY = 'nm7.vet.run';
export const runKey = (id) => `nm7.vet.paper.${id}`;
export function readStore(key) {
  try { return JSON.parse(sessionStorage.getItem(key) || 'null'); } catch { return null; }
}
export function writeStore(key, value) {
  try { if (value == null) sessionStorage.removeItem(key); else sessionStorage.setItem(key, JSON.stringify(value)); } catch { /* storage blocked */ }
}

/* ---------- a photo, made smaller before sending ---------- */

/** The width and height that fit in `max` px on the long side (never enlarged). */
export function fitSize(w, h, max = 1280) {
  const k = Math.min(1, max / Math.max(w, h));
  return [Math.round(w * k), Math.round(h * k)];
}

/** A picked image file -> { type: 'image/jpeg', data: base64 without the "data:" prefix, preview: data URL }. */
export async function compressImage(file, { max = 1280, quality = 0.8 } = {}) {
  const url = URL.createObjectURL(file);
  try {
    const img = await new Promise((ok, bad) => { const i = new Image(); i.onload = () => ok(i); i.onerror = () => bad(new Error('That file isn’t a picture we can read. Try a JPG or PNG photo.')); i.src = url; });
    const [w, h] = fitSize(img.naturalWidth, img.naturalHeight, max);
    const c = document.createElement('canvas');
    c.width = w; c.height = h;
    const ctx = c.getContext('2d');
    ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, w, h);
    ctx.drawImage(img, 0, 0, w, h);
    let q = quality;
    let out = c.toDataURL('image/jpeg', q);
    while (out.length > 2_700_000 && q > 0.4) { q -= 0.15; out = c.toDataURL('image/jpeg', q); } // the server takes about 2 MB
    return { type: 'image/jpeg', data: out.slice(out.indexOf(',') + 1), preview: out };
  } finally {
    URL.revokeObjectURL(url);
  }
}
