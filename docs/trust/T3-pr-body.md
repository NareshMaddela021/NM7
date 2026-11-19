# Vetting Trust T3: ID + live selfie check, and "same person" on the joining day

Base: `claude/confident-knuth-pu6nd3-trust-t2` · Branch: `claude/confident-knuth-pu6nd3-trust-t3` · **Stacked on #244 (T2), which is stacked on #243 (T1)**: merge #243, then #244, then this one (GitHub switches the base each time).

Everything here is behind the one **Vetting Trust** switch from T1 (OFF: only admins, demo accounts and testers).

## What this does, in plain words

- **Before the AI interview and before a skill check** (Admin chooses which; default both), a person Vetting Trust is on
  for is asked once: *"Quick check: is it really you?"*. They
  1. read the plain consent text and press **I agree** (T1 purpose *Selfie and face match*, now version 2: what is
     captured, that it goes to Amazon Web Services in Mumbai, that we don't keep the photos, what we keep and for how
     long). Changing the text means people who agreed to the old one are asked again;
  2. pick **driving licence or PAN card** (never Aadhaar) and photograph it (the phone's back camera, or a file);
  3. look into the front camera, press **Start**, follow a short prompt (*turn your head left / right*, or *smile*) while
     the page takes 3 photos;
  4. see **✓ ID + selfie verified**, and the interview / test starts.
- **Photos are never kept.** The card photo and the selfie frames go from the browser to our server as part of the
  request, are read in memory, sent to the face-check partner and dropped. They are not written to disk, to the database
  or to a log. We keep only: liveness pass/fail + score, ID match pass/fail + score, the partner's reference, the time,
  the card type (licence / PAN), and — for the joining day — the partner's **face reference** (encrypted; the partner
  keeps a face vector, not a photo).
- **Aadhaar is refused**: the candidate can only choose licence or PAN, and a photo that reads as an Aadhaar card is
  refused before any face check ("We never take Aadhaar…"); nothing about it is kept and it doesn't use up a try.
