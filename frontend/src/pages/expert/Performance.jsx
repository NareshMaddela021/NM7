// Performance & reviews: ratings, on-time, revisions, audit scores and tips from the expert's own numbers.
import { ExpertPage } from './ExpertFrame';
import { Empty, MeCard } from '../me/kit';
import { Meter } from '../../components/ui';
import { useExpertOrders } from '../../lib/expertStore';
import { expertStats } from './ExpertHome';

import { LIVE } from '../../services/http';
import { IcArrowRight, IcMessage, IcSpark, IcStar } from '../../components/icons';

const AUDITS = LIVE ? [] : [['RS-1108', 5, 'Strong numbers in every bullet. Great LinkedIn headline.'], ['RS-1102', 4, 'Summary was generic in draft 1 — fixed in draft 2.'], ['RS-1089', 5, '—']];

export default function Performance() {
  const orders = useExpertOrders();
  const st = expertStats(orders);
  const reviews = orders.filter((o) => o.review);
  const tips = [
    st.revisions > 1 && `Your orders take ${st.revisions} revisions on average. Asking for numbers in the first message usually brings this down.`,
    st.onTime < 95 && `On-time is ${st.onTime}%. Turn on holiday mode or lower orders per week when you’re busy — late orders are refunded.`,
    st.rating < 4.8 && 'Ratings rise when the draft note explains what changed and why.',
    'Save your best bullets as snippets — experts who reuse them deliver faster.',
  ].filter(Boolean);
  return (
    <ExpertPage width="wide" kicker="How you’re doing" title="Performance & reviews" sub={LIVE ? 'From your delivered Nm7 orders.' : 'Last 90 days · includes orders before this preview (sample).'} shape="badge">
      <div className="ex-tiles">
        {[['Rating', `${st.rating}/5`, st.rating * 20], ['On time', `${st.onTime}%`, st.onTime], ['Revisions / order', st.revisions, Math.max(0, 100 - st.revisions * 40)], ['Delivered', st.delivered, Math.min(100, st.delivered * 2.5)]].map(([l, v, pct]) => (
          <div key={l} className={`ex-tile ${pct >= 80 ? 'ex-tile-ok' : ''}`}><span className="ex-tile-l">{l}</span><strong className="ex-tile-v">{v}</strong><Meter value={pct} label={l} color={pct >= 80 ? 'var(--success)' : 'var(--warning)'} /></div>
        ))}
      </div>
      <div className="ex-cols">
        <MeCard title="Customer reviews" icon={<IcMessage />} sub="What customers wrote after delivery.">
          {reviews.length === 0 && <Empty compact shape="badge" title="No reviews yet">Reviews appear after customers approve your work.</Empty>}
          <div className="mlist">
            {reviews.map((o) => <div key={o.id} className="ex-quote"><span className="ex-stars" aria-label={`${o.rating} out of 5`}>{[1, 2, 3, 4, 5].map((n) => <IcStar key={n} size={14} fill={n <= o.rating ? 'currentColor' : 'none'} />)}</span><span className="ex-quote-text">“{o.review}”</span><span className="xs faint">{o.id} · {o.role}</span></div>)}
          </div>
          <h3 className="ex-subhead">Quality audits by the Nm7 team</h3>
          {AUDITS.length === 0 && <span className="small muted">No audits yet.</span>}
          <div className="mlist">
            {AUDITS.map(([id, sc, n]) => <div key={id} className="mitem"><span className="mitem-main"><span className="mitem-title">{id}</span><span className="mitem-meta">{n}</span></span><span className={`badge ${sc >= 5 ? 'b-success' : 'b-warning'}`}>{sc}/5</span></div>)}
          </div>
        </MeCard>
        <MeCard title="Tips from your numbers" icon={<IcSpark />} tone="accent">
          <div className="mlist">{tips.map((t) => <span key={t} className="ex-tip"><span className="ex-tip-ic" aria-hidden="true"><IcArrowRight size={14} /></span><span>{t}</span></span>)}</div>
          <span className="xs faint">Below 90% on time or 2+ refunds in a week pauses new offers until you talk to us.</span>
        </MeCard>
      </div>
    </ExpertPage>
  );
}
