// /demo/apply/:slug for the multi-step practice forms (practiceSystems.js): one made-up company's form that copies the
// structure of a kind of hiring system (step pages, field attributes, type-to-search lists, repeating blocks, a form
// inside a frame) so the Nm7 Apply helper can be tried on it. Next and Back only move between steps on this page,
// "Add another" adds a block, Submit says "Practice form: nothing was sent." Nothing is stored or sent (no request of
// any kind). Lazy-loaded with PracticeApply.jsx, never indexed.
import { useState } from 'react';
import { CITIES, COLLEGES, STEP_TEXT, SYSTEMS } from './practiceSystems';
import { SENT_TEXT, practiceSubmit } from './practiceForm';

const box = { width: '100%', boxSizing: 'border-box', padding: '10px 12px', font: 'inherit', border: '1px solid #9ca3af', borderRadius: 8, background: '#fff', color: '#111827' };
const btn = { minHeight: 44, padding: '10px 18px', font: 'inherit', fontWeight: 700, borderRadius: 8, cursor: 'pointer', border: '1px solid #1f2937', background: '#fff', color: '#111827' };
const LISTS = { cities: CITIES, colleges: COLLEGES };
const SKIP_ATTRS = new Set(['wrap', 'group', 'list']);

function attrsOf(a, i) {
  const out = {};
  for (const [k, v] of Object.entries(a || {})) if (!SKIP_ATTRS.has(k)) out[k] = typeof v === 'function' ? v(i) : v;
  return out;
}

function Combo({ id, label, attrs, list, labelCls, cls }) {
  const [text, setText] = useState('');
  const [open, setOpen] = useState(false);
  const shown = text.trim().length >= 2 ? LISTS[list].filter((x) => x.toLowerCase().includes(text.trim().toLowerCase())) : [];
  const lid = `${id}-list`;
  return (
    <div style={{ display: 'grid', gap: 4, position: 'relative' }}>
      <label htmlFor={id} className={labelCls} style={{ fontWeight: 600 }}>{label}</label>
      <input {...attrs} id={id} className={cls} type="text" role="combobox" aria-autocomplete="list" aria-expanded={open && shown.length > 0} aria-controls={lid}
        autoComplete="off" value={text} style={box}
        onChange={(e) => { setText(e.target.value); setOpen(true); }} onBlur={() => setTimeout(() => setOpen(false), 150)} />
      {open && shown.length > 0 && (
        <ul id={lid} role="listbox" style={{ listStyle: 'none', margin: 0, padding: 4, border: '1px solid #9ca3af', borderRadius: 8, background: '#fff' }}>
          {shown.map((x) => (
            <li key={x} role="option" aria-selected={false} style={{ padding: '8px 10px', cursor: 'pointer' }}
              onMouseDown={(e) => { e.preventDefault(); setText(x); setOpen(false); }}>{x}</li>
          ))}
        </ul>
      )}
    </div>
  );
}

function Field({ spec, i, uid, sys }) {
  const attrs = attrsOf(spec.a, i);
  const id = attrs.id || uid;
  const label = spec.a.group ? `${spec.a.group} ${spec.l}` : spec.l;
  const lab = <label htmlFor={id} className={sys.labelCls} style={{ fontWeight: 600 }}>{label}</label>;
  let control;
  if (spec.t === 'combo') control = <Combo id={id} label={label} attrs={attrs} list={spec.a.list} labelCls={sys.labelCls} cls={sys.cls} />;
  else if (spec.t === 'radio') {
    control = (
      <fieldset style={{ border: 0, padding: 0, margin: 0, display: 'grid', gap: 6 }}>
        <legend style={{ fontWeight: 600, marginBottom: 6 }}>{spec.l}</legend>
        {spec.o.map((o) => <label key={o} style={{ display: 'flex', gap: 8, alignItems: 'center' }}><input type="radio" name={attrs.name} value={o} /> {o}</label>)}
      </fieldset>
    );
  } else if (spec.t === 'checkbox') {
    control = <label style={{ display: 'flex', gap: 8, alignItems: 'center' }}><input {...attrs} id={id} type="checkbox" /> {spec.l}</label>;
  } else if (spec.t === 'select') {
    control = <>{lab}<select {...attrs} id={id} style={box} defaultValue="">{spec.o.map((o, n) => <option key={o} value={n === 0 ? '' : o}>{o}</option>)}</select></>;
  } else if (spec.t === 'textarea') {
    control = <>{lab}<textarea {...attrs} id={id} className={sys.cls} rows={4} style={box} /></>;
  } else {
    control = <>{lab}<input {...attrs} id={id} className={sys.cls} type={spec.t} style={box} accept={spec.t === 'file' ? 'application/pdf,.pdf' : undefined} /></>;
  }
  const Wrap = sys.wrapTag || 'div';
  const inner = spec.a.wrap ? <div data-automation-id={spec.a.wrap} style={{ display: 'grid', gap: 4 }}>{control}</div> : control;
  return <Wrap className={sys.questionCls} style={{ display: 'grid', gap: 4 }}>{inner}</Wrap>;
}

function Fields({ list, sys, prefix }) {
  return (list || []).map((spec, n) => <Field key={`${prefix}-${n}`} spec={spec} i={0} uid={`${prefix}-${n}`} sys={sys} />);
}

