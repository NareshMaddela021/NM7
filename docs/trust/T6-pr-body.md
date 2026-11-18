# Vetting Trust T6: self-serve knock-out questions + verified non-tech filters in Hire now

Base: `claude/confident-knuth-pu6nd3-trust-t5` · Branch: `claude/confident-knuth-pu6nd3-trust-t6` · **Stacked on #247 (T5)**, which is stacked on #246 (T4), #245 (T3), #244 (T2) and #243 (T1): merge #243, #244, #245, #246, #247, then this one (GitHub switches the base each time).

Everything new is behind the one **Vetting Trust** switch from T1. While it is OFF, only admins, demo accounts and listed
testers see anything new. Real companies keep today's job form (5 questions, no templates, no new refusal, no office pin),
real candidates keep today's apply form (every question asked, nothing filled in), and Hire now looks exactly as before.

## What this does, in plain words

- **Companies: self-serve knock-out questions** (Jobs → Post a job / Edit → *Screening questions*):
  - up to **8 questions** a job (was 5): yes/no with the answer that fits, a **number** with a minimum, or **one choice**
    with the answers that fit;
  - **Add a common question**: *Willing to work night shifts? · Do you have a two-wheeler? · Can you join immediately? ·
    Willing to relocate? · Weekends? · A valid driving licence? · Which shift suits you? · Months of experience? · Notice
    period?*;
  - **No discriminatory questions**: anything about **gender, religion, caste, age, marital status, pregnancy or photos /
    looks** shows a red warning as they type and *Post job* is disabled; the server refuses it too (post, edit and the
    Check button), checking the question and its options. Work questions ("Can you manage a team?", "Which language do you
    speak?", "What wage do you expect?") pass;
  - an optional **office pin** ("I'm at the office: use this device's location", rounded to about 1 km) for distance in
    Hire now; without it the job's city centre is used.
- **"Not a fit for: <question>"**: an answer that doesn't meet the rule only adds this label next to the person in
  Applicants (and the applicant's page). The person is **never hidden, deleted or rejected automatically**; the company
  decides. This works for applications from the apply form, Auto Apply and the WhatsApp / call agent.
- **Never asked twice**: every answer (apply form, Auto Apply 2.0's "Waiting for you", WhatsApp, the AI call) goes into
  the saved-answer store Auto Apply already had (keyed by the question's words). On the job page, questions already
  answered show as **"Already answered: … Yes · Change"** and only the new ones are asked; Auto Apply and the agent skip
  them too. Answering a common question also updates Work preferences.
- **The T5 agent asks number and choice questions** now (it only asked yes/no): "Reply with a number" (also Hindi /
  Telugu digits, "about 12 months"), choices as buttons (up to 3) or a numbered list; the AI call script says "Please say a
  number" / "The choices are: …", in English, Hindi and Telugu. Questions the person already answered are left out of
  the WhatsApp flow and the call script.
- **Candidates: Work preferences** (Profile & settings → *Work preferences*, next to Privacy & consent): shifts, night
  shifts, weekends, vehicles owned, languages, notice period / "I can join now", relocating; all **self-declared**, saved
  once and used for apply, Auto Apply and the agent. Also: **Saved answers** (forget one → asked again next time) and
  **Your answers to companies** (per application, the questions and what they said; never the company's rules).
- **Location pin with its own consent** (new T1 purpose *"Your location for distance to jobs"*): "Use my location"
  (the browser asks first; rounded to ~1 km on the phone and again on the server) or **pick your city**. Companies
  never see it: only the distance, rounded ("~4 km"). Kept **365 days** from when it was set (Admin → Retention, 30–730),
  deleted at once when the consent is taken back or the person presses *Remove my location*. Work preferences themselves
  are deleted 2 years after the last change, or with the account.
- **Hire now: verified non-tech filters** (a new *Non-tech filters* box, only where the switch lets the company in):
  - **Driving licence ✓ verified** (from T2 DigiLocker; two-wheeler MCWG / MCWOG or car LMV; a document under review or
    expired doesn't count; a test-provider licence only on the demo company or outside production, like T2's badges);
  - **Vehicle owned · self-declared**, **Shift · self-declared**, **Night shifts OK · self-declared**,
    **Distance from the job** (within 2 / 5 / 10 / 20 / 50 km), **Speaks · self-declared** (T10 will add a verified
    spoken-English score), **Can join now · self-declared** (Work preferences, else the Ready to join notice period);
  - filters **combine**; each shows how many people it would leave with the others as they are; each person card shows
    chips with the source: *"✓ Driving licence (two-wheeler, LMV (car)) · verified via DigiLocker"*, *"Owns a two-wheeler ·
    self-declared"*, *"~4 km from the job · self-declared"*, …; **never** a place, pincode or coordinates.

## What Naresh should check

1. Make your company admin email and a candidate email Trust testers (Admin → Skill checks → Vetting Trust).
2. As the company: Jobs → **Post a job** → *Add a common question* → night shifts; add your own "How many months have you
   used SQL?" (Number, at least 6). Type **"Are you married?"** in a question: the red warning shows and *Post job* is
   greyed out. Remove it, post. (Try "Are you a Hindu?" or "Send a photo" too.)
3. As the candidate: Profile & settings → **Work preferences** → night shifts *Yes*, a two-wheeler, Telugu, *I can join
   now* → Save. Under *Distance to jobs* read the consent text (plain enough?), *I agree*, pick your city (or use your
   location on the phone).
4. Open the job → *Apply on Nm7*: the night-shift question says *Already answered: Yes*; only the SQL question is asked.
   Answer **2** → as the company, Applicants shows **"Not a fit for: How many months have you used SQL?"** and the person
   is still there. The candidate sees their answers under *Your answers to companies*.
5. Hire now (a Verified company, a live Hyderabad job): the **Non-tech filters** box; try *Two-wheeler* + *Speaks Telugu*
   + *Within 10 km*; the counts change; the cards say *verified* or *self-declared*; no addresses anywhere.
6. Take back *"Your location for distance to jobs"* in Privacy & consent: the pin is gone (the distance chip disappears).
7. Decide: keep the discriminatory-question refusal only behind the switch until launch (as built), or turn it on for
   every company now (one line: `_qrules` in `backend/app/companies/posting.py`). The existing "unfair wording" check
   (male preferred, caste, religion, …) already applies to everyone as before.

## Done / not done

- [x] Per-job questions on the company job form and edit: yes/no (required answer), number (min), single choice; up to 8; templates for the common ones
- [x] Discriminatory questions (gender, religion, caste, age, marital status, pregnancy, photo / looks) warned in the form and refused on the server (post, edit, Check), question text and options
- [x] Answers reused from one store (Auto Apply's saved answers + Work preferences): apply form (shown as already answered), Auto Apply 2.0, the T5 agent (WhatsApp and the call script); answers given anywhere are saved; never asked twice
- [x] T5 agent asks number and choice questions (WhatsApp buttons / numbered list, Hindi / Telugu digits; call script lines in 3 languages); answers from calls cleaned per question
- [x] "Not a fit for: <question>" label for the company (applicants list and page), never hidden, deleted or auto-rejected; the candidate sees their answers
- [x] Hire now: verified driving licence (T2, vehicle classes), vehicle owned, shifts, night shifts, distance (rounded, from a coarse pin or a city; never coordinates), languages, can join now; each with its source; combined; counts
- [x] Work preferences card (shifts, night shift, weekends, vehicles, languages, notice / available now, relocate, location pin with its own consent), saved answers (forget), answers given
- [x] New T1 consent purpose `location` (plain text), withdraw deletes the pin, retention 365 days (30–730) in the T1 schedule; `work_prefs` 730 days after the last change; both erased with the account
- [x] Behind the Trust switch; OFF isolation tested (company form, apply form, applicants label, Hire now, candidate card)
- [x] Design system, 390 px with no sideways scroll; no new routes; no new lazy chunks (the cards are static imports in the company page and Privacy & consent chunks); Easy dashboard bundle and main bundle unchanged
- [ ] Auto Apply 2.0 still doesn't *send* an application whose own saved answers don't fit the rules (as before T6: it would only waste the candidate's daily limit); it isn't a rejection by anyone, and the candidate answering a waiting question is told "not a fit". Say if you'd rather it apply anyway with the label.
- [ ] Languages are self-declared only; the "verified" source is ready in the data for T10's spoken-English score.
- [ ] No pincode lookup yet (pin or city only); see `docs/trust/T6-vendors.md` for the free India Post data set if wanted.
- [ ] Hindi / Telugu texts for the new WhatsApp / call lines were written by us, not a native speaker (same as T5).
- [ ] The new candidate and company texts are English only while this is tested (like T2–T5).

## Tests

- Backend: `tests/test_trust_t6.py` — **11 passed** (the model: number / choice knock-outs, Hindi / Telugu digits, option
  numbers, "Not a fit for" texts, templates; discriminatory questions refused and work questions allowed, options checked;
  company CRUD: 8 questions with templates, 9 refused, unfair questions refused on post / edit / Check, the office pin
  rounded and refused outside India, removed on edit; switch OFF company: 5 questions, no refusal, no pin, templates 404;
  saved answers reused: Work preferences answer the job's common questions (shown on the job page, not asked), a new
  answer is saved and not asked on the next job, Auto Apply's saved answers see them, a changed answer wins and updates
  the preference, "forget" makes it asked again; Not a fit for: in applicants list and page, nobody hidden or rejected,
  the candidate sees their answers without the rules; switch OFF candidate: nothing filled in, no "for"; the agent asks
  number and choice questions, skips the known one, saves answers, labels the application, and the call script leaves out
  known questions and says the choices; Hire now: each filter, combined, counts, source labels, a licence under review
  doesn't count, test licences only on a demo company on production, no coordinates anywhere; distance rounding and
  city / office points; location consent required, outside India refused, only the rounded pin stored, withdrawal
  deletes it now, the retention job after 365 days, account erase).
- `tests/test_trust_t5.py` updated for T6 (a number question with a minimum is now a knock-out; the T5 flows use a
  yes/no-only job; `fit.for` on agent applications): **27 passed**.
- Full backend suite: **1324 passed**, 1 failed (only the known local-only `test_test_users::test_create_open_and_remove`).
- `ruff check` / `ruff format --check`: clean. Frontend: vitest **640 passed** (3 new: the question body with templates,
  the live unfair-question warning, the Hire now query), lint no new warnings, build OK. Easy dashboard Telugu / Hindi
  **149.1 / 150 KB** (no change); the main entry script 111,791 B gzip vs 111,811 B on T5 (unchanged).
- e2e `frontend/e2e-live/trust-t6.spec.mjs`, desktop + 390 px, `--repeat-each 2`: **12 passed**. Also re-run and
  passing: company-apply, company-jobs, hire-shortlist, trust-t5 (10 passed).

## Vendors to sign up for

None for T6 (see `docs/trust/T6-vendors.md`).

## Database

Additive only: new collection `trust_work_prefs` (one row per person: the preferences and an optional `location`
{lat, lng rounded to 2 decimals, label, source pin | city, at}); job questions may carry `template`; jobs may carry
`geo` {lat, lng} (the office pin, rounded); applications may carry `fit.for` (the questions not met); saved answers stay
in `users.auto_apply.answers` (as before). New consent purpose `location`; new retention types `location` (365 days)
and `work_prefs` (730 days).

🤖 Generated with [Claude Code](https://claude.com/claude-code)

https://claude.ai/code/session_01SBaqRLDLwSKFN3nQpCsLVw
