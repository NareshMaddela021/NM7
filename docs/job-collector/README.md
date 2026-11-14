# Connecting the job collector to nm7.si (round J)

The morning job collector (`Solofounder0214/job-collector`, GitHub Actions, 4:17 AM IST) sends its India jobs
straight to nm7.si with one key. No browser and no admin sign-in. This folder holds what to add to that repo.

**Round J2: every experience level.** nm7.si now takes all India jobs, freshers to 15+ years. Send the list of
every India job in the collector's window (for example `all_india_jobs_in_window.csv`), not only the "not senior"
`new_jobs` list. Jobs already sent are skipped (see "Jobs already sent" below).

## 1. The key (Naresh does this; nobody else needs to see it)

1. On your computer, open a terminal and run `openssl rand -hex 32`. It prints 64 random characters. (No openssl?
   Use your password manager's generator: 64 characters, letters and digits.) Save it in your password manager as
   "Nm7 job ingest key". Don't paste it into chat, email, code or an issue.
2. **Render**: dashboard → the `nm7-api` service → **Environment** → **Add Environment Variable** →
   key `JOB_INGEST_KEY`, value the 64 characters → **Save changes**. Render redeploys by itself (a few minutes).
3. **GitHub**: `github.com/Solofounder0214/job-collector` → **Settings** → **Secrets and variables** → **Actions** →
   **New repository secret** → name `NM7_INGEST_KEY`, the same 64 characters → **Add secret**.
4. To change the key later: do steps 2 and 3 again with a new one. The old key stops working as soon as Render
   has redeployed.

Until both are set, the collector's new step prints one line ("NM7_INGEST_KEY is not set …") and the run still
succeeds; nm7.si answers `503 ingest_off` if only GitHub has the key.

## 2. Files to add to the job-collector repo

- `post_to_nm7.py` (this folder): `post` sends the India jobs in the window (25 a request, retries while Render
  wakes up), `close` sends the links the link check found dead. Writes `output/<date>/nm7_post.md`.
- `polite.py` (this folder): use `polite_get(url)` in `fetch_details.py` for every job page. It obeys robots.txt,
  waits 3 s between two requests to one site, sends a clear User-Agent, skips a site for the day after a 403 / 429,
  and never opens LinkedIn, Naukri, Indeed or other job boards.

### Which jobs are sent

`--source` is the list of all India jobs in the collector's window, every level. If it isn't given, the script
uses the first of these that exists: `output/<date>/all_india_jobs_in_window.csv`,
`data/all_india_jobs_in_window.csv`, `data/all_india_jobs_in_window.json`, `data/post_queue.json` (or the
environment variable `NM7_SOURCE`). It reads a CSV with a header row (`company, title, url` or `apply_url`,
`location, posted, exp_min, exp_max, exp_text, system`) or a JSON list. If the collector writes the all-India list
under another name, pass that path with `--source`.

Make the collector write that list before the "not senior" filter: the same rows it uses for `new_jobs`, but
before it drops Senior / Lead / Manager titles and jobs over 3 years. Keep its other filters (India only, official
hiring systems, no job boards).

### Jobs already sent

Each link nm7.si answers for good (saved, waiting for review, or refused) is added to `data/nm7_seen.txt` (one
link a line, no keys or personal data) and isn't sent again. Jobs that waited only because today's AI summaries
ran out, or the summary failed, are sent again the next morning so nm7.si can try once more. `--resend` sends
everything again (nm7.si updates jobs it already has instead of adding copies). If the runs commit `data/` back to
the repo, commit `data/nm7_seen.txt` too; otherwise every run starts fresh and nm7.si's own duplicate check does the
work (more requests, nothing doubled).

### Sent back from nm7.si (round M)

Admin → Jobs → Collector review can send jobs back: the ones held only because there was no page text, the AI
allowance was used up that day, or the summary failed. Before posting, `post_to_nm7.py` asks
`GET /api/jobs/collector/resend` for those links and sends them again even if they are in `data/nm7_seen.txt`, as long
as they are in today's list (with page text when fetch_details.py has it). A job leaves nm7.si's list when it
arrives again; with page text and allowance left it goes live with its summary. Jobs that waited only for page
text are no longer marked as sent, so a later run tries them again by itself. The run's summary
(`output/<date>/nm7_post.md`) says how many were sent back and how many were in today's list.

### Where page_text comes from

`post_to_nm7.py` attaches each job's page text from `--details` (default `data/details.json`, or the environment
variable `NM7_DETAILS`). It understands `{"<url>": "<text>"}`, a list of `{"url", "page_text" | "text" |
"description"}`, or JSON lines of those. If fetch_details.py writes somewhere else, pass that path. Jobs sent
without page text are not lost: they wait in Admin → Jobs for review.

