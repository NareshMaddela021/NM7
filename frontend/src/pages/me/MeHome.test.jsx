// Batch C item 20: one main score (job readiness) on the dashboard; the resume score and "Profile complete" explained.
import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter } from 'react-router-dom';
import { ScoresExplained } from './MeHome';

describe('ScoresExplained', () => {
  it('names job readiness as the main score and shows the other two numbers', () => {
    const out = renderToStaticMarkup(<MemoryRouter><ScoresExplained score={72} profilePct={85} /></MemoryRouter>);
    expect(out).toContain('What do the scores mean?');
    expect(out).toContain('Job readiness</strong> (the main score above)');
    expect(out).toContain('Resume score (ATS): 72/100');
    expect(out).toContain('Profile complete: 85%');
    expect(out).not.toContain('Profile strength');
  });
});
