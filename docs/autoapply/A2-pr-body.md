# Auto Apply 2.0, phase A2 ("Jobs posted on Nm7")

**Stacked on #232 (phase A1).** Merge A1 first; this branch is built on top of it.

Everything here sits behind the same Auto Apply 2.0 switch as A1, which is **OFF** by default.

## What it does

- **Instant apply when a company posts a job on Nm7.** The company's post is answered first. Right after, a background
  task scores everyone who opted in to 2.0 against the new job. Every automation pass (every 10 minutes) also picks up
  jobs whose scan isn't finished, for example a job that was waiting for review.
  - 70 or more: applied the way the candidate chose.
    - Approve each (the default): it goes to their approval list.
    - Full auto: it is sent now.
    - Weekly digest: it goes to the weekly list.
  - 55 to 69: "Suggested for you".
  - The scan respects the candidate's rules, blocked companies, their "hide me from" list, the daily limit,
    pause / stop and consent. When today's limit is already used, the job is left for the morning run.
- **Memory-safe.** The scan runs inside `heavy_or_skip`: if another big job is running, it waits for the next pass.
  - Each pass looks at no more than 5 jobs and 300 people, and prepares no more than 25 applications.
  - People are read in batches of 50, with only the fields the scan needs.
  - The scan remembers where it stopped and carries on next time.
