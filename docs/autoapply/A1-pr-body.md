# Auto Apply 2.0, phase A1 ("Engine")

Auto Apply 2.0 is built on top of today's Auto Apply. There is no second system. It sits behind its own launch
switch, which is **OFF** by default. While it is off, only admins, demo accounts and the tester emails listed in
Admin → Auto Apply → "Auto Apply 2.0" can see it. Everyone else gets today's Auto Apply unchanged: the same pages,
endpoints, scores, limits and emails.

## What it does

- **Match score, 0–100, in parts.** Skills 40, experience 20, city 10, salary 10, vetting level 10, freshness 10.
  Repeated rejections take points off (see Learning). The score is built on the job board's own fit check, not a
  second scorer.
- **Thresholds** (Admin can change them):
  - 70 or more: goes to the auto-apply queue.
  - 55 to 69: shows in "Suggested for you".
  - Below 55: skipped.
- **Candidate rules.** Roles, cities and remote, experience band, minimum salary, notice period (new), job types,
  blocked companies, and a daily limit (default 10, at most 25). These are saved on the same `users.auto_apply`
  document as today's settings, so nothing existing is renamed.
- **Three approval modes:**
  - Approve each (the default): a morning list with "Approve all".
  - Full auto.
  - Weekly digest: one list for the week.
- **Tailoring, once per job.** Each job gets one saved version per (job, candidate, resume version), and the same
  job is never tailored twice: there is a unique `cache_key` on `auto_copies`. A version holds:
  - the resume, only reordered and rephrased;
  - a cover note of 5–6 lines;
  - ready answers to common screening questions.

  The AI writes a draft with a strict JSON schema. It uses the configured cheap model and counts in the daily AI
  allowance as `autoapply_tailor`.
- **Truth check on every part.** If the AI draft has anything new (a skill, degree, company, title word or number
  that is not on the original resume), the whole AI version is blocked and kept with its problems, but never sent.
  The rules version (the resume's own lines, only reordered) goes out instead. The same rules version is used when
  there is no AI key, the allowance is used up, or the answer is unusable.
- **Fair matching.** The prompt never carries the name, contact details, photo, gender, religion, caste, age or date
  of birth. The score never reads them either.
- **One tracker for every channel.** The stages are Ready, Waiting for you, Applied, Viewed, Replied / Interview,
  and Offer / Rejected / Closed. Each row has a channel and an icon: On Nm7, By email, Partner, Company form, One
  tap. "What was sent" shows exactly what went out: the version, cover note, answers and the email.
- **Waiting for you.** When a company asks a question Nm7 can't answer, the job waits here. The candidate's answer is
  saved to their profile, so they are never asked again, and that application is sent at once (within the daily
  limit; over it, first thing the next run).
- **Learning.** 2 or more rejections for the same kind of role in 90 days lower that role's score by 5 points for each
  rejection after the first, at most 15. The candidate can mark a reply or a rejection that came by email or through
  a website, and that counts too.
- **Consent (DPDP).** The candidate gives an explicit opt-in with the consent text stored. They can pause at any time,
  or stop: stopping withdraws consent and withdraws everything not yet sent.
- **Admin settings.** Admin → Auto Apply → "Auto Apply 2.0" holds the switch, testers, thresholds, the daily limit
  and its maximum, and pricing (free applications a week, paid limit, payments on/off). Pricing is free/off for now.
  The panel also shows the numbers. Every change goes in the activity log.
- **Demo.** The existing demo student, Kavya, now also shows every tracker state, two jobs waiting for Approve, a
  waiting question and two suggested jobs.
- **Hard rules, unchanged.** Nm7 never asks for or stores passwords for other sites, never touches a CAPTCHA, never
  creates accounts elsewhere and never uses job boards. Website jobs stay "Ready" for one tap by the candidate.
  All database changes are additive (new fields, new item states `suggested` and `withdrawn`, one new partial unique
  index).
- **Background run.** The morning run sends 2.0 people through the 2.0 engine inside `heavy_or_skip`. If another
  heavy job is running, they wait for the next pass. While the switch is off, nobody but listed testers gets a 2.0
  email; admins and demo accounts get none.

## Where to look

- Backend: `backend/app/autoapply/` (`rules.py`, `tailoring.py`, `v2engine.py` and `v2.py` are new; `access.py`,
  `truth.py`, `engine.py` and `demo.py` are extended).
- Candidate page: `/me/auto-apply/v2`. It loads from the Auto Apply page's own chunk, so the Easy dashboard bundle
  doesn't grow (Telugu / Hindi is 149.1 KB, the same as before this change). The old `/me/auto-apply` page shows an
  "Open Auto Apply 2.0" card only to people who can use it.
- Admin: Admin → Auto Apply, in the new "Auto Apply 2.0" panel at the top.

## What to check

1. Admin → Auto Apply: the 2.0 panel says "Hidden". Add your own email as a tester and save.
2. As that tester, open `/me/auto-apply` → "Open Auto Apply 2.0". Save rules, tick the consent and turn it on.
3. Click "Reset and open as student (Auto Apply)", then "Open Auto Apply 2.0". Kavya should have every tracker stage
   filled, 2 jobs to approve, a waiting question and 2 suggestions. Try "What was sent" on a row.
4. Read the consent text (`CONSENT_TEXT` in `backend/app/autoapply/v2.py`). Does it match what legal wants for DPDP?
5. Read the rules cover note and ready answers on a few real resumes (the wording in `tailoring.rules_cover` /
   `rules_answers`).
6. Check the thresholds (70 / 55) and the default mode (Approve each).
7. On a phone (390 px), check the tabs and the stage tiles.
8. Leave the switch OFF until the testers are happy.

## Done / not done

- [x] Candidate rules (roles, cities/remote, experience, min salary, notice period, job types, blocked companies,
      daily limit 10 / max 25), stored additively
- [x] Tailoring per job: reorder and rephrase, 5–6 line cover note, ready answers, saved versions, strict schema,
      rules fallback, cache (never twice), truth check blocks invented content, fair matching
- [x] Engine wiring: 70+ queue, 55–69 suggested, below skipped; rules, blocked companies, daily limit, consent,
      pause/stop
- [x] Approval modes: full auto, approve each (default, "Approve all"), weekly digest (list)
- [x] One tracker with channel field and icons (internal, email, partner, form, one tap)
- [x] Waiting section: answers saved to the profile, then sent at once
- [x] Rejections feed learning (company marks on Nm7, and the candidate's own marks for email or website replies)
- [x] "What was sent" per application
- [x] Candidate and Admin endpoints, all behind the switch
- [x] Demo Kavya in every state
- [x] Candidate page and Admin panel, desktop and 390 px
- [x] Tests: backend pytest, frontend vitest and build, a live e2e spec for the candidate and Admin pages
- [ ] Weekly digest **email** (the weekly list exists on the page; the email that sends it is not built yet)
- [ ] Partner, company-form and one-tap channels beyond today's (A1 only provides the model and UI; later phases fill
      them in)
- [ ] Pricing enforcement beyond "free applications a week" (payments are off; the paid limit is stored, not used)
- [ ] Telugu / Hindi strings for the 2.0 page (English only while it is tested)

🤖 Generated with [Claude Code](https://claude.com/claude-code)

https://claude.ai/code/session_01SBaqRLDLwSKFN3nQpCsLVw
