// Career Launch area: LinkedIn makeover (with copy buttons), mentor-call booking from the expert's 3 times, call notes.
import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useToast } from '../../components/ui';
import { useMe, setMe, orderView, upgradeOrder } from '../../lib/customerStore';
import { useExpertOrders, updateOrder } from '../../lib/expertStore';
import { PLANS, inr, upgradePrice } from '../../lib/pricing';
import { savePdf } from '../builder/resumePdf';
import { MeHead } from './MeLayout';
import { PayDialog } from './MeOrders';
import { fmtWhen } from './shared';
import { Chip, MeCard } from './kit';
import { Still } from '../newhome/ParticleStage';
import '../../styles/me-learn.css';
import { IcMail, IcPhone } from '../../components/icons';

const H = 3600000;
const ics = (t, title) => {
  const f = (d) => new Date(d).toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
  return ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//nm7.si//mentor call//EN', 'BEGIN:VEVENT', `UID:${t}@nm7.si`, `DTSTAMP:${f(Date.now())}`, `DTSTART:${f(t)}`, `DTEND:${f(t + 0.5 * H)}`, `SUMMARY:${title}`, 'LOCATION:Online (link in your Nm7 dashboard)', 'END:VEVENT', 'END:VCALENDAR'].join('\r\n');
};

function Copy({ label, text }) {
  const toast = useToast();
  return (
    <div className="ml-copy">
      <div className="mspread"><span className="ml-box-h">{label}</span><button type="button" className="btn btn-outline btn-sm" style={{ minHeight: 40 }} onClick={async () => { try { await navigator.clipboard.writeText(text); toast(`${label} copied`); } catch { toast('Select the text and copy it'); } }}>Copy</button></div>
      <p>{text}</p>
    </div>
  );
}

