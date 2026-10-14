// Messages with experts, one thread per order (the same thread the expert sees in their workspace).
import { useEffect, useRef, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { useMe, markSeen } from '../../lib/customerStore';
import { useExpertOrders, updateOrder } from '../../lib/expertStore';
import { PLANS } from '../../lib/pricing';
import { MeHead } from './MeLayout';
import { fmtWhen } from './shared';

const QUICK = ['Here are the numbers you asked for:', 'Can we keep it to one page?', 'Thanks! Looks great.'];

export default function MeMessages() {
  const me = useMe();
  const all = useExpertOrders();
  const [params, setParams] = useSearchParams();
  const threads = me.orders.filter((o) => o.linked).map((o) => ({ o, x: all.find((x) => x.id === o.id) })).filter((t) => t.x);
  const cur = threads.find((t) => t.o.id === params.get('order')) || threads[0];
  const [text, setText] = useState('');
  const end = useRef();
  const msgs = cur?.x.messages || [];
  useEffect(() => { if (cur) markSeen(cur.o.id); end.current?.scrollIntoView({ block: 'nearest' }); }, [cur?.o.id, msgs.length]); // eslint-disable-line react-hooks/exhaustive-deps
  const unread = (t) => (t.x.messages || []).filter((m) => m.from === 'expert' && m.at > (me.seen?.[t.o.id] || 0)).length;
  const send = (e) => {
    e.preventDefault();
    const v = text.trim(); if (!v) return;
    updateOrder(cur.o.id, (x) => ({ messages: [...(x.messages || []), { from: 'customer', text: v, at: Date.now() }] }));
    setText('');
  };
  if (!cur) return <><MeHead title="Messages" /><p className="muted">No expert orders yet — messages appear here once an expert picks up your order.</p></>;
  return (
    <>
      <MeHead title="Messages" sub="Chat with your expert. Replies also reach you on WhatsApp and email (see Settings)." />
      <div className="row g16" style={{ alignItems: 'stretch' }}>
        <nav aria-label="Conversations" className="stack g4" style={{ flex: '1 1 220px', maxWidth: 300 }}>
          {threads.map((t) => (
            <button key={t.o.id} type="button" onClick={() => setParams({ order: t.o.id })} aria-current={t === cur ? 'true' : undefined}
              className="row between g8" style={{ border: '1px solid var(--border)', borderRadius: 12, padding: '10px 12px', textAlign: 'left', background: t === cur ? 'var(--sunken)' : 'var(--surface)' }}>
              <span className="stack"><strong className="small">{t.o.id} · {PLANS[t.x.plan].name}</strong><span className="xs muted">{t.x.messages?.length ? t.x.messages[t.x.messages.length - 1].text.slice(0, 40) : 'No messages yet'}</span></span>
              {unread(t) > 0 && <span className="badge b-danger">{unread(t)}</span>}
            </button>
          ))}
        </nav>
        <section className="card stack g12" style={{ flex: '3 1 420px', minHeight: 420 }} aria-label={`Messages for ${cur.o.id}`}>
          <div className="row between g8"><strong>Your expert · {cur.x.role}</strong><Link to={`/me/orders/${cur.o.id}`} className="small">Order {cur.o.id} →</Link></div>
          <div className="stack g8" style={{ flex: 1, maxHeight: 460, overflow: 'auto', paddingRight: 4 }} aria-live="polite">
            {msgs.length === 0 && <span className="small muted">Say hi, or share anything your expert should know.</span>}
            {msgs.map((m, i) => m.from === 'system'
              ? <span key={i} className="xs faint" style={{ alignSelf: 'center' }}>{m.text} · {fmtWhen(m.at)}</span>
              : (
                <div key={i} className="stack g4" style={{ alignSelf: m.from === 'customer' ? 'flex-end' : 'flex-start', maxWidth: '78%' }}>
                  <span className="small" style={{ padding: '10px 14px', borderRadius: 14, background: m.from === 'customer' ? 'var(--ink)' : 'var(--sunken)', color: m.from === 'customer' ? 'var(--onink)' : 'var(--text)', whiteSpace: 'pre-wrap' }}>{m.text}</span>
                  <span className="xs faint" style={{ alignSelf: m.from === 'customer' ? 'flex-end' : 'flex-start' }}>{m.from === 'customer' ? 'You' : 'Expert'} · {fmtWhen(m.at)}</span>
                </div>
              ))}
            <span ref={end} />
          </div>
          <div className="row g4">{QUICK.map((q) => <button key={q} type="button" className="chip" style={{ minHeight: 30, fontSize: 12 }} onClick={() => setText(q)}>{q}</button>)}</div>
          <form className="row g8" onSubmit={send}>
            <label htmlFor="msg" className="sr-only">Message</label>
            <input id="msg" className="input" style={{ flex: 1, height: 44 }} value={text} onChange={(e) => setText(e.target.value)} placeholder="Write a message…" />
            <button type="submit" className="btn btn-ink" disabled={!text.trim()}>Send</button>
          </form>
          <span className="xs faint">Please don’t share passwords or payment details in chat.</span>
        </section>
      </div>
    </>
  );
}
