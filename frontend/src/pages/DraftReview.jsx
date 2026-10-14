// Customer side: see the expert's latest draft, compare with the original, comment on sections, ask for changes or approve.
import { useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import Header from '../components/Header';
import { useToast } from '../components/ui';
import ResumePreview from './builder/ResumePreview';
import { DEFAULT_DESIGN, TEMPLATE_PRESETS } from './builder/design';
import { PRINTABLE, resolveOrder, sectionLabel } from './builder/schema';
import { atsScore } from '../lib/atsScore';
import { useExpertOrders, updateOrder } from '../lib/expertStore';

export default function DraftReviewRoute() {
  const { id } = useParams();
  return <DraftReview key={id} id={id} />;
}

function DraftReview({ id }) {
  const toast = useToast();
  const o = useExpertOrders().find((x) => x.id === id);
  const sent = (o?.versions || []).filter((v) => v.data && v.sent);
  const v = sent[sent.length - 1];
  const [sec, setSec] = useState('summary');
  const [text, setText] = useState('');
  const [rating, setRating] = useState(0);
  const [review, setReview] = useState('');
  if (!o || !v) {
    return <><Header variant="flow" /><main className="container stack g12" style={{ maxWidth: 720, padding: 40 }}><h1 className="display" style={{ fontSize: 28 }}>No draft yet</h1><p className="muted">Your expert hasn’t sent a draft for {id} yet. You’ll get a WhatsApp and email when it’s ready.</p><Link to={`/orders/${id}`}>Back to your order</Link></main></>;
  }
  const ds = { ...DEFAULT_DESIGN, ...(v.data.design || TEMPLATE_PRESETS.fresher.design) };
  const before = atsScore(o.original, o.jd).score; const after = atsScore(v.data, o.jd).score;
  const isFinal = v.label === 'Final';
  const mine = (o.comments || []).filter((c) => !c.resolved);
  return (
    <>
      <Header variant="flow" />
      <main className="container-wide row g24" style={{ padding: '24px 24px 64px', alignItems: 'flex-start' }}>
        <section className="stack g12" style={{ flex: '3 1 520px', minWidth: 0 }}>
          <div className="row between g8"><h1 className="display" style={{ fontSize: 30 }}>{v.label} of your resume</h1><span className="badge b-success">ATS {before} → {after}</span></div>
          {v.note && <p className="well small" style={{ margin: 0 }}><strong>From your expert:</strong> {v.note}</p>}
          <ResumePreview data={v.data} design={ds} />
        </section>
        <aside className="stack g16 sticky" style={{ flex: '2 1 320px', maxWidth: 420, top: 88 }}>
          {o.status === 'waiting' && !isFinal && (
            <form className="card stack g12" onSubmit={(e) => { e.preventDefault(); updateOrder(o.id, (x) => ({ comments: [...(x.comments || []), { id: `c${Date.now()}`, section: sec, text: text.trim(), at: Date.now(), resolved: false }] })); setText(''); toast('Comment added'); }}>
              <strong>Comment on a section</strong>
              <div className="field"><label htmlFor="rsec" className="label">Section</label><select id="rsec" className="input" style={{ height: 42 }} value={sec} onChange={(e) => setSec(e.target.value)}>{['personal', ...resolveOrder(v.data).filter((s) => !v.data.hidden?.[s])].map((s) => <option key={s} value={s}>{s === 'personal' ? 'Name & contact' : sectionLabel(v.data, s)}</option>)}</select></div>
              <div className="field"><label htmlFor="rtxt" className="label">What should change?</label><textarea id="rtxt" className="input" rows={3} value={text} onChange={(e) => setText(e.target.value)} placeholder="e.g. Please add that I automated the weekly report." /></div>
              <button type="submit" className="btn btn-outline" disabled={text.trim().length < 5}>Add comment</button>
              {mine.length > 0 && <div className="stack g4">{mine.map((c) => <span key={c.id} className="small well"><strong>{PRINTABLE[c.section] || 'Name & contact'}:</strong> {c.text}</span>)}</div>}
              <div className="row g8">
                <button type="button" className="btn btn-ink" disabled={!mine.length} onClick={() => { updateOrder(o.id, (x) => ({ status: 'revision', messages: [...(x.messages || []), { from: 'customer', text: `I left ${mine.length} comment${mine.length > 1 ? 's' : ''} on the draft.`, at: Date.now() }] })); toast('Sent to your expert'); }}>Ask for changes ({mine.length})</button>
                <button type="button" className="btn btn-ghost" onClick={() => { updateOrder(o.id, (x) => ({ messages: [...(x.messages || []), { from: 'customer', text: 'Looks good — please send the final.', at: Date.now() }] })); toast('Your expert will send the final'); }}>Looks good</button>
              </div>
            </form>
          )}
          {o.status === 'revision' && <div className="card small">You asked for changes — your expert is on it.</div>}
          {isFinal && (
            <div className="card stack g12">
              <strong>Your final resume is ready</strong>
              <span className="small muted">It’s also saved in your resume builder, so you can keep editing it any time.{o.deliveredToBuilder ? '' : ' (In the live app.)'}</span>
              <Link to="/builder" state={{ open: 'build' }} className="btn btn-ink">Open in my resume builder</Link>
              {o.status !== 'approved' ? (
                <div className="stack g8">
                  <span className="label">Rate your expert</span>
                  <div className="row g4" role="radiogroup" aria-label="Rating">{[1, 2, 3, 4, 5].map((n) => <button key={n} type="button" role="radio" aria-checked={rating === n} aria-label={`${n} star${n > 1 ? 's' : ''}`} className="btn btn-icon" style={{ fontSize: 22, color: n <= rating ? 'var(--warning)' : 'var(--text3)' }} onClick={() => setRating(n)}>★</button>)}</div>
                  <textarea aria-label="Review" className="input" rows={2} value={review} onChange={(e) => setReview(e.target.value)} placeholder="What did you like? (optional)" />
                  <button type="button" className="btn btn-outline" disabled={!rating} onClick={() => { updateOrder(o.id, () => ({ status: 'approved', rating, review: review.trim() || null })); toast('Thanks! Order approved'); }}>Approve & rate</button>
                </div>
              ) : <span className="badge b-success" style={{ alignSelf: 'flex-start' }}>Approved · ★ {o.rating}</span>}
            </div>
          )}
        </aside>
      </main>
    </>
  );
}
