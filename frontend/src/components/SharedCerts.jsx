// The certificates a student chose to share with their resume ("Share certificates" on, and ticked), for college
// staff and recruiters. Shown under the resume; each opens with the viewer's own access.
import { useState } from 'react';

export default function SharedCerts({ list, open }) {
  const [err, setErr] = useState('');
  if (!list?.length) return null;
  const view = async (c) => { setErr(''); try { await open(c); } catch (e) { setErr(e.message); } };
  return (
    <section className="well stack g8" aria-label="Shared certificates" data-testid="shared-certs">
      <strong className="small">Certificates ({list.length})</strong>
      <ul className="stack g4" style={{ listStyle: 'none', margin: 0, padding: 0 }}>
        {list.map((c) => (
          <li key={c.id} className="row between g8" style={{ flexWrap: 'wrap', alignItems: 'center' }} data-testid="shared-cert">
            <span className="small" style={{ minWidth: 0 }}><strong>{c.title}</strong>{[c.issuer, c.date].filter(Boolean).length ? <span className="muted"> · {[c.issuer, c.date].filter(Boolean).join(' · ')}</span> : null}</span>
            <button type="button" className="btn btn-outline" style={{ minHeight: 36 }} onClick={() => view(c)}>View</button>
          </li>
        ))}
      </ul>
      {err && <span role="alert" className="xs error">{err}</span>}
    </section>
  );
}
