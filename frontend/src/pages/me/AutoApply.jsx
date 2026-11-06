// /me/auto-apply (Phase 3, A1): what Nm7 may apply to for the student each morning, in their own rules. The gate
// (the resume's ATS score must be 60+, else what to fix, with links), the consent tick, "what will happen" in plain
// words, and one big Pause / Resume button. Once set up Auto Apply is on until paused; Manual Apply always works.
// English, Telugu and Hindi (pages.json, aa.*). No pop-up dialogs.
import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import LangSwitch from '../../components/LangSwitch';
import { useToast } from '../../components/ui';
import { useLang } from '../../lib/i18n';
import { EXPERIENCE, JOB_TYPES } from '../../lib/jobBoard';
import { http } from '../../services/http';
import { MeHead } from './MeLayout';

const list = (s) => String(s || '').split(',').map((x) => x.trim()).filter(Boolean);
const toForm = (s) => ({ ...s, roles: s.roles.join(', '), cities: s.cities.join(', '), avoid: s.avoid.join(', '), minSalary: s.minSalary ? String(s.minSalary / 100000) : '' });
const rupees = (lakh) => (String(lakh).trim() ? Math.round(Number(String(lakh).replace(/[^\d.]/g, '')) * 100000) : null);

/** The plain-words summary of what Auto Apply will do with these settings. */
export function willHappen(f, limits, t) {
  const roles = list(f.roles);
  const cities = list(f.cities);
  const where = cities.length ? (f.remote ? t('aa.will.whereRemote', { cities: cities.join(', ') }) : t('aa.will.where', { cities: cities.join(', ') })) : (f.remote ? t('aa.will.anywhereRemote') : t('aa.will.anywhere'));
  const out = [
    t('aa.will.find', { roles: roles.length ? roles.join(', ') : '—', where }),
    t('aa.will.score', { n: f.minScore }),
    t('aa.will.limit', { n: f.dailyLimit, cap: limits.companyCap }),
    t('aa.will.channels'),
    t('aa.will.stuck'),
  ];
  if (f.experience.length) out.splice(1, 0, t('aa.will.exp', { list: f.experience.map((x) => t(`jobs.exp.${x}`)).join(', ') }));
  if (rupees(f.minSalary)) out.splice(2, 0, t('aa.will.salary', { lakh: f.minSalary }));
  if (list(f.avoid).length) out.push(t('aa.will.avoid', { list: list(f.avoid).join(', ') }));
  return out;
}

