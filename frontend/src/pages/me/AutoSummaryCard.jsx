// The Auto Apply card (Phase 3, A6): today's real numbers ("Applied 4 · 2 need your answer · 3 ready to apply"),
// buttons to each list, and this week's report with tips from real data. Shown on the dashboard and the Auto Apply
// page once Auto Apply is set up. English, Telugu and Hindi (aa.sum.*).
import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { useLang } from '../../lib/i18n';
import { LIVE } from '../../lib/auth';
import { http } from '../../services/http';
import '../../styles/me-jobs.css';

/** The Auto Apply lists changed (an answer, an approval, a tap): the today card reloads (fix round item 18). */
export const AA_CHANGED = 'nm7-auto-apply-changed';

export default function AutoSummaryCard({ week = false, refreshKey }) {
  const [t] = useLang();
  const [d, setD] = useState(null);
  useEffect(() => { if (LIVE) http('/api/me/auto-apply/summary').then(setD, () => {}); }, [refreshKey]);
  // item 18: refresh after an action on the lists below (answer, approve, open)
  useEffect(() => {
    const again = () => { if (LIVE) http('/api/me/auto-apply/summary').then(setD, () => {}); };
    window.addEventListener(AA_CHANGED, again);
    return () => window.removeEventListener(AA_CHANGED, again);
  }, []);
  if (!d || !d.setUp) return null;
  const c = d.today;
  const w = d.week;
  return (
    <section className="mcard" style={{ flex: '1 1 300px' }} aria-labelledby="aa-sum-h" data-testid="aa-summary">
      <header className="mcard-h">
        <span className="mcard-ic violet" aria-hidden="true">⟳</span>
        <span className="mcard-ht"><h2 id="aa-sum-h" className="mcard-title">{t('aa.sum.title')}</h2><span className="mcard-sub" data-testid="aa-sum-today">{t('aa.sum.today', { applied: c.applied, needs: c.needsAnswer, ready: c.ready })}</span></span>
        <Link to="/me/auto-apply" className="mchip mchip-accent" style={{ textDecoration: 'none' }}>{d.on ? t('aa.on') : t('aa.off')} →</Link>
      </header>
      <div className="maa-today">
        <Link className="mstat mcard-link" to="/me/jobs"><strong className="mstat-v">{c.applied}</strong><span className="mstat-l">{t('aa.sum.applied')}</span></Link>
        <Link className={`mstat mcard-link ${c.needsAnswer ? 'mstat-warn' : ''}`} to="/me/auto-apply#needs"><strong className="mstat-v">{c.needsAnswer}</strong><span className="mstat-l">{t('aa.items.needs')}</span></Link>
        <Link className="mstat mcard-link" to="/me/auto-apply#ready"><strong className="mstat-v">{c.ready}</strong><span className="mstat-l">{t('aa.items.ready')}</span></Link>
      </div>
      {c.waiting > 0 && <span className="mchip mchip-warn" style={{ alignSelf: 'flex-start', whiteSpace: 'normal' }}>{t('aa.sum.waiting', { n: c.waiting })}</span>}
      {week && (
        <div className="stack g8" data-testid="aa-week" style={{ borderTop: '1px solid var(--border)', paddingTop: 12 }}>
          <strong className="mkicker">{t('aa.sum.week')}</strong>
          <span className="small">{t('aa.sum.weekLine', { applied: w.applied, viewed: w.viewed, shortlisted: w.shortlisted, interviews: w.interviews })}</span>
          {w.tips.map((x, i) => <span key={i} className="small mcard-tight" style={{ background: '#f6f3ff', borderRadius: 12, padding: '8px 12px' }} data-testid="aa-tip">{x.kind === 'skill' ? t('aa.sum.tipSkill', { skill: x.skill, n: x.n, of: x.of }) : t('aa.sum.tipAnswers', { n: x.n })}</span>)}
        </div>
      )}
    </section>
  );
}

/** The summary emails switch (the same as the emails' "Stop these emails"). */
export function SummaryEmails({ t }) {
  const [on, setOn] = useState(null);
  useEffect(() => { if (LIVE) http('/api/me/auto-apply/summary').then((d) => setOn(d.emails), () => {}); }, []);
  if (on === null) return null;
  const set = async (v) => { setOn(v); try { setOn((await http('/api/me/auto-apply/emails', { method: 'PUT', body: { on: v } })).on); } catch { setOn(!v); } };
  return (
    <label className="row g8 small" style={{ alignItems: 'flex-start', flexWrap: 'nowrap', minHeight: 44 }}>
      <input type="checkbox" checked={on} onChange={(e) => set(e.target.checked)} data-testid="aa-emails" style={{ marginTop: 3 }} />
      <span>{t('aa.sum.emails')}</span>
    </label>
  );
}
