# Vetting Trust T7: job description → requirements, each Met / Not met / Unknown with quoted evidence

Base: `claude/confident-knuth-pu6nd3-trust-t6` · Branch: `claude/confident-knuth-pu6nd3-trust-t7` · **Stacked on #248 (T6)**, which is stacked on #247 (T5), #246 (T4), #245 (T3), #244 (T2) and #243 (T1): merge #243, #244, #245, #246, #247, #248, then this one (GitHub switches the base each time).

Everything new is behind the one **Vetting Trust** switch from T1. While it is OFF, only admins, demo accounts and listed
testers see anything new. Real companies keep today's Jobs, Applicants and Hire now (same order, no new boxes); real
candidates see nothing new in Profile & settings; the requirement endpoints answer 404 for them.

## What this does, in plain words

- **The job's requirements** ("criteria"): from the title, description, skills, level, education and the knock-out
  questions, the AI (the cheap configured model, a strict schema, counted in the daily AI allowance as `criteria`)
  lists **5–10 short requirements**, each with a kind (skill, experience, education, certification, language, licence,
  location, shift, other) and **must-have or nice-to-have**. Without the AI (no key, the allowance used, an error) the
  **rules** make the list: the skills (the first 3 must-have), the level's years, the education asked, the common
  knock-out questions (night shifts, licence, …), languages / licence / certificates named in the description, the city.
  - **Read once per version of the job**: a hash of what it was read from; edited again only when the description
    (or skills, level, questions) changes.
  - **The company can edit it** (Jobs → each job → *Requirements for this job*; also above Applicants when one job is
    picked, and in Hire now): add, remove, reword, change the kind, tick *Must-have*. **The edited list is the source of
    truth**: if the description changes later the list is only marked "the description changed" with *Read it again*
    (which replaces the edits).
  - **Unfair requirements are refused** (from the AI, the rules and the company): gender, religion, caste, age, marital
    status, pregnancy, photos / looks (the T6 check) and also **a person's name or which college** ("IIT graduates",
    "a top college", "tier 1", "alumni of", …). The company sees why.
- **Each candidate, each requirement: Met / Not met / Unknown, with a quote and where it came from**:
  - Sources: the **resume** they applied with (headline, summary, jobs, projects, skills, certificates listed,
    languages, education level — never the college), **skill checks** they shared and **Skill verified** badges (e.g.
    "Excel: Skill verified · 1–3 years · test 84/100 · practical task 80/100 on 12 Nov 2026"), their own words in their
    graded **AI interview**, **DigiLocker documents verified now** (T2: "B.Com · passed · 2019 · verified via DigiLocker",
    driving licence classes), **Work preferences** (T6, self-declared), and **certificates they added that Nm7 checked**.
  - **Rules first** (instant, free): skills / certificates / languages / shifts / licence / education level / years
    from the resume's jobs. What they can't answer goes to the AI **queue**: one call per candidate for up to 10
    requirements, a few at a time while the page shows **"evaluating…"**, the rest by the automation pass (heavy lease,
    20 calls a pass), all inside the allowance (150 a company a day).
  - **Truthfulness, checked on the server**: every Met / Not met must carry a quote that is **word for word** in the
    source it names; otherwise it becomes **Unknown**. No evidence → Unknown (never a guess). "Not met" only where the
    evidence shows it (e.g. "1.4 years in total on the resume" for "At least 2 years").
  - **Anonymised**: before anything reaches the AI (and in every quote) the person's **name** (and each part of it),
    **email, phone, address / location, colleges, date of birth and age, gender, religion, caste and marital words,
    links** become "[removed]"; photos are never read. A test checks the prompt contains none of them.
  - **Cached per (candidate, requirement words)**: ticking must-have or removing a requirement never checks anyone
    again; a new or reworded one is checked once per candidate; a change to the person's evidence checks them again.
- **Instant re-sort**: Applicants (one job picked) and Hire now are sorted by **must-haves met, then nice-to-haves met,
  then the match score**. Ticking must-have saves at once and the list re-sorts at once (Hire now re-checks only the
  people on screen, no new shortlist). **Not met never rejects, hides or moves anyone**: it is a label and an order.
