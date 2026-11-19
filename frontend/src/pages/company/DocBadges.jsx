// Vetting Trust T2: "Verified via DigiLocker" badges on a Hire now card and an applicant card / profile. The row carries
// `docs` only when the Trust switch lets this company see them (Admin → Skill checks → Vetting Trust); otherwise nothing
// shows. Each badge: what was verified (no numbers, no board / university name: never used to judge anyone) and when.
// Vetting Trust T3: also the `face` badge (ID + selfie verified, same person at joining). English only for now.
const day = (v) => new Date(v).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' });

/** Vetting Trust T3: "ID + selfie verified" and, once done, "Same person at joining". Never a photo or a score. */
function FaceBadge({ face, compact }) {
  if (!face?.verifiedAt) return null;
  const text = `✓ ID + selfie verified${compact ? '' : `, ${day(face.verifiedAt)}`}${face.samePersonAt ? ` · Same person at joining${compact ? '' : `, ${day(face.samePersonAt)}`}` : ''}${face.test ? ' (test)' : ''}`;
  return <span className="mchip mchip-ok" data-testid="co-face" style={{ whiteSpace: 'normal', overflowWrap: 'anywhere', alignSelf: 'flex-start', maxWidth: '100%' }}>{text}</span>;
}

export default function DocBadges({ docs, face, compact = false }) {
  if (!docs?.length) return <FaceBadge face={face} compact={compact} />;
  if (face?.verifiedAt) return <span className="row g4" style={{ flexWrap: 'wrap', minWidth: 0 }}><FaceBadge face={face} compact={compact} /><DocBadges docs={docs} compact={compact} /></span>;
  if (compact) { // the applicant list: one line (the profile shows each badge with its date)
    const names = { dl: 'Driving licence', class10: 'Class 10', class12: 'Class 12', degree: 'Degree', pan: 'PAN' };
    return <span className="mchip mchip-ok" data-testid="co-docs-line" style={{ whiteSpace: 'normal', alignSelf: 'flex-start' }}>✓ Verified via DigiLocker: {docs.map((b) => names[b.kind] || b.kind).join(', ')}{docs.some((b) => b.test) ? ' (test)' : ''}</span>;
  }
  return (
    <ul className="doc-badges" aria-label="Documents verified via DigiLocker" data-testid="co-docs" style={{ listStyle: 'none', margin: 0, padding: 0, display: 'flex', flexWrap: 'wrap', gap: 6 }}>
      {docs.map((b) => (
        <li key={b.kind} className="mchip mchip-ok" data-testid={`co-doc-${b.kind}`} style={{ maxWidth: '100%', whiteSpace: 'normal', overflowWrap: 'anywhere' }}>
          <span aria-hidden="true">✓ </span>{b.label} · Verified via DigiLocker, {day(b.at)}{b.test ? ' (test)' : ''}
        </li>
      ))}
    </ul>
  );
}
