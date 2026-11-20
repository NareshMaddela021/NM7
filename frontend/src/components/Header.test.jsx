// The header shows only the Nm7 logo, never a path label such as "/me", "/builder" or "/admin" next to it.
import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter } from 'react-router-dom';
import Header from './Header';

describe('Header logo', () => {
  it.each(['me', 'builder', 'admin', 'expert', 'public'])('no path label next to the logo (%s)', (variant) => {
    const html = renderToStaticMarkup(<MemoryRouter initialEntries={['/me']}><Header variant={variant} /></MemoryRouter>);
    const logo = html.match(/<a[^>]*class="logo"[^>]*>.*?<\/a>/)[0];
    expect(logo).not.toMatch(/\/(me|builder|admin|expert)</);
    expect(logo).toContain('Nm<mark>7</mark>');
  });
});
