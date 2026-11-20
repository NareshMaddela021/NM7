# Auto Apply 2.0, phase A5 ("Open forms")

**Stacked on #235 (phase A4), which is stacked on #234 (A3), #233 (A2) and #232 (A1).** Merge A1, then A2, then A3,
then A4, then this one.

Everything here sits behind the same Auto Apply 2.0 switch, which is **OFF** by default.

## What it does

- **Simple forms on the company's own website.** When a job's "Apply" link is on the company's own site, Nm7 can now
  fill and send a plain HTML application form for the candidate, instead of leaving it "Ready" for one tap.
  - Only simple forms: one plain HTML form that posts on the same site. Nm7 skips anything with a CAPTCHA or any
    challenge (reCAPTCHA, hCaptcha, Cloudflare Turnstile and challenge pages, image CAPTCHAs, Arkose, Friendly Captcha
    and others), a password field (a login or an account), several steps, a payment, or anything that needs
    JavaScript. Those jobs stay "Ready" for one tap, with a plain reason on the tracker row.
  - Plain HTTP only (httpx). No browser runs on the server and no JavaScript is executed.
  - Never a job board (LinkedIn, Naukri, Indeed, Foundit, Glassdoor, Shine, Internshala and about 50 more), never a
    hosted hiring system or form builder (Workday, Greenhouse, Lever, Google Forms, Typeform …), never a link that
    isn't on the company's own domain, never a private or local address.
- **Polite, like the job collector.** The rules of `job-collector/polite.py` are ported to the API server
  (`backend/app/autoapply/forms/polite.py`):
  - honest user agent `Nm7-AutoApply/1.0 (+https://nm7.si/bot)`;
  - robots.txt is read first and obeyed for our agent and for `*` (a forbidden robots.txt means off limits);
  - the site's terms page, when the page links one, is read once a month; a rule against bots, scraping, crawling or
    automated use stops it for good;
  - 5 seconds between requests to the same site and one request at a time per site;
  - at most 30 requests and 10 applications a day per site;
  - 15-second timeouts, at most 1.5 MB read from any page, and every redirect checked by hand (another site or a
    login page stops it).
- **Filled only from the candidate's own facts.** Name, email, phone, city, links, current job, degree, college, year,
  notice period and expected salary come from the tailored resume (A1), the saved answers and the Nm7 profile. The
  cover note goes into a cover letter or message box, ending "Sent by Nm7 Auto Apply on the candidate's behalf". A
  resume upload gets the tailored resume PDF.
  - Gender, date of birth, religion, caste and similar fields are never filled from anything but the candidate's own
    saved answer.
  - Anything required that Nm7 doesn't know (current CTC, a consent box, a choice) goes to **Waiting for you**. The
    candidate answers once, it is saved to their profile, and the form is sent at once. Nothing is guessed.
  - A required file other than the resume (a photo, a certificate) → one tap.
- **Blocks are remembered.** A CAPTCHA, a login, a redirect to a login page or another site, HTTP 403 / 429, a 5xx,
  an error page or a form shown again with errors moves the site to **one tap only** and Nm7 never automates it again
  until Admin resets it. A page that is simply gone (404) only affects that job.
- **Proof for the candidate.** "What was sent" now shows, for a form application:
  - the fields sent (hidden form tokens listed without their value; Nm7 never handles passwords);
  - the resume file;
  - the HTTP status and final address;
  - a text copy of the company's answer page (at most 4,000 characters), and the time.

  The tracker row shows "▤ Company form" and "Sent through the company's own form. The company's page confirmed it."
  A failed try keeps its proof too, and the row says it didn't go through.
- **Admin → Auto Apply, new panel "Auto Apply 2.0: company form sites".** Every site seen, with:
  - its state: allowed (simple form), one tap only and why, blocked by robots.txt, blocked by its terms (with the
    sentence), or job board;
  - when it was last tried and last sent, the successes and failures, and today's requests;
  - **Move to one tap** and **Reset** (asked on the page; robots.txt and the terms are checked again next time). A job
    board stays a job board.

  The panel also shows the rules above and the counts.
