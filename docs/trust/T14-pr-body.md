# Vetting Trust T14: running code for tech roles — a sandbox with hidden tests, and a replay of how the code was written

Base: `claude/confident-knuth-pu6nd3-trust-t13` · Branch: `claude/confident-knuth-pu6nd3-trust-t14` · **Stacked on #255 (T13)**, which is stacked on #254 (T12), #253 (T11), #252 (T10), #251 (T9), #250 (T8), #249 (T7), #248 (T6), #247 (T5), #246 (T4), #245 (T3), #244 (T2) and #243 (T1): merge #243 … #255, then this one (GitHub switches the base each time).

Everything new is behind the one **Vetting Trust** switch from T1. While it is OFF only admins, demo accounts and listed
testers get coding tasks: everyone else gets the tech roles' **written** practical task **exactly as before** (the
`/api/me/trust/code` endpoints answer 404 to them, nothing is stored, the sandbox is never called). Companies the switch
is off for see nothing new.

**Code never runs on the Render server.** It goes to an outside sandbox (Judge0 CE). Until Naresh adds a key, only the
built-in test sandbox exists (it runs nothing, and on the live site only testers / demo accounts / admins get it), so
real candidates keep the written task even after the switch goes public — until a sandbox key is set.

## What this does, in plain words

- **Coding tasks.** For a tech role with a coding problem (built in: **"Sum of the even numbers"** for Python, Java, QA
  and data science; **"The most frequent word"** for front-end, full-stack and mobile), the practical task after a
  passed skill check becomes a coding task:
  - the problem, **starter code in Python, JavaScript, Java and C++** (SQL is supported for problems Admin adds), the
    **visible sample tests**, and only the **number** of hidden tests;
  - a light editor (a text box: Tab indents, line numbers; no heavy editor library) — **saved as you type**, so a
    reload or a dropped connection loses nothing;
  - **Run** checks the code against the visible samples only (output vs expected for a failing one). Rate limited:
    6 a minute per person and 30 per task (Admin);
  - **Submit** stores the code first, then runs the samples + the **hidden tests** in the sandbox. Score = hidden tests
    passed (0–100; 60 passes, like every practical task). The candidate sees **"X of Y hidden tests passed"** and the
    names of **failing visible samples only**. The badge ("Skill verified") follows as before.
  - **Hidden tests never leave the server**: they and the reference solution live in `trust_code_problems` and in the
    started task's server-side snapshot; no candidate or company response carries them (tested on every endpoint and
    in the browser e2e). Everyone gets the same tests; a task keeps the tests it opened with if Admin edits the problem.
  - the **T9 honesty pledge** comes before it (the task start), and the **T9 retake limits** apply (it is the same
    attempt).
  - optional **AI review of code quality** (the existing grading call, strict schema, AI allowance "vetting", the code
    anonymised first — e.g. a name in a comment is removed): two feedback lines ("readable", "approach"). It **never
    changes the score**; the tests decide.
- **The sandbox** (provider interface + deterministic test sandbox, `backend/app/trust/code/`):
  - **Judge0 CE** (RapidAPI or self-hosted on its own VM; isolated adapter, httpx). Every call states the limits:
    **CPU seconds, wall seconds, memory, output size, processes, network off** (Admin, within bounds: CPU 0.5–10 s,
    wall 1–20 s, memory 32–512 MB, output 4–256 KB). Output is cut at the cap and marked.
  - **Sandbox down** (unreachable, 5xx, 429, internal error, still running): the submission stays **queued** with the
    code saved; it is tried again when the candidate's page checks (every 15 s) and by the automation pass (heavy lease,
    20 a pass), waiting 1, 2, 5, 10 … minutes. After **10 tries** a person grades it from the review queue — an outage
    never fails anyone. "Run" says "Running code is paused for a moment. Your code is saved…".
  - at most 2 sandbox calls at once from the server (each only waits on the network).
- **Keystroke / code replay** (only with its own consent):
  - new T1 consent **"Coding replay (your typing in the code editor)"**, asked as one **unticked** line in the task
    start: *"We record your typing in this editor only to show reviewers how the solution was written…"* (who sees it,
    90 days, nothing outside the editor, saying no is fine). Withdraw any time (Privacy & consent): replays deleted at once.
  - the browser records the **editor only**: typed edits, pastes (with their size), language switches, leaving / coming
    back to the editor, with timestamps, in a compact form (≤ 20,000 events / 200 KB; the recorder stops at the cap and
    says so). Sent with the code; the server re-plays it, checks it ends in the submitted code and works out the numbers
    itself. Without the consent nothing is recorded or kept (a replay sent anyway is dropped).
  - retention: new type **"Coding replays"** — **90 days** (Admin 7–180), deleted by the daily job; the code and results
    ("Code written in coding tasks") 365 days (Admin 90–730).
  - **reviewers**: Admin (Vetting Trust → Coding tasks → latest results → **Watch the replay**) and the **company**, only
    where the Trust switch is on for it, Admin allows company replays, and the candidate is visible to it (applied, or
    in Hire now with consent): the applicant's profile shows **"Coding task · X of Y hidden tests passed"** and **Watch how
    the code was written**. Play / pause, **1x / 4x / 16x** (long pauses play as 3 s), a slider, **paste moments marked on
    the timeline** (large ones in red) and the pasted text highlighted when it lands. Each view is in the audit log.
    Companies never see the hidden tests or anything outside the editor.
