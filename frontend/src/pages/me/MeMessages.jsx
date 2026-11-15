// Messages with experts, one thread per order (the same thread the expert sees in their workspace).
import { useEffect, useRef, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { useMe, markSeen } from '../../lib/customerStore';
import { useExpertOrders, updateOrder } from '../../lib/expertStore';
import { PLANS } from '../../lib/pricing';
import { MeHead } from './MeLayout';
import { fmtWhen } from './shared';
import { Empty } from './kit';
import '../../styles/me-account.css';

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
  if (!cur) return <><MeHead title="Messages" sub="Chat with your expert about your order." /><Empty shape="handshake" title="No messages yet" action={<Link to="/me/orders" className="btn btn-signal">See my orders</Link>}>No expert orders yet — messages appear here once an expert picks up your order.</Empty></>;
  return (
    <>
      <MeHead title="Messages" sub="Chat with your expert. Replies also reach you on WhatsApp and email (see Settings)." />
      <div className="acc-chatwrap">
        <nav aria-label="Conversations" className="mcard acc-threads">
          <span className="mkicker">Conversations</span>
          {threads.map((t) => (
            <button key={t.o.id} type="button" onClick={() => setParams({ order: t.o.id })} aria-current={t === cur ? 'true' : undefined} className="acc-thread">
              <span className="mavatar" aria-hidden="true">{(t.x.role || 'E')[0]}</span>
              <span className="acc-thread-main"><strong className="small">{t.o.id} · {PLANS[t.x.plan].name}</strong><span className="xs muted acc-thread-last">{t.x.messages?.length ? t.x.messages[t.x.messages.length - 1].text.slice(0, 40) : 'No messages yet'}</span></span>
              {unread(t) > 0 && <span className="badge b-danger">{unread(t)}</span>}
            </button>
          ))}
        </nav>
        <section className="mcard acc-chat" aria-label={`Messages for ${cur.o.id}`}>
          <header className="acc-chat-h">
            <span className="mavatar" aria-hidden="true">{(cur.x.role || 'E')[0]}</span>
            <span className="acc-thread-main"><strong>Your expert · {cur.x.role}</strong><span className="xs muted">{PLANS[cur.x.plan].name}</span></span>
            <Link to={`/me/orders/${cur.o.id}`} className="small acc-chat-order">Order {cur.o.id} →</Link>
          </header>
          <div className="mchat acc-chat-body" aria-live="polite">
            {msgs.length === 0 && <span className="small muted acc-chat-hi">Say hi, or share anything your expert should know.</span>}
            {msgs.map((m, i) => m.from === 'system'
              ? <span key={i} className="xs faint acc-sys">{m.text} · {fmtWhen(m.at)}</span>
              : (
                <div key={i} className={`mbubble ${m.from === 'customer' ? 'me' : 'them'}`}>
                  <span style={{ whiteSpace: 'pre-wrap' }}>{m.text}</span>
                  <span className="mbubble-meta">{m.from === 'customer' ? 'You' : 'Expert'} · {fmtWhen(m.at)}</span>
                </div>
              ))}
            <span ref={end} />
          </div>
          <div className="acc-composer">
            <div className="acc-quick">{QUICK.map((q) => <button key={q} type="button" className="chip" onClick={() => setText(q)}>{q}</button>)}</div>
            <form className="acc-send" onSubmit={send}>
              <label htmlFor="msg" className="sr-only">Message</label>
              <input id="msg" className="input" value={text} onChange={(e) => setText(e.target.value)} placeholder="Write a message…" />
              <button type="submit" className="btn btn-signal" disabled={!text.trim()}>Send</button>
            </form>
            <span className="xs faint">Please don’t share passwords or payment details in chat.</span>
          </div>
        </section>
      </div>
    </>
  );
}
