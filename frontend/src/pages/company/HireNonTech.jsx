// Vetting Trust T6: the verified non-tech filters in Hire now and each person's non-tech facts, with where each comes
// from: a driving licence verified via DigiLocker (the classes: two-wheeler, LMV), and self-declared Work preferences
// (vehicle owned, shifts / night shifts, languages, joining now) and the distance from the job, only ever rounded
// ("~4 km", never a place). Shown only when the shortlist answer carries `nonTech` (the Trust switch lets the company
// in). Filters combine; the number next to each is how many people it would leave with the other filters as they are
// (the verified licence, night shifts and joining now always; the others once chosen). English only while it is tested.
// Vetting Trust T10: "Spoken English: B1 or above" (the band measured by the Nm7 voice interview), offered only when the
// answer says the job's role category has it (`englishFilter`: call centre, customer support, retail, sales, front
// office, BPO by default, Admin decides); each person's band and sub-scores as a chip; English "verified (B2)".
// Statically imported by CompanyHire (the company page chunk; no new lazy chunk).

export const NT_NONE = { licence: '', vehicle: '', nightShift: false, shift: '', maxKm: 0, lang: '', immediate: false, english: '' };
const BAND_UP = ['A2', 'B1', 'B2', 'C1', 'C2'];
const SUB = { pronunciation: 'pronunciation', fluency: 'fluency', grammar: 'grammar', comprehension: 'comprehension' };
const LANGS = ['English', 'Hindi', 'Telugu', 'Tamil', 'Kannada', 'Malayalam', 'Marathi', 'Bengali', 'Gujarati', 'Punjabi', 'Odia', 'Urdu', 'Assamese'];
const KMS = [2, 5, 10, 20, 50];
const VEH = { two_wheeler: 'two-wheeler', car: 'car', bicycle: 'bicycle' };

/** The query parameters for the non-tech filters (only the ones that are on). */
export function nonTechQuery(q, f) {
  if (f.licence) q.set('licence', f.licence);
  if (f.vehicle) q.set('vehicle', f.vehicle);
  if (f.nightShift) q.set('nightShift', 'true');
  if (f.shift) q.set('shift', f.shift);
  if (Number(f.maxKm) > 0) q.set('maxKm', String(f.maxKm));
  if (f.lang) q.set('lang', f.lang);
  if (f.immediate) q.set('immediate', 'true');
  if (f.english) q.set('english', f.english);
  return q;
}
export const ntOn = (f) => Object.keys(NT_NONE).some((k) => String(f[k]) !== String(NT_NONE[k]));
const n = (c) => (c == null ? '' : ` (${c})`);