- **Integrity (T8)**: a paste of **200+ characters** (Admin 50–5000) → `code_big_paste` (weight 1.5, cap 3); a solution
  with **almost no typing** (80+ characters added to the starter with fewer than 20 typed) → `code_no_typing` (2, cap 2).
  From the replay, or without it from the counters the page always sends (characters typed / pasted / largest paste —
  the skill-check monitoring people already agreed to). They are **signals for a person**: the task is still graded on
  the tests, nobody is rejected or sent to a retest by them; the candidate sees them in plain words on their T8 rating.
- **Admin → Skill checks → Vetting Trust → Coding tasks**: on / off, the sandbox (test / Judge0 CE), keys **set / not
  set** (never values), **Check the sandbox now**, the limits, run limits, the big-paste size, AI review on / off,
  company replays on / off, counts (problems offered, tasks by status, replays kept, tasks with signals), the
  **problems with their hidden tests** (add / edit: each save runs the **reference solution through the sandbox**
  against every test and the problem is offered only when it passes; "Validate" re-runs it), and the latest results.

## What Naresh should check

1. Add your candidate email as a Trust tester and a Skill checks tester (Admin → Skill checks).
2. As the candidate, pass the **Python** skill check (locally: `uv run python -m tests.e2e_seed trust-t14-pass <email>
   Python` gives a passed one), open the result: read the **pledge** and the **"Coding replay"** line (plain enough? true
   for us?), tick both, start.
3. In the coding task: Run with the starter code (both samples fail), write a solution (the test sandbox passes any code
   without "TODO"; `# MOCK:PASSN=1` passes only the first sample, `# MOCK:DOWN` shows the queue), Submit: "5 of 5 hidden
   tests passed", the badge.
4. Admin → Vetting Trust → **Coding tasks**: the limits, **Check the sandbox now**, the problems (open one: the hidden
   tests are only here), the result → **Watch the replay** at 16x (`tests.e2e_seed trust-t14-code <email>` makes one
   with a big paste).
5. As the demo company (Admin → Companies → Reset and open as company; `tests.e2e_seed trust-t14-code
   @demo-applicants`): Applicants → a profile → "Coding task" → Watch.
6. Sign up for **Judge0** (docs/trust/T14-vendors.md: RapidAPI free plan to try, Pro ≈ ₹ 850 / month, or a small VM ≈ ₹
   450–2,000 / month), set the env vars, switch the sandbox to Judge0, **Validate** both problems.
7. Decide: (a) should companies see the replay at all, or only Nm7 (Admin switch, on by default)? (b) 200 characters for a
   "large paste"; (c) 90 days for replays; (d) 30 runs per task / 6 a minute; (e) whether the AI review lines are useful
   or should be off.

## Done / not done

- [x] Coding tasks: statement, starter code per language (Python, JavaScript, Java, C++; SQL for Admin problems), visible samples, hidden tests server-side only
- [x] Run (visible samples, rate limited per person and per task) and Submit (hidden tests); score = hidden tests passed; "X of Y" + failing visible sample names only
- [x] Optional anonymised AI code-quality review via the existing grading (feedback only, never the score)
- [x] Sandbox through a provider interface: deterministic test sandbox + Judge0 CE adapter (RapidAPI or self-hosted); CPU / wall / memory / output / processes limits and network off on every call; output caps
- [x] Never on the API server; at most 2 sandbox calls at once; queue with retries and backoff; provider down → queued, no lost work (drafts saved as you type, code stored before running); a person after 10 tries
- [x] Replay: compact editor events (typed, paste with size, focus loss, language switch), size cap, own consent line in the task start, retention type "code_replay" 90 days, withdraw deletes
- [x] Reviewer playback at 1x / 4x / 16x with paste moments; Admin always, the company only where the Trust switch allows + Admin setting + candidate visible; audited
- [x] Big paste / zero typing → T8 signals (`code_big_paste`, `code_no_typing`), never a rejection
- [x] T9 pledge + retake limits; same tests for everyone (snapshot at task start)
- [x] Behind the Trust switch; real users keep the written tech task unchanged while OFF
- [x] Admin: provider choice, keys set / not set, limits, health, problems with hidden tests validated through the sandbox, counts, results
- [x] No new route; editor, replay and Admin card in their own lazy chunks (Coding 6.7 KB, replay 2.8 KB, Admin 14.5 KB, company card 1.6 KB); main bundle unchanged (342,834 bytes); Easy dashboard Telugu / Hindi 149.1 / 150 KB unchanged; 390 px with no sideways scroll
- [ ] The editor is a plain text box (no syntax colours) to keep it light; CodeMirror can be added later in the same lazy chunk if wanted.
- [ ] The T8 evidence view lists the code signals but has no "watch" button yet: reviewers open the replay from Coding tasks → latest results.
- [ ] A company sees the coding card in an applicant's profile only (not on Hire now cards yet).
- [ ] Judge0 language ids, network-off and plan limits need confirming against the chosen instance (vendors note).
- [ ] The coding task screens are English only (problems are in English; the consent text has no Telugu / Hindi yet).

