# Vetting Trust T8: one integrity rating per candidate, with the evidence, a human review and optional webcam snapshots

Base: `claude/confident-knuth-pu6nd3-trust-t7` · Branch: `claude/confident-knuth-pu6nd3-trust-t8` · **Stacked on #249 (T7)**, which is stacked on #248 (T6), #247 (T5), #246 (T4), #245 (T3), #244 (T2) and #243 (T1): merge #243 … #249, then this one (GitHub switches the base each time).

Everything new is behind the one **Vetting Trust** switch from T1. While it is OFF only admins, demo accounts and listed
testers see anything new: real candidates see no snapshot choice and no rating card (the endpoints answer 404), real
companies see no label, the automation pass rates nobody else and emails nobody else. **V2 / V3 / V5 are not changed**:
T8 only reads their records (the fraud scan, the integrity and appeal queues and their decisions work exactly as before).

## What this does, in plain words

- **One rating per candidate**: **Low risk**, **Medium risk**, **High risk**, or **Not enough data** (nothing done yet
  and nothing noticed). Worked out from every signal Nm7 already has, with numbers anyone can read
  (`backend/app/trust/integrity/rating.py`, also shown in Admin and, in plain words, to the candidate):
  - each kind of signal has a **weight** and a **cap** (the most that kind can ever add);
  - old signals count less: the weight **halves every 60 days**, nothing after 365 days;
  - a signal a person **cleared counts 0**; one a person **confirmed counts 1.5×** and doesn't fade (still capped);
  - below 3 points Low, 3 to 6 Medium, 6 or more High.

  | Where from | Signals (weight / cap) |
  | --- | --- |
  | Skill check (V2) | left the page often 1/2 · away long (focus lost) 1/2 · copy 0.5/1 · paste 1.5/3 · dev tools 0.5/1 · impossible speed 1.5/3 · same answer position 1/2 · answer similarity with another account 3/4 · task text the same as another account 3/4 · same device as another account 2/4 · experience vs easy questions 0.5/1 · too many pauses 0.5/1 |
  | AI interview (V3) | 3+ paste attempts 1.5/3 · away often / long 1/2 |
  | Account checks (V5 scan) | same phone 2/2 · same device on several accounts 2.5/4 · duplicate resume 3/3 · impossible resume dates 1/1 · copied answers 3/4 |
  | DigiLocker (T2) | name differs 1/2 · **duplicate PAN** 4/4 |
  | ID + selfie (T3) | didn't pass after all tries 2.5/2.5 · **not the same person at joining** 5/5 |
  | Webcam snapshots (T8) | no face 0.5/1.5 · more than one face 1.5/3 · not the same person as the ID check 3/4 |

  The sources' own human decisions count: an **upheld V5 appeal** (free retest / corrected score) clears that test's
  signals, a V2 integrity "clear" clears them and "hold" confirms them, a V5 fraud decision clears / confirms, a T2
  review clears / confirms, a T3 review clears / confirms. **Asking for a manual check (no camera, a disability) is
  never a signal.** T4 fraud reports are about jobs and companies, never about a candidate, so they are not used.
- **High risk → a person** (Admin → Skill checks → Vetting Trust → **Integrity rating**): the review queue; each
  person's **evidence view** (every signal: where, when, source, weight → what it counts now, cap, status, the detail
  only reviewers see); **Clear** / **Confirm** / Undo per signal (with a note); **Ask them to explain** (the candidate
  sees it in Profile & settings, testers also get a short email that never says "fraud"); **Finish the review**.
  Nothing is decided by the rating: **nobody is rejected, hidden or moved down a list** because of it. Re-rated every 6
  hours by itself (heavy job, capped) and with "Check everyone now".
- **The candidate** (Profile & settings → **Your integrity rating**): the label in plain words, what was noticed (what,
  where, when, how many points, open / cleared / confirmed: never another person, a device or an address), the review
  ("A person at Nm7 is looking at this. Nothing is decided automatically…"), **Explain something** at any time, and for
  a skill check or interview **Ask for a free review of this test** (the existing V5 appeal), plus how it is worked out.