export default function MeLaunch() {
  const me = useMe();
  const all = useExpertOrders();
  const toast = useToast();
  const [pay, setPay] = useState(null);
  const orders = me.orders.map(orderView).filter((o) => o.x);
  const o = orders.find((x) => x.plan === 'launch') || orders.find((x) => x.addons.some((a) => a.id === 'linkedin'));
  const x = o ? all.find((y) => y.id === o.id) : null;
  const isLaunch = o?.plan === 'launch';
  const canUp = orders.find((y) => y.live && y.plan === 'expert');

  if (!o) {
    return (
      <>
        <MeHead title="Career Launch" sub="LinkedIn makeover, cover letter and a 1:1 mentor call with your expert." />
        <section className="mcard mcard-accent ml-hero" aria-label="Career Launch">
          <div className="stack g12">
            <span><Chip tone="neutral">Not part of your plan yet</Chip></span>
            <h2 className="ml-hero-title">Get noticed faster, with your expert beside you</h2>
            <ul className="mplan-feat"><li>LinkedIn headline, About and top role rewritten</li><li>A cover letter for your first target job</li><li>30-minute 1:1 call with your expert — pick from 3 times</li></ul>
            <div className="ml-actions">
              {canUp ? <button type="button" className="btn btn-signal" onClick={() => setPay(canUp)}>Upgrade {canUp.id} · pay {inr(upgradePrice('expert', 'launch'))}</button> : <Link to="/" className="btn btn-signal">See plans</Link>}
            </div>
          </div>
          <span className="mempty-art" aria-hidden="true" data-tint="student" style={{ width: 150, height: 150, justifySelf: 'center' }}><Still shape="cap" tint="student" className="mempty-still" /></span>
        </section>
        {pay && <PayDialog title={`Upgrade ${pay.id} to ${PLANS.launch.name}`} amount={upgradePrice('expert', 'launch')} onClose={() => setPay(null)} onPaid={() => { upgradeOrder(pay.id, 'launch'); setPay(null); toast('Upgraded — your expert is told'); }} />}
      </>
    );
  }

  const li = x?.linkedin;
  const call = x?.call || {};
  const slots = (call.slots || []).filter(Boolean);
  const picked = call.picked;
  return (
    <>
      <MeHead title="Career Launch" sub={`Order ${o.id}${isLaunch ? '' : ' · LinkedIn makeover add-on'}`} />
      <div className="mgrid-2">
        <MeCard icon="in" title="LinkedIn makeover" sub={li ? 'Paste each part into LinkedIn, in Edit profile.' : 'Your expert writes this once your resume is final — it uses the same wording, so they match.'} actions={<Chip tone={li ? 'ok' : 'warn'}>{li ? 'Ready' : 'Being written'}</Chip>}>
          {li ? <div className="stack g12"><Copy label="Headline" text={li.headline} /><Copy label="About" text={li.about} />{li.experience && <Copy label="Experience" text={li.experience} />}</div>
            : <div className="mempty mempty-sm" style={{ borderStyle: 'dashed' }}><span className="mempty-text">Nothing to do yet. We’ll tell you on WhatsApp and email when it is ready.</span></div>}
        </MeCard>
        <div className="mstack">
          {isLaunch && (
            <MeCard icon={<IcPhone />} title="1:1 mentor call · 30 min" actions={picked ? <Chip tone="ok">Booked</Chip> : slots.length ? <Chip tone="accent">Pick a time</Chip> : <Chip tone="neutral">Waiting for times</Chip>}>
              {picked ? (
                <div className="stack g12">
                  <div className="ml-booked">
                    <span className="stack g4" style={{ minWidth: 0 }}>
                      <span className="ml-box-h">Booked for</span>
                      <strong className="ml-booked-day">{fmtWhen(new Date(picked).getTime())}</strong>
                      <span className="small">Link: <span className="mono">meet.nm7.si/{o.id.toLowerCase()}</span></span>
                    </span>
                  </div>
                  <div className="ml-actions">
                    <button type="button" className="btn btn-signal" onClick={() => savePdf(new Blob([ics(new Date(picked).getTime(), `Mentor call with your Nm7 expert (${o.id})`)], { type: 'text/calendar' }), 'mentor-call.ics')}>Add to calendar</button>
                    <button type="button" className="btn btn-outline" onClick={() => { updateOrder(o.id, (y) => ({ call: { ...y.call, picked: null }, messages: [...(y.messages || []), { from: 'customer', text: 'I need to change our call time — can you share new times?', at: Date.now() }] })); toast('Your expert is asked for new times'); }}>Change time</button>
                  </div>
                </div>
              ) : slots.length ? (
                <div className="ml-slots" role="radiogroup" aria-label="Pick a time">
                  <span className="small muted">Your expert offered these times. Pick one:</span>
                  {slots.map((s) => <button key={s} type="button" role="radio" aria-checked="false" className="ml-slot" onClick={() => { updateOrder(o.id, (y) => ({ call: { ...y.call, picked: s }, messages: [...(y.messages || []), { from: 'customer', text: `Booked our call for ${fmtWhen(new Date(s).getTime())}.`, at: Date.now() }] })); toast('Call booked — you’ll both get a reminder'); }}>{fmtWhen(new Date(s).getTime())}</button>)}
                </div>
              ) : (
                <div className="stack g8">
                  <span className="small muted">Your expert will share 3 times that suit them — you’ll get a WhatsApp and email.</span>
                  {import.meta.env.VITE_PREVIEW === '1' && <button type="button" className="link-btn xs" style={{ alignSelf: 'flex-start' }} onClick={() => { const b = Math.ceil(Date.now() / H) * H + 24 * H; const loc = (t) => new Date(t - new Date(t).getTimezoneOffset() * 60000).toISOString().slice(0, 16); updateOrder(o.id, () => ({ call: { slots: [loc(b + 2 * H), loc(b + 26 * H), loc(b + 50 * H)], offered: true } })); }}>Preview: pretend the expert sent 3 times</button>}
                </div>
              )}
              <div className="field"><label htmlFor="cn" className="label">My notes for the call</label><textarea id="cn" className="input" rows={4} value={me.calls?.notes || ''} onChange={(e) => setMe((s) => ({ calls: { ...s.calls, notes: e.target.value } }))} placeholder="Questions to ask: which companies to target, how to answer ‘tell me about yourself’…" /></div>
            </MeCard>
          )}
          {isLaunch && (
            <MeCard icon={<IcMail />} title="Cover letter" sub="For your first target job.">
              <div><Link to="/me/covers" className="btn btn-outline">Open cover letters</Link></div>
            </MeCard>
          )}
        </div>
      </div>
    </>
  );
}
