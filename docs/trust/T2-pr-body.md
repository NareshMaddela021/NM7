# Vetting Trust T2: DigiLocker documents through a KYC vendor

Base: `claude/confident-knuth-pu6nd3-trust-t1` · Branch: `claude/confident-knuth-pu6nd3-trust-t2` · **Stacked on #243 (T1)**: merge #243 first, then this one (GitHub will switch the base to `main`).

Everything here is behind the one **Vetting Trust** switch from T1 (OFF: only admins, demo accounts and testers).

## What this does, in plain words

- **"Verify with DigiLocker" card** in Profile & settings (under Privacy & consent). The candidate first turns on the
  T1 consent *Documents (DigiLocker / KYC)*, ticks which documents to fetch (driving licence, Class 10, Class 12,
  degree, PAN), presses **Verify with DigiLocker**, signs in to DigiLocker on the vendor's page and allows it. Back on
  Nm7 the documents appear, each with **✓ Verified via DigiLocker, <date>** and a "verify again by" date (a year, or
  the licence's expiry if sooner).
- **What we keep (only what a badge needs):** driving licence → vehicle classes + valid until; Class 10 / 12 → board,
  year, passed; degree → university, degree, year, passed; PAN → "verified" + whether the name matches. Plus the
  issuer, the vendor's reference and when it was fetched. **No files or photos. No document numbers. No date of birth.
  Never Aadhaar** (an Aadhaar document is dropped whole; Aadhaar fields are never read; Nm7 never calls the vendor's
  Aadhaar endpoint). PAN is kept only as a keyed hash (to spot the same PAN on two accounts) and its last 4 characters.
- **Name check:** the name on the document is compared with the profile name (ignoring case, dots, Mr/Smt/Kumari,
  order, initials and a missing middle name). If it differs, **nobody is rejected**: the document goes to a person at
  Nm7, the candidate sees plainly "DigiLocker says “…”; your profile says “…”", and can fix their profile name and
  press *Check the name again*, or *Explain*. The same PAN on two accounts also goes to a person.
- **Companies** see the badges on **Hire now** cards and on **applicant** cards/profiles — only where the Trust switch
  lets that company in. Companies never see document numbers, the name on the document, or the board / university
  name (fair matching: never the college). Badges under review, failed or past their re-verify date don't show.
- **Taking back the Documents consent deletes everything at once** (documents and requests, so the badges go too).
  The daily T1 retention job also deletes documents after 180 days and requests after 30 (both in the Retention table).
- **Admin → Skill checks → Vetting Trust → DigiLocker documents:** pick the provider (Test provider / Setu
  DigiLocker), see each Setu key as *set / not set* (never the value), the callback URL to give Setu, counts (fetched
  today, failed today, waiting for DigiLocker, with a person), and the **review queue** with *Clear* / *Not cleared*
  and a note to the candidate. Every change is in the audit log.
- **Test provider** (until Setu keys are set): a "Test DigiLocker" dialog with Allow / Don't allow, test documents in
  the profile name (a name containing "mismatch" gets a different name, to try the review). On the live site it works
  only for admins, demo accounts and testers, and its badges say "(test)" and are shown only to the demo company.

## What Naresh should check

1. Admin → Skill checks → **Vetting Trust**: the new **DigiLocker documents** card says *Test mode*; Setu keys *not set*.
2. As a tester: Profile & settings → Privacy & consent → turn on *Documents*; then **Verify with DigiLocker** → Allow.
   Read the texts on the card: are they plain enough?
3. Change your profile name to something with "mismatch" in it and fetch again: read how the review is explained;
   press Explain. Then in Admin clear it.
4. Admin → Companies → "Reset and open as company" (demo): applicant cards show "✓ Verified via DigiLocker: …" once
   demo applicants have documents (the e2e seeds them; a real company sees nothing while the switch is off).
5. Sign up with Setu (see below), put the keys in Render, try the **sandbox** with Setu's test DigiLocker account, then
   switch the provider to *Setu DigiLocker*. Check the items marked "needs vendor docs confirmation".

## Done / not done

- [x] Provider interface (`app/trust/digilocker/providers.py`) + deterministic Mock + Setu DigiLocker adapter (`setu.py`, isolated; httpx only)
- [x] Flow: consent (T1 `documents`, incl. the age gate) → vendor consent URL → candidate approves in DigiLocker → return + poll and/or signed vendor callback → fetch → store
- [x] Store only the whitelist per document (`service.keep`); never Aadhaar; PAN as keyed hash + last 4; no files; DigiLocker XML read by `xmldoc.py` and discarded (entity declarations refused)
- [x] Name match with review flag (never auto-reject); candidate sees it, can fix the name and re-check or explain; duplicate PAN flagged for review
- [x] Badges on the candidate's card and in company views (Hire now shortlist, applicants list + profile), only where `trust.access.for_company` allows
- [x] Retention: `documents` (T1, 180 days) + new `documents_requests` (30 days); consent withdrawal deletes both
- [x] Admin: provider choice, keys set / not set, callback URL, counts, review queue (audited)
- [x] Backend tests `backend/tests/test_trust_t2.py` (14): mock flow, Aadhaar dropped, PAN never in plain, XML reader, name match, mismatch → review, duplicate PAN, callback signature (bad / missing / tampered refused, idempotent), denied / expired, consent withdraw deletes, retention job, switch OFF isolation, provider keys + production gate, badges only where allowed, Setu adapter against a fake Setu (never calls the Aadhaar endpoint)
- [x] e2e `frontend/e2e-live/trust-t2.spec.mjs` (desktop + 390 px, repeat-each 2: 20 passed); trust-t1 still 8 passed
- [ ] Setu details **need vendor docs confirmation** in the sandbox: orgIds per issuer, `format: "xml"`, the callback header / body (see `docs/trust/T2-vendors.md`)
- [ ] A second real adapter (Surepass) — not built; the interface makes it one file
- [ ] Telugu / Hindi texts for the card — not written (Settings has no Telugu/Hindi yet)

## Vendors to sign up for

**Setu DigiLocker** (bridge.setu.co): sandbox free and self-serve; production after KYB. About **₹5–₹10 per
successful DigiLocker request**, possibly a ₹5,000–₹10,000 monthly minimum (confirm with Setu). Render env vars:
`SETU_DG_CLIENT_ID`, `SETU_DG_CLIENT_SECRET`, `SETU_DG_PRODUCT_INSTANCE_ID`, `SETU_DG_BASE_URL`
(sandbox → `https://dg.setu.co`), optional `DIGILOCKER_WEBHOOK_SECRET`, `API_PUBLIC_URL`. Details and alternatives:
`docs/trust/T2-vendors.md`.

## Database

Additive only: new collection `trust_dl_sessions`; new indexes on `trust_documents` (`pan_hash`, review status).

🤖 Generated with [Claude Code](https://claude.com/claude-code)

https://claude.ai/code/session_01SBaqRLDLwSKFN3nQpCsLVw
