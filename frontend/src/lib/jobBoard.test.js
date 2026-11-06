// The job board helpers: filters ⇄ URL, salary and "posted … ago" text, and the Google JobPosting data (the fields
// Google's Rich Results test needs, remote jobs, salary in INR, closed jobs without the markup).
import { describe, expect, it } from 'vitest';
import { translate } from './i18n';
import { descriptionHtml, fromQuery, jobPostingJsonLd, jobPostingProblems, pageQuery, placeText, postedAgo, salaryText, toQuery } from './jobBoard';
import PAGES from '../i18n/pages.json';

const t = (k, v) => translate('en', k, v);
const JOB = {
  id: 'j1', slug: 'junior-data-analyst-acme-ab12cd', title: 'Junior Data Analyst',
  company: { name: 'Acme Analytics', website: 'https://acme.example', logo: '' },
  locations: ['Hyderabad', 'Pune'], remote: false, workType: 'hybrid', jobType: 'full_time', experience: 'fresher',
  salary: { min: 300000, max: 450000, period: 'yearly' }, skills: ['SQL', 'Power BI'], status: 'active',
  postedAt: Date.UTC(2026, 10, 4, 1), closesAt: Date.UTC(2026, 11, 6), apply: { method: 'link', url: 'https://acme.example/c/1' },
  description: 'Build dashboards <weekly>.\nUse SQL & Power BI.\n\nFreshers welcome.',
};

describe('filters in the URL', () => {
  it('reads only known values and writes them back in a fixed order', () => {
    const f = fromQuery('?q=+java+&experience=fresher&city=remote&jobType=nope&salary=300000&posted=24h&x=1');
    expect(f).toEqual({ q: 'java', experience: 'fresher', city: 'remote', salary: 300000, posted: '24h' });
    expect(toQuery(f)).toEqual({ q: 'java', experience: 'fresher', remote: 'true', salary: '300000', posted: '24h' });
    expect(pageQuery(f)).toBe('q=java&experience=fresher&city=remote&salary=300000&posted=24h');
    expect(fromQuery('salary=12345')).toEqual({}); // not one of the choices
    expect(toQuery({ city: 'Chennai', workType: 'onsite' })).toEqual({ city: 'Chennai', workType: 'onsite' });
  });
});

describe('text', () => {
  it('salary in rupees, Indian grouping, a year / a month, or nothing', () => {
    expect(salaryText(JOB.salary, t)).toBe('₹3,00,000 – ₹4,50,000 a year');
    expect(salaryText({ min: 25000, max: null, period: 'monthly' }, t)).toBe('From ₹25,000 a month');
    expect(salaryText({ min: null, max: 900000, period: 'yearly' }, t)).toBe('Up to ₹9,00,000 a year');
    expect(salaryText({ min: 20000, max: 20000, period: 'monthly' }, t)).toBe('₹20,000 a month');
    expect(salaryText(null, t)).toBe('');
  });
  it('posted … ago', () => {
    const now = Date.UTC(2026, 10, 6, 12);
    expect(postedAgo(now - 10 * 60_000, t, now)).toBe('Posted just now');
    expect(postedAgo(now - 3_600_000, t, now)).toBe('Posted 1 hour ago');
    expect(postedAgo(now - 5 * 3_600_000, t, now)).toBe('Posted 5 hours ago');
    expect(postedAgo(now - 30 * 3_600_000, t, now)).toBe('Posted 1 day ago');
    expect(postedAgo(now - 12 * 86_400_000, t, now)).toBe('Posted 12 days ago');
    expect(translate('te', 'jobs.posted.days', { n: 2 })).toContain('2');
  });
  it('places', () => {
    expect(placeText(JOB, t)).toBe('Hyderabad, Pune');
    expect(placeText({ locations: [], remote: true }, t)).toBe('Remote');
    expect(placeText({ locations: ['Chennai'], remote: true }, t)).toBe('Remote · Chennai');
  });
  it('every job board string is in English, Telugu and Hindi', () => {
    const keys = Object.keys(PAGES.en).filter((k) => k.startsWith('jobs.'));
    expect(keys.length).toBeGreaterThan(70);
    for (const l of ['te', 'hi']) expect(keys.filter((k) => !PAGES[l][k])).toEqual([]);
  });
});

