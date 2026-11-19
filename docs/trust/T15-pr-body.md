# Vetting Trust T15: typing, situational-judgement and aptitude tests in English / Hindi / Telugu, and a reliability record

Base: `claude/confident-knuth-pu6nd3-trust-t14` · Branch: `claude/confident-knuth-pu6nd3-trust-t15` · **Stacked on #256 (T14)**, which is stacked on #255 (T13), #254 (T12), #253 (T11), #252 (T10), #251 (T9), #250 (T8), #249 (T7), #248 (T6), #247 (T5), #246 (T4), #245 (T3), #244 (T2) and #243 (T1): merge #243 … #256, then this one (GitHub switches the base each time).

Everything new is behind the one **Vetting Trust** switch from T1. While it is OFF only admins, demo accounts and listed
testers see the new tests and the record; for everyone else every new endpoint answers 404, the Hire now answer has no
new fields, nothing is stored when a company marks attendance or joining, and the background pass messages nobody
(testers only, never demo accounts).

## What this does, in plain words

**Three new tests** on Get skill verified (a "Typing, work situations and aptitude" card, in its own lazy chunk), each
in **English, हिन्दी or తెలుగు**:

- **Typing test**: a short work passage (shop opening / delivery van), 90 seconds from the first key. **Paste is switched
  off** (and counted), and text that arrives in one big insert (a paste, a long autocomplete) **doesn't count toward the
  speed**. Live words-a-minute while typing; it is sent by itself when the passage is complete or the time ends.
  - **How the speed is measured** (also on the page): a "word" is **5 characters** in every language. In Hindi and
    Telugu every letter, vowel sign (matra) and virama is a character (Unicode code points after NFC, zero-width
    joiners removed — phonetic keyboards differ there), close to one key on InScript. **WPM = (characters / 5 / minutes)
    × accuracy**; errors = the edit distance to the passage (stopping early isn't an error). Speeds are compared only
    within a language; the badge says which: **"Typing 35 wpm+ (Hindi)"** (steps 15 / 25 / 35 / 45, needs 90% accuracy).
    Native-script input is supported; typing Hindi / Telugu in English letters is not marked as correct.
  - **Consistent timing**: the page's clock is never trusted beyond what the server saw (+3 s); a clock that claims more,
    or a speed nobody types (150+ WPM), is a `typing_timing` signal; a paste try / big insert is `typing_paste`.
- **Situational judgement (SJT)**: 10 workplace situations for non-tech jobs (customer support, retail, delivery, front
  office, sales, field work, warehouse, working in a team), written plain and Indian, no stereotypes (no names, no
  gender). For each, pick the **most** and the **least** effective of 4 responses. 1 point for the expert key's best as
  most, 1 for its worst as least → 0–100. **Strong 75+, Good 55+**, else "developing" (not shown to companies).
- **Aptitude**: 15 questions (6 numerical, 4 verbal in the chosen language, 5 logical), one at a time, **15 minutes**
  (22½ with the extra-time option), graded by one right answer each. **"Aptitude: top 10 / 30 / 50%"** compares with
  everyone's latest result once 50 people took it; until then provisional cut scores (93 / 80 / 67) stand in and the
  badge says "(provisional)".
- **Banks with validation** (`backend/app/trust/worktests/banks/*.json`, validator `python -m app.trust.worktests.banks`,
  like the V2 banks): **2 forms** per test with no shared items, EN / HI / TE in the right script, 4 different options,
  best ≠ worst, sections, no "all / none of the above". A broken bank is never used. A person's first attempt gets a form
  picked from their account, the next attempt the other one. Items and options are shuffled; the key never leaves the server.
- **Reused from the V2 engine and Trust**: the **T9 honesty pledge** before every start (it shows in the T8 evidence
  view) and the **T9 retake limits** (the skill-check numbers, 1 every 30 days by default; typing per language); the **V2
  integrity signals** on SJT / aptitude (leaving the page, copy, answers faster than they can be read, the same answer
  position) and the typing signals go to the **T8 rating** as signals for a person — the result always stands, nobody is
  rejected; the **server's clock** (a reload carries on with the same paper; answers are saved as they go; after the time
  only the saved answers count); **T12**: no AI anywhere in grading, and the three tests are in T12's **pass-rate gap
  checks** by language / region / city tier (typing 25 wpm+, SJT good+, aptitude 60+).
