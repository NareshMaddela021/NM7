// Admin -> Auto Apply -> "Nm7 Apply helper": the week's numbers, today's smart-answer spend against the limit and the
// top unfilled labels; and on Jobs ready, the "add the helper" line shows only while "Promote the helper" is on (the
// server sends `helper` only then) and only on jobs applied to on a company's form.
import { describe, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { HelperNumbers } from './ApplyHelper';
import { KitCard } from '../../me/AutoApplyOneTap';

const D = {
  settings: { rupeesDay: 200, perUser: 20, promote: false, storeUrl: '', rupeesPerCall: 0.05 },
  today: { aiCalls: 3, spendRupees: 0.15, answers: 3, cached: 2, paused: false },
  week: { days: 7, paired: 5, pairedWithInstall: 4, connectWithinDay: 3, fills: 9, fillRate: 91.5, fieldsFilled: 183, fieldsTotal: 200,
    kitsFilled: 6, appliedAfterFill: 4, firstWeekDisconnects: 1, aiCalls: 12, spendRupees: 0.6, answersCached: 5 },
  topMisses: [{ label: 'Preferred shift', type: 'select', host: 'acme.wd3.myworkdayjobs.com', adapter: 'workday', count: 7 }],
  bySite: [{ host: 'acme.wd3.myworkdayjobs.com', adapter: 'workday', labels: 1, count: 7 }],
};

describe('Admin: Nm7 Apply helper', () => {
  it('shows the weekly numbers, today’s spend and the top labels', () => {
    const html = renderToStaticMarkup(<HelperNumbers d={D} />);
    for (const t of ['3 of 4', '91.5%', '183 of 200 fields', '4 of 6', 'Rs 0.6', 'Rs 0.15 of 200', 'Preferred shift', 'acme.wd3.myworkdayjobs.com, workday: 7']) expect(html).toContain(t);
    expect(renderToStaticMarkup(<HelperNumbers d={{ ...D, topMisses: [], bySite: [], week: { ...D.week, fillRate: null } }} />)).toContain('No reports yet.');
    expect(renderToStaticMarkup(<HelperNumbers d={{ ...D, today: { ...D.today, paused: true } }} />)).toContain('Paused for today');
  });
});

describe('Jobs ready: promote the helper', () => {
  const it0 = { id: 'k1', job: { title: 'Data Analyst', company: 'Zeta' }, applyUrl: 'https://zeta.in/apply', applyHost: 'zeta.in', byEmail: false, closed: false };
  const card = (props) => renderToStaticMarkup(<ul><KitCard it={it0} toast={vi.fn()} onChanged={vi.fn()} {...props} /></ul>);
  it('shows nothing while the switch is off', () => {
    expect(card({})).not.toContain('aa2-helper-promo');
    expect(card({ helper: undefined })).not.toContain('Chrome Web Store');
  });
  it('shows the line with the store link on company-form jobs once on', () => {
    const helper = { storeUrl: 'https://chromewebstore.google.com/detail/abc', text: 'Fill it in one tap: add the Nm7 Apply helper' };
    const html = card({ helper });
    expect(html).toContain('Fill it in one tap: add the Nm7 Apply helper');
    expect(html).toContain('href="https://chromewebstore.google.com/detail/abc"');
    expect(card({ helper, it: { ...it0, byEmail: true, applyUrl: 'mailto:hr@zeta.in' } })).not.toContain('aa2-helper-promo');
    expect(card({ helper, it: { ...it0, closed: true } })).not.toContain('aa2-helper-promo');
  });
});
