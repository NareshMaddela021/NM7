// nm7.si/for-companies: company sign-up in 5 steps (Phase 2, C1). Steps 1–2 are kept as a draft in this browser
// (autosave) until the admin's own email is confirmed with a code in step 3; then the company exists on Nm7
// (Unverified) and each later step saves to the server. Step 3 also confirms the company email (on the website's
// domain); individual recruiters skip it and give a LinkedIn link + declaration instead (never Aadhaar, PAN or ID
// photos). Step 4 invites team admins (full / posting only / view only); step 5 reviews and sends the company to
// Nm7's team. English, Telugu and Hindi (pages.json, co.*). No pop-up dialogs.
import { PageArt } from '../../components/PageHero';
import { Children, cloneElement, isValidElement, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import Header from '../../components/Header';
import LangSwitch from '../../components/LangSwitch';
import SiteFooter from '../../components/SiteFooter';
import { BLANK, CATEGORIES, SIZES, STRUCTURES, TEAM_ROLES, cleanNumber, companyBody, keepDraft, readDraft, registrationProblem, rq, websiteProblem } from '../../lib/company';
import { headerLabels, useLang } from '../../lib/i18n';
import { usePageMeta } from '../../lib/meta';
import { keepAccount, readAccount } from '../../lib/recruiterPortal';
import { Chip } from '../me/kit';
import '../../styles/me-kit.css';
import '../../styles/company-signup.css';
import { IcBuilding, IcCheck, IcClock, IcFile, IcMail, IcUser } from '../../components/icons';

const STEPS = ['details', 'registration', 'emails', 'team', 'review'];
const STEP_IC = [<IcBuilding key="i" />, <IcFile key="i" />, <IcMail key="i" />, <IcUser key="i" />, <IcCheck key="i" />];

/** Round P, Phase 3: the top of each step card: its number in a blue circle and its name in serif. */
function StepHead({ t, i, sub }) {
  return (
    <div className="cs-step-head">
      <span className="cs-step-badge" aria-hidden="true">{STEP_IC[i]}</span>
      <span className="cs-step-ht"><span className="cs-step-kicker" aria-hidden="true">{i + 1} / {STEPS.length}</span><span className="cs-step-title">{t(`co.step.${STEPS[i]}`)}</span>{sub && <span className="cs-step-sub">{sub}</span>}</span>
    </div>
  );
}

/** The side card on a desktop (under the form on a phone): the three trust levels, and what happens after sending. */
function SideCard({ t, step, individual }) {
  return (
    <aside className="mcard cs-side" aria-label={t('co.side.title')}>
      <span className="cs-side-title">{t('co.side.title')}</span>
      <ol className="msteps cs-ladder">
        {['unverified', 'basic', 'verified'].map((k, i) => {
          const state = step >= 4 && i < 2 ? 'done' : (step >= 2 && i === 0 ? 'done' : (i === (step >= 2 ? 1 : 0) ? 'now' : ''));
          return (
            <li key={k} className={state}>
              <span className="msteps-dot" aria-hidden="true">{state === 'done' ? <IcCheck size={14} /> : i + 1}</span>
              <span className="stack g4"><strong className="small">{t(`co.trustName.${k}`)}</strong><span className="xs muted">{t(`co.trust.${k}`)}</span></span>
            </li>
          );
        })}
      </ol>
      <p className="xs muted cs-side-note">{t('co.done.sub')}</p>
      {individual && <p className="xs muted cs-side-note">{t('co.ind.note')}</p>}
    </aside>
  );
}

/** One labelled field. A field error shows right under it and is tied to the input (aria-describedby, aria-invalid),
 * so it is next to the field on a phone and read out with it (re-test N4). */
function Field({ id, label, hint, error, children }) {
  const described = [hint && `${id}-hint`, error && `${id}-err`].filter(Boolean).join(' ') || undefined;
  const kids = Children.map(children, (ch) => (isValidElement(ch) && ch.props.id === id ? cloneElement(ch, { 'aria-describedby': described, 'aria-invalid': error ? 'true' : undefined }) : ch));
  return (
    <div className="field cs-field">
      <label className="label" htmlFor={id}>{label}</label>
      {kids}
      {hint && <span className="xs muted" id={`${id}-hint`}>{hint}</span>}
      {error && <span className="error" id={`${id}-err`} role="alert" data-testid={`${id}-err`}>{error}</span>}
    </div>
  );
}

// a server field error -> the field it belongs to, and the step that field is on
const FIELD_OF = { website: ['co-site', 0], legal_name: ['co-name', 0], legalName: ['co-name', 0], about: ['co-about', 0], industry: ['co-ind', 0], number: ['co-reg', 1], phone: ['co-phone', 1], linkedin: ['co-li', 1] };

export default function CompanySignup() {
  const [t, lang] = useLang();
  const [d, setD] = useState(readDraft);
  const [company, setCompany] = useState(null); // the saved company (after step 3)
  const [err, setErr] = useState('');
  const [fieldErr, setFieldErr] = useState({}); // { 'co-site': 'message' }
  const [busy, setBusy] = useState('');
  usePageMeta({ title: t('co.meta.title'), description: t('co.meta.desc'), path: '/for-companies' });

  useEffect(() => { keepDraft(d); }, [d]); // autosave
  useEffect(() => {
    if (d.companyId && readAccount()) rq(`/api/company/${d.companyId}`).then(setCompany, () => setD((x) => ({ ...x, companyId: '' })));
  }, [d.companyId]);

  const c = d.company;
  const individual = c.details.category === 'individual';
  const set = (path, v) => { setFieldErr({}); setD((x) => {
    const next = structuredClone(x);
    const keys = path.split('.'); let o = next.company;
    keys.slice(0, -1).forEach((k) => { o = o[k]; });
    o[keys.at(-1)] = v;
    return next;
  }); };
  const go = (step) => { setErr(''); setFieldErr({}); setD((x) => ({ ...x, step })); window.scrollTo?.(0, 0); };
  /** Shows a message under one field, then scrolls to it and puts the cursor there (re-test N4). */
  const fieldProblem = (id, message, step) => {
    if (step != null && step !== d.step) setD((x) => ({ ...x, step }));
    setErr(''); setFieldErr({ [id]: message });
    setTimeout(() => { const el = document.getElementById(id); if (el) { el.scrollIntoView?.({ block: 'center' }); el.focus(); } }, 0);
  };
  const run = async (what, fn) => {
    setBusy(what); setErr(''); setFieldErr({});
    try { await fn(); } catch (e) {
      const f = (e.fields || []).map((x) => [FIELD_OF[String(x.field || '').split('.').pop()], x]).find(([to]) => to);
      if (f) fieldProblem(f[0][0], String(f[1].message || e.message).replace(/^Value error, /, ''), f[0][1]); else setErr(e.message);
    } finally { setBusy(''); }
  };
  const regProblem = individual ? '' : registrationProblem(c.registration.kind, c.registration.number);

  const nextFromDetails = (e) => {
    e.preventDefault();
    const bad = individual ? '' : websiteProblem(c.details.website); // gmail.com is not a company website (item 21)
    if (bad) { fieldProblem('co-site', t(bad)); return; } // under the website field, not at the top (N4)
    go(1);
  };
  const nextFromRegistration = (e) => {
    e.preventDefault();
    if (regProblem) { fieldProblem('co-reg', t(regProblem)); return; }
    run('check', async () => {
      if (company) setCompany(await rq(`/api/company/${company.id}`, { method: 'PUT', body: companyBody(c) }));
      else await rq('/api/company/signup/check', { method: 'POST', body: companyBody(c) });
      go(2);
    });
  };

  return (
    <>
      <Header labels={headerLabels(t)} lang={lang} />
      <main id="main" className="container-wide stack g20 co-page cs-page" lang={lang}>
        <div className="cs-hero">
          <div className="stack g8 cs-hero-text">
            <h1 className="display co-h1">{t('co.title')}</h1>
            <p className="lead" style={{ margin: 0 }}>{t('co.sub')}</p>
          </div>
          <div className="cs-hero-side"><LangSwitch t={t} lang={lang} /></div>
          <div className="cs-hero-art"><PageArt shape="stopwatch" /></div>
        </div>
        <div className="cs-progress" aria-hidden="true"><span style={{ width: `${(Math.min(d.step, STEPS.length - 1) / (STEPS.length - 1)) * 100}%` }} /></div>
        <ol className="co-steps cs-steps" aria-label={t('co.steps')}>
          {STEPS.map((s, i) => <li key={s} aria-current={d.step === i ? 'step' : undefined} data-done={i < d.step || undefined}><span className="co-step-n">{i < d.step ? <IcCheck size={14} /> : i + 1}</span><span className="cs-step-name">{t(`co.step.${s}`)}</span></li>)}
        </ol>
        <div className="cs-layout">
        <div className="cs-col stack g16">
        {err && <p role="alert" className="mcard mcard-bad mcard-tight co-error">{err}</p>}

        {d.step === 0 && (
          <form className="mcard cs-card" aria-label={t('co.step.details')} onSubmit={nextFromDetails} data-testid="co-step-details">
            <StepHead t={t} i={0} />
            <fieldset className="co-fieldset cs-choices">
              <legend className="label">{t('co.f.accountType')}</legend>
              <label className="cs-choice"><input type="radio" name="acct" value="company" checked={!individual} onChange={() => set('details.category', 'startup')} /><span className="cs-choice-ic" aria-hidden="true"><IcBuilding /></span><span>{t('co.f.typeCompany')}</span></label>
              <label className="cs-choice"><input type="radio" name="acct" value="individual" checked={individual} onChange={() => set('details.category', 'individual')} /><span className="cs-choice-ic" aria-hidden="true"><IcUser /></span><span>{t('co.f.typeIndividual')}</span></label>
            </fieldset>
            <Field id="co-name" error={fieldErr['co-name']} label={individual ? t('co.f.yourName') : t('co.f.legalName')}>
              <input id="co-name" className="input" required minLength={2} maxLength={120} value={c.details.legalName} onChange={(e) => set('details.legalName', e.target.value)} />
            </Field>
            {!individual && (
              <>
                <Field id="co-site" error={fieldErr['co-site']} label={t('co.f.website')} hint={t('co.f.websiteHint')}>
                  <input id="co-site" className="input" required inputMode="url" placeholder="acme.com" value={c.details.website} onChange={(e) => set('details.website', e.target.value)} aria-describedby="co-site-hint" />
                </Field>
                <div className="co-grid">
                  <Field id="co-cat" label={t('co.f.category')}>
                    <select id="co-cat" className="input" value={c.details.category} onChange={(e) => set('details.category', e.target.value)}>
                      {CATEGORIES.filter((x) => x !== 'individual').map((x) => <option key={x} value={x}>{t(`co.cat.${x}`)}</option>)}
                    </select>
                  </Field>
                  <Field id="co-struct" label={t('co.f.structure')}>
                    <select id="co-struct" className="input" value={c.details.structure} onChange={(e) => set('details.structure', e.target.value)}>
                      {STRUCTURES.map((x) => <option key={x} value={x}>{t(`co.struct.${x}`)}</option>)}
                    </select>
                  </Field>
                  <Field id="co-size" label={t('co.f.size')}>
                    <select id="co-size" className="input" value={c.details.size} onChange={(e) => set('details.size', e.target.value)}>
                      {SIZES.map((x) => <option key={x} value={x}>{t(`co.size.${x}`)}</option>)}
                    </select>
                  </Field>
                  <Field id="co-ind" error={fieldErr['co-ind']} label={t('co.f.industry')}>
                    <input id="co-ind" className="input" maxLength={80} value={c.details.industry} onChange={(e) => set('details.industry', e.target.value)} />
                  </Field>
                </div>
              </>
            )}
            <Field id="co-about" error={fieldErr['co-about']} label={individual ? t('co.f.aboutYou') : t('co.f.about')}>
              <textarea id="co-about" className="input" rows={4} maxLength={2000} value={c.details.about} onChange={(e) => set('details.about', e.target.value)} />
            </Field>
            <div className="cs-actions"><button type="submit" className="btn btn-signal">{t('co.next')}</button></div>
          </form>
        )}

        {d.step === 1 && (
          <form className="mcard cs-card" aria-label={t('co.step.registration')} onSubmit={nextFromRegistration} data-testid="co-step-registration">
            <StepHead t={t} i={1} />
            {individual ? (
              <>
                <p className="small cs-note" style={{ margin: 0 }}>{t('co.ind.note')}</p>
                <Field id="co-li" error={fieldErr['co-li']} label={t('co.f.linkedin')}>
                  <input id="co-li" className="input" required inputMode="url" placeholder="https://www.linkedin.com/in/your-name" value={c.individual.linkedin} onChange={(e) => set('individual.linkedin', e.target.value)} />
                </Field>
                <label className="cs-tick">
                  <input type="checkbox" value="declared" required checked={c.individual.declared} onChange={(e) => set('individual.declared', e.target.checked)} />
                  <span className="small">{t('co.ind.declare')}</span>
                </label>
              </>
            ) : (
              <>
                <fieldset className="co-fieldset cs-choices cs-choices-3">
                  <legend className="label">{t('co.f.regKind')}</legend>
                  {['gstin', 'cin', 'llpin'].map((k) => <label key={k} className="cs-choice"><input type="radio" name="regkind" value={k} checked={c.registration.kind === k} onChange={() => set('registration.kind', k)} /><span className="mono">{k.toUpperCase()}</span></label>)}
                </fieldset>
                <Field id="co-reg" error={fieldErr['co-reg']} label={t('co.f.regNumber')} hint={t('co.f.regHint')}>
                  <input id="co-reg" className="input mono" required maxLength={30} autoCapitalize="characters" value={c.registration.number} onChange={(e) => set('registration.number', e.target.value)} aria-invalid={c.registration.number && regProblem ? 'true' : undefined} aria-describedby="co-reg-hint co-reg-check" />
                </Field>
                {c.registration.number && <p id="co-reg-check" className={`small cs-check ${regProblem ? 'bad' : 'ok'}`} style={{ margin: 0 }} data-testid="co-reg-check">{regProblem ? t(regProblem) : t('co.reg.ok', { n: cleanNumber(c.registration.number) })}</p>}
              </>
            )}
            <Field id="co-phone" error={fieldErr['co-phone']} label={t('co.f.phone')} hint={t('co.f.phoneHint')}>
              <input id="co-phone" className="input" inputMode="tel" maxLength={20} value={c.phone} onChange={(e) => set('phone', e.target.value)} />
            </Field>
            <div className="cs-actions">
              <button type="button" className="btn btn-outline" onClick={() => go(0)}>{t('co.back')}</button>
              <button type="submit" className="btn btn-signal" disabled={!!busy}>{busy ? t('co.wait') : t('co.next')}</button>
            </div>
          </form>
        )}

        {d.step === 2 && <EmailsStep t={t} d={d} setD={setD} company={company} setCompany={setCompany} individual={individual} busy={busy} run={run} go={go} />}
        {d.step === 3 && company && <TeamStep t={t} company={company} setCompany={setCompany} run={run} busy={busy} go={go} />}
        {d.step === 4 && company && <ReviewStep t={t} company={company} setCompany={setCompany} run={run} busy={busy} go={go} onDone={() => setD({ ...structuredClone(BLANK), companyId: company.id, step: 4 })} />}
        {d.step >= 3 && !company && <p className="mcard mcard-tight">{t('co.loading')}</p>}
        <p className="small muted cs-have" style={{ margin: 0 }}>{t('co.haveAccount')} <Link to="/company">{t('co.signIn')}</Link></p>
        </div>
        <SideCard t={t} step={d.step} individual={individual} />
        </div>
      </main>
      <SiteFooter />
    </>
  );
}

function CodeRow({ id, label, value, onChange }) {
  return (
    <Field id={id} label={label}>
      <input id={id} className="input mono" inputMode="numeric" autoComplete="one-time-code" maxLength={6} value={value} onChange={(e) => onChange(e.target.value.replace(/\D/g, ''))} />
    </Field>
  );
}

function EmailsStep({ t, d, setD, company, setCompany, individual, busy, run, go }) {
  const [sent, setSent] = useState(false);
  const [code, setCode] = useState('');
  const [cEmail, setCEmail] = useState(company?.pendingCompanyEmail || '');
  const [cSent, setCSent] = useState(!!company?.pendingCompanyEmail);
  const [cCode, setCCode] = useState('');
  const admin = d.admin;
  const setAdmin = (k, v) => setD((x) => ({ ...x, admin: { ...x.admin, [k]: v } }));
  const sendAdmin = (e) => { e.preventDefault(); run('code', async () => { await rq('/api/company/signup/code', { method: 'POST', body: { email: admin.email, name: admin.name } }); setSent(true); }); };
  const confirmAdmin = (e) => {
    e.preventDefault();
    run('start', async () => {
      const r = await rq('/api/company/signup/start', { method: 'POST', body: { email: admin.email, name: admin.name, code, company: companyBody(d.company) } });
      keepAccount(r.session);
      setCompany(r.company);
      setD((x) => ({ ...x, companyId: r.company.id }));
    });
  };
  const sendCompany = (e) => { e.preventDefault(); run('ccode', async () => { await rq(`/api/company/${company.id}/company-email/code`, { method: 'POST', body: { email: cEmail } }); setCSent(true); }); };
  const confirmCompany = (e) => { e.preventDefault(); run('cverify', async () => { setCompany(await rq(`/api/company/${company.id}/company-email/verify`, { method: 'POST', body: { code: cCode } })); }); };
  const adminDone = !!company;
  const companyDone = individual || company?.emails?.company;
  return (
    <section className="mcard cs-card" aria-label={t('co.step.emails')} data-testid="co-step-emails">
      <StepHead t={t} i={2} />
      {!adminDone ? (
        <form className="cs-sub stack g12" onSubmit={sent ? confirmAdmin : sendAdmin} aria-label={t('co.email.admin')}>
          <h2 className="co-h2 cs-sub-h"><span className="cs-sub-n" aria-hidden="true">1</span>{t('co.email.admin')}</h2>
          <p className="small muted" style={{ margin: 0 }}>{t('co.email.adminHint')}</p>
          <Field id="co-aname" label={t('co.f.yourName')}><input id="co-aname" className="input" required minLength={2} maxLength={80} value={admin.name} disabled={sent} onChange={(e) => setAdmin('name', e.target.value)} /></Field>
          <Field id="co-aemail" label={t('co.f.yourEmail')}><input id="co-aemail" type="email" className="input" required autoComplete="email" value={admin.email} disabled={sent} onChange={(e) => setAdmin('email', e.target.value.trim())} /></Field>
          {sent && <CodeRow id="co-acode" label={t('co.email.code')} value={code} onChange={setCode} />}
          <div className="row g8 cs-sub-actions">
            {sent && <button type="button" className="link-btn small" onClick={() => { setSent(false); setCode(''); }}>{t('co.email.change')}</button>}
            <button type="submit" className="btn btn-signal" disabled={!!busy || (sent && code.length !== 6)}>{busy ? t('co.wait') : sent ? t('co.email.confirm') : t('co.email.send')}</button>
          </div>
        </form>
      ) : <p className="cs-ok small" data-testid="co-admin-ok"><span className="cs-ok-ic" aria-hidden="true"><IcCheck size={16} /></span><span>{t('co.email.adminOk', { email: company.adminEmail })}</span></p>}

      {adminDone && !individual && (
        companyDone ? <p className="cs-ok small" data-testid="co-company-ok"><span className="cs-ok-ic" aria-hidden="true"><IcCheck size={16} /></span><span>{t('co.email.companyOk', { email: company.companyEmail })}</span></p> : (
          <form className="cs-sub stack g12" onSubmit={cSent ? confirmCompany : sendCompany} aria-label={t('co.email.company')}>
            <h2 className="co-h2 cs-sub-h"><span className="cs-sub-n" aria-hidden="true">2</span>{t('co.email.company')}</h2>
            <p className="small muted" style={{ margin: 0 }}>{t('co.email.companyHint', { domain: company.details.website.replace(/^https:\/\//, '') })}</p>
            <Field id="co-cemail" label={t('co.f.companyEmail')}><input id="co-cemail" type="email" className="input" required value={cEmail} disabled={cSent} onChange={(e) => setCEmail(e.target.value.trim())} /></Field>
            {cSent && <CodeRow id="co-ccode" label={t('co.email.code')} value={cCode} onChange={setCCode} />}
            <div className="row g8 cs-sub-actions">
              {cSent && <button type="button" className="link-btn small" onClick={() => { setCSent(false); setCCode(''); }}>{t('co.email.change')}</button>}
              <button type="submit" className="btn btn-signal" disabled={!!busy || (cSent && cCode.length !== 6)}>{busy ? t('co.wait') : cSent ? t('co.email.confirm') : t('co.email.send')}</button>
            </div>
          </form>
        )
      )}
      <p className="xs muted" style={{ margin: 0 }}>{t('co.email.noSms')}</p>
      <div className="cs-actions">
        <button type="button" className="btn btn-outline" onClick={() => go(1)}>{t('co.back')}</button>
        <button type="button" className="btn btn-signal" disabled={!adminDone || !companyDone} onClick={() => go(3)}>{t('co.next')}</button>
      </div>
    </section>
  );
}

function TeamStep({ t, company, setCompany, run, busy, go }) {
  const [email, setEmail] = useState('');
  const [name, setName] = useState('');
  const [role, setRole] = useState('posting');
  const [removing, setRemoving] = useState('');
  const add = (e) => { e.preventDefault(); run('add', async () => { setCompany(await rq(`/api/company/${company.id}/team`, { method: 'POST', body: { email, name, role } })); setEmail(''); setName(''); }); };
  const remove = (m) => run('remove', async () => { setCompany(await rq(`/api/company/${company.id}/team/${encodeURIComponent(m)}`, { method: 'DELETE' })); setRemoving(''); });
  return (
    <section className="mcard cs-card" aria-label={t('co.step.team')} data-testid="co-step-team">
      <StepHead t={t} i={3} sub={t('co.team.hint')} />
      <ul className="mlist co-team">
        {company.members.map((m) => (
          <li key={m.email} className="mitem" data-testid="co-member">
            <span className="mavatar cs-avatar" aria-hidden="true">{(m.name || m.email).trim().charAt(0).toUpperCase()}</span>
            <span className="mitem-main"><strong className="mitem-title">{m.name || m.email}</strong>{m.name ? <span className="mitem-meta">{m.email}</span> : null}</span>
            <span className="mitem-side">
            <Chip tone="info">{t(`co.role.${m.role}`)}</Chip>
            {m.status === 'invited' && <Chip tone="warn">{t('co.team.invited')}</Chip>}
            {m.role !== 'main' && (removing === m.email ? (
              <span className="row g4" role="alert"><span className="xs">{t('co.team.removeAsk')}</span>
                <button type="button" className="btn btn-outline" onClick={() => remove(m.email)} disabled={!!busy}>{t('co.team.remove')}</button>
                <button type="button" className="link-btn small" onClick={() => setRemoving('')}>{t('co.cancel')}</button></span>
            ) : <button type="button" className="link-btn small" onClick={() => setRemoving(m.email)} aria-label={`${t('co.team.remove')}: ${m.email}`}>{t('co.team.remove')}</button>)}
            </span>
          </li>
        ))}
      </ul>
      <form className="cs-sub stack g12 co-team-add" onSubmit={add} aria-label={t('co.team.add')}>
        <span className="cs-sub-h co-h2">{t('co.team.add')}</span>
        <div className="co-grid">
          <Field id="co-tmail" label={t('co.f.memberEmail')}><input id="co-tmail" type="email" className="input" required value={email} onChange={(e) => setEmail(e.target.value.trim())} /></Field>
          <Field id="co-tname" label={t('co.f.memberName')}><input id="co-tname" className="input" maxLength={80} value={name} onChange={(e) => setName(e.target.value)} /></Field>
          <Field id="co-trole" label={t('co.f.memberRole')}>
            <select id="co-trole" className="input" value={role} onChange={(e) => setRole(e.target.value)}>{TEAM_ROLES.map((r) => <option key={r} value={r}>{t(`co.role.${r}`)}</option>)}</select>
          </Field>
        </div>
        <span className="xs muted">{t(`co.role.${role}.what`)}</span>
        <button type="submit" className="btn btn-outline" style={{ alignSelf: 'flex-start' }} disabled={!!busy || !email}>{t('co.team.add')}</button>
      </form>
      <div className="cs-actions">
        <button type="button" className="btn btn-outline" onClick={() => go(2)}>{t('co.back')}</button>
        <button type="button" className="btn btn-signal" onClick={() => go(4)}>{t('co.next')}</button>
      </div>
    </section>
  );
}

function ReviewStep({ t, company, setCompany, run, busy, go, onDone }) {
  const [terms, setTerms] = useState(false);
  const d = company.details;
  const state = company.review.state;
  const submit = (e) => { e.preventDefault(); run('submit', async () => { setCompany(await rq(`/api/company/${company.id}/submit`, { method: 'POST', body: { acceptTerms: terms } })); onDone(); }); };
  if (state === 'pending' || state === 'approved') {
    return (
      <section className={`mcard ${state === 'approved' ? 'mcard-ok' : 'mcard-accent'} cs-done`} data-testid="co-submitted">
        <span className="cs-done-ic" aria-hidden="true">{state === 'approved' ? <IcCheck size={24} /> : <IcClock size={24} />}</span>
        <h2 className="co-h2 cs-done-h">{state === 'approved' ? t('co.done.verified') : t('co.done.title')}</h2>
        <Chip tone={state === 'approved' ? 'ok' : 'info'}>{t(`co.trustName.${company.trust}`)}</Chip>
        <p style={{ margin: 0 }}>{t('co.done.sub')}</p>
        <p className="small muted" style={{ margin: 0 }}>{t(`co.trust.${company.trust}`)}</p>
        <Link to="/company" className="btn btn-signal">{t('co.done.open')}</Link>
      </section>
    );
  }
  return (
    <form className="mcard cs-card" aria-label={t('co.step.review')} onSubmit={submit} data-testid="co-step-review">
      <StepHead t={t} i={4} />
      <dl className="co-review cs-review">
        <div><dt>{company.kind === 'individual' ? t('co.f.yourName') : t('co.f.legalName')}</dt><dd>{d.legalName}</dd></div>
        {company.kind === 'company' && <div><dt>{t('co.f.website')}</dt><dd>{d.website}</dd></div>}
        {company.registration && <div><dt>{company.registration.kind.toUpperCase()}</dt><dd className="mono">{company.registration.number}</dd></div>}
        {company.individual && <div><dt>{t('co.f.linkedin')}</dt><dd>{company.individual.linkedin}</dd></div>}
        <div><dt>{t('co.f.yourEmail')}</dt><dd>{company.adminEmail}</dd></div>
        {company.companyEmail && <div><dt>{t('co.f.companyEmail')}</dt><dd>{company.companyEmail}</dd></div>}
        <div><dt>{t('co.step.team')}</dt><dd>{company.members.length}</dd></div>
      </dl>
      {state === 'rejected' && company.review.reason && <p className="mcard mcard-bad mcard-tight" role="status">{t('co.rejected', { reason: company.review.reason })}</p>}
      <p className="small cs-note" style={{ margin: 0 }}>{t('co.levels')}</p>
      <label className="cs-tick">
        <input type="checkbox" value="terms" checked={terms} onChange={(e) => setTerms(e.target.checked)} />
        <span className="small">{t('co.terms')} <Link to="/company-terms" target="_blank">{t('co.termsLink')}</Link></span>
      </label>
      <div className="cs-actions">
        <button type="button" className="btn btn-outline" onClick={() => go(3)}>{t('co.back')}</button>
        <button type="submit" className="btn btn-signal" disabled={!terms || !!busy}>{busy ? t('co.wait') : t('co.submit')}</button>
      </div>
    </form>
  );
}
