import { describe, expect, it } from 'vitest';
import { BOLD_TIP, carryBold, normalizeBold, parseBold, plainResume, sanitizeRich, stripBold, toggleBold, tooMuchBold } from './bold';
import { INITIAL } from '../pages/builder/schema';
import { atsScore, resumeText } from './atsScore';
import { resumeFacts } from './summary/fromResume';
import { factsFromResume } from './summary/facts';
import { aiRequest } from './summary/ai';
import { sectionLines } from '../pages/builder/Compare';

describe('bold markers', () => {
  it('parses, strips and drops unpaired markers', () => {
    expect(parseBold('Led **12 people** and cut costs')).toEqual([{ t: 'Led ', b: false }, { t: '12 people', b: true }, { t: ' and cut costs', b: false }]);
    expect(stripBold('Led **12 people** and **cut** costs')).toBe('Led 12 people and cut costs');
    expect(stripBold('a ** b')).toBe('a b'); // a stray marker is never printed
    expect(stripBold('plain')).toBe('plain');
    expect(parseBold('')).toEqual([]);
    expect(normalizeBold('** Python **, SQL')).toBe(' **Python** , SQL');
    expect(plainResume({ a: ['**x** y'], b: { c: 'z **w**' }, n: 3 })).toEqual({ a: ['x y'], b: { c: 'z w' }, n: 3 });
  });

  it('B toggles the selection on and off, and the cursor word when nothing is selected', () => {
    const s = 'Built dashboards in Power BI';
    let r = toggleBold(s, 20, 28); // "Power BI"
    expect(r.value).toBe('Built dashboards in **Power BI**');
    expect(r.value.slice(r.start, r.end)).toBe('Power BI');
    r = toggleBold(r.value, r.start, r.end); // again: off
    expect(r.value).toBe(s);
    expect(toggleBold(s, 8, 8).value).toBe('Built **dashboards** in Power BI'); // cursor inside a word
    expect(toggleBold('a  b', 1, 3).value).toBe('a  b'); // only spaces: nothing to do
    // part of a bold run → that part only
    expect(toggleBold('**Power BI** dashboards', 8, 10).value).toBe('**Power** BI dashboards');
    // a selection spanning plain and bold → all bold; spaces at the edges stay outside the markers
    expect(toggleBold('cut **costs** by 20%', 0, 20).value).toBe('**cut costs by 20%**');
    // never across a line break
    expect(toggleBold('one\ntwo', 0, 7).value).toBe('**one**\n**two**');
  });

  it('the tip shows only when a bullet is mostly bold', () => {
    expect(tooMuchBold('Cut costs by **20%** using **Power BI** dashboards for the sales team')).toBe(false);
    expect(tooMuchBold('**Cut costs by 20% using Power BI dashboards** for sales')).toBe(true);
    expect(BOLD_TIP).toBe('Bold a few key words, like results and tools.');
  });

  it('saving strips any other markup and keeps text that only looks like a tag', () => {
    expect(sanitizeRich('Used <span style="color:red">SQL</span> for <5 years <b>x</b>')).toBe('Used SQL for <5 years **x**');
    expect(sanitizeRich('Built <Button> parts <div>in</div> <script>x</script>')).toBe('Built <Button> parts in\n x');
  });

  it('rewrites keep bold where the same words survive, and leave no markers otherwise', () => {
    expect(carryBold('Cut costs by **20%** using **Power BI**', 'Reduced costs 20% with Power BI dashboards')).toBe('Reduced costs **20%** with **Power BI** dashboards');
    expect(carryBold('Used **Tableau** a lot', 'Built reports')).toBe('Built reports');
    expect(carryBold('**SQL** queries', '**Wrote** SQL queries')).toBe('Wrote **SQL** queries');
  });
});

describe('bold markers never reach plain-text uses', () => {
  const data = { ...structuredClone(INITIAL), hidden: {}, summary: 'Built **Power BI** dashboards for **20** stores.', exp: [{ ...INITIAL.exp[0], role: '**Analyst**', description: '**Cut costs by 20%** using SQL' }] };
  it('ATS score and keyword text', () => {
    expect(resumeText(data)).not.toContain('**');
    expect(resumeText(data)).toContain('cut costs by 20% using sql');
    expect(atsScore(data)).toEqual(atsScore(plainResume(data)));
  });
  it('auto summary, AI request and compare view', () => {
    expect(JSON.stringify(resumeFacts(data))).not.toContain('**');
    expect(JSON.stringify(factsFromResume(data))).not.toContain('**');
    const body = aiRequest(data, '', 'shorter', 'I build **dashboards**');
    expect(JSON.stringify(body)).not.toContain('**');
    expect(body.current).toBe('I build dashboards');
    expect(JSON.stringify(sectionLines(data))).not.toContain('**');
  });
});
