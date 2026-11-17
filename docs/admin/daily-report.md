# Admin → Daily report

`/admin/daily-report` is the first item in the Admin side menu. It shows the whole business on one page and updates
every day. You need the **dashboard** permission to see it (Owner, Operations, Finance). It shows private business data.

- **One request** loads the whole page: `GET /api/admin/daily-report`.
- **Refresh now** (`POST /api/admin/daily-report/refresh`) recomputes today's numbers, yesterday's numbers and any
  missing days on the server, then sends back the same report. It is a "heavy job" (`app/core/heavy.py`): only one
  runs at a time. If another big job is running, the button answers "Another big job is running…" (429).
- **Every day at 6:30 AM IST** the automation pass takes the snapshot (`daily_if_due` in `app/admin/daily_report.py`).
  A marker in `settings` (`_id: "daily_report"`) makes sure it runs only once a day. If another heavy job is running,
  it waits for the next pass, about 10 minutes later.
- If nobody has opened the page or pressed Refresh today, the first visit computes today's snapshot live.

## Where the numbers are stored

`daily_reports` has one document per IST day (`_id: "YYYY-MM-DD"`). Each document has:

- `m`: the day's numbers, one key for each metric below;
- `collector`: the collector details (reasons, cities, experience bands, link check);
- `vetting`, `payments`, `ai`, `github`: the state at the time of the snapshot.

Each snapshot also does two more things:

- It **finalises yesterday** (`final: true`), so yesterday shows the whole day and not only the part up to 6:30 AM.
- It **backfills** any of the last 30 days that have no document yet (`backfilled: true`). A backfilled day only has
  numbers that can be counted from dates stored on the records (`created_at`, `paid_at`, …). "State" numbers, such as
  live jobs, the review queue or people per level, describe one moment, so they stay empty (—) on backfilled days.

Every metric has three parts:

- **today's value**;
- the **change vs yesterday**: ▲ / ▼, coloured green when the change is good. For numbers where lower is better
  (review queue, rejected, errors, fraud flags, refunds) a rise is red;
- a **30-day sparkline**. Its screen-reader label describes the trend in words, for example "rising from 2 to 9".

**Demo records are never counted.** The report skips anything with `demo: true`, and students who joined demo
colleges.

## Top of the page

- **Today in plain words**: five lines written by code from the numbers (no AI). They cover the collector, sign-ups,
  applications and orders (or "Payments coming soon"), the vetting engine with the ON/OFF switch, and health.
- **Needs attention** (`attention()`):
  - No collector run arrived by 7:00 AM IST, or today's run failed (urgent).
  - The review queue has more than 20 jobs.
  - The database didn't answer (urgent), or took more than 1,000 ms (slow).
  - Fraud flags are open.
  - Razorpay keys are missing.
  - The site-wide AI allowance is used up.
  - The vetting switch being OFF is **not** an issue. It is shown as information only.

## a) Job collector

**Did today's run arrive?** The time it arrived and OK / Failed. The answer comes from the collector's run reports.
Before those arrive, the first upload logged today in the audit log (`job.collector`) counts as the run.

### Run reports

The collector sends `POST /api/jobs/collector/run-report` with the same authorization as `POST /api/jobs/collector`:

- `Authorization: Bearer <JOB_INGEST_KEY>`;
- a wrong or missing key gets 401;
- if the server key isn't set, the endpoint answers 503.

The body:

```json
{"runId": "2026-11-17-post", "kind": "post", "startedAt": "2026-11-17T00:40:00Z", "finishedAt": "2026-11-17T01:05:00Z",
 "ok": true, "error": "", "counts": {"sent": 50, "created": 20, "updated": 10, "review": 12, "rejected": 8, "closed": 0,
 "checked": 0, "dead": 0}, "reviewReasons": {"no_page_text": 9}, "rejectedReasons": {"job_board_or_form": 8},
 "source": "github-actions"}
```

- Use `kind: "links"` for the daily link check, with `checked`, `dead` and `closed` in `counts`.
- Reports are stored in `collector_runs` with `_id = runId`. Sending the same runId again replaces that report, so
  there is always one document per run.
- Limits: at most 50 reasons per map; a reason is up to 80 characters, with no `.` or `$`; `error` is up to
  500 characters.

### What the numbers mean

When a day has run reports, the numbers are the sums of that day's `post` runs. "Closed" also includes the jobs the
`links` runs closed.

Days without run reports use nm7.si's own records:

