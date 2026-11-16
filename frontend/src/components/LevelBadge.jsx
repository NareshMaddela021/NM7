// Vetting V1: the level chip ("L2 · Skill verified", a calm colour of its own per level) and the "⚡ Ready now" chip.
// The words carry the meaning (never colour alone): screen readers hear "Level 2 of 4: Skill verified". Used on the
// candidate dashboard and Job Profile, company Hire now and Applicants. `lang` translates the label (company pages).
import { lt } from './levelStrings';
import '../styles/level-badge.css';

export function LevelChip({ level, label, lang = 'en', testid = 'level-chip' }) {
  if (level == null) return null;
  const n = Math.max(0, Math.min(4, Number(level) || 0));
  const t = lt(lang);
  const name = lang === 'en' && label ? label : t(`lv.${n}`);
  return (
    <span className={`lvb lvb-${n}`} data-testid={testid} data-level={n} title={t('lv.level', { n })}>
      <span className="lvb-dots" aria-hidden="true">{[1, 2, 3, 4].map((i) => <i key={i} className={i <= n ? 'on' : ''} />)}</span>
      <span aria-hidden="true">L{n} · {name}</span>
      <span className="sr-only">{t('lv.level', { n })}: {name}</span>
    </span>
  );
}

export function ReadyChip({ lang = 'en', testid = 'ready-chip' }) {
  const t = lt(lang);
  return (
    <span className="lvb lvb-ready" data-testid={testid} title={t('lv.readyTip')}>
      <span aria-hidden="true">⚡</span>{t('lv.ready')}<span className="sr-only">: {t('lv.readyTip')}</span>
    </span>
  );
}

/** Both chips side by side; nothing when there is no level. */
export default function LevelBadge({ level, label, readyNow, lang = 'en', className = '' }) {
  if (level == null) return null;
  return (
    <span className={`lvb-row ${className}`}>
      <LevelChip level={level} label={label} lang={lang} />
      {readyNow && <ReadyChip lang={lang} />}
    </span>
  );
}
