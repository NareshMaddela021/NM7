// After a job match: "3 of 5 must-have skills missing" with 1-3 FREE learning links per missing skill (Admin ->
// Courses keeps the list; no affiliate or sponsored links). "I learned this" never adds the skill to the resume: it
// asks for a project or certificate that proves it.
import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { http, LIVE } from '../../services/http';
import { Bar, Chip } from './kit';
import '../../styles/me-learn.css';
import { IcTrend } from '../../components/icons';

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
    <section className="mcard mcard-flat stack g12" aria-labelledby="gap-h" data-testid="skill-gap">
      <header className="mcard-h">
        <span className="mcard-ic student" aria-hidden="true"><IcTrend /></span>
        <span className="mcard-ht">
          <h3 className="mcard-title" id="gap-h" style={{ fontSize: '20px' }}>{missing.length} of {must.length} must-have skill{must.length > 1 ? 's' : ''} missing</h3>
          <span className="mcard-sub">Free courses only — no paid or sponsored links. Learning a skill doesn’t add it to your resume: show it with a project or certificate.</span>
        </span>
      </header>
      <Bar value={must.length - missing.length} max={must.length} label="Must-have skills you have" tone="student" />
      <ul className="mlist">
        {missing.map((i) => {
          const courses = bySkill[i.name.toLowerCase()] || [];
          const done = learned.has(i.name.toLowerCase());
          return (
            <li key={i.name} className="mitem" style={{ alignItems: 'flex-start' }} data-testid={`gap-${i.name}`}>
              <div className="mitem-main">
                <span className="mspread">
                  <strong className="mitem-title">{i.name}</strong>
                  {done ? <Chip tone="ok">Learned</Chip>
                    : <button type="button" className="btn btn-outline btn-sm" style={{ minHeight: 40 }} onClick={() => mark(i.name)} data-testid="gap-learned">I learned this</button>}
                </span>
                {!data ? <span className="xs faint">Finding free courses…</span> : courses.length ? (
                  <ul className="ml-jobs">
                    {courses.map((c) => (
                      <li key={c.id} className="small">
                        <a href={c.url} target="_blank" rel="noopener noreferrer nofollow" data-testid="gap-course">{c.title}</a>
                        <span className="faint xs"> · {c.provider}{c.hours ? ` · about ${c.hours} h` : ''}{c.language && c.language !== 'English' ? ` · ${c.language}` : ''} · free</span>
                      </li>
                    ))}
                  </ul>
                ) : (
                  <span className="xs faint">No course in our list yet. Search {(data.catalogues || []).map((c, n) => <span key={c.url}>{n ? ' or ' : ''}<a href={c.url} target="_blank" rel="noopener noreferrer nofollow">{c.provider}</a></span>)} for “{i.name}”.</span>
                )}
                {ask === i.name && (
                  <div className="mcard mcard-ok mcard-tight" role="status" data-testid="gap-prove">
                    <span className="small">Nice work! We don’t add {i.name} to your resume by itself. Show it with something real:</span>
                    <span className="ml-actions">
                      <Link className="btn btn-outline btn-sm" to="/builder?start=section&sec=proj">Add a project that uses it</Link>
                      <Link className="btn btn-outline btn-sm" to="/me/certificates">Add a certificate</Link>
                      <button type="button" className="btn btn-ghost btn-sm" onClick={() => setAsk(null)}>Later</button>
                    </span>
                  </div>
                )}
              </div>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