export function NonTechFilters({ f, setF, counts = {}, english = false }) {
  const set = (k) => (e) => setF((x) => ({ ...x, [k]: e.target.type === 'checkbox' ? e.target.checked : e.target.value }));
  // a count is shown only once it was worked out for this filter's current choice (not the one before, while it reloads)
  const cnt = (k) => (counts.of && String(counts.of[k] ?? '') !== String(f[k] ?? '') ? null : counts[k]);
  return (
    <fieldset className="hn-sv hn-nt" data-testid="co-hire-nt-filters">
      <legend className="hn-sv-legend">Non-tech filters <span className="xs muted">· each shows where it comes from</span></legend>
      <label className="field hn-field"><span className="label">Driving licence ✓ verified{n(cnt('licence'))}</span>
        <select className="input" value={f.licence} onChange={set('licence')} data-testid="co-hire-nt-licence">
          <option value="">Any or none</option>
          <option value="any">Verified licence</option>
          <option value="two_wheeler">Two-wheeler (MCWG / MCWOG)</option>
          <option value="lmv">Car (LMV)</option>
        </select>
      </label>
      <label className="field hn-field"><span className="label">Vehicle owned · self-declared{n(f.vehicle ? cnt('vehicle') : null)}</span>
        <select className="input" value={f.vehicle} onChange={set('vehicle')} data-testid="co-hire-nt-vehicle">
          <option value="">Any or none</option>
          <option value="any">Has a vehicle</option>
          <option value="two_wheeler">Two-wheeler</option>
          <option value="car">Car</option>
          <option value="bicycle">Bicycle</option>
        </select>
      </label>
      <label className="field hn-field"><span className="label">Shift · self-declared{n(f.shift ? cnt('shift') : null)}</span>
        <select className="input" value={f.shift} onChange={set('shift')} data-testid="co-hire-nt-shift">
          <option value="">Any</option>
          <option value="day">Day</option>
          <option value="night">Night</option>
          <option value="rotational">Rotational</option>
        </select>
      </label>
      <label className="field hn-field"><span className="label">Distance from the job{n(Number(f.maxKm) > 0 ? cnt('maxKm') : null)}</span>
        <select className="input" value={f.maxKm} onChange={set('maxKm')} data-testid="co-hire-nt-km">
          <option value={0}>Any distance</option>
          {KMS.map((k) => <option key={k} value={k}>Within {k} km</option>)}
        </select>
      </label>
      <label className="field hn-field"><span className="label">Speaks · self-declared{n(cnt('lang'))}</span>
        <select className="input" value={f.lang} onChange={set('lang')} data-testid="co-hire-nt-lang">
          <option value="">Any language</option>
          {LANGS.map((l) => <option key={l} value={l}>{l}</option>)}
        </select>
      </label>
      {english && (
        <label className="field hn-field"><span className="label">Spoken English · measured by Nm7 voice interview{n(cnt('english'))}</span>
          <select className="input" value={f.english} onChange={set('english')} data-testid="co-hire-nt-english">
            <option value="">Any (or not measured)</option>
            {BAND_UP.map((b) => <option key={b} value={b}>Spoken English: {b} or above</option>)}
          </select>
        </label>
      )}
      <label className="hn-sv-only"><input type="checkbox" checked={f.nightShift} onChange={set('nightShift')} data-testid="co-hire-nt-night" /><span>Night shifts OK · self-declared{n(cnt('nightShift'))}</span></label>
      <label className="hn-sv-only"><input type="checkbox" checked={f.immediate} onChange={set('immediate')} data-testid="co-hire-nt-now" /><span>Can join now · self-declared{n(cnt('immediate'))}</span></label>
      {ntOn(f) && <button type="button" className="btn btn-outline hn-clear" onClick={() => setF(NT_NONE)} data-testid="co-hire-nt-clear">Clear non-tech filters</button>}
    </fieldset>
  );
}

/** One person's non-tech facts as chips, each with its source. */
export function NonTechChips({ nt }) {
  if (!nt) return null;
  const chips = [];
  if (nt.licence) chips.push(['ok', `✓ Driving licence${nt.licence.kinds.length ? ` (${nt.licence.kinds.join(', ')})` : ''} · verified via DigiLocker${nt.licence.test ? ' (test)' : ''}`, 'licence']);
  if (nt.vehicles) chips.push(['neutral', `${nt.vehicles.value.length ? `Owns a ${nt.vehicles.value.map((v) => VEH[v] || v).join(', ')}` : 'No vehicle'} · self-declared`, 'vehicle']);
  if (nt.shifts) chips.push(['neutral', `${nt.shifts.value.length ? `Shifts: ${nt.shifts.value.join(', ')}` : 'Shifts'}${nt.shifts.nightShift === true ? ' · night shifts OK' : nt.shifts.nightShift === false ? ' · no night shifts' : ''} · self-declared`, 'shifts']);
  if (nt.distance) chips.push(['info', `${nt.distance.text} from the job · self-declared`, 'distance']);
  if (nt.english) chips.push(['ok', `✓ Spoken English ${nt.english.band} (${nt.english.subs.filter((x) => x.measured).map((x) => `${SUB[x.key]} ${x.score}`).join(', ')}${nt.english.subs.some((x) => !x.measured) ? ', pronunciation not measured' : ''}) · ${nt.english.source}`, 'english']);
  if (nt.languages?.length) chips.push(['neutral', `Speaks ${nt.languages.map((l) => (l.label ? `${l.name} (${l.label})` : l.name)).join(', ')} · ${nt.languages.some((l) => l.source === 'verified') ? 'partly verified' : 'self-declared'}`, 'langs']);
  if (nt.immediate?.value) chips.push(['ok', 'Can join now · self-declared', 'now']);
  if (!chips.length) return null;
  return (
    <ul className="hn-chips" aria-label="Non-tech facts" data-testid="co-hire-nt">
      {chips.map(([tone, text, k]) => <li key={k} className={`mchip mchip-${tone}`} data-testid={`co-hire-nt-${k}`} style={{ whiteSpace: 'normal', overflowWrap: 'anywhere', maxWidth: '100%' }}>{text}</li>)}
    </ul>
  );
}
