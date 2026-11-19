// nm7.si/company: a company admin signs in with an emailed code (the same account recruiters use, no password) and
// sees their company: trust level (Unverified / Basic / Verified), the review state, what they may post now, and the
// way back into sign-up while it isn't finished. The full company dashboard builds on this (Phase 2, C2).
import { Suspense, lazy, useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import Header from '../../components/Header';
import LangSwitch from '../../components/LangSwitch';
import SiteFooter from '../../components/SiteFooter';
import { TEAM_ROLES, keepDraft, readDraft, rq } from '../../lib/company';
import CompanyJobs from './CompanyJobs';
import CompanyApplicants, { TalentPool } from './CompanyApplicants';
import CompanyHire from './CompanyHire';
import CompanyPrograms from './CompanyPrograms';
import { useAutoInfo } from './AutoApplyBits';
import VerifyBusiness from './VerifyBusiness'; // Vetting Trust T4 (renders nothing unless the Trust switch allows)
import { headerLabels, useLang } from '../../lib/i18n';
import { usePageMeta } from '../../lib/meta';
import { keepAccount, readAccount } from '../../lib/recruiterPortal';
import { Still } from '../newhome/ParticleStage';
import { Chip, Empty, FieldGroup, MeCard, Skel, Stat, StickyBar } from '../me/kit';
import '../../styles/me-kit.css';
import '../../styles/company.css';
import '../../styles/company-home.css';

export default function CompanyHome() {
  const [t, lang] = useLang();
  const [account, setAccount] = useState(readAccount);
  usePageMeta({ title: t('co.home.title'), description: t('co.meta.desc'), noindex: true, path: '/company' });
  return (
    <>
      <Header labels={headerLabels(t)} lang={lang} />
      <main id="main" className="container-wide stack g20 co-page" lang={lang}>
        <div className="row g12 co-top" style={{ justifyContent: 'space-between' }}>
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
  const step = needTotp ? 3 : sent ? 2 : 1;
  return (
    <div className="ch-signin">
      <form className="mcard ch-signin-card" onSubmit={sent ? verify : send} aria-label={t('co.home.signIn')}>
        <header className="mcard-h">
          <span className="mcard-ic" aria-hidden="true">⌂</span>
          <span className="mcard-ht"><h2 className="mcard-title">{t('co.home.signIn')}</h2><span className="mcard-sub">{t('co.home.signInHint')}</span></span>
        </header>
        <ol className="ch-steps" aria-hidden="true">
          {[1, 2, 3].slice(0, needTotp ? 3 : 2).map((n) => <li key={n} className={n < step ? 'done' : n === step ? 'now' : ''}><span>{n < step ? '✓' : n}</span></li>)}
        </ol>
        <div className="field"><label className="label" htmlFor="ch-email">{t('co.f.yourEmail')}</label>
          <input id="ch-email" type="email" className="input" required autoComplete="email" value={email} disabled={sent} onChange={(e) => setEmail(e.target.value.trim())} /></div>
        {sent && (
          <div className="field"><label className="label" htmlFor="ch-code">{t('co.email.code')}</label>
            <input id="ch-code" className="input mono ch-code" inputMode="numeric" autoComplete="one-time-code" maxLength={6} value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))} /></div>
        )}
        {needTotp && (
          <div className="field"><label className="label" htmlFor="ch-totp">{t('co.sec.appCode')}</label>
            <input id="ch-totp" className="input mono ch-code" inputMode="numeric" autoComplete="one-time-code" maxLength={6} value={totp} onChange={(e) => setTotp(e.target.value.replace(/\D/g, ''))} /></div>
        )}
        <button type="submit" className="btn btn-signal ch-wide" disabled={busy || (sent && code.length !== 6) || (needTotp && totp.length !== 6)}>{sent ? t('co.home.signInBtn') : t('co.email.send')}</button>
        {sent && <p className="xs muted" role="status" style={{ margin: 0 }}>{t('co.home.sent')}</p>}
        {err && <p className="error" role="alert">{err}</p>}
        <p className="small ch-new" style={{ margin: 0 }}>{t('co.home.new')} <Link to="/for-companies">{t('co.home.register')}</Link></p>
      </form>
      <span className="ch-signin-art" aria-hidden="true"><Still shape="stopwatch" tint="company" className="ch-signin-still" /></span>
    </div>
  );
}