- **Badges in Hire now**: each person's good results only ("Typing 35 wpm+ (Hindi) · 38 wpm, 96% accuracy", "SJT:
  strong", "Aptitude: top 30%"), each "measured by Nm7", for 365 days; a later lower result replaces it. **Filters**:
  Typing 25 / 35 / 45 wpm+, SJT good / strong, Aptitude top 50 / 30 / 10%, each with how many people it leaves.

**The reliability record** (new T1 consent **"Reliability record (interviews, joining, staying)"**, plain text; without it
**nothing is stored and companies see nothing**; retention type "reliability", **730 days** (Admin 365–1095); taking the
consent back deletes it at once):

- **Showed up**: the company's Attended / No-show on a booked interview time (Hire → Interview times, as before, or the
  new **one-tap email after the interview time**: "Did Asha come to the interview?").
- **Joined**: H6 "Joined" (Offers, the T11 joining-day links): the company's answer counts; the candidate's own "I've
  joined" until the company answers; "I'm not joining" (with a reason) in their own words counts.
- **Stayed 30 / 90 days**: 30 and 90 days after an employer-confirmed join, the company gets a one-tap **"Still working
  with you?"** email; the candidate gets a WhatsApp / email to confirm it themselves (the company's answer wins).
- **A "no" from a company never counts at once**: the candidate gets **48 hours** (WhatsApp + email with a one-tap link,
  and on My hiring): **"I had an emergency"** (or "the company let me go / the job ended") → not counted; **"the company
  cancelled"**, "I was there", "I'm still working there", something else → **disputed → Admin review** (Count it /
  Remove it). After 48 h it counts, and can still be disputed for 30 days.
- **In Hire now**: "Showed up 4/4 · Joined 2/2 · Stayed 90 days 1/1 · confirmed by employers"; no record → **"No history
  yet"** (a plain grey chip, never a negative). Never which company said what. **No filter on it**, it never changes the
  order and never hides anyone (the API ignores anything like a reliability filter).
- **My hiring → "Your reliability record"** (lazy card): the consent in plain words, the summary, each record and its
  state, explain / dispute, "I'm still working at …".
- **Admin → Skill checks → Vetting Trust → Work tests & reliability** (lazy card): banks and their checks, attempts by
  test / language, the aptitude norm count, the latest results with their signals, the disputes queue, "Run the
  reliability pass now".

## What Naresh should check

1. Add your candidate email as a Trust tester and a Skill checks tester. Get skill verified → **Typing, work situations
   and aptitude** → Typing → **हिन्दी** → tick the pledge → type the passage (try pasting: it is refused and said so).
   Read the result and the rule line under the language choice: is "5 characters = 1 word, in every language" clear?
2. Take the SJT in **Telugu** and aptitude in **English**: are the situations and the "most / least effective" words
   natural? **Please have a native Hindi and Telugu speaker read the SJT and aptitude banks** (the files above) and the
   expert key (best / worst per situation) before going live.
3. My hiring → **Your reliability record** → tick it. Locally: `uv run python -m tests.e2e_seed trust-t15-record <email>
   <company id> <job id>` gives "Showed up 1/1 · Joined 1/1" and a no-show waiting for your side; answer "I had an emergency".
4. As a company (a Trust tester company): Hire now → the **Work tests** filters and each person's chips
   (`tests.e2e_seed trust-t15-results <email>` gives badges). Check there is no way to filter people out on the record.
5. The one-tap links: `tests.e2e_seed trust-t15-att <email> <cid> <job> <your company email>` and `trust-t15-stay …` give
   tokens for `/stop-alerts#k=ratt&t=…` and `#k=rstay&t=…`.
6. Admin → Vetting Trust → **Work tests & reliability**: a dispute (`trust-t15-dispute`) → Remove it.
7. Submit the 2 new WhatsApp templates × 3 languages (docs/trust/T15-vendors.md) with the T11 ones.
8. Decide: (a) 48 hours for the candidate's side; (b) typing steps 15 / 25 / 35 / 45 at 90% accuracy; (c) SJT strong 75 /
   good 55; (d) 50 people before real "top X%"; (e) 730 days for the record; (f) whether the record should also show
   inside the applicant profile (today: Hire now only).

## Done / not done

