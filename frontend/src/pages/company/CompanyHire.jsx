// The "Hire now" tab of the company dashboard (Phase 5, H2: instant shortlist). Pick a live job and see, at once, the
// top 10 people who are ready to join now and agreed to be seen: match score and reasons (the job board's words), when
// they can join, the salary they expect against the job's range, the skill check and reliability. Invite one person or
// all of them; the list shows each answer (Accept, or Not interested with the reason). Email and phone show only after
// the person accepts, then they are also in Applicants (Shortlisted). Only Verified companies; Basic accounts see a
// note. No pop-up dialogs. English, Telugu and Hindi (co.hire.*).
// Round P, Phase 3: a control bar card, the Minute 0 → 60 card, the bulk board, then ranked people cards (rank badge,
// match ring, facts as chips, Invite) with Invite all in a bar that sticks on a phone; interview times and offers.
// Vetting V2: each card shows the "Skill verified" badge (test, band, score, task stars, month; muted when expired),
// and the control bar filters by "Skill verified only", the test and a minimum test score.
// Vetting V1: each card shows the level chip (L0–L4) and ⚡ Ready now, the readiness score (0–100) with its top 3
// reasons and a "Why this score" fold with the parts; filters for the minimum level, ⚡ ready now only, notice period,
// salary, city and experience band. The order is the server's.
// Vetting V3: people at L3+ get a "Screening interview" button: the summary in a drawer, with Invite to final interview.
import { useCallback, useEffect, useState } from 'react';
import { rq } from '../../lib/company';
import { reasons } from './CompanyApplicants';
import HireSlots from './HireSlots';
import HireOffers from './HireOffers';
import HireBulk from './HireBulk';
import HireSpeed from './HireSpeed';
import SkillBadge from './SkillBadge';
import ScreeningInterview from './ScreeningInterview';
import { TEST_NAMES } from '../../lib/vettingRoles';
import { Empty } from '../me/kit';
import { useLang } from '../../lib/i18n';
import LevelBadge from '../../components/LevelBadge';
import { BANDS, NOTICE, PART_MAX, lt } from '../../components/levelStrings';
import '../../styles/company-hire.css';