function Companies({ t, onSignedOut }) {
  const [st, setSt] = useState({ loading: true });
  const [pick, setPick] = useState(() => { try { return localStorage.getItem('nm7-company-pick') || ''; } catch { return ''; } });
  const load = useCallback(() => rq('/api/company/mine').then((data) => setSt({ data }), (error) => (error.status === 401 ? onSignedOut() : setSt({ error }))), [onSignedOut]);
  useEffect(() => { load(); }, [load]);
  const signOut = async () => { try { await rq('/api/recruiter-account/sign-out', { method: 'POST' }); } catch { /* signed out here anyway */ } onSignedOut(); };
  if (st.loading) return <Skel cards={3} lines={2} label={t('co.loading')} />;
  if (st.error) return <p role="alert" className="mcard mcard-bad">{st.error.message}</p>;
  const list = st.data.companies;
  const c = list.find((x) => x.id === pick) || list[0];
  const choose = (id) => { setPick(id); try { localStorage.setItem('nm7-company-pick', id); } catch { /* fine */ } };
  return (
    <>
      <div className="ch-bar">
        <p className="small muted ch-who" style={{ margin: 0 }}><span className="ch-dot" aria-hidden="true" />{t('co.home.as', { email: st.data.email })} <button type="button" className="link-btn small" onClick={signOut}>{t('co.home.signOut')}</button></p>
        {list.length > 1 && (
          <div className="field ch-pick"><label className="label" htmlFor="co-pick">{t('co.dash.pick')}</label>
            <select id="co-pick" className="input" value={c.id} onChange={(e) => choose(e.target.value)}>{list.map((x) => <option key={x.id} value={x.id}>{x.details.legalName}</option>)}</select></div>
        )}
      </div>
      {list.length === 0 && (
        <Empty shape="briefcase" tint="company" title={t('co.home.none')} action={<Link to="/for-companies" className="btn btn-signal">{t('co.home.register')}</Link>} />
      )}
      {c && <Dashboard key={c.id} t={t} c={c} onChanged={load} onSignedOut={onSignedOut} />}
      {list.length === 0 && <Security t={t} onSignedOut={onSignedOut} />}
    </>
  );
}

/** Round P, Phase 3: the side menu in two groups (hiring, then the company itself), each tab with a symbol and the
 * small blue dotted shape shown beside its title on a desktop. */
const GROUPS = [['overview', 'jobs', 'applicants', 'hire', 'programs', 'pool'], ['team', 'page', 'settings', 'security', 'activity']];
const TAB_META = {
  overview: ['⌂', 'stopwatch'], jobs: ['▤', 'briefcase'], applicants: ['◉', 'magnifier'], hire: ['⚡', 'stopwatch'], programs: ['▣', 'cap'],
  pool: ['☆', 'magnifier'], team: ['☺', 'handshake'], page: ['◧', 'badge'], settings: ['⚙', 'sphere'], security: ['⛨', 'badge'], activity: ['☰', 'resume'], connect: ['⇄', 'handshake'],
};
// Auto Apply 2.0 (A4): the hiring-system page, only for companies the 2.0 switch lets in (English only while tested)
const ConnectHiring = lazy(() => import('./ConnectHiring'));
// Profile setup P3: the company's setup checklist at the top of the Overview (its own small chunk)
const TeamChecklist = lazy(() => import('../me/TeamChecklist'));
const TAB_LABEL = { connect: 'Connect your hiring system' };
const TRUST_TONE = { verified: 'ok', basic: 'accent', unverified: 'warn', blocked: 'bad' };

