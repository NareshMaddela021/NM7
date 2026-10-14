// Contact + links for the resume header (preview). The PDF and Word file draw the same items from contactItems().
// linkStyle 'icon' → short handle (saivarsha); 'url' → full link. design.icons toggles the icons.
// Brand logos come from icons.js / brands.js; design.logoColor picks brand colours or one colour.

import { detectBrand, iconColor, iconInner } from './icons';

const stripUrl = (u) => (u || '').trim().replace(/^https?:\/\//i, '').replace(/^www\./i, '').replace(/\/+$/, '');

/** "linkedin.com/in/saivarsha" → "saivarsha"; "yourname.dev" → "yourname.dev" */
export function handleOf(key, url) {
  const clean = stripUrl(url);
  if (!clean) return '';
  if (key === 'resume') return 'Resume link';
  if (key === 'portfolio') return clean.split('/')[0];
  const parts = clean.split('/').filter(Boolean);
  return parts[parts.length - 1] || clean;
}

const LINK_ORDER = ['linkedin', 'github', 'portfolio', 'twitter', 'stackoverflow', 'medium', 'resume'];
const SLOT_ICON = { linkedin: 'linkedin', github: 'github', twitter: 'x', stackoverflow: 'stackoverflow', medium: 'medium', resume: 'resume' };
export const fullUrl = (u) => (/^https?:\/\//i.test(u) ? u : `https://${u}`);
export const MAX_EXTRA_LINKS = 3;

/** Icon for the Portfolio field: the user's pick, else the platform's logo, else a globe. */
export const portfolioIcon = (d) => (d.portfolioIcon && d.portfolioIcon !== 'auto' ? d.portfolioIcon : detectBrand(d.links?.portfolio) || 'globe');
/** Icon for an extra link. */
export const extraIcon = (x) => (x.icon && x.icon !== 'auto' ? x.icon : detectBrand(x.url) || 'link');

/** [[line1 items], [line2 items]] — each item { kind (icon key), text, url?, link? } */
export function contactItems(d, contactLines, styleOverride) {
  const personal = d.personal || {};
  const links = d.links || {};
  const linkStyle = styleOverride || d.linkStyle || 'icon';
  const basics = [];
  if (personal.location) basics.push({ kind: 'location', text: personal.location });
  if (personal.phone) basics.push({ kind: 'phone', text: personal.phone, url: `tel:${personal.phone.replace(/\s/g, '')}` });
  if (personal.email) basics.push({ kind: 'email', text: personal.email, url: `mailto:${personal.email}` });
  const show = (key, url) => (linkStyle === 'url' ? stripUrl(url) : handleOf(key, url));
  const linkItems = LINK_ORDER.filter((k) => links[k]).map((k) => ({
    kind: k === 'portfolio' ? portfolioIcon(d) : SLOT_ICON[k], link: true, url: fullUrl(links[k]),
    text: k === 'portfolio' && d.portfolioLabel?.trim() ? d.portfolioLabel.trim() : show(k, links[k]),
  }));
  (d.linkExtras || []).filter((x) => x.url && x.url.trim()).slice(0, MAX_EXTRA_LINKS).forEach((x) => {
    linkItems.push({ kind: extraIcon(x), link: true, url: fullUrl(x.url.trim()), text: x.label?.trim() || show('extra', x.url) });
  });
  return contactLines === 'two' && linkItems.length ? [basics, linkItems] : [[...basics, ...linkItems]];
}

function Glyph({ kind, color, size }) {
  return <svg aria-hidden="true" viewBox="0 0 24 24" style={{ width: size, height: size, flex: 'none' }} dangerouslySetInnerHTML={{ __html: iconInner(kind, color) }} />;
}

export default function ContactLine({ d, ds, s, align }) {
  const rows = contactItems(d, ds.contactLines);
  const size = (ds.bodySize - 1) * s;
  const monoColor = ds.accentOn.links || ds.accentOn.headings ? ds.accent : '#444';
  const linkColor = ds.accentOn.links ? ds.accent : ds.textColor;
  if (!rows[0].length) return <span style={{ fontSize: size, color: '#9A9A9A' }}>City · phone · email</span>;
  return rows.map((items, r) => (
    <span key={r} style={{ display: 'flex', flexWrap: 'wrap', justifyContent: align === 'center' ? 'center' : 'flex-start', columnGap: ds.icons ? 10 * s : 0, rowGap: 2 * s, fontSize: size, color: '#4a4a4a' }}>
      {items.map((it, i) => (ds.icons ? (
        <span key={it.kind} style={{ display: 'inline-flex', alignItems: 'center', gap: 3 * s, overflowWrap: 'anywhere' }}>
          <Glyph kind={it.kind} color={iconColor(it.kind, ds, monoColor)} size={size * 1.1} />
          <span style={it.link ? { color: linkColor } : undefined}>{it.text}</span>
        </span>
      ) : (
        <span key={it.kind} style={{ overflowWrap: 'anywhere', color: it.link ? linkColor : undefined }}>{i > 0 && <span style={{ padding: `0 ${4 * s}px`, color: '#999' }}>·</span>}{it.text}</span>
      )))}
    </span>
  ));
}
