// Recruiter share links (Nm7 for Organizations, Phase 3C): plain logic shared by the recruiter page (/r/:token),
// the coordinator's link list and the "Share with a recruiter" dialog.

/** Resume share links (/r/<name>) are at most 40 lowercase letters, digits and dashes; recruiter link tokens are
 * 43 random characters — so the same /r/ address serves both. */
export const isRecruiterToken = (s) => /^[A-Za-z0-9_-]{41,100}$/.test(s || '');

export const LINK_STATE = { active: 'Active', expired: 'Expired', revoked: 'Revoked' };
export const DAY_CHOICES = [7, 14, 30, 60, 90];

/** The recruiter's list after their search box and "Interested only": name, headline and answers are searched. */
export function filterCandidates(list, { q = '', interestedOnly = false } = {}) {
  const words = q.trim().toLowerCase().split(/\s+/).filter(Boolean);
  return (list || []).filter((c) => {
    if (interestedOnly && !c.interested) return false;
    if (!words.length) return true;
    const hay = [c.name, c.headline, ...Object.values(c.answers || {})].join(' ').toLowerCase();
    return words.every((w) => hay.includes(w));
  });
}

/** A file name for one candidate's PDF. */
export const pdfName = (name) => `${(name || 'Resume').replace(/[^\p{L}\p{N} ._-]+/gu, '').trim().replace(/\s+/g, '_').slice(0, 60) || 'Resume'}_Resume.pdf`;

/** The links that have shortlisted someone, for the coordinator's "Shortlisted by" filter (newest first). */
export const shortlistChoices = (links) => (links || []).filter((l) => l.shortlisted > 0).map((l) => ({ id: l.id, label: `${l.company}${l.label ? ` · ${l.label}` : ''}` }));
