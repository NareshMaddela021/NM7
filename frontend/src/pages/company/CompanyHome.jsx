// nm7.si/company: a company admin signs in with an emailed code (the same account recruiters use, no password) and
// sees their company: trust level (Unverified / Basic / Verified), the review state, what they may post now, and the
// way back into sign-up while it isn't finished. The full company dashboard builds on this (Phase 2, C2).
import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import Header from '../../components/Header';
import LangSwitch from '../../components/LangSwitch';
import SiteFooter from '../../components/SiteFooter';
import { TEAM_ROLES, keepDraft, readDraft, rq } from '../../lib/company';
import CompanyJobs from './CompanyJobs';
import CompanyApplicants, { TalentPool } from './CompanyApplicants';
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
  const [totp, setTotp] = useState('');
  const [needTotp, setNeedTotp] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const send = async (e) => { e.preventDefault(); setBusy(true); setErr(''); try { await rq('/api/recruiter-account/code', { method: 'POST', body: { email } }); setSent(true); } catch (x) { setErr(x.message); } finally { setBusy(false); } };
  const verify = async (e) => {
    e.preventDefault(); setBusy(true); setErr('');
    try { onSession((await rq('/api/recruiter-account/session', { method: 'POST', body: { email, code, ...(needTotp ? { totp } : {}) } })).session); } catch (x) {
      if (x.code === 'totp_required') setNeedTotp(true); else setErr(x.message);
      setBusy(false);
    }
  };
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
      {needTotp && (
        <div className="field"><label className="label" htmlFor="ch-totp">{t('co.sec.appCode')}</label>
          <input id="ch-totp" className="input mono" inputMode="numeric" autoComplete="one-time-code" maxLength={6} value={totp} onChange={(e) => setTotp(e.target.value.replace(/\D/g, ''))} /></div>
      )}
      <button type="submit" className="btn btn-ink" disabled={busy || (sent && code.length !== 6) || (needTotp && totp.length !== 6)}>{sent ? t('co.home.signInBtn') : t('co.email.send')}</button>
      {sent && <p className="xs muted" role="status" style={{ margin: 0 }}>{t('co.home.sent')}</p>}
      {err && <p className="error" role="alert">{err}</p>}
      <p className="xs muted" style={{ margin: 0 }}>{t('co.home.new')} <Link to="/for-companies">{t('co.home.register')}</Link></p>
    </form>
  );
}

function Companies({ t, onSignedOut }) {
  const [st, setSt] = useState({ loading: true });
  const [pick, setPick] = useState(() => { try { return localStorage.getItem('nm7-company-pick') || ''; } catch { return ''; } });
  const load = useCallback(() => rq('/api/company/mine').then((data) => setSt({ data }), (error) => (error.status === 401 ? onSignedOut() : setSt({ error }))), [onSignedOut]);
  useEffect(() => { load(); }, [load]);
  const signOut = async () => { try { await rq('/api/recruiter-account/sign-out', { method: 'POST' }); } catch { /* signed out here anyway */ } onSignedOut(); };
  if (st.loading) return <p className="muted">{t('co.loading')}</p>;
  if (st.error) return <p role="alert" className="card-sm">{st.error.message}</p>;
  const list = st.data.companies;
  const c = list.find((x) => x.id === pick) || list[0];
  const choose = (id) => { setPick(id); try { localStorage.setItem('nm7-company-pick', id); } catch { /* fine */ } };
  return (
    <>
      <p className="small muted row g8" style={{ margin: 0 }}>{t('co.home.as', { email: st.data.email })} <button type="button" className="link-btn small" onClick={signOut}>{t('co.home.signOut')}</button></p>
      {list.length === 0 && (
        <div className="card-sm stack g8"><span>{t('co.home.none')}</span><Link to="/for-companies" className="btn btn-ink" style={{ alignSelf: 'flex-start' }}>{t('co.home.register')}</Link></div>
      )}
      {list.length > 1 && (
        <div className="field" style={{ maxWidth: 360 }}><label className="label" htmlFor="co-pick">{t('co.dash.pick')}</label>
          <select id="co-pick" className="input" value={c.id} onChange={(e) => choose(e.target.value)}>{list.map((x) => <option key={x.id} value={x.id}>{x.details.legalName}</option>)}</select></div>
      )}
      {c && <Dashboard key={c.id} t={t} c={c} onChanged={load} onSignedOut={onSignedOut} />}
      {list.length === 0 && <Security t={t} onSignedOut={onSignedOut} />}
    </>
  );
}

