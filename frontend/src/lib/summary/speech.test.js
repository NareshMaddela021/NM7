import { beforeEach, describe, expect, it } from 'vitest';
import { LANG_KEY, MESSAGES, SILENCE_MS, SpeechSession, appendSpeech, bestAlternative, defaultSpeechLang, rememberSpeechLang } from './speech';

/** A stand-in for the browser's SpeechRecognition: results accumulate within a run like Chrome's do. */
class FakeRecognition {
  static instances = [];
  constructor() { this.results = []; this.started = false; FakeRecognition.instances.push(this); }
  start() { if (FakeRecognition.failStart) throw new Error('no'); this.started = true; }
  stop() { this.started = false; this.onend?.(); }
  abort() { this.started = false; this.aborted = true; }
  /** `alts`: [[transcript, confidence], …]; an interim replaces the previous interim, a final is appended. */
  say(alts, isFinal) {
    const result = alts.map(([transcript, confidence]) => ({ transcript, confidence }));
    result.isFinal = isFinal;
    const last = this.results[this.results.length - 1];
    const index = last && !last.isFinal ? this.results.length - 1 : this.results.length;
    this.results[index] = result;
    this.onresult({ resultIndex: index, results: this.results });
  }
  error(code) { this.onerror({ error: code }); }
  end() { this.started = false; this.onend?.(); }
}

function session(extra = {}) {
  const finals = [], interims = [], states = [];
  let t = 1000;
  const s = new SpeechSession({
    Ctor: FakeRecognition, lang: 'te-IN',
    onFinal: (x) => finals.push(x), onInterim: (x) => interims.push(x), onChange: (x) => states.push(x),
    now: () => t, ...extra,
  });
  return { s, finals, interims, states, tick: (ms) => { t += ms; }, rec: () => FakeRecognition.instances[FakeRecognition.instances.length - 1] };
}

beforeEach(() => { FakeRecognition.instances = []; FakeRecognition.failStart = false; });

describe('appendSpeech: committed words are added, never overwrite, with spacing and punctuation', () => {
  it.each([
    ['', 'i am angelin', 'I am angelin'],
    ['I am Angelin', 'I completed BSc', 'I am Angelin. I completed BSc'],
    ['I am Angelin.', 'I completed BSc', 'I am Angelin. I completed BSc'],
    ['I am Angelin,', 'computer science', 'I am Angelin, Computer science'],
    ['I am Angelin   ', '  like   working with data ', 'I am Angelin. Like working with data'],
    ['typed text', '', 'typed text'],
    ['నేను ఇంటర్ చదివాను', 'driver job kavali', 'నేను ఇంటర్ చదివాను. Driver job kavali'],
    ['నేను ఇంటర్ చదివాను।', 'driver job kavali', 'నేను ఇంటర్ చదివాను। Driver job kavali'],
  ])('%j + %j → %j', (existing, chunk, out) => {
    expect(appendSpeech(existing, chunk)).toBe(out);
  });
});

describe('bestAlternative picks the highest confidence of up to 3 alternatives', () => {
  it('works', () => {
    expect(bestAlternative([{ transcript: 'driver', confidence: 0.4 }, { transcript: 'diver', confidence: 0.9 }, { transcript: 'drive', confidence: 0.1 }])).toBe('diver');
    expect(bestAlternative([{ transcript: 'driver', confidence: 0 }, { transcript: 'diver', confidence: 0 }])).toBe('driver'); // no scores: the browser's first
    expect(bestAlternative([{ transcript: '  ', confidence: 0.9 }, { transcript: 'ok', confidence: 0.1 }])).toBe('ok');
    expect(bestAlternative(undefined)).toBe('');
  });
});

