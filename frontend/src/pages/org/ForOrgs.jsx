// /for-orgs — Nm7 for Organizations: the plans table (prices and limits come from the server, so Naresh can
// change them in Admin → Plans), a short FAQ, "Start free" (creates an organization with you as its Owner) and
// "Talk to us" (a support ticket). A ?ref=CODE link from a partner is remembered (Phase 4C).
import { useEffect, useState } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import Header from '../../components/Header';
import SiteFooter from '../../components/SiteFooter';
import { LIVE, useAuth } from '../../lib/auth';
import { usePageMeta } from '../../lib/meta';
import { refFromSearch } from '../../lib/orgBilling';
import { ORG_FAQ, PlansSkeleton, PlansTable, useOrgPlans } from './OrgPlans';
import { http } from '../../services/http';

const ORG_TYPES = [['college', 'College / university'], ['institute', 'Training institute'], ['job_fair', 'Job fair / event'], ['skill_centre', 'Skill centre'], ['ngo', 'NGO'], ['agency', 'Placement agency'], ['company', 'Company'], ['other', 'Other']];


/** A partner link (?ref=CODE): the server checks the code and remembers it in a first-party cookie (Billing
 * settings: 90 days), so it is credited when the organization first pays — even if they sign up later. */
function useRef90() {
  const { search } = useLocation();
  const asked = refFromSearch(search);
  const [ref, setRef] = useState(null);
  useEffect(() => {
    if (!asked || !LIVE) return;
    http('/api/public/referral', { method: 'POST', body: { code: asked } }).then((r) => setRef(r.code ? r : null), () => setRef(null));
  }, [asked]);
  return ref;
}

function StartFree({ open }) {
  const { user } = useAuth();
  const nav = useNavigate();
  const [f, setF] = useState({ name: '', type: 'college', city: '' });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  if (!open) return null;
  const here = encodeURIComponent('/for-orgs?start=1#start');
  if (!user) {
    return (
      <div className="row g8" style={{ flexWrap: 'wrap' }}>
        <Link className="btn btn-ink" to={`/signup?next=${here}`}>Create a free account</Link>
        <Link className="btn btn-outline" to={`/login?next=${here}`}>Sign in</Link>
      </div>
    );
  }
  if (user.role !== 'customer') return <p className="small muted">Sign in with your own (non-admin) Nm7 account to start an organization.</p>;
  const submit = async (e) => {
    e.preventDefault();
    setBusy(true); setError('');
    try {
      const r = await http('/api/me/orgs', { method: 'POST', body: f });
      nav(`/org/${r.orgId}`);
    } catch (err) { setError(err.message); } finally { setBusy(false); }
  };
  return (
    <form className="card stack g12" onSubmit={submit} aria-label="Start free">
      <div className="field"><label className="label" htmlFor="so-n">Organization name</label><input id="so-n" className="input" required minLength={2} maxLength={120} value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} /></div>
      <div className="row g12" style={{ flexWrap: 'wrap' }}>
        <div className="field" style={{ flex: '1 1 200px' }}><label className="label" htmlFor="so-t">Type</label><select id="so-t" className="input" value={f.type} onChange={(e) => setF({ ...f, type: e.target.value })}>{ORG_TYPES.map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select></div>
        <div className="field" style={{ flex: '1 1 160px' }}><label className="label" htmlFor="so-c">City</label><input id="so-c" className="input" maxLength={60} value={f.city} onChange={(e) => setF({ ...f, city: e.target.value })} /></div>
      </div>
      <button type="submit" className="btn btn-ink" style={{ alignSelf: 'flex-start' }} disabled={busy}>{busy ? 'Creating…' : 'Create my organization'}</button>
      <span className="xs muted">You become its Owner, on the Free plan. You can invite a coordinator and upgrade later.</span>
      {error && <p className="small" role="alert" style={{ color: 'var(--danger)' }}>{error}</p>}
    </form>
  );
}

