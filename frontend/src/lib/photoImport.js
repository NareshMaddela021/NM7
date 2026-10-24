// "Snap photos": build a resume from photos (Aadhaar, work papers, a handwritten note…).
// The photos are shrunk in the browser, read on the server (POST /api/me/photo-import) and come back as items the
// person reviews; nothing is saved until they press "Looks right". ID numbers never come back (the server drops them).
import { http, LIVE, ApiError } from '../services/http';
import { addCourses } from './courses';
import { normDate } from './import/dates';
import { emptyResume } from '../pages/builder/schema';

export const MAX_PHOTOS = 6;
export const MAX_BYTES = 10 * 1024 * 1024;
const LONG_EDGE = 1600;
const TYPES = ['image/jpeg', 'image/png', 'image/webp', 'image/heic', 'image/heif'];
const EXT = /\.(jpe?g|png|webp|heic|heif)$/i;

/** A file the person picked → { name, data (base64 JPEG, ≤1600 px), url (preview) } or { name, error }. */
export async function preparePhoto(file) {
  const name = file.name || 'photo';
  if (!TYPES.includes((file.type || '').toLowerCase()) && !EXT.test(name)) return { name, error: 'This isn’t a photo. Please choose a JPG, PNG, WebP or HEIC picture.' };
  if (file.size > MAX_BYTES) return { name, error: 'This photo is over 10 MB. Please take it again or choose a smaller one.' };
  let bitmap;
  try { bitmap = await createImageBitmap(file); } catch {
    return { name, error: /heic|heif/i.test(file.type + name) ? 'This phone photo type (HEIC) can’t be opened here. Please take the photo again from this page, or choose a JPG.' : 'We couldn’t open this photo. Please choose it again.' };
  }
  const scale = Math.min(1, LONG_EDGE / Math.max(bitmap.width, bitmap.height));
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(bitmap.width * scale);
  canvas.height = Math.round(bitmap.height * scale);
  canvas.getContext('2d').drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  bitmap.close?.();
  const url = canvas.toDataURL('image/jpeg', 0.85);
  return { name, url, data: url.slice(url.indexOf(',') + 1) };
}

/** Sends the photos to be read. Throws ApiError (code feature_off / consent_required / id_consent_required / rate_limited / …). */
export async function readPhotos(photos, idConsent) {
  if (!LIVE) throw new ApiError(503, 'feature_off', 'Photo reading is being switched on - try again soon.');
  // reading can take a while (two model tries of 75 s each on the server): a long limit, never a retry (it's counted)
  return http('/api/me/photo-import', { method: 'POST', body: { photos: photos.map((p) => ({ name: p.name, data: p.data, isId: !!p.isId })), idConsent }, timeout: 180_000 });
}

/* ---------- review ---------- */
const lc = (s) => (s || '').toLowerCase();
const v = (f) => (f?.value || '').trim();
const low = (f) => f?.confidence === 'low';
let n = 0;
const rid = () => `r${Date.now().toString(36)}${(n += 1)}`;

// Name and city/state from the ID card are shown on the resume by default; the rest goes into Personal Information,
// which stays off on the resume.
export const ID_FIELDS = [['name', 'Name', true], ['city', 'City', true], ['state', 'State', true], ['address', 'Full address', false], ['dob', 'Date of birth', false], ['gender', 'Gender', false], ['guardian', 'Father’s / husband’s name', false]];
export const ABOUT_FIELDS = [['name', 'Name'], ['headline', 'Job title'], ['city', 'City'], ['state', 'State'], ['phone', 'Phone'], ['email', 'Email']];

/** The server's answer → what the review screen edits. */
export function toReview(res) {
  const p = res.personal || {};
  const about = ABOUT_FIELDS.map(([k, label]) => {
    const f = k === 'headline' ? { value: res.headline || '', confidence: 'high' } : p[k];
    return { key: k, label, value: v(f), check: low(f), keep: true, fromId: !!f?.fromId };
  }).filter((x) => x.value && !(x.fromId && ID_FIELDS.some(([k]) => k === x.key)));
  const fromId = ID_FIELDS.filter(([k]) => p[k]?.fromId && v(p[k])).map(([k, label, on]) => ({ key: k, label, value: v(p[k]), check: low(p[k]), keep: true, show: on }));
  const item = (o) => ({ id: rid(), keep: true, check: o.confidence === 'low', ...o });
  return {
    about,
    fromId,
    experience: (res.experience || []).filter((e) => e.role || e.company || e.lines?.length).map((e) => item({ role: e.role || '', company: e.company || '', from: e.from || '', to: e.to || '', text: (e.lines || []).join('\n'), confidence: e.confidence })),
    skills: (res.skills || []).filter((s) => v(s)).map((s) => item({ text: v(s), confidence: s.confidence })),
    certifications: (res.certifications || []).filter((c) => c.name).map((c) => item({ text: [c.name, c.issuer, c.year].filter(Boolean).join(' · '), name: c.name, issuer: c.issuer || '', year: c.year || '', confidence: c.confidence })),
    education: (res.education || []).filter((e) => e.degree || e.institution).map((e) => item({ text: [e.degree, e.institution, e.year].filter(Boolean).join(' · '), degree: e.degree || '', institution: e.institution || '', year: e.year || '', grade: e.grade || '', courses: Array.isArray(e.courses) ? e.courses : [], confidence: e.confidence })),
    languages: (res.languages || []).filter((l) => v(l)).map((l) => item({ text: v(l), confidence: l.confidence })),
    photos: res.photos || [],
  };
}
export const isEmptyReview = (r) => !r.about.length && !r.fromId.length && !r.experience.length && !r.skills.length && !r.certifications.length && !r.education.length && !r.languages.length;

