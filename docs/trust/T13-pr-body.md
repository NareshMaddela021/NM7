# Vetting Trust T13: time to hire, in minutes (Daily report section + the company's own view)

Base: `claude/confident-knuth-pu6nd3-trust-t12` · Branch: `claude/confident-knuth-pu6nd3-trust-t13` · **Stacked on #254 (T12)**, which is stacked on #253 (T11), #252 (T10), #251 (T9), #250 (T8), #249 (T7), #248 (T6), #247 (T5), #246 (T4), #245 (T3), #244 (T2) and #243 (T1): merge #243 … #254, then this one (GitHub switches the base each time).

The company-side card is behind the one **Vetting Trust** switch from T1: while it is OFF, only the demo company and
companies with a Trust tester on their team see it (the API answers 404 to everyone else). The Admin Daily report section
is internal, so admins always see it; demo data is always left out of it.

**No vendor, no cost, no new env vars** (`docs/trust/T13-vendors.md`).

## What this does, in plain words

- **For every company job**, the minutes from the job being posted to:
  1. **First shortlist**: the company invited someone from Hire now, moved an applicant to Shortlisted (or straight to
     Interview / Offer), or the T5 calling agent marked someone interested and a fit.
  2. **First contact**: the first message, call or email to a candidate about this job: a Hire now invite (it emails the
     person), a T5 WhatsApp / AI call, a T11 booking-link invite, the company scheduling an interview (the invitation
     email) or an offer. (Nm7 has no company → candidate chat today, so there is nothing else to count.)
  3. **First interview booked**: a Hire interview time booked (H5, T5 or the T11 link) or the company putting an applicant
     at Interview.
  4. **First offer sent**, plus **Offer accepted** and **Joined** as extra columns.
  - Shown as words: "45 m", "2 h 15 m", "3 d 4 h".
  - An interview or an offer means someone was shortlisted and contacted by then at the latest, so a company that moves
    a person straight to Interview still gets a shortlist / contact time (never later than the interview).
- **Where the times come from**: the timestamps Nm7 already keeps (invites, the application timeline, the T5 fit, T5 / T11
  message and call events, interview bookings, offers, the H4 "joined" record). Old jobs are measured from those, nothing
  is rewritten. One small new collection, **`trust_hire_events`** (one row per job × step: the **first** time, kept with
  `$min` so it never moves later), is written at the sources where the first time could otherwise be lost: an invite sent
  again after it expired overwrites its date, a re-booked interview time overwrites `booked_at`, the T5 "interested and a
  fit" moment, and "joined". It holds no people (job, company, step, time).
- **Stats**: median and 75th percentile (p75) per step for jobs posted in the last **7 / 30 / 90 days** (only jobs that
  reached the step), each against the period before (**▲ slower / ▼ faster**), and a **funnel** (jobs posted → reaching
  each step), overall and per company. Demo companies, demo jobs and demo / test accounts (test users are demo accounts)
  are never counted. Everything is counted in MongoDB: per batch of 500 jobs, one aggregation per source grouped by job
  (capped); at most the newest 5,000 jobs of the last 180 days. Computed inside the daily snapshot (one heavy job at a
  time); a failure there never stops the rest of the report.
- **Admin → Daily report → "Time to hire"** (new section; the snapshot gains `timeToHire`, everything else unchanged):
  medians and p75 per step with ▲ / ▼ (buttons 7 / 30 / 90 days), a small funnel, the **5 slowest companies** by time to
  first contact (at least 3 contacted jobs in 30 days), live jobs nobody contacted, every company's medians (top 20, in a
  fold) and the **thresholds**.
  - **Needs attention**: "Time to first contact is slow …" when the median (last 7 days if at least 3 jobs were contacted
    in them, else 30 days) is over **24 h**; "N live jobs posted more than **48 h** ago have no contact with any candidate
    yet." Both numbers are Admin settings (in the section: 1–336 h and 1–720 h; minimum jobs for the slowest list 1–50),
    audited.
- **The company** (Hire now tab, under "Hiring speed"): a **Time to hire** card with its medians / p75 per step for 7 / 30 /
  90 days, each job's times, and the **Nm7 median** for the same step — taken from the Daily report and shown only when at
  least 10 jobs from at least 3 companies are behind it, so no other company's numbers can be read from it.

## What Naresh should check

1. Admin → **Daily report** → Refresh now → scroll to **Time to hire**: switch 7 / 30 / 90 days; read the funnel and the
   slowest companies (with little real data most steps say "No data yet" — expected).
2. Open "“Needs attention” thresholds": decide 24 h for first contact and 48 h for "nobody contacted" (and 3 jobs for the
   slowest list). Save, then look at Needs attention.