const TABS = ['overview', 'jobs', 'applicants', 'pool', 'team', 'page', 'settings', 'security', 'activity'];

function Dashboard({ t, c, onChanged, onSignedOut }) {
  const [tab, setTab] = useState('overview');
  const manage = ['main', 'full'].includes(c.myRole);
  return (
    <section className="stack g16" aria-label={c.details.legalName}>
      <div className="segmented co-tabs" role="tablist" aria-label={t('co.dash.sections')}>
        {TABS.map((k) => <button key={k} type="button" role="tab" aria-selected={tab === k} onClick={() => setTab(k)}>{t(`co.dash.tab.${k}`)}</button>)}
      </div>
      {tab === 'overview' && <Overview t={t} c={c} manage={manage} />}
      {tab === 'jobs' && <CompanyJobs t={t} c={c} />}
      {tab === 'applicants' && <CompanyApplicants t={t} c={c} />}
      {tab === 'pool' && <TalentPool t={t} c={c} />}
      {tab === 'team' && <Team t={t} c={c} manage={manage} onChanged={onChanged} />}
      {tab === 'page' && <PageEditor t={t} c={c} manage={manage} onChanged={onChanged} />}
      {tab === 'settings' && <Settings t={t} c={c} manage={manage} onChanged={onChanged} />}
      {tab === 'security' && <Security t={t} onSignedOut={onSignedOut} />}
      {tab === 'activity' && <Activity t={t} c={c} />}
    </section>
  );
}

function Overview({ t, c, manage }) {
  const [o, setO] = useState(null);
  useEffect(() => { rq(`/api/company/${c.id}/overview`).then(setO, () => {}); }, [c.id]);
  const state = c.review.state;
  const unfinished = state === 'draft' || state === 'rejected';
  const resume = () => { const d = readDraft(); keepDraft({ ...d, companyId: c.id, step: c.trust === 'unverified' ? 2 : 3 }); };
  const tone = { verified: 'b-success', basic: 'b-signal', unverified: 'b-warning', blocked: 'b-danger' }[c.trust];
  const room = o?.room;
  return (
    <div className="stack g12">
      <section className="card stack g12" aria-label={t('co.dash.tab.overview')} data-testid="co-card">
        <div className="row g8" style={{ justifyContent: 'space-between' }}>
          <h2 className="co-h2" style={{ overflowWrap: 'anywhere' }}>{c.details.legalName}</h2>
          <span className={`badge ${tone}`} data-testid="co-trust">{t(`co.trustName.${c.trust}`)}</span>
        </div>
        <p className="small" style={{ margin: 0 }}>{t(`co.trust.${c.trust}`)}</p>
        <p className="small muted" style={{ margin: 0 }} data-testid="co-review">{t(`co.review.${state}`, { reason: c.review.reason || '' })}</p>
        {room && <p className="small" style={{ margin: 0 }} data-testid="co-room">{room.allowed ? t(`co.room.${room.period}`, { used: room.used, limit: room.limit }) : room.reason}</p>}
        <p className="xs muted" style={{ margin: 0 }}>{t('co.home.role', { role: t(`co.role.${c.myRole}`) })}</p>
        {unfinished && manage && <Link to="/for-companies" onClick={resume} className="btn btn-ink" style={{ alignSelf: 'flex-start' }}>{t('co.home.continue')}</Link>}
        {['basic', 'verified'].includes(c.trust) && <Link to={`/companies/${c.slug}`} className="small" data-testid="co-public-link">{t('co.dash.publicPage')}</Link>}
      </section>
      {o && (
        <div className="co-tiles" data-testid="co-tiles">
          <div className="card-sm stack g4"><span className="xs muted">{t('co.dash.liveJobs')}</span><strong className="co-num">{o.liveJobs}</strong></div>
          <div className="card-sm stack g4"><span className="xs muted">{t('co.dash.applicants')}</span><strong className="co-num">{o.applicants}</strong></div>
          <div className="card-sm stack g4"><span className="xs muted">{t('co.dash.allowance')}</span><strong className="co-num">{o.room.limit ? `${o.room.used}/${o.room.limit}` : '—'}</strong></div>
        </div>
      )}
    </div>
  );
}

