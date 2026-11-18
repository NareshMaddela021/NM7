# Auto Apply 2.0, phase A4 ("Partner integrations")

**Stacked on #234 (phase A3), which is stacked on #233 (A2) and #232 (A1).** Merge A1, then A2, then A3, then this
one.

Everything here sits behind the same Auto Apply 2.0 switch, which is **OFF** by default.

## What it does

- **Companies connect their own hiring system.** The company dashboard has a new tab, **Connect your hiring system**.
  It only shows to companies the 2.0 switch lets in: while OFF, that means a company with a listed tester on its team,
  or the demo company.
  - Partners: Zoho Recruit, Greenhouse, Lever and Darwinbox. On test servers only (never production) there is also
    "Test system (no network)", for the browser tests.
  - Steps: choose the system, paste the key and the settings it needs (board token, site name and region, Zoho data
    centre, or Darwinbox subdomain), then **Test and connect**. Nm7 tests the details with the partner first and saves
    them only if the test works. After that, **Test connection** and **Disconnect** (it asks on the page, no browser
    dialog).
  - Only the main and full admins can connect, test or disconnect. Posting admins can link jobs. Anyone on the team
    can look.
  - Then each Nm7 job can be linked to a job in the hiring system ("Load jobs from …", pick, Save).
- **The key stays secret.**
  - It is stored encrypted at rest. This uses the existing `app.core.security.encrypt` (Fernet, from
    `ENCRYPTION_KEY`, else `SECRET_KEY`), the same as the other stored secrets.
  - It is never sent back to the browser: the page shows only "•••• last 4", when it was connected, the last test,
    the last problem and the last sync.
  - It is never written to a log or an error, and never to the activity log. The audit records who did what and which
    partner, never the key.
  - Errors are plain messages by kind ("the key isn't valid…", "asked Nm7 to slow down…"). They never pass on the
    partner's own text, which could echo the key back.
  - httpx's request log masks key values in URLs (Lever's apply call puts its key in the URL).
  - Disconnect deletes the key at once.
- **Automatic delivery.**
  - When an approved or full-auto 2.0 application goes to a job linked to the company's system, Nm7 first makes the
    usual Nm7 application, so the company always has it in its Nm7 dashboard. Then it queues it for the partner.
  - What is sent: the candidate's name, email and phone (from their own resume), the tailored resume as a PDF, the
    cover note, the screening answers written out as question and answer, their Nm7 profile link, and "Sent by Nm7
    Auto Apply on the candidate's behalf". Nothing is invented.
  - When it is sent: right after a full-auto scan, right after the candidate approves, and on every automation pass
    (every 10 minutes).
  - Each partner call has timeouts and polite retries. A 429 waits for the partner's Retry-After (at most 30 s), and
    5xx and network errors back off 1 s, then 2 s, for 3 tries in all. 401 and 403 are not retried.
  - A failed delivery waits 10 min, then 30 min, 2 h, 6 h and 24 h, at most 6 times. After that it stays **Kept on
    Nm7**. Nothing is ever lost.
  - Each pass sends at most 20 deliveries, 5 per company.
  - The candidate's tracker shows the channel as **⇄ Partner · Greenhouse** (or whichever system), with "Delivered to
    the company's hiring system", "Sending (trying again)" or "Not delivered … it stays in the company's Nm7
    dashboard".
- **Statuses come back.** A background pass runs inside `heavy_or_skip`.
  - Each pass reads at most 60 delivered applications (at most 20 per company), in batches of 30 with small
    projections. Each application is checked at most every 6 hours, for 60 days after delivery.
  - The partner's stage is mapped to Viewed, Shortlisted, Interview, Offer or Rejected, and moves the application
    forward through the A2 status sync (`sync.on_status`). The candidate's tracker and in-app update change exactly as
    for a company on Nm7, email goes only through `may_mail`, and it never moves backwards.
  - Rejections count in learning, because learning reads the application's status.
  - Which systems can report statuses:
    - Greenhouse: needs the optional Harvest key.
    - Lever: needs the optional Lever API key. An archived candidate counts as hired or rejected according to the
      archive reason's type.
    - Zoho: always, from Candidate_Status.
    - Darwinbox: from BulkCandidatesData.
- **Admin** (Admin → Auto Apply), new panel "Auto Apply 2.0: hiring systems". For each partner: connected companies
  (plus demo), delivered today, retrying and failed, the last error's kind and time, and the last successful sync.
  Never a key and never a company's settings. Darwinbox is marked "needs Darwinbox to confirm its API".
- **Switch OFF isolation.** A partner delivery happens only when `access.pair_ok` allows that candidate to reach that
  company: while OFF, a tester and a company with a listed tester on its team; demo accounts only the demo company,
  always. This is checked when the delivery is queued and again just before it is sent. If a company's tester is
  removed in between, the delivery stays on Nm7 and the partner is never called.
