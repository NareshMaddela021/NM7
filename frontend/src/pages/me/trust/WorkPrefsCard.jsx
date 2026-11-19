// Profile & settings -> Work preferences (Vetting Trust T6). Rendered by PrivacyConsent (same lazy chunk), so only for
// people who get Vetting Trust. GET/PUT /api/me/trust/work. Shifts, night shifts, weekends, vehicles, languages, notice
// period / available now, relocating: all self-declared. They answer the common screening questions for every job, so
// the apply form, Auto Apply and WhatsApp / AI calls never ask them again. The location pin needs its own consent; it
// is rounded to about 1 km before it is saved and companies only ever see the distance ("~4 km"). Also: the saved
// answers (forget one to be asked again) and the answers given to each company. English only while it is tested.
import { useCallback, useEffect, useState } from 'react';
import { useToast } from '../../../components/ui';
import { http } from '../../../services/http';
import { MeCard } from '../kit';
import { IcPin, IcTarget } from '../../../components/icons';

const SHIFTS = [['day', 'Day'], ['night', 'Night'], ['rotational', 'Rotational']];
const VEHICLES = [['two_wheeler', 'Two-wheeler'], ['car', 'Car'], ['bicycle', 'Bicycle']];
const ROW = { alignItems: 'center', minHeight: 44 };
const fmt = (v) => (v ? new Date(v).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' }) : '');
const toForm = (p) => ({ shifts: p.shifts || [], nightShift: p.nightShift, weekends: p.weekends, vehicles: p.vehicles, languages: p.languages || [],
  noticeDays: p.noticeDays ?? '', availableNow: p.availableNow, relocate: p.relocate });
const toggle = (list, v) => (list.includes(v) ? list.filter((x) => x !== v) : [...list, v]);

/** Yes / No / Not saying, as three radio buttons (null = not saying). */
function YesNo({ label, value, onChange, testid }) {
  return (
    <fieldset className="stack g4" style={{ border: 0, padding: 0, margin: 0 }} data-testid={testid}>
      <legend className="label">{label}</legend>
      <div className="row g12" style={{ flexWrap: 'wrap' }}>
        {[[true, 'Yes'], [false, 'No'], [null, 'Not saying']].map(([v, l]) => (
          <label key={l} className="row g4 small" style={ROW}><input type="radio" checked={value === v || (v === null && value == null)} onChange={() => onChange(v)} data-testid={`${testid}-${l === 'Not saying' ? 'none' : l.toLowerCase()}`} /> {l}</label>
        ))}
      </div>
    </fieldset>
  );
}

function Location({ d, onState, busy, setBusy }) {
  const toast = useToast();
  const [city, setCity] = useState('');
  const [err, setErr] = useState('');
  const loc = d.prefs.location;
  const run = async (fn) => { setBusy(true); setErr(''); try { onState(await fn()); } catch (x) { setErr(x.message); } finally { setBusy(false); } };
  const agree = () => run(async () => { await http('/api/me/trust/consents/location', { method: 'POST' }); window.dispatchEvent(new Event('trust-consent')); return http('/api/me/trust/work'); });
  const pin = () => {
    if (!navigator.geolocation) { setErr('This browser can’t share a location. Pick your city instead.'); return; }
    setBusy(true); setErr('');
    navigator.geolocation.getCurrentPosition(
      // rounded here too: the exact position never leaves the phone
      (p) => run(() => http('/api/me/trust/work/location', { method: 'PUT', body: { lat: Math.round(p.coords.latitude * 100) / 100, lng: Math.round(p.coords.longitude * 100) / 100 } })).then(() => toast('Location saved')),
      () => { setBusy(false); setErr('We couldn’t get your location. Pick your city instead.'); },
      { enableHighAccuracy: false, timeout: 10000, maximumAge: 600000 },
    );
  };
  return (
    <div className="stack g8" data-testid="wp-location">
      <h3 className="h4" style={{ margin: 0 }}>Distance to jobs</h3>
      {!d.locationConsent ? (
        <div className="stack g8" data-testid="wp-loc-consent">
          <p className="small" style={{ margin: 0 }}>{d.consentText}</p>
          <div><button type="button" className="btn btn-outline" style={{ minHeight: 44 }} disabled={busy} onClick={agree} data-testid="wp-loc-agree">I agree: use my location for distance</button></div>
        </div>
      ) : (
        <div className="stack g8">
          {loc ? <span className="small" data-testid="wp-loc-label"><IcPin size={14} /> {loc.label} · set {fmt(loc.at)}. Companies see only the distance, like “~4 km”.</span>
            : <span className="small muted">No location yet.</span>}
          <div className="row g8" style={{ flexWrap: 'wrap', alignItems: 'flex-end' }}>
            <button type="button" className="btn btn-outline" style={{ minHeight: 44 }} disabled={busy} onClick={pin} data-testid="wp-loc-pin">Use my location (rounded to ~1 km)</button>
            <label className="field stack g4" style={{ minWidth: 0, flex: '1 1 180px', maxWidth: 260 }}>
              <span className="label">Or pick your city</span>
              <select className="input" value={city} onChange={(e) => setCity(e.target.value)} style={{ minHeight: 44 }} data-testid="wp-loc-city">
                <option value="">Choose…</option>
                {d.cities.map((c) => <option key={c} value={c}>{c}</option>)}
              </select>
            </label>
            <button type="button" className="btn btn-outline" style={{ minHeight: 44 }} disabled={busy || !city} onClick={() => run(() => http('/api/me/trust/work/location', { method: 'PUT', body: { city } }))} data-testid="wp-loc-save-city">Save city</button>
            {loc && <button type="button" className="link-btn small" style={{ minHeight: 44 }} disabled={busy} onClick={() => run(() => http('/api/me/trust/work/location', { method: 'DELETE' }))} data-testid="wp-loc-remove">Remove my location</button>}
          </div>
          <span className="xs muted">To delete it for good, take back “Your location for distance to jobs” in Privacy & consent.</span>
        </div>
      )}
      {err && <p className="error" role="alert" style={{ margin: 0 }}>{err}</p>}
    </div>
  );
}

export default function WorkPrefsCard() {
  const toast = useToast();
  const [d, setD] = useState(null);
  const [f, setF] = useState(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const onState = useCallback((x) => { setD(x); setF(toForm(x.prefs)); }, []);
  const load = useCallback(() => http('/api/me/trust/work').then(onState, () => setD(null)), [onState]);
  useEffect(() => {
    load();
    window.addEventListener('trust-consent', load);
    return () => window.removeEventListener('trust-consent', load);
  }, [load]);
  if (!d || !f) return null;
  const set = (k) => (v) => setF((x) => ({ ...x, [k]: v }));
  const save = async (e) => {
    e.preventDefault();
    setBusy(true); setErr('');
    const notice = String(f.noticeDays).trim();
    try {
      onState(await http('/api/me/trust/work', { method: 'PUT', body: { ...f, noticeDays: f.availableNow ? 0 : notice === '' ? null : Number(notice) } }));
      toast('Saved');
    } catch (x) { setErr(x.message); } finally { setBusy(false); }
  };
  const forget = async (key) => { setBusy(true); try { onState(await http(`/api/me/trust/work/saved/${encodeURIComponent(key)}`, { method: 'DELETE' })); } catch (x) { setErr(x.message); } finally { setBusy(false); } };
  const noVehicle = Array.isArray(f.vehicles) && f.vehicles.length === 0;
  return (
    <MeCard as="section" id="s-work" className="acc-sec" label="Work preferences" icon={<IcTarget />} title="Work preferences" testid="wp-card"
      sub="Answer these once: we use them for the questions companies ask when you apply, in Auto Apply and on WhatsApp / AI calls, so you're never asked twice. Companies see them marked “self-declared”.">
      <form className="stack g12" onSubmit={save} aria-label="Work preferences">
        <fieldset className="stack g4" style={{ border: 0, padding: 0, margin: 0 }}>
          <legend className="label">Shifts that suit you</legend>
          <div className="row g12" style={{ flexWrap: 'wrap' }}>
            {SHIFTS.map(([k, l]) => <label key={k} className="row g4 small" style={ROW}><input type="checkbox" checked={f.shifts.includes(k)} onChange={() => set('shifts')(toggle(f.shifts, k))} data-testid={`wp-shift-${k}`} /> {l}</label>)}
          </div>
        </fieldset>
        <YesNo label="Willing to work night shifts?" value={f.nightShift} onChange={set('nightShift')} testid="wp-night" />
        <YesNo label="Can you work on weekends?" value={f.weekends} onChange={set('weekends')} testid="wp-weekends" />
        <fieldset className="stack g4" style={{ border: 0, padding: 0, margin: 0 }}>
          <legend className="label">Vehicles you own</legend>
          <div className="row g12" style={{ flexWrap: 'wrap' }}>
            {VEHICLES.map(([k, l]) => <label key={k} className="row g4 small" style={ROW}><input type="checkbox" checked={(f.vehicles || []).includes(k)} onChange={() => set('vehicles')(toggle(f.vehicles || [], k))} data-testid={`wp-vehicle-${k}`} /> {l}</label>)}
            <label className="row g4 small" style={ROW}><input type="checkbox" checked={noVehicle} onChange={() => set('vehicles')(noVehicle ? null : [])} data-testid="wp-vehicle-none" /> None</label>
          </div>
          <span className="xs muted">A driving licence shows as “verified” when you add it with DigiLocker (Documents, below).</span>
        </fieldset>
        <fieldset className="stack g4" style={{ border: 0, padding: 0, margin: 0 }}>
          <legend className="label">Languages you speak</legend>
          <div className="row g8" style={{ flexWrap: 'wrap' }}>
            {d.languages.map((l) => (
              <label key={l} className={`mchip ${f.languages.includes(l) ? 'mchip-accent' : 'mchip-neutral'}`} style={{ minHeight: 44, display: 'inline-flex', alignItems: 'center', gap: 6, cursor: 'pointer' }}>
                <input type="checkbox" checked={f.languages.includes(l)} onChange={() => set('languages')(toggle(f.languages, l))} data-testid={`wp-lang-${l}`} />{l}{d.verified?.[l] && <span className="xs" data-testid={`wp-verified-${l}`}> · {d.verified[l].label}</span>}
              </label>
            ))}
          </div>
          {d.verified?.English && <span className="xs muted" data-testid="wp-verified-note">English {d.verified.English.label}: {d.verified.English.source.toLowerCase()}. Companies see it as verified.</span>}
        </fieldset>
        <div className="row g12" style={{ flexWrap: 'wrap', alignItems: 'flex-end' }}>
          <label className="row g8 small" style={ROW}><input type="checkbox" checked={!!f.availableNow} onChange={(e) => set('availableNow')(e.target.checked)} data-testid="wp-now" /> I can join now (no notice period)</label>
          {!f.availableNow && <label className="field stack g4" style={{ maxWidth: 200 }}>
            <span className="label">Notice period (days)</span>
            <input className="input" inputMode="numeric" maxLength={3} value={f.noticeDays} onChange={(e) => set('noticeDays')(e.target.value.replace(/[^\d]/g, ''))} style={{ minHeight: 44 }} data-testid="wp-notice" />
          </label>}
        </div>
        <YesNo label="Willing to relocate for a job?" value={f.relocate} onChange={set('relocate')} testid="wp-relocate" />
        {err && <p className="error" role="alert" style={{ margin: 0 }}>{err}</p>}
        <div><button type="submit" className="btn btn-signal" style={{ minHeight: 44 }} disabled={busy} data-testid="wp-save">Save</button></div>
      </form>
      <Location d={d} onState={onState} busy={busy} setBusy={setBusy} />
      <details className="stack g8" data-testid="wp-saved">
        <summary className="small"><strong>Saved answers</strong> <span className="xs muted">({d.saved.length})</span></summary>
        <span className="xs muted">Used for the same question in every job. Forget one and you’ll be asked again next time.</span>
        {d.saved.length === 0 ? <p className="small muted" style={{ margin: 0 }}>Nothing saved yet.</p> : (
          <ul className="stack g4" style={{ listStyle: 'none', padding: 0, margin: 0 }}>
            {d.saved.map((s) => (
              <li key={s.key} className="row g8" style={{ flexWrap: 'wrap', alignItems: 'center', minWidth: 0 }} data-testid="wp-saved-item">
                <span className="small" style={{ flex: '1 1 220px', minWidth: 0, overflowWrap: 'anywhere' }}>{s.question} <strong>{String(s.answer)}</strong></span>
                <button type="button" className="link-btn small" style={{ minHeight: 44 }} disabled={busy} onClick={() => forget(s.key)}>Forget</button>
              </li>
            ))}
          </ul>
        )}
      </details>
      <details className="stack g8" data-testid="wp-answers">
        <summary className="small"><strong>Your answers to companies</strong> <span className="xs muted">({d.answers.length})</span></summary>
        {d.answers.length === 0 ? <p className="small muted" style={{ margin: 0 }}>None yet.</p> : d.answers.map((a, i) => (
          <div key={i} className="stack g4" style={{ minWidth: 0 }} data-testid="wp-answer">
            <span className="small"><strong>{a.role}</strong>{a.company ? ` · ${a.company}` : ''} <span className="xs muted">· {fmt(a.at)}{a.via !== 'you' ? ` · by ${a.via === 'auto' ? 'Auto Apply' : 'WhatsApp / call'}` : ''}</span></span>
            <dl className="xs" style={{ margin: 0, display: 'grid', gap: 2 }}>{a.items.map((x, k) => <div key={k} style={{ overflowWrap: 'anywhere' }}><dt style={{ display: 'inline' }}>{x.q} </dt><dd style={{ display: 'inline', margin: 0, fontWeight: 600 }}>{String(x.a)}</dd></div>)}</dl>
          </div>
        ))}
      </details>
    </MeCard>
  );
}
