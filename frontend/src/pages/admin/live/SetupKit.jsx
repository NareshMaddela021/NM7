// Round P, Phase 5: the page header for the admin People / Setup / Reports pages (icon, title, one line, actions,
// and a row of small numbers taken from the page's own data). Styles: styles/admin-setup.css.
import '../../../styles/me-kit.css';
import '../../../styles/admin-setup.css';

/** stats: [[label, value, tone?]] with tone ok | warn | bad | accent; shown only when there are numbers. */
export function Hero({ icon, title, sub, right, stats }) {
  return (
    <div className="as-hero">
      <div className="as-hero-top">
        <span className="as-hero-ic" aria-hidden="true">{icon}</span>
        <div className="as-hero-t">
          <h1 className="display as-h1">{title}</h1>
          {sub && <p className="as-sub">{sub}</p>}
        </div>
        {right && <div className="as-hero-right">{right}</div>}
      </div>
      {stats?.length > 0 && (
        <dl className="as-stats">
          {stats.map(([l, v, tone]) => <div key={l} className={`as-stat${tone ? ` as-${tone}` : ''}`}><dt>{l}</dt><dd>{v}</dd></div>)}
        </dl>
      )}
    </div>
  );
}

/** A first letter in a soft purple square (people and stories). */
export const Initial = ({ name, small }) => <span className={`as-av${small ? ' as-av-sm' : ''}`} aria-hidden="true">{(name || '?').trim().charAt(0).toUpperCase() || '?'}</span>;
