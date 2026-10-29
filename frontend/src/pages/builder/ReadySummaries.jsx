// "Pick a ready summary" on the builder's Summary step, for freshers: 12 hand-picked summaries (lib/summary/
// summaries.json), the one matching the target role first. A tap fills the summary box, which stays fully editable.
// Headings follow the page language (Telugu / Hindi); the summary text stays English, like the resume.
import { useState } from 'react';
import { useLang } from '../../lib/i18n';
import { READY_FILTERS, READY_TIP, headingOf, orderFor, textFor } from '../../lib/summary/library';

export default function ReadySummaries({ d, onPick }) {
  const [, lang] = useLang();
  const [filter, setFilter] = useState('all');
  const list = orderFor(d, filter);
  return (
    <section className="stack g12 ready-sums" aria-labelledby="ready-h" data-testid="ready-summaries">
      <div className="stack g4">
        <h3 id="ready-h" style={{ fontSize: 17 }}>Pick a ready summary</h3>
        <span className="xs muted">Written for freshers. Tap one to put it in the box above, then make it yours.</span>
      </div>
      <div className="row g8" role="group" aria-label="Filter ready summaries">
        {READY_FILTERS.map(([k, l]) => <button key={k} type="button" className="chip" aria-pressed={filter === k} onClick={() => setFilter(k)} style={{ minHeight: 44 }}>{l}</button>)}
      </div>
      <ul className="stack g8" style={{ listStyle: 'none', margin: 0, padding: 0 }}>
        {list.map((s) => {
          const heading = headingOf(s, lang);
          const text = textFor(s, d);
          return (
            <li key={s.id}>
              <button type="button" className="option stack g4" data-testid={`ready-${s.id}`} onClick={() => onPick(text, s)} style={{ width: '100%', textAlign: 'left', fontSize: 14, lineHeight: 1.5 }}>
                <strong lang={heading === s.heading ? 'en' : lang}>{heading}</strong>
                <span lang="en">{text}</span>
                <span className="xs faint">Tap to use</span>
              </button>
            </li>
          );
        })}
      </ul>
      <p className="xs muted" style={{ margin: 0 }} data-testid="ready-tip">{READY_TIP}</p>
    </section>
  );
}
