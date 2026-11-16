// The expert screens' page frame (round P, Phase 5): the expert header, then a page head with a small kicker, a
// serif title, a helper line, buttons on the right and a small purple dotted shape (desktop only). Styles:
// styles/expert.css (+ the shared kit in styles/me-kit.css).
import Header from '../../components/Header';
import { Still } from '../newhome/ParticleStage';
import '../../styles/me-kit.css';
import '../../styles/expert.css';

/** Page head only (for pages that build their own <main>). */
export function ExpertHead({ kicker, title, sub, right, shape = 'sphere', titleSize }) {
  return (
    <div className="ex-head">
      <div className="ex-head-text">
        {kicker && <span className="ex-kicker">{kicker}</span>}
        <h1 className="ex-title" style={titleSize ? { fontSize: titleSize } : undefined}>{title}</h1>
        {sub && <span className="ex-sub">{sub}</span>}
      </div>
      {right && <div className="ex-head-right">{right}</div>}
      <span className="ex-head-art" aria-hidden="true"><Still shape={shape} className="ex-head-still" /></span>
    </div>
  );
}

/** The whole page: header + <main> + head. width: narrow | mid | wide. */
export function ExpertPage({ width = 'wide', children, id = 'main', ...head }) {
  return (
    <>
      <Header variant="expert" />
      <main id={id} className={`container-wide ex-page ex-${width} stack g20`}>
        {head.title && <ExpertHead {...head} />}
        {children}
      </main>
    </>
  );
}

/** Loading screen used before the expert's profile is ready. */
export function ExpertLoading({ text = 'Loading…' }) {
  return (
    <>
      <Header variant="expert" />
      <main className="container-wide ex-page ex-mid stack g16" role="status">
        <span className="skeleton" style={{ width: 220, height: 34 }} aria-hidden="true" />
        <div className="mgrid" aria-hidden="true">{[0, 1, 2].map((i) => <div key={i} className="mcard"><span className="skeleton" style={{ width: '50%', height: 18 }} /><span className="skeleton" style={{ width: '80%' }} /></div>)}</div>
        <span className="sr-only">{text}</span>
      </main>
    </>
  );
}
