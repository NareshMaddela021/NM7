// /demo/apply/:slug — a practice apply page (the multi-step ones, copying the structure of each kind of hiring
// system, are PracticeSystem.jsx) — a practice apply page for the Chrome Web Store review of the Nm7 Apply helper. A plain form of
// a made-up company (Demo Tech Solutions): the review account's two "Jobs ready" kits link here, the helper fills it,
// and Submit only says "Practice form: nothing was sent". Nothing is stored or sent (no request of any kind), the page
// is not indexed (robots meta here, X-Robots-Tag in vercel.json) and not in the sitemap. Lazy-loaded (App.jsx).
import { useState } from 'react';
import { useLocation, useParams } from 'react-router-dom';
import { usePageMeta } from '../../lib/meta';
import { COMPANY, FIELDS, JOBS, SENT_TEXT, practiceSubmit } from './practiceForm';
import { SYSTEMS } from './practiceSystems';
import PracticeSystem from './PracticeSystem';

const box = { width: '100%', boxSizing: 'border-box', padding: '10px 12px', font: 'inherit', border: '1px solid #9ca3af', borderRadius: 8, background: '#fff', color: '#111827' };

export function PracticeForm({ slug }) {
  const job = JOBS[slug];
  const [sent, setSent] = useState(false);
  if (!job) {
    return (
      <main id="main" style={{ maxWidth: 640, margin: '0 auto', padding: '40px 16px' }}>
        <h1 style={{ fontSize: 24 }}>This practice page doesn’t exist</h1>
        <p>Try <a href="/demo/apply/junior-data-analyst">the Junior Data Analyst practice form</a>.</p>
      </main>
    );
  }
  return (
    <main id="main" style={{ maxWidth: 640, margin: '0 auto', padding: '24px 16px 64px', color: '#111827', background: '#f9fafb' }}>
      <p role="note" data-testid="practice-note" style={{ background: '#fef3c7', border: '1px solid #f59e0b', borderRadius: 8, padding: '10px 12px', margin: '0 0 20px', fontSize: 15 }}>
        Practice page for trying the Nm7 Apply helper. {COMPANY} is a made-up company. Nothing you type here is sent or saved.
      </p>
      <header style={{ marginBottom: 16 }}>
        <p style={{ margin: 0, fontWeight: 700, letterSpacing: 0.3 }}>{COMPANY}</p>
        <h1 style={{ fontSize: 26, margin: '4px 0' }}>Apply for {job.title}</h1>
        <p style={{ margin: 0, color: '#4b5563' }}>{job.place}</p>
      </header>
      <form noValidate onSubmit={(e) => practiceSubmit(e, setSent)} aria-label={`Apply for ${job.title}`} data-testid="practice-form" style={{ display: 'grid', gap: 14 }}>
        {FIELDS.map(([name, label, type, autocomplete, required]) => {
          const id = `pa-${name}`;
          const common = { id, name, required, style: box, 'data-testid': `practice-${name}` };
          return (
            <div key={name} style={{ display: 'grid', gap: 4 }}>
              <label htmlFor={id} style={{ fontWeight: 600 }}>{label}{required ? ' *' : ''}</label>
              {type === 'textarea'
                ? <textarea {...common} rows={5} autoComplete={autocomplete} />
                : <input {...common} type={type} autoComplete={autocomplete || undefined} accept={type === 'file' ? 'application/pdf,.pdf' : undefined} />}
            </div>
          );
        })}
        <button type="submit" data-testid="practice-submit" style={{ justifySelf: 'start', minHeight: 44, padding: '10px 20px', font: 'inherit', fontWeight: 700, border: 0, borderRadius: 8, background: '#1d4ed8', color: '#fff', cursor: 'pointer' }}>Submit application</button>
        <p role="status" data-testid="practice-sent" style={sent ? { margin: 0, padding: '10px 12px', borderRadius: 8, background: '#dcfce7', border: '1px solid #16a34a', fontWeight: 600 } : { margin: 0 }}>{sent ? SENT_TEXT : ''}</p>
      </form>
    </main>
  );
}

export default function PracticeApply() {
  const { slug } = useParams();
  const { search } = useLocation();
  const sys = SYSTEMS[slug];
  usePageMeta({ title: `Practice apply form · ${sys ? sys.company : COMPANY}`, description: 'A practice form for trying the Nm7 Apply helper. Nothing is sent.', noindex: true });
  if (sys) return <PracticeSystem slug={slug} embed={new URLSearchParams(search).get('embed') === '1'} />;
  return <PracticeForm slug={slug} />;
}