- **Never an automatic rejection.** If it doesn't pass, the candidate sees why in plain words and can try again (3 tries,
  Admin can change it). After the last try **a person at Nm7 checks it**; the candidate is told so ("Nobody is turned
  away because of this"). At any time — no camera, a disability, it keeps failing — they can press **I can't use a
  camera / Ask for a manual check** (a short video call with the Nm7 team). The camera being blocked shows plain help
  and the same way out.
- **Joining day:** on an accepted offer, from the 7-day check-in until a month after the join date, the offer shows
  **Joining-day selfie check**: a fresh live selfie is matched with the reference from the interview / skill check →
  **✓ Same person at joining: confirmed**. Same retries → a person → never a rejection.
- **Companies** see **✓ ID + selfie verified** (and **· Same person at joining** once done) on Hire now cards and on
  applicant cards and profiles, only where the Trust switch lets that company in. Never a photo, a score or a reason.
  Test-provider badges say "(test)" and show only on the demo company on the live site.
- **Profile & settings → ID + selfie check** card: where the person stands, "Do the check now", what a reviewer said.
- **Taking back the consent deletes it all at once**: the result, the history, and the face at the partner
  (DeleteFaces). The daily T1 retention job deletes the result and the face reference **30 days after the hiring process
  ends** (no open offer; configurable 7–90 in Retention, new row *ID + selfie check*) and the check history after 30 days.
- **Admin → Skill checks → Vetting Trust → ID + selfie**: provider (Test provider / Amazon Rekognition (Mumbai)), each
  key *set / not set* (never the value), the pass marks (liveness, ID match, same person; 50–99), tries before a person
  checks (1–5), **which steps need it** (AI interview, skill check), counts (checks / passed / didn't pass today,
  verified, same person at joining, with a person) and the **review queue**: *how it was checked* (video call /
  documents / other), a note to the person, and **Verified / Not cleared / Give tries again** (joining: **Same person /
  Not confirmed / Give tries again**). Every decision is recorded and in the audit log.

## What Naresh should check

1. Admin → Skill checks → **Vetting Trust** → the new **ID + selfie** card says *Test mode*; Rekognition keys *not set*.
2. As a tester (with Skill checks on for you): Skill checks → start a test → the check appears first. Read the consent
   text: is it plain enough, and true for us? Do it on your phone (front camera) and on a laptop.
3. Change your profile name to contain "nolive" and try again with another tester account: three tries, then "a person
   is checking it". In Admin, mark it *Verified* after a (pretend) video call. Then press **I can't use a camera** on a
   third account and read that flow.
4. Seed or make an accepted offer joining within a week: Ready to join → the offer → **Joining-day selfie check**.
5. Admin → Companies → "Reset and open as company" (demo): applicants with the check show **✓ ID + selfie verified**.
6. Sign up with AWS as in `docs/trust/T3-vendors.md` (**do the AI-services opt-out**), put the keys in Render, try it
   with your own PAN, then pick *Amazon Rekognition (Mumbai)* as the provider.
7. Decide whether the still-frame challenge is enough for now, or whether we need certified liveness (see vendors doc).

## Done / not done

- [x] Provider interface (`app/trust/face/providers.py`): read the card (Aadhaar → refused), liveness, match, enroll, same person, forget; deterministic test provider
- [x] Amazon Rekognition adapter, Mumbai (`app/trust/face/rekognition.py`; isolated, httpx + SigV4, no SDK; tested against a fake AWS)
- [x] Gate before the AI interview and before a new skill check / refresher (`service.gate`): only while Trust allows the person, only for the steps Admin turned on, only when a provider is available; resuming a running test is never stopped
- [x] Photos in memory only; only results, scores, vendor reference, time and an encrypted face reference kept; never Aadhaar
- [x] Retries (Admin: 1–5) → human review with plain words; manual-check request (no camera / disability / failing / other) at any time; review outcome + method recorded; never auto-reject
- [x] Joining-day continuity (7 days before to 30 days after the join date) with its own retries and review
- [x] Consent: T1 `selfie_face` v2 text; withdrawal deletes everything, including the face at the provider
- [x] Retention: new type `face_check` (30 days after the hiring process ends, 7–90), clean job forgets the face at the provider; check history uses T1's `selfie_face` (30 days)
- [x] Company badge (Hire now shortlist, applicants list + profile) only where `trust.access.for_company` allows
- [x] Admin: provider, keys set / not set, thresholds, tries, requirement switches, counts, review queue (audited)
- [x] UI: camera dialog (front camera, oval guide, prompt read out by screen readers, 44 px buttons, works at 390 px), blocked / missing camera fallback, settings card, offer button; all lazy, no new routes; Easy dashboard 149.1/150 KB unchanged
- [x] Backend tests `backend/tests/test_trust_t3.py` (13) — see counts below
- [x] e2e `frontend/e2e-live/trust-t3.spec.mjs` with Chromium's fake camera, desktop + 390 px, `--repeat-each 2`: **24 passed**; trust-t1, trust-t2, hire-offer, vetting-interview, hire-skillcheck still pass (26)
- [ ] **Certified liveness** (Rekognition Face Liveness or an Indian vendor): not built — the current check is challenge-response on still frames (stops photos held up, not a good replayed video). Needs vendor docs confirmation and ~200 KB of browser SDK.
- [ ] **DigiLocker card photo as the ID source**: not used (T2 drops DigiLocker photos on purpose; Setu's photo field needs vendor docs confirmation). The candidate photographs the card.
- [ ] **Email to the candidate** when a reviewer decides: not sent yet (they see it on the card and in the dialog). Easy to add with `access.mail_filter`.
- [ ] Old-style skill checks (when *Skill checks → Launch* is hidden for the person) are not gated; only the V2 engine is.
- [ ] Telugu / Hindi texts — not written.

## Tests

- Backend: `test_trust_t3.py` 13 passed (mock flow + no image bytes anywhere in the DB, Aadhaar refused, retries → review → admin decision, manual check, gate on/off per step and per switch, joining continuity, withdrawal deletes incl. provider, retention after the hiring process, switch OFF 404s, Admin keys + production gate, company badges only where allowed, SigV4, Rekognition adapter end to end).
- Full backend suite: **1267 passed**, 1 failed (only the known local-only `test_test_users::test_create_open_and_remove`).
- `ruff check` / `ruff format --check`: clean. Frontend: vitest 637 passed, lint no new warnings, build OK.

## Vendors to sign up for

**Amazon Web Services — Rekognition, Mumbai (ap-south-1)**: pay per photo, no minimum. About **₹0.8–1 per ID + selfie
check** and **₹0.4–0.6 per joining-day check** (≈ ₹1,000–1,500 a month for 1,000 candidates); free tier for new
accounts. Must turn on the **AI services opt-out** policy. Render env vars: `REKOGNITION_ACCESS_KEY_ID`,
`REKOGNITION_SECRET_ACCESS_KEY`, `REKOGNITION_REGION` (`ap-south-1`), `REKOGNITION_COLLECTION` (`nm7-trust-faces`).
Steps, the IAM policy and alternatives (HyperVerge / IDfy / Signzy, ₹3–10 per check): `docs/trust/T3-vendors.md`.

## Database

Additive only: new collection `trust_face` (one row per person: status, scores, encrypted face reference, review,
joining check); `trust_selfies` (from T1) now gets one row per check (results only). New indexes on `trust_face`.

🤖 Generated with [Claude Code](https://claude.com/claude-code)

https://claude.ai/code/session_01SBaqRLDLwSKFN3nQpCsLVw
