// One icon set for the resume header: brand logos (brands.js) + simple line icons.
// The same SVG is used by the live preview, and turned into a sharp PNG for the PDF and Word file.
import { BRANDS } from './brands';

// line icons, 24×24, drawn with the current colour
const LINE = {
  email: '<rect x="3" y="5" width="18" height="14" rx="2"/><path d="M3 7l9 6 9-6"/>',
  phone: '<path d="M22 16.9v3a2 2 0 01-2.2 2 19.8 19.8 0 01-8.6-3.1 19.5 19.5 0 01-6-6A19.8 19.8 0 012.1 4.2 2 2 0 014.1 2h3a2 2 0 012 1.7c.1.9.4 1.8.7 2.7a2 2 0 01-.5 2.1L8 9.8a16 16 0 006 6l1.3-1.3a2 2 0 012.1-.4c.9.3 1.8.6 2.7.7a2 2 0 011.7 2z"/>',
  location: '<path d="M12 21s-7-6.2-7-11a7 7 0 0114 0c0 4.8-7 11-7 11z"/><circle cx="12" cy="10" r="2.5"/>',
  globe: '<circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3a14 14 0 010 18M12 3a14 14 0 000 18"/>',
  briefcase: '<rect x="3" y="7" width="18" height="13" rx="2"/><path d="M9 7V5a2 2 0 012-2h2a2 2 0 012 2v2M3 13h18"/>',
  code: '<path d="M8 7l-5 5 5 5M16 7l5 5-5 5M14 4l-4 16"/>',
  link: '<path d="M10 14a4 4 0 005.7 0l3-3a4 4 0 00-5.7-5.7l-1 1"/><path d="M14 10a4 4 0 00-5.7 0l-3 3a4 4 0 005.7 5.7l1-1"/>',
  pen: '<path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 013 3L7 19l-4 1 1-4z"/>',
  resume: '<path d="M14 3H7a2 2 0 00-2 2v14a2 2 0 002 2h10a2 2 0 002-2V8z"/><path d="M14 3v5h5M9 13h6M9 17h4"/>',
};

/** Icons a user can pick for Portfolio and extra links. */
export const PICKABLE = [['globe', 'Globe'], ['briefcase', 'Briefcase'], ['code', 'Code'], ['link', 'Link'], ['pen', 'Pen']];
export const isBrand = (k) => !!BRANDS[k];
export const brandName = (k) => BRANDS[k]?.name || '';

const HOSTS = [
  [/linkedin\.com/, 'linkedin'], [/github\.(com|io)/, 'github'], [/(^|\.)(x|twitter)\.com/, 'x'], [/stackoverflow\.com/, 'stackoverflow'],
  [/medium\.com/, 'medium'], [/kaggle\.com/, 'kaggle'], [/leetcode\.(com|cn)/, 'leetcode'], [/hackerrank\.com/, 'hackerrank'],
  [/codechef\.com/, 'codechef'], [/codeforces\.com/, 'codeforces'], [/behance\.net/, 'behance'], [/dribbble\.com/, 'dribbble'],
  [/(youtube\.com|youtu\.be)/, 'youtube'], [/instagram\.com/, 'instagram'], [/(notion\.site|notion\.so)/, 'notion'], [/(drive|docs)\.google\.com/, 'googledrive'],
];
/** Brand key for a URL, or null. */
export function detectBrand(url) {
  const host = (url || '').toLowerCase().replace(/^https?:\/\//, '').replace(/^www\./, '').split('/')[0];
  return HOSTS.find(([re]) => re.test(host))?.[1] || null;
}

/** Inner SVG markup for an icon in a colour. Brand logos are filled; line icons are stroked. */
export function iconInner(key, color) {
  if (BRANDS[key]) return `<path fill="${color}" d="${BRANDS[key].path}"/>`;
  return `<g fill="none" stroke="${color}" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${LINE[key] || LINE.link}</g>`;
}
export const iconSvg = (key, color) => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24">${iconInner(key, color)}</svg>`;

/** Which colour an icon uses: brand logos keep their colour in "brand" mode; everything else uses the icon colour. */
export const iconColor = (key, ds, mono) => (BRANDS[key] && ds.logoColor !== 'mono' ? BRANDS[key].hex : mono);

const pngCache = new Map();
/** Icon as a PNG data URL (for jsPDF / Word). Browser only. */
export function iconPng(key, color, px = 96) {
  const id = `${key}|${color}|${px}`;
  if (!pngCache.has(id)) {
    pngCache.set(id, new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => {
        const cv = document.createElement('canvas');
        cv.width = px; cv.height = px;
        cv.getContext('2d').drawImage(img, 0, 0, px, px);
        resolve(cv.toDataURL('image/png'));
      };
      img.onerror = reject;
      img.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(iconSvg(key, color))}`;
    }));
  }
  return pngCache.get(id);
}