function Block({ block, count, sys, prefix, onAdd }) {
  return (
    <div style={{ display: 'grid', gap: 12 }}>
      {Array.from({ length: count }, (_, i) => (
        <fieldset key={i} {...attrsOf(block.attrs(i))} style={{ border: '1px solid #d1d5db', borderRadius: 8, padding: 12, display: 'grid', gap: 10 }}>
          <legend style={{ fontWeight: 700 }}>{block.head} {i + 1}</legend>
          {block.fields.map((spec, n) => <Field key={n} spec={spec} i={i} uid={`${prefix}-${i}-${n}`} sys={sys} />)}
        </fieldset>
      ))}
      <button type="button" onClick={onAdd} style={{ ...btn, justifySelf: 'start' }}>Add another</button>
    </div>
  );
}

export function SystemForm({ slug, start = 0 }) {
  const sys = SYSTEMS[slug];
  const [step, setStep] = useState(start);
  const [count, setCount] = useState({});
  const [said, setSaid] = useState('');
  const total = sys.steps.length;
  const s = sys.steps[step];
  const last = step === total - 1;
  const { className: rootCls, ...rootAttrs } = sys.root || {};
  const { className: headCls, ...headAttrs } = sys.headAttr || {};
  return (
    <form noValidate {...rootAttrs} className={rootCls} data-testid="practice-form" aria-label={`Apply for ${sys.title}`}
      onSubmit={(e) => practiceSubmit(e, () => setSaid(SENT_TEXT))} style={{ display: 'grid', gap: 14 }}>
      <p style={{ margin: 0, color: '#4b5563' }} data-testid="practice-progress">Step {step + 1} of {total}</p>
      <h2 {...headAttrs} className={headCls} style={{ fontSize: 22, margin: 0 }}>{s.title}</h2>
      <Fields list={s.fields} sys={sys} prefix={`${slug}-${step}`} />
      {(s.blocks || []).map((b) => (
        <div key={b.kind} style={{ display: 'grid', gap: 8 }}>
          <h3 style={{ margin: '8px 0 0', fontSize: 18 }}>{b.head}</h3>
          <Block block={b} count={count[`${step}-${b.kind}`] || 1} sys={sys} prefix={`${slug}-${step}-${b.kind}`}
            onAdd={() => setCount((c) => ({ ...c, [`${step}-${b.kind}`]: (c[`${step}-${b.kind}`] || 1) + 1 }))} />
        </div>
      ))}
      <Fields list={s.after} sys={sys} prefix={`${slug}-${step}-after`} />
      {/* keys: Next and Submit are different buttons, so React never turns the pressed Next into a Submit mid-click */}
      <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
        {step > 0 && <button type="button" style={btn} onClick={() => { setStep(step - 1); setSaid(''); }}>Back</button>}
        {last
          ? <button key="submit" type="submit" data-testid="practice-submit" style={{ ...btn, background: '#1d4ed8', color: '#fff', border: 0 }}>Submit application</button>
          : <button key="next" type="button" data-testid="practice-next" style={{ ...btn, background: '#1d4ed8', color: '#fff', border: 0 }}
            onClick={() => { setStep(step + 1); setSaid(STEP_TEXT(step + 1, total)); }}>{slug === 'classic-portal' ? 'Save and Continue' : 'Next'}</button>}
      </div>
      <p role="status" data-testid="practice-sent" style={said ? { margin: 0, padding: '10px 12px', borderRadius: 8, background: '#dcfce7', border: '1px solid #16a34a', fontWeight: 600 } : { margin: 0 }}>{said}</p>
    </form>
  );
}

export default function PracticeSystem({ slug, embed = false }) {
  const sys = SYSTEMS[slug];
  const note = (
    <p role="note" data-testid="practice-note" style={{ background: '#fef3c7', border: '1px solid #f59e0b', borderRadius: 8, padding: '10px 12px', margin: '0 0 20px', fontSize: 15 }}>
      Practice page for trying the Nm7 Apply helper. {sys.company} is a made-up company. Nothing you type here is sent or saved.
    </p>
  );
  if (embed) return <main id="main" style={{ padding: '12px 16px 40px', color: '#111827' }}><SystemForm slug={slug} /></main>;
  return (
    <main id="main" style={{ maxWidth: 680, margin: '0 auto', padding: '24px 16px 64px', color: '#111827', background: '#f9fafb' }}>
      {note}
      <header style={{ marginBottom: 16 }}>
        <p style={{ margin: 0, fontWeight: 700, letterSpacing: 0.3 }}>{sys.company}</p>
        <h1 style={{ fontSize: 26, margin: '4px 0' }}>Apply for {sys.title}</h1>
        <p style={{ margin: 0, color: '#4b5563' }}>{sys.place}</p>
      </header>
      {sys.framed
        ? (
          <>
            <p style={{ margin: '0 0 8px' }}>The application form opens in the box below (it comes from the hiring system).</p>
            <iframe id="portal_content_iframe" title={`Application form for ${sys.title}`} src={`/demo/apply/${slug}?embed=1`} style={{ width: '100%', height: 980, border: '1px solid #d1d5db', borderRadius: 8, background: '#fff' }} />
          </>
        )
        : <SystemForm slug={slug} />}
    </main>
  );
}
