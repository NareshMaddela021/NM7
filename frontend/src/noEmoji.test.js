// Fails if an emoji or a symbol character used as an icon appears anywhere in frontend/src (code, strings, JSON
// translations, CSS, comments). Use the line icons in src/components/icons.jsx instead; in comments write "->".
// Plain typography stays allowed: · • – — … ’ “ ” ₹ ×, and Indic text with its joiners (ZWJ / ZWNJ).
// There is no allow-list on purpose (user-generated content is data, never in the source).
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { describe, expect, it } from 'vitest';

const ROOT = join(__dirname);
const SELF = 'noEmoji.test.js';
// Arrows, technical symbols, enclosed alphanumerics, geometric shapes, misc symbols, dingbats, misc symbols and
// arrows, the emoji planes, variation selector 16 and keycap.
export const BANNED = /[←-⇿⌀-⏿①-⓿■-◿☀-➿⤀-⥿⬀-⯿️⃣\u{1F000}-\u{1FAFF}]/u;

function files(dir) {
  return readdirSync(dir).flatMap((n) => {
    const p = join(dir, n);
    if (statSync(p).isDirectory()) return files(p);
    return /\.(jsx?|mjs|json|css|html)$/.test(n) && n !== SELF ? [p] : [];
  });
}

describe('no emoji in the frontend', () => {
  it('has no emoji or icon symbol characters in frontend/src', () => {
    const hits = [];
    for (const f of files(ROOT)) {
      readFileSync(f, 'utf8').split('\n').forEach((line, i) => {
        const m = line.match(BANNED);
        if (m) hits.push(`${relative(ROOT, f)}:${i + 1}  ${m[0]} (U+${m[0].codePointAt(0).toString(16).toUpperCase()})`);
      });
    }
    expect(hits.slice(0, 50), `${hits.length} emoji/symbol characters; use src/components/icons.jsx`).toEqual([]);
  });
});
