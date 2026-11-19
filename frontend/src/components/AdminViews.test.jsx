// The admin's views: the "viewing as" banner (every page while a view is open) and the Switch to list.
import { describe, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';

const who = { user: { role: 'admin', adminRole: 'owner', name: 'Naresh' } };
vi.mock('../lib/auth', () => ({ useAuth: () => who }));

const { default: ViewBanner, SwitchToItems } = await import('./AdminViews');
const { bannerText } = await import('../lib/adminViews');

describe('view banner', () => {
  it('names the role and offers Back to Admin', () => {
    for (const [role, label] of [['student', 'Student'], ['jobseeker', 'Job seeker'], ['expert', 'Expert'], ['company', 'Company'], ['college', 'College']]) {
      const out = renderToStaticMarkup(<ViewBanner view={{ mode: 'persona', role, label, readOnly: false }} />);
      expect(out).toContain(`You are viewing as ${label} (admin preview)`);
      expect(out).toContain('Back to Admin');
      expect(out).toContain('type="button"');
      expect(out).not.toContain('is-ro');
    }
  });
  it('says read-only for a real person, with their name', () => {
    const view = { mode: 'readonly', role: 'user', label: 'Sai Varsha', readOnly: true };
    const out = renderToStaticMarkup(<ViewBanner view={view} />);
    expect(out).toContain('You are viewing Sai Varsha’s screens (read-only)');
    expect(out).toContain('Nothing can be changed or sent');
    expect(out).toContain('is-ro');
    expect(bannerText(null)).toBe('');
  });
});

describe('switch to list', () => {
  it('lists every view for the owner', () => {
    const out = renderToStaticMarkup(<SwitchToItems />);
    for (const l of ['Job seeker view', 'Student view', 'Expert view', 'Company view', 'College view']) expect(out).toContain(l);
    expect(out).toContain('Switch to');
  });
  it('leaves out the company and college views for a role without those sections', () => {
    who.user = { role: 'admin', adminRole: 'support', name: 'Asha' };
    const out = renderToStaticMarkup(<SwitchToItems />);
    expect(out).toContain('Student view');
    expect(out).not.toContain('Company view');
    expect(out).not.toContain('College view');
  });
});
