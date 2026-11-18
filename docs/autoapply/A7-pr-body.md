# Auto Apply 2.0, phase A7 ("Replies, weekly summary, numbers, pricing"): the last phase

**Stacked on #237 (phase A6), which is stacked on #236 (A5), #235 (A4), #234 (A3), #233 (A2) and #232 (A1).** Merge A1,
then A2, A3, A4, A5, A6, then this one.

Everything here sits behind the same Auto Apply 2.0 switch, which is **OFF** by default (admins, demo accounts and
listed testers only).

## What it does

- **One Replies inbox for the candidate.** The new **Replies** tab on `/me/auto-apply/v2` lists every reply, from
  every channel, newest first:
  - companies' emails to the candidate's apply address (A3);
  - Nm7 companies' moves (A2): viewed, shortlisted, interview, offer, not selected, job closed;
  - companies' hiring systems' statuses (A4), labelled "Hiring system · Darwinbox" and so on.

  Unread entries have a dot, and the tab has a badge with the unread count. Opening an email reply, or tapping "See it
  in the tracker", marks it read. There is also **Mark all as read**, and filters for All, Unread and Interview
  invites. "See it in the tracker" opens the tracker on that one row, with "Show all" to go back.
- **Interview invites are found.**
  - An "interview" status from a company, on Nm7 or in its hiring system, is an invite.
  - An email reply is read by rules first: invite words (interview, next round, "free for a call", a Calendly, Zoom,
    Meet or Teams link), rejection words, questions and automatic "we received it" replies. Rejection words win over
    invite words, and "if you are shortlisted" isn't an invite.
  - Only when the rules can't tell, and there is an AI key and allowance left today, the configured cheap model reads
    the reply. It answers in a strict JSON schema with one field, `kind` (`additionalProperties: false`). The schema is
    listed in `tests/test_claude_schemas.py`. Each call counts in the daily AI allowance as `autoapply_reply` (30 a
    person a day, inside the site's 2,000 cap).
  - With no key, no allowance or an AI error, the reply stays "Reply". Nothing is guessed, and the reply's text is
    never changed.
  - An invite moves the tracker row to "Replied / Interview" with the outcome **Interview**.
- **The interview alert, once per tracker row.**
  - **Email.** For an email reply, the forwarded email itself is the alert: its subject starts "Interview
    invitation ·". For an interview status, one "Interview invitation" email goes out. This replaces A2's status
    email, so it is never two emails.
  - **WhatsApp**, only when all of these are true:
    - the candidate opted in to WhatsApp job messages (`notify.whatsapp.jobs`, off by default);
    - they have a phone number;
    - a WhatsApp sender is configured (`app/college/reminders.GATEWAY`).

    No sender is connected today, so this part is skipped and the reason is noted ("no_sender").
  - **Who gets it.** Both go only through `access.may_mail`. While the switch is OFF that means listed testers only:
    never admins, and never demo accounts (not even once the switch is public).
  - **No payments.** Nothing here touches payments. WhatsApp payments stay removed.
- **The weekly summary.**
  - **In-app.** The new **This week** tab shows the last 7 days, all counted from the candidate's own records:
    - applications sent, by channel;
    - viewed, replies, interviews, questions waiting and jobs ready;
    - in Weekly digest mode, this week's list to approve.
  - **One email on Mondays (IST).** It has the same numbers, plus links to Approve, Waiting or Jobs ready.
  - **The weekly digest email** that A1 and A2 left undone: for Weekly digest mode, the Monday email lists this
    week's jobs waiting for Approve (best match first, up to 10) with an "Approve this week's list" button. It's sent
    even when nothing else happened that week, as long as the list isn't empty.
- **The one-email-a-day rule** (written at the top of `backend/app/autoapply/weekly.py`, and shown on the This week
  tab). For a person in Auto Apply 2.0, at most one *routine* Auto Apply email a day:
  - **Monday:** only the weekly summary. It also carries today's "N jobs ready". The morning list is still made
    in-app, but it isn't emailed.
  - **Other days:** at most one of these two:
    - the A6 morning email ("N jobs ready to apply"), which now also says what Auto Apply sent today and what's
      waiting;
    - if no job is ready, today's summary ("Auto Apply today: …"), but only when something happened.
  - **The old emails:** today's Auto Apply daily summary and weekly report are never sent to a 2.0 person on top of
    these. People not in 2.0 get exactly what they got before.
  - **Not covered by the rule:** event emails (a reply forwarded from the apply address, the interview alert, A2's
    status updates). They come when they happen.
  - **Every 2.0 email still needs all of these:** may_mail allows it, the address is confirmed and hasn't bounced, and
    the person hasn't pressed "Stop these emails".
- **Admin numbers.**
  - **Daily report.** Admin → Daily report has a new **Auto Apply** section. It's part of today's snapshot (added to
    it; nothing else changes) and is counted with aggregations only.
  - **Per channel** (Nm7, Email, Partner, Company form, One tap), for the last 7 days: sent, delivered, failed, reply
    rate and interview rate.
  - **The 8 success measures**, each shown as **Met**, **Not met** or **No data yet**:
    - reply or interview rate (30 days): at least 10%;
    - 10–25 applications per active seeker per week;
    - waiting questions answered within 24 hours: at least 70%;
    - email bounces: below 2%;
    - email complaints: below 0.1%;
    - company opt-outs and complaints: about 0 (met only at 0);
    - one-tap kits ending in "I applied": at least 50%;
    - the share of fully automatic applications, compared with the week before: met when it grew.
  - **Admin → Auto Apply** shows the same numbers, counted at that moment, in a new panel "Auto Apply 2.0: channels
    and success measures".
  - `docs/admin/daily-report.md` has a new section e) that explains every number.
