// View · Apply · Save on job cards: signed out (the create-account / sign-in dialog with the way back to the job),
// signed in on a job on Nm7 (the job page's apply steps) or on the company's site (the link opens), and "Applied".
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter } from 'react-router-dom';

let who = null;
vi.mock('../lib/auth', () => ({ useAuth: () => ({ user: who }), LIVE: false }));

const { default: JobActions, AuthAsk, applyPath } = await import('./JobActions');
const { markApplied, resetApplied } = await import('../lib/jobBoard');

const nm7 = { id: 'j1', slug: 'qa-trainee-acme-1', title: 'QA Trainee', status: 'active', company: { name: 'Acme' }, apply: { method: 'nm7', url: '' } };
const ext = { id: 'j2', slug: 'analyst-acme-2', title: 'Data Analyst', status: 'active', company: { name: 'Acme' }, apply: { method: 'link', url: 'https://acme.example/jobs/2' } };
const html = (el) => renderToStaticMarkup(<MemoryRouter>{el}</MemoryRouter>);

describe('JobActions', () => {
  beforeEach(() => { who = null; resetApplied(); });

  it('shows View, Apply and Save in one group; View opens the job page', () => {
    const out = html(<JobActions job={nm7} />);
    expect(out).toContain('data-testid="job-actions"');
    expect(out).toContain('href="/jobs/qa-trainee-acme-1"');
    expect(out).toMatch(/data-testid="card-view"[^>]*>View</);
    expect(out).toContain('data-testid="card-apply"');
    expect(out).toContain('data-testid="card-save"');
    expect(out.indexOf('card-view')).toBeLessThan(out.indexOf('card-apply'));
    expect(out.indexOf('card-apply')).toBeLessThan(out.indexOf('card-save'));
  });

  it('signed out: Apply is a button (it asks to create an account or sign in), even for a company-site job', () => {
    for (const job of [nm7, ext]) {
      const out = html(<JobActions job={job} titleId="jt-1" />);
      expect(out).toMatch(/<button[^>]*aria-describedby="jt-1"[^>]*data-testid="card-apply"[^>]*>Apply</);
      expect(out).toMatch(/aria-describedby="jt-1"[^>]*data-testid="card-view"/);
      expect(out).not.toContain('acme.example');
    }
  });

  it('the sign-up and sign-in dialog keeps the way back to the job and the wish to apply', () => {
    expect(applyPath('qa-trainee-acme-1')).toBe('/jobs/qa-trainee-acme-1?apply=1');
    const out = html(<AuthAsk job={nm7} onClose={() => {}} />);
    const next = encodeURIComponent('/jobs/qa-trainee-acme-1?apply=1');
    expect(out).toContain(`href="/signup?next=${next}"`);
    expect(out).toContain(`href="/login?next=${next}"`);
    expect(out).toContain('Create free account');
    expect(out).toContain('Sign in');
    expect(out).not.toContain('apply-ask-direct'); // a job on Nm7 has no outside site
    expect(html(<AuthAsk job={ext} onClose={() => {}} />)).toContain('href="https://acme.example/jobs/2"');
  });

  it('signed in: a company-site job opens the site in a new tab; a job on Nm7 opens the apply steps', () => {
    who = { id: 'u1', role: 'customer' };
    const out = html(<JobActions job={ext} />);
    expect(out).toMatch(/<a[^>]*href="https:\/\/acme\.example\/jobs\/2"[^>]*target="_blank"[^>]*data-testid="card-apply"/);
    expect(out).toContain('rel="noopener noreferrer nofollow"');
    const onNm7 = html(<JobActions job={nm7} />);
    expect(onNm7).toMatch(/<button[^>]*data-testid="card-apply"/);
    expect(onNm7).not.toContain('target="_blank"');
  });

  it('applied: "Applied" with a tick, disabled, instead of Apply', () => {
    who = { id: 'u1', role: 'customer' };
    markApplied('j1');
    const out = html(<JobActions job={nm7} />);
    expect(out).toMatch(/<button[^>]*disabled=""[^>]*data-testid="card-applied"[^>]*><svg[^]*?<\/svg>Applied</);
    expect(out).not.toContain('card-apply"');
    expect(html(<JobActions job={ext} />)).toContain('data-testid="card-apply"'); // other jobs unchanged
  });

  it('a closed job: View only', () => {
    const out = html(<JobActions job={{ ...nm7, status: 'closed' }} />);
    expect(out).toContain('card-view');
    expect(out).not.toContain('card-apply');
    expect(out).not.toContain('card-save');
  });
});