- [x] Typing test: WPM + accuracy on a short passage in EN / HI (Devanagari) / TE script; Indic WPM by code points / 5 (documented); paste blocked + flagged; big inserts don't count; timing checked against the server
- [x] SJT: 20 situations (2 forms of 10) for non-tech roles, 4 responses each with an expert best / worst key, EN / HI / TE
- [x] Aptitude: 30 items (2 forms of 15: numerical, verbal in the chosen language, logical), timed by the server, graded deterministically
- [x] Bank validation like V2 (forms, scripts, keys, sections); forms rotate on retakes; items / options shuffled; key never sent
- [x] Reuses V2 integrity signals → T8, the T9 pledge + retake limits, T12 (no AI; in the pass-rate gap checks)
- [x] Badges + Hire now filters ("Typing 35 wpm+", "SJT: strong", "Aptitude: top 30%") with counts
- [x] Reliability record: attendance (H5 + one-tap after the interview), joined (H6 / T11 + company confirm), stayed 30 / 90 days (one-tap email to the company, the candidate's confirmation, WhatsApp / email)
- [x] 48 hours for the candidate's side before a no-show counts; excuses vs disputes; disputes → Admin review; 30 days to dispute
- [x] Own consent "reliability_record" (nothing stored / shown without it), withdraw deletes, retention 730 days by the daily job
- [x] "No history yet" plain, never negative, never filterable; the record never ranks / hides / rejects
- [x] Behind the Trust switch; background messages testers-only while OFF; no new vendor (docs/trust/T15-vendors.md)
- [x] No new route; new screens in lazy chunks (WorkTests 11.9 KB, ReliabilityLink 12.6 KB, ReliabilityCard 1.5 KB, TrustWorkAdmin 5.2 KB); main bundle 342,838 bytes (T14: 342,834 — the new lazy chunks' entries in the import map); Easy dashboard Telugu / Hindi **149.1 / 150 KB** (unchanged); 390 px with no sideways scroll
- [ ] The Hindi / Telugu test content and the SJT key need a native speaker's / expert's review (written carefully, not yet reviewed).
- [ ] Transliterated input (Hindi / Telugu typed in English letters) is not accepted as correct for typing; native script only.
- [ ] Companies get email only for the one-tap questions (no company WhatsApp number is kept).
- [ ] The record shows in Hire now only (not yet in the applicant profile or the T8 evidence view).
- [ ] Aptitude norms are across all languages / forms together (per-language norms once there is enough data).

## Tests

- Backend `tests/test_trust_t15.py` — **15 passed**: the banks (valid, 2 forms each in EN / HI / TE, no shared items, all
  roles) and the validator catching problems; typing maths (WPM, accuracy, early stop, steps) incl. Hindi / Telugu code
  points, NFC and zero-width joiners; paste and timing flags; the typing flow in Hindi (pledge 409, carry on, a blocked
  paste → `typing_paste` T8 signal, the pledge in the evidence records, a passage with too few input events counted as
  pasted); the SJT key (full, half, reversed, same option, good / strong thresholds); the SJT flow (key never sent, badge,
  a second submit changes nothing, retake limit then the other form with no shared item, fast / same-position answers →
  V2 signals, result stands); aptitude (deterministic, sections, percentiles + provisional cut scores, the server's
  deadline: late submit → the saved answers, extra time 1.5×, an abandoned test marked from what was saved); Hire now
  (badges, labels, filters and counts, a later lower result replaces the badge, the record only with consent, "No
  history yet", reliability-like params ignored, an unknown SJT level refused); the reliability record end to end
  (no-show → 48 h window and the candidate told by a one-tap link, emergency → excused, attended counts, settle after 48
  h, too late to excuse, dispute → Admin queue → Remove, a cleared mark, joined by the candidate then confirmed by the
  company, day 30: the pass emails the company and the candidate once, the company's one-tap answer counts, the
  candidate's own day-90 confirmation, the candidate's link, the attendance one-tap after the interview time, a
  candidate's own "not joining" counts); consent required, withdraw deletes, retention job; switch OFF (404, nothing
  stored or sent, no Hire now fields).
- `tests/test_trust_t12.py`: new **`test_pass_rate_gaps_include_the_t15_work_tests`** (SJT by language / tier / region
  flagged by the four-fifths rule, typing and aptitude present). `tests/test_trust_t11.py`: the templates count is now 21
  (7 a language).
- Full backend suite: see the report (all passed apart from the known local-only `test_test_users::test_create_open_and_remove`).
- `ruff check` / `ruff format --check`: clean. Frontend: vitest **669 passed** (2 skipped; new `workLib.test.js`,
  `trustT15.test.js`), lint no new warnings (the 3 existing ones), build OK, budget OK.
- e2e `frontend/e2e-live/trust-t15.spec.mjs`, desktop + 390 px, `--repeat-each 2`: **20 passed** (typing in Hindi with a
  blocked paste → badge; SJT in Telugu with a reload carrying on, aptitude in English; the reliability card, emergency
  excuse, the candidate's and the company's one-tap links; Hire now badges / record / typing filter; Admin dispute →
  Remove; switch off → nothing). Also re-run: `trust-t11`, `hire-slots`, `hire-shortlist`, `hire-offer` (12 passed).
- Separate commit (asked by the coordinator): the flaky `auto-apply-v2-replies` Admin test. Cause: the Daily report
  page's first load computes today's report under the server's one heavy-job lease; pressing "Refresh now" at once was
  either refused (429) or took the lease first, and then the older first-load answer (busy, no numbers) arrived later and
  overwrote the refreshed report. Fix: the page keeps only the newest request's answer; the test waits for the first load
  and for the lease before refreshing. `auto-apply-v2-replies` + `daily-report`, `--repeat-each 3`: 18 passed.

## Vendors to sign up for

None new (docs/trust/T15-vendors.md): email and the T5 / T11 WhatsApp provider; submit 2 more UTILITY templates × 3
languages (≈ ₹0.12–0.15 a message, under ₹0.50 a hire). No new Render env vars.

## Database

Additive only: new collections **`trust_worktests`** (one row per attempt: test, language, form, shown order, saved
answers, pledge, result, integrity, flags; never keystrokes) and **`trust_reliability`** (`_id` = kind:ref: outcome,
source, state, the 48-hour deadline, the candidate's reply / dispute, the review); `hire_slots.t15.asked`,
`hire_offers.t15.stay30 / stay90` (what was asked when); T1 consent purpose `reliability_record`; retention types
`work_tests`, `reliability`; T8 signal kinds `typing_paste`, `typing_timing`; T11 link kinds `attendance`, `stay`,
`rel_me` and WhatsApp templates `rel_reply`, `rel_stay`; T12 metrics `typing`, `sjt`, `aptitude`. Code:
`backend/app/trust/worktests/` (banks, scoring, service, hire, router), `backend/app/trust/reliability/service.py`; small
hooks in `app/hire/{slots,offers,shortlist}.py`, `app/trust/{booking,integrity,honesty,fairness}`, `app/automation.py`,
`app/main.py`, `app/core/db.py`; frontend `pages/me/trust/{WorkTests,ReliabilityCard,ReliabilityLink}.jsx` + `workLib.js`,
`pages/company/HireWorkTests.jsx`, `pages/admin/live/TrustWorkAdmin.jsx`, hooks in `MeSkillChecks`, `MeHire`,
`CompanyHire`, `TrustLink`, `StopAlerts`, `TrustAdmin`.

---

## Whole Vetting Trust 15 — how to go live

**1. Merge order.** #243 (T1) → #244 (T2) → #245 (T3) → #246 (T4) → #247 (T5) → #248 (T6) → #249 (T7) → #250 (T8) →
#251 (T9) → #252 (T10) → #253 (T11) → #254 (T12) → #255 (T13) → #256 (T14) → #257 (T15). Merge each into main in this
order (GitHub moves the next one's base to main); let Render deploy after the last one. Nothing needs a data migration:
every database change is additive.

**2. The one switch.** Admin → Skill checks → **Vetting Trust**. It stays **OFF** after deploying: only admins, demo
accounts and the testers listed there see anything new, and background jobs message only testers. Add your own and a
few friendly testers' emails first; press **"Go live for everyone"** only when the checks below are done. "Hide again"
turns it all off at once (the data stays, retention keeps deleting on time).

**3. Vendors to sign up for** (all optional: without keys every item uses its built-in test provider, which sends
nothing real and on the live site works only for testers / demo / admins). Set the env vars in **Render → nm7 API →
Environment**; Admin only ever shows "set / not set".

| Item | Vendor | Approx. cost (INR) | Render env vars |
|---|---|---|---|
| T1 privacy & consent | none (existing email) | — | — |
| T2 DigiLocker documents | **Setu** (DigiLocker via Bridge) | ₹5–10 per successful request; maybe a ₹5,000–10,000 monthly minimum | `SETU_DG_CLIENT_ID`, `SETU_DG_CLIENT_SECRET`, `SETU_DG_PRODUCT_INSTANCE_ID`, `SETU_DG_BASE_URL`, optional `DIGILOCKER_WEBHOOK_SECRET`, `API_PUBLIC_URL` |
| T3 ID + selfie (and T8 snapshot face checks) | **Amazon Rekognition**, Mumbai | ≈ ₹0.8–1 per ID check, ₹0.4–0.6 per joining-day check, ≈ ₹0.7 per test with snapshots; free tier first year | `REKOGNITION_ACCESS_KEY_ID`, `REKOGNITION_SECRET_ACCESS_KEY`, `REKOGNITION_REGION` (ap-south-1), `REKOGNITION_COLLECTION` |
| T4 employer checks | **Surepass** (GSTIN / MCA / Udyam) | ₹1–5 per lookup, prepaid credits from ₹5,000 | `SUREPASS_TOKEN`, `SUREPASS_BASE_URL` |
| T5 WhatsApp (also T11, T15 messages) | **Meta WhatsApp Cloud API** | ≈ ₹0.12–0.15 per utility message | `WHATSAPP_ACCESS_TOKEN`, `WHATSAPP_PHONE_NUMBER_ID`, `WHATSAPP_APP_SECRET`, `WHATSAPP_VERIFY_TOKEN`, optional `WHATSAPP_GRAPH_URL` |
| T5 AI calls | **Bolna** + **Exotel** (or Plivo) Indian number | ≈ ₹8–15 a call; number ≈ ₹500–1,000 a month (Exotel ≈ ₹5,000 a quarter) | `BOLNA_API_KEY`, `BOLNA_AGENT_ID`, `VOICE_WEBHOOK_SECRET`, optional `BOLNA_BASE_URL` |
| T6, T8, T11, T12, T13, T15 | none new | — (T11 / T15 WhatsApp as in T5) | — |
| T7, T9, T12 AI checks | the **Anthropic key you already have** | well under ₹1 per candidate; T12 re-grades ≤ ~₹110 a month | existing `ANTHROPIC_API_KEY` |
| T10 spoken English | **Azure AI Speech** (pronunciation assessment) | free 5 h a month, then ≈ ₹1.5–2 a minute (₹3–6 an interview) | `AZURE_SPEECH_KEY`, `AZURE_SPEECH_REGION` |
| T14 coding tasks | **Judge0 CE** (RapidAPI, or your own small VM) | RapidAPI Pro ≈ ₹850 a month, or a VM ≈ ₹450–2,000 a month | `JUDGE0_URL`, `JUDGE0_RAPIDAPI_KEY` (RapidAPI) or `JUDGE0_AUTH_TOKEN` (own VM) |

Also: **Meta WhatsApp templates** — T5's, T11's 5 and T15's 2, each in English / Hindi / Telugu (category UTILITY;
Hindi / Telugu checked by a native speaker), then tick "approved" per language in Admin. For calls, ask Exotel / Plivo
about DLT registration for service calls before going live (T5-vendors §3). After setting keys, pick each provider in
its Admin card (DigiLocker, ID + selfie, Employer checks, Calls & WhatsApp, Spoken English, Coding tasks) and use its
"Check now" / test button.

**4. What to test first** (as a tester, with the switch still OFF):

1. **T1**: Privacy & consent page, the age check, take a consent back (data deleted), the withdraw link in an email; the
   Retention card's "Run the deletion job now".
2. **T3 + T9**: start a skill check: ID + selfie, the honesty pledge, then the retake limits on the result.
3. **T6 / T10 / T15 in Hire now** with a test company: the non-tech filters, spoken English, the work-test filters and
   badges, the reliability record ("No history yet" for new people).
4. **T5 + T11**: a test job: the WhatsApp message to a tester, the one-tap booking link, reminders, the joining day.
5. **T2 / T4 / T14** once their keys are in: one real DigiLocker fetch, one GSTIN lookup, one coding task through Judge0.
6. **T8 / T12 / T13**: Admin → Integrity rating, Fairness (pass-rate gaps), the Daily report's Time to hire.
7. Then add a handful of real testers for a week, read Admin's review queues daily, and only then "Go live for everyone".

🤖 Generated with [Claude Code](https://claude.com/claude-code)

https://claude.ai/code/session_01SBaqRLDLwSKFN3nQpCsLVw