function Team({ t, c, manage, onChanged }) {
  const [email, setEmail] = useState('');
  const [name, setName] = useState('');
  const [role, setRole] = useState('posting');
  const [removing, setRemoving] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const run = async (fn) => { setBusy(true); setErr(''); try { await fn(); onChanged(); } catch (x) { setErr(x.message); } finally { setBusy(false); } };
  const add = (e) => { e.preventDefault(); run(async () => { await rq(`/api/company/${c.id}/team`, { method: 'POST', body: { email, name, role } }); setEmail(''); setName(''); }); };
  return (
    <section className="card stack g12" aria-label={t('co.dash.tab.team')} data-testid="co-team">
      <ul className="stack g8 co-team">
        {c.members.map((m) => (
          <li key={m.email} className="row g8" data-testid="co-member">
            <span style={{ flex: 1, minWidth: 0, overflowWrap: 'anywhere' }}><strong>{m.name || m.email}</strong>{m.name ? <span className="xs muted"> · {m.email}</span> : null}</span>
            {manage && m.role !== 'main' ? (
              <label className="row g4"><span className="sr-only">{t('co.f.memberRole')}: {m.email}</span>
                <select className="input" style={{ height: 36 }} value={m.role} disabled={busy} onChange={(e) => run(() => rq(`/api/company/${c.id}/team/${encodeURIComponent(m.email)}`, { method: 'PUT', body: { role: e.target.value } }))}>
                  {TEAM_ROLES.map((r) => <option key={r} value={r}>{t(`co.role.${r}`)}</option>)}</select></label>
            ) : <span className="badge b-neutral">{t(`co.role.${m.role}`)}</span>}
            {m.status === 'invited' && <span className="badge b-warning">{t('co.team.invited')}</span>}
            {manage && m.role !== 'main' && (removing === m.email ? (
              <span className="row g4" role="alert"><span className="xs">{t('co.team.removeAsk')}</span>
                <button type="button" className="btn btn-outline" disabled={busy} onClick={() => run(async () => { await rq(`/api/company/${c.id}/team/${encodeURIComponent(m.email)}`, { method: 'DELETE' }); setRemoving(''); })}>{t('co.team.remove')}</button>
                <button type="button" className="link-btn small" onClick={() => setRemoving('')}>{t('co.cancel')}</button></span>
            ) : <button type="button" className="link-btn small" onClick={() => setRemoving(m.email)} aria-label={`${t('co.team.remove')}: ${m.email}`}>{t('co.team.remove')}</button>)}
          </li>
        ))}
      </ul>
      {manage ? (
        <form className="stack g12" onSubmit={add} aria-label={t('co.team.add')}>
          <div className="co-grid">
            <div className="field"><label className="label" htmlFor="ct-mail">{t('co.f.memberEmail')}</label><input id="ct-mail" type="email" className="input" required value={email} onChange={(e) => setEmail(e.target.value.trim())} /></div>
            <div className="field"><label className="label" htmlFor="ct-name">{t('co.f.memberName')}</label><input id="ct-name" className="input" maxLength={80} value={name} onChange={(e) => setName(e.target.value)} /></div>
            <div className="field"><label className="label" htmlFor="ct-role">{t('co.f.memberRole')}</label>
              <select id="ct-role" className="input" value={role} onChange={(e) => setRole(e.target.value)}>{TEAM_ROLES.map((r) => <option key={r} value={r}>{t(`co.role.${r}`)}</option>)}</select></div>
          </div>
          <span className="xs muted">{t(`co.role.${role}.what`)}</span>
          <button type="submit" className="btn btn-outline" style={{ alignSelf: 'flex-start' }} disabled={busy || !email}>{t('co.team.add')}</button>
        </form>
      ) : <p className="xs muted" style={{ margin: 0 }}>{t('co.dash.onlyAdmins')}</p>}
      {err && <p className="error" role="alert">{err}</p>}
    </section>
  );
}

