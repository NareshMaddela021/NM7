import { beforeEach, describe, expect, it, vi } from 'vitest';

const http = vi.fn();
const user = { value: { role: 'customer', id: 'u1' } };
vi.mock('../../services/http', async () => {
  const real = await vi.importActual('../../services/http');
  return { ...real, LIVE: true, http: (...a) => http(...a) };
});
vi.mock('../auth', () => ({ currentUser: () => user.value }));

const { ApiError } = await import('../../services/http');
const { fromPaste, fromResumeData, hasContent, isCustomUrl, mergeSections, normalizeUrl, LIMITS } = await import('./profile');
const { keywordLine, keywordMatch, roleFrom } = await import('./keywords');
const { KEEP, checkProfile } = await import('./score');
const { englishRole, headlineFacts, headlineOk, headlineOptions, improveHeadline } = await import('./headlines');
const { LOCKED, guideSteps } = await import('./guide');
const { hasPrivate, stripPrivate } = await import('./privacy');
const { writeHeadlines } = await import('./api');

beforeEach(() => { http.mockReset(); user.value = { role: 'customer', id: 'u1' }; });

// what the LinkedIn PDF reader (lib/import/linkedin.js) returns, resume-shaped
const PDF_DATA = {
  personal: { name: 'Ravi Kumar', headline: 'Student at JNTU Hyderabad', email: 'ravi@example.com', phone: '+91 98765 43210', location: 'Hyderabad, Telangana' },
  summary: 'I am a final year student. I like computers.',
  exp: [{ company: 'Acme Analytics', role: 'Data Intern', from: '2024-01', to: '2024-06', current: false, description: 'Made weekly sales reports in Excel.' }],
  edu: [{ institution: 'JNTU Hyderabad', degree: 'B.Tech', field: 'Computer Science', from: '2020-08', to: '2024-05' }],
  skillGroups: [{ id: 'core', label: 'Core', value: 'SQL, Python, Communication' }],
  certs: [{ name: 'Google Data Analytics' }],
  proj: [], links: {},
};

const STRONG = {
  headline: 'Data Analyst | SQL · Excel · Power BI | B.Tech Computer Science (2024) | Built a sales dashboard',
  about: `Data Analyst with a B.Tech in Computer Science. I use SQL, Excel, Power BI and Python to turn raw data into dashboards and clear reporting. ${'During my internship at Acme Analytics I cleaned sales data, built a Power BI dashboard used by 12 store managers and automated weekly reporting with Python and Tableau. '.repeat(4)}Open to Data Analyst roles in Hyderabad or remote.`,
  experience: [{ title: 'Data Analyst Intern', company: 'Acme Analytics', dates: '2024 - Present', text: 'Built a Power BI dashboard for 12 store managers. Cut report time from 3 hours to 20 minutes with SQL.' }],
  skills: ['SQL', 'Excel', 'Power BI', 'Tableau', 'Python', 'Dashboards', 'Data Visualization', 'Statistics', 'Data Cleaning', 'Reporting'],
  education: [{ school: 'JNTU Hyderabad', degree: 'B.Tech, Computer Science', year: '2024' }],
  certs: ['Google Data Analytics'], projects: ['Sales dashboard'], location: 'Hyderabad',
};
const ALL_TICKED = { photo: true, banner: true, featured: true, openToWork: true };

describe('the profile link', () => {
  it('keeps only linkedin.com/in/... links, normalized', () => {
    expect(normalizeUrl('linkedin.com/in/ravi-kumar')).toBe('https://www.linkedin.com/in/ravi-kumar');
    expect(normalizeUrl('https://in.linkedin.com/in/ravi_k/?trk=x')).toBe('https://www.linkedin.com/in/ravi_k');
    expect(normalizeUrl('')).toBe('');
    for (const bad of ['https://www.linkedin.com/company/nm7', 'linkedin.com/feed', 'https://linkedin.com.evil.example/in/ravi', 'ravi kumar']) expect(normalizeUrl(bad)).toBeNull();
  });
  it('tells a custom URL from LinkedIn’s random one', () => {
    expect(isCustomUrl('https://www.linkedin.com/in/ravi-kumar')).toBe(true);
    expect(isCustomUrl('https://www.linkedin.com/in/ravi-kumar-4b2a91a3')).toBe(false);
    expect(isCustomUrl('')).toBeNull();
  });
});