## 3. The workflow steps (`.github/workflows/collect.yml`)

Add after the steps that run `collect` and `fetch_details.py`:

```yaml
      - name: Post new jobs to nm7.si
        if: always()
        env:
          NM7_INGEST_KEY: ${{ secrets.NM7_INGEST_KEY }}
        run: python post_to_nm7.py post --source output/$(TZ=Asia/Kolkata date +%F)/all_india_jobs_in_window.csv --details data/details.json
```

And in the link-check workflow (4:11 AM IST), after `check_links.py`:

```yaml
      - name: Close dead links on nm7.si
        if: always()
        env:
          NM7_INGEST_KEY: ${{ secrets.NM7_INGEST_KEY }}
        run: python post_to_nm7.py close --link-check output/link_check/latest.json
```

If the runs commit `output/` back to the repo, `output/<date>/nm7_post.md` is committed with the rest.

### A first test (dry run)

Run once by hand with a small batch and `--dry-run`: nm7.si checks every job and says what it would do, but saves
nothing and writes no summaries.

```yaml
        run: python post_to_nm7.py post --dry-run --batch 25
```

## 4. What nm7.si does with each job

`POST https://nm7-api.onrender.com/api/jobs/collector` with `Authorization: Bearer <key>` and
`{"jobs": [...], "dryRun": false}`, at most 200 jobs a request. Fields: `company`, `title`, `apply_url`,
`location`, `posted`, `exp_min`, `exp_max`, `exp_text`, `system`, `page_text` (optional), `status` (`closed` to
close one). Close by link: `POST /api/jobs/collector/close {"urls": [...]}`.

- **Refused** (never saved): job boards, Google / Microsoft forms, Notion pages, staffing agencies, outside India
  (round M: also a location that names a place abroad and no Indian place, like "Remote - United States"; a job
  already on nm7.si that comes back with such a location is closed as "outside India" and is never shown).
  Every experience level is accepted (round J2): Senior, Lead, Principal, Manager, Head, Director, Architect, Staff.
- **Experience**: `exp_min` decides the level: 0 → Fresher (0–1 years when the top is 1, 1–3 when higher), 1–2 → 1–3, 3–4 → 3–5,
  5–7 → 5–8, 8–11 → 8–12, 12–14 → 12–15, 15 or more → 15+. Without years the title is a hint (Intern → Internship,
  Trainee → Fresher, Senior → 5–8, Lead / Manager / Architect / Principal → 8–12, Head / Director → 12–15);
  otherwise the job shows "Experience not stated" and still goes live.
- **Duplicates**: the same apply link (ignoring case, http/https, www, query and trailing slash), else the same
  company and title. Sent again: updated. A job removed on request is never brought back.
- **Description**: never the company's text. nm7.si writes a short original summary (300–900 characters) from
  page_text with Claude, facts only from the page, and keeps only the summary and facts (title, city, skills, salary
  if stated). page_text is not stored. Emails and phone numbers are removed from everything kept.
- **Waiting for review** (not live) when there is no usable page text, the summary fails a check, the daily AI
  allowance for the collector is used up (Admin → Settings → Job collector, default 3,000 a day, with today's
  count; only summaries that were written count, round M), or the city isn't stated. Admin → Jobs shows the count; Admin writes a summary (Edit) before approving one.
- **On the job page**: "Source: company careers page", Apply to the official link, no company logo, never "partner".
  "Request removal of this job" opens the form at `/contact?topic=job-removal`; requests are in Admin → Jobs →
  Removal requests, and one click closes the job.

The answer: `{created, updated, skipped, review, closed, rejected, rejectedBy: {reason: n}, results: [...]}`.
