// Alumni network (Campus plan). Students of a past batch opt in (company, role, city, open to referrals / mentoring;
// pause or leave any time). Current students of the same college browse them and send a request with a short note
// (5 a week). Replies happen here; Nm7 never shows anyone's email or phone number.
import { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { Spinner, useToast } from '../../components/ui';
import { http } from '../../services/http';
import { MeHead } from './MeLayout';

const when = (t) => new Date(t).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' });

function Profile({ p, org, onSaved, onLeft }) {
  const toast = useToast();
  const [f, setF] = useState(p || { company: '', role: '', city: '', batch: '', referrals: true, mentoring: true, paused: false });
  const [busy, setBusy] = useState(false);
  const set = (k) => (e) => setF({ ...f, [k]: e.target.type === 'checkbox' ? e.target.checked : e.target.value });
  const save = async (e) => {
    e.preventDefault(); setBusy(true);
    try { onSaved(await http(`/api/me/alumni/profile/${org.orgId}`, { method: 'PUT', body: { ...f, batch: f.batch ? Number(f.batch) : null } })); toast('Saved'); } catch (x) { toast(x.message); } finally { setBusy(false); }
  };
  const leave = async () => { if (!window.confirm(`Leave ${org.orgName}'s alumni network?`)) return; try { await http(`/api/me/alumni/profile/${org.orgId}`, { method: 'DELETE' }); onLeft(); } catch (x) { toast(x.message); } };
  return (
    <form className="card stack g12" onSubmit={save} aria-label={`Alumni profile · ${org.orgName}`} data-testid="alumni-profile">
      <strong>{p ? 'My alumni profile' : 'Join the alumni network'} · {org.orgName}</strong>
      <span className="xs muted">Current students of {org.orgName} see your name, company, role, city and batch — never your email or phone number. Pause or leave any time.</span>
      <div className="row g8" style={{ flexWrap: 'wrap' }}>
        <label className="small" style={{ flex: '1 1 160px' }}>Company <input className="input" maxLength={80} value={f.company} onChange={set('company')} data-testid="al-company" /></label>
        <label className="small" style={{ flex: '1 1 160px' }}>Role <input className="input" maxLength={80} value={f.role} onChange={set('role')} data-testid="al-role" /></label>
        <label className="small" style={{ flex: '1 1 120px' }}>City <input className="input" maxLength={60} value={f.city} onChange={set('city')} /></label>
        <label className="small" style={{ flex: '0 1 100px' }}>Batch <input className="input" type="number" min="1950" max="2100" value={f.batch ?? ''} onChange={set('batch')} /></label>
      </div>
      <div className="row g12" style={{ flexWrap: 'wrap' }}>
        <label className="row g8 small"><input type="checkbox" checked={f.referrals} onChange={set('referrals')} data-testid="al-referrals" /> Open to referrals</label>
        <label className="row g8 small"><input type="checkbox" checked={f.mentoring} onChange={set('mentoring')} /> Open to mentoring</label>
        {p && <label className="row g8 small"><input type="checkbox" checked={f.paused} onChange={set('paused')} data-testid="al-pause" /> Pause (hide me for now)</label>}
      </div>
      <span className="row g8"><button type="submit" className="btn btn-ink" disabled={busy} data-testid="al-save">{busy && <Spinner />}{p ? 'Save' : 'Join'}</button>{p && <button type="button" className="btn btn-outline" onClick={leave}>Leave the network</button>}</span>
    </form>
  );
}

function Thread({ r, onReply }) {
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const send = async (e) => { e.preventDefault(); setBusy(true); try { await onReply(r, text); setText(''); } finally { setBusy(false); } };
  return (
    <li className="card stack g8" data-testid="al-thread">
      <span className="xs muted">{r.kind === 'referral' ? 'Referral' : 'Mentoring'} · {r.from ? `from ${r.from}` : `to ${r.to}`} · {when(r.at)}</span>
      <span className="small" style={{ whiteSpace: 'pre-wrap' }}>{r.note}</span>
      {r.replies.map((x, i) => <span key={i} className="well small" style={{ whiteSpace: 'pre-wrap' }} data-testid="al-reply">{x.mine ? 'You: ' : ''}{x.text}</span>)}
      <form className="row g8" onSubmit={send}><input className="input" style={{ flex: 1 }} minLength={2} maxLength={1000} required placeholder="Reply…" value={text} onChange={(e) => setText(e.target.value)} aria-label="Reply" data-testid="al-reply-input" /><button type="submit" className="btn btn-outline" disabled={busy} data-testid="al-reply-send">Send</button></form>
    </li>
  );
}

export default function MeAlumni() {
  const toast = useToast();
  const [ov, setOv] = useState(null);
  const [org, setOrg] = useState('');
  const [people, setPeople] = useState(null);
  const [asking, setAsking] = useState(null);
  const [mine, setMine] = useState([]);
  const [inbox, setInbox] = useState([]);
  const load = () => Promise.all([http('/api/me/alumni').then((o) => { setOv(o); setOrg((v) => v || o.browse[0]?.orgId || ''); }), http('/api/me/alumni/requests').then(setMine), http('/api/me/alumni/inbox').then(setInbox)]).catch((e) => toast(e.message));
  useEffect(() => { load(); }, []); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { if (org) http(`/api/me/alumni/browse/${org}`).then(setPeople, () => setPeople([])); }, [org]);
  const ask = async (e) => {
    e.preventDefault();
    try { await http('/api/me/alumni/requests', { method: 'POST', body: asking }); toast('Request sent'); setAsking(null); load(); } catch (x) { toast(x.message); }
  };
  const reply = async (r, text) => { try { await http(`/api/me/alumni/requests/${r.id}/reply`, { method: 'POST', body: { text } }); load(); } catch (x) { toast(x.message); } };
  if (!ov) return <div className="row g8"><Spinner /> Loading…</div>;
  return (
    <div className="stack g20">
      <MeHead title="Alumni network" sub="Ask your college’s alumni for a referral or mentoring — and help the batches after you." />
      {ov.profiles.map((p) => <Profile key={p.id} p={p} org={{ orgId: p.orgId, orgName: p.orgName }} onSaved={load} onLeft={load} />)}
      {ov.canJoin.map((o) => <Profile key={o.orgId} org={o} onSaved={load} onLeft={load} />)}
      {inbox.length > 0 && <section className="stack g8" aria-label="Requests to me"><strong>Requests to you</strong><ul className="stack g8" style={{ listStyle: 'none', margin: 0, padding: 0 }}>{inbox.map((r) => <Thread key={r.id} r={r} onReply={reply} />)}</ul></section>}
      {ov.browse.length > 0 && (
        <section className="stack g12" aria-label="Browse alumni" data-testid="al-browse">
          <div className="row between g8" style={{ flexWrap: 'wrap' }}><strong>Alumni of your college</strong>
            {ov.browse.length > 1 && <select className="input" value={org} onChange={(e) => setOrg(e.target.value)} aria-label="College">{ov.browse.map((o) => <option key={o.orgId} value={o.orgId}>{o.orgName}</option>)}</select>}
          </div>
          <span className="xs muted">Up to {ov.weeklyLimit} requests a week. Be specific: the role, and why you’re a fit.</span>
          {!people ? <Spinner /> : people.length === 0 ? <p className="small muted">No alumni have joined yet.</p> : (
            <ul className="stack g8" style={{ listStyle: 'none', margin: 0, padding: 0 }}>
              {people.map((p) => (
                <li key={p.id} className="card stack g8" data-testid="al-person">
                  <span className="row between g8" style={{ flexWrap: 'wrap' }}><strong className="small">{p.name}</strong><span className="xs muted">{[p.role, p.company, p.city, p.batch && `batch ${p.batch}`].filter(Boolean).join(' · ')}</span></span>
                  <span className="row g8" style={{ flexWrap: 'wrap' }}>
                    {p.referrals && <button type="button" className="btn btn-outline" style={{ minHeight: 32 }} onClick={() => setAsking({ alumniId: p.id, kind: 'referral', note: '' })} data-testid="al-ask-referral">Ask for a referral</button>}
                    {p.mentoring && <button type="button" className="btn btn-outline" style={{ minHeight: 32 }} onClick={() => setAsking({ alumniId: p.id, kind: 'mentoring', note: '' })}>Ask for mentoring</button>}
                  </span>
                  {asking?.alumniId === p.id && (
                    <form className="stack g8" onSubmit={ask}>
                      <textarea className="input" rows={3} minLength={10} maxLength={500} required placeholder="Hi! I’m in the 2026 batch…" value={asking.note} onChange={(e) => setAsking({ ...asking, note: e.target.value })} aria-label="Your note" data-testid="al-note" />
                      <span className="row g8"><button type="submit" className="btn btn-ink" data-testid="al-send">Send request</button><button type="button" className="btn btn-outline" onClick={() => setAsking(null)}>Cancel</button></span>
                    </form>
                  )}
                </li>
              ))}
            </ul>
          )}
        </section>
      )}
      {mine.length > 0 && <section className="stack g8" aria-label="My requests"><strong>My requests</strong><ul className="stack g8" style={{ listStyle: 'none', margin: 0, padding: 0 }}>{mine.map((r) => <Thread key={r.id} r={r} onReply={reply} />)}</ul></section>}
      {!ov.browse.length && !ov.profiles.length && !ov.canJoin.length && <p className="small muted">Your college hasn’t started an alumni network on Nm7 yet.</p>}
    </div>
  );
}

/** /alumni/join/:token — a coordinator's email invite: accept, then fill in the profile. */
export function AlumniJoin() {
  const { token } = useParams();
  const nav = useNavigate();
  const [err, setErr] = useState('');
  useEffect(() => { http(`/api/me/alumni/join/${encodeURIComponent(token)}`, { method: 'POST' }).then(() => nav('/me/alumni', { replace: true }), (e) => setErr(e.message)); }, [token, nav]);
  return <main id="main" className="container stack g12" style={{ padding: '48px 16px', maxWidth: 520 }}><h1 className="display h2">Alumni network</h1>{err ? <p role="alert">{err}</p> : <div className="row g8"><Spinner /> Joining…</div>}</main>;
}
