import { describe, expect, it } from 'vitest';
import { INITIAL } from '../pages/builder/schema';
import {
  applyUpdate, emptyProfile, entryChanged, mergeIntoProfile, normalizeProfile, profileCompleteness, profileToResume,
  profileUpdates, resumeToProfileParts, saveEntryToProfile, sourcesFor, toResumeEntry,
} from './jobProfile';

const user = { name: 'Asha K', email: 'asha@example.com', phone: '' };
function full() {
  const p = normalizeProfile({
    personal: { name: 'Asha K', headline: 'Data Analyst', email: 'asha@example.com', phone: '98765 43210', location: 'Chennai' },
    links: { linkedin: 'linkedin.com/in/asha', github: 'github.com/asha', portfolio: '' },
    summaries: [{ id: 's1', name: 'Main', text: 'Data analyst who turns messy sales data into dashboards that managers use every week.' }, { id: 's2', name: 'Short', text: 'Analyst.' }],
    exp: [{ company: 'Zoho', role: 'Analyst', from: '2024-01', to: '', current: true, description: 'Built reports' }],
    intern: [{ company: 'TCS', role: 'Data Intern', from: '2023-01', to: '2023-06', description: 'Cleaned data' }],
    proj: [{ title: 'Sales Dashboard', tech: 'Power BI' }],
    edu: [{ institution: 'Anna University', degree: 'B.Tech' }],
    certs: [{ name: 'Google Data Analytics' }], ach: [{ title: 'Hackathon winner' }], langs: [{ name: 'Tamil', level: 'Native' }],
    extra: [{ title: 'NSS volunteer', description: 'Ran blood donation camps' }],
    skillGroups: [{ id: 'core', label: 'Core', value: 'Python, SQL, Excel, Power BI, Statistics' }],
    hobbies: 'Chess', strengths: '', pinfo: { father: 'K. Raman', dob: '2001-02-03' },
    prefs: { targetRoles: 'Data Analyst', cities: 'Chennai, Bengaluru', level: 'Fresher (0–1 yr)', notice: '30 days', salaryMin: '6', salaryMax: '9' },
  }, user);
  p.exp[0].off = true;
  return p;
}

