import { beforeEach, describe, expect, it, vi } from 'vitest';
import { INITIAL } from '../../pages/builder/schema';

const http = vi.fn();
const user = { value: { role: 'customer', id: 'u1' } };
vi.mock('../../services/http', async () => {
  const real = await vi.importActual('../../services/http');
  return { ...real, LIVE: true, http: (...a) => http(...a) };
});
vi.mock('../auth', () => ({ currentUser: () => user.value }));

const { ApiError } = await import('../../services/http');
const { FACT_KEYS, acceptOptions, aiAvailable, aiRequest, fallbackNotice, fillSlots, writeWithAi } = await import('./ai');

const PRIVATE = { ...INITIAL, personal: { ...INITIAL.personal, name: 'Angelin Rao', phone: '+91 98765 43210', email: 'angelin@example.com', dob: '2001-06-05', address: '12 MG Road, Guntur' } };
const NOTE = 'I am Angelin, I completed BSc Computer Science, I like working with data';

beforeEach(() => { http.mockReset(); user.value = { role: 'customer', id: 'u1' }; });

describe('the request', () => {
  it('carries only the writer’s fact keys — never the name, phone, email, address or date of birth', () => {
    const body = aiRequest(PRIVATE, NOTE, 'generate');
    expect(Object.keys(body.facts).every((k) => FACT_KEYS.includes(k))).toBe(true);
    const sent = JSON.stringify(body.facts);
    for (const p of ['Angelin', '98765', 'angelin@', 'MG Road', '2001-06', 'Guntur']) expect(sent).not.toContain(p);
    expect(body.facts.persona).toBeTruthy();
    expect(body.facts.skills.length).toBeGreaterThan(0);
    expect(body.note).toBe(NOTE); // the note is the person's own words; the server wraps it as data
    expect(body.mode).toBe('generate');
    expect(body.current).toBe('');
  });
  it('clamps the note, the current text and unknown modes', () => {
    const body = aiRequest(INITIAL, 'x'.repeat(2000), 'poem', 'y'.repeat(2000));
    expect(body.note).toHaveLength(1000);
    expect(body.current).toHaveLength(1200);
    expect(body.mode).toBe('generate');
  });
  it('sends the body with the abort signal and needs a signed-in person', async () => {
    http.mockResolvedValue({ options: [], dropped: 0 });
    const ctl = new AbortController();
    await writeWithAi(INITIAL, NOTE, 'shorter', 'Current text.', { signal: ctl.signal });
    expect(http).toHaveBeenCalledWith('/api/me/summary/generate', expect.objectContaining({ method: 'POST', signal: ctl.signal }));
    expect(http.mock.calls[0][1].body.mode).toBe('shorter');
    expect(http.mock.calls[0][1].body.current).toBe('Current text.');
    user.value = null;
    await expect(writeWithAi(INITIAL, NOTE)).rejects.toMatchObject({ status: 401, code: 'sign_in' });
    expect(aiAvailable()).toBe(false);
    expect(http).toHaveBeenCalledTimes(1);
  });
});

describe('the answer', () => {
  const body = aiRequest(INITIAL, NOTE);
  const ok = 'Data analyst fresher with a B.Tech. Skilled in Python and SQL, keen to work with data. Looking for a data analyst role.';
  it('keeps options with known styles that pass the quality gate; drops the rest', () => {
    const res = { options: [
      { style: 'role_first', text: ok },
      { style: 'skills_first', text: 'I am strong in Python and I like data. Looking for a data analyst role.' }, // first person
      { style: 'simple', text: 'Fresher with 7 years of experience across 12 projects. Knows Python.' }, // invented numbers
      { style: 'poem', text: ok },
      { style: 'role_first', text: ok }, // a duplicate style
    ] };
    const got = acceptOptions(res, body);
    expect(got).toEqual([{ style: 'role_first', label: 'Role-first', text: ok, ai: true }]);
  });
  it('fills the slots AI left with the templates, so there are always three cards', async () => {
    http.mockResolvedValue({ options: [{ style: 'simple', text: ok }], dropped: 2, model: 'claude-haiku-5-5', fallback: false });
    const r = await writeWithAi(INITIAL, NOTE);
    expect(r.options.map((o) => o.style)).toEqual(['simple']);
    expect(r.dropped).toBe(2);
    const cards = fillSlots(r.options, INITIAL, NOTE, { seed: 0 });
    expect(cards.map((o) => [o.style, o.ai])).toEqual([['role_first', false], ['skills_first', false], ['simple', true]]);
    expect(cards[2].text).toBe(ok);
    for (const c of cards) expect(c.text).not.toMatch(/\{|\[|undefined/);
  });
  it('counts an option the browser dropped too', async () => {
    http.mockResolvedValue({ options: [{ style: 'simple', text: 'Call me on 98765 43210 for a data analyst role, I am a fresher with Python.' }], dropped: 0 });
    const r = await writeWithAi(INITIAL, NOTE);
    expect(r.options).toEqual([]);
    expect(r.dropped).toBe(1);
  });
});

describe('the notice when AI couldn’t answer', () => {
  it.each([
    [new ApiError(503, 'feature_off', 'AI writing is being switched on - here are quick suggestions instead.'), 'AI is busy, here are quick suggestions'],
    [new ApiError(503, 'ai_busy', 'AI is busy today.'), 'AI is busy, here are quick suggestions'],
    [new ApiError(502, 'writer_unavailable', 'x'), 'AI is busy, here are quick suggestions'],
    [new ApiError(422, 'unusable', 'x'), 'AI is busy, here are quick suggestions'],
    [new ApiError(0, 'network', 'x'), 'AI is busy, here are quick suggestions'],
    [new ApiError(401, 'unauthorized', 'x'), 'Sign in to write with AI — here are quick suggestions'],
    [new ApiError(429, 'rate_limited', 'You can use AI writing 10 times a day. Try again tomorrow.'), 'You can use AI writing 10 times a day. Try again tomorrow — here are quick suggestions'],
  ])('%o', (err, text) => {
    expect(fallbackNotice(err)).toBe(text);
  });
  it('says nothing for a cancel', () => {
    expect(fallbackNotice(new ApiError(0, 'cancelled', 'Cancelled.'))).toBeNull();
    expect(fallbackNotice(Object.assign(new Error('x'), { name: 'AbortError' }))).toBeNull();
  });
});
