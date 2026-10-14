// The builder's links to the customer's Job Profile (only shown when the profile is available):
//   FillFromProfile — "Fill from profile": pick entries for this section; if it already has content, Add or Replace.
//   ProfileHint     — "From profile: …" under an empty field; one click fills it.
//   SaveToProfile   — after editing an entry: "Save this change to my Job Profile".
//   ProfileUpdates  — "Your profile has N updates — review": accept or skip each.
import { useState } from 'react';
import { Dialog, useToast } from '../../components/ui';
import { setJobProfile } from '../../lib/profileStore';
import { applyUpdate, entryChanged, entryLabel, saveEntryToProfile, sourcesFor, toResumeEntry } from '../../lib/jobProfile';
import { splitList, splitSkills } from './schema';
import { lineItems, linesPatch } from './entries';

const lc = (s) => (s || '').toString().trim().toLowerCase();
const EXTRA_RE = /extra|activit|volunt|club|responsib/i;
/** Which profile part feeds a builder section (null = none). */
export function profileSectionOf(id, d) {
  if (['exp', 'proj', 'edu', 'certs', 'ach', 'langs', 'skills', 'hobbies', 'strengths', 'summary'].includes(id)) return id;
  if (id?.startsWith('c_') && EXTRA_RE.test((d.custom || []).find((c) => c.id === id)?.title || '')) return 'extra';
  return null;
}
/** The profile list a resume entry belongs to when saved back. */
const profileListOf = (id) => (id.startsWith('c_') ? 'extra' : id);
const META = new Set(['pid', 'pv', 'pu', 'off', 'id', 'links', 'current', 'ongoing', 'noExpiry', 'employmentType', 'nationality']);
const hasText = (x) => Object.entries(x || {}).some(([k, v]) => !META.has(k) && typeof v === 'string' && v.trim());
const fingerprint = (x) => lc(entryLabel(x));

function choices(section, p) {
  if (section === 'hobbies' || section === 'strengths') return splitList(p[section]).map((t) => ({ key: t, label: t, value: t }));
  if (section === 'summary') return p.summaries.filter((s) => s.text.trim()).map((s) => ({ key: s.id, label: s.name || 'Summary', sub: s.text, value: s.text }));
  return sourcesFor(p, section).map((src) => {
    const e = toResumeEntry(src);
    return { key: src.x.pid, label: section === 'skills' ? `${src.x.label || 'Skills'}: ${src.x.value}` : entryLabel(e), sub: src.list === 'intern' ? 'Internship' : '', value: e };
  });
}
function current(section, d, id) {
  if (section === 'hobbies' || section === 'strengths') return splitList(d[section]);
  if (section === 'summary') return d.summary?.trim() ? [d.summary] : [];
  if (section === 'skills') return (d.skillGroups || []).filter((g) => g.value?.trim());
  if (section === 'extra') return ((d.custom || []).find((c) => c.id === id)?.items || []).filter(hasText);
  return (d[section] || []).filter(hasText);
}
/** The resume data with the chosen profile entries added to (or replacing) one section. */
export function fillSection(d, id, section, picked, mode) {
  const out = structuredClone(d);
  if (section === 'hobbies' || section === 'strengths') {
    const keep = mode === 'add' ? lineItems(d, section) : [];
    const have = new Set(keep.map((x) => lc(x.text)));
    return { ...out, ...linesPatch(d, section, [...keep, ...picked.filter((t) => !have.has(lc(t))).map((text) => ({ text, off: false }))]), hidden: { ...out.hidden, [section]: false } };
  }
  if (section === 'summary') {
    const text = picked[0] || '';
    out.summary = mode === 'add' && d.summary?.trim() ? `${d.summary.trim()}\n\n${text}` : text;
    return out;
  }
  if (section === 'skills') {
    if (mode === 'replace') { out.skillGroups = picked.map((g) => ({ ...g })); return out; }
    picked.forEach((g) => {
      const items = splitSkills(g.value);
      const target = out.skillGroups.find((x) => x.id === g.id) || out.skillGroups.find((x) => lc(x.label) === lc(g.label));
      if (!target) { out.skillGroups.push({ ...g }); return; }
      const known = new Set(out.skillGroups.flatMap((x) => splitSkills(x.value).map(lc)));
      const fresh = items.filter((s) => !known.has(lc(s)));
      if (fresh.length) target.value = [...splitSkills(target.value), ...fresh].join(', ');
      if (!target.pid && !(target.value || '').trim()) Object.assign(target, { pid: g.pid, pv: g.pv });
    });
    return out;
  }
  const merge = (list) => {
    if (mode === 'replace') return picked.map((x) => ({ ...x }));
    const kept = (list || []).filter(hasText); // empty placeholder cards go
    const seen = new Set(kept.flatMap((x) => [x.pid, fingerprint(x)]).filter(Boolean));
    return [...kept, ...picked.filter((x) => !seen.has(x.pid) && !seen.has(fingerprint(x))).map((x) => ({ ...x }))];
  };
  if (section === 'extra') out.custom = out.custom.map((c) => (c.id === id ? { ...c, items: merge(c.items) } : c));
  else out[section] = merge(out[section]);
  return out;
}

