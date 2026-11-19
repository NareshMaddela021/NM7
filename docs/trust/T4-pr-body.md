# Vetting Trust T4: Verified employer, "Never pay for a job on Nm7", and Report fraud

Base: `claude/confident-knuth-pu6nd3-trust-t3` · Branch: `claude/confident-knuth-pu6nd3-trust-t4` · **Stacked on #245 (T3), which is stacked on #244 (T2) and #243 (T1)**: merge #243, then #244, then #245, then this one (GitHub switches the base each time).

Everything here is behind the one **Vetting Trust** switch from T1 (OFF: only admins, demo accounts and testers). While it is OFF, public job pages, job cards and company pages look exactly as before for everyone else (a test compares them before and after).

## What this does, in plain words

- **Verify your business (companies).** Company account → **Settings** → a new card **Verify your business**. The company
  picks **GSTIN**, **Udyam (MSME) number** or **CIN**, types it (we suggest the GSTIN / CIN it gave at sign-up), ticks a
  plain consent line and presses **Check my business**.
  1. We check the format first, for free: GSTIN pattern **and its check character**, CIN's 21 characters, Udyam's
     `UDYAM-XX-00-0000000`. A typing mistake never costs a lookup.
  2. We look it up in the registry through the provider (Surepass; the test provider until keys are set) and compare
     the registered **legal / trade name** with the company's name on Nm7, the **status** (active / cancelled …) and
     the website's domain (a look-alike such as `acme-careers.com` for "Acme Ltd" doesn't count; a company Nm7's team
     already verified by hand is fine).
  3. **Active + same name (+ a domain that belongs to it)** → **✓ Verified employer · GST** (or Udyam / MCA), with the
     date. Anything else → **"A person at Nm7 is checking this"** with the reason in plain words ("The GST registry says
     this registration is cancelled", "The name in the registry (…) doesn't match your company name on Nm7 (…)"). **Never
     an automatic rejection**: nothing about the company or its jobs changes, and it can send another number.
- **Re-check every 90 days** (Admin can change it): in small batches in the daily automation pass (heavy lease, at most
  40 lookups a pass). If the registration is no longer active, the badge drops, a person checks, and the company's main
  admin gets a plain email (only where Vetting Trust is on for that company).
- **What we keep** (business facts, not people's data): registered name, trade name, status, registration date, state,
  city, the vendor's reference, when it was checked, a **masked** number (`36•••••••••1Z7`), a keyed hash, and the full
  number only **encrypted** (for the re-check). Never returned by any API. "Remove this check" deletes it at once.
  Retention (T1 schedule, new rows): *Employer business checks* 365 days without a refresh (120–730), *Fraud reports* 365
  days after a person closed them (90–730).
- **The badge for candidates**: on job cards, the job page, the company page, and on interview invites and offers in
  Ready to join; only for people Vetting Trust is on for (and for everyone once the switch is public). Test-provider
  badges say "(test)" and never reach the public on the live site once the switch is public.
- **"Never pay for a job on Nm7"**: one plain line on the job page, inside the apply form, on the company page, above
  interview invites (which carry the company's message) and offers, with **"What to do if anyone asks you for money"**
  (don't pay, don't share OTPs / bank details / Aadhaar photos, report it, call **1930** / cybercrime.gov.in if you
  already paid). Also a card in **Help & referral**.
- **Report fraud** (candidates): on the job page (replaces "Report this job" for Trust users; same collection, so both
  count), the company page, each interview invite and each offer. Reasons: *asked for money, fake company,
  impersonation, misleading job, harassment, other* + an optional note. The reporter is told what happens next ("A person
  at Nm7 checks every report… The company is never told who reported it… call 1930 if you already paid"). 5 reports an
  hour / 15 a day per person. A **job** pauses by itself only after **N independent reports** (Admin, default 3:
  different people on different networks), pending review. A **company is never suspended automatically**. No company
  screen or email ever shows who reported.
- **Admin → Skill checks → Vetting Trust**:
  - **Employer checks**: provider (Test provider / Surepass), `SUREPASS_TOKEN` *set / not set* (never the value),
    re-check days, name-match mark, "pause a job after N independent reports", lookups today / 30 days / paid / vendor
    errors, verified / with a person / not verified, **Run the re-check now**, and the **review queue** (registry facts,
    the reasons, a note) → **Verified employer / Not verified / Look up again**. All audited.
  - **Fraud reports**: every open report (also old "Report this job" ones), grouped by job or company, "asked for money"
    first, with who reported (Admin only) → **Dismiss** (a job paused by reports goes live again) / **Warn the company**
    (email, never who reported) / **Pause the job** / **Suspend the company** (the existing block: jobs paused, company
    emailed; needs a reason). All audited.

## What Naresh should check

1. Admin → Skill checks → **Vetting Trust**: the **Employer checks** card says *Test mode*; `SUREPASS_TOKEN: not set`.
2. Add your company admin email and a candidate email as Trust testers. As the company: Settings → **Verify your
   business** → type a GSTIN with a wrong last character (caught at once), then the right one → *✓ Verified employer ·
   GST (test)*. Rename the company to contain "mismatch" (test provider marker) and check again → *A person at Nm7 is
   checking this*; decide it in Admin.
3. As the tester candidate: Jobs → the company's job: badge on the card and the page, the promise, *What to do…*, then
   **Report fraud**. Check it appears in **Fraud reports** with your email, and try each action on test data.
4. Signed out (or as a non-tester): the job page and company page show nothing new.
5. Read every plain text (the promise, the help steps, the company messages): true for us? Is 1930 the right number to
   give?
6. Sign up with **Surepass** as in `docs/trust/T4-vendors.md`, put the sandbox token in Render, try one real GSTIN,
   CIN and Udyam number, then pick *Surepass* as the provider.
7. Decide N (independent reports before a job pauses; default 3) and the re-check interval (default 90 days).

## Done / not done

- [x] Local format checks first (`app/trust/employer/formats.py`, reusing the GSTIN check character from sign-up): GSTIN, CIN, Udyam; masking, keyed hash, state from the number
- [x] Provider interface + deterministic test provider (`providers.py`) and the Surepass adapter (`surepass.py`; isolated, httpx, Bearer token; **paths / field names need vendor docs confirmation**, read with fallbacks; tested against a fake vendor)
- [x] Matching (name without "Pvt Ltd / LLP / India…", status, domain, duplicate number on another account) → badge or a person; never a rejection; company told plainly
- [x] Re-check every N days (heavy lease, capped batches) dropping the badge when not active; email only where Trust is on
- [x] Store only the registry facts needed; masked / hashed / encrypted number; consent line + remove; retention rows in the T1 schedule
- [x] Badge on job cards, job page, company page, invites, offers, only where the switch allows; public pages unchanged while OFF (test)
- [x] "Never pay" line on the job page, apply form, company page, invites (company messages), offers; help steps; Help & referral card
- [x] Report fraud on job / company / invite / offer; reuses `job_reports`; N independent reports pause a job (Admin setting); never auto-bans; no reporter identity to the company (test); rate-limited; reporter told what happens next
- [x] Admin: provider, key set / not set, settings, lookup counts, review queue, fraud queue with dismiss / warn / pause / suspend (audited); the old Admin → Jobs → Reports queue shows the new reasons too
- [x] Company card "Verify your business" in Settings; candidate badge / promise / report; design system; 390 px with no sideways scroll; no new routes
- [x] `docs/trust/T4-vendors.md` (Surepass sign-up, ₹ per lookup, sandbox, Render env vars)
- [ ] **Surepass field names / Udyam path**: not confirmed against their current docs (see the vendors doc); try in the sandbox first.
- [ ] **Trust score**: a Verified employer badge doesn't add points to the public trust score yet (that would change public pages while the switch is OFF). Easy to add once Trust is public.
- [ ] **Campus interviews** (recruiter rounds in My drive day) don't carry the promise / report button; only Hire-now invites, offers, jobs and company pages do.
- [ ] **Consent purpose for fraud reports**: a report is voluntary and the form says what we keep and that the company never sees who; it is not a separate T1 consent purpose (asking for a consent before someone can report a scam would get in the way, and under-18s without a parent's OK could not report at all). Retention + erase on account deletion are in place. Tell us if you want a purpose anyway.
- [ ] Telugu / Hindi texts — not written (English only, like T2/T3).

## Tests

- Backend: `tests/test_trust_t4.py` — 19 passed (formats incl. GSTIN check character; name / domain matching; active + match → badge on cards, job page and company page; cancelled (two ways) / another name / not found → a person, never a rejection, Admin decides; look-alike domain → a person; vendor down changes nothing; lookup rate limit; re-check keeps, then drops the badge and emails the company; no email while hidden; switch OFF isolation with public pages compared before / after; N independent reports pause a job, same network counts once, never a company ban, no reporter identity in any company view; Admin dismiss / warn / suspend; invites and offers, only your own; report rate limit; Admin keys set / not set + production gate; test badges never public on production; retention; Surepass adapter against a fake vendor).
- Full backend suite: **1285 passed**, 1 failed (only the known local-only `test_test_users::test_create_open_and_remove`).
- `ruff check` / `ruff format --check`: clean. Frontend: vitest 637 passed, lint no new warnings, build OK. Easy dashboard Telugu / Hindi 149.2 / 150 KB (the main bundle grew by 27 bytes gzipped: the lazy-chunk map for the two new chunks).
- e2e `frontend/e2e-live/trust-t4.spec.mjs`, desktop + 390 px, `--repeat-each 2`: **12 passed**. Also re-run and passing: company-trust, company-dashboard, company-apply, hire-offer, hire-shortlist, jobs-board, trust-t1, trust-t3 (32 passed).

## Vendors to sign up for

**Surepass** (GSTIN + Udyam + MCA in one account): about **₹1–3 per GSTIN lookup, ₹2–5 per MCA lookup, ₹2–4 per Udyam
lookup** (prepaid credits; ask for the current rate card). One company ≈ 1 lookup to verify + 4 re-checks a year ≈ ₹5–15 a
year. Free sandbox. Render env vars: `SUREPASS_TOKEN`, `SUREPASS_BASE_URL` (`https://sandbox.surepass.io`, later
`https://kyc-api.surepass.io`). Steps and alternatives (IDfy, Signzy, a GSP): `docs/trust/T4-vendors.md`.

## Database

Additive only: new collections `trust_employer` (one row per company) and `trust_employer_lookups` (one row per lookup);
`job_reports` rows may now carry `company_id`, `context`, `fraud`, `ip_hash`, `resolved_by` (new index on
`company_id, state`); companies may get a `warnings` list. Site settings `trust.employer`.

🤖 Generated with [Claude Code](https://claude.com/claude-code)

https://claude.ai/code/session_01SBaqRLDLwSKFN3nQpCsLVw