## Tests

- Backend `tests/test_trust_t14.py` — **TEST_T14**: the test sandbox's markers, output compare and cap; the built-in
  problems valid, references passing (also run for real in the test), starters failing; Judge0's request (every limit,
  network off, RapidAPI / self-hosted headers, polling, status mapping, 5xx / 429 / internal / network → down); the coding
  flow with **no hidden test in any response** (start, view, run, submit, result, catalogue), scoring from hidden tests,
  failing visible samples named, badge at 5 / 5; Admin limits passed to the provider exactly, bounds, permissions;
  sandbox down → queued, saved, not hammered, retried by the pass, a person after 10 tries; run rate limits per minute and
  per task (submit still works); replay only with consent, server-side stats, size cap (dropped, submission goes on),
  retention and withdraw; big paste / no typing → T8 signals, still graded, badge, no retest; reviewer access (Admin
  audited; company: switch off → 404, not visible → 404, applied → replay without source or cases, consent withdrawn →
  no replay, Admin setting off → 404; candidates can't reach Admin); Admin problems validated by running the reference
  (bad → not offered, fixed → v2 offered, sandbox down → says so), started tasks keep their tests; the AI review
  anonymised, strict schema, feedback only; switch OFF → the written tech task, 404, nothing stored, sandbox never called.
- Full backend suite: **FULL_PASSED passed**, 1 failed (only the known local-only `test_test_users::test_create_open_and_remove`, deselected).
- `ruff check` / `ruff format --check`: clean. Frontend: vitest **664 passed** (2 skipped; new `codeLib.test.js`: diff,
  recorder with / without consent, size cap, playback timing at 1x / 16x, paste marks and highlight), lint no new warnings
  (the 3 existing ones), build OK.
- e2e `frontend/e2e-live/trust-t14.spec.mjs`, desktop + 390 px, `--repeat-each 2`: **20 passed** (coding task with the
  consent line, Run, a language switch, Submit → 5 of 5 + badge, no hidden test in any skill-check / code response; the
  sandbox down queue survives a reload; Admin card + replay at 16x with the big paste; demo company profile replay;
  switch off → written task, 404). Also re-run: `hire-skillcheck`, `trust-t9` (12 passed).

## Vendors to sign up for

- **Judge0 CE**: RapidAPI (free plan to test; Pro ≈ US$ 10 ≈ ₹ 850 / month for ~2,000 submissions a day ≈ 50 coding
  candidates) or self-hosted on a separate small VM (≈ ₹ 450–2,000 / month). Render env vars: `JUDGE0_URL`,
  `JUDGE0_RAPIDAPI_KEY` (RapidAPI) or `JUDGE0_AUTH_TOKEN` (self-hosted). Details: `docs/trust/T14-vendors.md`.

## Database

Additive only: new collections **`trust_code_problems`** (problems with hidden tests; the two built-in ones are added on
first use), **`trust_code`** (`_id` = attempt id: the problem snapshot, draft, runs, the submission with per-test
results, flags and counters; index on `submission.status` + `next_at`), **`trust_code_replays`** (the editor replay and
its numbers); the attempt's `task` gains `type: "coding"` and `coding` {language, status, passed, total,
failing_samples}; site setting `trust.code`; T1 consent purpose `code_replay`; retention types `code_replay`,
`code_tasks`; T8 signal kinds `code_big_paste`, `code_no_typing`. Code: `backend/app/trust/code/` (providers, judge0,
problems, replay, service, router); small hooks in `app/hire/vetting/router.py` (task start / submit / result),
`app/trust/integrity/{rating,signals}.py`, `app/automation.py`, `app/main.py`, `app/core/{config,db}.py`; frontend
`pages/me/trust/{Coding,CodeReplay}.jsx` + `codeLib.js`, `pages/admin/live/TrustCodeAdmin.jsx`,
`pages/company/CompanyCode.jsx`, `styles/code-task.css`, hooks in `pages/me/vetting/{Task,Result}.jsx`,
`pages/admin/live/TrustAdmin.jsx`, `pages/company/CompanyApplicants.jsx`.

🤖 Generated with [Claude Code](https://claude.com/claude-code)

https://claude.ai/code/session_01SBaqRLDLwSKFN3nQpCsLVw