export function FillFromProfile({ id, label, d, setD, profile }) {
  const toast = useToast();
  const section = profileSectionOf(id, d);
  const [open, setOpen] = useState(false);
  const [sel, setSel] = useState({});
  const [mode, setMode] = useState('add');
  if (!section || !profile) return null;
  const opts = choices(section, profile);
  const has = current(section, d, id).length > 0;
  const single = section === 'summary';
  const start = () => {
    const inResume = new Set(current(section, d, id).flatMap((x) => (typeof x === 'string' ? [lc(x)] : [x.pid, fingerprint(x)])).filter(Boolean));
    setSel(Object.fromEntries(opts.map((o, i) => [o.key, single ? i === 0 : !(typeof o.value === 'string' ? inResume.has(lc(o.value)) : inResume.has(o.key) || inResume.has(fingerprint(o.value)))])));
    setMode('add'); setOpen(true);
  };
  const picked = opts.filter((o) => sel[o.key]).map((o) => o.value);
  const apply = () => {
    setD(fillSection(d, id, section, picked, has ? mode : 'replace'));
    setOpen(false);
    toast(`${has && mode === 'replace' ? 'Replaced' : 'Added'} ${picked.length} from your Job Profile`);
  };
  return (
    <>
      <button type="button" className="btn btn-outline" onClick={start}>Fill from profile</button>
      {open && (
        <Dialog showTitle title={`Fill ${label} from my Job Profile`} onClose={() => setOpen(false)}>
          {opts.length === 0 ? (
            <span className="small muted">Your Job Profile has nothing for {label} yet. Add it on the Job Profile page and it’s here for every resume.</span>
          ) : (
            <fieldset className="stack g8" style={{ border: 0, padding: 0, margin: 0 }}>
              <legend className="small muted" style={{ marginBottom: 6 }}>{single ? 'Choose one' : 'Choose what to put on this resume'}</legend>
              {opts.map((o) => (
                <label key={o.key} className="check small" style={{ alignItems: 'flex-start', minHeight: 36 }}>
                  <input type={single ? 'radio' : 'checkbox'} name="pf-pick" checked={!!sel[o.key]} onChange={(e) => setSel(single ? { [o.key]: true } : { ...sel, [o.key]: e.target.checked })} />
                  <span className="stack"><span>{o.label}</span>{o.sub && <span className="xs faint" style={{ whiteSpace: 'pre-wrap' }}>{o.sub.length > 160 ? `${o.sub.slice(0, 160)}…` : o.sub}</span>}</span>
                </label>
              ))}
            </fieldset>
          )}
          {opts.length > 0 && has && (
            <fieldset className="stack g4 well" style={{ padding: 12, margin: 0 }}>
              <legend className="small strong">{label} already has content on this resume</legend>
              <label className="check small"><input type="radio" name="pf-mode" checked={mode === 'add'} onChange={() => setMode('add')} />Add to it (keep what’s there)</label>
              <label className="check small"><input type="radio" name="pf-mode" checked={mode === 'replace'} onChange={() => setMode('replace')} />Replace it with these</label>
            </fieldset>
          )}
          <div className="row g8">
            <button type="button" className="btn btn-outline" onClick={() => setOpen(false)}>Cancel</button>
            {opts.length > 0 && <button type="button" className="btn btn-ink" disabled={!picked.length} onClick={apply}>{has && mode === 'replace' ? `Replace with ${picked.length}` : `Add ${picked.length}`}</button>}
          </div>
        </Dialog>
      )}
    </>
  );
}

