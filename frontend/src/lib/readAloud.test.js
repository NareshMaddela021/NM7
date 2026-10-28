import { describe, expect, it } from 'vitest';
import { canRead, pickVoice, readAloud } from './readAloud';

const V = [{ lang: 'en-US', name: 'US' }, { lang: 'en-IN', name: 'India' }, { lang: 'hi-IN', name: 'Hindi' }];

describe('read aloud', () => {
  it('picks the closest voice', () => {
    expect(pickVoice(V, 'en-IN').name).toBe('India');
    expect(pickVoice(V, 'hi-IN').name).toBe('Hindi');
    expect(pickVoice(V, 'te-IN')).toBeNull();
    expect(pickVoice([{ lang: 'en-GB', name: 'GB' }], 'en-IN').name).toBe('GB');
    expect(pickVoice([{ lang: 'te_IN', name: 'Te' }], 'te-IN').name).toBe('Te');
  });
  it('without speech synthesis it says so (the text stays on screen)', async () => {
    expect(canRead()).toBe(false);
    expect(await readAloud('Tell me about yourself')).toEqual({ ok: false, reason: 'unsupported' });
  });
});
