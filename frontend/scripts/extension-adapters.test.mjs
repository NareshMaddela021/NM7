// The Nm7 Apply helper's hiring-system adapters (extension/src/adapters/*.js) against saved fixture pages
// (scripts/fixtures/helper/*.html, written by hand to mimic each system's markup): each adapter is detected by host
// and by page structure, fills its fields, its repeating blocks, its option lists and its dates, and leaves the
// sensitive, consent and unknown fields red. Plus the step-by-step flow, type-to-search lists, smart-answer drafts
// on the page and the frame hand-off.
import { describe, expect, it } from 'vitest';
import { COLLEGES, CITIES, KIT, PDF, fixture, makePage, marks } from './lib/helper-harness.mjs';

const state = (doc, el) => { const m = el.closest('[data-nm7-mark]'); return m ? m.getAttribute('data-nm7-mark') : null; };
const byAid = (doc, aid, n = 0) => doc.querySelectorAll(`[data-automation-id="${aid}"]`)[n];

async function fill(name, url, opts = {}) {
  const p = makePage(fixture(name), { url, fallback: [...CITIES, ...COLLEGES], ...opts });
  const r = await p.box.Nm7Fill(opts.kit || KIT, PDF);
  return { ...p, r };
}

describe('adapters on fixture pages', () => {
  it('Workday: automation ids, month / year date parts, the school list, the drop-down button and the CAPTCHA left alone', async () => {
    const { doc, r, close } = await fill('workday.html', 'https://acme.wd3.myworkdayjobs.com/en-US/careers/job/Pune/Trainee_R1/apply');
    expect(r.adapter).toBe('workday');
    expect(byAid(doc, 'legalNameSection_firstName').value).toBe('Priya');
    expect(byAid(doc, 'legalNameSection_lastName').value).toBe('Sharma (demo)');
    expect(byAid(doc, 'email').value).toBe('chrome-review@nm7.si');
    expect(byAid(doc, 'phone-number').value).toBe('+91 90000 12345');
    expect(byAid(doc, 'addressSection_city').value).toBe('Pune');
    expect(byAid(doc, 'jobTitle').value).toBe('Customer Support and Reporting Intern');
    expect(byAid(doc, 'company').value).toBe('Demo Retail (demo)');
    expect([0, 1, 2].map((i) => byAid(doc, 'dateSectionMonth-input', i)?.value)).toEqual(['01', '06', undefined]);
    expect([0, 1, 2].map((i) => byAid(doc, 'dateSectionYear-input', i).value)).toEqual(['2025', '2025', '2024']);
    expect(byAid(doc, 'currentlyWorkHere').checked).toBe(false); // not her current job
    expect(byAid(doc, 'school').value).toBe('Demo College of Commerce (demo)'); // picked from the list
    expect(byAid(doc, 'degree').value).toBe('Bachelor of Commerce (B.Com)');
    expect(byAid(doc, 'fieldOfStudy').value).toBe('Computer Applications');
    expect(byAid(doc, 'file-upload-input-ref').files.length).toBe(1);
    expect(state(doc, byAid(doc, 'searchBox'))).toBe('left'); // "How did you hear about us": not in the kit
    expect(state(doc, doc.querySelector('[name="gender"]'))).toBe('left');
    expect(state(doc, byAid(doc, 'agreementCheckbox'))).toBe('left');
    expect(byAid(doc, 'agreementCheckbox').checked).toBe(false);
    expect(doc.querySelector('[name="g-recaptcha-response"]').value).toBe('');
    expect(r.captcha).toBe(true);
    expect(r.misses).toEqual([{ label: 'How Did You Hear About Us?', type: 'combobox' }]);
    close();
  });

  it('SuccessFactors: "--name-inner" ids, an employment block with MM/YYYY dates, education, date of birth left', async () => {
    const { doc, r, close } = await fill('successfactors.html', 'https://career5.successfactors.eu/careers?company=coral');
    expect(r.adapter).toBe('successfactors');
    const v = (id) => doc.getElementById(id).value;
    expect(v('rcmCandidateProfile--firstName-inner')).toBe('Priya');
    expect(v('rcmCandidateProfile--contactEmail-inner')).toBe('chrome-review@nm7.si');
    expect(v('rcmCandidateProfile--cellPhone-inner')).toBe('+91 90000 12345');
    expect(v('rcmCandidateProfile--outsideWorkExperience-0--employer-inner')).toBe('Demo Retail (demo)');
    expect(v('rcmCandidateProfile--outsideWorkExperience-0--startDate-inner')).toBe('01/2025');
    expect(v('rcmCandidateProfile--outsideWorkExperience-0--endDate-inner')).toBe('06/2025');
    expect(v('rcmCandidateProfile--education-0--school-inner')).toBe('Demo College of Commerce (demo)');
    expect(v('rcmCandidateProfile--education-0--degree')).toBe('Bachelor of Commerce (B.Com)');
    expect(v('rcmCandidateProfile--dateOfBirth-inner')).toBe('');
    expect(state(doc, doc.getElementById('rcmCandidateProfile--dateOfBirth-inner'))).toBe('left');
    expect(r.attached).toBe(true);
    close();
  });

  it('Taleo: data dictionary ids and DD/MM/YYYY dates; the time zone drop-down is left', async () => {
    const { doc, r, close } = await fill('taleo.html', 'https://harbor.taleo.net/careersection/2/jobapply.ftl?job=1');
    expect(r.adapter).toBe('taleo');
    const v = (sel) => doc.querySelector(sel).value;
    expect(v('[id$="dv_cs_candidate_personal_info_FirstName"]')).toBe('Priya');
    expect(v('[id$="dv_cs_candidate_personal_info_EmailAddress"]')).toBe('chrome-review@nm7.si');
    expect(v('[id$="dv_cs_candidate_personal_info_MobilePhone"]')).toBe('+91 90000 12345');
    expect(v('[id$="dv_cs_experience_Employer-1"]')).toBe('Demo Retail (demo)');
    expect(v('[id$="dv_cs_experience_BeginDate-1"]')).toBe('01/01/2025');
    expect(state(doc, doc.querySelector('[id$="dv_cs_experience_BeginDate-1"]'))).toBe('check'); // the day is a guess
    expect(state(doc, doc.getElementById('tz'))).toBe('left');
    close();
  });

  it('iCIMS: PersonProfileFields names, a table row, a month input, a question for a smart answer; its sign-in page is left alone', async () => {
    const { doc, r, close } = await fill('icims.html', 'https://careers-lotus.icims.com/jobs/1/apply?in_iframe=1', { top: false });
    expect(r.adapter).toBe('icims');
    expect(doc.querySelector('[name="PersonProfileFields.FirstName"]').value).toBe('Priya');
    expect(doc.querySelector('[name="PersonProfileFields.PhoneNumber"]').value).toBe('+91 90000 12345');
    expect(doc.querySelector('[name="WorkExperience.0.Employer"]').value).toBe('Demo Retail (demo)');
    expect(doc.querySelector('[name="WorkExperience.0.StartDate"]').value).toBe('2025-01');
    expect(state(doc, doc.querySelector('[name="PersonProfileFields.AddressStreet1"]'))).toBe('left');
    expect(r.questions).toBe(1);
    expect(r.top).toBe(false);
    close();
    const login = await fill('icims-login.html', 'https://careers-lotus.icims.com/jobs/1/login');
    expect(login.r.login).toBe(true);
    expect(login.doc.querySelector('[name="loginName"]').value).toBe('');
    login.close();
  });

  it('Darwinbox: formcontrolname, a type-to-search city, native dates, "1 Month" for 30 days; religion left', async () => {
    const { doc, r, close } = await fill('darwinbox.html', 'https://sapphire.darwinbox.in/ms/candidate/careers/apply/1');
    expect(r.adapter).toBe('darwinbox');
    const v = (n) => doc.querySelector(`[formcontrolname="${n}"]`).value;
    expect(v('first_name')).toBe('Priya');
    expect(v('email_id')).toBe('chrome-review@nm7.si');
    expect(v('mobile_no')).toBe('+91 90000 12345');
    expect(v('current_location')).toBe('Pune');
    expect(state(doc, doc.querySelector('[formcontrolname="current_location"]'))).toBe('sure'); // picked, exactly
    expect(v('notice_period')).toBe('1 Month');
    expect(v('company_name')).toBe('Demo Retail (demo)');
    expect(v('start_date')).toBe('2025-01-01');
    expect(v('end_date')).toBe('2025-06-01');
    expect(v('religion')).toBe('');
    expect(state(doc, doc.querySelector('[formcontrolname="religion"]'))).toBe('left');
    close();
  });

  it('Keka: camelCase formcontrolname, month inputs, a yes / no radio from the ready answer', async () => {
    const { doc, r, close } = await fill('keka.html', 'https://orbit.keka.com/careers/jobdetails/1');
    expect(r.adapter).toBe('keka');
    const v = (n) => doc.querySelector(`[formcontrolname="${n}"]`).value;
    expect(v('firstName')).toBe('Priya');
    expect(v('phoneNumber')).toBe('+91 90000 12345');
    expect(v('noticePeriod')).toBe('30 Days');
    expect(v('companyName')).toBe('Demo Retail (demo)');
    expect(v('fromDate')).toBe('2025-01');
    expect(v('toDate')).toBe('2025-06');
    expect(doc.querySelector('[name="relocate"][value="yes"]').checked).toBe(true);
    expect(state(doc, doc.querySelector('[name="relocate"]'))).toBe('check');
    expect(doc.querySelector('[formcontrolname="resume"]').files.length).toBe(1);
    close();
  });

  it('Greenhouse: ids, the location list, a school drop-down, the LinkedIn question; gender left', async () => {
    const { doc, r, close } = await fill('greenhouse.html', 'https://job-boards.greenhouse.io/maple/jobs/1');
    expect(r.adapter).toBe('greenhouse');
    const v = (id) => doc.getElementById(id).value;
    expect(v('first_name')).toBe('Priya');
    expect(v('candidate-location')).toBe('Pune');
    expect(v('question_9001')).toBe('https://linkedin.com/in/priya-sharma-demo');
    expect(v('cover_letter_text')).toBe(KIT.coverNote);
    expect(v('school--0')).toBe('Demo College of Commerce (demo)');
    expect(v('degree--0')).toBe('Bachelor of Commerce (B.Com)');
    expect(v('end-year--0')).toBe('2024');
    expect(v('dg')).toBe('');
    expect(state(doc, doc.getElementById('question_9002'))).toBe('left'); // a website she doesn't have
    close();
  });

  it('Lever: names, a full name, an extra question for a smart answer; current company left (not in the kit)', async () => {
    const { doc, r, close } = await fill('lever.html', 'https://jobs.lever.co/quartz/1/apply');
    expect(r.adapter).toBe('lever');
    expect(doc.querySelector('[name="name"]').value).toBe('Priya Sharma (demo)');
    expect(doc.querySelector('[name="urls[LinkedIn]"]').value).toBe('https://linkedin.com/in/priya-sharma-demo');
    expect(doc.querySelector('[name="comments"]').value).toBe(KIT.coverNote);
    expect(doc.querySelector('[name="org"]').value).toBe('');
    expect(r.questions).toBe(1);
    close();
  });

  it('Zoho Recruit: API-name ids, the qualification drop-down, a subform row with MM/YYYY', async () => {
    const { doc, r, close } = await fill('zoho.html', 'https://willow.zohorecruit.in/jobs/Careers/1/apply');
    expect(r.adapter).toBe('zoho');
    expect(doc.getElementById('First_Name').value).toBe('Priya');
    expect(doc.getElementById('Mobile').value).toBe('+91 90000 12345');
    expect(doc.getElementById('Highest_Qualification_Held').value).toBe('B.Com');
    expect(doc.querySelector('[name="Experience_Details_Company_1"]').value).toBe('Demo Retail (demo)');
    expect(doc.querySelector('[name="Experience_Details_Work_Duration_From_1"]').value).toBe('01/2025');
    expect(doc.getElementById('Resume').files.length).toBe(1);
    close();
  });

  it('detects the hiring system by page structure on a company’s own domain', async () => {
    for (const [file, name] of [['workday.html', 'workday'], ['successfactors.html', 'successfactors'], ['taleo.html', 'taleo'], ['icims.html', 'icims'],
      ['darwinbox.html', 'darwinbox'], ['keka.html', 'keka'], ['greenhouse.html', 'greenhouse'], ['lever.html', 'lever'], ['zoho.html', 'zoho']]) {
      const p = makePage(fixture(file), { url: 'https://careers.example.in/apply' });
      expect(p.box.Nm7Adapters.detect('careers.example.in', p.doc).name, file).toBe(name);
      p.close();
    }
  });
});

