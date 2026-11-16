// "What recruiters said" (R4): recruiters' feedback after drives — average rating, would visit again, the gaps they
// saw most across drives with free courses to close them, and each drive's answer. About drives, never one student;
// students never see it. On the placement dashboard and the Recruiters page.
import { useApi } from '../admin/live/common';
import { Chip } from '../me/kit';
import '../../styles/me-kit.css';
import '../../styles/org-team.css';

const VISIT = { yes: 'Would visit again', maybe: 'Maybe', no: 'Wouldn’t visit again' };
const day = (t) => (t ? new Date(t).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' }) : '');

export default function RecruiterFeedback({ base }) {
  const st = useApi(`${base}/recruiter-feedback`);
  if (!st.data) return null;
  const { summary: s, drives } = st.data;
  // round P, Phase 4: the average as a big number, would-visit-again as tiles, gaps as cards with their free courses
  return (
    <section className="mcard" aria-label="What recruiters said" data-testid="recruiter-feedback">
      <header className="mcard-h">
        <span className="mcard-ic" aria-hidden="true">❝</span>
        <span className="mcard-ht"><strong className="mcard-title">What recruiters said</strong>
          {s.count > 0 && <span className="mcard-sub" data-testid="feedback-rating">{s.rating} / 5 · {s.count} drive{s.count === 1 ? '' : 's'} · {s.visitAgain.yes} would visit again</span>}</span>
      </header>
      {s.count === 0 ? <span className="small muted">No feedback yet. Recruiters can give it from their portal after a drive.</span> : (
        <>
          <div className="ot-fb-tiles" aria-hidden="true">
            <div className="mstat"><span className="mstat-l">Average rating</span><strong className="mstat-v">{s.rating}<small className="ot-of"> / 5</small></strong></div>
            <div className="mstat"><span className="mstat-l">Drives</span><strong className="mstat-v">{s.count}</strong></div>
            <div className="mstat mstat-ok"><span className="mstat-l">Would visit again</span><strong className="mstat-v">{s.visitAgain.yes}</strong></div>
          </div>
          <div className="stack g8">
            <span className="xs muted">Gaps recruiters saw most across drives, with free courses you can share with students:</span>
            <ul className="ot-gaps">
              {s.topGaps.map((g) => (
                <li key={g.gap} className="ot-gap" data-testid="feedback-gap">
                  <span className="small"><strong>{g.gap}</strong> <Chip tone="warn">{g.count} drive{g.count === 1 ? '' : 's'}</Chip></span>
                  {g.courses.length > 0 && (
                    <span className="xs">Free: {g.courses.map((c, i) => <span key={c.id || c.url}>{i ? ' · ' : ''}<a href={c.url} target="_blank" rel="noopener noreferrer">{c.title}</a> ({c.provider})</span>)}</span>
                  )}
                </li>
              ))}
            </ul>
          </div>
          <details className="ot-details">
            <summary className="small">Each drive ({drives.length})</summary>
            <ul className="ot-gaps" style={{ marginTop: 8 }}>
              {drives.map((d) => (
                <li key={d.id} className="ot-gap" data-testid="feedback-drive">
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
