// "Snap photos": pick photos → (consent for ID cards) → read on the server → review in big, simple text →
// "Looks right" hands the kept items to `onDone(review)`. Nothing is saved before that.
import { useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { Spinner } from '../../components/ui';
import { currentUser } from '../../lib/auth';
import { ID_FIELDS, MAX_PHOTOS, isEmptyReview, preparePhoto, readPhotos, toReview } from '../../lib/photoImport';

const HELPS = ['Aadhaar card — front and back', 'PAN card, voter ID or driving licence', 'Experience letters or salary slips', 'Company ID card', 'ITI or training certificates', 'Marksheets (any class)', 'A handwritten note about your work', 'An old resume'];
const CONSENT = 'I agree Nm7 reads my name, address and date of birth from this card. The ID number is not saved.';
const big = { fontSize: 17, lineHeight: 1.5 };

export default function PhotoImport({ onDone, onBack, doneLabel = 'Looks right', title = 'Snap photos of your papers', embedded = false }) {
  const Wrap = embedded ? 'section' : 'main'; // inside the dashboard there is already a <main>
  const pad = embedded ? { padding: 0 } : null;
  const [photos, setPhotos] = useState([]); // { key, name, url, data, isId, error }
  const [consent, setConsent] = useState(false);
  const [askId, setAskId] = useState(false); // the reader found an ID card we weren't told about
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [review, setReview] = useState(null);
  const cam = useRef(); const gal = useRef();
  const customer = currentUser()?.role === 'customer';
  const ready = photos.filter((p) => p.data);
  const needsConsent = askId || ready.some((p) => p.isId);

  const add = async (files) => {
    setError('');
    const list = [...files].slice(0, MAX_PHOTOS - photos.length);
    if (files.length > list.length) setError(`You can add up to ${MAX_PHOTOS} photos.`);
    const done = await Promise.all(list.map(preparePhoto));
    setPhotos((ps) => [...ps, ...done.map((p, i) => ({ ...p, key: `${Date.now()}-${i}`, isId: false }))].slice(0, MAX_PHOTOS));
  };
  const set = (key, patch) => setPhotos((ps) => ps.map((p) => (p.key === key ? { ...p, ...patch } : p)));
  const read = async () => {
    if (!ready.length || busy || (needsConsent && !consent)) return;
    setBusy(true); setError('');
    try {
      const res = await readPhotos(ready, consent);
      setReview({ ...toReview(res), sent: ready });
    } catch (e) {
      if (e.code === 'id_consent_required') {
        const idx = new Set(e.photos || []);
        setPhotos((ps) => { let i = -1; return ps.map((p) => { if (!p.data) return p; i += 1; return idx.has(i) ? { ...p, isId: true } : p; }); });
        setAskId(true);
        setError('One of these photos looks like an ID card. Please tick the box below to let Nm7 read it.');
      } else setError(e.message || 'We couldn’t read the photos. Please try again.');
    } finally { setBusy(false); }
  };

  if (!customer) {
    return (
      <Wrap className="container stack g16" style={{ maxWidth: 720, padding: '48px 20px', ...pad }}>
        <h1 className="display" style={{ fontSize: 34 }}>{title}</h1>
        <p style={big}>Sign in first — your photos are read safely for your own account, and nothing is shared.</p>
        <div className="row g8"><Link className="btn btn-ink btn-lg" to="/login?next=/builder">Sign in</Link><Link className="btn btn-outline btn-lg" to="/signup?next=/builder">Create a free account</Link>{onBack && <button type="button" className="btn btn-ghost" onClick={onBack}>Back</button>}</div>
      </Wrap>
    );
  }

  if (review) return <Review review={review} setReview={setReview} onBack={() => setReview(null)} onDone={onDone} doneLabel={doneLabel} Wrap={Wrap} pad={pad} />;

  return (
    <Wrap className="container stack g20" style={{ maxWidth: 820, padding: '40px 20px 64px', ...pad }} aria-labelledby="ph-h">
      <div className="stack g8">
        <h1 id="ph-h" className="display" style={{ fontSize: 'clamp(28px,5vw,40px)' }}>{title}</h1>
        <p style={big}>Take photos of your Aadhaar, work papers or a handwritten note. We’ll read them and fill your resume. You check everything before it’s saved.</p>
      </div>
      <section className="well stack g8" aria-label="What helps">
        <strong>What helps (up to {MAX_PHOTOS} photos)</strong>
        <ul className="stack g4" style={{ margin: 0, paddingLeft: 20, ...big, fontSize: 16 }}>{HELPS.map((h) => <li key={h}>{h}</li>)}</ul>
        <span className="small muted">Hold the phone straight, in good light, so all the writing is in the photo. Any language is fine.</span>
      </section>
      <div className="row g8">
        <button type="button" className="btn btn-ink btn-lg" disabled={photos.length >= MAX_PHOTOS || busy} onClick={() => cam.current?.click()}>Take photo</button>
        <button type="button" className="btn btn-outline btn-lg" disabled={photos.length >= MAX_PHOTOS || busy} onClick={() => gal.current?.click()}>Choose from gallery</button>
        <input ref={cam} type="file" accept="image/*" capture="environment" className="sr-only" aria-label="Take photo" tabIndex={-1} onChange={(e) => { add(e.target.files || []); e.target.value = ''; }} />
        <input ref={gal} type="file" multiple accept="image/jpeg,image/png,image/webp,image/heic,image/heif,.heic,.heif" className="sr-only" aria-label="Choose photos from gallery" tabIndex={-1} onChange={(e) => { add(e.target.files || []); e.target.value = ''; }} />
      </div>
      {photos.length > 0 && (
        <ol className="grid-auto g12" style={{ listStyle: 'none', padding: 0, margin: 0, '--min': '200px' }} aria-label="Your photos">
          {photos.map((p, i) => (
            <li key={p.key} className="card stack g8" style={{ padding: 12 }}>
              {p.url ? <img src={p.url} alt={`Photo ${i + 1}`} style={{ width: '100%', height: 160, objectFit: 'cover', borderRadius: 8, background: 'var(--sunken)' }} /> : null}
              <strong className="small">Photo {i + 1}</strong>
              {p.error ? <span role="alert" className="error">{p.error}</span> : (
                <label className="check small" style={{ alignItems: 'flex-start' }}><input type="checkbox" checked={p.isId} onChange={(e) => set(p.key, { isId: e.target.checked })} />This is an ID card (Aadhaar, PAN, voter ID, licence)</label>
              )}
              <button type="button" className="btn btn-ghost" style={{ alignSelf: 'flex-start', color: 'var(--danger)' }} onClick={() => setPhotos((ps) => ps.filter((x) => x.key !== p.key))}>Remove photo {i + 1}</button>
            </li>
          ))}
        </ol>
      )}
      {needsConsent && (
        <label className="well check" style={{ ...big, alignItems: 'flex-start', padding: 14, border: '2px solid var(--ink)' }}>
          <input type="checkbox" required checked={consent} onChange={(e) => setConsent(e.target.checked)} style={{ width: 22, height: 22 }} />
          <span>{CONSENT}</span>
        </label>
      )}
      {error && <p role="alert" className="error" style={{ ...big, margin: 0 }}>{error}</p>}
      <div className="row g8">
        <button type="button" className="btn btn-signal btn-lg" disabled={!ready.length || busy || (needsConsent && !consent)} onClick={read}>
          {busy ? <><Spinner /> Reading your photos…</> : `Read my ${ready.length === 1 ? 'photo' : 'photos'}`}
        </button>
        {onBack && <button type="button" className="btn btn-ghost" onClick={onBack}>Back</button>}
      </div>
      {busy && <span className="small muted" role="status">This can take up to a minute. Keep this page open.</span>}
    </Wrap>
  );
}

function KeepButton({ item, label, onToggle }) {
  return <button type="button" className="btn btn-ghost" style={{ minHeight: 40, color: item.keep ? 'var(--danger)' : undefined }} aria-label={`${item.keep ? 'Remove' : 'Keep'} ${label}`} onClick={onToggle}>{item.keep ? 'Remove' : 'Keep'}</button>;
}
const Check = ({ on }) => (on ? <span className="badge b-warning" style={{ fontSize: 12 }}>Please check</span> : null);

/** The review screen: everything editable, each item can be removed, unsure items marked "Please check". */
function Review({ review: r, setReview, onBack, onDone, doneLabel, Wrap, pad }) {
  const upd = (list, id, patch) => setReview({ ...r, [list]: r[list].map((x) => (x.id === id || x.key === id ? { ...x, ...patch } : x)) });
  const unread = r.photos.filter((p) => p.readable === false);
  const nothing = isEmptyReview(r);
  const textList = (list, title, label) => r[list].length > 0 && (
    <section className="card stack g12" aria-labelledby={`rv-${list}`}>
      <h2 id={`rv-${list}`} style={{ fontSize: 22 }}>{title}</h2>
      {r[list].map((x, i) => (
        <div key={x.id} className="row g8" style={{ alignItems: 'center', opacity: x.keep ? 1 : 0.5 }}>
          <input className="input" aria-label={`${label} ${i + 1}`} style={{ ...big, flex: '1 1 220px', height: 46, textDecoration: x.keep ? 'none' : 'line-through' }} value={x.text} onChange={(e) => upd(list, x.id, { text: e.target.value })} disabled={!x.keep} />
          <Check on={x.check} />
          <KeepButton item={x} label={`${label} ${i + 1}`} onToggle={() => upd(list, x.id, { keep: !x.keep })} />
        </div>
      ))}
    </section>
  );
  return (
    <Wrap className="container stack g20" style={{ maxWidth: 820, padding: '40px 20px 64px', ...pad }} aria-labelledby="rv-h">
      <div className="stack g8">
        <h1 id="rv-h" className="display" style={{ fontSize: 'clamp(28px,5vw,40px)' }}>Check what we read</h1>
        <p style={big}>Change anything that’s wrong. Remove what you don’t want. Nothing is saved until you press “{doneLabel}”.</p>
      </div>
      {unread.map((p) => (
        <div key={p.index} role="alert" className="well row between g8" style={{ ...big, borderLeft: '4px solid var(--danger)' }}>
          <span>We couldn’t read photo {p.index + 1} - try again in better light.</span>
          <button type="button" className="btn btn-outline" onClick={onBack}>Take it again</button>
        </div>
      ))}
      {nothing && <p className="well" role="status" style={big}>We didn’t find any resume details in these photos. Try clearer photos, or a handwritten note about your work.</p>}

      {r.about.length > 0 && (
        <section className="card stack g12" aria-labelledby="rv-about">
          <h2 id="rv-about" style={{ fontSize: 22 }}>About you</h2>
          {r.about.map((x) => (
            <div key={x.key} className="stack g4" style={{ opacity: x.keep ? 1 : 0.5 }}>
              <span className="row g8"><label htmlFor={`rv-a-${x.key}`} className="label">{x.label}</label><Check on={x.check} /></span>
              <div className="row g8"><input id={`rv-a-${x.key}`} className="input" style={{ ...big, flex: '1 1 220px', height: 46 }} value={x.value} disabled={!x.keep} onChange={(e) => upd('about', x.key, { value: e.target.value })} />
                <KeepButton item={x} label={x.label} onToggle={() => upd('about', x.key, { keep: !x.keep })} /></div>
            </div>
          ))}
        </section>
      )}

      {r.fromId.length > 0 && (
        <section className="card stack g12" aria-labelledby="rv-id" style={{ border: '2px solid var(--ink)' }}>
          <h2 id="rv-id" style={{ fontSize: 22 }}>From your ID</h2>
          <span className="small muted">The ID number is never read or saved. Details switched off are kept in “Personal Information”, which is not printed on your resume unless you switch it on.</span>
          {r.fromId.map((x) => (
            <div key={x.key} className="stack g4" style={{ opacity: x.keep ? 1 : 0.5 }}>
              <span className="row g8"><label htmlFor={`rv-id-${x.key}`} className="label">{x.label}</label><Check on={x.check} /></span>
              <div className="row g8" style={{ alignItems: 'center' }}>
                <input id={`rv-id-${x.key}`} className="input" style={{ ...big, flex: '1 1 220px', height: 46 }} value={x.value} disabled={!x.keep} onChange={(e) => upd('fromId', x.key, { value: e.target.value })} />
                <label className="row g4 small" style={{ minHeight: 40 }}><input type="checkbox" role="switch" checked={x.show} disabled={!x.keep} onChange={(e) => upd('fromId', x.key, { show: e.target.checked })} aria-label={`Show ${x.label} on resume`} />Show on resume</label>
                <KeepButton item={x} label={x.label} onToggle={() => upd('fromId', x.key, { keep: !x.keep })} />
              </div>
            </div>
          ))}
        </section>
      )}

      {r.experience.length > 0 && (
        <section className="card stack g16" aria-labelledby="rv-exp">
          <h2 id="rv-exp" style={{ fontSize: 22 }}>Work</h2>
          {r.experience.map((e, i) => (
            <div key={e.id} className="well stack g8" style={{ opacity: e.keep ? 1 : 0.5 }}>
              <span className="row between g8"><strong style={big}>Job {i + 1}</strong><span className="row g8"><Check on={e.check} /><KeepButton item={e} label={`Job ${i + 1}`} onToggle={() => upd('experience', e.id, { keep: !e.keep })} /></span></span>
              <div className="row g8">
                <input className="input" aria-label={`Job ${i + 1} title`} placeholder="Job title" style={{ ...big, flex: '1 1 200px', height: 46 }} value={e.role} disabled={!e.keep} onChange={(ev) => upd('experience', e.id, { role: ev.target.value })} />
                <input className="input" aria-label={`Job ${i + 1} company`} placeholder="Company / employer" style={{ ...big, flex: '1 1 200px', height: 46 }} value={e.company} disabled={!e.keep} onChange={(ev) => upd('experience', e.id, { company: ev.target.value })} />
              </div>
              <div className="row g8">
                <input className="input" aria-label={`Job ${i + 1} from`} placeholder="From (year)" style={{ ...big, flex: '1 1 120px', height: 46 }} value={e.from} disabled={!e.keep} onChange={(ev) => upd('experience', e.id, { from: ev.target.value })} />
                <input className="input" aria-label={`Job ${i + 1} to`} placeholder="To (or Present)" style={{ ...big, flex: '1 1 120px', height: 46 }} value={e.to} disabled={!e.keep} onChange={(ev) => upd('experience', e.id, { to: ev.target.value })} />
              </div>
              <textarea className="input" aria-label={`Job ${i + 1} what you did`} rows={3} style={big} value={e.text} disabled={!e.keep} onChange={(ev) => upd('experience', e.id, { text: ev.target.value })} />
            </div>
          ))}
        </section>
      )}
      {textList('skills', 'Skills and licences', 'Skill')}
      {textList('certifications', 'Certificates', 'Certificate')}
      {textList('education', 'Education', 'Education')}
      {textList('languages', 'Languages', 'Language')}

      <div className="row g8">
        <button type="button" className="btn btn-ink btn-lg" disabled={nothing} onClick={() => onDone(r)}>{doneLabel}</button>
        <button type="button" className="btn btn-outline btn-lg" onClick={onBack}>Back to photos</button>
      </div>
    </Wrap>
  );
}

export { ID_FIELDS };