/** A picked image shrunk to 256 px (keeps the logo small: it is stored with the company). */
async function shrink(file) {
  const url = URL.createObjectURL(file);
  try {
    const img = await new Promise((ok, bad) => { const i = new Image(); i.onload = () => ok(i); i.onerror = bad; i.src = url; });
    const k = Math.min(1, 256 / Math.max(img.width, img.height));
    const cv = document.createElement('canvas');
    cv.width = Math.round(img.width * k); cv.height = Math.round(img.height * k);
    cv.getContext('2d').drawImage(img, 0, 0, cv.width, cv.height);
    const webp = cv.toDataURL('image/webp', 0.85);
    return webp.startsWith('data:image/webp') ? webp : cv.toDataURL('image/png');
  } finally { URL.revokeObjectURL(url); }
}

function PageEditor({ t, c, manage, onChanged }) {
  const [about, setAbout] = useState(c.details.about || '');
  const [logo, setLogo] = useState(c.logo || '');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState('');
  const [err, setErr] = useState('');
  const pickLogo = async (e) => {
    const f = e.target.files?.[0]; e.target.value = '';
    if (!f) return;
    if (!/^image\/(png|jpeg|webp)$/.test(f.type)) { setErr(t('co.dash.logoType')); return; }
    try { setLogo(await shrink(f)); setErr(''); } catch { setErr(t('co.dash.logoType')); }
  };
  const save = async (e) => {
    e.preventDefault(); setBusy(true); setErr(''); setMsg('');
    try { await rq(`/api/company/${c.id}/page`, { method: 'PUT', body: { about, logo } }); setMsg(t('co.dash.saved')); onChanged(); } catch (x) { setErr(x.message); } finally { setBusy(false); }
  };
  return (
    <form className="card stack g12" onSubmit={save} aria-label={t('co.dash.tab.page')} data-testid="co-page">
      <div className="row g12" style={{ alignItems: 'center' }}>
        {logo ? <img src={logo} alt={t('co.dash.logoAlt')} width={72} height={72} className="co-logo" data-testid="co-logo" /> : <span className="job-logo" aria-hidden="true">{c.details.legalName.charAt(0)}</span>}
        {manage && (
          <span className="stack g4">
            <label className="btn btn-outline" style={{ cursor: 'pointer' }}>{t('co.dash.logoPick')}<input type="file" accept="image/png,image/jpeg,image/webp" className="sr-only" onChange={pickLogo} data-testid="co-logo-input" /></label>
            {logo && <button type="button" className="link-btn small" onClick={() => setLogo('')}>{t('co.dash.logoRemove')}</button>}
          </span>
        )}
      </div>
      <div className="field"><label className="label" htmlFor="cp-about">{t('co.f.about')}</label>
        <textarea id="cp-about" className="input" rows={5} maxLength={2000} value={about} disabled={!manage} onChange={(e) => setAbout(e.target.value)} /></div>
      {c.details.website && <p className="small" style={{ margin: 0 }}>{t('co.f.website')}: {c.details.website}</p>}
      {manage && <button type="submit" className="btn btn-ink" style={{ alignSelf: 'flex-start' }} disabled={busy}>{t('co.dash.save')}</button>}
      {msg && <p className="small" role="status" style={{ margin: 0, color: 'var(--success)' }}>{msg}</p>}
      {err && <p className="error" role="alert">{err}</p>}
    </form>
  );
}

