import { useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import Header from '../components/Header';
import { Icon, Spinner, TextField } from '../components/ui';
import { submitIntake } from '../services/api';
import { findOrder, updateOrder } from '../lib/expertStore';
import { PROMISES } from '../lib/pricing';

const ROLES = ['Data Analyst', 'Business Analyst', 'Software Engineer', 'Product', 'Marketing', 'Finance', 'HR', 'Design', 'Operations', 'Sales'];
const Q = [
  { title: 'Which roles should your resume win?', help: 'Your expert tailors keywords and order for these roles.', time: '20 SEC', why: 'Recruiters filter on role-specific keywords. Naming roles lets your expert match them exactly.' },
  { title: 'Tell us about the work you’re proudest of.', help: 'Write it like you’d tell a friend. Your expert turns it into sharp, recruiter-ready bullets.', time: '90 SEC', why: 'This is where the strongest lines on your resume come from. Raw detail beats polished vagueness.' },
  { title: 'Any numbers we can use?', help: 'Numbers are what recruiters notice first. Skip any you don’t know.', time: '40 SEC', why: 'A bullet with a number gets read; one without usually doesn’t.' },
  { title: 'Last thing — any preferences?', help: 'Optional, but it saves a revision round.', time: '30 SEC', why: 'Telling us what to leave out avoids surprises in your first draft.' },
];
const STEP_LABELS = ['Target roles', 'Your best work', 'Numbers', 'Preferences'];

export default function Intake() {
  const { id } = useParams();
  const [step, setStep] = useState(0);
  const [a, setA] = useState({ roles: ['Data Analyst'], companies: '', story: '', n1: '', n2: '', n3: '', n4: '', length: 'one', avoid: '' });
  const [sending, setSending] = useState(false);
  const [done, setDone] = useState(false);
  const set = (k) => (e) => setA({ ...a, [k]: e.target.value });

  const storyLen = a.story.trim().length;
  const blocked = (step === 0 && a.roles.length === 0) || (step === 1 && storyLen < 40);
  const next = async (e) => {
    e.preventDefault();
    if (blocked) return;
    if (step < 3) return setStep(step + 1);
    setSending(true);
    await submitIntake(id, a);
    if (findOrder(id)) { // the delivery promise counts from the finished intake
      const nums = [a.n1, a.n2, a.n3, a.n4].filter((x) => x.trim()).join('; ');
      updateOrder(id, (x) => ({ intake: { target: a.roles.join(', '), wins: a.story.trim(), numbers: nums, avoid: a.avoid.trim() || '—', companies: a.companies.trim(), length: a.length }, role: x.role === 'Not set' ? a.roles[0] : x.role, deadline: x.intake?.target ? x.deadline : (x.addons || []).includes('express') ? Math.min(x.deadline, Date.now() + 24 * 3600 * 1000) : Date.now() + 48 * 3600 * 1000, messages: [...(x.messages || []), { from: 'system', text: 'Customer completed the intake questions.', at: Date.now() }] }));
    }
    setSending(false);
    setDone(true);
  };
  const toggleRole = (r) => setA({ ...a, roles: a.roles.includes(r) ? a.roles.filter((x) => x !== r) : [...a.roles, r] });
  const q = Q[step];
  const pct = done ? 100 : (step / 4) * 100;

  return (
    <>
      <Header variant="flow" />
      <div role="progressbar" aria-label="Intake progress" aria-valuemin={0} aria-valuemax={4} aria-valuenow={done ? 4 : step} style={{ height: 4, background: 'var(--sunken)' }}>
        <div style={{ height: 4, width: `${pct}%`, background: 'var(--ink)', transition: 'width 360ms var(--ease)' }} />
      </div>

      {done ? (
        <main className="stack g20 rise" style={{ maxWidth: 720, margin: '0 auto', padding: '80px 24px', alignItems: 'center', textAlign: 'center' }}>
          <span style={{ width: 72, height: 72, borderRadius: '50%', background: 'var(--successbg)', color: 'var(--success)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}><Icon name="check" size={34} stroke={2.6} /></span>
          <h1 className="display h2">Your expert has everything they need.</h1>
          <p className="lead">Your rewritten resume arrives within <strong style={{ color: 'var(--text)' }}>{PROMISES.delivery}</strong>. We’ll message you on WhatsApp and email the moment it’s ready.</p>
          <div className="row g12" style={{ justifyContent: 'center' }}>
            <Link to={`/me/orders/${id}`} className="btn btn-ink btn-lg">Track my order</Link>
            <button type="button" className="btn btn-outline btn-lg" onClick={() => { setDone(false); setStep(0); }}>Edit my answers</button>
          </div>
        </main>
      ) : (
        <main className="container split" style={{ maxWidth: 1100, padding: '56px 24px 80px' }}>
          <form key={step} className="main stack g24 rise" onSubmit={next}>
            <span className="mono faint">QUESTION {step + 1} OF 4 · {q.time}</span>
            <h1 className="display h2" style={{ textWrap: 'balance' }}>{q.title}</h1>
            <p className="lead" style={{ fontSize: 17 }}>{q.help}</p>

            {step === 0 && (
              <div className="stack g12">
                <span id="rl" className="strong small">Pick up to 3 roles</span>
                <div role="group" aria-labelledby="rl" className="row g8">
                  {ROLES.map((r) => {
                    const on = a.roles.includes(r);
                    return <button key={r} type="button" className="chip" aria-pressed={on} disabled={!on && a.roles.length >= 3} onClick={() => toggleRole(r)}>{r}</button>;
                  })}
                </div>
                <TextField label="Dream companies or industries · optional" value={a.companies} onChange={set('companies')} placeholder="e.g. fintech startups, Swiggy, Deloitte" />
              </div>
            )}

            {step === 1 && (
              <div className="stack g8">
                <TextField textarea rows={6} label="Your proudest project, internship or job" value={a.story} onChange={set('story')} placeholder="What was the problem? What did YOU do? What changed after?" />
                <div className="row between xs">
                  <span style={{ color: storyLen === 0 ? 'var(--text3)' : storyLen < 40 ? 'var(--warning)' : 'var(--success)' }}>
                    {storyLen === 0 ? 'A few sentences is plenty.' : storyLen < 40 ? 'A little more detail — what changed because of you?' : 'Great — that’s enough to work with.'}
                  </span>
                  <span className="mono faint">{storyLen} chars</span>
                </div>
                <button type="button" className="btn btn-outline" style={{ alignSelf: 'flex-start' }}><Icon name="mic" size={16} />Rather talk? Record a voice note</button>
              </div>
            )}

            {step === 2 && (
              <div className="stack g12">
                <div className="grid-auto g12" style={{ '--min': '220px' }}>
                  <TextField label="People or users affected" value={a.n1} onChange={set('n1')} placeholder="e.g. 200 students" />
                  <TextField label="Time saved" value={a.n2} onChange={set('n2')} placeholder="e.g. 5 hrs/week" />
                  <TextField label="Improvement" value={a.n3} onChange={set('n3')} placeholder="e.g. 14% more sign-ups" />
                  <TextField label="Data or scale" value={a.n4} onChange={set('n4')} placeholder="e.g. 40K rows" />
                </div>
                <p className="well small muted">Rough is fine — “about 200 users” beats nothing. Your expert will never invent numbers for you.</p>
              </div>
            )}

            {step === 3 && (
              <div className="stack g16">
                <fieldset className="stack g8" style={{ border: 0, margin: 0, padding: 0 }}>
                  <legend className="strong small" style={{ marginBottom: 10 }}>Page length</legend>
                  <div className="row g8">
                    {[['one', 'One page (recommended)'], ['two', 'Two pages']].map(([v, l]) => (
                      <label key={v} className="option" data-on={a.length === v} style={{ width: 'auto', alignItems: 'center' }}>
                        <input type="radio" name="len" checked={a.length === v} onChange={() => setA({ ...a, length: v })} style={{ marginTop: 0 }} /><strong>{l}</strong>
                      </label>
                    ))}
                  </div>
                </fieldset>
                <TextField textarea rows={3} label="Anything to leave out or keep? · optional" value={a.avoid} onChange={set('avoid')} placeholder="e.g. Don’t mention my gap year · keep my college fest role" />
                <button type="button" className="btn btn-outline" style={{ alignSelf: 'flex-start', borderStyle: 'dashed' }}><Icon name="clip" size={16} />Attach a job description you’re targeting</button>
              </div>
            )}

            <div className="row g12">
              {step > 0 && <button type="button" className="btn btn-outline btn-lg" onClick={() => setStep(step - 1)}>Back</button>}
              <button type="submit" className="btn btn-ink btn-lg" disabled={blocked || sending}>{sending && <Spinner />}{step === 3 ? 'Send to my expert' : step === 2 ? 'Next · or skip' : 'Next'}</button>
            </div>
          </form>

          <aside className="side stack g16">
            <div className="card stack g8"><span className="mono faint">WHY WE ASK</span><p style={{ lineHeight: 1.6 }}>{q.why}</p></div>
            <ol className="stack g4" style={{ listStyle: 'none', margin: 0, padding: 0 }}>
              {STEP_LABELS.map((l, i) => (
                <li key={l} className="row g12" style={{ minHeight: 40, padding: '0 12px', borderRadius: 10, background: i === step ? 'var(--surface)' : 'transparent', fontWeight: i === step ? 600 : 500, color: i <= step ? 'var(--text)' : 'var(--text3)', fontSize: 14 }}>
                  <span style={{ width: 22, height: 22, borderRadius: '50%', boxSizing: 'border-box', border: `2px solid ${i < step ? 'var(--success)' : i === step ? 'var(--ink)' : 'var(--border2)'}`, background: i < step ? 'var(--success)' : 'transparent', color: 'var(--onink)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>{i < step && <Icon name="check" size={12} stroke={3} />}</span>{l}
                </li>
              ))}
            </ol>
          </aside>
        </main>
      )}
    </>
  );
}