describe('Job Profile', () => {
  it('starts empty with the account name/email and every entry gets a pid', () => {
    const p = normalizeProfile(null, user);
    expect(p.personal.name).toBe('Asha K');
    expect(p.personal.email).toBe('asha@example.com');
    expect(profileCompleteness(p).pct).toBeLessThan(20);
    expect(full().proj[0].pid).toBeTruthy();
  });

  it('measures completeness and lists what is missing', () => {
    expect(profileCompleteness(full())).toEqual({ pct: 100, missing: [] });
    const c = profileCompleteness(emptyProfile(user));
    expect(c.missing).toContain('Phone');
    expect(c.missing).toContain('Job preferences');
  });

  it('a new resume from the profile copies every section, never the salary', () => {
    const p = full();
    const d = profileToResume(p, INITIAL);
    expect(d.personal).toMatchObject({ name: 'Asha K', headline: 'Data Analyst', phone: '98765 43210', location: 'Chennai', level: 'Fresher (0–1 yr)' });
    expect(d.summary).toMatch(/^Data analyst who/);
    expect(d.exp.map((e) => e.company)).toEqual(['Zoho', 'TCS']);
    expect(d.exp[0].off).toBe(true); // hidden in the profile stays hidden
    expect(d.exp[1].employmentType).toBe('Internship');
    expect(d.proj[0]).toMatchObject({ title: 'Sales Dashboard', pid: p.proj[0].pid, pv: p.proj[0].pu });
    expect(d.edu[0].institution).toBe('Anna University');
    expect(d.certs[0].name).toBe('Google Data Analytics');
    expect(d.ach[0].title).toBe('Hackathon winner');
    expect(d.langs[0].name).toBe('Tamil');
    expect(d.custom).toEqual([expect.objectContaining({ title: 'Extracurricular Activities', items: [expect.objectContaining({ title: 'NSS volunteer' })] })]);
    expect(d.skillGroups[0].value).toBe('Python, SQL, Excel, Power BI, Statistics');
    expect(d.hobbies).toBe('Chess');
    expect(d.hidden.strengths).toBe(true);
    expect(d.pinfo.father).toBe('K. Raman');
    expect(d.links.linkedin).toBe('linkedin.com/in/asha');
    expect(d.prefs.locations).toBe('Chennai, Bengaluru');
    expect(JSON.stringify(d)).not.toMatch(/salaryMin|salaryMax/);
    expect(d.proj[0].pu).toBeUndefined();
    expect(JSON.stringify(d.fromProfile)).not.toContain('98765'); // fingerprints, not the values
  });

  it('sources for a resume section include internships under experience', () => {
    const p = full();
    expect(sourcesFor(p, 'exp').map((s) => s.list)).toEqual(['exp', 'intern']);
    expect(toResumeEntry(sourcesFor(p, 'exp')[1]).employmentType).toBe('Internship');
    expect(sourcesFor(p, 'skills')).toHaveLength(1);
  });

  it('import adds only what is new and never overwrites', () => {
    const p = full();
    const parts = resumeToProfileParts({ ...INITIAL, personal: { ...INITIAL.personal, name: 'Someone Else' }, exp: [...INITIAL.exp, { company: 'Zoho', role: 'Analyst' }] });
    const { profile, added } = mergeIntoProfile(p, parts);
    expect(profile.personal.name).toBe('Asha K');
    expect(profile.exp).toHaveLength(1); // Zoho already there
    expect(profile.intern.map((x) => x.company)).toEqual(['TCS', 'Northwind Retail']); // INITIAL's internship
    expect(profile.edu).toHaveLength(2);
    expect(profile.skillGroups.find((g) => g.id === 'frameworks').value).toBe('Pandas, NumPy'); // a group the profile didn't have
    expect(added).toBeGreaterThan(3);
    expect(mergeIntoProfile(profile, parts).added).toBe(0); // second time: nothing new
  });

  it('editing a resume entry does not touch the profile until it is saved', () => {
    const p = full();
    const d = profileToResume(p, INITIAL);
    expect(entryChanged(p, d.proj[0])).toBe(false);
    d.proj[0] = { ...d.proj[0], tech: 'Power BI, DAX' };
    expect(entryChanged(p, d.proj[0])).toBe(true);
    expect(p.proj[0].tech).toBe('Power BI');
    const { profile, pid } = saveEntryToProfile(p, d.proj[0], 'proj');
    expect(pid).toBe(p.proj[0].pid);
    expect(profile.proj[0].tech).toBe('Power BI, DAX');
    // a new entry the profile doesn't have yet is added (internship → internships)
    const s = saveEntryToProfile(p, { company: 'Infosys', role: 'Intern', employmentType: 'Internship' }, 'exp');
    expect(s.profile.intern.map((x) => x.company)).toContain('Infosys');
  });

  it('lists profile updates a resume has not taken and accepts or skips each', () => {
    const p = full();
    const d = profileToResume(p, INITIAL);
    expect(profileUpdates(d, p)).toEqual([]);
    const later = structuredClone(p);
    later.proj[0] = { ...later.proj[0], tech: 'Power BI, SQL', pu: later.proj[0].pu + 1000 };
    later.personal.phone = '91234 56789';
    const ups = profileUpdates(d, later);
    expect(ups.map((u) => u.key).sort()).toEqual(['personal:phone', `proj:${p.proj[0].pid}`]);
    let next = applyUpdate(d, ups.find((u) => u.section === 'proj'), true);
    expect(next.proj[0].tech).toBe('Power BI, SQL');
    next = applyUpdate(next, ups.find((u) => u.section === 'personal'), false);
    expect(next.personal.phone).toBe('98765 43210'); // skipped
    expect(profileUpdates(next, later)).toEqual([]); // and not asked again
    // a field the user changed in the resume is theirs: not offered
    const own = { ...d, personal: { ...d.personal, phone: '99999 00000' } };
    expect(profileUpdates(own, later).some((u) => u.section === 'personal')).toBe(false);
  });
});