function Settings({ t, c, manage, onChanged }) {
  const [ask, setAsk] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const locked = c.review.state === 'approved';
  const change = async () => { setBusy(true); setErr(''); try { await rq(`/api/company/${c.id}/request-change`, { method: 'POST' }); setAsk(false); onChanged(); } catch (x) { setErr(x.message); } finally { setBusy(false); } };
  const resume = () => { const d = readDraft(); keepDraft({ ...d, companyId: c.id, step: 0 }); };
  return (
    <section className="card stack g12" aria-label={t('co.dash.tab.settings')} data-testid="co-settings">
      <dl className="co-review">
        <div><dt>{c.kind === 'individual' ? t('co.f.yourName') : t('co.f.legalName')}</dt><dd>{c.details.legalName}</dd></div>
        {c.details.website && <div><dt>{t('co.f.website')}</dt><dd>{c.details.website}</dd></div>}
        {c.registration && <div><dt>{c.registration.kind.toUpperCase()}</dt><dd className="mono">{c.registration.number}</dd></div>}
        {c.companyEmail && <div><dt>{t('co.f.companyEmail')}</dt><dd>{c.companyEmail}</dd></div>}
        <div><dt>{t('co.f.category')}</dt><dd>{t(`co.cat.${c.details.category}`)}</dd></div>
      </dl>
      {locked ? <p className="small" style={{ margin: 0 }} data-testid="co-locked">{t('co.dash.locked')}</p> : null}
      {manage && locked && !ask && <button type="button" className="btn btn-outline" style={{ alignSelf: 'flex-start' }} onClick={() => setAsk(true)}>{t('co.dash.requestChange')}</button>}
      {manage && locked && ask && (
        <div className="card-sm stack g8" role="alert">
          <span className="small">{t('co.dash.changeAsk')}</span>
          <div className="row g8"><button type="button" className="btn btn-ink" disabled={busy} onClick={change}>{t('co.dash.changeYes')}</button>
            <button type="button" className="link-btn small" onClick={() => setAsk(false)}>{t('co.cancel')}</button></div>
        </div>
      )}
      {manage && !locked && <Link to="/for-companies" onClick={resume} className="btn btn-outline" style={{ alignSelf: 'flex-start' }}>{t('co.dash.editDetails')}</Link>}
      {err && <p className="error" role="alert">{err}</p>}
    </section>
  );
}

const actLabel = (t, action) => { const k = `co.act.${action.replace(/^company\./, '')}`; const v = t(k); return v === k ? action.replace(/^company\./, '').replace(/_/g, ' ') : v; };

function Activity({ t, c }) {
  const [rows, setRows] = useState(null);
  useEffect(() => { rq(`/api/company/${c.id}/activity`).then(setRows, () => setRows([])); }, [c.id]);
  if (!rows) return <p className="muted">{t('co.loading')}</p>;
  return (
    <section className="card stack g8" aria-label={t('co.dash.tab.activity')} data-testid="co-activity">
      {rows.length === 0 && <span className="small muted">{t('co.dash.noActivity')}</span>}
      <ul className="stack g4" style={{ margin: 0, paddingLeft: 18 }}>
        {rows.map((a, i) => <li key={i} className="small">{new Date(a.at).toLocaleString('en-IN', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })} · {actLabel(t, a.action)}{a.by ? ` · ${a.by}` : ''}{a.reason ? `: ${a.reason}` : ''}</li>)}
      </ul>
    </section>
  );
}

