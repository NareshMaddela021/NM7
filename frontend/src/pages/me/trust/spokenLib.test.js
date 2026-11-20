// Vetting Trust T10: the spoken-English helpers (timing of a spoken answer, the WAV clip, the band options) and the
// Hire now filter's query.
import { describe, expect, it } from 'vitest';
import { BANDS, bandOptions, bandTone, downsample, speechTiming, toBase64, wavBytes } from './spokenLib';
import { NT_NONE, nonTechQuery } from '../../company/HireNonTech';

describe('speechTiming', () => {
  it('counts speech from the first to the last word per session, and gaps of 3 s or more as long pauses', () => {
    const ev = [{ t: 1000, s: 1 }, { t: 2000, s: 1 }, { t: 5500, s: 1 }, { t: 6000, s: 1 }, { t: 20000, s: 2 }, { t: 22000, s: 2 }];
    expect(speechTiming(ev)).toEqual({ speechMs: 5000 + 500 + 2000 + 500, pauses: 1 }); // the gap between sessions isn't a pause
    expect(speechTiming([])).toEqual({ speechMs: 0, pauses: 0 });
    expect(speechTiming([{ t: 10, s: 1 }, { t: 3010, s: 1 }]).pauses).toBe(1);
    expect(speechTiming([{ t: 10, s: 1 }, { t: 3009, s: 1 }]).pauses).toBe(0);
  });
});

describe('the clip', () => {
  it('downsamples to 16 kHz, at most 20 seconds, and writes a 16-bit mono WAV', () => {
    const s = new Float32Array(48000).fill(0.5);
    const d = downsample(s, 48000);
    expect(d.length).toBe(16000);
    expect(d[100]).toBeCloseTo(0.5);
    expect(downsample(new Float32Array(48000 * 30), 48000).length).toBe(16000 * 20);
    const w = wavBytes(d);
    expect(w.length).toBe(44 + 32000);
    expect(String.fromCharCode(...w.slice(0, 4))).toBe('RIFF');
    expect(String.fromCharCode(...w.slice(8, 12))).toBe('WAVE');
    const v = new DataView(w.buffer);
    expect(v.getUint32(24, true)).toBe(16000);
    expect(v.getUint16(22, true)).toBe(1);
    expect(v.getInt16(44 + 200, true)).toBe(Math.floor(0.5 * 0x7fff));
    expect(atob(toBase64(w)).length).toBe(w.length);
  });
});

describe('bands and the Hire now filter', () => {
  it('offers A2 or above … C2 or above, and sends english only when chosen', () => {
    expect(BANDS).toEqual(['A1', 'A2', 'B1', 'B2', 'C1', 'C2']);
    expect(bandOptions()[1]).toEqual(['B1', 'B1 or above']);
    expect(bandTone('B2')).toBe('ok');
    expect(nonTechQuery(new URLSearchParams(), NT_NONE).toString()).toBe('');
    expect(nonTechQuery(new URLSearchParams(), { ...NT_NONE, english: 'B1' }).toString()).toBe('english=B1');
  });
});
