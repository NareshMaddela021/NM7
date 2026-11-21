// Site language (Batch C item 13) on Profile & settings: English / Telugu / Hindi for the whole site in this browser.
import { LANGS, langsShown, setLang, useLang } from '../../lib/i18n';
import { savePrefs } from '../../lib/simple';
import { MeCard } from './kit';
import { IcGlobe } from '../../components/icons';

/** Site language (Batch C item 13): the whole site in this browser, the Easy dashboard included (its saved language is
 * the person's own, so it is saved there too). Hidden while Admin -> Settings -> "Show Telugu and Hindi" is off. */
export default function SiteLanguage() {
  const [t, lang] = useLang();
  if (!langsShown()) return null;
  const pick = (code) => { setLang(code); savePrefs({ lang: code }).catch(() => { /* this browser still changed */ }); };
  return (
    <MeCard as="section" id="s-lang" className="acc-sec" label="Site language" icon={<IcGlobe />} title="Site language" sub="The language of your dashboard and the Easy dashboard. Emails have their own language under Job alerts.">
      <div className="row g8" role="group" aria-label={t('lang.label')} data-testid="site-lang">
        {LANGS.map(([code, name]) => <button key={code} type="button" lang={code} className={`btn ${lang === code ? 'btn-ink' : 'btn-outline'}`} style={{ minHeight: 44 }} aria-pressed={lang === code} onClick={() => pick(code)} data-testid={`site-lang-${code}`}>{name}</button>)}
      </div>
    </MeCard>
  );
}
