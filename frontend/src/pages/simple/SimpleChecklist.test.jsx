// Profile setup P4: the Easy dashboard's setup checklist: the card (progress, the next step in simple words, one big
// button, Skip for now, See all steps), the steps page, Telugu / Hindi strings, easy links, and the lazy chunk.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter } from 'react-router-dom';
import { CardView, EASY_LINKS, StepsView, easyLink, tsFor, words } from './SimpleChecklist';
import SETUP from '../../i18n/setup.json';
// the individual roles' steps in backend/app/setup/registry.py
const STEP_IDS = {
  jobseeker: ['preferences', 'education', 'resume', 'papers', 'skill', 'identity', 'interview', 'autoapply'],
  student: ['skills', 'resume', 'practice', 'skill', 'group', 'apply'],
  expert: ['profile', 'services', 'availability', 'identity', 'calibration', 'payout', 'submit'],
};

const t = (k, v) => (v ? `${k} ${JSON.stringify(v)}` : k);
const step = (id, status, extra = {}) => ({ id, title: `Server ${id}`, reward: `Server reward ${id}.`, minutes: 3, link: `/me/${id}`, required: true, skipped: false, testersOnly: false, status, ...extra });
const base = {
  role: 'jobseeker', next: 'resume', done: 1, total: 4, percent: 25, complete: false, renewals: [], level: null,
  steps: [step('preferences', 'done'), step('resume', 'next'), step('skill', 'waiting'), step('identity', 'later', { required: false }), step('autoapply', 'later', { skipped: true })],
};
const card = (c, lang = 'en', extra = {}) => renderToStaticMarkup(<MemoryRouter><CardView c={c} t={t} lang={lang} busy={false} note="" onSkip={() => {}} {...extra} /></MemoryRouter>);
const page = (c, lang = 'en') => renderToStaticMarkup(<MemoryRouter><StepsView c={c} t={t} lang={lang} busy={false} note="" onSkip={() => {}} /></MemoryRouter>);

describe('the Easy dashboard setup card', () => {
  it('shows the progress, the next step in simple words, one big button, Skip for now and See all steps', () => {
    const out = card(base);
    expect(out).toContain('Set up your profile');
    expect(out).toContain('1 of 4 steps done');
    expect(out).toContain('role="progressbar"');
    expect(out).toContain('aria-valuenow="1"');
    expect(out).toContain('Make your resume score 60 or more'); // simple words, not "ATS"
    expect(out).not.toContain('ATS');
    expect(out).toMatch(/<a(?=[^>]*href="\/me\/simple\/fixes")(?=[^>]*data-testid="sx-setup-go")[^>]*>/);
    expect(out).toContain('Skip for now');
    expect(out).toMatch(/href="\/me\/simple\/setup"[^>]*>.*See all steps \(5\)/);
    expect(out).toContain('About 3 minutes');
  });
  it('Telugu and Hindi', () => {
    expect(card(base, 'te')).toContain('ఇప్పటికి వదిలేయండి');
    expect(card(base, 'te')).toContain('4 లో 1 దశలు పూర్తయ్యాయి');
    expect(card(base, 'hi')).toContain('अभी छोड़ें');
    expect(card(base, 'hi')).toContain('4 में से 1 स्टेप पूरे');
  });
  it('waiting only, complete, nothing', () => {
    const waiting = { ...base, next: null, steps: [step('preferences', 'done'), step('skill', 'waiting')] };
    expect(card(waiting)).toContain('data-testid="sx-setup-waiting"');
    expect(card(waiting)).not.toContain('sx-setup-go');
    expect(card({ ...base, complete: true })).toContain('Profile complete');
    expect(card(null)).toBe('');
    expect(card({ ...base, steps: [], renewals: [] })).toBe('');
  });
  it('a step without its own simple words uses the server words; links go to easy screens where there is one', () => {
    const ts = tsFor('en');
    expect(words(ts, 'jobseeker', step('brand_new', 'next'))).toEqual({ title: 'Server brand_new', text: 'Server reward brand_new.' });
    expect(easyLink('student', step('resume', 'next'))).toBe('/me/simple/resume');
    expect(easyLink('jobseeker', step('preferences', 'next'))).toBe('/me/preferences');
    for (const path of Object.values(EASY_LINKS)) expect(path.startsWith('/me/simple/')).toBe(true);
  });
});

describe('the steps page', () => {
  it('lists every step with its status and big buttons; Skip for now only on open steps not skipped', () => {
    const out = page(base);
    for (const [id, s] of [['preferences', 'done'], ['resume', 'next'], ['skill', 'waiting'], ['identity', 'later'], ['autoapply', 'later']]) expect(out).toContain(`data-step="${id}" data-status="${s}"`);
    expect(out).toContain('Being checked');
    expect(out).toContain('Do next');
    expect(out).toContain('You can skip this');
    expect(out).toContain('You skipped this for now');
    expect(out.match(/data-testid="sx-step-skip"/g)).toHaveLength(2);
    expect(out.match(/data-testid="sx-step-go"/g)).toHaveLength(3);
    expect(out).toContain('simple.back');
  });
  it('says so when there is nothing', () => {
    expect(page({ ...base, steps: [] })).toContain('No profile steps for you right now.');
  });
});

describe('the strings (src/i18n/setup.json)', () => {
  it('every step of every individual role has simple words, in all three languages, with the same {values}', () => {
    const holes = (s) => (s.match(/\{\w+\}/g) || []).sort();
    for (const [role, ids] of Object.entries(STEP_IDS)) for (const id of ids) for (const part of ['title', 'text']) expect(SETUP.en[`setup.s.${role}.${id}.${part}`], `${role}.${id}`).toBeTruthy();
    for (const lang of ['te', 'hi']) {
      expect(Object.keys(SETUP[lang]).sort()).toEqual(Object.keys(SETUP.en).sort());
      for (const [k, v] of Object.entries(SETUP[lang])) {
        expect(holes(v), `${lang} ${k}`).toEqual(holes(SETUP.en[k]));
        expect(v, `${lang} ${k}`).not.toBe(SETUP.en[k]);
        expect((lang === 'te' ? /[ఀ-౿]/ : /[ऀ-ॿ]/).test(v), `${lang} ${k}`).toBe(true);
      }
    }
    expect(SETUP._note).toContain('NEED NATIVE REVIEW');
  });
});

describe('the lazy chunk', () => {
  it('SimpleApp loads the setup steps lazily, never with a static import', () => {
    const src = readFileSync(join(__dirname, 'SimpleApp.jsx'), 'utf8');
    expect(src).toContain("import('./SimpleChecklist')");
    expect(src).not.toMatch(/^import .*SimpleChecklist/m);
    expect(src).not.toMatch(/^import .*(setup\.json|lib\/checklist|components\/icons)/m);
    const mine = readFileSync(join(__dirname, 'SimpleChecklist.jsx'), 'utf8');
    expect(mine).not.toContain('components/icons');
  });
});
