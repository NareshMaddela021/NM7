# Auto Apply 2.0, phase A6 ("One tap")

**Stacked on #236 (phase A5), which is stacked on #235 (A4), #234 (A3), #233 (A2) and #232 (A1).** Merge A1, then
A2, A3, A4, A5, then this one.

Everything here sits behind the same Auto Apply 2.0 switch, which is **OFF** by default (admins, demo accounts and
listed testers only).

## What it does

- **An apply kit for every Ready job.** These are the jobs Nm7 can't send for the candidate: a page with a CAPTCHA or
  a login, a hiring system, an email job with the email channel off, or any company page while the switch is OFF. The
  new **Jobs ready** tab on `/me/auto-apply/v2` shows each one with:
  - the tailored resume (A1) as a PDF: **Download resume (PDF)**, and **Share resume** on phones that can share files;
  - the cover note, the ready answers and the candidate's own details (name, email, phone, city, LinkedIn / GitHub /
    portfolio, current job, degree, college, year, notice period, expected salary, Nm7 profile link), each with a
    **Copy** button;
  - the job's apply link.

  Everything comes from the tailored resume, the saved answers and the profile. If a value isn't there, the row isn't
  shown. Nothing is made up. Gender, date of birth and similar questions are left to the candidate.
- **Apply now** opens the company's page in a new tab. The kit opens on the Nm7 page, to keep beside it.
- **I applied** moves the tracker row to Applied, with the channel **☝ One tap**. It makes the application record
  (`channel_v2: "one_tap"`, `one_tap: {at, via}`) and doesn't count in the daily limit. **Not applying** hides the
  kit for good.
- **One reminder, once.** If a kit was on the morning list (or Apply now was tapped) and the candidate didn't confirm,
  the next day the tracker's Updates and the kit say "Did you apply to … ? Tap I applied … or Not applying". This is
  in-app only and sent once. After that the job just stays in Ready.
- **The morning list.** After the candidate's part of the morning run, Nm7 makes today's "N jobs ready" list, once a
  day:
  - a banner on the Auto Apply 2.0 page ("2 jobs ready … See them") and a count on the Jobs ready tab;
  - one email ("2 jobs ready to apply") **only through `access.may_mail`**: while the switch is OFF only listed
    testers get it, never admins or demo accounts. "Stop these emails" for Auto Apply is respected too.
