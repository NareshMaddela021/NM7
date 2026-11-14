// The new home page (/new-home): every shape has the same number of dots (so they can morph), the four audiences
// and their links, widgets never show a number that didn't come from the API, and the structured data is complete.
import { describe, expect, it } from 'vitest';
import { SHAPE_NAMES, projectPoints, shapePoints } from './shapes';
import { AUDIENCES, DEFAULT_AUDIENCE, FAQ, SECTIONS, audienceFor, structuredData, widgetFor } from './content';
import { widgetText } from './GlassWidget';

describe('shapes', () => {
  it.each(SHAPE_NAMES)('%s has exactly n finite dots inside the stage', (name) => {
    for (const n of [1600, 4000]) {
      const p = shapePoints(name, n);
      expect(p.length).toBe(n * 3);
      for (const v of p) { expect(Number.isFinite(v)).toBe(true); expect(Math.abs(v)).toBeLessThan(1.3); }
    }
  });
  it('the same shape every time (seeded), and a flat picture for the fallback', () => {
    expect(shapePoints('briefcase', 500)).toBe(shapePoints('briefcase', 500));
    const pts = projectPoints('cap', 200, 400);
    expect(pts).toHaveLength(200);
    pts.forEach(([x, y]) => { expect(x).toBeGreaterThan(0); expect(x).toBeLessThan(400); expect(y).toBeGreaterThan(0); expect(y).toBeLessThan(400); });
  });
  it('every audience and section shape exists', () => {
    for (const a of AUDIENCES) expect(SHAPE_NAMES).toContain(a.shape);
    for (const s of SECTIONS) {
      expect(SHAPE_NAMES).toContain(s.shape);
      (s.journey || []).forEach((j) => expect(SHAPE_NAMES).toContain(j.shape));
    }
  });
});

describe('audiences', () => {
  it('four tabs, job seeker by default, unknown ?for= falls back', () => {
    expect(AUDIENCES.map((a) => a.key)).toEqual(['company', 'college', 'seeker', 'student']);
    expect(DEFAULT_AUDIENCE).toBe('seeker');
    expect(audienceFor('nope').key).toBe('seeker');
    expect(audienceFor('company').cta).toEqual({ label: 'Post a job free', to: '/for-companies' });
    expect(audienceFor('seeker').cta.to).toBe('/jobs');
  });
  it('the job seekers’ 360° journey has its eight steps', () => {
    expect(SECTIONS.find((s) => s.key === 'seeker').journey.map((j) => j.step)).toEqual(['Discover', 'Learn', 'Prove', 'Resume', 'Apply', 'Interview', 'Offer', 'First 90 days']);
  });
});

describe('widgets', () => {
  it('job seekers: the live numbers, null while loading, no numbers when the API failed', () => {
    expect(widgetFor('seeker', null)).toBeNull();
    const w = widgetFor('seeker', { total: 1284, today: 37, city: 'Bengaluru' });
    expect(w.big).toBe('1,284');
    expect(widgetText(w)).toBe('1,284 jobs live now · 37 new today · top city Bengaluru');
    const off = widgetFor('seeker', { failed: true });
    expect(widgetText(off)).not.toMatch(/\d+ (jobs|new)/);
  });
  it('no invented numbers for colleges and students', () => {
    expect(widgetText(widgetFor('college'))).not.toMatch(/\d/);
    expect(widgetText(widgetFor('student'))).not.toMatch(/\d/);
  });
});

describe('FAQ and structured data', () => {
  it('a group per audience, every answer filled in', () => {
    expect(FAQ.map(([g]) => g)).toEqual(['Companies', 'Colleges', 'Job seekers', 'Students']);
    FAQ.flatMap(([, qs]) => qs).forEach(([q, a]) => { expect(q.length).toBeGreaterThan(5); expect(a.length).toBeGreaterThan(20); expect(a).not.toMatch(/\{\w+\}/); });
  });
  it('Organization, WebSite with the jobs search box, FAQPage', () => {
    const [org, site, faq] = structuredData();
    expect(org['@type']).toBe('Organization');
    expect(site.potentialAction.target.urlTemplate).toBe('https://nm7.si/jobs?q={search_term_string}');
    expect(faq.mainEntity).toHaveLength(FAQ.flatMap(([, qs]) => qs).length);
  });
});