describe('steps, repeating blocks and lists', () => {
  it('after the candidate moves to the next step, offers Fill this step; it fills only when they tap it', async () => {
    const p = makePage('<div data-automation-id="applyFlowPage"><h2 data-automation-id="pageHeaderTitle">My Information</h2><div id="step"><label for="a">First name</label><input id="a"></div></div>', { url: 'https://acme.wd3.myworkdayjobs.com/x' });
    await p.box.Nm7Fill(KIT, PDF);
    expect(p.doc.getElementById('a').value).toBe('Priya');
    // the candidate pressed the page's own Next: the page shows the next step
    p.doc.querySelector('[data-automation-id="pageHeaderTitle"]').textContent = 'My Experience';
    p.doc.getElementById('step').innerHTML = '<label for="b">Email Address</label><input id="b" data-automation-id="email"><label for="c">Phone</label><input id="c" data-automation-id="phone-number">';
    await new Promise((r) => setTimeout(r, 900));
    const bar = p.doc.getElementById('nm7-status');
    expect(bar.textContent).toContain('A new step loaded. Fill it from your Nm7 kit?');
    expect(p.doc.getElementById('b').value).toBe(''); // nothing until the candidate taps
    [...bar.querySelectorAll('button')].find((b) => b.textContent === 'Fill this step').dispatchEvent(new p.win.MouseEvent('click', { bubbles: true }));
    await new Promise((r) => setTimeout(r, 50));
    expect(p.doc.getElementById('b').value).toBe('chrome-review@nm7.si');
    expect(p.doc.getElementById('c').value).toBe('+91 90000 12345');
    expect(p.sent).toContainEqual({ type: 'nm7-step', kitId: 'kit-review', step: 2 });
    p.close();
  });

  it('fills the blocks already on the page and says how many more the kit has (it never presses Add)', async () => {
    const kit = { ...KIT, experience: [...KIT.experience, { company: 'Demo Shop (demo)', title: 'Cashier', from: '2024-06', to: '2024-12' }] };
    const p = makePage(`<fieldset><legend>Work experience 1</legend><label for="c1">Company</label><input id="c1"><label for="t1">Job title</label><input id="t1"></fieldset>
      <button type="button" id="add">Add another</button>`);
    let pressed = false;
    p.doc.getElementById('add').addEventListener('click', () => { pressed = true; });
    const r = await p.box.Nm7Fill(kit, PDF);
    expect(p.doc.getElementById('c1').value).toBe('Demo Retail (demo)');
    expect(p.doc.getElementById('t1').value).toBe('Customer Support and Reporting Intern');
    expect(r.more).toEqual({ work: 1, education: 1 });
    expect(p.doc.getElementById('nm7-status').textContent).toContain('Your kit has 1 more job');
    expect(pressed).toBe(false);
    // the candidate adds a block themselves: the helper offers to fill it
    p.doc.body.insertAdjacentHTML('beforeend', '<fieldset><legend>Work experience 2</legend><label for="c2">Company</label><input id="c2"><label for="t2">Job title</label><input id="t2"></fieldset>');
    await new Promise((res) => setTimeout(res, 900));
    expect(p.doc.getElementById('nm7-status').textContent).toContain('Fill this step');
    p.close();
  });

  it('a type-to-search list: picks the best match, or leaves the typed text yellow when nothing matches', async () => {
    const p = makePage('<label for="c">City</label><input id="c" role="combobox" aria-autocomplete="list"><label for="s">College</label><input id="s" role="combobox" aria-autocomplete="list">', { lists: { c: ['Pune Cantonment', 'Pune', 'Punjab'], s: ['Some Other College'] } });
    await p.box.Nm7Fill(KIT, PDF);
    expect(p.doc.getElementById('c').value).toBe('Pune');
    expect(p.doc.getElementById('c').dataset.picked).toBe('Pune');
    expect(state(p.doc, p.doc.getElementById('c'))).toBe('check'); // city is a softer match by label
    expect(p.doc.getElementById('s').dataset.picked).toBeUndefined();
    expect(state(p.doc, p.doc.getElementById('s'))).toBe('check');
    p.close();
  });
});

