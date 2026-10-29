// Real student stories (approved by Nm7, with the student's consent for public use). Nothing shows until there are
// some: no made-up testimonials. Demo stories are never in the public list (the server leaves them out).
import { useEffect, useState } from 'react';
import { LIVE, http } from '../services/http';

export default function Stories({ title = 'What students say', limit = 6, className = '', headingId = 'stories-h' }) {
  const [rows, setRows] = useState([]);
  useEffect(() => {
    if (!LIVE) return undefined;
    let off = false;
    http(`/api/public/stories?limit=${limit}`).then((r) => !off && setRows(r), () => {});
    return () => { off = true; };
  }, [limit]);
  if (!rows.length) return null;
  return (
    <section className={className} aria-labelledby={headingId} data-testid="stories">
      <div className="h-wrap stack g16">
        <h2 id={headingId} className="h-sec-title">{title}</h2>
        <ul className="row g16" style={{ listStyle: 'none', margin: 0, padding: 0, flexWrap: 'wrap', alignItems: 'stretch' }}>
          {rows.map((s) => (
            <li key={s.id} className="card stack g12" style={{ flex: '1 1 260px', maxWidth: 420 }} data-testid="story">
              <blockquote style={{ margin: 0 }} className="small">“{s.story}”</blockquote>
              <div className="row g8" style={{ alignItems: 'center' }}>
                {s.photo && <img src={s.photo} alt="" width={40} height={40} style={{ borderRadius: '50%', objectFit: 'cover' }} />}
                <span className="stack"><strong className="small">{s.displayName}</strong>{(s.role || s.company) && <span className="xs muted">{[s.role, s.company].filter(Boolean).join(' · ')}</span>}</span>
              </div>
            </li>
          ))}
        </ul>
        <span className="xs faint">Shared by students with their permission.</span>
      </div>
    </section>
  );
}
