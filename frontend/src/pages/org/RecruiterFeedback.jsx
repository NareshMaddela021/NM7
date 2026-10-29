// "What recruiters said" (R4): recruiters' feedback after drives — average rating, would visit again, the gaps they
// saw most across drives with free courses to close them, and each drive's answer. About drives, never one student;
// students never see it. On the placement dashboard and the Recruiters page.
import { useApi } from '../admin/live/common';

const VISIT = { yes: 'Would visit again', maybe: 'Maybe', no: 'Wouldn’t visit again' };
const day = (t) => (t ? new Date(t).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' }) : '');

export default function RecruiterFeedback({ base }) {
  const st = useApi(`${base}/recruiter-feedback`);
  if (!st.data) return null;
  const { summary: s, drives } = st.data;
  return (
    <section className="card stack g12" aria-label="What recruiters said" data-testid="recruiter-feedback">
      <div className="row between g8" style={{ flexWrap: 'wrap' }}>
        <strong>What recruiters said</strong>
        {s.count > 0 && <span className="small" data-testid="feedback-rating">{s.rating} / 5 · {s.count} drive{s.count === 1 ? '' : 's'} · {s.visitAgain.yes} would visit again</span>}
      </div>
      {s.count === 0 ? <span className="small muted">No feedback yet. Recruiters can give it from their portal after a drive.</span> : (
        <>
          <div className="stack g6">
            <span className="xs muted">Gaps recruiters saw most across drives, with free courses you can share with students:</span>
            <ul className="stack g8" style={{ listStyle: 'none', margin: 0, padding: 0 }}>
              {s.topGaps.map((g) => (
                <li key={g.gap} className="stack g4" data-testid="feedback-gap">
                  <span className="small"><strong>{g.gap}</strong> <span className="xs muted">· {g.count} drive{g.count === 1 ? '' : 's'}</span></span>
                  {g.courses.length > 0 && (
                    <span className="xs">Free: {g.courses.map((c, i) => <span key={c.id || c.url}>{i ? ' · ' : ''}<a href={c.url} target="_blank" rel="noopener noreferrer">{c.title}</a> ({c.provider})</span>)}</span>
                  )}
                </li>
              ))}
            </ul>
          </div>
          <details>
            <summary className="small">Each drive ({drives.length})</summary>
            <ul className="stack g8" style={{ listStyle: 'none', margin: '8px 0 0', padding: 0 }}>
              {drives.map((d) => (
                <li key={d.id} className="well stack g4" data-testid="feedback-drive">
                  <span className="small"><strong>{d.company}</strong> · {d.rating} / 5 · {VISIT[d.visitAgain]}<span className="xs muted"> · {day(d.updatedAt)}</span></span>
                  {d.gaps.length > 0 && <span className="xs">Gaps: {d.gaps.join(', ')}</span>}
                  {d.other && <span className="xs">Also: {d.other}</span>}
                  {d.wentWell && <span className="xs">Went well: {d.wentWell}</span>}
                </li>
              ))}
            </ul>
          </details>
        </>
      )}
    </section>
  );
}