- **The company sees** a compact chip strip on each applicant / Hire now card ("2 of 2 must-haves · 1 of 2
  nice-to-haves", ✓ ✗ ? per requirement, bold for must-haves) and, opened, each requirement with its quote and source
  (*"✓ Met SQL · must-have · Resume: “Data Analyst · SQL · Power BI”"*). People who haven't agreed show all Unknown with
  "hasn't agreed to matching yet".
- **The candidate** (Profile & settings → *Job requirements you were checked on*): the consent in plain words, then
  for each job they applied to the requirements, Met / Not met / Unknown and **their own** evidence (never anyone
  else's). **Add evidence**: pick a certificate from the wallet (Profile → Certificates) for a requirement; it counts
  only after a person at Nm7 checks it (Admin → Skill checks → Vetting Trust → *Job requirements: evidence to check*:
  open the file, Accept / Not accepted, the person is told). A DigiLocker document or a skill check counts by itself.
- **Consent, withdrawal, retention (DPDP)**: a new T1 purpose **"Matching you to a job's requirements"**; without it
  nothing is checked or stored. Results are kept **180 days** (Admin → Retention, 30–365) and deleted by the daily job;
  evidence a person added **365 days** (90–730); both deleted at once when the consent is taken back, and with the
  account.

## What Naresh should check

1. Make your company admin email and two candidate emails Trust testers (Admin → Skill checks → Vetting Trust).
2. As each candidate: Profile & settings → **Job requirements you were checked on** → read the consent text (plain
   enough?) → *I agree*. Give one a resume with SQL / Power BI and the other one with Tally and Telugu. Apply to a job.
3. As the company: Jobs → your job → **Requirements for this job**: is the list sensible (with an AI key on Render it is
   read by the AI; locally by rules)? Try adding **"Female candidates only"** or **"IIT graduates"** → refused with why.
4. Applicants → pick the job: each card shows the chip strip; open *Requirements and evidence*: every Met / Not met has
   a quote you can find in the resume / skill check / document. Tick *Must-have* on "Speaks Telugu" and untick SQL /
   Power BI: the order changes at once; nobody disappears or is rejected.
5. Hire now with the same job: the same strips; ticking must-have re-sorts the people shown.
6. As a candidate: add a certificate in Profile → Certificates, then *Add evidence* on an Unknown requirement → Admin →
   Vetting Trust → *Job requirements: evidence to check* → Accept → the requirement is Met with "Certificate checked by
   Nm7" for the candidate and the company.
7. Take back *Matching you to a job's requirements* in Privacy & consent: the company sees Unknown for that person.
8. Decide: (a) **consent first** (as built: strict DPDP; a person who hasn't agreed shows all Unknown) or ask for it in
   the apply form at launch; (b) Applicants with **All jobs** keeps today's order (requirements need one job picked).

## Done / not done

- [x] Extraction: AI with a strict schema (additionalProperties false, in `tests/test_claude_schemas.py` SENT), counted in
      `ai_quota` as `criteria`; rules fallback; 5–10 (at most 10) requirements with kind and must-have; cached per job
      version (hash); re-read only when the job changes; company edits are the source of truth (stale note, read again)
- [x] Per candidate Met / Not met / Unknown with quote + source from resume, skill checks / Skill verified, AI interview,
      DigiLocker documents, Work preferences, checked certificates; quotes verified word for word on the server, else Unknown
- [x] Anonymised before the AI (name, email, phone, address, college, DOB / age, gender and other personal words, links;
      no photo) — tested on the prompt
- [x] Cached per (candidate, requirement hash) and evidence version; edits re-use answers and only check new / reworded
      ones; AI work batched (one call per candidate), capped (3 per page request, 20 per automation pass), within the
      allowance; "evaluating…" while queued
- [x] Re-sort by must-haves met, nice-to-haves met, score (Applicants with one job, Hire now); never an automatic rejection
- [x] Company UI: editor on the job (Jobs, Applicants, Hire now), chip strip + expandable evidence; candidate card with
      their own evidence and Add evidence (certificate → Nm7 check → evidence); Admin check queue
- [x] Unfair requirements refused (T6 topics + names + colleges)
- [x] Consent purpose, withdrawal deletes, retention 180 / 365 days in the T1 schedule, erased with the account
- [x] Behind the Trust switch; OFF isolation tested (API 404, applicants / Hire now unchanged, no candidate card)
- [x] Design system, 390 px with no sideways scroll; no new routes; no new lazy chunks (company page chunk, Privacy &
      consent chunk, admin chunk); Easy dashboard and main bundle code unchanged
- [ ] Applicants with **All jobs** isn't sorted by requirements (each job has its own list); pick a job.
- [ ] The rules are deliberately cautious (many Unknowns without the AI); "Not met" from the rules only for years,
      education level, licence classes and Work preferences answers.
- [ ] The candidate can add evidence only as a certificate from the wallet (checked by a person); a typed note goes
      with it but is never evidence on its own.
- [ ] Texts are English only while this is tested (like T2–T6).

## Tests

- Backend: `tests/test_trust_t7.py` — **9 passed** (schemas strict; rules extraction and unfair ones dropped; the AI
  extraction strict, counted, cached per JD version, re-read on a JD change, edits kept and marked stale, read again
  falls back to rules on an AI error; unfair requirements refused by the API; switch OFF isolation (404s, no
  `criteria` in Applicants, no candidate side, nothing stored); rules quotes from resume / Skill verified / education
  level (never the college), Not met only with evidence, the order; must-have toggled → re-sorted with **no**
  re-evaluation (timestamps unchanged), a new requirement → only that one checked; nobody rejected; AI evaluation:
  queued, one call for 3 requirements, a made-up quote and a quote from the wrong source → Unknown, a real one → Met;
  the prompt holds no name / email / phone / address / DOB / age / gender / college; the anonymiser; consent required
  (nothing stored without it), the candidate's own view only, added certificate counts only after the Admin check,
  retention after 180 days, withdrawal deletes; Hire now sorted by must-haves before score; the AI allowance limit
  leaves work queued).
- `tests/test_claude_schemas.py`: the two new schemas registered and strict.
- Full backend suite: **1333 passed**, 1 failed (only the known local-only `test_test_users::test_create_open_and_remove`).
- `ruff check` / `ruff format --check`: clean. Frontend: vitest **644 passed** (4 new: the order after an edit, people
  without requirements last, the editor's body, the strip line), lint no new warnings (3 old ones in files not touched),
  build OK. Easy dashboard Telugu / Hindi **149.1–149.2 / 150 KB**: its code is byte-for-byte the same as on T6 (only the
  file-name hashes inside differ, which moves gzip by a few bytes); main entry script 111,800 B vs 111,791 B on T6, the
  same code (diffed, hashes aside).
- e2e `frontend/e2e-live/trust-t7.spec.mjs`, desktop + 390 px, `--repeat-each 2`: **12 passed**. Also re-run and
  passing: company-apply, company-jobs, hire-shortlist, trust-t6 (12 passed).

## Vendors to sign up for

None for T7: it uses the Anthropic key the site already has (see `docs/trust/T7-vendors.md`, about ₹0.10–0.20 per
candidate checked by the AI, cached).

## Database

Additive only: new collections `trust_criteria` (_id = job id: the requirements, the job hash, edited or not),
`trust_criteria_evals` (_id = user:requirement hash: status, quote, source, note, by, evidence version, at),
`trust_criteria_queue` (waiting for the AI; dropped after 7 days) and `trust_criteria_claims` (a certificate a
candidate added for a requirement: pending / verified / rejected). New consent purpose `criteria_match`; new retention
types `criteria_evals` (180 days) and `criteria_claims` (365 days); new AI allowance feature `criteria` (150 a company a
day). Applicants and Hire now answers may carry `criteria` (only where the switch lets the company in).

🤖 Generated with [Claude Code](https://claude.com/claude-code)

https://claude.ai/code/session_01SBaqRLDLwSKFN3nQpCsLVw
