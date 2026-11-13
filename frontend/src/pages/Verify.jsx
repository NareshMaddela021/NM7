// Phase 6 S8: /verify/<number>, the public check for an internship or live-project certificate. English, Telugu and
// Hindi (verify.*).
import { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import Header from '../components/Header';
import SiteFooter from '../components/SiteFooter';
import { headerLabels, useLang } from '../lib/i18n';
import { http } from '../services/http';

export default function Verify() {
  const { token } = useParams();
  const [t, lang] = useLang();
  const [d, setD] = useState(undefined);
  useEffect(() => { http(`/api/public/certificates/${encodeURIComponent(token)}`).then(setD, () => setD(null)); }, [token]);
  return (
    <>
      <Header labels={headerLabels(t)} lang={lang} />
      <main id="main" className="container stack g16" style={{ maxWidth: 720, padding: '24px 16px 64px' }} data-testid="verify">
        <h1 className="display" style={{ fontSize: 28 }}>{t('verify.title')}</h1>
        {d === undefined && <p className="muted">{t('verify.loading')}</p>}
        {d === null && <p className="error" role="alert" data-testid="verify-none">{t('verify.none')}</p>}
        {d && (
          <section className="card stack g8" data-testid="verify-ok">
            <strong>✓ {t('verify.ok')}</strong>
            <p style={{ margin: 0 }}>{t('verify.line', { name: d.name, title: d.title, company: d.company, from: d.from, to: d.to })}</p>
            <span className="xs muted">{t('verify.number', { n: d.number })}</span>
          </section>
        )}
      </main>
      <SiteFooter />
    </>
  );
}
