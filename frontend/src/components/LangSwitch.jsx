// The English / తెలుగు / हिन्दी switch on the main public pages (home, /for-orgs, the builder's Start step, sign-in).
// The choice is remembered in this browser (lib/i18n.js) and applies to every page that has the switch.
import { LANGS, setLang } from '../lib/i18n';
import { track } from '../lib/track';

export default function LangSwitch({ t, lang, style }) {
  return (
    <div className="hx-lang" role="group" aria-label={t('lang.label')} lang={lang} style={style}>
      {LANGS.map(([code, label]) => (
        <button key={code} type="button" lang={code} aria-pressed={lang === code} onClick={() => { track(`lang_${code}`); setLang(code); }}>{label}</button>
      ))}
    </div>
  );
}
