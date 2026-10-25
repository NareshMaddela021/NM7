// Branded templates (Nm7 for Organizations, Phase 3B). An organization's brand — logo, one colour, a header line,
// an optional footer line and one ATS-safe base template — is applied to org-side copies only (view, PDF, print,
// combined PDF, ZIP, kiosk print, recruiter links) of groups with "Print with organization template" on. The
// member's content (hidden entries already removed by the server) is drawn in the base template; the logo and colour
// go in the header strip only, and all resume text stays real, selectable text.
import { DEFAULT_DESIGN, TEMPLATE_PRESETS } from '../pages/builder/design';
import { INITIAL } from '../pages/builder/schema';
import { formatDesign } from './placementFormat';

/** The base templates an organization may choose: single column and ATS-safe. */
export const BRAND_TEMPLATES = ['fresher', 'campus', 'starter', 'work', 'classic', 'formal', 'care'];
export const MAX_LOGO = 300 * 1024;
export const LOGO_TYPES = ['image/png', 'image/jpeg', 'image/svg+xml'];

/** WCAG relative luminance of '#RRGGBB'. */
export function luminance(hex) {
  const n = parseInt(String(hex).replace('#', ''), 16);
  const ch = [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((v) => { const c = v / 255; return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4; });
  return 0.2126 * ch[0] + 0.7152 * ch[1] + 0.0722 * ch[2];
}

/** Contrast ratio of two colours (1 to 21). */
export function contrastRatio(a, b = '#FFFFFF') {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

/** null when the colour reads well on white paper; otherwise a warning to show. */
export function contrastWarning(hex) {
  if (!/^#[0-9a-f]{6}$/i.test(hex || '')) return 'Use a colour like #1F3A8A.';
  const r = contrastRatio(hex);
  return r < 4.5 ? `This colour is hard to read on white (contrast ${r.toFixed(1)}:1; aim for at least 4.5:1). Try a darker shade.` : null;
}

/** The design the member's content is drawn in: the college's template (the member's own when it is one of the
 * allowed ones — pass their resume as `data`), unchanged (colour only in the header strip). */
export function brandDesign(brand, data) {
  if (brand?.templates?.length) return formatDesign(brand, data);
  const k = BRAND_TEMPLATES.includes(brand?.template) ? brand.template : 'fresher';
  return { ...DEFAULT_DESIGN, ...TEMPLATE_PRESETS[k].design, preset: k };
}

/** Checks a chosen logo file before upload: '' when fine, else what's wrong. */
export function logoProblem(file) {
  if (!file) return 'Choose a file.';
  if (!LOGO_TYPES.includes(file.type)) return 'Use a PNG, JPG or SVG file.';
  if (file.size > MAX_LOGO) return 'The logo is over 300 KB. Please use a smaller file.';
  return '';
}

const loadImage = (src) => new Promise((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = rej; i.src = src; });

/**
 * The brand ready for the PDF maker: the logo as PNG or JPEG bytes with its proportions (an SVG is drawn to a PNG
 * here; as an <img> it can't run anything). Returns { ...brand, img: { data, format, ratio } | null }.
 */
export async function prepareBrand(brand) {
  if (!brand) return null;
  if (!brand.logo) return { ...brand, img: null };
  try {
    const i = await loadImage(brand.logo);
    const ratio = (i.naturalWidth || 4) / (i.naturalHeight || 1);
    if (brand.logo.startsWith('data:image/svg')) {
      const h = 240;
      const c = document.createElement('canvas');
      c.width = Math.max(1, Math.round(h * ratio)); c.height = h;
      c.getContext('2d').drawImage(i, 0, 0, c.width, c.height);
      return { ...brand, img: { data: c.toDataURL('image/png'), format: 'PNG', ratio } };
    }
    return { ...brand, img: { data: brand.logo, format: brand.logo.startsWith('data:image/png') ? 'PNG' : 'JPEG', ratio } };
  } catch {
    return { ...brand, img: null }; // a logo that can't be drawn is left out; the header line still prints
  }
}

/** The sample person the live preview shows (the builder's own sample). */
export const SAMPLE_RESUME = INITIAL;
