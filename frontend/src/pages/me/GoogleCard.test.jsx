// Settings → Sign in with Google: connected / not connected, and Remove blocked while Google is the only way in.
import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter } from 'react-router-dom';
import { GoogleCardView, setPasswordHref } from './GoogleCard';

const base = { id: 'u1', role: 'customer', name: 'Asha', email: 'asha@example.com' };
const draw = (user, extra = {}) => renderToStaticMarkup(
  <MemoryRouter><GoogleCardView user={user} busy={false} err="" onRemove={() => {}} connect={<button type="button">CONNECT</button>} {...extra} /></MemoryRouter>,
);

describe('Settings → Sign in with Google', () => {
  it('not connected: offers Connect', () => {
    const out = draw({ ...base, hasPassword: true, google: null });
    expect(out).toContain('CONNECT');
    expect(out).not.toContain('Remove Google');
  });
  it('connected with a password: Remove works', () => {
    const out = draw({ ...base, hasPassword: true, google: { email: 'asha.r@gmail.com' } });
    expect(out).toContain('Connected to Google');
    expect(out).toContain('asha.r@gmail.com');
    expect(out).toMatch(/<button[^>]*>Remove Google<\/button>/);
    expect(out).not.toMatch(/disabled=""[^>]*>Remove Google/);
    expect(out).not.toContain('Set a password');
  });
  it('Google-only account: Remove is blocked and Set a password is offered', () => {
    const out = draw({ ...base, hasPassword: false, google: { email: 'asha@example.com' } });
    expect(out).toMatch(/<button[^>]*disabled=""[^>]*>Remove Google<\/button>/);
    expect(out).toContain('Google is your only way to sign in');
    expect(out).toContain(`href="${setPasswordHref('asha@example.com').replace(/&/g, '&amp;')}"`);
  });
  it('shows the server message', () => {
    expect(draw({ ...base, hasPassword: false, google: { email: 'a@b.co' } }, { err: 'Set a password first, so you can still sign in after removing Google.' })).toContain('role="alert"');
  });
});