function Security({ t, onSignedOut }) {
  const [st, setSt] = useState(null);
  const [setup, setSetup] = useState(null); // { secret, uri, qr }
  const [code, setCode] = useState('');
  const [off, setOff] = useState(false);
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  const load = useCallback(() => rq('/api/company-account/security').then(setSt, () => {}), []);
  useEffect(() => { load(); }, [load]);
  const run = async (fn) => { setBusy(true); setErr(''); try { await fn(); } catch (x) { setErr(x.message); } finally { setBusy(false); } };
  const start = () => run(async () => {
    const r = await rq('/api/company-account/2fa/setup', { method: 'POST' });
    const { qrCanvas } = await import('../../lib/qr');
    let qr = '';
    try { qr = (await qrCanvas(r.uri, 220)).toDataURL('image/png'); } catch { /* the code below still works */ }
    setSetup({ ...r, qr }); setCode('');
  });
  const enable = (e) => { e.preventDefault(); run(async () => { await rq('/api/company-account/2fa/enable', { method: 'POST', body: { code } }); setSetup(null); setCode(''); load(); }); };
  const disable = (e) => { e.preventDefault(); run(async () => { await rq('/api/company-account/2fa/disable', { method: 'POST', body: { code } }); setOff(false); setCode(''); load(); }); };
  const signOutDevice = (d) => run(async () => { await rq(`/api/company-account/devices/${d.id}`, { method: 'DELETE' }); if (d.current) onSignedOut(); else load(); });
  if (!st) return null;
  return (
    <section className="card stack g12" aria-labelledby="sec-h" data-testid="co-security">
      <h2 id="sec-h" className="co-h2">{t('co.sec.title')}</h2>
      <div className="stack g8">
        <strong className="small">{t('co.sec.twoStep')}: <span data-testid="co-2fa">{st.twoStep ? t('co.sec.on') : t('co.sec.off')}</span></strong>
        <span className="xs muted">{t('co.sec.twoStepHint')}</span>
        {!st.twoStep && !setup && <button type="button" className="btn btn-outline" style={{ alignSelf: 'flex-start' }} disabled={busy} onClick={start}>{t('co.sec.turnOn')}</button>}
        {setup && (
          <form className="stack g8" onSubmit={enable} aria-label={t('co.sec.turnOn')}>
            <span className="small">{t('co.sec.scan')}</span>
            {setup.qr && <img src={setup.qr} alt={t('co.sec.qrAlt')} width={180} height={180} style={{ background: '#fff', padding: 8, borderRadius: 8 }} />}
            <span className="xs">{t('co.sec.orKey')} <code className="mono" data-testid="co-2fa-secret" style={{ overflowWrap: 'anywhere' }}>{setup.secret}</code></span>
            <div className="field"><label className="label" htmlFor="sec-code">{t('co.sec.appCode')}</label>
              <input id="sec-code" className="input mono" inputMode="numeric" maxLength={6} value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))} /></div>
            <div className="row g8"><button type="submit" className="btn btn-ink" disabled={busy || code.length !== 6}>{t('co.sec.confirmOn')}</button>
              <button type="button" className="link-btn small" onClick={() => setSetup(null)}>{t('co.cancel')}</button></div>
          </form>
        )}
        {st.twoStep && !off && <button type="button" className="link-btn small" style={{ alignSelf: 'flex-start' }} onClick={() => setOff(true)}>{t('co.sec.turnOff')}</button>}
        {st.twoStep && off && (
          <form className="stack g8" onSubmit={disable} role="alert">
            <div className="field"><label className="label" htmlFor="sec-off">{t('co.sec.appCode')}</label>
              <input id="sec-off" className="input mono" inputMode="numeric" maxLength={6} value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))} /></div>
            <div className="row g8"><button type="submit" className="btn btn-outline" disabled={busy || code.length !== 6}>{t('co.sec.turnOff')}</button>
              <button type="button" className="link-btn small" onClick={() => setOff(false)}>{t('co.cancel')}</button></div>
          </form>
        )}
      </div>
      <div className="stack g8">
        <strong className="small">{t('co.sec.devices')}</strong>
        <span className="xs muted">{t('co.sec.devicesHint')}</span>
        <ul className="stack g8" style={{ listStyle: 'none', margin: 0, padding: 0 }}>
          {st.devices.map((d) => (
            <li key={d.id} className="row g8" data-testid="co-device">
              <span style={{ flex: 1, minWidth: 0 }}>{d.device}{d.current ? ` · ${t('co.sec.thisDevice')}` : ''} <span className="xs muted">· {new Date(d.at).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })}</span></span>
              <button type="button" className="link-btn small" disabled={busy} onClick={() => signOutDevice(d)}>{t('co.home.signOut')}</button>
            </li>
          ))}
        </ul>
      </div>
      {err && <p className="error" role="alert">{err}</p>}
    </section>
  );
}
