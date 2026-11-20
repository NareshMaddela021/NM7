// The two Vetting Trust links that work without signing in (T1), opened from an email at /stop-alerts#k=…&t=…:
//   k=consent  take back consents (a signed link, valid 30 days; "all" or one purpose)
//   k=parent   a parent or guardian agrees (or not) for an under-18 (a one-time link, valid 7 days)
//   k=book · k=join · k=cjoin   T11: interview times, the joining day, the company's "did they join?" (BookingLink.jsx)
//   k=ratt · k=rstay · k=rme    T15: attended?, still working after 30 / 90 days?, the candidate's side (ReliabilityLink.jsx)
// The token stays in the address fragment, so it never reaches server logs.
import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { http } from '../../../services/http';
import { Book, CompanyJoin, Join } from './BookingLink'; // T11: the one-tap interview / joining-day links
import { RelAttendance, RelMe, RelStay } from './ReliabilityLink'; // T15: the reliability record's one-tap links

function Withdraw({ token }) {
  const [items, setItems] = useState(null);
  const [pick, setPick] = useState({});
  const [st, setSt] = useState({});
  useEffect(() => {
    http('/api/public/trust/withdraw/check', { method: 'POST', body: { token } }).then((d) => {
      setItems(d.items);
      setPick(Object.fromEntries(d.items.filter((i) => i.status === 'granted' || i.status === 'outdated').map((i) => [i.purpose, true])));
    }, (e) => setSt({ error: e.message }));
  }, [token]);
  const chosen = Object.keys(pick).filter((k) => pick[k]);
  const go = async () => {
    setSt({ busy: true });
    try { setSt({ done: await http('/api/public/trust/withdraw', { method: 'POST', body: { token, purposes: chosen } }) }); } catch (e) { setSt({ error: e.message }); }
  };
  if (st.done) return <p data-testid="tl-done">Done. We stopped using your data for {st.done.withdrawn.length} purpose{st.done.withdrawn.length === 1 ? '' : 's'} and deleted {st.done.deleted} item{st.done.deleted === 1 ? '' : 's'}. You can agree again any time in <Link to="/me/settings#s-consent">Profile &amp; settings</Link>.</p>;
  if (st.error && !items) return <p role="alert" className="error">{st.error}</p>;
  if (!items) return <p className="muted">Checking the link…</p>;
  const active = items.filter((i) => i.status === 'granted' || i.status === 'outdated');
  if (!active.length) return <p data-testid="tl-none">There is nothing to take back: you haven’t agreed to any of these. Manage them in <Link to="/me/settings#s-consent">Profile &amp; settings</Link>.</p>;
  return (
    <div className="stack g12">
      <p className="muted" style={{ margin: 0 }}>Choose what to take back. We stop using your data for it and delete what we hold for it now.</p>
      <ul className="stack g8" style={{ listStyle: 'none', padding: 0, margin: 0 }}>
        {active.map((i) => (
          <li key={i.purpose}>
            <label className="row g8" style={{ alignItems: 'flex-start', minHeight: 44 }}>
              <input type="checkbox" style={{ width: 20, height: 20, marginTop: 2 }} checked={!!pick[i.purpose]} onChange={(e) => setPick({ ...pick, [i.purpose]: e.target.checked })} data-testid={`tl-${i.purpose}`} />
              <span><strong>{i.title}</strong><br /><span className="small muted">{i.text}</span></span>
            </label>
          </li>
        ))}
      </ul>
      {st.error && <p role="alert" className="error">{st.error}</p>}
      <button type="button" className="btn btn-ink" style={{ alignSelf: 'flex-start', minHeight: 44 }} disabled={st.busy || !chosen.length} onClick={go} data-testid="tl-withdraw">Take back and delete</button>
    </div>
  );
}

