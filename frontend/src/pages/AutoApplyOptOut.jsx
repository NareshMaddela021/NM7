// /stop-alerts#k=employer&t=…: the employer's one-click opt-out from Auto Apply 2.0 emails (A3; no sign-in). Opening the
// link blocks the whole company domain at once; the employer can switch to blocking only the one address. The token
// is signed by Nm7 and sits in the address fragment, so it never reaches server logs. A test email's link (sent while
// Auto Apply 2.0 is being tested) shows the same page but blocks nothing.
import { useEffect, useState } from 'react';
import Header from '../components/Header';
import { http } from '../services/http';

const API = '/api/public/auto-apply/opt-out';
const tokenOf = (hash) => (/(?:^#|&)t=([A-Za-z0-9._-]{10,600})/.exec(hash || '') || [])[1] || '';

export default function AutoApplyOptOut() {
  const [token] = useState(() => tokenOf(typeof window !== 'undefined' ? window.location.hash : ''));
  const [st, setSt] = useState(token ? { busy: true } : { error: 'This link is incomplete. Copy the whole link from the email.' });
  const block = async (scope) => {
    setSt((s) => ({ ...s, busy: true, error: '' }));
    try { setSt({ done: await http(API, { method: 'POST', body: { token, scope } }) }); } catch (e) { setSt({ error: e.message }); }
  };
  useEffect(() => { if (token) block('domain'); }, [token]); // eslint-disable-line react-hooks/exhaustive-deps
  const d = st.done;
  return (
    <>
      <Header />
      <main id="main" className="container stack g16" style={{ maxWidth: 600, padding: '48px 16px', overflowWrap: 'anywhere' }} data-testid="aa-optout">
        <h1 className="display h2">Auto Apply emails from Nm7</h1>
        {st.error && <p role="alert" className="error" data-testid="aa-optout-error">{st.error}</p>}
        {!d && !st.error && <p className="muted">One moment…</p>}
        {d && (
          <div className="stack g12">
            <p className="h4" style={{ margin: 0 }} data-testid="aa-optout-done">You won’t get Auto Apply emails from Nm7 again.</p>
            {d.test && <p className="small" role="status" data-testid="aa-optout-test">This link came from a test email, sent while Nm7 is testing Auto Apply. Nothing was blocked. On a real email, this page blocks {d.scope === 'domain' ? `everyone at @${d.domain}` : d.address}.</p>}
            <p className="small" data-testid="aa-optout-scope">
              {d.scope === 'domain'
                ? <>Blocked: every address at <strong>@{d.domain}</strong>. Nm7 Auto Apply won’t email anyone at your company.</>
                : <>Blocked: <strong>{d.address}</strong> only. Other addresses at @{d.domain} may still get applications that your company publishes for them.</>}
            </p>
            {d.scope === 'domain'
              ? <button type="button" className="btn btn-outline" style={{ alignSelf: 'flex-start' }} disabled={st.busy} onClick={() => block('address')} data-testid="aa-optout-address">Block only {d.address} instead</button>
              : <button type="button" className="btn btn-outline" style={{ alignSelf: 'flex-start' }} disabled={st.busy} onClick={() => block('domain')} data-testid="aa-optout-domain">Block all of @{d.domain} instead</button>}
            <p className="xs muted" style={{ margin: 0 }}>Auto Apply sends one email per job, only to addresses a company published for applications, and only when a candidate asked Nm7 to apply for them. Questions or a mistake? Write to info@nm7.si.</p>
          </div>
        )}
      </main>
    </>
  );
}
