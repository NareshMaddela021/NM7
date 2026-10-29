// The organization plans table and FAQ, shared by /for-orgs and the home page. Prices, limits and features come from
// the server (Admin → Organization plans), so nothing here is hard-coded. Words around them follow the chosen language
// (t from useLang; strings orgs.table.* and orgs.faq.* in src/i18n/pages.json); plan names stay as the server has them.
import { useEffect, useState } from 'react';
import { LIVE } from '../../lib/auth';
import { translate } from '../../lib/i18n';
import { LIMITS, PLAN_FEATURES, limitText, rupees } from '../../lib/orgBilling';
import { http, onSlow } from '../../services/http';

const EN = (k, v) => translate('en', k, v);
/** The organizations' FAQ (orgs.faq.1–6) in one language; tr = (key, values) → string. */
export const orgFaq = (tr = EN) => [1, 2, 3, 4, 5, 6].map((i) => [tr(`orgs.faq.${i}.q`), tr(`orgs.faq.${i}.a`)]);
export const ORG_FAQ = orgFaq(); // English: Google's FAQ rich results

/** "per 12 months" / "per 3 months" / "per 30 days" (lib/orgBilling periodText, in the chosen language). */
export function periodWords(plan, tr = EN) {
  if (plan.periodMonths) return plan.periodMonths === 12 ? tr('orgs.table.per12') : tr('orgs.table.perMonths', { n: plan.periodMonths });
  if (plan.periodDays) return tr('orgs.table.perDays', { n: plan.periodDays });
  return '';
}

/** GET /api/public/org-plans once: { loading } → { data } or { error }. Without the API (preview builds): {}. */
export function useOrgPlans() {
  const [st, setSt] = useState(() => (LIVE ? { loading: true } : {}));
  useEffect(() => {
    if (!LIVE) return undefined;
    let alive = true;
    http('/api/public/org-plans').then((data) => alive && setSt({ data }), (error) => alive && setSt({ error }));
    return () => { alive = false; };
  }, []);
  return st;
}

/** While the plans load: the table's shape (so nothing jumps), and a word when the free server is waking up. */
export function PlansSkeleton({ rows = 6 }) {
  const [slow, setSlow] = useState(false);
  useEffect(() => onSlow(setSlow), []);
  return (
    <div className="stack g8" role="status" aria-live="polite">
      <span className="sr-only">Loading plans</span>
      <div className="plans-skel" aria-hidden="true">{Array.from({ length: rows * 5 }, (_, i) => <span key={i} />)}</div>
      {slow && <span className="xs muted">The server is waking up after a quiet spell — this can take up to a minute the first time.</span>}
    </div>
  );
}

/** The feature rows of the table (event kiosks show as the "Kiosk stalls" limit instead). */
export const TABLE_FEATURES = PLAN_FEATURES.filter(([k]) => k !== 'kiosk');

/** Free / Drive / Campus / Custom side by side (prices before GST), from GET /api/public/org-plans. */
export function PlansTable({ data, t = EN }) {
  const plans = data.plans;
  return (
    <div className="table-wrap" tabIndex={0} role="region" aria-label="Table — scroll sideways to see all columns" style={{ overflowX: 'auto' }}>
      <table className="table" style={{ minWidth: 640 }}>
        <caption className="sr-only">{t('orgs.table.caption')}</caption>
        <thead>
          <tr><th scope="col">{t('orgs.table.plan')}</th>{plans.map((p) => <th key={p.id} scope="col" lang="en">{p.name}</th>)}</tr>
        </thead>
        <tbody>
          <tr>
            <th scope="row">{t('orgs.table.price')}</th>
            {plans.map((p) => (
              <td key={p.id}>
                {p.id === 'custom' ? <strong>{t('orgs.talk.title')}</strong> : p.price ? <><strong>{rupees(p.price)}</strong> <span className="small muted">{periodWords(p, t)}{data.gstOn ? ' + GST' : ''}</span></> : <strong>₹0</strong>}
              </td>
            ))}
          </tr>
          {LIMITS.map(([k]) => (
            <tr key={k}><th scope="row">{t(`orgs.table.l.${k}`)}</th>{plans.map((p) => <td key={p.id}>{p.id === 'custom' ? t('orgs.table.yourChoice') : p.limits[k] == null ? t('orgs.table.unlimited') : limitText(p.limits[k])}</td>)}</tr>
          ))}
          {TABLE_FEATURES.map(([k]) => (
            <tr key={k}><th scope="row">{t(`orgs.table.f.${k}`)}</th>{plans.map((p) => <td key={p.id}>{p.features[k] ? t('orgs.table.yes') : '—'}</td>)}</tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

