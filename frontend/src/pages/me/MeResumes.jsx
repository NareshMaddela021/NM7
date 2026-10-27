// My resumes: several resumes, duplicate / rename / delete, versions (auto-saves + expert drafts), compare, restore.
import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Dialog, useToast } from '../../components/ui';
import { useMe, openInBuilder, addResume, updateResume, deleteResume, restoreVersion, expertDrafts, retentionLeft, blankResume } from '../../lib/customerStore';
import { useExpertOrders } from '../../lib/expertStore';
import { atsScore } from '../../lib/atsScore';
import Compare from '../builder/Compare';
import { MeHead } from './MeLayout';
import { ResumeThumb, downloadResume, templateName, ago, fmtWhen } from './shared';

function Versions({ r, onClose }) {
  const toast = useToast();
  const list = [...r.versions, ...expertDrafts(r.id)].sort((a, b) => b.at - a.at);
  const [pick, setPick] = useState(list[0] || null);
  return (
    <Dialog showTitle title={`Versions · ${r.name}`} onClose={onClose} wide>
      {list.length === 0 ? <p className="muted small">No earlier versions yet. We keep an automatic copy as you edit (at most every 30 minutes) and every draft your expert sends.</p> : (
        <div className="row g16" style={{ alignItems: 'flex-start' }}>
          <div className="stack g4" style={{ flex: '1 1 220px', maxHeight: 460, overflow: 'auto' }}>
            {list.map((v, i) => (
              <button key={i} type="button" onClick={() => setPick(v)} className="stack" aria-pressed={pick === v}
                style={{ border: '1px solid var(--border)', borderRadius: 10, padding: '8px 10px', textAlign: 'left', background: pick === v ? 'var(--sunken)' : 'var(--surface)' }}>
                <strong className="small">{v.label}</strong><span className="xs muted">{fmtWhen(v.at)} · ATS {atsScore(v.data).score}</span>
                {v.expert && retentionLeft(v.at) != null && <span className="xs faint">Expert copy kept {Math.max(0, retentionLeft(v.at))} more days</span>}
              </button>
            ))}
          </div>
          {pick && (
            <div className="stack g12" style={{ flex: '2 1 360px', maxHeight: 460, overflow: 'auto' }}>
              <div className="row between g8"><strong className="small">{pick.label} → current</strong><button type="button" className="btn btn-outline" style={{ minHeight: 36 }} onClick={() => { restoreVersion(r.id, pick.data); toast('Restored — the current one is saved as a version too'); onClose(); }}>Restore this version</button></div>
              <Compare a={pick.data} b={r.data} aLabel="that version" bLabel="current" />
            </div>
          )}
        </div>
      )}
    </Dialog>
  );
}

export default function MeResumes() {
  const me = useMe();
  useExpertOrders();
  const nav = useNavigate();
  const toast = useToast();
  const [versions, setVersions] = useState(null);
  const [renaming, setRenaming] = useState(null);
  const [name, setName] = useState('');
  const [confirmDel, setConfirmDel] = useState(null);
  const edit = (id) => { openInBuilder(id); nav('/builder', { state: { open: 'build' } }); };
  const blank = () => blankResume(me.account); // truly empty: only the account's name, email and phone

  return (
    <>
      <MeHead title="My resumes" sub="Keep a resume per job type. The builder edits the one marked “Editing now”."
        right={<><button type="button" className="btn btn-outline" onClick={() => { const id = addResume('New resume', blank()); edit(id); }}>New blank</button></>} />
      <div className="row g16" style={{ alignItems: 'stretch' }}>
        {me.resumes.map((r) => {
          const s = atsScore(r.data).score;
          return (
            <article key={r.id} className="card row g16" style={{ flex: '1 1 420px', alignItems: 'flex-start' }} aria-label={r.name}>
              <ResumeThumb data={r.data} width={120} label={`Preview of ${r.name} resume`} />
              <div className="stack g8" style={{ flex: 1, minWidth: 180 }}>
                {renaming === r.id ? (
                  <form className="row g4" onSubmit={(e) => { e.preventDefault(); updateResume(r.id, { name: name.trim() || r.name }); setRenaming(null); }}>
                    <label htmlFor={`rn-${r.id}`} className="sr-only">Resume name</label>
                    <input id={`rn-${r.id}`} className="input" style={{ height: 38 }} value={name} autoFocus maxLength={40} onChange={(e) => setName(e.target.value)} />
                    <button type="submit" className="btn btn-ink" style={{ minHeight: 38 }}>Save</button>
                  </form>
                ) : <strong style={{ fontSize: 17 }}>{r.name}</strong>}
                <span className="row g8">{r.active && <span className="badge b-signal">Editing now</span>}<span className={`badge ${s >= 80 ? 'b-success' : 'b-warning'}`}>ATS {s}</span></span>
                <span className="xs muted">{templateName(r.data)} · edited {ago(r.updated)} · {r.versions.length + expertDrafts(r.id).length} versions</span>
                <div className="row g8">
                  <button type="button" className="btn btn-ink" style={{ minHeight: 36 }} onClick={() => edit(r.id)}>Edit</button>
                  <button type="button" className="btn btn-outline" style={{ minHeight: 36 }} onClick={async () => { if (await downloadResume(r.data, 'pdf', undefined, undefined, r.id)) toast('PDF ready'); }}>PDF</button>
                  <button type="button" className="btn btn-outline" style={{ minHeight: 36 }} onClick={async () => { if (await downloadResume(r.data, 'docx', undefined, undefined, r.id)) toast('Word file ready'); }}>Word</button>
                </div>
                <div className="row g12 small">
                  <button type="button" className="link-btn small" onClick={() => setVersions(r)}>Versions</button>
                  <button type="button" className="link-btn small" onClick={() => { addResume(`${r.name} (copy)`, r.data); toast('Copied'); }}>Duplicate</button>
                  <button type="button" className="link-btn small" onClick={() => { setRenaming(r.id); setName(r.name); }}>Rename</button>
                  {me.resumes.length > 1 && <button type="button" className="link-btn small" style={{ color: 'var(--danger)' }} onClick={() => setConfirmDel(r)}>Delete</button>}
                </div>
              </div>
            </article>
          );
        })}
      </div>
      {versions && <Versions r={me.resumes.find((x) => x.id === versions.id)} onClose={() => setVersions(null)} />}
      {confirmDel && (
        <Dialog showTitle title={`Delete “${confirmDel.name}”?`} onClose={() => setConfirmDel(null)}>
          <div className="stack g12"><span className="small muted">This removes the resume and its versions. Orders and invoices are not affected.</span>
            <div className="row g8"><button type="button" className="btn btn-ink" style={{ background: 'var(--danger)', borderColor: 'var(--danger)' }} onClick={() => { deleteResume(confirmDel.id); setConfirmDel(null); toast('Deleted'); }}>Delete</button><button type="button" className="btn btn-ghost" onClick={() => setConfirmDel(null)}>Cancel</button></div>
          </div>
        </Dialog>
      )}
    </>
  );
}