function Parent({ token }) {
  const [d, setD] = useState(null);
  const [f, setF] = useState({ parentName: '', relation: 'mother', agree: false });
  const [st, setSt] = useState({});
  useEffect(() => { http('/api/public/trust/parent/check', { method: 'POST', body: { token } }).then(setD, (e) => setSt({ error: e.message })); }, [token]);
  const send = async (yes) => {
    setSt({ busy: true });
    try {
      await http(`/api/public/trust/parent/${yes ? 'confirm' : 'decline'}`, { method: 'POST', body: yes ? { token, ...f } : { token } });
      setSt({ done: yes ? 'yes' : 'no' });
    } catch (e) { setSt({ error: e.message }); }
  };
  if (st.done) return <p data-testid="tl-done">{st.done === 'yes' ? `Thank you. ${d.child} can now use skill verification. They can take back any consent at any time.` : `Thank you. ${d.child}’s skill verification stays locked.`}</p>;
  if (st.error && !d) return <p role="alert" className="error">{st.error}</p>;
  if (!d) return <p className="muted">Checking the link…</p>;
  return (
    <div className="stack g12">
      <p style={{ margin: 0 }}><strong>{d.child}</strong> is under 18 and wants to use Nm7’s skill verification (tests, interviews and identity checks that help them get hired). The law asks a parent or guardian to agree first. This is what they would be asked to agree to, one by one:</p>
      <ul className="stack g8 small" style={{ margin: 0, paddingLeft: 18 }}>{d.purposes.map((p) => <li key={p.title}><strong>{p.title}:</strong> {p.text}</li>)}</ul>
      <p className="small muted" style={{ margin: 0 }}>Their age is never used to score them. Nm7 never stores an Aadhaar number or image. They can take back any consent at any time, and their data is then deleted.</p>
      <div className="row g8" style={{ flexWrap: 'wrap' }}>
        <div className="field" style={{ flex: '1 1 200px' }}><label className="label" htmlFor="tl-pn">Your full name</label><input id="tl-pn" className="input" value={f.parentName} onChange={(e) => setF({ ...f, parentName: e.target.value })} data-testid="tl-parent-name" /></div>
        <div className="field" style={{ flex: '1 1 160px' }}><label className="label" htmlFor="tl-rel">You are their</label>
          <select id="tl-rel" className="input" value={f.relation} onChange={(e) => setF({ ...f, relation: e.target.value })}><option value="mother">Mother</option><option value="father">Father</option><option value="guardian">Guardian</option><option value="other">Other</option></select></div>
      </div>
      <label className="row g8" style={{ alignItems: 'flex-start', minHeight: 44 }}><input type="checkbox" style={{ width: 20, height: 20, marginTop: 2 }} checked={f.agree} onChange={(e) => setF({ ...f, agree: e.target.checked })} data-testid="tl-agree" /><span>I am {d.child}’s parent or legal guardian and I agree.</span></label>
      {st.error && <p role="alert" className="error">{st.error}</p>}
      <div className="row g8" style={{ flexWrap: 'wrap' }}>
        <button type="button" className="btn btn-ink" style={{ minHeight: 44 }} disabled={st.busy || !f.agree || f.parentName.trim().length < 2} onClick={() => send(true)} data-testid="tl-confirm">I agree</button>
        <button type="button" className="btn btn-outline" style={{ minHeight: 44 }} disabled={st.busy} onClick={() => send(false)} data-testid="tl-decline">I don’t agree</button>
      </div>
    </div>
  );
}

const T11 = { book: ['Book your interview', Book], join: ['Your joining day', Join], cjoin: ['Did they join?', CompanyJoin],
  ratt: ['Did they come to the interview?', RelAttendance], rstay: ['Still working with you?', RelStay], rme: ['Your reliability record', RelMe] }; // T15

export default function TrustLink({ kind, token }) {
  if (T11[kind]) {
    const [title, Page] = T11[kind];
    return <><h1 className="display h2">{title}</h1>{token ? <Page token={token} /> : <p>This link is incomplete. Sign in to Nm7 and open My hiring.</p>}</>;
  }
  return (
    <>
      <h1 className="display h2">{kind === 'parent' ? 'Parent or guardian consent' : 'Take back your consent'}</h1>
      {!token ? <p>This link is incomplete. {kind === 'parent' ? 'Ask for a new one.' : <>Sign in and open <Link to="/me/settings#s-consent">Profile &amp; settings</Link>.</>}</p>
        : kind === 'parent' ? <Parent token={token} /> : <Withdraw token={token} />}
    </>
  );
}