- **Companies** see only the label on applicant cards / profiles and Hire now cards ("Integrity: Low risk", "… ·
  Reviewed by Nm7" after a person looked), or **"Under review by Nm7"** while a review is open. Never the signals,
  never a device or network, never the word fraud.
- **Optional webcam snapshots** during a skill check or the AI interview:
  - only with their own consent (new T1 purpose **"Webcam snapshots during tests (optional)"**: a few still photos at
    random times, no video and no sound, why, who sees them, kept N days, saying no is fine), asked as one unticked box
    in the start dialog; never needed: without it the test works exactly the same and the rating says "No webcam
    snapshots (they are optional)";
  - 3–5 photos a session (Admin; default 4) at random moments (the first in the first half-minute), 320 px JPEG, the
    camera opened for one frame and closed at once; a small line in the test says "Webcam snapshots on: 1 of 4 still
    photos taken";
  - stored **encrypted**; opened only by reviewers, each photo on its own, **every look recorded** (audit log + on the
    photo); **deleted automatically after 30 days** (Retention: "Webcam snapshots during a test", 1–60), at once when
    the consent is taken back, and with the account;
  - optional server check with the T3 face provider: how many faces, and the same person as the ID + selfie check →
    a **signal for a person, never a rejection**.

## What Naresh should check

1. Add your candidate email as a Trust tester (Admin → Skill checks → Vetting Trust) and as a Skill checks tester.
2. As the candidate: Skill checks → start a test → read the **"Optional: webcam snapshots"** text (plain enough? true
   for us?), tick it, start: after a few seconds the line "1 of 4 still photos taken" appears; the test is otherwise
   the same. Start another one without the tick: nothing is taken.
3. Profile & settings → **Your integrity rating**: the label, "How it is worked out".
4. Admin → Vetting Trust → **Integrity rating**: "Check everyone now"; open a person in the queue (locally: `uv run
   python -m tests.e2e_seed trust-t8-high <email>` makes one High), look at the weights, **View photo** (then see the
   audit log), Clear one signal, Ask them to explain, then Finish the review.
5. As the demo company (Admin → Companies → Reset and open as company): the applicant card shows only "Integrity: …"
   or "Under review by Nm7".
6. Decide: (a) is a **High** label after a finished review OK for companies to see, or should they only ever see
   "Reviewed by Nm7"? (b) the weights and the 3 / 6 thresholds; (c) the integrity record itself has **no separate
   consent** (it is made from data people already agreed to, for fraud prevention; kept 365 days, Retention 90–730) —
   confirm with your DPDP adviser.

## Done / not done

- [x] One rating (Low / Medium / High / Not enough data) from V2 test events (tab switches, focus loss, copy, paste,
      dev tools, impossible speed, answer similarity, same position, pauses), device sharing (V2 + V5), V5 fraud flags
      and appeal outcomes, duplicate resumes, T2 name mismatch / duplicate PAN, T3 selfie failures / not same person at
      joining, T8 snapshot checks; documented weights, 60-day half-life, caps, cleared ignored, confirmed 1.5×
- [x] Evidence view: Admin (all detail) and the candidate (plain words, weight, status); company: label + "Reviewed by
      Nm7" / "Under review by Nm7" only
- [x] Optional webcam snapshots: own consent (T1 purpose), never required, 3–5 random stills, no video / audio,
      encrypted, reviewers only with every look audited, T1 retention 30 days (1–60) + withdrawal + account erase;
      face check (count, same person) through the T3 provider (Mock + Rekognition `count_faces`) → a signal only
- [x] Human review: High → queue; clear / confirm / ask / finish; the candidate is told and can explain any time and
      appeal a test or interview (V5 appeals); never an automatic rejection or hiding
- [x] Behind the Trust switch; V2 / V3 / V5 code untouched (read only)
- [x] Design system, 390 px with no sideways scroll; no new routes; the rating card is in the Privacy & consent chunk,
      the Admin card in the admin chunk, the company label in the company chunk; the snapshot code is one small lazy
      file loaded by the skill-check / interview pages; **main entry script byte-for-byte the same size as T7**
      (342,834 B); Easy dashboard Telugu / Hindi **149.2 / 150 KB** (unchanged)
- [ ] The V2 consent list and the interview's "Fair and private" card still say "No camera" (true unless the person
      ticks the optional snapshots; left as is so real users see no change).
- [ ] No certified liveness on snapshots (still photos only, as asked).
- [ ] Texts in English only while this is tested (like T2–T7).

## Tests

- Backend `tests/test_trust_t8.py` — **7 passed**: the rating math (weights, decay 1 → ½ → ¼, gone after 365 days,
  caps, cleared 0, confirmed 1.5× without fading, thresholds, Not enough data, the published method = the code);
  every source read (V2 / V3 / V5 / T2 / T3) and their decisions (upheld appeal, V5 clear, T2 cleared), a manual-check
  request never a signal, the candidate's view in plain words (no other person, no device); High → review queue, the
  company sees exactly `{label: "Under review by Nm7", …}` then `High risk · reviewed`, never "fraud", the person
  still in Applicants and Hire now, clear / confirm change the score, ask (email to a tester, no "fraud"), explain,
  close, no reopening without a new signal, all audited; snapshots refused without consent (the test unaffected),
  with consent: the plan, at most N, 3 s apart, encrypted (no bytes / base64 / marker readable in the database), the AI
  interview too, reviewer-only access with the look audited, retention deletes, withdrawal deletes; two faces / no face
  → signals, the test untouched; not the same person (T3 reference) → `same: false`; switch OFF: 404s, the pass rates
  nobody, no email, V5 fraud scan and decision exactly as before; Admin settings bounds, retention bounds, erase.
- Full backend suite: see the report (all pass except the known local-only `test_test_users::test_create_open_and_remove`).
- `ruff check` / `ruff format --check`: clean. Frontend: vitest **647 passed** (3 new: the company label), lint no new
  warnings (the 3 old ones), build OK.
- e2e `frontend/e2e-live/trust-t8.spec.mjs` with Chromium's fake camera, desktop + 390 px, `--repeat-each 2`:
  **20 passed**. Also re-run and passing: trust-t1, trust-t3, hire-skillcheck, vetting-interview, vetting-admin,
  company-apply, hire-shortlist (32 passed).

## Vendors to sign up for

None (see `docs/trust/T8-vendors.md`). With Rekognition chosen in T3, about ₹0.70 per test with 4 snapshots, only for
people who said yes; the face check can be turned off.

## Database

Additive only: new collection `trust_integrity` (_id = user id: level, score, when, decisions per signal, the review,
reviewed_at); `trust_snapshots` (from T1) now holds session rows (the plan) and photo rows (encrypted JPEG, face check,
views), with a new index on (session, kind). New consent purpose `webcam_snapshots`; new retention type `integrity`
(365 days, 90–730); the T1 type `webcam_snapshots` (30 days, 1–60) now has data. Site setting `trust.integrity`
(snapshots on, photos per session, face check, spread). Applicants and Hire now rows may carry `integrity` (only where
the switch lets the company in).

🤖 Generated with [Claude Code](https://claude.com/claude-code)

https://claude.ai/code/session_01SBaqRLDLwSKFN3nQpCsLVw
