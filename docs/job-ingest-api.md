# Job upload API (for the morning job-collector)

The collector sends jobs to the Nm7 job board with one HTTPS request:

```
POST https://nm7-api.onrender.com/api/jobs/ingest
Authorization: Bearer <JOB_INGEST_KEY>
Content-Type: application/json

{"jobs": [ {job}, {job}, ... ]}
```

- Today the API lives at `nm7-api.onrender.com`. When `api.nm7.si` is pointed at it later, the same path works
  there too.
- `JOB_INGEST_KEY` is a secret set in Render (see below). It must be at least 32 characters. Never put it in code,
  logs or chat. Without it the API answers `503 ingest_off`; a wrong key answers `401 bad_key`.
- Send at most **500 jobs per request** (and under 8 MB). Batches are rate limited to 60 requests an hour and 300 a
  day, so send a few big batches rather than one job at a time.
- The body can also be the array on its own: `[ {job}, ... ]`.
- Keys can be camelCase (`applyUrl`) or snake_case (`apply_url`).

## One job

```json
{
  "title": "Junior Data Analyst",
  "company": {
    "name": "Acme Analytics",
    "website": "https://acme.example",
    "logo": "https://acme.example/logo.png"
  },
  "locations": ["Hyderabad", "Pune"],
  "workType": "hybrid",
  "jobType": "full_time",
  "experience": "fresher",
  "salary": { "min": 300000, "max": 450000, "period": "yearly" },
  "skills": ["SQL", "Power BI", "Excel"],
  "description": "Plain text, at least 30 characters. Line breaks are kept.",
  "applyMethod": "link",
  "applyUrl": "https://acme.example/careers/123",
  "applyEmail": "",
  "postedAt": "2026-11-06T06:30:00+05:30",
  "closesAt": "2026-12-06T23:59:59+05:30",
  "status": "active"
}
```

| Field | Required | Values |
|---|---|---|
| `title` | yes | 2–120 characters |
| `company.name` | yes | 1–100 characters; `website` and `logo` are optional full links |
| `locations` | yes, unless `workType` is `remote` | up to 10 city names |
| `workType` | no (`onsite`) | `onsite`, `hybrid`, `remote` |
| `jobType` | no (`full_time`) | `full_time`, `internship`, `contract`, `part_time` |
| `experience` | no (`fresher`) | `internship`, `fresher`, `0_1`, `1_3`, `3_plus` |
| `salary` | no | rupees; `min` / `max` (either may be left out), `period` `monthly` or `yearly` |
| `skills` | no | up to 30; known skills are renamed to the skills dictionary's names (`powerbi` → `Power BI`) |
| `description` | yes | 30–20,000 characters, plain text |
| `applyMethod` | no (`link`) | `link` (needs `applyUrl`), `email` (needs `applyEmail`), `nm7` (apply on Nm7) |
| `postedAt` | no (now) | ISO date-time; not in the future |
| `closesAt` | no | ISO date-time; the job closes itself after it |
| `status` | no (`active`) | `active`, `paused`, `closed` |

Unknown fields are refused, so typos are caught.

## Duplicates

The same job is recognised by **company + title + cities (or remote) + apply link/email**, ignoring case,
punctuation and the order of the cities. Sending it again:

- with something changed (salary, description, skills, closing date…) → **updated** (it keeps its page, status and
  posted date);
- with nothing changed → **skipped**.

So the collector can send everything it found each morning without making copies.

## The answer

```json
{
  "created": 41, "updated": 6, "skipped": 120, "rejected": 2,
  "results": [
    { "index": 0, "result": "created", "id": "…", "title": "Junior Data Analyst", "errors": [] },
    { "index": 7, "result": "rejected", "title": "No link", "errors": ["applyUrl: …"] }
  ]
}
```

`index` is the job's position in the array you sent (from 0). A rejected job never stops the others.

| Status | Meaning |
|---|---|
| 200 | done (see the counts) |
| 400 | `bad_json`, `no_jobs`, `too_many` |
| 401 | `bad_key` (10 wrong keys an hour from one address → 429) |
| 413 | body over 8 MB |
| 429 | too many requests: wait and try later |
| 503 | `ingest_off`: JOB_INGEST_KEY isn't set on the server |

## After upload

- New jobs are live on nm7.si/jobs straight away.
- The daily link check opens each apply link about once a day, politely: one request a second per website. A job
  whose link fails twice in a row is closed, and an admin can reopen it in Admin → Jobs → Expired links.
- Admin → Jobs shows every job with its source "Job collector".

## Setting JOB_INGEST_KEY in Render (Naresh)

1. Make a long random key on your computer, for example run `openssl rand -hex 32` (64 characters). Keep it in your
   password manager.
2. Render → the `nm7-api` service → **Environment** → **Add Environment Variable**: key `JOB_INGEST_KEY`, value the
   key → **Save Changes**. Render restarts the API with it (about a minute).
3. Put the same key in the collector's settings as its Bearer token, and point it at
   `https://nm7-api.onrender.com/api/jobs/ingest`.
4. To change the key later, replace the value in Render and in the collector at the same time.