- **Demo.** The demo company shows **Greenhouse (demo)**, "Connected (demo)" with no key. Its first job is linked, and
  its auto applications there show as delivered. Demo connections always use a fake adapter, so the demo never makes
  a network call. A test makes every call fail and checks that nothing broke.
- **Database changes, all additive:**
  - new collections `ats_connections` (one per company) and `ats_deliveries` (one per application, unique on
    `app_id`), with indexes;
  - new fields: `jobs.partner_job`; on `applications` and `auto_items`: `partner` (key, name, state), with
    `channel_v2: "partner"` for these.
  - Deleting an account removes that person's deliveries. The demo reset removes its records.

## How a company gets each partner's key

The help text next to each field says the same.

| Partner | What the company pastes | Where it gets it |
|---|---|---|
| Greenhouse | Job board token, Job Board API key, and optionally a Harvest API key (for statuses) | Greenhouse → Configure → Dev Center → API Credential Management → Create new API key, type "Job Board" (and a second one, type "Harvest", with read access to Candidates and Applications). The board token is the name in `boards.greenhouse.io/<token>`. |
| Lever | Site name, region (global or EU), Postings API key, and optionally a Lever API key (for statuses) | Lever → Settings → Integrations and API → API Credentials → Postings API → Generate new key (and Lever API with read access to Opportunities and Archive reasons). The site is the name in `jobs.lever.co/<site>`. |
| Zoho Recruit | Data centre, client ID, client secret, one-time code | Zoho API Console (`api-console.zoho.in` for India) → Self Client → copy the client ID and secret → Generate Code with the scope `ZohoRecruit.modules.ALL`, then paste it within 10 minutes. Nm7 swaps the code once for a lasting refresh token and keeps only that, encrypted. |
| Darwinbox | Subdomain, API user name, API password, Recruitment API key | From Darwinbox: the account manager, or a Darwinbox admin under Settings → Integrations → API. |

## Official APIs only

- Greenhouse: the Job Board API (`POST boards-api.greenhouse.io/v1/boards/{board}/jobs/{id}`, JSON with the resume as
  base64) to send, and the Harvest API (`GET /v1/candidates?email=`) to read statuses.
- Lever: the Postings API (`POST api.lever.co/v0/postings/{site}/{id}?key=…`, multipart with the resume) to send, and
  the Lever API (`/v1/opportunities`, `/v1/archive_reasons`) to read statuses.
- Zoho Recruit: REST v2 with OAuth. To send: `POST /Candidates`, then `POST /Candidates/{id}/Attachments` for the
  resume, then `PUT /Candidates/actions/associate` to the job opening. To read status: `GET /Candidates/{id}`.
- **Darwinbox: needs partner docs confirmation.** Darwinbox doesn't publish its recruitment API openly. The adapter
  is kept apart in `backend/app/autoapply/ats/darwinbox.py`. It uses the shape that could be found:
  - tenant host `{subdomain}.darwinbox.in`;
  - HTTP Basic, plus `api_key` in the JSON body;
  - `/JobsApiv3/BulkCandidatesData` for statuses, as seen in public integration guides.

  The job list and "add candidate" paths (`/JobsApiv3/JobsList`, `/JobsApiv3/AddCandidate`) are our best guess and
  sit in constants at the top of that file. Confirm them with Darwinbox before a real company uses it.

Nm7 never scrapes a partner's site, never creates an account anywhere and never uses job boards. Only jobs posted on
Nm7 can be linked, so nothing goes to a job that wasn't the company's own.

## Before testing

Nothing new is needed on Render. `ENCRYPTION_KEY` is used if it is set (as for the other stored secrets), otherwise
`SECRET_KEY`. Don't change either once companies have connected, or their keys can't be read and they would have to
connect again.

## What to check

1. Admin → Auto Apply → "Auto Apply 2.0": keep the switch **OFF**, with your tester emails listed.
2. As a test company (a tester on its team), open **Connect your hiring system**. Connect a real sandbox or trial
   account of one partner (Greenhouse or Lever trials are easiest). Try a wrong key first: you should get a plain
   message, and the key must not appear anywhere on the page.
3. After connecting, the card shows "•••• last 4", the connected date and "Last test: Worked". Press **Test connection**.
4. Post a job on Nm7 with Auto Apply off, link it to a job in the partner ("Load jobs from …"), then turn Auto Apply on
   for the job. Your tester candidate (2.0 on, full auto) should appear in the partner's system within a few seconds,
   with the resume PDF and the cover note. On `/me/auto-apply/v2` the row says "⇄ Partner · <name>" and "Delivered".
5. Move the candidate to a rejected or interview stage in the partner. Within about 6 hours (or on a pass after
   clearing `checked_at`) the tracker shows the update. For Greenhouse and Lever, that needs the optional status key.