describe('sections', () => {
  it('come from the LinkedIn PDF reader’s data', () => {
    const s = fromResumeData(PDF_DATA);
    expect(s.headline).toBe('Student at JNTU Hyderabad');
    expect(s.experience[0]).toEqual({ title: 'Data Intern', company: 'Acme Analytics', dates: '2024 - 2024', text: 'Made weekly sales reports in Excel.' });
    expect(s.skills).toEqual(['SQL', 'Python', 'Communication']);
    expect(s.education[0].degree).toBe('B.Tech, Computer Science');
    expect(JSON.stringify(s)).not.toMatch(/98765|ravi@example/); // contact details are never part of the sections
  });
  it('come from pasted boxes: one role per block, title "at" company', () => {
    const s = fromPaste({ headline: 'Data Analyst\n| SQL', about: 'Hi', experience: 'Data Intern at Acme\nMade reports\n\nTutor\nTaught maths', skills: 'SQL, Excel\nPower BI' });
    expect(s.headline).toBe('Data Analyst | SQL');
    expect(s.experience).toEqual([{ title: 'Data Intern', company: 'Acme', dates: '', text: 'Made reports' }, { title: 'Tutor', company: '', dates: '', text: 'Taught maths' }]);
    expect(s.skills).toEqual(['SQL', 'Excel', 'Power BI']);
  });
  it('a link alone is not content; pasted sections fill what the PDF left empty', () => {
    expect(hasContent(fromPaste({}))).toBe(false);
    const m = mergeSections(fromPaste({ headline: 'A' }), fromPaste({ headline: 'B', about: 'From paste' }));
    expect(m.headline).toBe('A');
    expect(m.about).toBe('From paste');
  });
});

describe('keywords', () => {
  it('take the role from the box, else the headline', () => {
    expect(roleFrom('Data Analyst', 'Student')).toBe('Data Analyst');
    expect(roleFrom('', 'Aspiring Data Analyst | SQL')).toBe('Data Analyst');
  });
  it('say which words for the role are missing', () => {
    const m = keywordMatch('Data Analyst', 'SQL, Power BI, Tableau, Python, Data Visualization, Statistics, Data Cleaning, Reporting');
    expect(m.missing).toEqual(['Excel', 'Dashboards']);
    expect(keywordLine(m)).toBe('Data Analyst: missing Excel, Dashboards');
    expect(keywordMatch('Astronaut', 'x').known).toBe(false);
  });
});

describe('the check', () => {
  it('scores a weak profile low, with the biggest fixes first', () => {
    const r = checkProfile(fromResumeData(PDF_DATA), { role: 'Data Analyst', url: 'https://www.linkedin.com/in/ravi-kumar-4b2a91a3' });
    expect(r.score).toBeGreaterThan(0);
    expect(r.score).toBeLessThan(45);
    expect(r.top).toHaveLength(3);
    for (const t of r.top) expect(t.what && t.why && t.fix).toBeTruthy();
    const head = r.items.find((i) => i.id === 'headline');
    expect(head.issues.map((i) => i.what)).toContain('Your headline doesn\'t say "Data Analyst".');
    expect(r.items.find((i) => i.id === 'url').issues[0].what).toBe('Your link ends in a random code.');
    expect(r.keywordLine).toMatch(/^Data Analyst: missing Power BI, Tableau/); // Excel is in the internship text
  });
  it('a strong profile scores 100 and every section says "Keep as it is"', () => {
    const r = checkProfile(STRONG, { role: 'Data Analyst', url: 'https://www.linkedin.com/in/ravi-kumar', checklist: ALL_TICKED });
    expect(r.items.filter((i) => !i.good).map((i) => [i.id, i.issues])).toEqual([]);
    expect(r.score).toBe(100);
    expect(r.items.every((i) => i.keep === KEEP)).toBe(true);
    expect(r.top).toEqual([]);
  });
  it('a good section keeps "Keep as it is" while others get fixes', () => {
    const r = checkProfile({ ...STRONG, about: '' }, { role: 'Data Analyst' });
    expect(r.items.find((i) => i.id === 'headline').keep).toBe(KEEP);
    expect(r.items.find((i) => i.id === 'about').keep).toBe('');
    expect(r.items.find((i) => i.id === 'about').points).toBe(0);
  });
  it('flags LinkedIn’s limits', () => {
    const r = checkProfile({ ...STRONG, headline: `${STRONG.headline} ${'x'.repeat(200)}`, about: 'Data Analyst. '.repeat(200), experience: [{ ...STRONG.experience[0], text: 'y'.repeat(2001) }] }, { role: 'Data Analyst' });
    const what = r.items.flatMap((i) => i.issues.map((x) => x.what)).join('\n');
    expect(what).toMatch(/LinkedIn allows 220/);
    expect(what).toMatch(/LinkedIn allows 2,600/);
    expect(what).toMatch(/over 2,000 characters/);
    expect(LIMITS).toEqual({ headline: 220, about: 2600, experience: 2000 });
  });
  it('flags a phone, email or ID number in public text', () => {
    const r = checkProfile({ ...STRONG, about: `${STRONG.about} Call 98765 43210.` }, { role: 'Data Analyst' });
    expect(r.items.find((i) => i.id === 'about').issues.map((i) => i.what)).toContain('It has a phone number, email or ID number.');
  });
});

