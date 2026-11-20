# Vetting Trust T10: a spoken-English score (CEFR-style A1–C2) from the voice interview

Base: `claude/confident-knuth-pu6nd3-trust-t9` · Branch: `claude/confident-knuth-pu6nd3-trust-t10` · **Stacked on #251 (T9)**, which is stacked on #250 (T8), #249 (T7), #248 (T6), #247 (T5), #246 (T4), #245 (T3), #244 (T2) and #243 (T1): merge #243 … #251, then this one (GitHub switches the base each time).

Everything new is behind the one **Vetting Trust** switch from T1. While it is OFF only admins, demo accounts and listed
testers get it. Everyone else gets the AI interview **exactly as before**: no new choice, no timing stored, no
recording, no new AI call, no new label. Companies the switch is off for see Hire now as before.

## What this does, in plain words

- **How the voice interview works today (V3), and what stays the same.** The browser turns speech into text (Web
  Speech API, en-IN / hi-IN / te-IN). No audio reached our server. The interview stores the text of each answer and
  how long the answer took, and keeps it 180 days (T1 retention "AI interview transcripts"). All of this is unchanged.
- **The new opt-in.** In the interview set-up, when someone picks **"Speak my answers"** in **English**, a Trust person
  sees **"Also measure my spoken English (optional)"**. Ticking it shows the **T1 "Voice recordings and transcripts"
  consent** text, and they agree to it right there. The server refuses the score without that consent (`403
  consent_needed`). The consent card's "Speaking" line then says plainly that a short clip goes to the partner and is
  deleted.
