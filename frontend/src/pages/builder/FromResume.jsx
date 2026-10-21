// The top of the builder's Summary step: "Write it from my resume" (three versions to pick from, no AI), the
// "Mention my course" switch, the "Written from your resume" note after the automatic fill, and — when skills, role
// or experience changed since — "Your resume changed. Update the summary?" (Update / Keep mine). A summary the
// person wrote or edited is never replaced without them tapping Update.
import { useState } from 'react';
import { WRITTEN_NOTE, summaryBasis, versionsFromResume, writeFromResume } from '../../lib/summary/fromResume';

export default function FromResume({ d, setD }) {
  const [versions, setVersions] = useState(null);
  const course = !!d.summaryCourse;
  const from = d.summaryFrom;
  const changed = !!from && !!d.summary?.trim() && from.basis !== summaryBasis(d);
  const written = !!from && d.summary === from.text;
  const pick = (style, text) => setD((p) => ({ ...p, summary: text, summaryFrom: { style, text, basis: summaryBasis(p) } }));
  const write = (withCourse = course) => {
    const v = versionsFromResume(d, { course: withCourse });
    setVersions(v);
  };
  const update = () => {
    const text = writeFromResume(d, from.style, { course });
    if (text) pick(from.style, text);
    else setD((p) => ({ ...p, summaryFrom: { ...p.summaryFrom, basis: summaryBasis(p) } }));
  };
  const keep = () => setD((p) => ({ ...p, summaryFrom: { ...p.summaryFrom, basis: summaryBasis(p), text: p.summary } }));

  return (
    <div className="stack g8" data-testid="from-resume">
      {changed && (
        <div className="card row between g8" role="status" data-testid="summary-changed" style={{ padding: 12, alignItems: 'center', background: 'var(--warningbg)', borderColor: 'transparent' }}>
          <strong className="small">Your resume changed. Update the summary?</strong>
          <span className="row g8">
            <button type="button" className="btn btn-ink" style={{ minHeight: 44 }} onClick={update}>Update</button>
            <button type="button" className="btn btn-outline" style={{ minHeight: 44 }} onClick={keep}>Keep mine</button>
          </span>
        </div>
      )}
      <div className="row g12" style={{ alignItems: 'center' }}>
        <button type="button" className="btn btn-outline" style={{ minHeight: 44 }} onClick={() => write()}>Write it from my resume</button>
        <label className="row g8 small" style={{ alignItems: 'center', minHeight: 44 }}>
          <input type="checkbox" checked={course} onChange={(e) => { setD((p) => ({ ...p, summaryCourse: e.target.checked })); if (versions) write(e.target.checked); }} style={{ width: 20, height: 20 }} />
          Mention my course
        </label>
      </div>
      {versions && (versions.length ? (
        <div className="stack g8" data-testid="from-resume-versions">
          <span className="xs muted">Written only from what your resume says. Tap one to use it.</span>
          {versions.map((v) => (
            <button key={v.style} type="button" className="option stack g4" data-testid={`from-${v.style}`} onClick={() => { pick(v.style, v.text); setVersions(null); }} style={{ fontSize: 14, lineHeight: 1.5, textAlign: 'left' }}>
              <span>{v.text}</span><span className="xs faint">{v.label} · tap to use</span>
            </button>
          ))}
        </div>
      ) : <span className="small muted" role="status">Add your skills, a job or internship, or a target role first — there is nothing to write from yet.</span>)}
      {written && <span className="xs strong" style={{ color: 'var(--success)' }} data-testid="written-note">{WRITTEN_NOTE}</span>}
    </div>
  );
}
