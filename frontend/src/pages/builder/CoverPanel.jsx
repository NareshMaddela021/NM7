// Cover letter editor: job details, a job-description check, and a draft written from the profile.
import { Icon } from '../../components/ui';
import { draftCover, jdMatch } from './cover';

export default function CoverPanel({ d, setCover, onAddSkill }) {
  const c = d.cover || {};
  const set = (k, v) => setCover({ ...c, [k]: v });
  const { matched, missing } = jdMatch(d, c.jd);
  const words = (c.body || '').trim().split(/\s+/).filter(Boolean).length;

  return (
    <div className="stack g16">
      <p className="muted" style={{ lineHeight: 1.55 }}>A one-page letter in the same design as your resume. Fill in the job, paste the job description if you have it, then write a draft and make it yours.</p>
      <div className="card stack g16" style={{ padding: 20 }}>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(min(220px, 100%), 1fr))', gap: 14 }}>
          {[['role', 'Job title you’re applying for', 'Data Analyst'], ['company', 'Company', 'Flipkart'], ['manager', 'Hiring manager’s name · optional', 'Ms. Ananya Rao']].map(([k, l, ph]) => (
            <div key={k} className="field">
              <label htmlFor={`cv-${k}`} className="label">{l}</label>
              <input id={`cv-${k}`} className="input" value={c[k] || ''} placeholder={`e.g. ${ph}`} onChange={(e) => set(k, e.target.value)} />
            </div>
          ))}
        </div>
        <label className="check small"><input type="checkbox" checked={c.subject !== false} onChange={(e) => set('subject', e.target.checked)} />Add a “Subject: Application for …” line (common in India)</label>
        <div className="field">
          <label htmlFor="cv-jd" className="label">Job description · optional</label>
          <textarea id="cv-jd" className="input" rows={5} value={c.jd || ''} placeholder="Paste the job post here. We match it against your skills." onChange={(e) => set('jd', e.target.value)} />
        </div>
        {c.jd?.trim() && (
          <div className="well stack g8 small">
            {matched.length > 0 && <span><strong style={{ color: 'var(--success)' }}>✓ You have:</strong> {matched.join(', ')}</span>}
            {missing.length > 0 && (
              <span className="stack g8"><span><strong style={{ color: 'var(--warning)' }}>The job also asks for:</strong> {missing.join(', ')}. Add any you really have to your skills.</span>
                <span className="row g4">{missing.slice(0, 8).map((m) => <button key={m} type="button" className="chip" style={{ minHeight: 32, fontSize: 12 }} onClick={() => onAddSkill(m)}>+ {m}</button>)}</span>
              </span>
            )}
            {!matched.length && !missing.length && <span className="muted">No known skills found in this description yet.</span>}
          </div>
        )}
      </div>

      <div className="card stack g12" style={{ padding: 20 }}>
        <div className="row between g8">
          <label htmlFor="cv-body" className="label" style={{ margin: 0 }}>Your letter</label>
          <span className={`xs strong`} style={{ color: words && (words < 150 || words > 400) ? 'var(--warning)' : 'var(--text3)' }}>{words} words{words ? (words < 150 ? ' · 200–350 reads best' : words > 400 ? ' · try trimming' : ' · good length') : ''}</span>
        </div>
        <textarea id="cv-body" className="input" rows={14} value={c.body || ''} placeholder="Leave a blank line between paragraphs." onChange={(e) => set('body', e.target.value)} />
        <div className="row g8">
          <button type="button" className="btn btn-signal" onClick={() => set('body', draftCover(d, c))}><Icon name="spark" size={15} />{c.body ? 'Write a new draft' : 'Write a draft for me'}</button>
          <span className="xs faint">Written from your profile{c.jd ? ' and the job description' : ''}. In the live app an AI writes it. Always read it and add your own voice.</span>
        </div>
      </div>
    </div>
  );
}
