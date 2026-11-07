// Build a resume by talking (Phase 4, E4) on a desktop and a 390 px phone, against the real API, with the microphone
// mocked: one question per screen with "n of 10", Back and Skip, an answer spoken in Telugu shown as "We heard: …"
// with Edit / OK before it is saved, chips for studies / skills / languages, "This is what we wrote" for a project
// (Accept), and everything in the same resume the full builder opens. No browser dialogs, no sideways scrolling.
import AxeBuilder from '@axe-core/playwright';
import { expect, test } from '@playwright/test';
import { SIZES, call, noSideScroll } from './college.mjs';
import { studentWith } from './autoapply.mjs';

const fakeMic = () => {
  window.webkitSpeechRecognition = class {
    start() { window.__rec = this; }
    stop() { this.onend?.(); }
    abort() {}
  };
  window.SpeechRecognition = window.webkitSpeechRecognition;
  window.__say = (text) => {
    const res = [{ transcript: text, confidence: 0.9 }];
    res.isFinal = true;
    window.__rec.onresult({ resultIndex: 0, results: [res] });
  };
};
const axe = async (page) => (await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa']).analyze()).violations
  .filter((v) => ['serious', 'critical'].includes(v.impact)).map((v) => v.id);

for (const [label, opts] of SIZES) {
  test.describe(label, () => {
    test.use(opts);

    test('one question per screen, voice with confirm, what we wrote, same resume', async ({ page }) => {
      test.setTimeout(150_000);
      page.on('dialog', () => { throw new Error('no browser dialogs'); });
      await page.addInitScript(fakeMic);
      await studentWith(page, label, { personal: {} }, 'talk');
      await page.goto('/me/simple');
      await page.getByTestId('sx-pick-te').click();
      await expect(page.getByTestId('sx-next')).toHaveAttribute('data-key', 'resume');
      await page.getByTestId('sx-next-go').click();
      const q = page.getByTestId('sx-guided');
      // 1 of 10: the name from the account, the phone typed
      await expect(page.getByTestId('sx-progress')).toHaveText('10 లో 1');
      await expect(page.getByRole('heading', { level: 1 })).toHaveText('మీ పేరు ఏమిటి?');
      await expect(page.getByTestId('sx-about-name')).toHaveValue('Asha Rao');
      await page.getByTestId('sx-about-phone').fill('98765 43210');
      expect(await axe(page)).toEqual([]);
      expect(await noSideScroll(page)).toBe(true);
      await page.getByTestId('sx-next-q').click();
      // 2: a chip and a typed branch
      await expect(q).toHaveAttribute('data-step', 'studied');
      await page.getByTestId('sx-degree-B.Tech').click();
      await expect(page.getByTestId('sx-degree-B.Tech')).toHaveAttribute('aria-pressed', 'true');
      await page.getByTestId('sx-studied-field').fill('Mechanical');
      await page.getByTestId('sx-next-q').click();
      // 3: spoken, shown first, Edit then OK
      await expect(q).toHaveAttribute('data-step', 'college');
      await page.getByTestId('sx-college-name-mic').click();
      await page.evaluate(() => window.__say('JNTU అనంతపూర్'));
      await page.getByTestId('sx-college-name-stop').click();
      await expect(page.getByTestId('sx-college-name-heard')).toContainText('JNTU అనంతపూర్');
      await expect(page.getByTestId('sx-college-name')).toHaveValue(''); // nothing saved before OK
      await page.getByTestId('sx-college-name-edit').click();
      await expect(page.getByTestId('sx-college-name')).toHaveValue('JNTU అనంతపూర్');
      await page.getByTestId('sx-college-name').fill('JNTU Anantapur');
      await page.getByTestId('sx-next-q').click();
      // 4: the year, then Back keeps what was saved
      await expect(q).toHaveAttribute('data-step', 'year');
      await page.getByTestId('sx-year-year').fill('2025');
      await page.getByTestId('sx-next-q').click();
      await expect(q).toHaveAttribute('data-step', 'marks');
      await page.getByTestId('sx-back').click();
      await expect(page.getByTestId('sx-year-year')).toHaveValue('2025');
      await page.getByTestId('sx-next-q').click();
      // 5: marks skipped
      await page.getByTestId('sx-skip').click();
      // 6: skills by tapping and by voice (OK)
      await expect(q).toHaveAttribute('data-step', 'skills');
      await page.getByTestId('sx-skill-AutoCAD').click();
      await page.getByTestId('sx-skills-say-mic').click();
      await page.evaluate(() => window.__say('SolidWorks and Welding'));
      await page.getByTestId('sx-skills-say-stop').click();
      await page.getByTestId('sx-skills-say-ok').click();
      await page.getByTestId('sx-skills-add').click();
      await expect(page.getByTestId('sx-skill-SolidWorks')).toHaveAttribute('aria-pressed', 'true');
      await page.getByTestId('sx-next-q').click();
      // 7: a project → "This is what we wrote" → Accept
      await expect(q).toHaveAttribute('data-step', 'projects');
      await page.getByTestId('sx-projects-built').fill('a go-kart frame for our college team');
      await page.getByTestId('sx-projects-tools').fill('SolidWorks');
      await page.getByTestId('sx-projects-does').fill('holds the engine and the driver seat');
      await page.getByTestId('sx-write').click();
      await expect(page.getByTestId('sx-wrote')).toContainText('Built a go-kart frame for our college team using SolidWorks');
      expect(await axe(page)).toEqual([]);
      await page.getByTestId('sx-accept').click();
      await expect(page.getByTestId('sx-added')).toBeVisible();
      await page.getByTestId('sx-next-q').click();
      // 8: no internship; 9: no certificate; 10: languages
      await page.getByTestId('sx-work-no').click();
      await expect(q).toHaveAttribute('data-step', 'certs');
      await page.getByTestId('sx-skip').click();
      await expect(page.getByTestId('sx-progress')).toHaveText('10 లో 10');
      await page.getByTestId('sx-lang-Telugu').click();
      await page.getByTestId('sx-lang-English').click();
      await page.getByTestId('sx-next-q').click();
      await expect(page).toHaveURL(/\/me\/simple$/);
      await expect(page.getByTestId('sx-next')).not.toHaveAttribute('data-key', 'resume');
      // the same resume the full builder opens
      const rs = (await call(page, '/api/me/resumes')).body;
      expect(rs).toHaveLength(1);
      const d = rs[0].data;
      expect(d.personal).toMatchObject({ name: 'Asha Rao', phone: '98765 43210' });
      expect(d.edu[0]).toMatchObject({ degree: 'B.Tech', field: 'Mechanical', institution: 'JNTU Anantapur', to: '2025' });
      expect(d.skillGroups[0].value).toBe('AutoCAD, SolidWorks, Welding');
      expect(d.proj[0].description).toContain('Built a go-kart frame for our college team using SolidWorks');
      expect(d.langs.map((x) => x.name)).toEqual(['Telugu', 'English']);
      expect(rs[0].versions.at(-1).label).toBe('Made by talking');
    });

    test('no speech in this browser: a keyboard-mic tip, typing works', async ({ page }) => {
      await page.addInitScript(() => { delete window.webkitSpeechRecognition; delete window.SpeechRecognition; });
      await studentWith(page, label, { personal: {} }, 'nomic');
      await page.goto('/me/simple/resume?step=college');
      await expect(page.getByTestId('sx-guided')).toHaveAttribute('data-step', 'college');
      await expect(page.getByTestId('sx-college-name-mic')).toHaveCount(0);
      await expect(page.getByText('Tip: you can speak with your phone keyboard’s mic 🎤')).toBeVisible();
    });
  });
}