- **When it runs.** Never during the morning run: the run only queues the application ("Sending to the company's
  form"). A background pass inside `heavy_or_skip` sends at most 4 forms a pass, one per site, every 10 minutes. It
  also runs right after an approval or an answer.
- **Switch OFF isolation.** While the switch is OFF only the A2 pairing rule lets a form through: a tester's
  application to a company with a listed tester on its team. A job found by the collector (no company on Nm7) is never
  sent while OFF. Everything is checked again just before sending. Demo accounts never touch the network.
- **Demo.** Kavya now has one application sent through the demo company's careers form, with the full proof. It is
  made from a copy of the form with no network, and the demo site shows in Admin's list as "(demo)".
- **Database changes, all additive:**
  - new collection `auto_form_sites` (one per site) with an index on state and last tried;
  - new item state `form_queued`;
  - new fields on `auto_items`: `form_proof`, `form_site`, `form_next_at`, `form_missing`, and `kind: "form"` for
    waiting questions;
  - on `applications`: `channel: "form"`, `channel_v2: "form"` and `form_proof`.

## What to check

1. Admin → Auto Apply → "Auto Apply 2.0": keep the switch **OFF**, with your tester emails listed.
2. Get a test company (a tester on its team) with a simple careers form on its **own** site. A plain HTML form that
   posts to the same site is enough, with a name, email and resume upload. Post or add a job whose apply link is that
   page, for your tester candidate (2.0 on, full auto).
3. After the morning run (or Admin's run) and the next automation pass, the candidate's `/me/auto-apply/v2` row should
   say "▤ Company form". Open "What was sent" and check the fields, the PDF name, the status and the copy of the thank-you
   page. Then check that your site really got the application with the PDF.
4. Add a required field Nm7 can't know (for example "Current CTC"). The job should wait in "Waiting for you". Answer it,
   and it should be sent.
5. Put a reCAPTCHA on the form, or `Disallow: /` in robots.txt. The job should be "Ready" (one tap) with the reason,
   and the site should show in Admin's company form sites as "One tap only" or "Blocked by robots.txt". Reset it there.
6. Check the server log or your site's access log: the user agent is `Nm7-AutoApply/1.0 (+https://nm7.si/bot)` and
   the requests are at least 5 seconds apart.
7. **Before switching on:** publish a short page at `https://nm7.si/bot` explaining the bot and how a company can opt
   out (robots.txt, or write to us). The user agent links to it.
8. On a phone (390 px): the tracker row, "What was sent" and the Admin panel. Nothing should scroll sideways.
9. Read the wording: the reasons in `backend/app/autoapply/forms/service.py` (`REASONS`, `STATE_TEXT`), the proof box
   in `frontend/src/pages/me/AutoApplyV2.jsx` (`SentForm`) and the Admin panel (`FormSites` in
   `frontend/src/pages/admin/live/AutoApplyPages.jsx`).

## Tests

- Backend: the new `tests/test_auto_apply_a5.py` (63 tests, every HTTP call to an httpx `MockTransport` fake company
  site). It covers:
  - the whole way, with the exact requests (robots.txt, the page, the terms, the post, the thank-you page), the user
    agent on every request, the waits between requests, the multipart body with the PDF, and the proof, tracker and
    "What was sent";
  - robots.txt: three kinds of Disallow, and a forbidden robots.txt → skipped and remembered, with no request for the
    next job;
  - a terms prohibition → skipped and remembered, plus the keyword rules;
  - CAPTCHAs: each widget, a challenge page, on the page and on the answer page → one tap and remembered;
  - a login form, and a redirect to a login page or another site;
  - steps, payment, GET forms, JavaScript-only pages, and newsletter or search boxes;
  - 403 / 429 / 503 on the page and 403 / 429 on the submit → one tap and remembered, with the proof kept; an error
    page → remembered; 404 → not held against the site;
  - job boards refused, with no request, exact domain matching, hosted forms and other domains;
  - polite spacing, the per-site request and submit caps, the user agent and timeouts; the daily cap waits for later;
    private addresses refused;
  - field mapping with the file upload and sensitive fields;
  - unknown required fields → Waiting, then sent with the saved answer;
  - switch OFF isolation (also re-checked before sending), approve-each, Admin list / one tap / reset with audit, and
    the demo with every network call failing.

  The A1–A4 tests still pass; the demo counts in `test_auto_apply_admin.py` were moved up by the one new demo item. The
  whole suite passes apart from `tests/test_test_users.py::test_create_open_and_remove`, which fails only locally.
- Frontend: `npm test`, `npm run build` and `npm run lint` pass (no new warnings). The Easy dashboard bundle is
  unchanged at 149.1 of 150 KB: everything new is in the Auto Apply 2.0 page and the Admin Auto Apply chunk.
- Live e2e: the new `e2e-live/auto-apply-v2-forms.spec.mjs` covers the candidate's proof view (a simple form sent; a
  CAPTCHA page left for one tap) and Admin's site list (filter, reset, move to one tap), on desktop and at 390 px.
  The fake company site runs inside the seed process, so nothing leaves the machine. It passes with
  `--repeat-each 2`, together with the A1–A4 specs.

## Done / not done

- [x] Simple plain-HTML forms only; CAPTCHA / challenge, login, account, steps, payment and JavaScript are detected
      and skipped
- [x] Job boards never used (blocklist with exact domain matching); hosted hiring systems and form builders left to one tap
- [x] robots.txt (our agent and `*`) and the terms page checked before anything; honest user agent; per-site delay,
      one at a time, daily caps, timeouts, size cap, redirects checked
- [x] Filled from the candidate's resume (tailored version), saved answers and profile; unknown required → Waiting;
      tailored resume PDF uploaded
- [x] Plain HTTP POST only; no headless browser
- [x] Blocks, CAPTCHAs, errors, login redirects and 403 / 429 → one tap and the site remembered
- [x] Proof stored and shown in "What was sent"
- [x] Admin site list with state, reason, last tried, counts, Move to one tap and Reset (audited)
- [x] Behind the 2.0 switch with the A2 pairing rule; demo with no network
- [x] UI at desktop and 390 px; Easy dashboard bundle unchanged
- [x] Tests: backend, frontend, live e2e
- [ ] Not yet tried against a real company site: only the fake site in tests so far (step 2 above).
- [ ] The `https://nm7.si/bot` page the user agent points to doesn't exist yet (step 7 above).
- [ ] Only the job's own apply page is read. A form one click away ("Apply" button to another page) is not followed;
      that job stays one tap.
- [ ] A required consent box ("I agree to the privacy policy") is asked in Waiting once, then the saved answer is used
      for every company's form with the same wording.
- [ ] The Admin site list is a panel on Admin → Auto Apply, not a separate page, so the main bundle doesn't grow.
- [ ] Telugu / Hindi strings for the new screens (English only while it is tested).

🤖 Generated with [Claude Code](https://claude.com/claude-code)

https://claude.ai/code/session_01SBaqRLDLwSKFN3nQpCsLVw
