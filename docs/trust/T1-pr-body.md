# Vetting Trust T1: DPDP compliance pack (and the switch the next 14 items sit behind)

Base: `main` · Branch: `claude/confident-knuth-pu6nd3-trust-t1` · Not stacked on another PR (T1 is the foundation; T2–T15 stack on this one).

## What this does, in plain words

- **One switch for everything new: "Vetting Trust".** Admin → Skill checks → **Vetting Trust** tab. It is **OFF**. While
  it's off, only admins, demo accounts and the tester emails you list see anything new, and background jobs email
  nobody except the testers. Every later Trust item (T2–T15) goes behind this same switch.
- **Consents, one per use of data.** In Profile & settings, people who get Vetting Trust see a new **Privacy &
  consent** card: a short plain-English text and an On/Off switch for each of
  *Share my profile with employers*, *AI interview*, *Voice recordings and transcripts*, *Selfie and face match*,
  *Documents (DigiLocker / KYC)*. Turning one off asks first, then **deletes that data at once**. Every consent is
  kept as a record (which text version, when given, when taken back, from where). If we change a text, people are
  asked again. Later items add their own purposes (calls/WhatsApp, webcam snapshots…).
- **Take back consent from an email without signing in.** A signed link (valid 30 days) opens a page where the person
  ticks what to take back. It's in the inactivity warning email now, and later items can put it in their emails.
- **Age check and parents.** The first time, the person gives their date of birth. We keep only the day they turn 18,
  never the date itself, and it is never used for scoring. Under 18: they give a parent's email, the parent gets a
  one-time link (7 days), reads what we do and agrees or not. Until a parent agrees, consents are locked.
- **72-hour breach log.** Vetting Trust tab → Breach log: log an incident (detected at, what data, how many people,
  notes), see the **CERT-In 6-hour** and **Board 72-hour** countdowns, record who was told and when, change status.
  Owner only, every change in the audit log. Plain runbook: `docs/trust/breach-runbook.md` (who does what, the
  deadlines, the notice template for affected people).
- **Retention schedule.** Vetting Trust tab → Retention: how long each kind of data is kept (selfies 30 days, voice 90,
  documents 180, interview transcripts 180, webcam snapshots 30, photos of work 30, raw IPs and device fingerprints 30).
  You can change the days, but only inside a safe range. A daily job deletes what is past its time, in small batches
  (heavy-job lock, caps), and the page shows how many it deleted last time and in total. "Run the deletion job now"
  button. The existing vetting clean-up (raw IPs, device hashes) now uses this same schedule instead of its own
  numbers, and still waits until Skill checks is live.
- **Erase after inactivity.** Vetting Trust tab → Erase after inactivity: **OFF on its own** (separate from the main
  switch). When on: people with Trust data who haven't used Nm7 for N months (default 24) get a warning email; if
  they still don't sign in within the notice (default 30 days), their Trust data is erased (or, if you pick it, the
  whole account through the normal delete-account path). Never without the warning first. Nobody is warned for time
  before you turned it on. While Trust is hidden only testers can be warned.
- Erasing an account now also erases all Trust data and the consent history. "Download my data" now includes consents.

## What Naresh should check

1. Admin → Skill checks → **Vetting Trust** tab: the switch says *Hidden*. Add your own email as a tester, save.
2. Signed in as that tester: Profile & settings → **Privacy & consent**. Enter a date of birth, turn a consent on and
   off (read the texts: are they plain enough?).
3. Try a date of birth under 18 with a second test account and your other email as the "parent": open the email, agree.
4. Vetting Trust tab → Retention: are the default days right for you? → Breach log: log a test incident, record
   "CERT-In", close it.
5. Leave **Erase after inactivity** OFF until you've read the warning email text (in `backend/app/trust/inactivity.py`).
6. Read `docs/trust/breach-runbook.md` and put real names/phone numbers in "Who does what". A lawyer should glance at
   the deadlines (CERT-In 6 h; DPDP Rules 2025 rule 7: Board "without delay" + full report in 72 h).

## Done / not done

- [x] Vetting Trust switch (`app/trust/access.py`: for_user, for_company, mail_filter, is_public, testers) + Admin toggle and testers
- [x] Consent framework (`app/trust/consent.py`): 5 purposes, versioned texts, additive records, grant / withdraw / list / export APIs, extensible registry
- [x] Withdrawal deletes that purpose's data through the retention framework (data types + hooks other items register)
- [x] Withdraw page by signed, expiring link (works without sign-in) and from Settings
- [x] Age gate (only "adult from" kept) + verifiable parental consent by one-time email link; minor blocked until a parent confirms
- [x] 72-hour breach runbook + Admin breach log with countdowns, notifications, audit
- [x] Retention schedule with Admin-editable days in safe bounds, daily deletion job (heavy_or_skip, batches, caps), counts, Admin page; vetting retention folded in
- [x] Erase-after-inactivity (warning, notice, erase; separate OFF setting; mail_filter respected; reuses the account erase path in "account" mode)
- [x] Candidate UI (Privacy & consent card, age gate, parent screens) and Admin UI (Vetting Trust tab), nested in existing lazy chunks; no new routes (the two link pages live under the existing `/stop-alerts`)
- [x] Backend tests `backend/tests/test_trust_t1.py` (10 tests) and e2e `frontend/e2e-live/trust-t1.spec.mjs` (desktop + 390 px, repeat-each 2: 16 passed)
- [ ] Parent link by **SMS/phone**: not built (email only). Needs an SMS provider with DLT registration (see vendors doc).
- [ ] **Telugu / Hindi consent texts**: not written (the Settings page has no Telugu/Hindi yet). TODO list below.

### Telugu / Hindi TODO (needs a native speaker)
Purpose texts in `backend/app/trust/consent.py` (fields `te` / `hi` are ready on each purpose):
`profile_sharing`, `ai_interview`, `voice`, `selfie_face`, `documents`; the parent email and the parent page
(`backend/app/trust/age.py`, `frontend/src/pages/me/trust/TrustLink.jsx`); the inactivity warning email
(`backend/app/trust/inactivity.py`).

## Vendors to sign up for

None for T1 (`docs/trust/T1-vendors.md`). No new Render env vars.

## For the next items (T2–T15)

- Gate candidate routes with `dependencies=[access.ON]`; company views with `access.for_company`; background emails with `access.mail_filter`.
- Add a consent purpose: `consent.add_purpose(Purpose("calls_whatsapp", "…", "…", 1, data_type=…))`; check it with `await consent.require(db, uid, "calls_whatsapp")` (also enforces the age gate / parent).
- Add a data type: `retention.register(DataType(key, label, days, min, max, collection, purpose=…))` or use the ready collections `trust_selfies`, `trust_voice`, `trust_documents`, `trust_snapshots` (rows need `user_id` and `created_at`). Anything else to delete on withdrawal: `@retention.on_withdraw("purpose")`.
- Put `consent.withdraw_link(uid, purpose)` in emails that come from a consented feature.

🤖 Generated with [Claude Code](https://claude.com/claude-code)

https://claude.ai/code/session_01SBaqRLDLwSKFN3nQpCsLVw
