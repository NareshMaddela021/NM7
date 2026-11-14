// The new home page (/new-home): every shape has the same number of dots (so they can morph), the four audiences
// and their links, widgets never show a number that didn't come from the API, and the structured data is complete.
import { describe, expect, it } from 'vitest';
import { SHAPE_COLORS, SHAPE_NAMES, SPACING, colorsFor, projectPoints, shapePoints } from './shapes';
import { AUDIENCES, DEFAULT_AUDIENCE, FAQ, HERO_HEADLINE, META, SECTIONS, TAGLINE, audienceFor, structuredData, widgetFor } from './content';
import { translate } from '../../lib/i18n';
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

describe('the 60-minute promise (Naresh, round N)', () => {
  it('headline, tagline, company tab, widget, flow, FAQ and title all say 60 minutes; never Blinkit', () => {
    expect(HERO_HEADLINE).toBe('Hire in 60 minutes. Get hired fast.');
    expect(TAGLINE).toBe('Blink-it for hiring');
    expect(audienceFor('company').headline).toBe('Hire any role in 60 minutes');
    expect(widgetText(widgetFor('company'))).toBe('60 min from post to hire · Minute 0: post the role · shortlist in minutes · hired by minute 60');
    expect(SECTIONS[0].cards[0].title).toBe('The 60-minute flow');
    expect(FAQ[0][1].map(([q]) => q)).toContain('What does “Hired in 60 minutes” mean?');
    expect(META.title).toBe('Nm7 — Hire in 60 minutes. Get hired fast.');
    const all = JSON.stringify({ AUDIENCES, SECTIONS, FAQ, META, sd: structuredData() });
    expect(all).not.toMatch(/Blinkit|30 minutes|30-minute|hired in 30/i);
  });
  it('the rest of the site says 60 too (badge, speed, public page; English, Telugu, Hindi)', () => {
    expect(translate('en', 'co.speed.badge')).toBe('Hired in 60 minutes');
    expect(translate('en', 'co.pub.hired30Why')).toContain('within 60 minutes');
    expect(translate('en', 'co.speed.pct', { pct: 50, n: 1, total: 2 })).toContain('within 60 minutes');
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

describe('the CUTE-orb dots (round O)', () => {
  // the visible dots (spares stacked on a drawn dot count once) and each one's distance to its nearest neighbour
  const visible = (p) => [...new Map(Array.from({ length: p.length / 3 }, (_, i) => [p[i * 3], p[i * 3 + 1], p[i * 3 + 2]]).map((q) => [q.map((v) => v.toFixed(4)).join(), q])).values()];
  const gaps = (q) => q.map((a, i) => Math.min(...q.map((b, j) => (i === j ? 9 : Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]))))).sort((a, b) => a - b);
  it.each(SHAPE_NAMES.filter((n) => n !== 'sphere'))('%s: a dotted line drawing, most dots on its outlines, evenly spaced', (name) => {
    const p = shapePoints(name, 1100);
    expect(p.length).toBe(1100 * 3);
    expect(p.outline).toBeGreaterThanOrEqual(0.85); // outlines and details; the inside fill stays light
    const g = gaps(visible(p));
    const median = g[g.length >> 1];
    expect(median).toBeGreaterThan(SPACING * 0.75); // dots stay dots: never merged into a solid line
    expect(median).toBeLessThan(SPACING * 1.15);
    expect(g[0]).toBeGreaterThan(median * 0.1); // no two drawn dots on the same spot
  });
  it('the sphere is latitude rings, each with evenly spaced dots', () => {
    const p = shapePoints('sphere', 1100);
    const byRing = new Map();
    for (let i = 0; i < 1100; i += 1) { const y = p[i * 3 + 1].toFixed(5); if (!byRing.has(y)) byRing.set(y, []); byRing.get(y).push(Math.atan2(p[i * 3 + 2], p[i * 3])); }
    expect(byRing.size).toBeGreaterThan(20);
    expect(byRing.size).toBeLessThan(45);
    for (const angles of byRing.values()) {
      if (angles.length < 3) continue;
      const step = (Math.PI * 2) / angles.length;
      const sorted = angles.map((a) => (a + Math.PI * 2) % (Math.PI * 2)).sort((a, b) => a - b);
      sorted.slice(1).forEach((a, k) => expect(a - sorted[k]).toBeCloseTo(step, 5));
    }
  });
  const lum = (hex) => {
    const c = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255).map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
    return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
  };
  const onWhite = (hex) => 1.05 / (lum(hex) + 0.05);
  it('each audience shape has its own colours, clearly visible on the light page', () => {
    expect(Object.keys(SHAPE_COLORS)).toEqual(['sphere', 'stopwatch', 'college', 'briefcase', 'cap']);
    for (const [name, c] of Object.entries(SHAPE_COLORS)) {
      expect(onWhite(c.a), `${name} dots`).toBeGreaterThanOrEqual(3);
      expect(onWhite(c.b), `${name} dots`).toBeGreaterThanOrEqual(3);
      expect(c.glow).toMatch(/^#[0-9a-f]{6}$/);
    }
    expect(colorsFor('magnifier')).toBe(SHAPE_COLORS.sphere);
  });
});
