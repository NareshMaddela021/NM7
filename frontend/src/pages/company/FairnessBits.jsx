// Vetting Trust T12: warnings about discriminatory filters, shown where the company writes them — the job post and its
// questions (the Check card), the requirements editor and the Hire now filters. Each item says what was found, why it
// can be unfair and a neutral alternative. "Can't be used" (direct: gender, age, religion, …) is refused by the server
// too; "May be unfair" (a proxy: a college, "locals only", "young", a language the job doesn't need, …) can be kept:
// keeping it is logged for the Admin fairness report. Only rendered when the API sends `fairness` (the Trust switch
// lets the company in). English only while it is tested. Statically imported by the company pages (no new chunk).
import { useState } from 'react';
import { rq } from '../../lib/company';

/** Refused ones first, then warnings. */
export const fairSort = (items) => [...(items || [])].sort((a, b) => (a.level === b.level ? 0 : a.level === 'refuse' ? -1 : 1));

export function FairnessNotes({ items, cid, where, onRemove, testid = 'fair-notes' }) {
  const [kept, setKept] = useState(''); // '' | 'busy' | 'done'
  const list = fairSort(items);
  if (!list.length) return null;
  const warn = list.filter((x) => x.level === 'warn');
  const keep = async () => {
    setKept('busy');
    try { await rq(`/api/company/${cid}/trust/fairness/ack`, { method: 'POST', body: { where, findings: warn.map(({ topic, level, phrase }) => ({ topic, level, phrase })) } }); setKept('done'); } catch { setKept(''); }
  };
  return (
    <div className="stack g4" role="status" data-testid={testid} style={{ minWidth: 0, flexBasis: '100%' }}>
      {list.map((x, i) => (
        <p key={`${x.topic}-${i}`} className={`xs ${x.level === 'refuse' ? 'cj-bad' : 'cj-warn'}`} style={{ margin: 0, overflowWrap: 'anywhere' }} data-testid={`${testid}-${x.level}`}>
          <strong>{x.level === 'refuse' ? 'Can’t be used' : 'May be unfair'} ({x.label}): “{x.phrase}”.</strong> {x.why} <em>Try instead:</em> {x.suggest}
        </p>
      ))}
      {cid && warn.length > 0 && (
        <div className="row g8" style={{ flexWrap: 'wrap' }}>
          {onRemove && <button type="button" className="btn btn-outline btn-sm" onClick={onRemove} data-testid={`${testid}-remove`}>Remove this filter</button>}
          <button type="button" className="link-btn xs" style={{ minHeight: 44 }} disabled={!!kept} onClick={keep} data-testid={`${testid}-keep`}>{kept === 'done' ? 'Kept (noted)' : 'Keep it: the work needs it'}</button>
        </div>
      )}
    </div>
  );
}