describe('the session', () => {
  it('sets up continuous listening with interim results and 3 alternatives, in the picked language', () => {
    const { s, rec, states } = session();
    s.start();
    expect(rec().continuous).toBe(true);
    expect(rec().interimResults).toBe(true);
    expect(rec().maxAlternatives).toBe(3);
    expect(rec().lang).toBe('te-IN');
    expect(rec().started).toBe(true);
    expect(states).toEqual([{ listening: true, error: '' }]);
  });

  it('reports interim text live and commits only final results, each once', () => {
    const { s, rec, finals, interims } = session();
    s.start();
    rec().say([['I comp', 0.3]], false);
    rec().say([['I completed', 0.5]], false);
    expect(interims).toEqual(['I comp', 'I completed']);
    expect(finals).toEqual([]);
    rec().say([['I completed BSc', 0.8], ['I complete bsc', 0.9]], true);
    expect(finals).toEqual(['I complete bsc']); // the best alternative
    expect(interims[interims.length - 1]).toBe('');
    // Chrome re-sends the whole list with a new interim: the final is not committed again
    rec().say([['I like', 0.4]], false);
    rec().say([['I like working with data', 0.9]], true);
    expect(finals).toEqual(['I complete bsc', 'I like working with data']);
  });

  it('restarts when the browser ends a run after a pause, until Stop', () => {
    const { s, rec, states, tick } = session();
    s.start();
    const first = rec();
    first.say([['hello', 0.9]], true);
    tick(5000);
    first.end(); // Chrome's ~60 s / pause end
    expect(FakeRecognition.instances).toHaveLength(2);
    expect(rec()).not.toBe(first);
    expect(rec().started).toBe(true);
    expect(states).toEqual([{ listening: true, error: '' }]); // still one uninterrupted session for the UI
    s.stop();
    expect(FakeRecognition.instances).toHaveLength(2);
    expect(states[states.length - 1]).toEqual({ listening: false, error: '' });
  });

  it('gives up after 20 s without a word, and says so when nothing at all was heard', () => {
    const { s, rec, states, tick } = session();
    s.start();
    tick(9000);
    rec().error('no-speech'); // Chrome's first give-up at ~8 s: not yet our limit
    rec().end();
    expect(FakeRecognition.instances).toHaveLength(2);
    tick(SILENCE_MS);
    rec().error('no-speech');
    rec().end();
    expect(FakeRecognition.instances).toHaveLength(2);
    expect(states[states.length - 1]).toEqual({ listening: false, error: MESSAGES['no-speech'] });
  });

  it('stops quietly after 20 s of silence when something was heard earlier', () => {
    const { s, rec, states, finals, tick } = session();
    s.start();
    rec().say([['driver job kavali', 0.9]], true);
    tick(SILENCE_MS + 1);
    rec().end();
    expect(finals).toEqual(['driver job kavali']);
    expect(states[states.length - 1]).toEqual({ listening: false, error: '' });
  });

  it.each([
    ['not-allowed', MESSAGES['not-allowed']],
    ['audio-capture', MESSAGES['audio-capture']],
    ['network', MESSAGES.network],
    ['service-not-allowed', MESSAGES['service-not-allowed']],
  ])('%s stops with a plain message and no restart', (code, message) => {
    const { s, rec, states } = session();
    s.start();
    rec().error(code);
    rec().end();
    expect(FakeRecognition.instances).toHaveLength(1);
    expect(states[states.length - 1]).toEqual({ listening: false, error: message });
  });

  it('a start that throws is reported', () => {
    FakeRecognition.failStart = true;
    const { s, states } = session();
    s.start();
    expect(states[states.length - 1]).toEqual({ listening: false, error: MESSAGES['start-failed'] });
  });
});

describe('the language', () => {
  const win = (language, saved) => ({
    navigator: { language },
    localStorage: { store: saved ? { [LANG_KEY]: saved } : {}, getItem(k) { return this.store[k] ?? null; }, setItem(k, v) { this.store[k] = v; } },
  });
  it('remembers the last pick, else follows an Indian browser locale, else English', () => {
    expect(defaultSpeechLang(win('en-US', 'ta-IN'))).toBe('ta-IN');
    expect(defaultSpeechLang(win('te-IN'))).toBe('te-IN');
    expect(defaultSpeechLang(win('hi'))).toBe('hi-IN');
    expect(defaultSpeechLang(win('en-US'))).toBe('en-IN');
    expect(defaultSpeechLang(win('en-GB'))).toBe('en-IN');
    expect(defaultSpeechLang(win('fr-FR'))).toBe('en-IN');
    expect(defaultSpeechLang(win('te-IN', 'xx-YY'))).toBe('te-IN'); // an unknown saved code is ignored
    expect(defaultSpeechLang(undefined)).toBe('en-IN');
    const w = win('en-US');
    rememberSpeechLang('kn-IN', w);
    expect(defaultSpeechLang(w)).toBe('kn-IN');
  });
});