function Dashboard({ t, c, onChanged, onSignedOut }) {
  // a link like /company#jobs (the setup checklist's reminder email) opens that tab
  const [tab, setTab] = useState(() => { const k = typeof window !== 'undefined' ? window.location.hash.slice(1) : ''; return TAB_META[k] ? k : 'overview'; });
  const openTab = (k) => { setTab(k); try { window.scrollTo({ top: 0 }); } catch { /* jsdom */ } };
  const manage = ['main', 'full'].includes(c.myRole);
  const [icon, shape] = TAB_META[tab];
  const auto = useAutoInfo(c.id);
  const groups = auto ? [GROUPS[0], [...GROUPS[1].slice(0, 3), 'connect', ...GROUPS[1].slice(3)]] : GROUPS;
  const label = (k) => TAB_LABEL[k] || t(`co.dash.tab.${k}`);
  return (
    <section className="co-shell" aria-label={c.details.legalName}>
      <aside className="co-side">
        <div className="co-side-head">
          <span className="co-avatar" aria-hidden="true">{(c.details.legalName || '?').trim().charAt(0).toUpperCase()}</span>
          <span className="co-side-name">{c.details.legalName}</span>
          <Chip tone={TRUST_TONE[c.trust] || 'neutral'}>{t(`co.trustName.${c.trust}`)}</Chip>
        </div>
        <div className="co-tabs" role="tablist" aria-label={t('co.dash.sections')}>
          {groups.map((g, gi) => (
            <div key={gi} className="co-tab-group">
              {g.map((k) => (
                <button key={k} type="button" role="tab" aria-selected={tab === k} className="co-tab" onClick={() => setTab(k)}>
                  <span className="co-tab-ic" aria-hidden="true">{TAB_META[k][0]}</span>{label(k)}
                </button>
              ))}
            </div>
          ))}
        </div>
      </aside>
      <div className="co-main stack g16">
        <div className="co-head">
          <span className="co-head-ic" aria-hidden="true">{icon}</span>
          <h2 className="co-head-title">{label(tab)}</h2>
          <span className="co-head-art" aria-hidden="true"><Still shape={shape} tint="company" className="co-head-still" /></span>
        </div>
        {tab === 'overview' && <Suspense fallback={null}><TeamChecklist kind="company" id={c.id} onTab={openTab} /></Suspense>}
        {tab === 'overview' && <Overview t={t} c={c} manage={manage} />}
        {tab === 'jobs' && <CompanyJobs t={t} c={c} />}
        {tab === 'applicants' && <CompanyApplicants t={t} c={c} />}
        {tab === 'hire' && <CompanyHire t={t} c={c} />}
        {tab === 'programs' && <CompanyPrograms t={t} c={c} />}
        {tab === 'pool' && <TalentPool t={t} c={c} />}
        {tab === 'team' && <Team t={t} c={c} manage={manage} onChanged={onChanged} />}
        {tab === 'page' && <PageEditor t={t} c={c} manage={manage} onChanged={onChanged} />}
        {tab === 'settings' && <Settings t={t} c={c} manage={manage} onChanged={onChanged} />}
        {tab === 'security' && <Security t={t} onSignedOut={onSignedOut} />}
        {tab === 'activity' && <Activity t={t} c={c} />}
        {tab === 'connect' && <Suspense fallback={<Skel cards={1} lines={3} label={t('co.loading')} />}><ConnectHiring c={c} /></Suspense>}
      </div>
    </section>
  );
}

const TRUST_STEPS = ['unverified', 'basic', 'verified'];