export default function AutoApply() {
  const [t, lang] = useLang();
  const toast = useToast();
  const [d, setD] = useState(null);
  const [f, setF] = useState(null);
  const [consent, setConsent] = useState(false);
  const [ideas, setIdeas] = useState(null);
  const [busy, setBusy] = useState('');
  const [err, setErr] = useState('');
  const load = (x) => { setD(x); setF(toForm(x.settings)); };
  useEffect(() => {
    http('/api/me/auto-apply').then(load, (e) => setErr(e.message));
    http('/api/me/auto-apply/suggest').then(setIdeas, () => {});
  }, []);
  if (err && !d) return <p className="error" role="alert">{err}</p>;
  if (!d) return <p className="muted">{t('jobs.loading')}</p>;
  const s = d.settings;
  const set = (k) => (e) => setF({ ...f, [k]: e.target.value });
  const toggle = (k, v) => setF({ ...f, [k]: f[k].includes(v) ? f[k].filter((x) => x !== v) : [...f[k], v] });
  const addRole = (r) => { const cur = list(f.roles); if (!cur.some((x) => x.toLowerCase() === r.toLowerCase())) setF({ ...f, roles: [...cur, r].join(', ') }); };
  const save = async (e) => {
    e.preventDefault();
    setBusy('save'); setErr('');
    try {
      const body = { roles: list(f.roles), cities: list(f.cities), remote: f.remote, experience: f.experience, minSalary: rupees(f.minSalary), minScore: Number(f.minScore), dailyLimit: Number(f.dailyLimit), avoid: list(f.avoid), jobTypes: f.jobTypes, consent };
      const x = await http('/api/me/auto-apply', { method: 'PUT', body });
      load(x); toast(s.setUp ? t('aa.saved') : t('aa.started'));
    } catch (x) { setErr(x.message); } finally { setBusy(''); }
  };
  const pause = async (paused) => {
    setBusy('pause'); setErr('');
    try { load(await http('/api/me/auto-apply/pause', { method: 'POST', body: { paused } })); toast(paused ? t('aa.pausedToast') : t('aa.resumedToast')); } catch (x) { setErr(x.message); } finally { setBusy(''); }
  };
  const g = d.gate;
  return (
    <div className="stack g16" lang={lang} data-testid="auto-apply">
      <MeHead title={t('aa.title')} sub={t('aa.sub')} right={<LangSwitch t={t} lang={lang} />} />
      {!d.siteOn && <p className="card-sm" role="status" style={{ margin: 0 }} data-testid="aa-site-off">{t('aa.siteOff')}</p>}
      {s.setUp && (
        <section className="card stack g12" aria-label={t('aa.statusTitle')} data-testid="aa-status">
          <div className="row g12" style={{ justifyContent: 'space-between', flexWrap: 'wrap' }}>
            <div className="stack g4">
              <strong className={s.on ? '' : 'muted'} data-testid="aa-state">{s.on ? t('aa.on') : t('aa.off')}</strong>
              {s.on && d.previewLeft > 0 && <span className="small muted" data-testid="aa-preview">{t('aa.preview', { n: d.previewLeft })}</span>}
            </div>
            <button type="button" className={`btn ${s.on ? 'btn-outline' : 'btn-ink'} aa-big`} disabled={!!busy} onClick={() => pause(s.on)} data-testid="aa-pause">{s.on ? t('aa.pause') : t('aa.resume')}</button>
          </div>
          <span className="small"><Link to="/me/jobs">{t('aa.seeApplications')}</Link></span>
        </section>
      )}
      {!g.ok && (
        <section className="card stack g8" aria-labelledby="aa-gate-h" data-testid="aa-gate">
          <strong id="aa-gate-h">{t('aa.gate.title')}</strong>
          <span className="small">{g.score == null ? t('aa.gate.noResume') : t('aa.gate.score', { score: g.score, need: g.need })}</span>
          <ul className="stack g4" style={{ margin: 0, paddingLeft: 18 }}>
            {g.fixes.map((x) => <li key={x.key} className="small"><Link to={x.path}>{t(`aa.fix.${x.key}`)}</Link></li>)}
          </ul>
          {g.resume && <span className="xs muted">{t('aa.gate.resume', { name: g.resume.name })}</span>}
        </section>
      )}
      <form className="card stack g12" onSubmit={save} aria-label={t('aa.formTitle')} data-testid="aa-form">
        <strong>{t('aa.formTitle')}</strong>
        <div className="field">
          <label className="label" htmlFor="aa-roles">{t('aa.f.roles')}</label>
          <input id="aa-roles" className="input" value={f.roles} onChange={set('roles')} placeholder={t('aa.f.rolesHint')} />
          {ideas && (ideas.roles.length > 0 || ideas.skills.length > 0) && (
            <div className="row g4" style={{ flexWrap: 'wrap', marginTop: 6 }} aria-label={t('aa.f.ideas')}>
              {[...ideas.roles.slice(0, 8), ...ideas.skills.slice(0, 6)].map((r) => <button key={r} type="button" className="badge b-neutral aa-chip" onClick={() => addRole(r)}>+ {r}</button>)}
            </div>
          )}
        </div>
        <div className="field"><label className="label" htmlFor="aa-cities">{t('aa.f.cities')}</label><input id="aa-cities" className="input" value={f.cities} onChange={set('cities')} placeholder="Hyderabad, Pune" /></div>
        <label className="row g8 small"><input type="checkbox" checked={f.remote} onChange={(e) => setF({ ...f, remote: e.target.checked })} /> {t('aa.f.remote')}</label>
        <fieldset className="stack g4" style={{ border: 0, margin: 0, padding: 0 }}>
          <legend className="label">{t('aa.f.experience')}</legend>
          <div className="row g12" style={{ flexWrap: 'wrap' }}>{EXPERIENCE.map((x) => <label key={x} className="row g4 small"><input type="checkbox" checked={f.experience.includes(x)} onChange={() => toggle('experience', x)} /> {t(`jobs.exp.${x}`)}</label>)}</div>
        </fieldset>
        <fieldset className="stack g4" style={{ border: 0, margin: 0, padding: 0 }}>
          <legend className="label">{t('aa.f.jobTypes')}</legend>
          <div className="row g12" style={{ flexWrap: 'wrap' }}>{JOB_TYPES.map((x) => <label key={x} className="row g4 small"><input type="checkbox" checked={f.jobTypes.includes(x)} onChange={() => toggle('jobTypes', x)} /> {t(`jobs.type.${x}`)}</label>)}</div>
        </fieldset>
        <div className="co-grid">
          <div className="field"><label className="label" htmlFor="aa-salary">{t('aa.f.salary')}</label><input id="aa-salary" className="input" inputMode="decimal" value={f.minSalary} onChange={set('minSalary')} placeholder="3" /></div>
          <div className="field"><label className="label" htmlFor="aa-score">{t('aa.f.score')}</label><input id="aa-score" className="input" type="number" min={50} max={100} step={1} value={f.minScore} onChange={set('minScore')} /></div>
          <div className="field"><label className="label" htmlFor="aa-limit">{t('aa.f.limit', { max: d.limits.maxDailyLimit })}</label><input id="aa-limit" className="input" type="number" min={1} max={d.limits.maxDailyLimit} step={1} value={f.dailyLimit} onChange={set('dailyLimit')} /></div>
        </div>
        <div className="field"><label className="label" htmlFor="aa-avoid">{t('aa.f.avoid')}</label><input id="aa-avoid" className="input" value={f.avoid} onChange={set('avoid')} /></div>
        <section className="card-sm stack g4" aria-labelledby="aa-will-h" data-testid="aa-will">
          <strong id="aa-will-h" className="small">{t('aa.will.title')}</strong>
          <ul className="stack g4 small" style={{ margin: 0, paddingLeft: 18 }}>{willHappen(f, d.limits, t).map((x, i) => <li key={i}>{x}</li>)}</ul>
        </section>
        {!s.setUp && (
          <label className="row g8 small" style={{ alignItems: 'flex-start', flexWrap: 'nowrap' }}>
            <input type="checkbox" checked={consent} onChange={(e) => setConsent(e.target.checked)} style={{ marginTop: 3 }} data-testid="aa-consent" />
            <span>{t('aa.consent')}</span>
          </label>
        )}
        {err && <p className="error" role="alert" style={{ margin: 0 }}>{err}</p>}
        <div className="row g8">
          <button type="submit" className="btn btn-ink" disabled={!!busy || (!s.setUp && !g.ok)} data-testid="aa-save">{busy === 'save' ? t('jobs.loading') : s.setUp ? t('aa.save') : t('aa.start')}</button>
          <Link to="/me/jobs" className="link-btn small">{t('aa.manual')}</Link>
        </div>
      </form>
    </div>
  );
}