describe('smart answers on the page', () => {
  const FORM = '<label for="q">Describe a time you solved a difficult problem for a customer.</label><textarea id="q"></textarea><label for="q2">What would you change about our app first?</label><textarea id="q2"></textarea>';

  it('shows each draft highlighted, and the candidate uses, edits or discards it; used answers go back to the kit', async () => {
    const p = makePage(FORM, { replies: { 'nm7-draft': (m) => ({ answer: `Draft for: ${m.question.slice(0, 20).trim()}` }) } });
    const r = await p.box.Nm7Fill(KIT, PDF);
    expect(r.questions).toBe(2);
    expect(p.doc.getElementById('q').value).toBe(''); // nothing until asked
    const out = await p.box.Nm7Draft();
    expect(out.drafted).toBe(2);
    expect(p.doc.getElementById('q').value).toBe('Draft for: Describe a time you');
    expect(p.doc.getElementById('q').getAttribute('data-nm7-mark')).toBe('draft');
    expect(p.sent.filter((m) => m.type === 'nm7-draft').map((m) => m.question)).toEqual(['Describe a time you solved a difficult problem for a customer.', 'What would you change about our app first?']);
    const chips = p.doc.querySelectorAll('#nm7-marks .nm7-chip');
    expect(chips).toHaveLength(2);
    const press = (chip, label) => [...chip.querySelectorAll('button')].find((b) => b.textContent === label).dispatchEvent(new p.win.MouseEvent('click', { bubbles: true }));
    press(chips[0], 'Use it');
    expect(p.doc.getElementById('q').getAttribute('data-nm7-mark')).toBe('sure');
    expect(p.sent).toContainEqual({ type: 'nm7-save-answer', kitId: 'kit-review', question: 'Describe a time you solved a difficult problem for a customer.', answer: 'Draft for: Describe a time you', how: 'approved' });
    press(chips[1], 'Discard');
    expect(p.doc.getElementById('q2').value).toBe('');
    expect(p.doc.getElementById('q2').getAttribute('data-nm7-mark')).toBe('left');
    expect(p.sent.filter((m) => m.type === 'nm7-save-answer')).toHaveLength(1);
    p.close();
  });

  it('an edited draft is saved as the candidate wrote it', async () => {
    const p = makePage(FORM, { replies: { 'nm7-draft': { answer: 'A first draft.' } } });
    await p.box.Nm7Fill(KIT, PDF);
    await p.box.Nm7Draft();
    const chip = p.doc.querySelector('#nm7-marks .nm7-chip');
    const press = (label) => [...chip.querySelectorAll('button')].find((b) => b.textContent === label).dispatchEvent(new p.win.MouseEvent('click', { bubbles: true }));
    press('Edit');
    p.doc.getElementById('q').value = 'My own words.';
    press('Save my answer');
    expect(p.sent).toContainEqual(expect.objectContaining({ type: 'nm7-save-answer', answer: 'My own words.', how: 'edited' }));
    p.close();
  });

  it('when the limits are reached: "Smart answers are paused for today, type this one yourself", the rest stays filled', async () => {
    const p = makePage(`<label for="n">Full name</label><input id="n">${FORM}`, { replies: { 'nm7-draft': { paused: true, message: 'Smart answers are paused for today, type this one yourself.' } } });
    await p.box.Nm7Fill(KIT, PDF);
    const out = await p.box.Nm7Draft();
    expect(out.paused).toBe(true);
    expect(p.doc.getElementById('nm7-status').textContent).toContain('Smart answers are paused for today, type this one yourself.');
    expect(p.doc.getElementById('q').value).toBe('');
    expect(p.doc.getElementById('n').value).toBe('Priya Sharma (demo)');
    expect(p.sent.filter((m) => m.type === 'nm7-draft')).toHaveLength(1); // stops asking
    p.close();
  });

  it('never drafts for a sensitive question', async () => {
    const p = makePage('<label for="s">Please describe any disability we should know about</label><textarea id="s"></textarea><label for="h">Tell us about your salary history in detail</label><textarea id="h"></textarea>', { replies: { 'nm7-draft': { answer: 'x' } } });
    const r = await p.box.Nm7Fill(KIT, PDF);
    expect(r.questions).toBe(0);
    expect(r.sensitive).toBe(2);
    await p.box.Nm7Draft();
    expect(p.sent.filter((m) => m.type === 'nm7-draft')).toEqual([]);
    p.close();
  });
});

