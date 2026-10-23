// Expert order workspace: the full resume builder + brief, live checks, versions/compare, messages & comments,
// snippets, Career Launch extras, send draft and final delivery (into the customer's own builder).
import { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import Header from '../../components/Header';
import { Icon, useToast } from '../../components/ui';
import Builder from '../Builder';
import ResumePreview from '../builder/ResumePreview';
import Compare from '../builder/Compare';
import { draftKeyFor } from '../../lib/auth';
import { DEFAULT_DESIGN, TEMPLATE_PRESETS } from '../builder/design';
import { PRINTABLE } from '../builder/schema';
import { atsScore } from '../../lib/atsScore';
import { useExpertOrders, updateOrder, useSnippets } from '../../lib/expertStore';
import { applyImport } from '../../lib/import/apply';
import { PLANS, ADDONS, expertPayout, inr } from '../../lib/pricing';
import { LIVE, http } from '../../services/http';
import { entryLabel } from '../../lib/jobProfile';

/** The customer's Job Profile, only when they allowed it (personal details only if they allowed those too). */
function CustomerProfile({ orderId }) {
  const [st, setSt] = useState({ loading: LIVE });
  useEffect(() => {
    if (!LIVE) return undefined;
    let on = true;
    http(`/api/work/${orderId}/profile`).then((r) => on && setSt({ data: r.data, privacy: r.privacy }), (e) => on && setSt({ error: e.status === 404 || e.status === 405 ? 'none' : e.message }));
    return () => { on = false; };
  }, [orderId]);
  if (st.loading) return null;
  if (!st.data) return <span className="xs faint">{st.error && st.error !== 'none' ? st.error : 'The customer hasn’t shared their Job Profile with you.'}</span>;
  const p = st.data;
  const lists = [['Experience', p.exp], ['Internships', p.intern], ['Projects', p.proj], ['Education', p.edu], ['Certifications', p.certs], ['Achievements', p.ach], ['Extracurricular', p.extra]];
  return (
    <div className="well stack g4 small" aria-label="Customer’s Job Profile">
      <strong>Their Job Profile (shared with you)</strong>
      {(p.summaries || []).filter((x) => x.text?.trim()).map((x) => <span key={x.id}><strong>{x.name || 'Summary'}:</strong> {x.text}</span>)}
      {lists.filter(([, l]) => l?.length).map(([t, l]) => <span key={t}><strong>{t}:</strong> {l.map(entryLabel).join(' · ')}</span>)}
      {(p.skillGroups || []).some((g) => g.value) && <span><strong>Skills:</strong> {p.skillGroups.map((g) => g.value).filter(Boolean).join(', ')}</span>}
    </div>
  );
}

const QA = ['ATS-safe layout (one column, no tables or text boxes)', 'Numbers / results in most bullets', 'No spelling or grammar mistakes', 'Matches the target role and job description', 'One page for 0–3 years (two only if truly needed)'];
const H = 3600000;

export function timeLeft(o, now = Date.now()) {
  const h = (o.deadline - now) / H;
  const mins = Math.floor((h * 60)); // whole minutes, so it never shows "60m"
  return { h, label: h < 0 ? `${Math.round(-h)}h late` : h < 1 ? `${Math.max(1, mins)} min left` : `${Math.floor(mins / 60)}h ${mins % 60}m left`, color: h < 6 ? 'var(--danger)' : h < 24 ? 'var(--warning)' : 'var(--success)' };
}

/** Side drawer that always sits below the order bar (so the bar's buttons stay clickable). */
function Drawer({ title, onClose, children }) {
  const [top, setTop] = useState(80);
  useEffect(() => {
    const place = () => { const b = document.getElementById('ws-orderbar'); setTop(Math.max(16, (b ? b.getBoundingClientRect().bottom : 64) + 8)); };
    place(); window.addEventListener('scroll', place, { passive: true }); window.addEventListener('resize', place);
    return () => { window.removeEventListener('scroll', place); window.removeEventListener('resize', place); };
  }, []);
  return (
    <aside aria-label={title} className="card stack g16" style={{ position: 'fixed', right: 16, top, bottom: 16, width: 'min(460px, calc(100vw - 32px))', overflow: 'auto', zIndex: 40, padding: 20, boxShadow: 'var(--shadow)' }}>
      <div className="row between g8"><strong style={{ fontSize: 18 }}>{title}</strong><button type="button" className="btn btn-icon" aria-label="Close" onClick={onClose}>✕</button></div>
      {children}
    </aside>
  );
}

/* ---------- Career Launch: LinkedIn makeover from the resume ---------- */
function linkedinFrom(d) {
  const skills = (d.skillGroups || []).flatMap((g) => g.value.split(',').map((x) => x.trim()).filter(Boolean));
  const role = d.personal?.headline?.split(/\s[·|]\s/)[0] || d.exp?.[0]?.role || 'Professional';
  return {
    headline: `${role} | ${skills.slice(0, 3).join(' · ')} | Open to opportunities`,
    about: `${d.summary || ''}\n\nWhat I work with: ${skills.slice(0, 8).join(', ')}.\n\nOpen to ${role} roles — feel free to message me.`.trim(),
    experience: (d.exp || []).filter((e) => e.role).map((e) => `${e.role} · ${e.company}\n${(e.description || '').split('\n').slice(0, 3).join('\n')}`).join('\n\n'),
  };
}

/** Keyed by order id so switching orders starts a fresh workspace (no state carried over). */
export default function OrderWorkspaceRoute() {
  const { id } = useParams();
  return <OrderWorkspace key={id} id={id} />;
}

function OrderWorkspace({ id }) {
  const nav = useNavigate();
  const toast = useToast();
  const orders = useExpertOrders();
  const snippets = useSnippets();
  const o = orders.find((x) => x.id === id);
  const latest = o?.versions?.length ? o.versions[o.versions.length - 1].data : null;
  const [d, setD] = useState(null);
  const [drawer, setDrawer] = useState(null);
  const [replace, setReplace] = useState(null);
  const [focus, setFocus] = useState(null);
  const [ticks, setTicks] = useState(QA.map(() => false));
  const [note, setNote] = useState('');
  const [msg, setMsg] = useState('');
  const [cmp, setCmp] = useState('original');
  const [snipFilter, setSnipFilter] = useState(o?.role || '');
  const [busy, setBusy] = useState(false);
  const fileRef = useRef();
  const embedded = useMemo(() => (o?.original ? { storageKey: `asuraa-ws-${id}`, initial: latest || o.original, onChange: setD } : null), [id]); // eslint-disable-line react-hooks/exhaustive-deps

  const orig = useMemo(() => (o?.original ? atsScore(o.original, o.jd) : null), [o?.original, o?.jd]);
  const now = useMemo(() => (d ? atsScore(d, o?.jd) : orig), [d, o?.jd, orig]);

  if (!o) return <><Header variant="expert" /><main className="container" style={{ padding: 40 }}><p>Order not found. <Link to="/expert/orders">Back to orders</Link></p></main></>;
  const tl = timeLeft(o);
  const open = (k) => setDrawer(drawer === k ? null : k);
  const doReplace = (data) => setReplace({ n: Date.now(), data });
  const unresolved = (o.comments || []).filter((c) => !c.resolved);
  const draftN = (o.versions || []).filter((v) => v.label?.startsWith('Draft')).length + 1;
  const allTicked = ticks.every(Boolean);
  const live = ['progress', 'waiting', 'revision'].includes(o.status);

  /* ---------- offer screen ---------- */
  if (o.status === 'offer' || o.status === 'declined') {
    const mins = Math.max(0, Math.round((o.offerExpires - Date.now()) / 60000));
    return (
      <><Header variant="expert" />
        <main className="container stack g20 rise" style={{ maxWidth: 820, padding: '40px 24px' }}>
          <Link to="/expert/orders" className="small">← Orders</Link>
          <div className="card stack g16" style={{ padding: 24 }}>
            <div className="row between g8"><h1 className="display" style={{ fontSize: 30 }}>New order offer</h1><span className="badge b-warning">{o.status === 'declined' ? 'Declined' : `${mins} min to accept`}</span></div>
            <div className="grid-auto g12 small" style={{ '--min': '200px' }}>
              <span><strong>Plan:</strong> {PLANS[o.plan].name} · you earn {inr(expertPayout(o.price).net)}</span>
              <span><strong>Target role:</strong> {o.intake.target}</span>
              <span><strong>Domain / level:</strong> {o.domain} · {o.level}</span>
              <span><strong>Deadline:</strong> {timeLeft(o).label}</span>
              <span><strong>Their resume today:</strong> ATS {orig?.score}/100</span>
              <span><strong>Wins to highlight:</strong> {o.intake.wins}</span>
            </div>
            {o.plan === 'launch' && <span className="well small">Career Launch includes a LinkedIn makeover, a cover letter and a 1:1 mentor call.</span>}
            {o.status === 'offer' && <div className="row g8">
              <button type="button" className="btn btn-ink btn-lg" onClick={() => { updateOrder(o.id, () => ({ status: 'progress', accepted: Date.now(), messages: [{ from: 'expert', text: 'Hi! I’m your resume expert — starting on your resume now.', at: Date.now() }] })); toast('Order accepted — the customer has been told'); }}>Accept order</button>
              <button type="button" className="btn btn-outline btn-lg" onClick={() => { updateOrder(o.id, () => ({ status: 'declined' })); toast('Declined — it goes to the next best expert'); nav('/expert/orders'); }}>Decline</button>
            </div>}
            <span className="xs faint">If you don’t answer in time, the order goes to the next best expert. Declining often lowers how many offers you get.</span>
          </div>
        </main>
      </>
    );
  }

  /* ---------- finished orders from before this preview (no resume data kept) ---------- */
  if (!o.original) {
    return (
      <><Header variant="expert" />
        <main className="container stack g16" style={{ maxWidth: 760, padding: '40px 24px' }}>
          <Link to="/expert/orders" className="small">← Orders</Link>
          <div className="card stack g8" style={{ padding: 24 }}>
            <h1 className="display" style={{ fontSize: 28 }}>{o.id} · {o.customer}</h1>
            <span className="muted">{PLANS[o.plan].name} · {o.role} · {o.versions.length} versions · {o.status}</span>
            {o.rating && <span>★ {o.rating} — “{o.review}”</span>}
            <span className="xs faint">Resume files are deleted 60 days after delivery.</span>
          </div>
        </main>
      </>
    );
  }

  /* ---------- actions ---------- */
  const send = (final) => {
    if (!d) return;
    const label = final ? 'Final' : `Draft ${draftN}`;
    const v = { n: (o.versions || []).length + 1, label, at: Date.now(), data: d, note: note.trim(), sent: true };
    let toBuilder = false;
    if (final && o.customerId) { try { localStorage.setItem(draftKeyFor(o.customerId), JSON.stringify(d)); toBuilder = true; } catch { /* ignore */ } } // live app: the server saves it to the customer's account
    updateOrder(o.id, (x) => ({
      versions: [...(x.versions || []), v], status: final ? 'delivered' : 'waiting', deliveredAt: final ? Date.now() : x.deliveredAt, deliveredToBuilder: toBuilder || x.deliveredToBuilder,
      messages: [...(x.messages || []), { from: 'expert', text: `${label} is ready.${note.trim() ? ` ${note.trim()}` : ''}`, at: Date.now() }],
    }));
    setTicks(QA.map(() => false)); setNote(''); setDrawer(null);
    toast(final ? `Final delivered — PDF, Word${toBuilder ? ` and into ${o.customer.split(' ')[0]}’s resume builder` : ''}` : `${label} sent — the customer gets a WhatsApp + email`);
  };
  const importFile = async (f) => {
    if (!f) return;
    setBusy(true);
    try {
      const { importResume } = await import('../../lib/import/index');
      const R = await importResume(f, 'resume', () => {});
      doReplace({ ...applyImport(d || o.original, R.data, 'replace'), design: d?.design || null });
      toast('Read from the file — check each section');
    } catch (e) { toast(e?.message || 'Couldn’t read that file'); } finally { setBusy(false); }
  };
  const quick = ['Can you share numbers for this (time saved, % growth, users)?', 'Which job are you applying for first? Please paste the job post.', 'Draft 1 is coming today — I’ll message you here.'];

  return (
    <>
      <Header variant="expert" />
      {/* order bar */}
      <div id="ws-orderbar" className="container-wide stack g8" style={{ padding: '14px 24px 6px' }}>
        <div className="row between g12" style={{ alignItems: 'center' }}>
          <div className="row g12" style={{ alignItems: 'center' }}>
            <Link to="/expert/orders" className="btn btn-ghost" style={{ paddingLeft: 0 }}><Icon name="back" size={16} />Orders</Link>
            <strong>{o.id} · {o.customer}</strong>
            <span className="badge b-neutral">{PLANS[o.plan].name}</span>
            {[...new Set(o.addons || [])].map((a) => <span key={a} className="badge b-signal">+ {ADDONS[a]?.name}</span>)}
            <span className="badge b-neutral">{o.role}</span>
            {live && <span className="xs strong" style={{ color: tl.color }}>⏱ {tl.label}</span>}
            {!live && <span className="badge b-success">{o.status === 'approved' ? 'Approved' : 'Delivered'}</span>}
          </div>
          <div className="row g8">
            <button type="button" className="btn btn-outline" style={{ minHeight: 38 }} onClick={() => open('checks')} title="ATS score, job match and checklist">
              ATS {orig?.score} → <strong style={{ color: now?.score >= 80 ? 'var(--success)' : 'var(--warning)' }}>{now?.score}</strong>
              <span className="faint">· Job {now?.match.found.length}/{now?.match.keywords.length} · ✓ {ticks.filter(Boolean).length}/5</span>
            </button>
            {live && <button type="button" className="btn btn-ink" style={{ minHeight: 38 }} onClick={() => open('send')}>Send {o.status === 'revision' || draftN > 1 ? `draft ${draftN} / final` : `draft ${draftN}`}</button>}
          </div>
        </div>
        <div className="row g4">
          {[['brief', 'Brief'], ['checks', 'Checks'], ['versions', `Versions (${(o.versions || []).length})`], ['messages', `Messages & comments${unresolved.length ? ` · ${unresolved.length}` : ''}`], ['snippets', 'Snippets'], ...(o.plan === 'launch' ? [['launch', 'LinkedIn & mentor call']] : (o.addons || []).includes('linkedin') ? [['launch', 'LinkedIn makeover']] : [])].map(([k, l]) => (
            <button key={k} type="button" className="chip" aria-pressed={drawer === k} style={{ minHeight: 32, fontSize: 12 }} onClick={() => open(k)}>{l}</button>
          ))}
        </div>
      </div>

      <div className="container-wide" style={{ padding: '0 24px' }}>
        {embedded && <Builder embedded={{ ...embedded, replace, focus }} />}
      </div>

      {drawer === 'brief' && (
        <Drawer title="Customer brief" onClose={() => setDrawer(null)}>
          <div className="stack g4 small">
            <span><strong>Target role:</strong> {o.intake.target}</span>
            <span><strong>Wins to highlight:</strong> {o.intake.wins}</span>
            <span><strong>Avoid:</strong> {o.intake.avoid}</span>
            <span><strong>Companies:</strong> {o.intake.companies}</span>
          </div>
          {o.jd && <div className="well stack g4 small"><strong>Job description</strong><span>{o.jd}</span></div>}
          <CustomerProfile orderId={o.id} />
          <div className="stack g8">
            <strong className="small">Their original resume · ATS {orig.score}/100</strong>
            <div style={{ height: 300, overflow: 'hidden', borderRadius: 6, border: '1px solid var(--border)' }} aria-hidden="true"><ResumePreview decorative data={o.original} design={{ ...DEFAULT_DESIGN, ...TEMPLATE_PRESETS.starter.design }} /></div>
            <ul className="stack g4 xs" style={{ margin: 0, paddingLeft: 16 }}>{orig.checks.filter((c) => !c.ok).map((c) => <li key={c.label}><strong>{c.label}:</strong> {c.tip}</li>)}</ul>
          </div>
          <div className="row g8">
            <button type="button" className="btn btn-outline" onClick={() => { doReplace(o.original); toast('Reset to the customer’s original'); }}>Start again from original</button>
            <button type="button" className="btn btn-outline" disabled={busy} onClick={() => fileRef.current?.click()}>{busy ? 'Reading…' : 'Import from their file'}</button>
            <input ref={fileRef} type="file" accept=".pdf,.docx" className="sr-only" onChange={(e) => { importFile(e.target.files?.[0]); e.target.value = ''; }} />
          </div>
          <span className="xs faint">In the live app the customer’s uploaded file is read automatically when the order starts — this is what you see pre-filled.</span>
        </Drawer>
      )}

      {drawer === 'checks' && now && (
        <Drawer title="Live checks" onClose={() => setDrawer(null)}>
          <div className="row g12" style={{ alignItems: 'baseline' }}><span className="display" style={{ fontSize: 40 }}>{now.score}</span><span className="muted">ATS score · was {orig.score}</span></div>
          <ul className="stack g4" style={{ margin: 0, padding: 0, listStyle: 'none' }}>
            {now.checks.map((c) => <li key={c.label} className="row g8 small" style={{ flexWrap: 'nowrap', alignItems: 'flex-start' }}><span aria-hidden="true" style={{ color: c.ok ? 'var(--success)' : 'var(--warning)', fontWeight: 700, width: 14 }}>{c.ok ? '✓' : '!'}</span><span><strong>{c.label}</strong>{!c.ok && <><br /><span className="xs muted">{c.tip}</span></>}</span></li>)}
          </ul>
          {now.match.keywords.length > 0 && (
            <div className="stack g8">
              <strong className="small">Job match · {now.match.found.length} of {now.match.keywords.length}</strong>
              <div className="row g4">{now.match.found.map((k) => <span key={k} className="badge b-success">✓ {k}</span>)}{now.match.missing.map((k) => <span key={k} className="badge b-danger">✗ {k}</span>)}</div>
              {now.match.missing.length > 0 && <span className="xs muted">Add missing ones only if the customer really has them (ask in Messages).</span>}
            </div>
          )}
          <div className="stack g8">
            <strong className="small">Quality checklist · needed to send</strong>
            {QA.map((q, i) => <label key={q} className="check small"><input type="checkbox" checked={ticks[i]} onChange={(e) => setTicks((t) => t.map((x, j) => (j === i ? e.target.checked : x)))} />{q}</label>)}
          </div>
        </Drawer>
      )}

      {drawer === 'send' && (
        <Drawer title="Send to the customer" onClose={() => setDrawer(null)}>
          {!allTicked && <div className="well small" style={{ color: 'var(--warning)' }}>Tick all 5 quality checks first (Checks). {ticks.filter(Boolean).length}/5 done. <button type="button" className="link-btn small" onClick={() => setDrawer('checks')}>Open checks</button></div>}
          {unresolved.length > 0 && <div className="well small">{unresolved.length} customer comment{unresolved.length > 1 ? 's' : ''} not marked fixed. <button type="button" className="link-btn small" onClick={() => setDrawer('messages')}>Review</button></div>}
          <div className="field"><label htmlFor="snote" className="label">Note to the customer</label><textarea id="snote" className="input" rows={3} value={note} onChange={(e) => setNote(e.target.value)} placeholder="e.g. I moved projects up and added numbers to every bullet. Check the summary." /></div>
          <span className="small muted">ATS {orig.score} → {now.score} · job match {now.match.found.length}/{now.match.keywords.length}</span>
          <div className="row g8">
            <button type="button" className="btn btn-ink" disabled={!allTicked || !d} onClick={() => send(false)}>Send draft {draftN}</button>
            <button type="button" className="btn btn-outline" disabled={!allTicked || !d || draftN === 1} onClick={() => send(true)} title={draftN === 1 ? 'Send at least one draft first' : ''}>Deliver final</button>
          </div>
          <span className="xs faint">Final = PDF + Word + saved into the customer’s own resume builder so they can keep editing. It auto-approves after 1–2 days.</span>
        </Drawer>
      )}

      {drawer === 'versions' && (
        <Drawer title="Versions & compare" onClose={() => setDrawer(null)}>
          {(o.versions || []).filter((v) => v.data).length === 0 && <span className="small muted">No drafts sent yet. Your work is saved as you type.</span>}
          {(o.versions || []).filter((v) => v.data).map((v) => (
            <div key={v.n} className="well row between g8"><span className="small"><strong>{v.label}</strong> · {new Date(v.at).toLocaleString('en-IN', { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' })}{v.note && <><br /><span className="xs muted">{v.note}</span></>}</span>
              <button type="button" className="btn btn-outline" style={{ minHeight: 34 }} onClick={() => { doReplace(v.data); toast(`Restored ${v.label}`); }}>Restore</button></div>
          ))}
          <div className="field"><label htmlFor="cmpv" className="label">Compare now with</label><select id="cmpv" className="input" style={{ height: 40 }} value={cmp} onChange={(e) => setCmp(e.target.value)}><option value="original">Customer’s original</option>{(o.versions || []).filter((v) => v.data).map((v) => <option key={v.n} value={v.n}>{v.label}</option>)}</select></div>
          {d && <Compare a={cmp === 'original' ? o.original : o.versions.find((v) => String(v.n) === String(cmp))?.data || o.original} b={d} aLabel={cmp === 'original' ? 'original' : `version ${cmp}`} bLabel="now" />}
        </Drawer>
      )}

      {drawer === 'messages' && (
        <Drawer title="Messages & comments" onClose={() => setDrawer(null)}>
          {(o.comments || []).length > 0 && (
            <div className="stack g8">
              <strong className="small">Comments on sections</strong>
              {o.comments.map((c) => (
                <div key={c.id} className="well stack g4" style={{ opacity: c.resolved ? 0.55 : 1 }}>
                  <span className="xs strong">{PRINTABLE[c.section] || c.section}</span><span className="small">{c.text}</span>
                  <span className="row g8"><button type="button" className="link-btn xs" onClick={() => { setFocus({ n: Date.now(), id: c.section }); setDrawer(null); }}>Go to section</button>
                    <button type="button" className="link-btn xs" onClick={() => updateOrder(o.id, (x) => ({ comments: x.comments.map((y) => (y.id === c.id ? { ...y, resolved: !y.resolved } : y)) }))}>{c.resolved ? 'Reopen' : 'Mark fixed ✓'}</button></span>
                </div>
              ))}
            </div>
          )}
          <strong className="small">Chat with {o.customer}</strong>
          <div className="stack g8">{(o.messages || []).map((m, i) => m.from === 'system' ? <span key={i} className="xs faint" style={{ alignSelf: 'center' }}>{m.text}</span> : <span key={i} className="small" style={{ alignSelf: m.from === 'expert' ? 'flex-end' : 'flex-start', maxWidth: '85%', background: m.from === 'expert' ? 'var(--ink)' : 'var(--sunken)', color: m.from === 'expert' ? 'var(--onink)' : 'var(--text)', borderRadius: 12, padding: '8px 12px' }}>{m.text}</span>)}</div>
          <div className="row g4">{quick.map((q) => <button key={q} type="button" className="chip" style={{ minHeight: 30, fontSize: 11 }} onClick={() => setMsg(q)}>{q.slice(0, 34)}…</button>)}</div>
          <form className="row g8" style={{ flexWrap: 'nowrap' }} onSubmit={(e) => { e.preventDefault(); if (!msg.trim()) return; updateOrder(o.id, (x) => ({ messages: [...(x.messages || []), { from: 'expert', text: msg.trim(), at: Date.now() }] })); setMsg(''); }}>
            <label htmlFor="wmsg" className="sr-only">Message</label><input id="wmsg" className="input" style={{ height: 42 }} value={msg} onChange={(e) => setMsg(e.target.value)} placeholder="Message the customer" />
            <button type="submit" className="btn btn-ink" disabled={!msg.trim()}>Send</button>
          </form>
          <span className="xs faint">Phone numbers and emails are hidden in chat — all contact stays on Nm7.</span>
        </Drawer>
      )}

      {drawer === 'snippets' && (
        <Drawer title="My snippets" onClose={() => setDrawer(null)}>
          <div className="row g4">{['', ...new Set(snippets.map((s) => s.role))].map((r) => <button key={r || 'all'} type="button" className="chip" aria-pressed={snipFilter === r} style={{ minHeight: 30, fontSize: 12 }} onClick={() => setSnipFilter(r)}>{r || 'All'}</button>)}</div>
          {snippets.filter((s) => !snipFilter || s.role === snipFilter).map((s) => (
            <div key={s.id} className="well stack g8">
              <span className="xs muted">{s.role} · {s.kind}</span><span className="small">{s.text}</span>
              <span className="row g8">
                {s.kind === 'Summary' && <button type="button" className="link-btn xs" onClick={() => { doReplace({ ...d, summary: s.text }); toast('Summary replaced — fill in the [brackets]'); }}>Use as summary</button>}
                {s.kind === 'Bullet' && (d?.exp || []).map((e, i) => <button key={`e${i}`} type="button" className="link-btn xs" onClick={() => { doReplace({ ...d, exp: d.exp.map((x, j) => (j === i ? { ...x, description: [x.description, s.text].filter(Boolean).join('\n') } : x)) }); toast('Added — fill in the [brackets]'); }}>+ {e.role || 'Experience'}</button>)}
                {s.kind === 'Bullet' && (d?.proj || []).map((p, i) => <button key={`p${i}`} type="button" className="link-btn xs" onClick={() => { doReplace({ ...d, proj: d.proj.map((x, j) => (j === i ? { ...x, description: [x.description, s.text].filter(Boolean).join('\n') } : x)) }); toast('Added — fill in the [brackets]'); }}>+ {p.title || 'Project'}</button>)}
              </span>
            </div>
          ))}
          <Link to="/expert/snippets" className="small">Manage snippets →</Link>
        </Drawer>
      )}

      {drawer === 'launch' && d && (
        <Drawer title="Career Launch extras" onClose={() => setDrawer(null)}>
          {(() => {
            const li = o.linkedin || linkedinFrom(d);
            const setLi = (patch) => updateOrder(o.id, () => ({ linkedin: { ...li, ...patch } }));
            return (
              <div className="stack g12">
                <strong className="small">LinkedIn makeover</strong>
                {[['headline', 'Headline', 2], ['about', 'About', 7], ['experience', 'Experience (top role)', 6]].map(([k, l, rows]) => (
                  <div key={k} className="field"><label htmlFor={`li-${k}`} className="label row between"><span>{l}</span>{k === 'headline' && <span className="faint">{li.headline.length}/220</span>}</label><textarea id={`li-${k}`} className="input" rows={rows} value={li[k]} onChange={(e) => setLi({ [k]: e.target.value })} /></div>
                ))}
                <button type="button" className="btn btn-ghost" style={{ alignSelf: 'flex-start' }} onClick={() => updateOrder(o.id, () => ({ linkedin: linkedinFrom(d) }))}>Re-write from the current resume</button>
                <span className="xs faint">Cover letter: use the builder’s “Cover letter” tab — it uses the same design.</span>
              </div>
            );
          })()}
          {o.plan === 'launch' && <div className="stack g8">
            <strong className="small">1:1 mentor call (30 min)</strong>
            {(o.call?.slots || ['', '', '']).map((sl, i) => (
              <div key={i} className="field"><label htmlFor={`sl${i}`} className="label">Slot {i + 1}</label><input id={`sl${i}`} className="input" type="datetime-local" style={{ height: 42 }} value={sl} onChange={(e) => updateOrder(o.id, (x) => { const slots = [...(x.call?.slots || ['', '', ''])]; slots[i] = e.target.value; return { call: { ...(x.call || {}), slots } }; })} /></div>
            ))}
            <button type="button" className="btn btn-outline" style={{ alignSelf: 'flex-start' }} disabled={!(o.call?.slots || []).some(Boolean)} onClick={() => { updateOrder(o.id, (x) => ({ call: { ...x.call, offered: true }, messages: [...(x.messages || []), { from: 'expert', text: 'I’ve shared times for our mentor call — pick one that works for you.', at: Date.now() }] })); toast('Times sent — the customer picks one and both get a meeting link'); }}>{o.call?.offered ? 'Update times' : 'Offer these times'}</button>
            {o.call?.offered && !o.call?.picked && <span className="xs muted">Waiting for the customer to pick a time.</span>}
            {o.call?.picked && <span className="badge b-success" style={{ alignSelf: 'flex-start' }}>Booked · {new Date(o.call.picked).toLocaleString('en-IN', { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' })}</span>}
          </div>}
        </Drawer>
      )}
    </>
  );
}