describe('headlines (rules)', () => {
  it('give 5 options, each at most 220 characters, from the facts only', () => {
    const f = headlineFacts({ sections: fromResumeData(PDF_DATA), role: 'Data Analyst' });
    expect(f.skills.slice(0, 2)).toEqual(['SQL', 'Python']);
    const hs = headlineOptions(f, 5);
    expect(hs).toHaveLength(5);
    for (const h of hs) {
      expect(h.length).toBeLessThanOrEqual(220);
      expect(h).toMatch(/Data Analyst/);
      expect(hasPrivate(h)).toBe(false);
      expect(h).not.toMatch(/98765|ravi@|Ravi Kumar/);
      expect(headlineOk(h, f)).toBe(true);
    }
  });
  it('the free before → after differs from the current headline', () => {
    const f = headlineFacts({ sections: fromResumeData(PDF_DATA), role: 'Data Analyst' });
    const after = improveHeadline('Student at JNTU Hyderabad', f);
    expect(after).toMatch(/^Data Analyst \| /);
    expect(after).not.toBe('Student at JNTU Hyderabad');
  });
  it('work from details only (no resume); experience left out when empty', () => {
    const details = { role: 'Web Developer', city: 'Vijayawada', education: [{ degree: 'BCA', school: 'Andhra Loyola College', year: '2025' }], skills: 'HTML, CSS, JavaScript, React', projects: 'Portfolio website', certs: '', work: [] };
    const f = headlineFacts({ details });
    expect(f.current).toBe('');
    const hs = headlineOptions(f, 5);
    expect(hs.length).toBe(5);
    expect(hs.join('\n')).toMatch(/Built Portfolio website/);
    expect(hs.join('\n')).not.toMatch(/ at /); // no invented employer
    const steps = guideSteps('en', { headline: hs[0], skills: f.skills, experience: [] });
    expect(steps.map((s) => s.id)).toEqual(['signup', 'photo', 'headline', 'about', 'skills', 'openToWork']);
  });
  it('Telugu or Hindi input gives English headlines', () => {
    expect(englishRole('డేటా అనలిస్ట్', 'naku data analyst job kavali')).toMatch(/Data Analyst/i);
    const f = headlineFacts({ details: { role: 'डेटा एनालिस्ट', skills: 'Excel, SQL, एक्सेल' }, note: 'mujhe data analyst job chahiye. maine BCom kiya hai' });
    const hs = headlineOptions(f, 5);
    expect(hs.length).toBeGreaterThan(0);
    for (const h of hs) expect(h).toMatch(/^[\p{Script=Latin}\p{N}\p{P}\p{S}\s]+$/u);
  });
  it('never a number that isn’t in the facts', () => {
    const f = { target: 'Data Analyst', skills: ['SQL'], degree: 'B.Tech', year: '2024' };
    expect(headlineOk('Data Analyst | 3 years of SQL', f)).toBe(false);
    expect(headlineOk('Data Analyst | B.Tech (2024)', f)).toBe(true);
    expect(headlineOk('Data Analyst | call 98765 43210', { ...f, x: '98765 43210' })).toBe(false);
  });
  it('nothing to work with gives no options', () => {
    expect(headlineOptions({}, 5)).toEqual([]);
  });
});

