# Vetting Trust T9: "Explain your answer", the honesty pledge and retake limits people can see

Base: `claude/confident-knuth-pu6nd3-trust-t8` · Branch: `claude/confident-knuth-pu6nd3-trust-t9` · **Stacked on #250 (T8)**, which is stacked on #249 (T7), #248 (T6), #247 (T5), #246 (T4), #245 (T3), #244 (T2) and #243 (T1): merge #243 … #250, then this one (GitHub switches the base each time).

Everything new is behind the one **Vetting Trust** switch from T1. While it is OFF only admins, demo accounts and listed
testers get it: everyone else gets the skill checks, the practical task and the AI interview **exactly as before** (no
pledge, the old "one try per role every 30 days", 7 interview questions, no new label, no new AI call), and a company
the switch is off for sees the interview summary as before.

## What this does, in plain words

- **"Explain your answer"** (AI interview). When someone has sent the **practical task** for a role (a written, tech or
  spoken answer), their interview for that role gets **1 question** (Admin: 1 or 2) about **their own answer**, just
  before the last question: *"In your practical task you wrote: “I join on the key, filter the month…”. Why did you
  choose to do it this way, and what would you change if you had more time?"*
  - Written by the AI from their answer, with an exact quote from it (checked word for word). The answer is
    **anonymised first** (no name, email, phone, address, college, date of birth, age, gender, religion, caste). Strict
    schema, counted in the AI allowance (new feature **"explain"**, 4 a person a day).
  - No AI key, allowance used up or an unusable answer → a **rules question**: a template citing a sentence of their
    task, in **English, Hindi or Telugu** (the interview's language). Typed or spoken, like every other question; no
    AI follow-up on it.
  - At the end it gets its own label, **"Explained own work: Strong / Partial / Weak / Not answered"**, with a one-line
    reason. The AI judges whether the reply shows they understand what they sent; language, accent and English level
    never lower it. Without AI, simple rules (never "Strong"; a reply in another script than the task is "Partial"
    because it can't be compared word for word). The 5-line interview rubric **never sees** these questions, so the
    interview score and the pass are unchanged.
  - The candidate sees the label and the reason on their result ("it never changes your score"); **companies** Vetting
    Trust lets in see the plain label and the reason in the screening summary.
  - **Weak** becomes an integrity signal for T8 (`explain_weak`, weight **1**, cap **2**, fades like the others). It
    never rejects anyone: only a High rating sends a person to the human review, and the candidate can explain / appeal.
    "Not answered" is not a signal (time can run out).
- **Honesty pledge** before a **skill check** (and the badge refresher), the **practical task** and the **AI interview**:
  *"I will answer on my own, without help from other people or AI tools (like ChatGPT). I won’t copy answers or let
  someone else do this for me. I understand Nm7 may check my answers and how the test was taken, and a person may ask
  me about them. Nothing is decided automatically."* + one tick ("I promise to answer honestly, on my own."), in
  English, Hindi or Telugu (the test's language). Start stays off until it is ticked, and the **server refuses** to
  start without it (`409 pledge`). Recorded with the attempt / task / interview: **version, time, language**. Shown in
  the T8 **evidence view** (Admin → Integrity rating → a person → "Honesty pledges") and on the candidate's result.
  Carrying on with a test in progress asks nothing again.
- **Retake limits people can see**, from the same code that enforces them:
  - before starting (start dialog / interview set-up) and on every result: **allowed** (e.g. "1 attempt every 30 days
    for this role"), **used** ("1 of 1 in the last 30 days"), **when the next attempt opens** (date + "in 20 days"),
    and **what counts**: the skill badge comes from the **latest passed attempt** (a later attempt that doesn't pass
    doesn't take it away; it lasts until its end date); for the interview the **latest passed one counts for 180
    days** (same idea). This is what the engine already did; now it is said.
  - the rule: at most N starts per role in any D-day window (any attempt counts: a full test, a refresher, a free
    retest; any interview). Default **1 every 30 days = exactly the old rule**. A free retest after "needs retest" and
    carrying on with a running test are always allowed (as before).
  - Admin → Skill checks → Vetting Trust → **Honesty pledge and retakes**: attempts 1–3 and period 7–90 days for the
    skill check and for the interview (bounds enforced, audited).
  - **Gap fixed**: the V5 badge refresher skipped the cooldown entirely, so a failed refresher could be retried at once,
    again and again (new random questions each time) until it passed. For Trust people it now waits **7 days** (Admin
    1–30) after the last refresher.
- **The T1 phone e2e that was flaky** (`trust-t1 › phone › owner: …`, failed twice in CI at "Record" in the breach log):
  the Vetting Trust tab was **443 px wide on a 390 px phone** (the long "Test mode: only testers and …" chips of the
  T2 / T3 / T4 cards don't wrap). On a phone Chrome then widens the page and zooms it out, so Playwright's click landed
  on the fields above the button ("select … intercepts pointer events") whenever those cards had finished loading
  before the click. Fixed at the cause: those chips wrap on that tab (now exactly 390 px). The test also waits for every
  card to load and for the reload after Save / Run (the cards are drawn again then), and checks the real width:
  `noSideScroll` compares with `window.innerWidth`, which a phone widens to the content, so it could not see this.
  New `fitsPhone` helper in `e2e-live/college.mjs` (T1 and T9 use it). No retries, no sleeps.

## What Naresh should check

1. Add your candidate email as a Trust tester and a Skill checks tester (Admin → Skill checks).
2. As the candidate, Skill checks → Start on a role: read the **"Attempts and retakes"** box and the **pledge** (plain
   enough? fair? true for us?). Try the Hindi / Telugu pledge on a role with those languages (Sales, Retail …).
3. Take a test, open the result: the limits, "Next attempt opens on … (in 30 days)", what counts, "You took the honesty
   pledge …".
4. With a role where you have sent the practical task, start the AI interview: the note about questions on your own
   task, the pledge, then the question quoting your task; after finishing, **"Explained own work"** on the result.
   (Locally: `uv run python -m tests.e2e_seed trust-t9-task <email> SQL` gives a badge with a task answer.)
5. Admin → Skill checks → Vetting Trust → **Honesty pledge and retakes**: the numbers, and the pledge in three languages.
   Admin → Integrity rating → a person: "Honesty pledges".
6. Decide: (a) should companies see "Explained own work" at all, or only Nm7? (b) the T8 weight for Weak (1, cap 2);
   (c) 1 or 2 explain questions by default; (d) the Hindi / Telugu texts (please have a native speaker read them —
   the Hindi pledge uses "करूँगा/करूँगी" to stay neutral); (e) whether the fixed refresher wait should also apply to
   everyone (today it applies only to Trust people, so nothing changes for real users while the switch is off).

## Done / not done

- [x] Explain your answer: 1–2 interview questions from the candidate's own practical task (AI with an exact quote,
      strict schema, in SENT, counted in the AI allowance; anonymised; rules template fallback in EN / HI / TE), typed
      or spoken; graded Strong / Partial / Weak / Not answered with a reason, separately from the rubric; shown to the
      candidate and (Trust companies) to companies; Weak → T8 signal, documented weight, never a rejection
- [x] Honesty pledge before a skill check / refresher, the practical task and the interview: required (server-side),
      recorded (version, time, language), versioned, in the evidence view and on results; EN / HI / TE
- [x] Retake limits shown before starting and on results (allowed, used, next opening with a countdown, what counts),
      enforced by the same function server-side; Admin-editable within bounds; the refresher gap fixed (Trust people)
- [x] Behind the Trust switch; with it off everything is exactly as before (tested)
- [x] T1 phone e2e: cause found (page wider than 390 px → zoomed-out phone → clicks off target) and fixed
- [x] Design system, 390 px with no sideways scroll; no new routes; the pledge / limits are one small lazy chunk
      (`trust/Honesty`, 3.7 KB) loaded by the skill-check / interview pages; Admin card in the admin chunk; **main entry
      script byte-for-byte the same size as T8** (342,834 B); Easy dashboard Telugu / Hindi **149.1 / 150 KB**
- [ ] No Admin control to change an "Explained own work" label by hand (a reviewer can clear the T8 signal; the label
      itself stays as graded).
- [ ] Proof-type practical tasks (work situations + a photo) have no text to ask about, so those roles get no explain
      question.
- [ ] The interview's "7 questions · about 10 minutes" texts stay as they are (an explain question makes it 8).
- [ ] Hindi / Telugu texts not yet checked by a native speaker.

## Tests

- Backend `tests/test_trust_t9.py` — **9 passed**: the window rule and its boundaries (open exactly D days after;
  N > 1; Admin lowered below what was used; the default = the engine's rule; bounds clamped); the explain rules (a
  question citing a sentence in EN / HI / TE; an AI question must quote the answer word for word and be a question;
  rules grading never "strong", another script → partial; combining labels); the pledge required / wrong version
  refused / recorded (version, time, language) for the test and the task, on the result and in the evidence view;
  limits shown = limits enforced (catalog, result, `/api/me/trust/honesty` and the 409 all give the same date), Admin
  numbers (out of bounds 422, audited), the cooldown boundary, the refresher gap; the interview: pledge, limits,
  carrying on without a new pledge; Explain: the question generated from the submission (exact quote, placed before the
  last question), **no name / college / email / phone in the prompt**, counted in the AI allowance (1 then 2), no
  follow-up on it, graded Weak with the reason, the interview still passed (the rubric never sees it), a T8 signal of
  weight 1 and the rating still Low, the company label only for a Trust company (and the transcript without the
  explain turn for others); the rules fallback in Hindi with a spoken task and rules grading; an unusable AI answer →
  rules question; Admin 2 questions / off; **switch OFF**: 404, no pledge, no limits block, the old 30-day and refresher
  rules, 7 questions, no explain call, nothing new stored.
- Full backend suite: **1348 passed**, only the known local-only `test_test_users::test_create_open_and_remove` fails
  (T3's gate test now sends the pledge for its Trust tester). `ruff check` / `ruff format --check`: clean. Frontend: vitest **651 passed** (4 new: the limits and
  pledge texts), lint no new warnings (the 3 old ones), build OK.
- e2e `frontend/e2e-live/trust-t9.spec.mjs`, desktop + 390 px, `--repeat-each 2`: **16 passed**. `trust-t1.spec.mjs`
  with `--repeat-each 2`: **16 passed**. Re-run and passing: trust-t3, trust-t8 (they now tick the pledge for their
  Trust testers), hire-skillcheck, hire-skillcheck-classic, vetting-interview, vetting-admin, hire-shortlist.

## Vendors to sign up for

None (see `docs/trust/T9-vendors.md`). "Explain your answer" uses the existing Claude key: about ₹0.55 per interview with
a practical task, only for Trust people; without the key it uses rules and costs nothing.

## Database

Additive only: `skill_attempts.pledge` and `skill_attempts.task.pledge` ({version, at, lang}); `vetting_interviews.pledge`,
`.explain_source` (which attempt the questions are about), `.explain` ({label, reason, by ai / rules, items, at}) and
turns of kind `explain` (question, quote, source). They live in the interview record, so they go with the transcript
(T1 retention "AI interview transcripts", 180 days; the "AI interview" consent; account erase). Site setting
`trust.honesty` (skill / interview attempts and days, refresher days, explain on / questions). AI allowance feature
`explain`. New T8 signal kind `explain_weak`.

🤖 Generated with [Claude Code](https://claude.com/claude-code)

https://claude.ai/code/session_01SBaqRLDLwSKFN3nQpCsLVw
