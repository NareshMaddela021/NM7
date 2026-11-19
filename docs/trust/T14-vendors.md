# Vetting Trust T14 — what to sign up for (code sandbox)

Candidates' code must **never** run on the Render API server (512 MB, shared with everything). T14 sends it to an outside
**code sandbox**. Until you add keys, only the built-in **test sandbox** works (it runs nothing and is only used for
testers, demo accounts and admins on the live site); real candidates keep the written tech task.

Pick **one** of the two options below. Both are the same software, **Judge0 CE** (open source, MIT-style licence), so you
can start on RapidAPI and move to your own server later by changing two env vars.

## Option A — Judge0 CE on RapidAPI (quickest, start here)

1. Make a RapidAPI account: https://rapidapi.com → search **"Judge0 CE"** (publisher: Judge0) → **Subscribe to Test**.
2. Pick a plan. Approximate (check the plan page — RapidAPI changes prices and quotas):
   - **Basic: free**, about 50 submissions a day — enough for testing with the Trust testers.
   - **Pro: about US$ 10 / month (≈ ₹ 850)**, a few thousand submissions a day.
   - **Ultra / Mega: about US$ 25–80 / month (≈ ₹ 2,100–6,700)** for more.
3. **How much one candidate uses:** Judge0 counts **every test case** as one submission. A "Run" uses 2 (the samples), a
   "Submit" uses 2 + the hidden tests (7 for the built-in problems), and Admin's "Validate" uses the same as a Submit.
   With the default 30 runs per task, one candidate uses **about 10–60**; plan for ~40 each. So 50 coding candidates a day
   ≈ 2,000 submissions a day → the Pro plan.
4. Copy your **X-RapidAPI-Key** (RapidAPI → Apps → default application → Authorization).

Render → nm7 API → Environment:

| Variable | Value |
| --- | --- |
| `JUDGE0_URL` | `https://judge0-ce.p.rapidapi.com` (the default; you can leave it out) |
| `JUDGE0_RAPIDAPI_KEY` | your RapidAPI key |

Then Admin → Skill checks → Vetting Trust → **Coding tasks** → Code sandbox: **Judge0 CE** → Save → **Check the sandbox
now** (should say "Up · Judge0 …") → on each problem press **Validate** (runs the reference solution through Judge0).

## Option B — your own Judge0 on a separate small VM (cheaper at volume, data stays with you)

Never on the Render API box. A separate Linux VM:

- **Size:** 2 vCPU / 4 GB RAM is comfortable (2 GB works for a handful of candidates at once).
- **Where / cost (approx.):** Hetzner CX22 ≈ ₹ 450–550 / month (Germany/Finland); DigitalOcean or AWS Lightsail in
  Bangalore / Mumbai, 2 vCPU / 4 GB ≈ US$ 20–24 / month (≈ ₹ 1,700–2,000).
- **Set-up (about an hour):** follow Judge0's "Deployment procedure" (https://github.com/judge0/judge0 → CHANGELOG / docs):
  Docker + Docker Compose, download the release's `judge0-v1.13.x.zip`, set in `judge0.conf`:
  - `AUTHN_HEADER=X-Auth-Token` and a long random `AUTHN_TOKEN` (this is Nm7's key),
  - `ALLOW_ENABLE_NETWORK=false` (no internet for submissions, whatever Nm7 sends),
  - `MAX_CPU_TIME_LIMIT=10`, `MAX_MEMORY_LIMIT=524288`, `MAX_MAX_FILE_SIZE=256` (so Admin's limits fit),
  - `MAX_SUBMISSION_BATCH_SIZE=20`.
  - Ubuntu 22.04+ needs cgroup v1 for Judge0 1.13 (`systemd.unified_cgroup_hierarchy=0` in GRUB, then reboot) —
    **needs vendor docs confirmation** for the exact release you install.
- Put it behind HTTPS (Caddy or nginx with Let's Encrypt), e.g. `https://judge0.nm7.si`, and allow only HTTPS from the
  internet (firewall the rest).

Render → nm7 API → Environment:

| Variable | Value |
| --- | --- |
| `JUDGE0_URL` | `https://judge0.nm7.si` (your server) |
| `JUDGE0_AUTH_TOKEN` | the `AUTHN_TOKEN` you set |

(`JUDGE0_RAPIDAPI_KEY` stays empty; with a non-RapidAPI URL Nm7 sends `X-Auth-Token`.)

## What Nm7 sends and stores

- Sent to Judge0 for each test case: the code, the language, the test's input and expected output, and the limits
  (CPU seconds, wall seconds, memory, output size, processes, **network off**). Never the candidate's name, email or
  anything about them.
- Kept by Nm7: the code and the per-test results (`trust_code`, deleted after 365 days, Admin 90–730), and only with
  the candidate's "Coding replay" consent the editor replay (`trust_code_replays`, 90 days, Admin 7–180, deleted at once
  when the consent is taken back).
- RapidAPI / Judge0 keep submissions on their side for a short time (see their privacy terms); a self-hosted Judge0
  keeps them in its own database — set a clean-up (Judge0 has no automatic expiry; a nightly
  `DELETE FROM submissions WHERE created_at < now() - interval '7 days'` on its Postgres is enough).

## Needs vendor docs confirmation before going live

- The language ids of the instance you use (`GET /languages`): Nm7 assumes Judge0 CE's 71 (Python 3.8), 63 (Node.js 12),
  62 (Java 13), 54 (C++ GCC 9.2), 82 (SQLite 3.27).
- That `enable_network: false` is honoured (Judge0 ≥ 1.13; RapidAPI's hosted CE has no network for submissions).
- The plan's batch size and per-second rate limits (Nm7 sends at most 20 cases per batch and at most 2 runs at once from
  the server).

## No other cost

The AI code review uses the existing AI allowance (feature "vetting"), no new key.