- **Pricing in Admin, complete and off.** The Auto Apply 2.0 panel has a **Pricing** box:
  - "Pricing on" (off by default);
  - free applications a week;
  - the paid plan's applications a week;
  - "Payments: coming soon", which can't be ticked. The server refuses `paymentsOn: true`, and nothing is ever
    charged.

  While pricing is off, nobody has a weekly limit. That changes one thing from A1: the free allowance was enforced
  whenever it was above 0, and now it only applies while pricing is on. With pricing on:
  - a candidate gets the free applications a week;
  - a candidate on a paid plan gets the paid limit instead (`auto_apply.plan == "paid"` until
    `auto_apply.paid_until`; nothing sets this yet, because payments are coming soon);
  - 0 means no weekly limit;
  - both limits are on top of the daily limit, in the one place every path uses (`v2engine.left_today`).

  The candidate sees "This week: 3 of 5 free applications used" only while pricing is on.
- **Demo.** Kavya's Replies tab has:
  - the demo company's email reply to her email application, read as an **interview invite**;
  - the companies' moves on her Nm7 applications (interview, viewed, not selected, offer);
  - the three newest unread.

  Her tracker row for that email says Interview.
- **Database changes, all additive:**
  - on `auto_replies`: `kind`, `kind_by`;
  - on `auto_items`: `interview_at`, `interview_alert_at`, `interview_alert`, `answered_at`, `auto_full`;
  - on `users.auto_apply`: `inbox_seen_at`, `inbox_read`, `v2_week`;
  - on `auto_mornings`: `mailed_in`;
  - site settings: `auto_apply_v2.pricing_on`;
  - two partial indexes for the numbers (`auto_items` and `applications` on `v2` + `created_at`, only where `v2` is
    true).

  No new collection.
- **Background:** nothing new runs on its own. The weekly email and the morning rule run inside the existing 2.0
  morning run (already inside `heavy_or_skip`, page by page). The Daily report section runs inside its own snapshot
  (a heavy job, aggregations only), and if it fails, the rest of the report still works.

## What to check

1. Admin → Auto Apply → "Auto Apply 2.0": keep the switch **OFF**, with your tester email listed.
2. **Demo:** click "Reset and open as student (Auto Apply)", then "Open Auto Apply 2.0", then **Replies**.
   - The badge shows the unread count.
   - The first entry is the email interview invite (★ Interview invite).
   - Tap "Read the reply", then "See it in the tracker": the tracker should show that one row, as Interview.
   - Try the Interview invites filter and Mark all as read.
3. **This week** tab (demo or your tester): the numbers should match the tracker. In Weekly digest mode the list
   shows.
4. **Interview alert (tester):** have a test company on Nm7 move your auto application to Interview. You should get
   one "Interview invitation" email (not two), and the tracker should say Interview.
   - Then reply "We'd like to invite you to an interview" to a test email application. The forwarded email's subject
     should start "Interview invitation ·".
   - An admin account that isn't a listed tester should get nothing.