- **Four sub-scores (0–100) and a band**, from the **English** spoken answers only. An answer in Hindi or Telugu
  (either script) is left out and never marked down. Typed answers (a browser without speech) are left out too.
  - **Fluency**, from timing: words per minute over the time actually spent speaking (from the speech events the page
    now sends: first word to last word in each listening session), long pauses (3 s or more) per minute, and fillers
    ("um", "uh", "erm", "hmm") per 100 words. 110–160 words a minute gets full marks. More than 2 long pauses a
    minute cost 6 points each, and more than 2 fillers per 100 words cost 4 points each.
  - **Grammar** and **comprehension** (did the answer address the question): **one Claude call** after the interview
    (strict schema, in SENT, AI allowance feature **"spoken"**, 3 a person a day). The answers are **anonymised**
    first with T7's anonymiser (no name, email, phone, address, college, date of birth, age, gender, religion,
    caste). The prompt has only the questions and the answers, and says Indian-English usage is correct English
    ("do the needful", "prepone", "kindly revert", "I am having experience", "itself", "only" for emphasis). If
    there is no key, the allowance is used up or the answer is unusable, simple **rules** score them instead: a few
    unambiguous slips, and shared words with the question. Rules never give more than 75.
  - **Pronunciation**: a speech-assessment provider. There is a provider interface with three options: **none**
    (not measured), the **test provider**, and **Azure AI Speech Pronunciation Assessment**. When one is set, the page
    records each spoken answer as a 16 kHz WAV clip (at most 20 s) **while the browser listens**. The clip goes to
    `POST /api/me/trust/spoken/{interview}/clip`, and the server passes it **from memory** to the provider with the
    words the browser heard. We keep the provider's accuracy and its reference. **The audio is dropped.** With no
    provider, no key or no clip, pronunciation is **"not measured"**, the band uses the other three, and the
    candidate sees a note saying so.
  - **Overall** is the mean of the measured sub-scores. **Band**: A1 0–29, A2 30–44, B1 45–59, B2 60–74, C1 75–89,
    C2 90–100. Each band has a plain description ("B2 Upper intermediate: speaks clearly and fairly fluently about
    work; mistakes rarely get in the way of the meaning."). We say it follows the CEFR descriptions and **is not an
    official CEFR certificate**. With fewer than 2 English answers or under 40 English words there is no band, only
    "Not enough English speech".
- **Accent is never a penalty beyond intelligibility** (documented in `app/trust/spoken/score.py` and shown to the
  candidate). Pronunciation is the provider's accuracy ÷ 0.8, capped at 100. So **every answer rated 80 or more counts
  as fully clear**: above "easily understood", an accent earns nothing and costs nothing. The provider runs on its
  **Indian-English model (en-IN)**. The provider's own "fluency" number is stored for the record but **never used**.
  T12's fairness check can compare pass rates by accent / region using the stored band and sub-scores.
- **Audio**: only with the voice consent, and **not stored by default**. Admin can turn on **"Keep voice clips"**. Clips
  are then stored **encrypted** in `trust_spoken_audio` and deleted by the T1 daily job after the new retention type
  **"Voice clips for the spoken-English score"** (7 days, Admin 1–30). We store only the scores, band, provider
  references and timing summary (`trust_spoken`, one row per interview; new retention type **"Spoken-English
  scores"**, 180 days, Admin 30–365). The transcript stays where V3 keeps it, with its existing retention.
  **Withdrawing the voice consent deletes the scores and any clips at once.** So does erasing the account.
- **The candidate sees it**:
  - on the interview result ("Your spoken English": band, description, four bars with fluency detail such as "126
    words a minute · 0.5 long pauses a minute · 0 fillers per 100 words", or "not measured");
  - in **Profile & settings → Spoken English**, with **"How this was measured"** and the **retake path**: "Retake: take
    the AI interview again (1 attempt every 30 days for this role). Next attempt opens on 18 Dec 2026. The latest
    measured interview counts." This uses T9's interview retake rule; the score lasts 180 days;
  - in **Work preferences → Languages**: "English · verified (B2)".
- **Companies (Hire now)**:
  - Every person with a score gets a chip, e.g. "✓ Spoken English B2 (pronunciation 92, fluency 80, grammar 70,
    comprehension 80) · Measured by Nm7 voice interview".
  - The T6 languages list shows **English (verified (B2))**. The person's self-declared English is replaced by it, not
    listed twice.
  - The filter **"Spoken English: B1 or above"** (A2 … C2) appears **only for jobs whose role category is tagged**. By
    default these are call centre, customer support, retail, sales, front office and BPO. Admin can change the list.
    Jobs have no category field, so the category comes from the job's **title and skills** ("Customer Support
    Executive" → customer support; "Telecaller (voice process)" → call centre). On any other job the parameter is
    ignored and the filter is not offered.
- **Fairness**: anonymised prompts. **Never an automatic rejection.** The band never changes the interview score or
  pass, never hides anyone from a company that didn't choose the filter, and is never a gate on the candidate.
  Measuring is optional and the candidate chooses it.
- **Admin → Skill checks → Vetting Trust → Spoken English**: the provider (none / test / Azure), keys **set / not set**
  (never the values), which role categories get the filter, "Keep voice clips" (off) and its days, the bands and how it
  is measured, and counts (scores per band, not enough speech, pronunciation not measured, clips assessed / failed,
  clips kept now). Changes need the settings permission and are audited.

### Also in this PR (separate commit): `noSideScroll` now sees sideways scroll on a phone

`noSideScroll` (in `e2e-live/college.mjs`) compared the page width with `window.innerWidth`. On an `isMobile` phone,
Chrome widens that to the content, so a page 443 px wide passed on a 390 px phone. It now compares
`documentElement.scrollWidth` with the **real layout width**: `documentElement.clientWidth`, never more than the
configured viewport width. T9's `fitsPhone` is now the same function. Two specs had their own copy (cert-wallet,
drives), and six had the same check written inline (linkedin-pack, version-compare, project-helper, health-alerts,
print-check, skill-gap). They all use the shared helper now. The check was not weakened.
**The whole e2e-live suite at 390 px** (every `phone` test, 250 tests): **244 passed, 5 skipped, 1 failed** (28 min). The new check found **no page that scrolls sideways**. The one failure, `trust-t6 › phone › Hire now …`, was "Distance from the job (0)" (a count, not overflow). Re-run on this branch it passed, together with trust-t1, trust-t9, vetting-interview, vetting-admin and hire-shortlist (**28 passed**). It looks like a one-off timing flake in that test's data, not a layout problem.

## What Naresh should check

1. Add your candidate email as a Trust tester and a Skill checks tester. You need a current "Skill verified" badge
   (locally: `uv run python -m tests.e2e_seed trust-t10-badge <email> SQL`).
2. On Chrome (Android works best), go to AI interview → Start, then "Speak my answers", English, and tick "Also measure
   my spoken English". Read the consent box and the "Speaking" line: are they plain and true? Answer by speaking.
3. On the result and in Profile & settings → Spoken English, check the band, the bars and "How this was measured".
   Are the band texts right for your hiring? Is "not an official CEFR certificate" clear enough?
4. As a tester company, open Hire now for a "Customer Support Executive" job: check the chip and the filter. Then a
   data analyst job: there should be no filter.
5. Admin → Vetting Trust → Spoken English: the role categories, and leave "Keep voice clips" off.
6. Decide:
   - (a) Sign up for Azure Speech (see vendors below). Until you do, real users get "pronunciation not measured".
   - (b) The band cut-offs and the 110–160 words-a-minute range.
   - (c) Should pronunciation be required for C1 / C2? Today it isn't; the band uses what was measured, with a note.
   - (d) Should the filter also be offered for hospitality? It is off by default.
   - (e) Is "the latest measured interview counts" right, or should it be the best one in 180 days?

## Done / not done

- [x] Four sub-scores 0–100 (pronunciation, fluency, grammar, comprehension) and a CEFR-style band A1–C2 with a plain
      description, from the English spoken answers only
- [x] Grammar + comprehension by Claude: strict schema, in SENT, AI allowance feature "spoken", anonymised. Rules
      fallback (never above 75)
- [x] Fluency from browser speech timestamps (speech time, long pauses) plus fillers; the server keeps the timing only
      for measured interviews
- [x] Pronunciation provider interface: none / Mock / **Azure Pronunciation Assessment** (REST adapter; **needs vendor
      docs confirmation** for en-IN in the chosen region and the answer shape). "Not measured" path with a note
- [x] Accent never a penalty beyond intelligibility: en-IN model, accuracy ÷ 0.8 capped at 100. Documented in code, in
      the "how" texts and here
- [x] Voice consent required (server-side). Audio sent from memory and dropped. Optional encrypted keeping with a T1
      retention type (Admin-editable within bounds). Scores have their own retention. Withdrawal deletes
- [x] Candidate: result card, Profile & settings card with "how this was measured" and the T9 retake path, English
      "verified (B2)" in Work preferences
- [x] Hire now: band chip, English verified in languages, "Spoken English: B1 or above" filter only for tagged role
      categories (Admin-editable), "Measured by Nm7 voice interview"
- [x] Never an automatic rejection; the band is a filter companies choose; the interview score / pass is unchanged
      (tested)
- [x] Behind the Trust switch: OFF = nothing new (tested)
- [x] Admin card (provider, keys set / not set, categories, keep clips, counts). `docs/trust/T10-vendors.md`
- [x] `noSideScroll` fixed (separate commit); whole suite run at 390 px
- [x] Design system, 390 px with no sideways scroll; no new routes. `trust/Spoken` is a small lazy chunk (5.8 KB) loaded
      by the interview pages and the Privacy & consent chunk; the recorder is in the interview runner's chunk; the
      Admin card is in the admin chunk. **Main entry script byte-for-byte the same as T9 (342,834 B).** Easy dashboard
      Telugu / Hindi **149.1 / 150 KB** (nothing added)
- [ ] Recording and speech recognition share the microphone. On a few Android phones, opening the microphone twice
      can fail. The recorder then records nothing and pronunciation is "not measured"; the speech-to-text keeps
      working. This needs a check on real phones.
- [ ] Hindi / Telugu interviews are not measured (by design for now: English only).
- [ ] Jobs have no category field, so the category is inferred from the title and skills. A company can't set it by
      hand yet (`role_category` is read if present, but nothing writes it).
- [ ] The real Azure adapter is only tested against recorded answer shapes (no key here).

## Tests

- Backend `tests/test_trust_t10.py`: **14 passed**. It also checks that speech events arriving in one burst (over 400 words a minute) fall back to the whole answer time.
  - Band thresholds at every boundary; overall with and without pronunciation; the words-a-minute curve; pause and
    filler penalties; pronunciation as intelligibility; English-only detection (Hindi script and romanised Telugu
    left out); rules capped at 75; Indian-English usage not counted as an error.
  - The test provider (deterministic, unclear speech, failure) and the "none" provider. Azure: the request (region
    URL, en-IN, key header, the base64 Pronunciation-Assessment JSON with the reference text), both answer shapes,
    refusals and errors.
  - A full voice interview: four sub-scores, C1, 7 provider references, **no audio stored**, timing kept on the turns,
    the interview graded exactly as before (passed, 4.0), the **prompt anonymised** (no name or email, "[removed]"),
    **counted in the AI allowance**, the candidate's view (band, subs, how, retake), the result card, English
    verified in Work preferences.
  - Provider "none": not measured, band from three with the note; Azure without a key counts as not configured.
  - A provider failure, a wrong turn, a duplicate clip, bad audio, unclear speech (pronunciation 56).
  - Keep clips: off by default; when on, encrypted, then deleted by the retention job after 7 days; the bounds; the
    audit log entry. Withdrawing the voice consent deletes the scores.
  - Consent required (403), typed or Hindi interviews not measured, not enough English → no band.
  - The rules fallback without a key, and when the allowance is used up (no AI call).
  - Hire now: chips, verified English replacing the declared one, the B1 / A2 / C1 filters, the filter ignored and not
    offered on an untagged job, Admin categories, an unknown category refused, nobody hidden without the filter.
  - Admin: keys set / not set without values, counts, unknown provider refused.
  - **Switch OFF**: 404, no choice, no timing, no clip, no score, no AI call, the company sees no non-tech block.
- Full backend suite: **1363 passed**; only the known local-only `test_test_users::test_create_open_and_remove` fails. `ruff check` / `ruff format --check`: clean. Frontend: vitest **654 passed**
  (3 new: speech timing, the WAV clip, the band filter query). Lint shows no new warnings (the 3 old ones). Build OK.
- e2e `frontend/e2e-live/trust-t10.spec.mjs`, desktop + 390 px, `--repeat-each 2`: **16 passed**. These cover the
  voice interview with stand-ins for speech recognition and the microphone, opt-in with the consent, the result,
  Profile & settings, Work preferences, Hire now with the chips and the filter (and none on an analyst job), the
  Admin card, and switch off.

## Vendors to sign up for

One, optional: **Azure AI Speech** (Pronunciation Assessment), Central India. It costs about **₹1.5–2 per minute
assessed**, which is **₹3–6 per measured interview**. The free tier covers 5 audio hours a month (about 100–150
interviews). Render env vars: `AZURE_SPEECH_KEY`, `AZURE_SPEECH_REGION` (default `centralindia`). The Claude part costs
about ₹0.3–0.5 per measured interview with the existing key. Details in `docs/trust/T10-vendors.md`.

## Database

Additive only:

- New collections `trust_spoken` (_id = interview id: sub-scores, overall, band, by ai / rules, fluency summary,
  per-clip provider scores and references, provider) and `trust_spoken_audio` (only when keeping is on: encrypted
  clip, bytes, created_at), with indexes.
- `vetting_interviews.spoken` ({on, provider, at}), and turn fields `timing` / `follow_timing` ({speech_ms, pauses,
  typed}), only for measured interviews.
- Site setting `trust.spoken` (provider, categories, keep_audio).
- Retention types `spoken_scores` (180, 30–365) and `spoken_audio` (7, 1–30), both tied to the voice consent.
- AI allowance feature `spoken`. Optional `jobs.role_category` is read if present.

🤖 Generated with [Claude Code](https://claude.com/claude-code)

https://claude.ai/code/session_01SBaqRLDLwSKFN3nQpCsLVw
