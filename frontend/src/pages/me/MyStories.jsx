// Help & referral > Share your story: a short placement or resume story for Nm7's website, with an explicit consent
// tick. Nm7 checks it (typo fixes only) before it shows. Withdraw any time and it disappears.
import { useEffect, useState } from 'react';
import { Spinner, useToast } from '../../components/ui';
import { LIVE, http } from '../../services/http';

const STATUS = { pending: ['Waiting for review', 'b-warning'], approved: ['On the website', 'b-success'], rejected: ['Not used', 'b-neutral'] };
const readPhoto = (file) => new Promise((ok, no) => {
  if (!/^image\/(png|jpeg)$/.test(file.type) || file.size > 300_000) { no(new Error('Use a PNG or JPG photo up to 300 KB.')); return; }
  const r = new FileReader(); r.onload = () => ok(r.result); r.onerror = () => no(new Error('Couldn’t read that photo.')); r.readAsDataURL(file);
});

export default function MyStories({ name = '' }) {
  const toast = useToast();
  const [rows, setRows] = useState([]);
  const first = name.trim().split(/\s+/);
  const [f, setF] = useState({ story: '', displayName: first.length > 1 ? `${first[0]} ${first[first.length - 1][0]}.` : first[0] || '', company: '', role: '', photo: null, consent: false });
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const load = () => http('/api/me/stories').then(setRows, () => {});
  useEffect(() => { if (LIVE) load(); }, []);
  if (!LIVE) return null;
  const ok = f.story.trim().length >= 40 && f.displayName.trim().length >= 2 && f.consent;
  const submit = async (e) => {
    e.preventDefault();
    if (!ok || busy) return;
    setBusy(true); setErr('');
    try { await http('/api/me/stories', { method: 'POST', body: { ...f, photo: f.photo || undefined } }); setF({ ...f, story: '', photo: null, consent: false }); toast('Thanks! We’ll check it and put it on the website.'); await load(); } catch (x) { setErr(x.message); } finally { setBusy(false); }
  };
  return (
    <section className="card stack g12" style={{ flex: '1 1 340px' }} aria-label="Share your story" data-testid="my-stories">
      <strong>Share your story</strong>
      <span className="small muted">Did Nm7 help you get shortlisted or placed? A few lines help other students. We fix typos only, and you can withdraw it any time.</span>
      {rows.map((s) => {
        const [label, tone] = STATUS[s.status] || [s.status, 'b-neutral'];
        return (
          <div key={s.id} className="well stack g4" data-testid="my-story">
            <span className="row between g8"><span className={`badge ${tone}`}>{label}</span><button type="button" className="link-btn xs" onClick={async () => { try { await http(`/api/me/stories/${s.id}`, { method: 'DELETE' }); toast('Withdrawn — it’s gone from the website'); await load(); } catch (x) { toast(x.message); } }} data-testid="story-withdraw">Withdraw</button></span>
            <span className="small">“{s.story}”</span>
            <span className="xs muted">{s.displayName}{s.company ? ` · ${s.company}` : ''}</span>
          </div>
        );
      })}
      <form className="stack g8" onSubmit={submit}>
        <div className="field"><label className="label" htmlFor="st-t">Your story (40–700 characters)</label><textarea id="st-t" className="input" rows={4} maxLength={700} value={f.story} onChange={(e) => setF({ ...f, story: e.target.value })} data-testid="story-text" /></div>
        <div className="row g8" style={{ flexWrap: 'wrap' }}>
          <div className="field" style={{ flex: '1 1 160px' }}><label className="label" htmlFor="st-n">Name to show</label><input id="st-n" className="input" maxLength={40} value={f.displayName} onChange={(e) => setF({ ...f, displayName: e.target.value })} /></div>
          <div className="field" style={{ flex: '1 1 160px' }}><label className="label" htmlFor="st-c">Company (optional)</label><input id="st-c" className="input" maxLength={60} value={f.company} onChange={(e) => setF({ ...f, company: e.target.value })} /></div>
          <div className="field" style={{ flex: '1 1 160px' }}><label className="label" htmlFor="st-r">Role (optional)</label><input id="st-r" className="input" maxLength={60} value={f.role} onChange={(e) => setF({ ...f, role: e.target.value })} /></div>
        </div>
        <div className="field"><label className="label" htmlFor="st-p">Photo (optional, PNG or JPG up to 300 KB)</label><input id="st-p" type="file" accept="image/png,image/jpeg" onChange={async (e) => { const file = e.target.files?.[0]; if (!file) { setF({ ...f, photo: null }); return; } try { setF({ ...f, photo: await readPhoto(file) }); setErr(''); } catch (x) { setErr(x.message); e.target.value = ''; } }} /></div>
        <label className="row g8 small" style={{ alignItems: 'flex-start' }}><input type="checkbox" checked={f.consent} onChange={(e) => setF({ ...f, consent: e.target.checked })} data-testid="story-consent" style={{ marginTop: 3 }} /><span>I agree that Nm7 may show this story, the name above{f.photo ? ', my photo' : ''} and the company and role on its website. I can withdraw it any time.</span></label>
        <span className="xs muted">Don’t include phone numbers, email addresses or ID numbers.</span>
        {err && <span className="small" role="alert" style={{ color: 'var(--danger)' }}>{err}</span>}
        <button type="submit" className="btn btn-ink" style={{ alignSelf: 'flex-start' }} disabled={!ok || busy} data-testid="story-send">{busy && <Spinner />}Send for review</button>
      </form>
    </section>
  );
}
