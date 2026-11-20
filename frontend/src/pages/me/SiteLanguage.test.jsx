// Site language on Profile & settings (Batch C item 13): three buttons while Telugu and Hindi are on, nothing while off.
import { describe, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';

let shown = true;
vi.mock('../../lib/i18n', () => ({ LANGS: [['en', 'English'], ['te', 'తెలుగు'], ['hi', 'हिन्दी']], langsShown: () => shown, setLang: vi.fn(), useLang: () => [(k) => k, 'te'] }));
vi.mock('../../lib/simple', () => ({ savePrefs: vi.fn(() => Promise.resolve({})) }));
const { default: SiteLanguage } = await import('./SiteLanguage');

describe('SiteLanguage', () => {
  it('shows English, Telugu and Hindi, the current one pressed', () => {
    shown = true;
    const out = renderToStaticMarkup(<SiteLanguage />);
    expect(out).toContain('Site language');
    for (const c of ['en', 'te', 'hi']) expect(out).toContain(`data-testid="site-lang-${c}"`);
    expect(out).toMatch(/aria-pressed="true"[^>]*data-testid="site-lang-te"/);
  });
  it('is hidden while Telugu and Hindi are off', () => {
    shown = false;
    expect(renderToStaticMarkup(<SiteLanguage />)).toBe('');
  });
});
