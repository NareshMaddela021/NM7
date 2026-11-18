# Vetting Trust T12: fairness upgrades (blind AI grading, unfair-filter warnings, 5% re-grades, pass-rate gaps)

Base: `claude/confident-knuth-pu6nd3-trust-t11` · Branch: `claude/confident-knuth-pu6nd3-trust-t12` · **Stacked on #253 (T11)**, which is stacked on #252 (T10), #251 (T9), #250 (T8), #249 (T7), #248 (T6), #247 (T5), #246 (T4), #245 (T3), #244 (T2) and #243 (T1): merge #243 … #253, then this one (GitHub switches the base each time).

Everything user-visible is behind the one **Vetting Trust** switch from T1. While it is OFF, only admins, demo accounts
and listed testers (and companies with a tester on their team / the demo company) get anything new; real companies keep
today's job form, requirements and Hire now exactly; real candidates' grades are computed exactly as before (a test
checks the prompts are byte-for-byte the old ones).

**No new vendor**: the second-opinion re-grades use the Claude key we already have (feature "regrade" in the daily AI
allowance, at most 60 calls a week by default, about ₹25 a week at most). See `docs/trust/T12-vendors.md`.

## What this does, in plain words

- **Blind AI grading, one anonymiser for all of it** (`backend/app/trust/fairness/blind.py`). Before any AI call that
  grades or evaluates a person, the text about them has removed: their **name** (and each part of it), **email, phone,
  address / area / PIN code, date of birth and age, the colleges** in their education (from the account and the resume),
  and for anyone: emails, phone numbers, links, "Mr / Mrs / Smt" titles, **college / university / IIT / NIT …** names,
  Aadhaar / PAN-like numbers, house / door / PIN addresses, **gender, religion, caste, marital-status and pregnancy
  words**, "woman / lady / housewife", and **community / caste names** (Reddy, Kamma, Brahmin, …) — each becomes
  "[removed]". Photos are never sent with a grading call.
  - Where it applies: **V2 practical task grading** (written / tech / spoken), **V3 interview** follow-ups and grading
    (and the old weekly second grader), **T9 Explain your answer** (questions and check), **T10 spoken English**
    (grammar and comprehension), **T7 requirement checks**, **Auto Apply tailoring** (now also no colleges, references
    or declaration, and an AI line that would carry "[removed]" is blocked so the rules version is used), and the new
    **T12 re-grades**. T7 / T9 / T10 already anonymised; they now share this one anonymiser (T7's, generalised).
  - V2, V3 and tailoring did **not** anonymise before, so for them blind grading is applied **only where the Trust
    switch lets the person in** (testers, admins, demo accounts while it is OFF; everyone once it is public). Real users'
    grades don't change while the switch is OFF.
  - The one image call (V2's optional "photo of past work") sends only the work photo and the role, and is told not to
    judge the person; it never gives a score.
  - **A registry, checked by a test**: `BLIND` lists every AI call site that grades or evaluates a person; `NOT_GRADING`
    lists every other Claude call site with why it is not an evaluation of a person (job collector, the person's own
    resume / LinkedIn writers, practice interview feedback shown only to them, …). Together they must equal the schema
    registry in `tests/test_claude_schemas.py` (`SENT`), so a new grading call can't be added without a probe. Each
    `BLIND` site has a probe that feeds it a profile full of identifying data (name, email, phone, area, PIN, DOB,
    "24 years old", "married Hindu woman", "Brahmin", JNTU / IIT Bombay / Osmania, Aadhaar, PAN, LinkedIn) through the
    real code path and checks none of it reaches the prompt while the work does.
- **Warning employers about discriminatory filters** (`backend/app/trust/fairness/filters.py`), checked on the server and
  shown on the pages, in **job posts, screening (knock-out) questions, requirements and Hire now filters**:
  - **Can't be used** (direct; refused on post / edit / save, consistent with T6 / T7): "Male candidates only", "Girls
    preferred", "Age below 28", "Freshers under 25", "Unmarried only", "No married women", "not pregnant", "Hindus
    only", "No disabled", "Fair complexion", "Send your photo", "Local boys only"…
  - **May be unfair** (proxies; warned, can still be used): "Only from IIT / NIT / a top college", "2023 pass-outs
    only", "young and energetic", "locals only", "natives of", "Telugu people only", "mother tongue", "no family
    commitments", "no career gap", "physically fit", "pleasing personality", "height 5'6''", "salesgirl / office boy", a
    community name with "only / preferred"; in Hire now a **language filter the job doesn't mention** and a **city filter
    that isn't the job's city**.
  - Each note says what was found, **why** it can be unfair and a **neutral alternative** ("Ask for the experience the
    work needs (“0–2 years in sales”) instead of an age", "If the work needs a language, ask for the language: “Speaks
    Telugu with customers”"). "Attractive salary", "male and female candidates can apply", "Candidates below 18 years
    cannot apply", "maximum 10 years of experience" are fine (a test checks).
  - Where: the job form's **Check** card (direct ones also disable Post), the **Requirements** editor (after a save), and
    **Hire now** under the filters with **Keep it: the work needs it** / **Remove this filter**.
  - **Logged** for the fairness report (`trust_fairness_events`: company, where, topic, shown / kept / refused, the
    flagged words; never anything about a candidate). Posting or saving with a warning = "kept".
- **Re-grade a random 5% of AI-graded answers** (`backend/app/trust/fairness/regrade.py`), once a week (heavy lease,
  capped): **V2 practical tasks, V3 interviews and T9 "Explained own work"** get a **second, independent AI pass**
  (differently worded "independent second reviewer" prompt, same rubric, anonymised input). Each is recorded
  (`trust_regrades`: the two grades, the gap, material or not).
  - **Material**: V2 task score moves ≥ 15 points (Admin) or across the pass mark; V3 a rubric line > 1 point apart or
    pass ↔ not pass; T9 two steps apart or into / out of "weak".
  - **Never changed by itself**: a material disagreement goes to a person — V2 to Admin → Skill checks → **Review
    queue** (as a borderline grade does), V3 to **Interviews → Bias checks** (the existing queue), T9 to the new card
    (Keep first / Use second; audited).
  - **Alert**: for a role × kind over the last 8 weeks, when at least 5 re-grades (Admin) were made and 25% or more
    (Admin) disagreed materially (the old V3 weekly check counts too).
  - Caps: at most **60 second passes a week** (Admin 0–500), sample 5% (Admin 1–20%), each counted in the AI allowance.
    While the switch is OFF only testers', admins' and demo accounts' items are sampled. The old V3 weekly check keeps
    running for every interview as before (and skips ones T12 re-graded).
- **Pass-rate gaps in the fairness report** (`backend/app/trust/fairness/report.py`): rates for **skill checks** (test
  passed), **AI interviews** (passed), **spoken English** (T10 B1+), **Auto Apply** (company replied) and **Hire now**
  (invited), by **interview language** (EN / HI / TE), **region** (an accent proxy: South / West / North / East /
  North-East / Central from the person's city — coarse, only aggregated) and **city tier** (tier 1 / 2 / 3). A group is
  flagged by the **four-fifths rule** (its rate is under 80% of the best group's) when both have at least **30 people**
  (Admin 10–500); smaller groups show "under 30" and no rate, so nobody can be picked out. Plain explanation per flag.
  **Weekly snapshot** (`trust_fairness`, one per ISO week) and **Make a snapshot now**. The existing V5 monthly report
  stays as it was.
- **Admin → Skill checks → Vetting Trust → Fairness** (new card): blind grading places, re-grade settings / last run /
  alerts / latest disagreements (T9 decided there), pass-rate gap snapshot with flags and per-group tables, unfair-filter
  counts (shown / kept / refused by where and topic), Save, Run re-grades now, Make a snapshot now. All changes audited.
- **Privacy / retention**: re-grades hold the two grades (no answer text) — new T1 retention type **"Second-opinion
  re-grades" 365 days** (90–730), deleted by the daily job and with the account. Filter events and snapshots carry no
  personal data; they are trimmed after 1 and 2 years.

## What Naresh should check

1. Make your company admin email a Trust tester (Admin → Skill checks → Vetting Trust).
2. As the company: Jobs → Post a job → type "Freshers under 25 only. Only from IIT or NIT." in the description → **Check**:
   "Can't be used (age)" with why and "Try instead", Post is off; "May be unfair (which college)". Remove the first
   sentence → Check → Post works with the warning. Try a question "Locals only: do you live in Hyderabad?".
3. Requirements for that job: add "No family commitments" → Save → "May be unfair (marital status)"; add "Freshers under
   25" → refused with why.
4. Hire now → that job → Languages: Tamil → the note (the job doesn't mention Tamil) → Keep it / Remove this filter.
5. Admin → Vetting Trust → **Fairness**: read the blind-grading list; **Make a snapshot now** (with little real data most
   groups say "under 30" — that's on purpose); look at the unfair-filter counts from steps 2–4; leave re-grades at 5% /
   60 a week (or set the cap to 0 to switch them off).
6. Read the word lists in `backend/app/trust/fairness/filters.py` (direct vs proxy) and the community-name list in
   `blind.py`: anything to add for Telangana / AP hiring language we see? Decide whether "physically fit" / "height" for
   security-guard or delivery roles should stay a warning (as built) — the company can keep it.
7. Decide the thresholds: material = 15 task points; alert at 25% of ≥ 5 re-grades; four-fifths with 30 people minimum.

## Done / not done

- [x] One anonymiser (T7's, generalised) before every AI grading / evaluation call: V2 grading, V3 follow-ups / grading / weekly second grader, T9, T10, T7, Auto Apply tailoring, T12 re-grades; photos never sent with a grading call
- [x] `BLIND` registry + `NOT_GRADING` = every Claude call site (`SENT`); one probe per BLIND site with a profile full of identifying data through the real code path: nothing leaks
- [x] Blind V2 / V3 / tailoring behind the switch (real users' prompts unchanged while OFF — tested); T7 / T9 / T10 already anonymised
- [x] Direct discriminatory filters refused (job post / edit, questions, requirements) with why + a neutral alternative; proxies warned (also Hire now language / city filters); server-side and on the pages
- [x] Warnings shown / kept / refused logged (no candidate data) and counted in the Admin card
- [x] ~5% weekly second-opinion re-grades of V2 / V3 / T9 (anonymised, independent prompt), weekly cap, heavy lease, AI allowance; disagreement recorded; material → a person (Review queue / Bias checks / the card), never changed by itself; alert per role × kind
- [x] Pass-rate gaps by interview language, region (accent proxy) and city tier for skill checks, interviews, T10 bands, Auto Apply replies, Hire now invites; four-fifths rule; minimum group size (no numbers below it); plain explanations; weekly snapshot; never individual data
- [x] Admin Fairness card (settings within bounds, run now, decisions), audited; retention type for re-grades
- [x] No new route (company notes in the existing company page chunk, the card in the Admin chunk); main bundle unchanged (342,834 bytes, same as T11); Easy dashboard Telugu / Hindi 149.2 / 150 KB unchanged; 390 px with no sideways scroll
- [ ] Word lists are English / Hinglish only; Hindi / Telugu job text isn't checked yet (most job posts are English).
- [ ] The region proxy uses a list of about 120 cities and state names; people in other towns show "Other / not known".
- [ ] Spoken-English (T10) rows don't store the interview language, so that metric groups by the person's site language.
- [ ] When a person re-grades a V2 task lower in the Review queue, an already awarded "Skill verified" badge stays (existing Review-queue behaviour, unchanged).
- [ ] The requirements editor shows proxy warnings after Save (the server's answer), not while typing.

## Tests

- Backend: `tests/test_trust_t12.py` — **23 passed**: registry = SENT and one probe per BLIND site (7 probes: V2 grading +
  the photo check, the real V3 interview flow with T9 questions / check and the old weekly second grader, T10, T7,
  tailoring, T12 re-grades) with no identifying data in any prompt; the anonymiser; switch OFF = the old prompts exactly
  (and blind once public); direct refused / proxies warned / neutral text fine (incl. Hire now filters); job post +
  question + edit (refused, warned, logged shown / refused / override), the live check and "keep it"; requirements
  refused / warned; Hire now warnings; re-grades ~5% of 300 with the weekly cap (0 more, then 5 in a new week), never
  changing the grade, Review-queue items, the alert, agreement → no review; material rules and sampling; V3 → Bias
  checks and T9 decided by Admin (audited), the old weekly check skips it; switch OFF → only testers sampled; pass-rate
  gaps (four-fifths exactly at 0.8, minimum sample, tier / region / language flags, no ids / names / emails in the
  report or the card, weekly snapshot once); regions / tiers; Admin settings bounds, audited; switch OFF → no notes,
  no events, 404.
- Also re-run and passing: `test_claude_schemas.py`, `test_trust_t6.py`, `test_trust_t7.py`, `test_trust_t9.py`,
  `test_trust_t10.py`, `test_auto_apply_v2.py`, `test_companies_posting.py`, `test_hire_shortlist.py`, `test_vetting*.py`,
  `test_trust_t1.py`, `test_trust_t8.py`; e2e trust-t6, trust-t7, company-jobs (14 passed).
- Full backend suite: **1397 passed**, 1 failed (only the known local-only `test_test_users::test_create_open_and_remove`).
- `ruff check` / `ruff format --check`: clean. Frontend: vitest **655 passed** (2 skipped), lint no new warnings (the 3
  existing ones), build OK; main bundle unchanged; Easy dashboard Telugu / Hindi **149.2 / 150 KB** (unchanged).
- e2e `frontend/e2e-live/trust-t12.spec.mjs`, desktop + 390 px, `--repeat-each 2`: **16 passed** (job post direct / proxy
  with Check and Post; requirements + Hire now keep / remove; Admin card snapshot gap, T9 decision, settings put back;
  switch OFF).

## Vendors to sign up for

- **None.** The re-grades use the existing Claude key (feature "regrade"; ≤ 60 calls a week by default ≈ ₹25 a week at
  most). No new Render env vars. Details: `docs/trust/T12-vendors.md`.

## Database

Additive only: new collections **`trust_fairness_events`** (company, where, topic, level, action, flagged words, time),
**`trust_regrades`** (kind, item, person id, role, the two grades, gap, material, status, decided by), **`trust_fairness`**
(_id = ISO week: counts per group, flags, filter counts). Skill attempts may get `task.blind`; interviews re-graded by
T12 get `bias` {…, by: "t12"} (the existing field); a T9 label a person changed gets `explain.by: "admin"` and
`explain.first_label`. Site settings `trust.fairness` {regrade, report}. `trust_runs` row `fairness_regrade`. New
retention type `regrades`. New AI allowance feature `regrade`. Code: `backend/app/trust/fairness/` (blind, filters,
regrade, report, router); small hooks in `app/hire/vetting/grade.py`, `interview.py`, `router.py`,
`app/autoapply/tailoring.py`, `app/companies/posting.py`, `app/trust/criteria/router.py` (+ `evidence.py` re-exports the
anonymiser), `app/trust/honesty/explain.py` (its scrubber is the shared one), `app/hire/shortlist.py`,
`app/automation.py`.

🤖 Generated with [Claude Code](https://claude.com/claude-code)

https://claude.ai/code/session_01SBaqRLDLwSKFN3nQpCsLVw
