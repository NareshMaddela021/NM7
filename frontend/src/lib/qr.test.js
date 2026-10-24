import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { QR_FAILED, dataUrlToBlob, qrFileName } from './qr';

const SRC = new URL('..', import.meta.url).pathname;
const files = (dir) => readdirSync(dir).flatMap((f) => {
  const p = join(dir, f);
  if (statSync(p).isDirectory()) return files(p);
  return /\.(jsx?|mjs)$/.test(f) && !/\.test\./.test(f) ? [p] : [];
});

describe('QR files', () => {
  it('file names follow the resume-file rule: <org>_<group>_QR.png', () => {
    expect(qrFileName('AsuraaX', 'Job Drive 2026')).toBe('AsuraaX_Job_Drive_2026_QR.png');
    expect(qrFileName('JNTU – Anantapur', 'B.Tech 2026 / CSE')).toBe('JNTU_Anantapur_B_Tech_2026_CSE_QR.png');
    expect(qrFileName('', '')).toBe('Nm7_QR.png');
    expect(QR_FAILED).toBe('Couldn’t download the QR. Long-press or right-click the QR to save it.');
  });

  it('a data: URL is decoded in the page, byte for byte (no fetch)', async () => {
    const blob = dataUrlToBlob('data:image/png;base64,iVBORw0KGgo=');
    expect(blob.type).toBe('image/png');
    expect([...new Uint8Array(await blob.arrayBuffer())]).toEqual([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  });

  it('guard: no code fetches a data: URL (the CSP blocks it, so the button would do nothing)', () => {
    const bad = [];
    for (const f of files(SRC)) {
      const s = readFileSync(f, 'utf8');
      if (/fetch\(\s*['"`]data:/.test(s) || /fetch\([^)]*toDataURL/.test(s)) bad.push(f);
      // a value made by toDataURL(...) and then handed to fetch(...)
      for (const [, id] of s.matchAll(/(?:const|let|var)\s+(\w+)\s*=\s*(?:await\s+)?[\w.]*toDataURL\(/g)) {
        if (new RegExp(`fetch\\(\\s*${id}\\b`).test(s)) bad.push(`${f}: fetch(${id})`);
      }
    }
    expect(bad).toEqual([]);
  });
});