describe('frames', () => {
  it('the top page reports a big frame from another site; frames on the same site are filled with the page', async () => {
    const p = makePage(`<p>Careers</p><iframe id="icims_content_iframe" src="https://careers-lotus.icims.com/jobs/1/apply?in_iframe=1" style="width:800px;height:900px"></iframe>
      <iframe src="/same-site/form"></iframe><iframe src="https://ads.example.net/x" width="1" height="1"></iframe>`, { url: 'https://careers.lotus.example/jobs/1' });
    const r = await p.box.Nm7Fill(KIT, PDF);
    expect(r.frames).toEqual([{ origin: 'https://careers-lotus.icims.com', host: 'careers-lotus.icims.com', src: 'https://careers-lotus.icims.com/jobs/1/apply?in_iframe=1' }]);
    p.close();
    const inner = makePage('<label for="e">Email</label><input id="e">', { url: 'https://careers-lotus.icims.com/jobs/1/apply', top: false });
    const r2 = await inner.box.Nm7Fill(KIT, PDF);
    expect(r2).toMatchObject({ top: false, host: 'careers-lotus.icims.com', frames: [] });
    inner.close();
  });
});

describe('every field counts', () => {
  it('marks are counted the same in the result, the status bar and the list', async () => {
    const { doc, r, close } = await fill('greenhouse.html', 'https://job-boards.greenhouse.io/maple/jobs/1');
    expect(marks(doc)).toEqual({ sure: r.counts.sure, check: r.counts.check, left: r.counts.left, draft: 0 });
    expect(r.list).toHaveLength(r.counts.sure + r.counts.check + r.counts.left);
    close();
  });
});
