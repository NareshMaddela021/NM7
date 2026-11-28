// Indian mobile numbers in the phone boxes (PhoneInput): the box holds "98765 43210" (the +91 sits outside it), the
// server stores E.164 "+919876543210" and the pages show "+91 98765 43210". Same rules as backend/app/core/phone.py.

/** The digits a person meant, at most 10: a pasted "+91 98765-43210", "919876543210", "09876543210" or
 * "0091 98765 43210" gives "9876543210". 10 digits that start with 91 are a number, not a country code. */
function strip(raw) {
  let d = String(raw ?? '').replace(/\D/g, '');
  if (d.length > 10) {
    d = d.replace(/^00/, '');
    if (d.length === 12 && d.startsWith('91')) d = d.slice(2);
    else if (d.length === 11 && d[0] === '0') d = d.slice(1);
  }
  return d;
}
export const phoneDigits = (raw) => strip(raw).slice(0, 10);

/** What the box shows: "98765 43210", or "9876" while typing. */
export const maskPhone = (raw) => { const d = phoneDigits(raw); return d.length > 5 ? `${d.slice(0, 5)} ${d.slice(5)}` : d; };

/** A full Indian mobile: 10 digits, starting 6-9. */
export const isPhone = (raw) => /^[6-9]\d{9}$/.test(strip(raw));

/** '' when fine; else the reason key: empty (only when required) or invalid. */
export const phoneIssue = (raw, required = false) => (!phoneDigits(raw) ? (required ? 'empty' : '') : isPhone(raw) ? '' : 'invalid');

/** "+919876543210" for a full mobile, '' for an empty box, else the box as typed (the server says what is wrong). */
export const toE164 = (raw) => (isPhone(raw) ? `+91${phoneDigits(raw)}` : phoneDigits(raw) ? String(raw).trim() : '');

/** How a stored number is shown: "+91 98765 43210"; anything else as it was. */
export const showPhone = (raw) => (isPhone(raw) ? `+91 ${maskPhone(raw)}` : raw || '');