function TalkToUs({ refCode }) {
  const { user } = useAuth();
  const [text, setText] = useState('');
  const [state, setState] = useState({});
  const here = encodeURIComponent('/for-orgs#talk');
  if (!user) {
    return <p className="small">Email <a href="mailto:info@nm7.si">info@nm7.si</a>, or <Link to={`/login?next=${here}`}>sign in</Link> to send us a message here.</p>;
  }
  const send = async (e) => {
    e.preventDefault();
    setState({ busy: true });
    try {
      const note = refCode ? `\n\n(Referred with code ${refCode})` : '';
      await http('/api/me/tickets', { method: 'POST', body: { topic: 'Organizations', orderId: null, text: `${text.trim()}${note}`.slice(0, 2000) } });
      setText(''); setState({ sent: true });
    } catch (err) { setState({ error: err.message }); }
  };
  return state.sent
    ? <p className="small" role="status">Thanks — we reply by email within one working day.</p>
    : (
      <form className="stack g8" onSubmit={send} aria-label="Talk to us">
        <label className="label" htmlFor="tt-x">Tell us about your organization and what you need (members, events, a custom plan, bank transfer / PO)</label>
        <textarea id="tt-x" className="input" rows={4} required minLength={10} maxLength={1900} value={text} onChange={(e) => setText(e.target.value)} />
        <button type="submit" className="btn btn-outline" style={{ alignSelf: 'flex-start' }} disabled={state.busy}>{state.busy ? 'Sending…' : 'Send'}</button>
        {state.error && <p className="small" role="alert" style={{ color: 'var(--danger)' }}>{state.error}</p>}
      </form>
    );
}

export default function ForOrgs() {
  usePageMeta({ title: 'Nm7 for Organizations — plans for colleges, institutes and job fairs', description: 'Collect consent-based, ATS-safe resumes from your students or candidates, approve, print and share them with recruiters. Free plan, Drive and Campus plans.', path: '/for-orgs' });
  const { search } = useLocation();
  const refCode = useRef90();
  const [start, setStart] = useState(() => new URLSearchParams(search).get('start') === '1');
  const st = useOrgPlans();
  return (
    <>
      <Header />
      <main id="main" className="container stack g24" style={{ maxWidth: 980, padding: '32px 16px 64px' }}>
        <section className="stack g12">
          <span className="xs muted">Nm7 for Organizations</span>
          <h1 className="display" style={{ fontSize: 'clamp(28px, 6vw, 40px)' }}>Every student’s resume, ready for placements</h1>
          <p className="muted" style={{ maxWidth: 640 }}>Your students or candidates build ATS-safe resumes on Nm7 and share them with you, with consent. Approve, remind, print in your template, run event kiosks and send shortlists to recruiters.</p>
          <div className="row g8" style={{ flexWrap: 'wrap' }}>
            <button type="button" className="btn btn-ink btn-lg" onClick={() => setStart(true)}>Start free</button>
            <a className="btn btn-outline btn-lg" href="#talk">Talk to us</a>
          </div>
          {refCode && <span className="xs muted" role="status">Referred by partner code <strong className="mono">{refCode.code}</strong>{refCode.discountPct ? ` — ${refCode.discountPct}% off your first plan` : ''}.</span>}
        </section>
        <section id="start" className="stack g12"><StartFree open={start} /></section>
        <section className="stack g12" aria-labelledby="plans-h">
          <h2 id="plans-h" className="display h3">Plans</h2>
          {st.loading ? <PlansSkeleton />
            : st.error || !st.data ? <p className="small muted">Plans load on the live site. Email <a href="mailto:info@nm7.si">info@nm7.si</a> for prices.</p>
              : <>
                <PlansTable data={st.data} />
                <span className="xs muted">{st.data.gstOn ? `Prices exclude GST (${st.data.gstRatePct}%), added at checkout.` : 'Prices in Indian rupees.'} Paid plans keep working for {st.data.graceDays} days after they end, then the Free limits apply — nothing is deleted.</span>
              </>}
        </section>
        <section className="stack g12" aria-labelledby="faq-h">
          <h2 id="faq-h" className="display h3">Questions</h2>
          {ORG_FAQ.map(([q, a]) => <details key={q} className="card"><summary style={{ fontWeight: 600, cursor: 'pointer' }}>{q}</summary><p className="small" style={{ marginTop: 8 }}>{a}</p></details>)}
        </section>
        <p className="small muted">Work with colleges or job fairs? <Link to="/partners">Become an Nm7 partner</Link> and earn commission on organizations you bring.</p>
        <section id="talk" className="card stack g12" aria-labelledby="talk-h">
          <h2 id="talk-h" className="display h3">Talk to us</h2>
          <TalkToUs refCode={refCode?.code || ''} />
        </section>
      </main>
      <SiteFooter />
    </>
  );
}
