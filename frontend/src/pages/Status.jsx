// /status — is Nm7 working right now? The website (this page loaded), the API (and its database) and email, as
// states only: no server names, numbers or errors. Checks again every 60 seconds.
import { useEffect, useState } from 'react';
import Header from '../components/Header';
import SiteFooter from '../components/SiteFooter';
import { usePageMeta } from '../lib/meta';
import { LIVE, http } from '../services/http';

const TEXT = {
  ok: ['Working', 'b-success'],
  degraded: ['Some emails are delayed', 'b-warning'],
  off: ['Not sending', 'b-danger'],
  down: ['Not reachable', 'b-danger'],
  checking: ['Checking…', 'b-neutral'],
};

export function statusRows(s) {
  if (!s) return [['Website', 'ok'], ['Sign-in, saving and downloads (API)', 'checking'], ['Emails (codes and receipts)', 'checking']];
  if (s.error) return [['Website', 'ok'], ['Sign-in, saving and downloads (API)', 'down'], ['Emails (codes and receipts)', 'checking']];
  return [['Website', 'ok'], ['Sign-in, saving and downloads (API)', s.api === 'ok' ? 'ok' : 'down'], ['Emails (codes and receipts)', s.email || 'ok']];
}

export default function Status() {
  usePageMeta({ title: 'Status', description: 'Is Nm7 working right now? Website, API and email.', path: '/status' });
  const [s, setS] = useState(LIVE ? null : { api: 'ok', email: 'ok', checkedAt: Date.now() });
  useEffect(() => {
    if (!LIVE) return undefined;
    let off = false;
    const load = () => http('/api/public/status').then((r) => !off && setS(r), () => !off && setS({ error: true, checkedAt: Date.now() }));
    load();
    const t = setInterval(load, 60_000);
    return () => { off = true; clearInterval(t); };
  }, []);
  const rows = statusRows(s);
  const allOk = rows.every(([, k]) => k === 'ok');
  return (
    <>
      <Header />
      <main id="main" className="container stack g20" style={{ maxWidth: 720, padding: '32px 16px 64px' }}>
        <h1 className="display" style={{ fontSize: 34 }}>Nm7 status</h1>
        <p className="lead" style={{ margin: 0 }} role="status" data-testid="status-summary">{!s ? 'Checking…' : allOk ? 'Everything is working.' : 'Something isn’t working right now. We’re on it.'}</p>
        <ul className="card stack g8" style={{ listStyle: 'none', margin: 0, padding: 16 }} aria-label="Services">
          {rows.map(([name, k]) => {
            const [label, tone] = TEXT[k] || TEXT.checking;
            return <li key={name} className="row between g8" data-testid="status-row"><span>{name}</span><span className={`badge ${tone}`}>{label}</span></li>;
          })}
        </ul>
        {s?.checkedAt && <span className="xs muted">Checked {new Date(s.checkedAt).toLocaleTimeString('en-IN')} · updates every minute</span>}
        <span className="small muted">Your resumes are saved on your device while you edit, so nothing is lost if the API is briefly down. Need help? Write to us from Help &amp; referral.</span>
      </main>
      <SiteFooter />
    </>
  );
}