describe('the guide', () => {
  it('has the 7 steps in English, Telugu and Hindi; Telugu and Hindi are marked for review', () => {
    const content = { headline: 'Data Analyst | SQL', skills: ['SQL', 'Excel'], experience: [{ title: 'Data Intern', company: 'Acme' }], role: 'Data Analyst' };
    for (const lang of ['en', 'te', 'hi']) {
      const steps = guideSteps(lang, content);
      expect(steps.map((s) => s.id)).toEqual(['signup', 'photo', 'headline', 'about', 'experience', 'skills', 'openToWork']);
      expect(steps.every((s) => s.title && s.body)).toBe(true);
      expect(steps.find((s) => s.id === 'headline').copy).toBe('Data Analyst | SQL'); // copy text stays English
      expect(steps.find((s) => s.id === 'skills').copy).toBe('SQL, Excel');
      expect(steps.find((s) => s.id === 'experience').copy).toBe('Data Intern at Acme');
      expect(steps.find((s) => s.id === 'about').locked).toEqual(LOCKED[0]);
      expect(steps[0].review).toBe(lang !== 'en');
    }
    expect(guideSteps('te')[0].title).toMatch(/[ఀ-౿]/);
    expect(guideSteps('hi')[0].title).toMatch(/[ऀ-ॿ]/);
  });
});

describe('privacy', () => {
  it('strips phone, email and ID numbers', () => {
    expect(stripPrivate('Data Analyst | 98765 43210 | ravi@example.com | 2345 6789 0123 | ABCPE1234F')).toBe('Data Analyst');
  });
});

describe('AI headlines', () => {
  const f = { target: 'Data Analyst', skills: ['SQL', 'Excel'], degree: 'B.Tech', year: '2024' };
  it('AI’s headlines first (checked again here), topped up by the rules', async () => {
    http.mockResolvedValue({ headlines: ['Data Analyst | SQL and Excel | B.Tech 2024 graduate', 'Data Analyst with 5 years at Infosys'] });
    const r = await writeHeadlines(f, { count: 5, note: 'naku data analyst job kavali' });
    expect(http).toHaveBeenCalledWith('/api/me/linkedin/headlines', expect.objectContaining({ method: 'POST' }));
    const body = http.mock.calls[0][1].body;
    expect(Object.keys(body.facts).sort()).toEqual(['degree', 'skills', 'target']);
    expect(r.ai).toBe(1);
    expect(r.headlines[0]).toBe('Data Analyst | SQL and Excel | B.Tech 2024 graduate');
    expect(r.headlines.join('\n')).not.toMatch(/Infosys|5 years/);
    expect(r.headlines.length).toBeGreaterThan(1);
  });
  it.each([[new ApiError(503, 'feature_off', 'off'), 'AI is busy. Here are quick suggestions.'], [new ApiError(429, 'rate_limited', 'You can write LinkedIn headlines with AI 10 times a day. Here are quick suggestions instead.'), 'You can write LinkedIn headlines with AI 10 times a day. Here are quick suggestions instead.'], [new ApiError(0, 'network', 'x'), 'AI is busy. Here are quick suggestions.']])('falls back to the rules, never an error (%s)', async (err, notice) => {
    http.mockRejectedValue(err);
    const r = await writeHeadlines(f, { count: 5 });
    expect(r.ai).toBe(0);
    expect(r.headlines.length).toBeGreaterThan(0);
    expect(r.notice).toBe(notice);
  });
  it('signed out: the rules only, no call', async () => {
    user.value = null;
    const r = await writeHeadlines(f, { count: 3 });
    expect(http).not.toHaveBeenCalled();
    expect(r.headlines.length).toBeGreaterThan(0);
  });
});