describe('Google JobPosting', () => {
  it('has what the Rich Results test needs, with the salary in INR and cities in India', () => {
    const ld = jobPostingJsonLd(JOB);
    expect(jobPostingProblems(ld)).toEqual([]);
    expect(ld).toMatchObject({
      '@context': 'https://schema.org/', '@type': 'JobPosting', title: 'Junior Data Analyst',
      datePosted: '2026-11-04T01:00:00.000Z', validThrough: '2026-12-06T00:00:00.000Z', employmentType: 'FULL_TIME',
      hiringOrganization: { '@type': 'Organization', name: 'Acme Analytics', sameAs: 'https://acme.example' },
      baseSalary: { '@type': 'MonetaryAmount', currency: 'INR', value: { '@type': 'QuantitativeValue', minValue: 300000, maxValue: 450000, unitText: 'YEAR' } },
      experienceRequirements: 'no requirements', url: 'https://nm7.si/jobs/junior-data-analyst-acme-ab12cd',
    });
    expect(ld.jobLocation).toEqual([
      { '@type': 'Place', address: { '@type': 'PostalAddress', addressLocality: 'Hyderabad', addressCountry: 'IN' } },
      { '@type': 'Place', address: { '@type': 'PostalAddress', addressLocality: 'Pune', addressCountry: 'IN' } },
    ]);
    expect(ld.description).toBe('<p>Build dashboards &lt;weekly&gt;.<br>Use SQL &amp; Power BI.</p><p>Freshers welcome.</p>');
    expect(ld.hiringOrganization.logo).toBeUndefined();
    expect(ld.jobLocationType).toBeUndefined();
    expect(JSON.parse(JSON.stringify(ld))).toEqual(ld); // plain JSON
  });
  it('remote jobs: TELECOMMUTE with India as the applicant location; monthly pay; experience in months', () => {
    const ld = jobPostingJsonLd({ ...JOB, locations: [], remote: true, workType: 'remote', jobType: 'internship', experience: '1_3', salary: { min: 15000, max: null, period: 'monthly' }, closesAt: null, apply: { method: 'nm7', url: '' } });
    expect(jobPostingProblems(ld)).toEqual([]);
    expect(ld).toMatchObject({ jobLocationType: 'TELECOMMUTE', applicantLocationRequirements: { '@type': 'Country', name: 'India' }, employmentType: 'INTERN', directApply: true });
    expect(ld.baseSalary.value).toEqual({ '@type': 'QuantitativeValue', value: 15000, unitText: 'MONTH' });
    expect(ld.experienceRequirements).toEqual({ '@type': 'OccupationalExperienceRequirements', monthsOfExperience: 12 });
    expect(ld.jobLocation).toBeUndefined();
    expect(ld.validThrough).toBeUndefined();
  });
  it('no salary → no baseSalary; one city → one Place; closed → no markup at all', () => {
    const ld = jobPostingJsonLd({ ...JOB, salary: null, locations: ['Chennai'] });
    expect(ld.baseSalary).toBeUndefined();
    expect(ld.jobLocation.address.addressLocality).toBe('Chennai');
    expect(jobPostingJsonLd({ ...JOB, status: 'closed' })).toBeNull();
    expect(jobPostingProblems({ title: 'x' })).toEqual(expect.arrayContaining(['description', 'datePosted', 'hiringOrganization', 'jobLocation']));
  });
  it('description HTML escapes everything', () => {
    expect(descriptionHtml('<script>alert(1)</script>')).toBe('<p>&lt;script&gt;alert(1)&lt;/script&gt;</p>');
  });
});