/** Under an empty field: "From profile: Pune" — click to use it. */
export function ProfileHint({ value, current: cur, onUse, label }) {
  if (!value || (cur && String(cur).trim())) return null;
  return (
    <button type="button" className="link-btn xs" style={{ alignSelf: 'flex-start', minHeight: 24, textAlign: 'left' }} aria-label={`Use ${label} from my Job Profile: ${value}`} onClick={() => onUse(value)}>
      From profile: <strong>{value.length > 80 ? `${value.slice(0, 80)}…` : value}</strong>
    </button>
  );
}

/** "Save this change to my Job Profile" for an edited resume entry. onSaved(pid, pu) marks the resume copy as in step. */
export function SaveToProfile({ entry, section, profile, onSaved }) {
  const toast = useToast();
  if (!profile || !hasText(entry) || !entryChanged(profile, entry)) return null;
  const isNew = !entry.pid;
  const save = () => {
    const r = saveEntryToProfile(profile, entry, profileListOf(section));
    setJobProfile(r.profile);
    onSaved(r.pid, r.pu);
    toast(isNew ? 'Added to your Job Profile' : 'Saved to your Job Profile');
  };
  return (
    <button type="button" className="btn btn-ghost" style={{ alignSelf: 'flex-start', minHeight: 32, fontSize: 13 }} onClick={save}>
      {entry.pid ? 'Save this change to my Job Profile' : 'Save this to my Job Profile'}
    </button>
  );
}

const show = (x) => (typeof x === 'string' ? x : Object.entries(x || {}).filter(([k, v]) => !META.has(k) && typeof v === 'string' && v.trim()).map(([, v]) => v).join(' · '));
/** "Your profile has N updates — review", with accept or skip for each. */
export function ProfileUpdates({ d, setD, updates }) {
  const [open, setOpen] = useState(false);
  if (!updates.length) return null;
  const n = updates.length;
  return (
    <>
      <div className="well row between g8" role="status" style={{ padding: '10px 14px' }}>
        <span className="small">Your Job Profile has {n} update{n === 1 ? '' : 's'} this resume doesn’t have yet.</span>
        <button type="button" className="btn btn-outline" style={{ minHeight: 36 }} onClick={() => setOpen(true)}>Review {n} update{n === 1 ? '' : 's'}</button>
      </div>
      {open && (
        <Dialog showTitle wide title="Updates from your Job Profile" onClose={() => setOpen(false)}>
          <span className="small muted">This resume is a copy. Take the changes you want; skipped ones won’t be offered again.</span>
          {updates.map((u) => (
            <div key={u.key} className="card-sm stack g8" style={{ padding: 12 }}>
              <strong className="small">{u.label}</strong>
              <span className="xs muted">Now on this resume: {show(u.from) || '—'}</span>
              <span className="xs">In your profile: {show(u.to) || '—'}</span>
              <div className="row g8">
                <button type="button" className="btn btn-ink" style={{ minHeight: 34 }} aria-label={`Accept update: ${u.label}`} onClick={() => { setD((p) => applyUpdate(p, u, true)); if (n === 1) setOpen(false); }}>Accept</button>
                <button type="button" className="btn btn-outline" style={{ minHeight: 34 }} aria-label={`Skip update: ${u.label}`} onClick={() => { setD((p) => applyUpdate(p, u, false)); if (n === 1) setOpen(false); }}>Skip</button>
              </div>
            </div>
          ))}
          {n > 1 && <button type="button" className="btn btn-outline" style={{ alignSelf: 'flex-start' }} onClick={() => { setD((p) => updates.reduce((x, u) => applyUpdate(x, u, true), p)); setOpen(false); }}>Accept all</button>}
        </Dialog>
      )}
    </>
  );
}