5. **WhatsApp:** nothing is sent today, because no sender is connected. Opting in only changes "not_opted_in" to
   "no_sender" in `auto_items.interview_alert`. Connect a WhatsApp Business provider later behind
   `app/college/reminders.GATEWAY`.
6. **The one-email-a-day rule:** for a Monday you'll get "Your Auto Apply week" and no "N jobs ready" email. On other
   days you'll get at most one of "N jobs ready to apply" and "Auto Apply today".
7. **Admin → Daily report:** press Refresh now. The **Auto Apply** section should show 5 channel cards and 8 measures.
   The numbers stay small until real testers use it.
8. **Admin → Auto Apply:**
   - The new numbers panel should show the same numbers.
   - In **Pricing**: tick "Pricing on", set free applications a week to 2 and save. Your tester should stop at 2 a week
     and see "This week: … of 2 free applications used".
   - Untick it and save again (that's the default).
   - "Payments: coming soon" can't be ticked.
9. Read the wording in:
   - `backend/app/autoapply/replies.py`: the rules regexes and the alert text;
   - `backend/app/autoapply/weekly.py`: the weekly email lines and the rule;
   - `frontend/src/pages/me/AutoApplyReplies.jsx`.

## Tests

- **Backend:** the new `tests/test_auto_apply_a7.py` (16 tests). It covers:
  - the rules reading replies, and the AI reader: strict schema, counted as `autoapply_reply`, never asked when the
    rules decide, no key / allowance used up / an AI failure → "other";
  - the inbox: every channel merged, newest first, reminders left out, another person's left out, unread, one read,
    all read, new ones unread again, behind the switch;
  - the email interview invite through the real webhook (one email, not two; the tracker says Interview; a second
    invite doesn't alert again);
  - the status interview alert: email, WhatsApp opt-in with a phone number and a sender, no sender, switch OFF
    (an admin who isn't a tester gets nothing), demo never, public;
  - the weekly summary's numbers; the one-email-a-day rule through the real morning run (morning email on a normal
    day, only the weekly email on the weekly day, nothing more the same day, in-app only for non-testers); the
    weekly digest email (the list, best match first, the Approve link, once a week, "Stop these emails");
  - the Daily report section's numbers per channel (demo left out, the snapshot, backfilled days without it, the
    report and the Admin endpoint);
  - every success measure met / not met at its edges (exactly 10%, 10 and 25 a week, 70%, 2% and 0.1% are not
    "below", flat isn't growth, no data);
  - the measures counted from real records (24 h answers, one tap, opt-outs vs bounces);
  - pricing off by default, then on with the free limit, the paid limit, a paid plan that ended, and 0 = no limit;
    Admin can save it, can't turn payments on, and can't set a paid limit below the free one;
  - pricing on stops the real run at the free allowance, and off lets it continue;
  - Kavya's demo inbox.

  Changed: A3's reply test now expects Interview ("Are you free for a call" is an invite).
  `tests/conftest.py` keeps every other test off the weekly day, so the suite passes on any day of the week.
- **The whole backend suite passes** apart from `tests/test_test_users.py::test_create_open_and_remove`, which fails
  only locally. `ruff check` and `ruff format` are clean.
- **Frontend:** `npm test`, `npm run build` and `npm run lint` pass, with no new warnings.
  - The Easy dashboard bundle is unchanged at 149.1 of 150 KB.
  - The main bundle is byte-for-byte the same size: the two shared admin parts load from their own pages' chunks,
    with their own stylesheet.
  - No new route: Replies and This week are part of the Auto Apply 2.0 page's chunk.
- **Live e2e:** the new `e2e-live/auto-apply-v2-replies.spec.mjs`, on desktop and 390 px. It covers:
  - the candidate's Replies tab (badge, order, the interview invites, read, filter, the tracker link, mark all read)
    and This week;
  - the owner's Daily report Auto Apply section and Admin → Auto Apply numbers;
  - pricing switched on, then put back.

  It passes with `--repeat-each 2`. All the `auto-apply-v2*.spec.mjs` specs and `daily-report.spec.mjs` pass again
  (30 tests).

## Done / not done

- [x] Replies inbox: email replies, Nm7 statuses and partner statuses, newest first, unread markers, linked to the
      tracker row
- [x] Interview invites: interview status, or an email reply read by rules first; the optional AI reader (strict
      schema in SENT, counted in `ai_quota`, nothing when there is no AI)
- [x] Interview alert by email and WhatsApp (opt-in, a configured sender), through may_mail (testers only while OFF),
      once per row, never a duplicate email
- [x] Weekly summary in-app and by email; the weekly digest email for Weekly digest mode; one routine email a day
      (the rule is documented)
- [x] Admin → Daily report "Auto Apply" section (added to the snapshot, aggregations only) and the same on Admin →
      Auto Apply: per channel sent / delivered / failed, reply and interview rates, the 8 measures met / not met
- [x] Pricing settings complete and editable, off by default; free and paid weekly limits enforced only when pricing
      is on; payments "coming soon" (can't be turned on)
- [x] Behind the 2.0 switch; demo Kavya has the inbox with an interview invite
- [x] Tests: backend, frontend, live e2e
- [ ] No WhatsApp sender is connected, so the WhatsApp alert is ready but sends nothing yet. It needs a paid WhatsApp
      Business provider plugged into `app/college/reminders.GATEWAY`. This is for alerts only, never payments.
- [ ] The rules read English replies. Telugu or Hindi replies go to the AI reader (when a key is set) or stay
      "Reply".
- [ ] "Delivered" for Nm7 and One tap equals "sent" (there is nothing more to measure there). Company-form failures
      are counted when the job moved to one tap during the window.
- [ ] The Daily report keeps the Auto Apply section only on days with a full snapshot (today, from 06:30 IST). Days
      filled in later don't have it.
- [ ] Telugu / Hindi strings for the new screens (English only while it is tested).

## The whole of Auto Apply 2.0: how to go live

1. **Merge in order:** #232 (A1) → #233 (A2) → #234 (A3) → #235 (A4) → #236 (A5) → #237 (A6) → this PR (A7). Each one
   is stacked on the one before it, so merge each into `main` and let the next one's base move to `main`.
2. **Render (the API service):**
   - `RESEND_INBOUND_SECRET`: the `whsec_…` secret of the Resend webhook (`/api/webhooks/resend`, events
     email.received, email.bounced and email.complained).
   - `RESEND_API_KEY`: already set; make sure it can send from `apply.nm7.si`.
   - `AUTOAPPLY_EMAIL_DOMAIN`: only if not `apply.nm7.si`.
   - `ENCRYPTION_KEY`: keeps the hiring-system keys encrypted (otherwise `SECRET_KEY` is used).
   - `ANTHROPIC_API_KEY`: already set (tailoring and reading replies). Without it, everything falls back to the
     rules.
3. **DNS and Resend for `apply.nm7.si`:** follow `docs/autoapply/apply-nm7-si-dns.md`. It covers the domain in Resend
   (sending and receiving), the MX record, SPF, DKIM, DMARC, the webhook and its secret. Admin → Auto Apply → "Email
   channel" should then say **On** with nothing missing.
4. **Publish `https://nm7.si/bot`**, the page the company-form user agent points to (`Nm7-AutoApply/1.0
   (+https://nm7.si/bot)`). Say what it does: it fills only simple forms on a company's own site, politely, never
   CAPTCHAs or logins. Say how a company opts out (the one-click link in any email, or a line in robots.txt). Also add
   the helper section to `https://nm7.si/privacy`.
5. **Chrome Web Store:** follow `docs/autoapply/chrome-web-store.md` to publish the Nm7 Apply helper (`extension/`).
   Until it's listed, the page says "Coming soon".
6. **Admin → Auto Apply → "Auto Apply 2.0", while hidden:**
   - Settings: switch **OFF**, testers listed, test inbox set, thresholds 70 / 55, daily limit 10 (max 25), **Pricing
     off**.
   - Test with a few real testers for a week or two. Watch Admin → Daily report → Auto Apply: bounce below 2%,
     complaints below 0.1%, no company opt-outs, and the reply rate.
   - Check the hiring-system and company-form site lists on the same page.
7. **Go live:** press **Make public**. From then on, every user sees Auto Apply 2.0, and 2.0 emails go to companies
   and candidates under the same limits. Keep **Pricing off** until payments exist. When they do, turn Pricing on
   with the free and paid weekly limits.

🤖 Generated with [Claude Code](https://claude.com/claude-code)

https://claude.ai/code/session_01SBaqRLDLwSKFN3nQpCsLVw