6. Admin → Auto Apply → "hiring systems": the counts, the last error kind and the last sync. No keys.
7. **Disconnect** and check the key is gone: the `ats_connections` row is deleted.
8. Admin → Companies → "Reset and open as company": the tab shows "Greenhouse (demo)", "Connected (demo)".
9. On a phone (390 px): the connect page, the linked jobs, the tracker row and the Admin panel. Nothing should scroll
   sideways.
10. Read the wording: the field help in `backend/app/autoapply/ats/adapters.py` and `darwinbox.py`, the error messages
    in `base.py` (`MESSAGES`), the page `frontend/src/pages/company/ConnectHiring.jsx` and the tracker lines in
    `AutoApplyV2.jsx`.

## Tests

- Backend: the new `tests/test_auto_apply_a4.py` (12 tests). Every HTTP call goes to an httpx `MockTransport`, so
  there is no network. It covers:
  - Greenhouse end to end: connect, the key encrypted at rest, delivery with the exact request (Basic auth, JSON,
    base64 PDF, cover note), the tracker, Harvest status read-back to Rejected, the in-app update, an email to the
    tester and learning;
  - no secret in any response, caplog, audit row or the Admin health;
  - a wrong key, partner 5xx and bad fields give plain errors without the key;
  - permissions (a posting admin gets 403), the team-only page, disconnect and audit, and the switch hiding the page;
  - failures retried with a bound (6 times, each with 3 polite tries), then kept on Nm7 with no further calls;
  - 429 and Retry-After, then backoff; 403 not retried;
  - the request shapes for Lever (multipart, key in the query and masked in logs, archive reasons → hired), Zoho (code
    swap, candidate, attachment, associate, status), Greenhouse and Darwinbox;
  - mapping partner stages to Nm7 statuses;
  - switch OFF isolation (no new partner call once the company's tester is removed; never queued for a non-test
    company; demo never to a real company);
  - the demo with every network call failing;
  - the sandbox off in production.

  The whole suite passes, apart from `tests/test_test_users.py::test_create_open_and_remove`, which fails only locally.
- Frontend: `npm test`, `npm run build` and `npm run lint` pass (no new warnings). The Easy dashboard bundle is
  unchanged at 149.1 of 150 KB: the new page loads lazily inside the company dashboard, and the tab label isn't in the
  shared strings.
- Live e2e: the new `e2e-live/auto-apply-v2-partners.spec.mjs` covers the company connect page with the test system,
  a wrong key, connect, test, link, delivery to the tracker and disconnect, then Admin health and the demo company, on
  desktop and at 390 px. It passes with `--repeat-each 2`, together with the A1, A2 and A3 specs (32 passed).

## Done / not done

- [x] Adapters for Zoho Recruit, Greenhouse, Lever and Darwinbox: connect / test, list jobs, submit (candidate,
      tailored resume PDF, cover note, screening answers), read status; httpx with timeouts, retries and backoff;
      401 / 403 / 429 / 5xx handled
- [x] "Connect your hiring system" page: choose, paste, Test and connect, Test connection, Disconnect; only "•••• last
      4" and the dates; main / full admins only; audited without the key
- [x] Keys encrypted at rest with the existing key setting; never in a response, log, error or audit
- [x] Automatic delivery for approved / full-auto 2.0 applications to linked jobs; channel "Partner" with the name in
      the tracker; bounded retries; always kept on Nm7
- [x] Status read-back inside `heavy_or_skip` with caps and batches, through the A2 status sync (tracker, update,
      `may_mail`); rejections feed learning
- [x] Admin health per partner without secrets
- [x] Behind the 2.0 switch, with the A2 pairing rule while OFF; demo "connected (demo)" without network
- [x] UI at desktop and 390 px; Easy dashboard bundle unchanged
- [x] Tests: backend, frontend, live e2e
- [ ] **Darwinbox needs partner docs confirmation** (the job list and add-candidate paths and fields). Leave it unused
      for real companies until Darwinbox confirms.
- [ ] Not yet checked against live partner accounts: only mocked calls and the test system so far. Try one real
      sandbox per partner (step 2 above), especially the Greenhouse Job Board key (it is checked only when the first
      application goes out, because Greenhouse has no "check key" call for it) and the Zoho code swap.
- [ ] Partner screening questions are not mapped to the partner's own custom question fields. The answers go in the
      cover letter or comments text. A job whose partner form requires custom questions may refuse the application;
      it is then kept on Nm7 with the reason shown in Admin.
- [ ] Linking a job after its first Auto Apply scan doesn't re-send applications that were already made; only new
      ones go to the partner.
- [ ] One hiring system per company (connecting another one replaces it and clears the job links).
- [ ] The company's applicant card doesn't yet show "Delivered to <system>" (the candidate's tracker and Admin do).
- [ ] Telugu / Hindi strings for the new screens (English only while it is tested).

🤖 Generated with [Claude Code](https://claude.com/claude-code)

https://claude.ai/code/session_01SBaqRLDLwSKFN3nQpCsLVw