- **What the company receives** with each auto application:
  - the tailored resume (A1's version: reordered and rephrased, truth-checked, never tailored twice);
  - the cover note;
  - the match score with 3 plain reasons, written for the company ("Experience fits the job", "Wants to work in
    Hyderabad");
  - vetting level and badges, only where the vetting switch shows them to that company;
  - notice period and expected salary, taken only from what the candidate saved (Ready to join, or else their 2.0
    rules).
- **Per-job controls for the company:**
  - accept auto applications on / off;
  - the most auto applications the job takes (default 50, at most 500);
  - the lowest vetting level (default: any; the setting only shows where vetting is visible to the company).

  They are set in the posting form or later under each job's "Auto Apply settings". Saving them does not use one of
  the job's 2 edits. They are checked again at the moment an application goes out, so an approval that comes after
  the job is full is not sent.
- **Clearly labelled.** The applicant card says "Sent by Auto Apply". Its fold-out shows the score, the reasons, the
  badges, notice, salary and the cover note. The Resume button shows the tailored version.
- **Screening questions** are answered from the candidate's saved answers (A1's store). If one can't be answered, the
  job waits in "Waiting for you" and is sent the moment they answer.
- **Status sync.** When the company does any of these, the candidate's 2.0 tracker follows and they get an in-app
  update on the tracker ("Got it" clears it):
  - opens the list (Viewed);
  - shortlists;
  - schedules an interview;
  - makes an offer;
  - rejects;
  - closes the job.

  Nm7 closing an application after no reply updates the tracker too.

  Email goes only through `access.may_mail`: while the switch is OFF, only listed testers get one. "Viewed" never
  sends an email, and an interview doesn't send a second one (the invitation already went). Rejections feed A1's
  learning.
- **Switch OFF isolation.** While the switch is OFF:
  - only demo accounts, admins and testers are scanned;
  - a real person only reaches a company that has a listed tester on its team, so real companies get no 2.0
    applications from real users;
  - demo accounts only ever reach the demo company, and that stays true after launch.

  The per-job controls and the "Sent by Auto Apply" details show only to companies the switch lets in (public, the
  demo company, or a tester on the team).
- **Demo.** The demo company now has 3 demo students' applications "Sent by Auto Apply", each with a score, reasons,
  cover note, notice and salary. Its two live jobs show the controls. Kavya's application to the demo company's first
  job is a 2.0 one too.
- **Database changes, all additive:**
  - on `jobs`: `auto_controls` and `auto_scan`;
  - on `applications`: `auto_v2` (label, score, parts, notice, salary);
  - on `auto_items`: `instant`, `notice`, `notices` and `job_closed_at`.

  There are no new collections or indexes.

## Where to look

- Backend: `backend/app/autoapply/instant.py` (the scan, controls, company payload) and `sync.py` (status sync and
  updates) are new. Changes are in:
  - `access.py`: `pair_ok`, `for_company`;
  - `v2engine.py`: send-time checks, the payload, closed / no-reply stages, tracker updates;
  - `companies/posting.py`: the background task, controls on post, `GET /auto-apply`, `PUT /jobs/{id}/auto-apply`;
  - `companies/applicants.py`: the `auto` block and sync hooks;
  - `companies/trust.py`: the no-reply sync;
  - `automation.py`: the pass;
  - both demos.
- Frontend: `frontend/src/pages/company/AutoApplyBits.jsx` (new), wired into `CompanyJobs.jsx` and
  `CompanyApplicants.jsx`. The candidate page `/me/auto-apply/v2` shows the updates.
  - Strings are English only while the feature is tested.
  - Nothing new is imported into the Easy dashboard bundle (Telugu / Hindi is still 149.1 of 150 KB).

## What to check

1. Admin → Auto Apply → "Auto Apply 2.0": add your own email and a second email of yours as testers. Leave the switch
   OFF.
2. As a company account whose admin is one of those tester emails, post a job that matches your tester candidate (2.0
   on, Full auto). Within a few seconds the applicant list should show "Sent by Auto Apply". Open the fold-out: score,
   3 reasons, notice, salary, cover note. Then press Resume to see the tailored version.
3. Shortlist or reject it. The candidate's `/me/auto-apply/v2` tracker shows the update, and the tester gets one email.
4. On a job, open "Auto Apply settings": turn it off, set a maximum, and (with vetting visible) a lowest level. The
   edit count must not change.
5. With a company whose team has no tester, post a matching job: nothing should arrive while the switch is OFF.
6. Admin → Companies → "Reset and open as company": the demo shows labelled auto applications and the controls.
7. On a phone (390 px): the applicant card fold-out and the job settings wrap without sideways scrolling.
8. Read the company-facing reason wording (`instant._company_note`) and the update texts (`sync.TEXT`).

## Done / not done

- [x] Instant apply on post (background task, never in the request) and on each automation pass, by approval mode;
      55–69 suggested; rules, blocked companies, hide-from list, daily limit, pause / stop, consent
- [x] Memory-safe: inside `heavy_or_skip`, caps per pass, small batches, resumes where it stopped
- [x] The company receives the tailored resume, cover note, score with 3 reasons, vetting badges (only where vetting
      shows), notice period and expected salary
- [x] Per-job controls: on / off, maximum (default 50), lowest vetting level (default any); checked again at send time
- [x] "Sent by Auto Apply" label in the applicant list and profile
- [x] Screening answers from the saved profile answers; otherwise Waiting, then sent on answer
- [x] Status sync with in-app updates, email only via `may_mail`; rejections feed learning
- [x] Switch OFF isolation (no real-user 2.0 applications to real companies, no email except to testers)
- [x] Demo company and Kavya extended
- [x] UI: company job form and settings, applicant card details; candidate tracker shows On Nm7 and updates;
      desktop and 390 px
- [x] Tests: backend pytest (new `tests/test_auto_apply_a2.py`), frontend vitest / build / lint, the live e2e spec
      `e2e-live/auto-apply-v2-internal.spec.mjs` (company and candidate, desktop and 390 px, passes with
      `--repeat-each 2`)
- [ ] Partner, company-form and one-tap channels (later phases)
- [ ] Telugu / Hindi strings for the new company controls and card details (English only while tested)
- [ ] Weekly digest email (still only the weekly list, as in A1)

🤖 Generated with [Claude Code](https://claude.com/claude-code)

https://claude.ai/code/session_01SBaqRLDLwSKFN3nQpCsLVw
