// The browser tab title for each page of a dashboard (Batch E item 46): the page's own name from the side menu
// ("Messages", "Job Profile", "Learning paths"), not the dashboard's name on every page. Imported only by the lazy
// dashboard layouts, never by the entry bundle.
import { metaFor } from './meta';

const words = (seg) => seg.replace(/[-_]+/g, ' ').replace(/^./, (c) => c.toUpperCase());

/**
 * pathname: the page; nav: [key, path, label][] (the side menu); home: the dashboard's own path; generic: the route
 * table's title for the whole dashboard; suffix: added after the page name (" · Admin").
 * A page with its own entry in the route table keeps it; others get the menu label, else their path in words.
 */
export function navMeta(pathname, nav, { home, generic, suffix = '' }) {
  const base = metaFor(pathname);
  const path = pathname.replace(/\/+$/, '') || '/';
  if (path === home || base.title !== generic) return base;
  const tab = nav.find(([, to]) => to !== home && (path === to || path.startsWith(`${to}/`)));
  const seg = path.slice(home.length + 1).split('/')[0];
  const name = tab ? tab[2] : words(seg);
  return name ? { ...base, title: name + suffix } : base;
}