3. Make your company admin email a Trust tester (Admin → Skill checks → Vetting Trust). As the company: Hire now → the
   **Time to hire** card. Invite someone from the shortlist, add interview times and let them book, send an offer — the
   card fills in. "Nm7 median: not enough data yet" until there are 10 jobs from 3 companies.
4. Decide whether "the company put the applicant at Interview" should count as an interview booked (it does now) and
   whether an offer should count as a contact (it does now).

## Done / not done

- [x] Per job: posted → first shortlist, first contact, first interview booked, first offer (+ accepted, joined); minutes, "2 h 15 m" / "3 d 4 h"
- [x] From existing timestamps (no history rewritten) + `trust_hire_events` first-time writes at the sources (invite, applicant stage / interview, slot booking incl. T5 / T11, T5 fit, offer sent / accepted / joined)
- [x] Median and p75 per step for 7 / 30 / 90 days vs the period before; funnel; per company and overall; demo companies / jobs / test accounts excluded
- [x] Memory-safe: aggregations per batch grouped by job, capped (`$limit` on every pipeline, bounded `to_list`), job cap 5,000, inside the heavy daily snapshot
- [x] Daily report section (additive to the snapshot), ▲ / ▼, funnel, slowest 5 (min jobs), Needs attention with Admin thresholds (audited)
- [x] Company card: own jobs only, vs the Nm7 median (minimum 10 jobs / 3 companies), behind the Trust switch (404 otherwise)
- [x] No new route (company card in the company chunk, the section in its own lazy chunk inside Daily report); main bundle unchanged (342,834 bytes); Easy dashboard Telugu / Hindi 149.1 / 150 KB unchanged; 390 px with no sideways scroll
- [ ] No company → candidate messages exist on Nm7 yet, so "first contact" counts invites, T5 / T11 messages and calls, interview invitations and offers only.
- [ ] The "nobody contacted" count is taken at snapshot time: a new hours setting shows after the next Refresh now (the median rule applies at once).
- [ ] The company card is English only (like the other company-side Trust cards).

## Tests

- Backend `tests/test_trust_t13.py` — **17 passed**: each step's minutes from fixture events (invites, T5 / T11 events,
  bookings with the first booking kept, offers, accepted, joined via H4, the application timeline and T5 fit,
  straight-to-interview), `$min` writes and demo accounts skipped, words, median / p75 maths and ▲ / ▼, periods and the
  period before, funnel counts, demo companies / jobs / accounts excluded, slowest list minimum jobs, stale jobs and the
  hours setting, attention thresholds (7 vs 30 days), memory-safe source checks and batching with the cap, company sees
  only its own data and the Nm7 median only above the minimums, switch OFF → 404 (demo company / public → shown), the
  stage change writes the event, the Daily report snapshot additive with attention and settings (audited, bounds, roles),
  a failing section never stops the snapshot.
- Re-run and passing: `test_daily_report.py`, `test_auto_apply_a7.py`, `test_hire_speed*.py`, `test_trust_t5.py`,
  `test_trust_t11.py` (86 passed together).
- Full backend suite: see the report (only the known local-only `test_test_users::test_create_open_and_remove` may fail).
- `ruff check` / `ruff format --check`: clean. Frontend: vitest **657 passed** (2 skipped; new `trustT13.test.jsx`), lint
  no new warnings (the 3 existing ones), build OK.
- e2e `frontend/e2e-live/trust-t13.spec.mjs`, desktop + 390 px, `--repeat-each 2`: **8 passed** (Daily report section:
  slowest company, attention, periods, thresholds saved and put back; company card with its job's 45 m / 2 h 15 m and the
  Nm7 line; a company outside the switch sees no card and gets 404). Also re-run: `daily-report`, `trust-t11`,
  `hire-shortlist` (10 passed).

## Vendors to sign up for

- **None.** No new Render env vars.

## Database

Additive only: new collection **`trust_hire_events`** (`_id` = job:step; job_id, company_id, kind, at, via, n; indexes on
job_id and company_id + at); a sparse index on `applications` (company_id, job_id); site setting `trust.tth`
{contact_hours, stale_hours, min_jobs}; the daily snapshot gains `timeToHire`. Code: `backend/app/trust/tth/` (service,
router); small hooks in `app/hire/shortlist.py`, `app/hire/slots.py`, `app/hire/offers.py`,
`app/companies/applicants.py`, `app/trust/agent/service.py`, `app/admin/daily_report.py`; frontend
`pages/admin/live/TimeToHireNumbers.jsx` (+ `styles/admin-tth.css`), `pages/company/TimeToHire.jsx`.

🤖 Generated with [Claude Code](https://claude.com/claude-code)

https://claude.ai/code/session_01SBaqRLDLwSKFN3nQpCsLVw
