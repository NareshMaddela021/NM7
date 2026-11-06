// The Auto Apply card (Phase 3, A6): today's real numbers ("Applied 4 · 2 need your answer · 3 ready to apply"),
// buttons to each list, and this week's report with tips from real data. Shown on the dashboard and the Auto Apply
// page once Auto Apply is set up. English, Telugu and Hindi (aa.sum.*).
import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { useLang } from '../../lib/i18n';
import { LIVE } from '../../lib/auth';
import { http } from '../../services/http';

export default function AutoSummaryCard({ week = false, refreshKey }) {
  const [t] = useLang();
  const [d, setD] = useState(null);
  useEffect(() => { if (LIVE) http('/api/me/auto-apply/summary').then(setD, () => {}); }, [refreshKey]);
  if (!d || !d.setUp) return null;
  const c = d.today;
  const w = d.week;
  return (
    <section className="card stack g12" style={{ flex: '1 1 300px' }} aria-labelledby="aa-sum-h" data-testid="aa-summary">
      <div className="row between"><strong id="aa-sum-h">{t('aa.sum.title')}</strong><Link to="/me/auto-apply" className="small">{d.on ? t('aa.on') : t('aa.off')} →</Link></div>
      <span className="small" data-testid="aa-sum-today">{t('aa.sum.today', { applied: c.applied, needs: c.needsAnswer, ready: c.ready })}</span>
      <div className="row g8" style={{ flexWrap: 'wrap' }}>
        <Link className="btn btn-outline" to="/me/jobs">{t('aa.sum.applied')}</Link>
        <Link className="btn btn-outline" to="/me/auto-apply#needs">{t('aa.items.needs')}{c.needsAnswer ? ` (${c.needsAnswer})` : ''}</Link>
        <Link className="btn btn-outline" to="/me/auto-apply#ready">{t('aa.items.ready')}{c.ready ? ` (${c.ready})` : ''}</Link>
      </div>
      {c.waiting > 0 && <span className="small" style={{ color: 'var(--warning)' }}>{t('aa.sum.waiting', { n: c.waiting })}</span>}
      {week && (
        <div className="stack g4" data-testid="aa-week">
          <strong className="small">{t('aa.sum.week')}</strong>
          <span className="small">{t('aa.sum.weekLine', { applied: w.applied, viewed: w.viewed, shortlisted: w.shortlisted, interviews: w.interviews })}</span>
          {w.tips.map((x, i) => <span key={i} className="small muted" data-testid="aa-tip">{x.kind === 'skill' ? t('aa.sum.tipSkill', { skill: x.skill, n: x.n, of: x.of }) : t('aa.sum.tipAnswers', { n: x.n })}</span>)}
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
    <label className="row g8 small" style={{ alignItems: 'flex-start' }}>
      <input type="checkbox" checked={on} onChange={(e) => set(e.target.checked)} data-testid="aa-emails" style={{ marginTop: 3 }} />
      <span>{t('aa.sum.emails')}</span>
    </label>
  );
}
