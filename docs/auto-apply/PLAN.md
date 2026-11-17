# Auto Apply: the build plan (5 phases)

Decided with Naresh on 17 Nov 2026. Auto Apply is the product's top feature: make it stronger and easier to use.

**Goal:** a student sets it up once in two minutes; after that most applications go out without them typing.
**The number to watch:** the share of applications finished without the student typing (Admin → Auto Apply).

## Decisions already made

| Question | Decision |
|---|---|
| Computer or phone first? | **Both.** The Chrome helper (computer) and the tap-to-copy card (phone) ship together in Phase 3. |
| Pricing | **Not fixed yet.** The free plan has a **daily limit** set in Admin. Keep a place for a paid plan with a higher limit; no prices in code yet. |
| Preview ("Approve each one") | **Flexible.** The student chooses "Ask me before each application" or "Apply for me straight away", and can change it any time. Admin keeps a default. |
| Bots on other websites | **Never.** Nothing is submitted on another website without the student pressing Submit. Only official, approved connections may submit by themselves. |

## What exists today (Phase 3 of the product, `backend/app/autoapply/`)

- Rules, the ATS gate (60) and consent: `settings.py`. Morning run from 07:00 IST: `engine.py`.
- Three channels: on Nm7 (straight into the company dashboard), by email (`emailing.py`, tailored PDF from `pdf.py`),
  on another website ("Ready to apply": the student finishes it by hand).
- "Needs your answer", borderline "apply anyway", skip, approve / approve all, and "remember" (saved answers kept under
  `users.auto_apply.answers`, keyed by the normalised question): `items.py`.
- Today card, one email a day, a weekly report, tips from real data: `summary.py`.
- Admin: off switch, defaults, pause a student or a company, run log: `admin.py`.
- Screens: `frontend/src/pages/me/AutoApply.jsx`, `AutoItems.jsx`, `AutoSummaryCard.jsx`.

So Phases 1, 2 and 5 below mostly **reshape and extend** what is there; Phases 3 and 4 are **new**.

## Build order

1. Phase 1 and Phase 2 (everything else uses the answer bank)
2. Phase 4a, the email finder (cheap, raises the automatic share quickly)
3. Phase 3, the helper and the phone card
4. Phase 5, then the rest of Phase 4

One pull request per phase (Phase 3 may take several). Every phase: tests, the activity log, plain words on screen that
work for people with little education (as on the Easy dashboard), English only for now with strings ready for Telugu
and Hindi.

---

## Phase 1: simpler setup and one "Today" screen (small)

To build:
1. **Two-minute setup.** Three questions: what job, which city (or remote), how many a day. Pre-filled from the resume
   (role ideas already come from `GET /api/me/auto-apply/suggest`). Every other rule moves under "More options" with
   the current defaults.
2. **Preview choice.** In setup and in settings: "Ask me before each application" / "Apply for me straight away".
   Stored per student; Admin's "preview days" becomes the default for new students. The engine reads the student's
   choice first.
3. **One "Today" screen** with three piles, each with one big button: **Applied for you**, **Needs your answer**,
   **Ready to finish**. It replaces jumping between the settings page, the items list and the summary card. Pause /
   Resume stays one tap away.
4. **Proof for every application.** Email applications already keep a copy of what was sent; show the same for Nm7
   applications (resume copy used, answers given, time, match score).
5. **Free daily limit.** A site setting "Applications a day on the free plan" caps the student's own daily limit.
   Write it so a later paid plan only raises the cap (one function decides the cap for a user).

Done when: a new student can turn Auto Apply on from the resume in under two minutes with three answers; the Today
screen shows the same numbers as `GET /api/me/auto-apply/summary`; a student on "straight away" has nothing waiting for
Approve; the free cap holds in the engine and in "answer now".

## Phase 2: answer once, never again (medium)

To build:
1. **Application answers page** (Profile → Application answers). The common questions as a fixed, typed list: notice
   period, current salary, expected salary, total experience, relocation, preferred shift, date of birth, address,
   highest qualification with marks, LinkedIn / GitHub / portfolio links, languages, own vehicle / licence, work
   permission in India. Each is optional; the page shows how many are filled.
2. **Everything saved is visible.** The answers saved by "remember" appear on the same page; the student can change or
   delete each one.
3. **Matching.** A new question from a company is matched to the typed list first (so "Notice period?" and "How soon
   can you join?" use one answer), then to the remembered answers.
4. **Written questions.** For "Why do you want this job?" style questions, draft an answer only from the resume's own
   facts (same fact check as the tailored resume). The student approves or edits it once per kind of question; an
   approved answer is reused, an unapproved draft is never sent.

Done when: answering a question once means it is never asked again on any channel; nothing is ever sent that the
student did not write or approve; deleting an answer makes the next job ask again.

## Phase 3: fill forms on other websites (large)

First, **measure**: an Admin report of the application systems behind the "applies on another website" jobs (count by
address pattern over the last 30 days). Support the top five first; each system needs its own field map.

To build:
1. **Nm7 Apply Helper** (Chrome extension, new folder `extension/`, Manifest V3):
   - the student installs it once and connects it to their Nm7 account (a helper token they can revoke in settings;
     the helper never sees the password);
   - on a supported application page opened from "Ready to finish", it fills the form from the profile and the answer
     bank and attaches the tailored resume PDF;
   - what it could not fill is highlighted; the student checks and presses **Submit** themselves;
   - it tells Nm7 the application was sent, so the tracker updates by itself;
   - it asks only for the permissions it needs, on the supported application systems only, and reads nothing else.
2. **API for the helper**: connect / revoke a helper token; "what to fill for this job" (profile fields, answers, the
   tailored resume file); "this one was sent". Same limits and consent as Auto Apply; all in the activity log.
3. **Phone: the tap-to-copy card.** In "Ready to finish" on a phone: each answer copies with one tap, the tailored
   resume is ready to download or share into the form, the job opens in a new tab, and "I applied" records it.
4. **Publishing**: Chrome Web Store listing (developer account, privacy policy page on nm7.si, Google's review).

Done when: on each of the five systems a test form is filled with no wrong field; nothing is ever submitted without the
student's own press; on a phone a "Ready to finish" job takes taps, not typing.

## Phase 4: more jobs that are fully automatic (medium, alongside)

a. **Email finder.** When a collected job post gives an application email, switch the job to the email channel (with
   the existing checks: a real address at the company's domain or a known hiring mailbox, never a personal address
   taken from somewhere else).
b. **Companies post on Nm7.** Every job posted through "Hire in 60 minutes" is fully automatic. Show companies how many
   matching students Auto Apply would send them.
c. **Official connections only.** Where an application system offers an approved way to submit, connect to it. No
   server bots that sign in to other websites.

## Phase 5: smarter and more trusted (medium)

1. **"Why this job" in one line** on every item (from the match the engine already computed).
2. **"Not for me" with a reason** (role, city, salary, company): the reason adjusts the student's rules after they
   confirm.
3. **Results in the app**: applied, viewed by the company, replies, interviews (the weekly report's numbers, on the
   Today screen).
4. **One polite follow-up** on an email application after a set number of days with no reply, inside the site's daily
   email cap, never more than one.

## Risks to keep in view

- Job sites change their forms: the helper needs a quick way to switch off one system from Admin without a new version.
- The Chrome Web Store review can take days and may ask for changes.
- Resend's free plan sends 100 emails a day: the email finder and follow-ups raise email volume (the site cap already
  holds the rest for the next run).