const rupees = (n) => (n == null ? '' : `₹${Math.round(n).toLocaleString('en-IN')}`);
const day = (s) => (s ? new Date(`${s}T00:00:00`).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' }) : '');
export const PAGE = 10;
export const MIN_SCORES = [0, 60, 70, 80, 90];

/** The shortlist's query: job, size, support, the Vetting V2 filters (verified only, test, minimum score) and the V1
 * ones (minimum level, ⚡ ready now only, notice period at most, salary at most, city, experience band). */
export function shortlistQuery(job, { support = '', verified = false, role = '', minScore = 0, minLevel = 0, readyNow = false,
  noticeMax = -1, salaryMax = '', city = '', band = '' } = {}) {
  const q = new URLSearchParams({ job, size: '100' });
  if (support) q.set('support', support);
  if (verified) q.set('verified', 'true');
  if (role) q.set('role', role);
  if (Number(minScore) > 0) q.set('minScore', String(minScore));
  if (Number(minLevel) > 0) q.set('minLevel', String(minLevel));
  if (readyNow) q.set('readyNow', 'true');
  if (Number(noticeMax) >= 0 && String(noticeMax) !== '') q.set('noticeMax', String(noticeMax));
  const sal = Math.round(Number(String(salaryMax).replace(/[^\d]/g, '')));
  if (sal > 0) q.set('salaryMax', String(sal));
  if (city.trim()) q.set('city', city.trim());
  if (BANDS.includes(band)) q.set('band', band);
  return q.toString();
}
export const NO_FILTERS = { verified: false, role: '', minScore: 0, minLevel: 0, readyNow: false, noticeMax: -1, salaryMax: '', city: '', band: '' };
const filtered = (f) => Object.keys(NO_FILTERS).some((k) => String(f[k]) !== String(NO_FILTERS[k]));

/** The readiness score, its top 3 reasons as one line, and a fold listing the parts (out of their weights). */
export function Readiness({ x, lv }) {
  if (!x.readiness) return null;
  const parts = x.readiness.parts || {};
  return (
    <div className="hn-ready" data-testid="co-hire-readiness">
      <p className="hn-ready-line">
        <span className="mchip mchip-info hn-ready-score">{lv('lv.readiness', { n: x.readiness.score })}</span>
        {x.reasons?.length > 0 && <span className="hn-ready-why" data-testid="co-hire-reasons">{x.reasons.join(' · ')}</span>}
      </p>
      <details className="hn-why">
        <summary data-testid="co-hire-why">{lv('lv.why')}</summary>
        <dl className="hn-parts">
          {Object.keys(PART_MAX).filter((k) => k in parts).map((k) => (
            <div key={k}>
              <dt>{lv(`lv.p.${k}`)}</dt>
              <dd><span className="hn-bar" aria-hidden="true"><i style={{ width: `${Math.round((100 * parts[k]) / PART_MAX[k])}%` }} /></span>{lv('lv.whyOf', { got: parts[k], max: PART_MAX[k] })}</dd>
            </div>
          ))}
        </dl>
      </details>
    </div>
  );
}
const CHIP = { sent: 'mchip-info', accepted: 'mchip-ok', declined: 'mchip-bad', expired: 'mchip-neutral' }; // round P: kit chips
const initial = (n) => (n || '?').trim().charAt(0).toUpperCase();

/** "Joins 1 Dec · 15 days' notice · Hyderabad, Pune / remote". */
export function whenLine(a, t) {
  const parts = [];
  if (a.joinDate) parts.push(t('co.hire.joins', { date: day(a.joinDate) }));
  parts.push(a.noticeDays ? t('co.hire.notice', { n: a.noticeDays }) : t('co.hire.noNotice'));
  const where = [...(a.cities || []), ...(a.remote ? [t('co.hire.remote')] : [])].join(', ');
  if (where) parts.push(where);
  return parts.join(' · ');
}

/** "Expects ₹25,000 a month · within your range" (or above / below / no range). */
export function salaryLine(s, t) {
  if (!s?.want) return t('co.hire.salary.none');
  const want = t('co.hire.salary.want', { amount: rupees(s.want) });
  return `${want} · ${t(`co.hire.salary.${s.fit}`)}`;
}

export default function CompanyHire({ t, c }) {
  const [jobs, setJobs] = useState(null);
  const [job, setJob] = useState('');
  const [d, setD] = useState(null);
  const [invites, setInvites] = useState([]);
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState('');
  const [msg, setMsg] = useState('');
  const [support, setSupport] = useState(''); // Phase 6 S9: immediate joiners / returning after a break
  const [shown, setShown] = useState(PAGE); // the top 10 first, then "Show more"
  const [vf, setVf] = useState(NO_FILTERS); // Vetting V2 and V1 filters (the ones the list is loaded with)
  const [typed, setTyped] = useState({ salaryMax: '', city: '' }); // V1 text filters, applied after a short pause
  const setV = (k) => (e) => setVf((x) => ({ ...x, [k]: e.target.type === 'checkbox' ? e.target.checked : e.target.value }));
  const setT = (k) => (e) => setTyped((x) => ({ ...x, [k]: e.target.value }));
  useEffect(() => {
    const id = setTimeout(() => setVf((x) => (x.salaryMax === typed.salaryMax && x.city === typed.city ? x : { ...x, ...typed })), 500);
    return () => clearTimeout(id);
  }, [typed]);
  const clear = () => { setVf(NO_FILTERS); setTyped({ salaryMax: '', city: '' }); };
  const [, lang] = useLang();
  const lv = lt(lang);
  const verified = c.trust === 'verified';
  const canInvite = ['main', 'full', 'posting'].includes(c.myRole);
  useEffect(() => {
    rq(`/api/company/${c.id}/jobs`).then((js) => {
      const live = (js || []).filter((j) => j.status === 'active');
      setJobs(live);
      if (live[0]) setJob(live[0].id);
    }, () => setJobs([]));
  }, [c.id]);
  const load = useCallback(async () => {
    if (!job || !verified) return;
    setErr(''); setD(null); setShown(PAGE);
    try {
      const [s, inv] = await Promise.all([rq(`/api/company/${c.id}/hire/shortlist?${shortlistQuery(job, { support, ...vf })}`), rq(`/api/company/${c.id}/hire/invites?job=${encodeURIComponent(job)}`)]);
      setD(s); setInvites(inv);
    } catch (x) { setErr(x.message); setD({ items: [] }); }
  }, [c.id, job, verified, support, vf]);
  useEffect(() => { load(); }, [load]);
  const invite = async (people) => {
    setBusy(true); setMsg(''); setErr('');
    try {
      const r = await rq(`/api/company/${c.id}/hire/invite`, { method: 'POST', body: { job, people, note } });
      setMsg(t('co.hire.sent', { n: r.sent }));
      await load();
    } catch (x) { setErr(x.message); } finally { setBusy(false); }
  };
  if (!verified) return <section className="mcard hn-gate" data-testid="co-hire"><strong className="mcard-title">{t('co.hire.title')}</strong><p className="small" data-testid="co-hire-basic">{t('co.hire.basic')}</p></section>;
  if (!jobs) return <div className="mcard stack g12" role="status" aria-label={t('co.loading')}><span className="skeleton" style={{ width: '40%', height: 20 }} /><span className="skeleton" style={{ width: '80%' }} /><span className="skeleton" style={{ width: '65%' }} /></div>;
  if (!jobs.length) return <section className="mcard" data-testid="co-hire"><strong className="mcard-title">{t('co.hire.title')}</strong><Empty shape="stopwatch" tint="company" compact>{t('co.hire.noJobs')}</Empty></section>;
  const open = (d?.items || []).slice(0, shown).filter((x) => !x.invite && !x.applied).map((x) => x.key); // the people on screen
  return (
    <section className="stack g16 hn" aria-label={t('co.hire.title')} data-testid="co-hire">
      <div className="mcard hn-control">
        <div className="hn-control-top">
          <span className="mcard-ic blue" aria-hidden="true">⚡</span>
          <span className="stack g4" style={{ minWidth: 0 }}>
            <strong className="mcard-title">{t('co.hire.title')}</strong>
            <span className="mcard-sub">{t('co.hire.intro')}</span>
          </span>
        </div>
        <div className="hn-selects">
          <label className="field hn-field"><span className="label">{t('co.hire.job')}</span>
            <select className="input" value={job} onChange={(e) => setJob(e.target.value)} data-testid="co-hire-job">
              {jobs.map((j) => <option key={j.id} value={j.id}>{j.title}</option>)}
            </select>
          </label>
          <label className="field hn-field"><span className="label">{t('jobs.f.support')}</span>
            <select className="input" value={support} onChange={(e) => setSupport(e.target.value)} data-testid="co-hire-support">
              <option value="">{t('jobs.f.any')}</option>
              {['immediate', 'returners'].map((k) => <option key={k} value={k}>{t(`jobs.support.${k}`)}</option>)}
            </select>
          </label>
        </div>
        {d?.vetting && <fieldset className="hn-sv" data-testid="co-hire-sv-filters">
          <legend className="hn-sv-legend">{t('co.hire.sv.filters')}</legend>
          <label className="hn-sv-only">
            <input type="checkbox" checked={vf.verified} onChange={setV('verified')} data-testid="co-hire-sv-only" />
            <span>{t('co.hire.sv.only')}</span>
          </label>
          <label className="field hn-field"><span className="label">{t('co.hire.sv.role')}</span>
            <select className="input" value={vf.role} onChange={setV('role')} data-testid="co-hire-sv-role">
              <option value="">{t('co.hire.sv.anyRole')}</option>
              {TEST_NAMES.map((n) => <option key={n} value={n}>{n}</option>)}
            </select>
          </label>
          <label className="field hn-field"><span className="label">{t('co.hire.sv.min')}</span>
            <select className="input" value={vf.minScore} onChange={setV('minScore')} data-testid="co-hire-sv-min">
              {MIN_SCORES.map((n) => <option key={n} value={n}>{n ? t('co.hire.sv.atLeast', { n }) : t('co.hire.sv.anyScore')}</option>)}
            </select>
          </label>
        </fieldset>}
        {d?.vetting && <fieldset className="hn-sv hn-lv" data-testid="co-hire-lv-filters">
          <legend className="hn-sv-legend">{lv('lv.f.legend')}</legend>
          <label className="field hn-field"><span className="label">{lv('lv.f.min')}</span>
            <select className="input" value={vf.minLevel} onChange={setV('minLevel')} data-testid="co-hire-lv-min">
              <option value={0}>{lv('lv.f.anyLevel')}</option>
              {[1, 2, 3, 4].map((n) => <option key={n} value={n}>{lv('lv.f.atLeast', { n, label: lv(`lv.${n}`) })}</option>)}
            </select>
          </label>
          <label className="hn-sv-only">
            <input type="checkbox" checked={vf.readyNow} onChange={setV('readyNow')} data-testid="co-hire-lv-ready" />
            <span>{lv('lv.f.ready')}</span>
          </label>
          <label className="field hn-field"><span className="label">{lv('lv.f.notice')}</span>
            <select className="input" value={vf.noticeMax} onChange={setV('noticeMax')} data-testid="co-hire-lv-notice">
              {NOTICE.map((n) => <option key={n} value={n}>{n < 0 ? lv('lv.f.anyNotice') : n === 0 ? lv('lv.f.zero') : lv('lv.f.days', { n })}</option>)}
            </select>
          </label>
          <label className="field hn-field"><span className="label">{lv('lv.f.salary')}</span>
            <input className="input" inputMode="numeric" maxLength={9} value={typed.salaryMax} onChange={setT('salaryMax')} placeholder={lv('lv.f.salaryPh')} data-testid="co-hire-lv-salary" />
          </label>
          <label className="field hn-field"><span className="label">{lv('lv.f.city')}</span>
            <input className="input" maxLength={60} autoComplete="address-level2" value={typed.city} onChange={setT('city')} placeholder={lv('lv.f.cityPh')} data-testid="co-hire-lv-city" />
          </label>
          <label className="field hn-field"><span className="label">{lv('lv.f.band')}</span>
            <select className="input" value={vf.band} onChange={setV('band')} data-testid="co-hire-lv-band">
              <option value="">{lv('lv.f.anyBand')}</option>
              {BANDS.map((b) => <option key={b} value={b}>{lv(`lv.b.${b}`)}</option>)}
            </select>
          </label>
        </fieldset>}
        {d?.vetting && filtered(vf) && <button type="button" className="btn btn-outline hn-clear" onClick={clear} data-testid="co-hire-lv-clear">{lv('lv.f.clear')}</button>}
        {d?.usage && <span className="mchip mchip-info hn-usage" data-testid="co-hire-usage">{t('co.hire.usage', { used: d.usage.used, free: d.usage.free })}</span>}
      </div>
      <HireSpeed t={t} c={c} />
      {job && <HireBulk key={`b-${job}`} t={t} c={c} job={job} canEdit={canInvite} people={invites.filter((x) => x.status === 'accepted').map((x) => ({ key: x.key, name: x.name }))} onChange={load} />}
      {err && <p className="error" role="alert">{err}</p>}
      {!d && !err && (
        <div className="hn-grid" role="status" aria-label={t('co.loading')}>
          {[0, 1].map((i) => <div key={i} className="mcard stack g12" aria-hidden="true"><span className="skeleton" style={{ width: '50%', height: 18 }} /><span className="skeleton" style={{ width: '85%' }} /><span className="skeleton" style={{ width: '70%' }} /></div>)}
        </div>
      )}
      {d && !err && (
        <div className="hn-people">
          <div className="hn-people-head">
            <p className="hn-count" data-testid="co-hire-count">{d.items.length ? t(d.vetting ? 'co.hire.foundLevel' : 'co.hire.found', { n: d.available }) : t('co.hire.none')}</p>
          </div>
          {canInvite && open.length > 0 && (
            <div className="hn-invitebar">
              <label className="field hn-note"><span className="label">{t('co.hire.note')}</span><input className="input" maxLength={500} value={note} onChange={(e) => setNote(e.target.value)} placeholder={t('co.hire.notePh')} data-testid="co-hire-note" /></label>
              <button type="button" className="btn btn-signal hn-all" disabled={busy} onClick={() => invite(open)} data-testid="co-hire-all">{t('co.hire.inviteAll', { n: open.length })}</button>
            </div>
          )}
          {msg && <p className="small hn-msg" role="status" data-testid="co-hire-msg">{msg}</p>}
          {!d.items.length && <Empty shape="magnifier" tint="company" compact />}
          {!d.items.length && filtered(vf) && (
            <button type="button" className="btn btn-outline hn-more" onClick={clear} data-testid="co-hire-sv-clear">{t('co.hire.sv.clear')}</button>
          )}
          <ol className="hn-grid">
            {d.items.slice(0, shown).map((x, i) => (
              <li key={x.key} className={`mcard hn-person ${i < 3 ? 'hn-top' : ''}`} data-testid="co-hire-row">
                <div className="hn-person-top">
                  <span className="hn-rank" aria-hidden="true">{i + 1}</span>
                  <span className="hn-avatar" aria-hidden="true">{initial(x.name)}</span>
                  <strong className="hn-name"><span className="sr-only">{i + 1}. </span>{x.name}</strong>
                  <span className="hn-score">
                    <span className="hn-ring" aria-hidden="true" style={{ '--p': Math.max(0, Math.min(100, x.match.score)) }}><span>{x.match.score}</span></span>
                    <span className="mchip mchip-accent" data-testid="co-hire-score">{t('co.hire.score', { score: x.match.score })}</span>
                  </span>
                </div>
                {x.level && <LevelBadge level={x.level.level} label={x.level.label} readyNow={x.readyNow} lang={lang} />}
                <Readiness x={x} lv={lv} />
                <ul className="hn-chips">{reasons(x.match, t).map((r) => <li key={r} className="mchip mchip-neutral">{r}</li>)}</ul>
                <dl className="hn-facts">
                  <div><dt aria-hidden="true">📅</dt><dd data-testid="co-hire-when">{whenLine(x.availability, t)}</dd></div>
                  <div><dt aria-hidden="true">₹</dt><dd data-testid="co-hire-salary">{salaryLine(x.salary, t)}</dd></div>
                  {x.verified?.length > 0 && <div><dt aria-hidden="true">✓</dt><dd data-testid="co-hire-verified">{x.verified.map((v) => t('co.hire.verified', { skill: v.skill, date: new Date(v.at).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' }) })).join(' · ')}</dd></div>}
                </dl>
                <SkillBadge sv={x.skillVerified} t={t} />
                <span className="hn-trust" data-testid="co-hire-trust">{x.skillCheck ? t('co.hire.check', { score: x.skillCheck.score }) : t('co.hire.noCheck')} · {x.reliability.score == null ? x.reliability.label : `${x.reliability.label} (${x.reliability.score}%)`}{x.reliability.lines?.length ? `: ${x.reliability.lines.join('; ')}` : ''}</span>
                <div className="hn-person-foot">
                  <ScreeningInterview c={c} uid={x.key} name={x.name} level={x.level?.level} job={job} canInvite={canInvite && !x.applied} invited={!!x.invite} onInvited={load} />
                  {x.invite ? <span className={`mchip ${CHIP[x.invite.status]}`} data-testid="co-hire-state">{t(`co.hire.state.${x.invite.status}`)}</span>
                    : x.applied ? <span className="mchip mchip-neutral">{t('co.hire.applied')}</span>
                      : canInvite && <button type="button" className="btn btn-outline hn-invite" disabled={busy} onClick={() => invite([x.key])} data-testid="co-hire-invite">{t('co.hire.invite')}</button>}
                </div>
              </li>
            ))}
          </ol>
          {d.items.length > shown && (
            <button type="button" className="btn btn-outline hn-more" onClick={() => setShown((n) => n + PAGE)} data-testid="co-hire-more">{t('co.hire.more', { n: Math.min(PAGE, d.items.length - shown), left: d.items.length - shown })}</button>
          )}
        </div>
      )}
      {job && <HireSlots key={job} t={t} c={c} job={job} canEdit={canInvite} />}
      {job && <HireOffers key={`o-${job}`} t={t} c={c} job={job} people={invites.filter((x) => x.status === 'accepted').map((x) => ({ key: x.key, name: x.name }))} canEdit={canInvite} />}
      {invites.length > 0 && (
        <section className="mcard" aria-labelledby="co-hire-inv-h" data-testid="co-hire-invites">
          <header className="mcard-h"><span className="mcard-ic blue" aria-hidden="true">✉</span><span className="mcard-ht"><strong id="co-hire-inv-h" className="mcard-title">{t('co.hire.invites')}</strong><span className="mcard-sub">{t('co.hire.privacy')}</span></span></header>
          <ul className="mlist">
            {invites.map((x) => (
              <li key={x.id} className="mitem" data-testid="co-hire-inv">
                <span className="mavatar hn-av-blue" aria-hidden="true">{initial(x.name)}</span>
                <span className="mitem-main">
                  <strong className="mitem-title">{x.name}</strong>
                  {x.contact && <span className="mitem-meta" data-testid="co-hire-contact">{[x.contact.email, x.contact.phone].filter(Boolean).join(' · ')}</span>}
                  {x.reasonText && <span className="mitem-meta">{x.reasonText}</span>}
                </span>
                <span className={`mchip ${CHIP[x.status]}`}>{t(`co.hire.state.${x.status}`)}</span>
              </li>
            ))}
          </ul>
        </section>
      )}
    </section>
  );
}
