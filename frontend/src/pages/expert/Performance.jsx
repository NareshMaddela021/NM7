// Performance & reviews: ratings, on-time, revisions, audit scores and tips from the expert's own numbers.
import Header from '../../components/Header';
import { Meter } from '../../components/ui';
import { useExpertOrders } from '../../lib/expertStore';
import { expertStats } from './ExpertHome';

const AUDITS = [['RS-1108', 5, 'Strong numbers in every bullet. Great LinkedIn headline.'], ['RS-1102', 4, 'Summary was generic in draft 1 — fixed in draft 2.'], ['RS-1089', 5, '—']];

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
    <>
      <Header variant="expert" />
      <main className="container stack g16" style={{ maxWidth: 1100, padding: '24px 24px 64px' }}>
        <div className="stack g4"><h1 className="display" style={{ fontSize: 32 }}>Performance & reviews</h1><span className="small muted">Last 90 days · includes orders before this preview (sample).</span></div>
        <div className="kpis">
          {[['Rating', `★ ${st.rating}`, st.rating * 20], ['On time', `${st.onTime}%`, st.onTime], ['Revisions / order', st.revisions, Math.max(0, 100 - st.revisions * 40)], ['Delivered', st.delivered, Math.min(100, st.delivered * 2.5)]].map(([l, v, pct]) => (
            <div key={l} className="card stack g8" style={{ padding: 16 }}><span className="xs muted">{l}</span><strong className="display" style={{ fontSize: 26 }}>{v}</strong><Meter value={pct} label={l} color={pct >= 80 ? 'var(--success)' : 'var(--warning)'} /></div>
          ))}
        </div>
        <div className="row g16" style={{ alignItems: 'flex-start' }}>
          <section className="card stack g12" style={{ flex: '2 1 420px' }}>
            <strong>Customer reviews</strong>
            {reviews.map((o) => <div key={o.id} className="well stack g4"><span className="small">{'★'.repeat(o.rating)}{'☆'.repeat(5 - o.rating)} · {o.role}</span><span className="small">“{o.review}”</span><span className="xs faint">{o.id}</span></div>)}
            <strong style={{ marginTop: 8 }}>Quality audits by the Nm7 team</strong>
            {AUDITS.map(([id, sc, n]) => <div key={id} className="row between small"><span>{id} · {n}</span><span className={`badge ${sc >= 5 ? 'b-success' : 'b-warning'}`}>{sc}/5</span></div>)}
          </section>
          <section className="card stack g8" style={{ flex: '1 1 300px' }}>
            <strong>Tips from your numbers</strong>
            {tips.map((t) => <span key={t} className="small">✦ {t}</span>)}
            <span className="xs faint" style={{ marginTop: 8 }}>Below 90% on time or 2+ refunds in a week pauses new offers until you talk to us.</span>
          </section>
        </div>
      </main>
    </>
  );
}
