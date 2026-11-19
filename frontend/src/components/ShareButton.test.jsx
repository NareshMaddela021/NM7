// One Share button: the phone's share sheet where there is one (Web Share on a touch screen), else the menu with
// WhatsApp, LinkedIn, Telegram, Facebook, X, Email and Copy link; each app's link carries only the message and the link.
import { describe, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import ShareButton, { CHANNELS, ShareOptions, canShareNatively, shareOrMenu, shareTarget } from './ShareButton';

const phone = { matchMedia: (q) => ({ matches: q === '(pointer: coarse)' }) };
const desktop = { matchMedia: (q) => ({ matches: q === '(any-pointer: fine)' }) };
const link = { url: 'https://nm7.si/jobs/qa-trainee-acme-1', text: 'Job: QA Trainee at Acme. Details and apply:', title: 'QA Trainee · Acme' };

describe('Share', () => {
  it('uses the share sheet only on a phone that has Web Share', () => {
    expect(canShareNatively({ share: () => {} }, phone)).toBe(true);
    expect(canShareNatively({ share: () => {} }, desktop)).toBe(false); // desktop browsers with Web Share: the menu
    expect(canShareNatively({}, phone)).toBe(false); // no Web Share: the menu
    expect(canShareNatively(null, phone)).toBe(false);
  });

  it('Web Share available: the sheet opens with the link and "native" is counted; closing it does nothing', async () => {
    const share = vi.fn().mockResolvedValue(undefined);
    const menu = vi.fn();
    const track = vi.fn();
    expect(await shareOrMenu(link, menu, { share }, phone, track)).toBe('native');
    expect(share).toHaveBeenCalledWith({ title: link.title, text: link.text, url: link.url });
    expect(track).toHaveBeenCalledWith('native');
    expect(menu).not.toHaveBeenCalled();
    const closed = vi.fn().mockRejectedValue(Object.assign(new Error('x'), { name: 'AbortError' }));
    expect(await shareOrMenu(link, menu, { share: closed }, phone, track)).toBe('closed');
    expect(menu).not.toHaveBeenCalled();
    const broken = vi.fn().mockRejectedValue(Object.assign(new Error('x'), { name: 'NotAllowedError' }));
    expect(await shareOrMenu(link, menu, { share: broken }, phone, track)).toBe('menu');
    expect(menu).toHaveBeenCalledTimes(1);
  });

  it('no Web Share (or a computer): the menu', async () => {
    const menu = vi.fn();
    const track = vi.fn();
    expect(await shareOrMenu(link, menu, {}, phone, track)).toBe('menu');
    expect(await shareOrMenu(link, menu, { share: vi.fn() }, desktop, track)).toBe('menu');
    expect(menu).toHaveBeenCalledTimes(2);
    expect(track).not.toHaveBeenCalled();
  });

  it('the menu has the seven ways, each link carries only the message and the link', () => {
    expect(CHANNELS).toEqual(['whatsapp', 'linkedin', 'telegram', 'facebook', 'x', 'email', 'copy']);
    const out = renderToStaticMarkup(<ShareOptions {...link} />);
    for (const c of CHANNELS) expect(out).toContain(`data-testid="share-${c}"`);
    for (const name of ['WhatsApp', 'LinkedIn', 'Telegram', 'Facebook', '>X<', 'Email', 'Copy link']) expect(out).toContain(name);
    const wa = new URL(shareTarget('whatsapp', link));
    expect(wa.origin + wa.pathname).toBe('https://wa.me/');
    expect([...wa.searchParams.keys()]).toEqual(['text']);
    expect(wa.searchParams.get('text')).toBe(`${link.text} ${link.url}`);
    expect(new URL(shareTarget('linkedin', link)).searchParams.get('url')).toBe(link.url);
    expect(new URL(shareTarget('telegram', link)).searchParams.get('url')).toBe(link.url);
    expect(new URL(shareTarget('facebook', link)).searchParams.get('u')).toBe(link.url);
    expect(new URL(shareTarget('x', link)).searchParams.get('url')).toBe(link.url);
    expect(decodeURIComponent(shareTarget('email', link))).toContain(link.url);
    expect(shareTarget('email', link).startsWith('mailto:?subject=')).toBe(true);
  });

  it('the button says Share', () => {
    expect(renderToStaticMarkup(<ShareButton {...link} testid="share-job" />)).toMatch(/data-testid="share-job"[^>]*>.*Share<\/button>/);
  });
});
