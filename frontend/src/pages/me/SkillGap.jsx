// After a job match: "3 of 5 must-have skills missing" with 1-3 FREE learning links per missing skill (Admin →
// Courses keeps the list; no affiliate or sponsored links). "I learned this" never adds the skill to the resume: it
// asks for a project or certificate that proves it.
import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { http, LIVE } from '../../services/http';

const LEARNED = 'nm7.learned';
const learnedSet = () => { try { return new Set(JSON.parse(localStorage.getItem(LEARNED) || '[]')); } catch { return new Set(); } };

export default function SkillGap({ m }) {
  const must = (m.items || []).filter((i) => i.group === 'must');
  const missing = must.filter((i) => i.status === 'missing');
  const [data, setData] = useState(null);
  const [learned, setLearned] = useState(learnedSet);
  const [ask, setAsk] = useState(null);
  const names = missing.map((i) => i.name).join(',');
  useEffect(() => {
    if (!LIVE || !names) return undefined;
    let on = true;
    http(`/api/me/courses?skills=${encodeURIComponent(names)}`).then((d) => on && setData(d), () => on && setData({ skills: [], catalogues: [] }));
    return () => { on = false; };
  }, [names]);
  if (!missing.length) return null;
  const mark = (skill) => {
    const next = new Set(learned); next.add(skill.toLowerCase());
    setLearned(next);
    try { localStorage.setItem(LEARNED, JSON.stringify([...next])); } catch { /* not remembered */ }
    setAsk(skill);
  };
  const bySkill = Object.fromEntries((data?.skills || []).map((s) => [s.skill.toLowerCase(), s.courses]));
  return (
    <section className="well stack g12" aria-labelledby="gap-h" data-testid="skill-gap">
      <strong id="gap-h">{missing.length} of {must.length} must-have skill{must.length > 1 ? 's' : ''} missing</strong>
      <span className="xs muted">Free courses only — no paid or sponsored links. Learning a skill doesn’t add it to your resume: show it with a project or certificate.</span>
      <ul className="stack g12" style={{ listStyle: 'none', margin: 0, padding: 0 }}>
        {missing.map((i) => {
          const courses = bySkill[i.name.toLowerCase()] || [];
          const done = learned.has(i.name.toLowerCase());
          return (
            <li key={i.name} className="stack g4" data-testid={`gap-${i.name}`}>
              <span className="row between g8" style={{ flexWrap: 'wrap', alignItems: 'center' }}>
                <strong className="small">{i.name}</strong>
                {done ? <span className="badge b-success">Learned</span>
                  : <button type="button" className="link-btn xs" onClick={() => mark(i.name)} data-testid="gap-learned">I learned this</button>}
              </span>
              {!data ? <span className="xs faint">Finding free courses…</span> : courses.length ? (
                <ul className="stack g4" style={{ listStyle: 'none', margin: 0, padding: 0 }}>
                  {courses.map((c) => (
                    <li key={c.id} className="xs">
                      <a href={c.url} target="_blank" rel="noopener noreferrer nofollow" data-testid="gap-course">{c.title}</a>
                      <span className="faint"> · {c.provider}{c.hours ? ` · about ${c.hours} h` : ''}{c.language && c.language !== 'English' ? ` · ${c.language}` : ''} · free</span>
                    </li>
                  ))}
                </ul>
              ) : (
                <span className="xs faint">No course in our list yet. Search {(data.catalogues || []).map((c, n) => <span key={c.url}>{n ? ' or ' : ''}<a href={c.url} target="_blank" rel="noopener noreferrer nofollow">{c.provider}</a></span>)} for “{i.name}”.</span>
              )}
              {ask === i.name && (
                <div className="card stack g8" role="status" data-testid="gap-prove" style={{ padding: 12 }}>
                  <span className="small">Nice work! We don’t add {i.name} to your resume by itself. Show it with something real:</span>
                  <span className="row g8" style={{ flexWrap: 'wrap' }}>
                    <Link className="btn btn-outline" style={{ minHeight: 36 }} to="/builder?start=section&sec=proj">Add a project that uses it</Link>
                    <Link className="btn btn-outline" style={{ minHeight: 36 }} to="/builder?start=section&sec=certs">Add a certificate</Link>
                    <button type="button" className="link-btn xs" onClick={() => setAsk(null)}>Later</button>
                  </span>
                </div>
              )}
            </li>
          );
        })}
      </ul>
    </section>
  );
}
