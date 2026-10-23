// Public LinkedIn text never carries a phone number, an email address or an ID number (Aadhaar, PAN, account).
export const PHONE_RE = /(?<!\d)(?:\+?91[\s-]?)?[6-9]\d{4}[\s-]?\d{5}(?!\d)/g;
export const EMAIL_RE = /[\w.+-]+@[\w-]+\.[\w.]+/g;
export const ID_RE = /(?<!\d)\d{4}[\s-]?\d{4}[\s-]?\d{4}(?!\d)|\b[A-Z]{5}\d{4}[A-Z]\b|(?<!\d)\d{9,18}(?!\d)/g;

/** True when the text holds a phone number, an email address or an ID-like number. */
export const hasPrivate = (t) => [PHONE_RE, EMAIL_RE, ID_RE].some((re) => { re.lastIndex = 0; return re.test(String(t || '')); });

/** The text with phone numbers, emails and ID numbers removed (and the spaces tidied). */
export function stripPrivate(t) {
  return String(t || '').replace(EMAIL_RE, '').replace(PHONE_RE, '').replace(ID_RE, '')
    .replace(/\(\s*\)|\[\s*\]/g, '').replace(/[ \t]{2,}/g, ' ').replace(/\s+([,.;:])/g, '$1').replace(/([,;:|·])\s*(?=[,;:|·]|$)/g, '').trim();
}
