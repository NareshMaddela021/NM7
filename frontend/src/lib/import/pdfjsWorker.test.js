// pdf.js worker start-up: browser-only, with a ready handshake and a clean fall-back; documents are closed after use.
import { describe, expect, it, vi } from 'vitest';
import { canUseWorker, closePdf, workerReady } from './index';

class FakeWorker extends EventTarget {
  terminate = vi.fn();
  say(action) { this.dispatchEvent(Object.assign(new Event('message'), { data: { sourceName: 'worker', targetName: 'main', action, data: null } })); }
}

describe('canUseWorker', () => {
  it('is true only where a page and Worker exist (never in Node tests)', () => {
    expect(canUseWorker({})).toBe(false);
    expect(canUseWorker({ Worker: class {} })).toBe(false);
    expect(canUseWorker({ Worker: class {}, document: {} })).toBe(true);
    expect(canUseWorker()).toBe(false);
  });
});

describe('workerReady', () => {
  it('resolves with the worker once it reports ready (other messages are ignored)', async () => {
    const w = new FakeWorker();
    const p = workerReady(w);
    w.say('configure');
    w.say('ready');
    await expect(p).resolves.toBe(w);
  });

  it('rejects when the worker file fails to load (e.g. an older build after a deploy)', async () => {
    const w = new FakeWorker();
    const p = workerReady(w);
    w.dispatchEvent(new Event('error'));
    await expect(p).rejects.toThrow(/did not start/);
    w.say('ready'); // late messages after the decision change nothing
  });
});

describe('closePdf', () => {
  it('destroys the document and never throws', async () => {
    const destroy = vi.fn().mockResolvedValue(undefined);
    await closePdf({ destroy });
    expect(destroy).toHaveBeenCalledTimes(1);
    await expect(closePdf({ destroy: () => Promise.reject(new Error('gone')) })).resolves.toBeUndefined();
    await expect(closePdf(null)).resolves.toBeUndefined();
  });
});
