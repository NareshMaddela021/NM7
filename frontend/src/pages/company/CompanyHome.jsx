// nm7.si/company: a company admin signs in with an emailed code (the same account recruiters use, no password) and
// sees their company: trust level (Unverified / Basic / Verified), the review state, what they may post now, and the
// way back into sign-up while it isn't finished. The full company dashboard builds on this (Phase 2, C2).
import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import Header from '../../components/Header';
import LangSwitch from '../../components/LangSwitch';
import SiteFooter from '../../components/SiteFooter';
import { keepDraft, readDraft, rq } from '../../lib/company';
import { headerLabels, useLang } from '../../lib/i18n';
import { usePageMeta } from '../../lib/meta';
import { keepAccount, readAccount } from '../../lib/recruiterPortal';

export default function CompanyHome() {
  const [t, lang] = useLang();
  const [account, setAccount] = useState(readAccount);
  usePageMeta({ title: t('co.home.title'), description: t('co.meta.desc'), noindex: true, path: '/company' });
  return (
    <>
      <Header labels={headerLabels(t)} lang={lang} />
      <main id="main" className="container stack g20 co-page" lang={lang}>
        <div className="row g12" style={{ justifyContent: 'space-between' }}>
          <h1 className="display co-h1">{t('co.home.title')}</h1>
          <LangSwitch t={t} lang={lang} />
        </div>
        {account ? <Companies t={t} onSignedOut={() => { keepAccount(''); setAccount(''); }} /> : <SignIn t={t} onSession={(s) => { keepAccount(s); setAccount(s); }} />}
      </main>
      <SiteFooter />
    </>
  );
}

function SignIn({ t, onSession }) {
  const [email, setEmail] = useState('');
  const [sent, setSent] = useState(false);
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const send = async (e) => { e.preventDefault(); setBusy(true); setErr(''); try { await rq('/api/recruiter-account/code', { method: 'POST', body: { email } }); setSent(true); } catch (x) { setErr(x.message); } finally { setBusy(false); } };
  const verify = async (e) => { e.preventDefault(); setBusy(true); setErr(''); try { onSession((await rq('/api/recruiter-account/session', { method: 'POST', body: { email, code } })).session); } catch (x) { setErr(x.message); setBusy(false); } };
  return (
    <form className="card stack g12" style={{ maxWidth: 460 }} onSubmit={sent ? verify : send} aria-label={t('co.home.signIn')}>
      <h2 className="co-h2">{t('co.home.signIn')}</h2>
      <p className="small muted" style={{ margin: 0 }}>{t('co.home.signInHint')}</p>
      <div className="field"><label className="label" htmlFor="ch-email">{t('co.f.yourEmail')}</label>
        <input id="ch-email" type="email" className="input" required autoComplete="email" value={email} disabled={sent} onChange={(e) => setEmail(e.target.value.trim())} /></div>
      {sent && (
        <div className="field"><label className="label" htmlFor="ch-code">{t('co.email.code')}</label>
          <input id="ch-code" className="input mono" inputMode="numeric" autoComplete="one-time-code" maxLength={6} value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))} /></div>
      )}
      <button type="submit" className="btn btn-ink" disabled={busy || (sent && code.length !== 6)}>{sent ? t('co.home.signInBtn') : t('co.email.send')}</button>
      {sent && <p className="xs muted" role="status" style={{ margin: 0 }}>{t('co.home.sent')}</p>}
      {err && <p className="error" role="alert">{err}</p>}
      <p className="xs muted" style={{ margin: 0 }}>{t('co.home.new')} <Link to="/for-companies">{t('co.home.register')}</Link></p>
    </form>
  );
}

function Companies({ t, onSignedOut }) {
  const [st, setSt] = useState({ loading: true });
  const load = useCallback(() => rq('/api/company/mine').then((data) => setSt({ data }), (error) => (error.status === 401 ? onSignedOut() : setSt({ error }))), [onSignedOut]);
  useEffect(() => { load(); }, [load]);
  const signOut = async () => { try { await rq('/api/recruiter-account/sign-out', { method: 'POST' }); } catch { /* signed out here anyway */ } onSignedOut(); };
  if (st.loading) return <p className="muted">{t('co.loading')}</p>;
  if (st.error) return <p role="alert" className="card-sm">{st.error.message}</p>;
  return (
    <>
      <p className="small muted row g8" style={{ margin: 0 }}>{t('co.home.as', { email: st.data.email })} <button type="button" className="link-btn small" onClick={signOut}>{t('co.home.signOut')}</button></p>
      {st.data.companies.length === 0 && (
        <div className="card-sm stack g8"><span>{t('co.home.none')}</span><Link to="/for-companies" className="btn btn-ink" style={{ alignSelf: 'flex-start' }}>{t('co.home.register')}</Link></div>
      )}
      {st.data.companies.map((c) => <CompanyCard key={c.id} t={t} c={c} />)}
    </>
  );
}

function CompanyCard({ t, c }) {
  const [room, setRoom] = useState(null);
  useEffect(() => { rq(`/api/company/${c.id}/room`).then(setRoom, () => {}); }, [c.id]);
  const state = c.review.state;
  const unfinished = state === 'draft' || state === 'rejected';
  const resume = () => { const d = readDraft(); keepDraft({ ...d, companyId: c.id, step: c.trust === 'unverified' ? 2 : 3 }); };
  const tone = { verified: 'b-success', basic: 'b-signal', unverified: 'b-warning', blocked: 'b-danger' }[c.trust];
  return (
    <section className="card stack g12" aria-label={c.details.legalName} data-testid="co-card">
      <div className="row g8" style={{ justifyContent: 'space-between' }}>
        <h2 className="co-h2" style={{ overflowWrap: 'anywhere' }}>{c.details.legalName}</h2>
        <span className={`badge ${tone}`} data-testid="co-trust">{t(`co.trustName.${c.trust}`)}</span>
      </div>
      <p className="small" style={{ margin: 0 }}>{t(`co.trust.${c.trust}`)}</p>
      <p className="small muted" style={{ margin: 0 }} data-testid="co-review">{t(`co.review.${state}`, { reason: c.review.reason || '' })}</p>
      {room && <p className="small" style={{ margin: 0 }} data-testid="co-room">{room.allowed ? t(`co.room.${room.period}`, { used: room.used, limit: room.limit }) : room.reason}</p>}
      <p className="xs muted" style={{ margin: 0 }}>{t('co.home.role', { role: t(`co.role.${c.myRole}`) })}</p>
      {unfinished && ['main', 'full'].includes(c.myRole) && <Link to="/for-companies" onClick={resume} className="btn btn-ink" style={{ alignSelf: 'flex-start' }}>{t('co.home.continue')}</Link>}
    </section>
  );
}
