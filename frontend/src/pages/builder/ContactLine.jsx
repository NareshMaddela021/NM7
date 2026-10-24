// Contact + links for the resume header (preview). The PDF and Word file draw the same items from contactItems().
// linkStyle 'icon' → short handle (saivarsha); 'url' → full link. contactIcons (contactMode below) → icon + text,
// text only or icon only.
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

/** [[line1 items], [line2 items]] — each item { kind (icon key), text, url?, link? }. order 'phone-first' (Academic):
 * phone | email | links | city. */
export function contactItems(d, contactLines, styleOverride, order = 'standard') {
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
  if (order === 'phone-first') {
    const city = basics.filter((x) => x.kind === 'location');
    const rest = basics.filter((x) => x.kind !== 'location');
    return contactLines === 'two' && linkItems.length ? [rest, [...linkItems, ...city]] : [[...rest, ...linkItems, ...city]];
  }
  return contactLines === 'two' && linkItems.length ? [basics, linkItems] : [[...basics, ...linkItems]];
}

/** How contact details and links show (the resume's own setting, the same in every template): 'both' = icon + text,
 * 'text' = text only, 'icon' = icon only for links (phone, email and city always keep their text). Resumes that never
 * chose follow the template: icons where it shows them (Academic too), else text only. */
export const CONTACT_MODES = [['both', 'Icon + text'], ['text', 'Text only'], ['icon', 'Icon only (links)']];
export const contactMode = (d, ds) => (['both', 'text', 'icon'].includes(d?.contactIcons) ? d.contactIcons : ds.icons || ds.entryStyle === 'academic' ? 'both' : 'text');
/** Whether an item prints its text: always, except a link in icon-only mode. */
export const showsText = (it, mode) => mode !== 'icon' || !it.link;
/** The separator between items: always without icons; with icons only where the template asks for it (Academic). */
const academic = (ds) => ds.entryStyle === 'academic'; // also Academic resumes saved before this setting existed
export const contactSepOf = (ds, mode) => (mode === 'text' || academic(ds) ? ds.contactSep || '·' : '');
/** Icon size in font sizes: 1.1 (most templates); Academic uses about 0.9 × cap height. */
export const iconScaleOf = (ds) => (academic(ds) ? 0.65 : 1.1);

function Glyph({ kind, color, size, style }) {
  return <svg aria-hidden="true" viewBox="0 0 24 24" style={{ width: size, height: size, flex: 'none', ...style }} dangerouslySetInnerHTML={{ __html: iconInner(kind, color) }} />;
}

/** live: the preview in the builder — each item (icon and text together) is one link (tel:, mailto:, https). */
export default function ContactLine({ d, ds, s, align, live = false }) {
  const rows = contactItems(d, ds.contactLines, undefined, ds.contactOrder);
  const size = (ds.bodySize - 1) * s;
  const mode = contactMode(d, ds);
  const icons = mode !== 'text';
  const sep = contactSepOf(ds, mode);
  const baseline = academic(ds); // Academic: small icons on the text baseline, | between items
  const monoColor = ds.accentOn.links || ds.accentOn.headings ? ds.accent : '#444';
  const linkColor = ds.accentOn.links ? ds.accent : ds.textColor;
  if (!rows[0].length) return <span style={{ fontSize: size, color: '#9A9A9A' }}>City · phone · email</span>;
  const wrap = (it, children, style) => (live && it.url
    ? <a key={it.kind + it.text} href={it.url} target={it.link ? '_blank' : undefined} rel="noreferrer" aria-label={showsText(it, mode) ? undefined : it.text} title={showsText(it, mode) ? undefined : it.text} data-contact={it.kind} style={{ color: 'inherit', textDecoration: 'none', ...style }}>{children}</a>
    : <span key={it.kind + it.text} data-contact={it.kind} aria-label={showsText(it, mode) ? undefined : it.text} style={style}>{children}</span>);
  return rows.map((items, r) => (
    <span key={r} style={{ display: 'flex', flexWrap: 'wrap', justifyContent: align === 'center' ? 'center' : 'flex-start', columnGap: icons && !sep ? 10 * s : 0, rowGap: 2 * s, fontSize: size, color: '#4a4a4a' }}>
      {items.map((it, i) => {
        const text = showsText(it, mode) && <span style={it.link ? { color: linkColor } : undefined}>{it.text}</span>;
        const sepEl = i > 0 && sep && <span aria-hidden="true" style={{ padding: `0 ${4 * s}px`, color: '#999' }}>{sep}</span>;
        if (!icons) return wrap(it, <>{sepEl}{text}</>, { overflowWrap: 'anywhere', color: it.link ? linkColor : undefined });
        if (baseline) {
          const g = size * iconScaleOf(ds);
          return wrap(it, <>{sepEl}<span style={{ whiteSpace: 'nowrap' }}><Glyph kind={it.kind} color={iconColor(it.kind, ds, monoColor)} size={g} style={{ display: 'inline-block', verticalAlign: 'baseline', marginRight: text ? 2.5 * s : 0 }} />{text}</span></>, { maxWidth: '100%', overflowWrap: 'anywhere' });
        }
        return wrap(it, <><Glyph kind={it.kind} color={iconColor(it.kind, ds, monoColor)} size={size * 1.1} />{text}</>, { display: 'inline-flex', alignItems: 'center', gap: 3 * s, overflowWrap: 'anywhere' });
      })}
    </span>
  ));
}
