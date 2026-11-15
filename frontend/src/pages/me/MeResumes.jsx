// My resumes: several resumes, duplicate / rename / delete, versions (auto-saves + expert drafts), compare, restore.
import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Dialog, useToast } from '../../components/ui';
import { useMe, openInBuilder, addResume, updateResume, deleteResume, restoreVersion, expertDrafts, retentionLeft, blankResume } from '../../lib/customerStore';
import { useExpertOrders } from '../../lib/expertStore';
import { atsScore } from '../../lib/atsScore';
import VersionCompare from './VersionCompare';
import { MeHead } from './MeLayout';
import ShareWhatsApp from '../../components/ShareWhatsApp';
import { ResumeThumb, downloadResume, templateName, ago, fmtWhen } from './shared';
import { Chip } from './kit';
import '../../styles/me-resume.css';

function Versions({ r, onClose }) {
  const toast = useToast();
  const list = [...r.versions, ...expertDrafts(r.id)].sort((a, b) => b.at - a.at);
  // "Current" first, then every saved version (newest first): pick any two to compare
  const options = [{ key: 'current', label: 'Current', data: r.data }, ...list.map((v, i) => ({ key: `v${i}`, label: v.label, at: v.at, data: v.data, expert: v.expert, ats: atsScore(v.data).score }))];
  return (
    <Dialog showTitle title={`Versions · ${r.name}`} onClose={onClose} wide>
      {list.length === 0 ? <p className="muted small">No earlier versions yet. We keep an automatic copy as you edit (at most every 30 minutes) and every draft your expert sends.</p> : (
        <div className="stack g12">
          <ul className="row g8" style={{ listStyle: 'none', margin: 0, padding: 0, flexWrap: 'wrap' }} aria-label="Saved versions">
            {options.slice(1).map((v) => (
              <li key={v.key} className="xs" style={{ border: '1px solid var(--border)', borderRadius: 8, padding: '4px 8px' }}>
                <strong>{v.label}</strong> · {fmtWhen(v.at)} · ATS {v.ats}
                {v.expert && retentionLeft(v.at) != null && <span className="faint"> · kept {Math.max(0, retentionLeft(v.at))} more days</span>}
              </li>
            ))}
          </ul>
          <VersionCompare options={options} onRestore={(v) => { restoreVersion(r.id, v.data); toast('Restored — the current one is saved as a version too'); onClose(); }} />
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
        right={<><ShareWhatsApp testid="resumes-share-wa" /><button type="button" className="btn btn-outline" onClick={() => { const id = addResume('New resume', blank()); edit(id); }}>New blank</button></>} />
      <ul className="rz-grid" aria-label="My resumes">
        {me.resumes.map((r) => {
          const s = atsScore(r.data).score;
          return (
            <li key={r.id} className="rz-li">
              <article className={`mcard rz-card ${r.active ? 'rz-active' : ''}`} aria-label={r.name}>
                <button type="button" className="rz-thumb" onClick={() => edit(r.id)} aria-label={`Open ${r.name} in the builder`}>
                  <ResumeThumb data={r.data} width={210} label={`Preview of ${r.name} resume`} />
                </button>
                <div className="rz-body">
                  <span className="mrow" style={{ gap: 6 }}>{r.active && <Chip tone="accent">Editing now</Chip>}<Chip tone={s >= 80 ? 'ok' : 'warn'}>ATS {s}</Chip></span>
                  {renaming === r.id ? (
                    <form className="mrow" style={{ gap: 6 }} onSubmit={(e) => { e.preventDefault(); updateResume(r.id, { name: name.trim() || r.name }); setRenaming(null); }}>
                      <label htmlFor={`rn-${r.id}`} className="sr-only">Resume name</label>
                      <input id={`rn-${r.id}`} className="input" style={{ flex: '1 1 140px', minWidth: 0 }} value={name} autoFocus maxLength={40} onChange={(e) => setName(e.target.value)} />
                      <button type="submit" className="btn btn-ink">Save</button>
                    </form>
                  ) : <h2 className="rz-name">{r.name}</h2>}
                  <span className="mitem-meta">{templateName(r.data)} · edited {ago(r.updated)} · {r.versions.length + expertDrafts(r.id).length} versions</span>
                  <div className="rz-actions">
                    <button type="button" className="btn btn-signal" onClick={() => edit(r.id)}>Edit</button>
                    <button type="button" className="btn btn-outline" onClick={async () => { if (await downloadResume(r.data, 'pdf', undefined, undefined, r.id)) toast('PDF ready'); }}>PDF</button>
                    <button type="button" className="btn btn-outline" onClick={async () => { if (await downloadResume(r.data, 'docx', undefined, undefined, r.id)) toast('Word file ready'); }}>Word</button>
                  </div>
                  <div className="rz-more" role="group" aria-label={`More for ${r.name}`}>
                    <button type="button" className="link-btn" onClick={() => setVersions(r)}>Versions</button>
                    <button type="button" className="link-btn" onClick={() => { addResume(`${r.name} (copy)`, r.data); toast('Copied'); }}>Duplicate</button>
                    <button type="button" className="link-btn" onClick={() => { setRenaming(r.id); setName(r.name); }}>Rename</button>
                    {me.resumes.length > 1 && <button type="button" className="link-btn" style={{ color: 'var(--danger)' }} onClick={() => setConfirmDel(r)}>Delete</button>}
                  </div>
                </div>
              </article>
            </li>
          );
        })}
        <li className="rz-li">
          <button type="button" className="rz-new" onClick={() => { const id = addResume('New resume', blank()); edit(id); }}>
            <span className="rz-plus" aria-hidden="true">+</span>
            <strong>Start a new resume</strong>
            <span className="mitem-meta">Keep one for each kind of job you apply for.</span>
          </button>
        </li>
      </ul>
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