- **Closed jobs are never offered.** A job is left out of the morning list and the helper's kits when:
  - the company or Nm7 closed it,
  - the daily link check found the apply link dead (`link_check.ok == false` or any failure),
  - or its closing date has passed.

  If a job closes after it was listed, its kit shows **Closed** ("The company closed this job. You can't apply to it
  any more."), with no Apply now. "I applied before it closed" and "Remove" still work.
- **Copy mode for phones.** **Copy one at a time** shows one value at a time, with a big Copy button and Back / Next.
  It is the default on screens up to 480 px. It works at 390 px with no sideways scroll.
- **Nm7 Apply helper: a Chrome extension (Manifest V3) in the new `extension/` folder.**
  - **Pairing:** the candidate taps **Make a pairing code** on the Jobs ready tab (8 characters, for example
    `K7QM-4XPA`, valid for 10 minutes, one use) and pastes it into the helper. The helper gets a token that lasts 30
    days at most and can be signed out from the page or from the helper. Passwords for other sites are never asked
    for.
  - **Filling:** on a company's apply page, the candidate taps **Fill this page**. The helper fills empty fields from
    the kit using:
    - the autocomplete attribute, the label, the name and the placeholder;
    - per-site maps for the public apply forms of Greenhouse, Lever, Workday and SmartRecruiters;
    - the kit's ready answers, matched to question boxes.

    It attaches the resume PDF where the page allows it.
  - **What it never does:** it never presses Submit or any other button. It never touches CAPTCHAs, passwords, check
    boxes, drop-downs or sensitive questions. It never signs in or creates accounts, and it does nothing on job
    boards (the same list as the server).
  - **After Submit:** once the candidate presses Submit, the helper shows a ✓ badge and a "Mark as applied on Nm7" bar.
  - **Permissions:** `activeTab`, `scripting` and `storage`, with host permission only for the Nm7 API server, `https://nm7-api.onrender.com/*` (nm7.si has no /api pass-through). It
    loads no remote code (CSP `script-src 'self'`) and has no analytics.
  - **Where it runs:** Chrome on laptops. On Android only in Chrome-based browsers that allow extensions (Kiwi, Edge
    Canary). The normal Chrome app on phones doesn't run extensions. The page and the docs both say so.
- **The token is scoped.** It is sent as `Authorization: Bearer nm7h_…` and only the new `/api/helper/*` endpoints read
  it. It can read this candidate's open kits and mark one applied (`kits:read`, `applied:write`), and nothing else.
  Sessions are cookies, so the token never works as a session. Only keyed hashes of codes and tokens are stored. Pairing
  is rate limited by IP, and making codes is rate limited per candidate. At most 5 browsers can be signed in; the oldest
  is signed out when a sixth pairs.
- **Docs:** `docs/autoapply/chrome-web-store.md` covers the Chrome Web Store listing step by step (developer account
  and fee, the zip, listing text, screenshot sizes, privacy practices, single purpose, permission justifications,
  privacy policy URL, review time), plus loading it unpacked for testing.
- **Demo.** Kavya now has this morning's list: the website job from Phase 3 and two more, each with a kit, plus one
  that closed after it was listed, shown as Closed.
- **Database changes, all additive:**
  - new collection `auto_mornings` (`_id` = user:day: the items, count, seen, mailed);
  - new collection `auto_helper_codes` (keyed hash, 10-minute TTL index);
  - new collection `auto_helper_tokens` (keyed hash, scope, device, expiry, revoked);
  - on `auto_items`: `listed_day`, `opened_at`, `remind_at`, `reminded_at`, `one_tap`, and the reason `not_applying`;
  - on `applications`: `channel_v2: "one_tap"` and `one_tap`.

  Account deletion removes the new collections' rows. `/api/helper` answers are `private, no-store`.
- **Background:** the reminder pass runs in the automation pass inside `heavy_or_skip`, at most 200 items a pass, and
  stops while Auto Apply is off for everyone. The morning list is built inside the existing 2.0 morning run, which
  already runs inside `heavy_or_skip`.

## What to check

1. Admin → Auto Apply → "Auto Apply 2.0": keep the switch **OFF**, with your tester email listed. Your tester has 2.0
   on.
2. After the morning run (or Admin's run), open `/me/auto-apply/v2`. Jobs found on companies' own sites should show
   in the "N jobs ready" banner, and the tester inbox should get one "N jobs ready to apply" email. An admin account
   (not a tester) should get the banner but no email.
3. **Jobs ready** tab:
   - Open a kit and check every value is really yours.
   - Copy a few values and paste them somewhere.
   - Download the PDF.
   - Tap **Apply now**: the company's page should open in a new tab.
   - Tap **I applied**: the tracker row should say Applied · ☝ One tap.
   - Tap **Not applying** on another kit: it should be gone.
4. Leave one kit unconfirmed. The next day it should show the reminder once (Updates and the kit), then nothing more.
5. Close one of the listed jobs in Admin → Jobs (or wait for the link check). Its kit should show Closed, and it
   should not appear in the helper.
6. On a phone (390 px): the kit opens in copy mode with big buttons, Share resume works, and nothing scrolls sideways.
7. The helper: load `extension/` unpacked (steps in the doc).
   - Make a code on the page and paste it into the helper.
   - Open an apply page and tap Fill this page. Check it filled only empty fields with your details and attached the
     resume, and that it did **not** press Submit.
   - Press Submit yourself on a test form, then use "Mark as applied on Nm7".
   - On linkedin.com it should say it does nothing on job boards.
8. Sign the browser out from the page. The helper should ask for a new code.
9. **Before publishing the helper:** add the helper section to https://nm7.si/privacy (the doc says what to write),
   then follow `docs/autoapply/chrome-web-store.md`.
10. Read the wording: `frontend/src/pages/me/AutoApplyOneTap.jsx`, `backend/app/autoapply/onetap.py` (`CLOSED_TEXT`,
    the reminder and the email), and `extension/popup.js`.

## Tests

- **Backend:** the new `tests/test_auto_apply_a6.py` (12 tests). It covers:
  - the kit's contents and the PDF;
  - closed and dead-link jobs never offered (at the run, at morning build, in the helper), a job closed after it was
    listed shown as Closed, and a passed closing date;
  - the morning list once a day, with the email only to testers through may_mail (not admins, not demo accounts, not
    after "Stop these emails");
  - I applied → tracker Applied with channel one_tap and the application record;
  - one reminder the next day, once, never for closed jobs or people the switch no longer lets in;
  - Not applying;
  - the pairing code: format, 10 minutes, one use, a new code replaces the old one, rate limit, hashes only;
  - the token: scope, revoke, expiry, the 5-browser cap, another candidate's kit, and that it is rejected everywhere
    else (as a bearer token and as the session cookie);
  - switch OFF isolation, and site off;
  - the demo;
  - the extension's job-board list matches the server's.

  The demo counts in `test_auto_apply_admin.py` moved up by the 3 new demo kits. The whole suite passes apart from
  `tests/test_test_users.py::test_create_open_and_remove`, which fails only locally.
- **Extension:** `frontend/scripts/extension-helper.test.mjs`, run by the frontend's vitest. It covers:
  - field mapping by label, name, autocomplete and the per-site maps;
  - ready answers;
  - what is never filled;
  - nothing made up;
  - the job-board list;
  - the manifest (MV3, only activeTab / scripting / storage plus nm7.si, no content scripts, CSP, icons);
  - no remote code and no URLs other than nm7.si;
  - a text check that the page scripts have no submit, click, synthetic mouse, keyboard or submit events, and no Enter
    key;
  - a run of the content script on a fake page that fails if anything is pressed, and checks that the submit listener
    is passive.
- **Frontend:** `npm test`, `npm run build` and `npm run lint` pass with no new warnings. The Easy dashboard bundle is
  unchanged at 149.1 of 150 KB. The new screen is part of the Auto Apply 2.0 page chunk, with no new route.
- **Live e2e:** the new `e2e-live/auto-apply-v2-onetap.spec.mjs`, on desktop and 390 px, covers:
  - the morning banner;
  - 2 open kits and 1 Closed;
  - Apply now opening the company's tab;
  - copying to the clipboard;
  - the PDF download;
  - I applied → tracker Applied · One tap;
  - Not applying;
  - copy mode step by step;
  - the pairing code.

  It passes with `--repeat-each 2`, together with the earlier `auto-apply-v2*.spec.mjs` specs.

## Done / not done

- [x] Apply kit per Ready job: tailored resume PDF (download / share), cover note, ready answers, own details, each with Copy; apply link
- [x] Morning "N jobs ready" list with Apply now (new tab + kit beside it); in-app notice; email only via may_mail
- [x] Copy mode for phones (one field at a time, big buttons), 390 px with no sideways scroll
- [x] I applied → Applied, channel One tap; one reminder the next day, once; Not applying
- [x] Closed / dead-link jobs never offered (run, morning build, list, helper); closed after listing shown as Closed
- [x] Chrome extension (MV3): pairing code, field maps (heuristics + Greenhouse / Lever / Workday / SmartRecruiters),
      resume attach, never submits, no CAPTCHAs, no accounts, job-board blocklist, Mark as applied after Submit,
      minimal permissions, no remote code, no analytics
- [x] Backend: pairing endpoints (10 min, one use, revocable, scoped token), kit API for the helper
- [x] Chrome Web Store guide with unpacked testing
- [x] Behind the 2.0 switch; demo Kavya has a morning list with kits
- [x] Tests: backend, extension, frontend, live e2e
- [ ] The helper isn't on the Chrome Web Store yet: that's your step (the doc). The page says "Coming soon" and has no
      store link until then.
- [ ] The nm7.si privacy policy needs the helper section before you submit it to the store.
- [ ] The helper has only been checked against fake pages and its unit tests, not yet against live Greenhouse, Lever,
      Workday or SmartRecruiters forms (their field names can change). Workday usually asks for an account first; the
      helper then says so and fills nothing until the candidate signs in themselves.
- [ ] A form inside an embedded frame from another site can't be filled from the parent page. The helper offers "Open
      the form on its own page" for known hiring systems.
- [ ] The reminder is in-app only (no email), on purpose, to keep it gentle.
- [ ] The morning email is separate from the existing daily Auto Apply summary email, so a tester can get both on the
      same day.
- [ ] Telugu / Hindi strings for the new screens (English only while it is tested).

🤖 Generated with [Claude Code](https://claude.com/claude-code)

https://claude.ai/code/session_01SBaqRLDLwSKFN3nQpCsLVw
