// Comments from the student's college reviewer, shown in the builder next to the section they're about ("Overall"
// comments on the first section). The student marks each one resolved. Signed-in students on the live site only.
import { useEffect, useState } from 'react';
import { http } from '../services/http';

let cache = null;
const subs = new Set();
const load = () => http('/api/me/review-comments').then((r) => { cache = r; subs.forEach((f) => f(r)); }, () => {});

export default function ReviewNotes({ sec, first }) {
  const [all, setAll] = useState(cache);
  useEffect(() => { subs.add(setAll); if (!cache) load(); return () => subs.delete(setAll); }, []);
  const mine = (all || []).filter((c) => c.section === sec || (first && c.section === 'general'));
  const open = mine.filter((c) => !c.resolved);
  if (!open.length) return null;
  const resolve = async (c) => { await http(`/api/me/review-comments/${c.id}/resolve`, { method: 'POST', body: { resolved: true } }); load(); };
  return (
    <div className="well stack g8" role="note" aria-label="Reviewer comments" data-testid="review-notes" style={{ borderLeft: '4px solid var(--warning)' }}>
      <strong className="small">Comments from {open[0].by || 'your college'}</strong>
      {open.map((c) => (
        <div key={c.id} className="row between g8" style={{ alignItems: 'flex-start', flexWrap: 'wrap' }} data-testid="review-note">
          <span className="small" style={{ minWidth: 0, flex: '1 1 220px' }}>{c.line ? <span className="faint">“{c.line}” — </span> : null}{c.text}</span>
          <button type="button" className="link-btn xs" onClick={() => resolve(c)} data-testid="review-resolve">Mark resolved</button>
        </div>
      ))}
    </div>
  );
}