function Overview({ t, c, manage }) {
  const [o, setO] = useState(null);
  useEffect(() => { rq(`/api/company/${c.id}/overview`).then(setO, () => {}); }, [c.id]);
  const state = c.review.state;
  const unfinished = state === 'draft' || state === 'rejected';
  const resume = () => { const d = readDraft(); keepDraft({ ...d, companyId: c.id, step: c.trust === 'unverified' ? 2 : 3 }); };
  const tone = { verified: 'ok', basic: 'accent', unverified: 'warn', blocked: 'bad' }[c.trust] || 'neutral';
  const room = o?.room;
  const level = TRUST_STEPS.indexOf(c.trust);
  return (
    <div className="mstack">
      <section className="mcard mcard-accent ch-hero" aria-label={t('co.dash.tab.overview')} data-testid="co-card">
        <div className="ch-hero-top">
          {c.logo ? <img src={c.logo} alt="" width={64} height={64} className="co-logo ch-hero-logo" /> : <span className="ch-hero-logo ch-initial" aria-hidden="true">{c.details.legalName.charAt(0)}</span>}
          <div className="ch-hero-name">
            <h2 className="mcard-title" style={{ overflowWrap: 'anywhere' }}>{c.details.legalName}</h2>
            <span className="mrow" style={{ gap: 8 }}>
              <Chip tone={tone} data-testid="co-trust">{t(`co.trustName.${c.trust}`)}</Chip>
              <Chip tone="neutral">{t('co.home.role', { role: t(`co.role.${c.myRole}`) })}</Chip>
            </span>
          </div>
        </div>
        {level >= 0 && (
          <ol className="ch-trust" aria-hidden="true">
            {TRUST_STEPS.map((k, i) => <li key={k} className={i < level ? 'done' : i === level ? 'now' : ''}><span className="ch-trust-dot">{i < level ? '✓' : i + 1}</span><span className="ch-trust-l">{t(`co.trustName.${k}`)}</span></li>)}
          </ol>
        )}
        <p className="small" style={{ margin: 0 }}>{t(`co.trust.${c.trust}`)}</p>
        {/* verified: the line above already says so; no second "Verified by our team." (fix round item 33) */}
        {!(state === 'approved' && c.trust === 'verified') && <p className="small muted" style={{ margin: 0 }} data-testid="co-review">{t(`co.review.${state}`, { reason: c.review.reason || '' })}</p>}
        {room && <p className={`small ch-room ${room.allowed ? '' : 'ch-room-no'}`} style={{ margin: 0 }} data-testid="co-room">{room.allowed ? t(`co.room.${room.period}`, { used: room.used, limit: room.limit }) : room.reason}</p>}
        {(unfinished && manage) || ['basic', 'verified'].includes(c.trust) ? (
          <div className="mrow">
            {unfinished && manage && <Link to="/for-companies" onClick={resume} className="btn btn-signal">{t('co.home.continue')}</Link>}
            {['basic', 'verified'].includes(c.trust) && <Link to={`/companies/${c.slug}`} className="btn btn-outline" data-testid="co-public-link">{t('co.dash.publicPage')} ↗</Link>}
          </div>
        ) : null}
      </section>
      {!o && <Skel cards={3} lines={1} label={t('co.loading')} />}
      {o && (
        <div className="ch-tiles" data-testid="co-tiles">
          <Stat label={t('co.dash.liveJobs')} value={o.liveJobs} />
          <Stat label={t('co.dash.applicants')} value={o.applicants} />
          {o.invites != null && <Stat label={t('co.bulk.stat.invited')} value={o.invites} />}
          {o.interviews != null && <Stat label={t('co.bulk.stat.interviewsBooked')} value={o.interviews} />}
          {o.offers != null && <Stat label={t('co.bulk.stat.offersSent')} value={o.offers} />}
          <div className="mstat ch-allow">
            <span className="mstat-l">{t('co.dash.allowance')}</span>
            <strong className="mstat-v">{o.room.limit ? `${o.room.used}/${o.room.limit}` : '—'}</strong>
            {o.room.limit ? <span className="mbar" aria-hidden="true"><span style={{ width: `${Math.min(100, (o.room.used / o.room.limit) * 100)}%` }} /></span> : null}
          </div>
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
    <section className="mgrid-2" aria-label={t('co.dash.tab.team')} data-testid="co-team">
      <ul className="ch-members" aria-label={t('co.dash.tab.team')}>
        {c.members.map((m) => (
          <li key={m.email} className="mcard mcard-tight ch-member" data-testid="co-member">
            <div className="ch-member-top">
              <span className="mavatar ch-member-av" aria-hidden="true">{(m.name || m.email).charAt(0).toUpperCase()}</span>
              <span className="ch-member-who"><strong className="ch-member-name">{m.name || m.email}</strong>{m.name ? <span className="xs muted ch-member-mail"> · {m.email}</span> : null}</span>
              {m.status === 'invited' && <Chip tone="warn">{t('co.team.invited')}</Chip>}
            </div>
            <div className="ch-member-row">
              {manage && m.role !== 'main' ? (
                <label className="ch-member-role"><span className="sr-only">{t('co.f.memberRole')}: {m.email}</span>
                  <select className="input" value={m.role} disabled={busy} onChange={(e) => run(() => rq(`/api/company/${c.id}/team/${encodeURIComponent(m.email)}`, { method: 'PUT', body: { role: e.target.value } }))}>
                    {TEAM_ROLES.map((r) => <option key={r} value={r}>{t(`co.role.${r}`)}</option>)}</select></label>
              ) : <Chip tone={m.role === 'main' ? 'info' : 'neutral'}>{t(`co.role.${m.role}`)}</Chip>}
              {manage && m.role !== 'main' && (removing === m.email ? (
                <span className="ch-remove-ask" role="alert"><span className="xs">{t('co.team.removeAsk')}</span>
                  <button type="button" className="btn btn-outline ch-danger" disabled={busy} onClick={() => run(async () => { await rq(`/api/company/${c.id}/team/${encodeURIComponent(m.email)}`, { method: 'DELETE' }); setRemoving(''); })}>{t('co.team.remove')}</button>
                  <button type="button" className="link-btn small" onClick={() => setRemoving('')}>{t('co.cancel')}</button></span>
              ) : <button type="button" className="link-btn small ch-remove" onClick={() => setRemoving(m.email)} aria-label={`${t('co.team.remove')}: ${m.email}`}>{t('co.team.remove')}</button>)}
            </div>
          </li>
        ))}
      </ul>
      <div className="mstack">
        {manage ? (
          <form className="mcard" onSubmit={add} aria-label={t('co.team.add')}>
            <header className="mcard-h"><span className="mcard-ic" aria-hidden="true">＋</span><span className="mcard-ht"><span className="mcard-title" role="presentation">{t('co.team.add')}</span></span></header>
            <FieldGroup>
              <div className="field full"><label className="label" htmlFor="ct-mail">{t('co.f.memberEmail')}</label><input id="ct-mail" type="email" className="input" required value={email} onChange={(e) => setEmail(e.target.value.trim())} /></div>
              <div className="field full"><label className="label" htmlFor="ct-name">{t('co.f.memberName')}</label><input id="ct-name" className="input" maxLength={80} value={name} onChange={(e) => setName(e.target.value)} /></div>
              <div className="field full"><label className="label" htmlFor="ct-role">{t('co.f.memberRole')}</label>
                <select id="ct-role" className="input" value={role} onChange={(e) => setRole(e.target.value)}>{TEAM_ROLES.map((r) => <option key={r} value={r}>{t(`co.role.${r}`)}</option>)}</select></div>
            </FieldGroup>
            <p className="ch-role-what small" style={{ margin: 0 }}>{t(`co.role.${role}.what`)}</p>
            <button type="submit" className="btn btn-signal" style={{ alignSelf: 'flex-start' }} disabled={busy || !email}>{t('co.team.add')}</button>
          </form>
        ) : <p className="mcard mcard-tight small muted" style={{ margin: 0 }}>{t('co.dash.onlyAdmins')}</p>}
        {err && <p className="error" role="alert">{err}</p>}
      </div>
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
  const [pol, setPol] = useState(() => Object.fromEntries(['inclusive', 'accessible', 'returners'].map((k) => [k, c.policies?.[k]?.text || ''])));
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
    try { await rq(`/api/company/${c.id}/page`, { method: 'PUT', body: { about, logo, policies: pol } }); setMsg(t('co.dash.saved')); onChanged(); } catch (x) { setErr(x.message); } finally { setBusy(false); }
  };
  const shown = ['inclusive', 'accessible', 'returners'].filter((k) => pol[k].trim());
  return (
    <div className="mgrid-2 ch-page">
      <form className="mcard" onSubmit={save} aria-label={t('co.dash.tab.page')} data-testid="co-page">
        <div className="ch-logo-row">
          {logo ? <img src={logo} alt={t('co.dash.logoAlt')} width={72} height={72} className="co-logo" data-testid="co-logo" /> : <span className="ch-initial ch-logo-ph" aria-hidden="true">{c.details.legalName.charAt(0)}</span>}
          {manage && (
            <span className="mrow">
              <label className="btn btn-outline" style={{ cursor: 'pointer' }}>{t('co.dash.logoPick')}<input type="file" accept="image/png,image/jpeg,image/webp" className="sr-only" onChange={pickLogo} data-testid="co-logo-input" /></label>
              {logo && <button type="button" className="link-btn small" onClick={() => setLogo('')}>{t('co.dash.logoRemove')}</button>}
            </span>
          )}
        </div>
        <FieldGroup>
          <div className="field full"><label className="label" htmlFor="cp-about">{t('co.f.about')}</label>
            <textarea id="cp-about" className="input" rows={6} maxLength={2000} value={about} disabled={!manage} onChange={(e) => setAbout(e.target.value)} />
            <span className="xs muted ch-count">{about.length}/2000</span></div>
        </FieldGroup>
        <fieldset className="mfields" data-testid="cp-policies">
          <legend className="mfields-h">{t('co.pol.title')}</legend>
          <p className="mfields-help">{t('co.pol.intro')}</p>
          <div className="mfields-body">
            {['inclusive', 'accessible', 'returners'].map((k) => (
              <label key={k} className="field full"><span className="small">{t(`jobs.support.${k}`)}{c.policies?.[k]?.removed ? ` · ${t('co.pol.removed')}` : ''}</span>
                <input className="input" maxLength={300} value={pol[k]} disabled={!manage} onChange={(e) => setPol({ ...pol, [k]: e.target.value })} placeholder={t('co.pol.ph')} data-testid={`cp-pol-${k}`} /></label>
            ))}
          </div>
        </fieldset>
        {c.details.website && <p className="small" style={{ margin: 0 }}>{t('co.f.website')}: {c.details.website}</p>}
        {manage && <StickyBar label={t('co.dash.save')}><button type="submit" className="btn btn-signal" disabled={busy}>{t('co.dash.save')}</button></StickyBar>}
        {msg && <p className="small" role="status" style={{ margin: 0, color: 'var(--success)' }}>{msg}</p>}
        {err && <p className="error" role="alert">{err}</p>}
      </form>
      <aside className="ch-preview" aria-hidden="true">
        <span className="mkicker">{t('co.dash.tab.page')}</span>
        <div className="mcard ch-preview-card">
          <div className="ch-preview-top">
            {logo ? <img src={logo} alt="" width={56} height={56} className="co-logo" /> : <span className="ch-initial ch-preview-logo">{c.details.legalName.charAt(0)}</span>}
            <span className="ch-preview-name">{c.details.legalName}<Chip tone={c.trust === 'verified' ? 'ok' : 'neutral'}>{t(`co.trustName.${c.trust}`)}</Chip></span>
          </div>
          {about.trim() ? <p className="small ch-preview-about">{about}</p> : <span className="ch-preview-line" />}
          {shown.length > 0 && <ul className="ch-preview-pol">{shown.map((k) => <li key={k}><strong className="xs">{t(`jobs.support.${k}`)}</strong><span className="xs">{pol[k]}</span></li>)}</ul>}
          {c.details.website && <span className="xs ch-preview-web">{c.details.website.replace(/^https?:\/\//, '')} ↗</span>}
        </div>
      </aside>
    </div>
  );
}

function Settings({ t, c, manage, onChanged }) {
  const [ask, setAsk] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const locked = c.review.state === 'approved';
  const change = async () => { setBusy(true); setErr(''); try { await rq(`/api/company/${c.id}/request-change`, { method: 'POST' }); setAsk(false); onChanged(); } catch (x) { setErr(x.message); } finally { setBusy(false); } };
  const resume = () => { const d = readDraft(); keepDraft({ ...d, companyId: c.id, step: 0 }); };
  const rows = [
    [c.kind === 'individual' ? t('co.f.yourName') : t('co.f.legalName'), c.details.legalName, '◧'],
    c.details.website && [t('co.f.website'), c.details.website, '↗'],
    c.registration && [c.registration.kind.toUpperCase(), c.registration.number, '#', true],
    c.companyEmail && [t('co.f.companyEmail'), c.companyEmail, '✉'],
    [t('co.f.category'), t(`co.cat.${c.details.category}`), '▣'],
  ].filter(Boolean);
  return (
    <section className="mstack" aria-label={t('co.dash.tab.settings')} data-testid="co-settings">
      <div className="mcard">
        <dl className="ch-facts">
          {rows.map(([k, v, ic, mono]) => (
            <div key={k} className="ch-fact"><span className="ch-fact-ic" aria-hidden="true">{ic}</span><dt>{k}</dt><dd className={mono ? 'mono' : undefined}>{v}</dd></div>
          ))}
        </dl>
      </div>
      <div className={`mcard ${locked ? 'mcard-ok' : ''}`}>
        {locked ? <p className="small" style={{ margin: 0 }} data-testid="co-locked"><span aria-hidden="true">🔒 </span>{t('co.dash.locked')}</p> : null}
        {manage && locked && !ask && <button type="button" className="btn btn-outline" style={{ alignSelf: 'flex-start' }} onClick={() => setAsk(true)}>{t('co.dash.requestChange')}</button>}
        {manage && locked && ask && (
          <div className="mcard mcard-warn mcard-tight" role="alert">
            <span className="small">{t('co.dash.changeAsk')}</span>
            <div className="mrow"><button type="button" className="btn btn-signal" disabled={busy} onClick={change}>{t('co.dash.changeYes')}</button>
              <button type="button" className="link-btn small" onClick={() => setAsk(false)}>{t('co.cancel')}</button></div>
          </div>
        )}
        {manage && !locked && <Link to="/for-companies" onClick={resume} className="btn btn-signal" style={{ alignSelf: 'flex-start' }}>{t('co.dash.editDetails')}</Link>}
        {!manage && !locked && <p className="small muted" style={{ margin: 0 }}>{t('co.dash.onlyAdmins')}</p>}
        {err && <p className="error" role="alert">{err}</p>}
      </div>
      <VerifyBusiness c={c} manage={manage} />
    </section>
  );
}

const actLabel = (t, action) => { const k = `co.act.${action.replace(/^company\./, '')}`; const v = t(k); return v === k ? action.replace(/^company\./, '').replace(/_/g, ' ') : v; };

function Activity({ t, c }) {
  const [rows, setRows] = useState(null);
  useEffect(() => { rq(`/api/company/${c.id}/activity`).then(setRows, () => setRows([])); }, [c.id]);
  if (!rows) return <Skel cards={1} lines={4} label={t('co.loading')} />;
  return (
    <section className="mcard" aria-label={t('co.dash.tab.activity')} data-testid="co-activity">
      {rows.length === 0 && <Empty compact shape="resume" tint="company" title={t('co.dash.noActivity')} />}
      {rows.length > 0 && (
        <ol className="msteps ch-log">
          {rows.map((a, i) => (
            <li key={i} className={i === 0 ? 'now' : 'done'}>
              <span className="msteps-dot" aria-hidden="true">{i === 0 ? '•' : '✓'}</span>
              <span className="ch-log-body">
                <strong className="small">{actLabel(t, a.action)}{a.reason ? `: ${a.reason}` : ''}</strong>
                <span className="xs muted">{new Date(a.at).toLocaleString('en-IN', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}{a.by ? ` · ${a.by}` : ''}</span>
              </span>
            </li>
          ))}
        </ol>
      )}
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
  if (!st) return <Skel cards={2} lines={2} />;
  return (
    <section className="mstack" aria-labelledby="sec-h" data-testid="co-security">
      <h2 id="sec-h" className="sr-only">{t('co.sec.title')}</h2>
      <div className={`mcard ${st.twoStep ? 'mcard-ok' : 'mcard-warn'}`}>
        <div className="ch-2fa-top">
          <span className={`ch-shield ${st.twoStep ? 'on' : ''}`} aria-hidden="true">⛨</span>
          <span className="mcard-ht">
            <strong className="mcard-title">{t('co.sec.twoStep')}: <span data-testid="co-2fa">{st.twoStep ? t('co.sec.on') : t('co.sec.off')}</span></strong>
            <span className="mcard-sub">{t('co.sec.twoStepHint')}</span>
          </span>
        </div>
        {!st.twoStep && !setup && <button type="button" className="btn btn-signal" style={{ alignSelf: 'flex-start' }} disabled={busy} onClick={start}>{t('co.sec.turnOn')}</button>}
        {setup && (
          <form className="ch-2fa-setup" onSubmit={enable} aria-label={t('co.sec.turnOn')}>
            <ol className="msteps">
              <li className="now"><span className="msteps-dot" aria-hidden="true">1</span>
                <span className="stack g8"><span className="small">{t('co.sec.scan')}</span>
                  {setup.qr && <img src={setup.qr} alt={t('co.sec.qrAlt')} width={180} height={180} className="ch-qr" />}
                  <span className="xs">{t('co.sec.orKey')} <code className="mono ch-secret" data-testid="co-2fa-secret">{setup.secret}</code></span></span></li>
              <li><span className="msteps-dot" aria-hidden="true">2</span>
                <span className="stack g8">
                  <div className="field"><label className="label" htmlFor="sec-code">{t('co.sec.appCode')}</label>
                    <input id="sec-code" className="input mono ch-code" inputMode="numeric" maxLength={6} value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))} /></div>
                  <div className="mrow"><button type="submit" className="btn btn-signal" disabled={busy || code.length !== 6}>{t('co.sec.confirmOn')}</button>
                    <button type="button" className="link-btn small" onClick={() => setSetup(null)}>{t('co.cancel')}</button></div>
                </span></li>
            </ol>
          </form>
        )}
        {st.twoStep && !off && <button type="button" className="link-btn small" style={{ alignSelf: 'flex-start' }} onClick={() => setOff(true)}>{t('co.sec.turnOff')}</button>}
        {st.twoStep && off && (
          <form className="mcard mcard-tight mcard-flat stack g8" onSubmit={disable} role="alert">
            <div className="field"><label className="label" htmlFor="sec-off">{t('co.sec.appCode')}</label>
              <input id="sec-off" className="input mono ch-code" inputMode="numeric" maxLength={6} value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))} /></div>
            <div className="mrow"><button type="submit" className="btn btn-outline" disabled={busy || code.length !== 6}>{t('co.sec.turnOff')}</button>
              <button type="button" className="link-btn small" onClick={() => setOff(false)}>{t('co.cancel')}</button></div>
          </form>
        )}
      </div>
      <MeCard title={t('co.sec.devices')} sub={t('co.sec.devicesHint')} icon="▭" headingLevel={3}>
        <ul className="mlist">
          {st.devices.map((d) => (
            <li key={d.id} className="mitem" data-testid="co-device">
              <span className="mavatar" aria-hidden="true">{d.current ? '★' : '▭'}</span>
              <span className="mitem-main"><span className="mitem-title">{d.device}{d.current ? ` · ${t('co.sec.thisDevice')}` : ''}</span>
                <span className="mitem-meta">{new Date(d.at).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })}</span></span>
              <button type="button" className="btn btn-outline mitem-side" disabled={busy} onClick={() => signOutDevice(d)}>{t('co.home.signOut')}</button>
            </li>
          ))}
        </ul>
      </MeCard>
      {err && <p className="error" role="alert">{err}</p>}
    </section>
  );
}
