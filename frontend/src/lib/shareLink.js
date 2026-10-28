// The public resume link and "Share on WhatsApp": a wa.me link with a short message and the link — nothing else
// (no phone number, email or other details go into it).
export const SHARE_HOST = 'nm7.si';

/** The short link when there is one (nm7.si/r/<short>), else the named one; '' when the link is off. */
export function shareUrl(share) {
  if (!share?.on) return '';
  const key = share.short || share.slug;
  return key ? `https://${SHARE_HOST}/r/${key}` : '';
}

/** The named link (nm7.si/r/<name>), the one people can read out. */
export const namedUrl = (share) => (share?.slug ? `https://${SHARE_HOST}/r/${share.slug}` : '');

const clean = (s) => String(s || '').replace(/\s+/g, ' ').trim().slice(0, 80);

/** The message: "Hi, here is my resume: <link>", or "…for the <role> role at <company>: <link>" from a job match. */
export function shareMessage(link, { role, company } = {}) {
  const r = clean(role);
  const c = clean(company);
  const job = r ? ` for the ${r} role${c ? ` at ${c}` : ''}` : '';
  return `Hi, here is my resume${job}: ${link}`;
}

/** wa.me with the text only: WhatsApp then asks which chat to send it to. */
export const waShareUrl = (text) => `https://wa.me/?text=${encodeURIComponent(text)}`;
