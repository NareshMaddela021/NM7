// Codes (Admin → Codes and "Have a code?" at every pay step). The server decides everything (app/coupons); this only
// shapes forms, labels, CSV files and the ?code= link that fills in the code at the pay step.
import { fileName } from './fileName';

export const ITEMS = [
  ['resume', 'Resume download'], ['tailor_pack', 'Tailor pack'], ['interview_pack', 'Interview pack'],
  ['launch', 'Career Launch'], ['expert', 'Expert rewrite'], ['linkedin_pack', 'LinkedIn pack'],
  ['drive', 'Drive plan'], ['campus', 'Campus plan'],
];
export const ITEM_NAME = Object.fromEntries(ITEMS);
export const TYPES = [['free', 'Free unlock'], ['percent', 'Percent off'], ['flat', 'Flat Rs off']];
export const STATUS = {
  active: ['Active', 'b-success'], paused: ['Paused', 'b-neutral'], expired: ['Expired', 'b-neutral'],
  scheduled: ['Scheduled', 'b-warning'], used_up: ['Used up', 'b-neutral'],
};

/** "save 50" → "SAVE50": what the server stores (case and spaces don't matter). */
export const normCode = (s) => String(s ?? '').replace(/\s+/g, '').toUpperCase().slice(0, 40);

/** Paise → "99" / "74.50" (the server's own "Rs" texts use the same). */
export const rs = (paise) => {
  const r = (paise || 0) / 100;
  return Number.isInteger(r) ? r.toLocaleString('en-IN') : r.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
};

/** "Rs 99 -> Rs 49 with SAVE50", or "Code applied - unlocked". */
export const priceText = (q) => (q.final <= 0 ? 'Code applied - unlocked' : `Rs ${rs(q.original)} -> Rs ${rs(q.final)} with ${q.code}`);

/** "37 / 100", "4 / unlimited". */
export const usesText = (c) => `${c.uses} / ${c.totalLimit == null ? 'unlimited' : c.totalLimit}`;

/** The empty create form. */
export const blankForm = () => ({
  code: '', type: 'percent', value: '', items: ['all'], unlimited: true, totalLimit: '', perLimit: 1,
  validFrom: '', validUntil: '', onlyKind: '', onlyId: '', note: '',
});

/** A list row → the edit form. */
export const formOf = (c) => ({
  code: c.code, type: c.type, value: c.type === 'flat' ? String(c.value / 100) : c.type === 'percent' ? String(c.value) : '',
  items: c.items, unlimited: c.totalLimit == null, totalLimit: c.totalLimit == null ? '' : String(c.totalLimit),
  perLimit: c.perLimit, validFrom: c.validFrom || '', validUntil: c.validUntil || '',
  onlyKind: c.only?.kind || '', onlyId: c.only?.id || '', note: c.note || '',
});

/** The form → the API body ({error} when something is missing). Flat amounts are typed in rupees, sent in paise. */
export function bodyOf(f) {
  const value = f.type === 'flat' ? Math.round(Number(f.value) * 100) : f.type === 'percent' ? Math.round(Number(f.value)) : 0;
  if (f.type === 'percent' && !(value >= 1 && value <= 99)) return { error: 'Percent off is 1 to 99. Use Free unlock for 100%.' };
  if (f.type === 'flat' && !(value >= 100)) return { error: 'Enter the rupees off (at least Rs 1).' };
  if (!f.items.length) return { error: 'Pick what the code applies to.' };
  const total = f.unlimited ? null : Math.round(Number(f.totalLimit));
  if (!f.unlimited && !(total >= 1)) return { error: 'Enter the total uses, or choose Unlimited.' };
  const per = Math.round(Number(f.perLimit));
  if (!(per >= 1 && per <= 100)) return { error: 'Uses per person is 1 to 100.' };
  if (f.validFrom && f.validUntil && f.validUntil < f.validFrom) return { error: '‘Valid until’ is before ‘Valid from’.' };
  if (f.onlyKind && !f.onlyId) return { error: 'Pick the organization or group, or choose Anyone.' };
  return {
    type: f.type, value, items: f.items.includes('all') ? ['all'] : f.items, totalLimit: total, perLimit: per,
    validFrom: f.validFrom || null, validUntil: f.validUntil || null,
    only: f.onlyKind ? { kind: f.onlyKind, id: f.onlyId } : null, note: f.note.trim(),
  };
}

/** Turning "All" on clears the rest; picking an item turns "All" off. */
export function toggleItem(items, id) {
  if (id === 'all') return items.includes('all') ? [] : ['all'];
  const rest = items.filter((x) => x !== 'all');
  return rest.includes(id) ? rest.filter((x) => x !== id) : [...rest, id];
}

const cell = (v) => {
  let s = String(v ?? '');
  if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`; // a spreadsheet must never run a cell
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};
/** Rows → CSV text (with a BOM so Excel reads it as UTF-8). */
export const toCsv = (rows) => `﻿${rows.map((r) => r.map(cell).join(',')).join('\r\n')}\r\n`;

/** The bulk codes as a CSV: one code a line, with what it is. */
export function bulkCsv(codes, { label = '', note = '' } = {}) {
  return toCsv([['Code', 'Type', 'Note'], ...codes.map((c) => [c, label, note])]);
}

export const bulkFileName = (prefix) => fileName(['Nm7', 'codes', prefix], 'csv');

/** Saves text as a file (a CSV download). */
export function saveText(text, name, type = 'text/csv;charset=utf-8') {
  const url = URL.createObjectURL(new Blob([text], { type }));
  const a = document.createElement('a');
  a.href = url; a.download = name; document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

// ---------- ?code= in a link: kept until the pay step, never used by itself ----------
const KEY = 'nm7.code';

/** Reads ?code= from a URL search string and keeps it for the pay step. Returns the code ('' when none). */
export function rememberCode(search) {
  const c = normCode(new URLSearchParams(search || '').get('code'));
  if (!/^[A-Z0-9][A-Z0-9-]{2,31}$/.test(c)) return '';
  try { sessionStorage.setItem(KEY, c); } catch { /* private mode: the field just starts empty */ }
  return c;
}

/** The code from a link, for filling in the "Have a code?" field. */
export const savedCode = () => { try { return sessionStorage.getItem(KEY) || ''; } catch { return ''; } };
export const forgetCode = () => { try { sessionStorage.removeItem(KEY); } catch { /* nothing kept */ } };
