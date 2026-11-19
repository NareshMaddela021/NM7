// Vetting Trust T10 (the spoken-English score): pure helpers shared by the interview runner (in its chunk) and the
// score cards: the timing of a spoken answer from the speech events, the WAV clip for the pronunciation provider
// (16 kHz mono 16-bit PCM, at most 20 seconds), base64, and the band's tone / the filter's options.
export const LONG_PAUSE_MS = 3000;
export const CLIP_SECONDS = 20;
export const CLIP_RATE = 16000;
export const BANDS = ['A1', 'A2', 'B1', 'B2', 'C1', 'C2'];

/**
 * The time actually spent speaking and the long pauses, from the moments words were recognised.
 * events: [{ t: ms, s: listening-session number }] → { speechMs, pauses }. Within one listening session the speech
 * runs from its first recognised word to its last (+ ½ s for the last word); a gap of 3 s or more between two words
 * of the same session is a long pause. The gap between two sessions (Stop, then Speak more) is not counted.
 */
export function speechTiming(events) {
  const by = new Map();
  for (const e of events || []) {
    if (!by.has(e.s)) by.set(e.s, []);
    by.get(e.s).push(e.t);
  }
  let speechMs = 0; let pauses = 0;
  for (const ts of by.values()) {
    ts.sort((a, b) => a - b);
    speechMs += ts[ts.length - 1] - ts[0] + 500;
    for (let i = 1; i < ts.length; i += 1) if (ts[i] - ts[i - 1] >= LONG_PAUSE_MS) pauses += 1;
  }
  return { speechMs: Math.round(speechMs), pauses };
}

/** Float samples at `rate` → 16 kHz (averaging), at most CLIP_SECONDS. */
export function downsample(samples, rate, to = CLIP_RATE, maxSeconds = CLIP_SECONDS) {
  if (!samples?.length) return new Float32Array(0);
  const ratio = rate / to;
  const n = Math.min(Math.floor(samples.length / ratio), to * maxSeconds);
  const out = new Float32Array(n);
  for (let i = 0; i < n; i += 1) {
    const a = Math.floor(i * ratio); const b = Math.min(samples.length, Math.max(a + 1, Math.floor((i + 1) * ratio)));
    let sum = 0;
    for (let j = a; j < b; j += 1) sum += samples[j];
    out[i] = sum / (b - a);
  }
  return out;
}

/** 16-bit PCM WAV bytes (mono) for these samples. */
export function wavBytes(samples, rate = CLIP_RATE) {
  const buf = new ArrayBuffer(44 + samples.length * 2);
  const v = new DataView(buf);
  const str = (o, s) => { for (let i = 0; i < s.length; i += 1) v.setUint8(o + i, s.charCodeAt(i)); };
  str(0, 'RIFF'); v.setUint32(4, 36 + samples.length * 2, true); str(8, 'WAVE'); str(12, 'fmt ');
  v.setUint32(16, 16, true); v.setUint16(20, 1, true); v.setUint16(22, 1, true); v.setUint32(24, rate, true);
  v.setUint32(28, rate * 2, true); v.setUint16(32, 2, true); v.setUint16(34, 16, true); str(36, 'data');
  v.setUint32(40, samples.length * 2, true);
  for (let i = 0; i < samples.length; i += 1) {
    const s = Math.max(-1, Math.min(1, samples[i]));
    v.setInt16(44 + i * 2, s < 0 ? s * 0x8000 : s * 0x7fff, true);
  }
  return new Uint8Array(buf);
}

export function toBase64(bytes) {
  let s = '';
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
  return btoa(s);
}

/** The chip tone for a band. */
export const bandTone = (b) => (['C1', 'C2', 'B2'].includes(b) ? 'ok' : b === 'B1' ? 'accent' : 'neutral');

/** "Spoken English: B1 or above" options for the Hire now filter. */
export const bandOptions = () => BANDS.slice(1).map((b) => [b, `${b} or above`]);