const toDate = (dmy) => {
  const m = (dmy || '').match(/^(\d{1,2})[/.-](\d{1,2})[/.-](\d{4})$/);
  return m ? `${m[3]}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}` : dmy;
};
const GENDER = { m: 'Male', male: 'Male', f: 'Female', female: 'Female', other: 'Other', transgender: 'Other' };
/** "S/O Ramaiah" → father, "W/O Suresh" → spouse */
function guardianParts(text) {
  const t = (text || '').trim();
  if (/^(w\/o|wife of|h\/o|husband)/i.test(t)) return { spouse: t.replace(/^(w\/o|wife of|h\/o|husband( of|'s name)?)[:.\s]*/i, '').trim() };
  return { father: t.replace(/^(s\/o|d\/o|c\/o|son of|daughter of|father('s name)?)[:.\s]*/i, '').trim() };
}

/** Kept review items → builder resume data, on top of `base` (a blank resume). */
export function reviewToResume(r, base = emptyResume()) {
  const d = structuredClone(base);
  const about = Object.fromEntries(r.about.filter((x) => x.keep && x.value.trim()).map((x) => [x.key, x.value.trim()]));
  const id = Object.fromEntries(r.fromId.filter((x) => x.keep && x.value.trim()).map((x) => [x.key, x]));
  const shown = (k) => (id[k]?.show ? id[k].value.trim() : '');
  const name = about.name || shown('name');
  const place = [about.city || shown('city'), about.state || shown('state')].filter(Boolean).join(', ');
  d.personal = { ...d.personal, name: name || d.personal.name, headline: about.headline || d.personal.headline || '', location: place || d.personal.location || '', phone: about.phone || d.personal.phone || '', email: about.email || d.personal.email || '' };
  // ID details: switched on → printed in Personal Information; off → kept there, not printed
  const pinfo = { ...d.pinfo };
  if (id.address) pinfo.address = id.address.value.trim();
  if (id.dob) pinfo.dob = toDate(id.dob.value.trim());
  if (id.gender) pinfo.gender = GENDER[lc(id.gender.value.trim())] || id.gender.value.trim();
  if (id.guardian) Object.assign(pinfo, guardianParts(id.guardian.value));
  const pinfoOn = ['address', 'dob', 'gender', 'guardian'].filter((k) => id[k]?.show);
  if (pinfoOn.length) ['address', 'dob', 'gender'].forEach((k) => { if (!id[k]?.show) pinfo[k] = ''; });
  if (pinfoOn.length && !id.guardian?.show) { pinfo.father = base.pinfo?.father || ''; pinfo.spouse = ''; }
  d.pinfo = pinfo;
  d.exp = r.experience.filter((e) => e.keep && (e.role || e.company || e.text.trim())).map((e) => {
    const to = /present|now|current|till/i.test(e.to) ? '' : normDate(e.to);
    return { company: e.company, role: e.role, employmentType: '', from: normDate(e.from), to, current: /present|now|current|till/i.test(e.to), description: e.text.trim(), links: [] };
  });
  const skills = r.skills.filter((s) => s.keep && s.text.trim()).map((s) => s.text.trim());
  d.skillGroups = (d.skillGroups || []).map((g, i) => ({ ...g, value: i === 0 ? skills.join(', ') : '' }));
  d.certs = r.certifications.filter((c) => c.keep && c.text.trim()).map((c) => ({ name: c.name && c.text.startsWith(c.name) ? c.name : c.text.trim(), issuer: c.issuer || '', issueDate: normDate(c.year), expiryDate: '', credentialId: '', noExpiry: true, links: [] }));
  d.edu = r.education.filter((e) => e.keep && e.text.trim()).map((e) => ({ institution: e.institution, degree: e.degree || (e.institution ? '' : e.text.trim()), field: '', from: '', to: normDate(e.year), current: false, grade: e.grade, ...(e.courses?.length ? { courses: addCourses([], e.courses) } : {}) }));
  d.langs = r.languages.filter((l) => l.keep && l.text.trim()).map((l) => ({ name: l.text.trim(), level: '' }));
  d.summary = d.summary || '';
  d.hidden = { ...(d.hidden || {}), pinfo: !pinfoOn.length, edu: !d.edu.length, certs: !d.certs.length, langs: !d.langs.length };
  return d;
}