| Number | What it means | Where it comes from without run reports |
| --- | --- | --- |
| Jobs sent | Every job in the collector's uploads that day | The audit log `job.collector` entries, summed: created + updated + skipped + review + closed + rejected |
| New jobs created | New collector jobs | Jobs with `source: "collector"` and `created_at` on that day |
| Jobs updated | Collector jobs created earlier and changed that day | `updated_at` on that day, `created_at` before it, not closed. Approximate: only a job's latest change counts |
| Sent to review | New collector jobs waiting for review, with reasons | `created_at` on that day and `status: "review"`, grouped by `review.reasons` |
| Rejected | Jobs refused outright (never stored), with reasons | The audit log `rejected` and `rejectedBy` |
| Closed (link check) | Collector jobs closed that day | `status: "closed"` with `updated_at` on that day. The link check's own count is in the audit log `job.collector_close` |
| Live jobs on nm7.si | All jobs anyone can see (state) | The `live_filter()` of the job board |
| Review queue | Collector jobs waiting in Admin → Jobs → Collector review (state). The tile links there | `source: "collector"` and `status: "review"` |
| New jobs by city / by experience | Top 10 cities and the experience bands of the day's new collector jobs | `locations`, `experience` |

## b) Site health

- **API**: "Up" when the page loaded. The database ping is timed live on every page load. Each snapshot also stores
  it (`apiMs`), which gives the sparkline.
- **Last deploy**: the commit of the running server, from `RENDER_GIT_COMMIT` or `GIT_COMMIT` (the same value as
  `/version`), and when this server process started. Vercel deploys are not shown.
- **Nightly and smoke-live tests**: the latest `e2e.yml` (the nightly run) and `smoke-live.yml` results from GitHub
  Actions. These only show when the optional `GITHUB_STATUS_TOKEN` (a read-only token) is set on the server. It is
  fetched during the snapshot. Without the token the tile says **Not connected**.
- **Server errors**: unexpected 500s that day (`ops_daily` `errors:<day>`, the same counter as the Dashboard's Today
  card).
- **AI calls used today**: every AI call on the site that day (`ai_usage` `<day>|all`). The daily allowance is 2,000.
- **Collector AI summaries**: summaries the collector wrote (`ai_usage` `<day>|collector`). Its own allowance is set in
  Admin → Settings.

## c) Users and business

| Number | Meaning |
| --- | --- |
| New sign-ups | Job seekers + companies + colleges |
| Job seekers | New customer accounts (`users`, `role: "customer"`) |
| Students joined colleges | New college memberships (`memberships.joined_at`). A student also has a customer account |
| Companies / Colleges | New `companies` / `organizations` |
| Active users | People (not admins) whose signed-in session was used that day (`sessions.last_seen_at`, refreshed at most hourly). For past days this is the highest of the snapshot's own count and a recount, because sessions move on |
| Applications | Job applications (`applications` with a `job_id`) |
| Auto Apply runs | People Auto Apply ran for that day (`auto_runs`). The note gives the applications Auto Apply sent |
| Jobs posted by companies | Jobs with `source: "company"` |
| Interviews booked | Interview slots booked that day (`hire_slots.booked_at`) |
| Paid orders | Orders with `paid_at` that day |
| Revenue | Captured payments that day (`payments.amount`, in paise; shown in ₹) |
| Refunds | Processed refunds that day, and how much was refunded |

When the Razorpay keys are missing (`razorpay_ready()` is false), "Paid orders" and "Revenue" are replaced by
**Payments coming soon**.

## d) Vetting engine

- **Skill checks started / passed / pass rate**: V2 skill checks (`skill_attempts`, `v: 2`).
  - Started: `started_at` that day.
  - Passed: submitted that day with a score of 70 or more.
  - Pass rate: passed ÷ submitted that day.
- **⚡ Ready now, people per level L0–L4, visible**: the same numbers as Admin → Skill checks → Overview
  (`/api/admin/vetting/overview`). These are state numbers.
- **AI interviews** (`vetting_interviews.started_at`) and **L4 checks requested** (`vetting_l4.requested_at`).
- **Appeals open / Fraud flags open**: open items in `vetting_queue`.
- **Success measures**: the same 7 measures and targets as the Vetting overview. Each shows **Met**, **Not met** or
  **No data yet**.
- **Vetting switch**: ON when the new skill checks are public (Admin → Skill checks → Launch). This is information
  only, never an issue.

## Not included

- Vercel deploy status.
- GitHub Actions results, until `GITHUB_STATUS_TOKEN` is set.
- Active users before this report existed. Session history is not kept, so backfilled days show only the people
  whose sessions were still used on that day.
