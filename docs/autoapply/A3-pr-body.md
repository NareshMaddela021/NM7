# Auto Apply 2.0, phase A3 ("Email applications")

**Stacked on #233 (phase A2), which is stacked on #232 (phase A1).** Merge A1 first, then A2, then this one.

Everything here sits behind the same Auto Apply 2.0 switch as A1 and A2, which is **OFF** by default. The email
channel also needs three server settings (see "Before testing" below). Without them it stays off, and email jobs show
as "Ready" so the candidate can apply with one tap.

This builds on today's email channel (`backend/app/autoapply/emailing.py`) instead of adding a second system.
Today's Auto Apply (not 2.0) still sends exactly as before.

## What it does

- **Only addresses the company published itself.** Nm7 emails an address only when:
  - the company posted the job on Nm7 from its own account; or
  - the job carries the link of the company's own job posting or careers page where the address appeared (new
    optional job field `applyEmailSource`, see `docs/job-ingest-api.md`), and the address is on the company's own
    domain.

  A job board (LinkedIn, Naukri, Indeed …), a form, a people or team page, a free-mail address taken from a page, or an
  address on another domain is refused. Nm7 never guesses an address. Each email records where its address came
  from, and the candidate sees that under "What was sent".
- **Each candidate has their own apply address**, for example `sai.x7k2@apply.nm7.si`. It is made once and kept, and
  it is used as From ("Sai Varsha via Nm7") and Reply-To, so company replies come back to Nm7.
- **Replies.** The Resend webhook (`POST /api/webhooks/resend`) checks Resend's signature with `RESEND_INBOUND_SECRET`
  and refuses anything unsigned, wrongly signed or older than 5 minutes. Each event is handled only once. When a reply
  arrives:
  - it is stored;
  - the tracker row moves to **Replied**, with an update line and a reply count;
  - it is listed under "What was sent" and on the new **Email** tab;
  - it is forwarded to the candidate's own email, following the 2.0 email rule (while the switch is OFF, testers only;
    demo accounts never).
- **The message.** It is plain and honest:
  - the candidate's 5–6 line cover note (A1's, truth-checked);
  - the tailored resume as a PDF;
  - their Nm7 profile link (when their share link is on);
  - "Sent via Nm7 Auto Apply on <name>'s behalf";
  - a one-click opt-out link for the employer, also sent as the `List-Unsubscribe` header.

  It has no open tracking, no pixels and no tracked or redirected links. A test checks this.
- **Limits, enforced in code and tested:**
  - one email per job per candidate, ever (a unique row per candidate, job and kind);
  - one follow-up after 7 days, only if the candidate turned it on (off by default) and nobody replied;
  - 10 emails a day per candidate;
  - 20 a day per company domain, across all candidates;
  - the site's existing daily email cap still applies.

  When a limit is reached, the email waits for the next run.
- **Bounces and complaints**, from the same webhook:
  - A bounce blocks that address.
  - A complaint blocks that domain (or only the address, for a free-mail domain like gmail.com). It also pauses that
    candidate's email channel until Admin looks at it.

  Admin sees the bounce and complaint rates over the last 30 days.
- **The employer's opt-out.** The link is signed with an HMAC using the app's secret key and goes to
  `nm7.si/stop-alerts#k=employer&t=…`. The page says "You won't get Auto Apply emails from Nm7 again" and blocks the
  whole domain. It also offers "Block only <address> instead", and the other way round. A link from a test email
  blocks nothing. Admin can see and undo every block.
- **Switch OFF: no company is ever emailed.** While the switch is OFF:
  - the email goes to Admin's new **Test inbox**, or else to the tester's own inbox;
  - its subject starts with "[Test: would go to hr@company…]", so testers see exactly what the company would get;
  - a test inbox set to the company's own address is refused;
  - a follow-up goes to the same inbox as the first email, so a test email's follow-up never reaches the company
    after launch.

  Demo accounts never send real email.
- **Channel off without settings.** Without `RESEND_API_KEY` or `RESEND_INBOUND_SECRET`, email jobs become "Ready".
  The tracker row then shows "Apply by email yourself: <address>". The same happens when the address source isn't
  known, the company opted out, or the candidate turned the channel off.
- **Candidate page** (`/me/auto-apply/v2`), new **Email** tab:
  - turn email applications on or off;
  - turn the one follow-up on or off;
  - their apply address;
  - today's count;
  - the profile link (or how to turn it on);
  - every reply.

  In the tracker, the channel tag now says "Email". "What was sent" shows the exact email: From, To, subject, text,
  the attachment's name, the address source, the follow-up and the replies.
- **Admin** (Admin → Auto Apply):
  - a new "Auto Apply 2.0: email channel" panel: on or off, which server settings are missing, sent today (and how
    many to the test inbox), bounce and complaint rates, replies, blocked domains and addresses, opt-outs with Undo,
    and candidates paused after a complaint with "Turn back on";
  - the 2.0 panel has a new **Test inbox** field.
- **DNS doc for apply.nm7.si:** `docs/autoapply/apply-nm7-si-dns.md`. It covers:
  - Resend's SPF and DKIM records, with the exact values to copy from Resend → Domains, because the keys are made for
    each domain;
  - the MX record for replies;
  - DMARC, starting at `p=none` with reports to your own mailbox, then moving to `quarantine`;
  - the webhook;
  - the Render settings.
- **Database changes, all additive:**
  - new collections: `auto_aliases`, `auto_mail` (the email log), `auto_replies` and `auto_mail_events` (each webhook
    event once, kept 30 days);
  - new fields: `jobs.apply.email_source`; on `users.auto_apply`: `email_on`, `email_follow_up`, `email_paused_at`,
    `email_paused_reason`; on `auto_items`: `replied_at`, `replies`, `apply_to`, `follow_up`; and
    `auto_apply_v2.test_inbox` in site settings;
  - `email_blocks` gets a new reason, `opt_out`.

  Deleting an account removes its replies, email log and apply address.

## Before testing: settings on Render (the API service)

| Variable | Value |
|---|---|
| `RESEND_INBOUND_SECRET` | the `whsec_…` signing secret of the Resend webhook (`/api/webhooks/resend`, events email.received, email.bounced, email.complained) |
| `AUTOAPPLY_EMAIL_DOMAIN` | `apply.nm7.si` (the default; set it only to change it) |
| `RESEND_API_KEY` | already set. It must be allowed to send from apply.nm7.si |

The DNS records come first. The steps are in `docs/autoapply/apply-nm7-si-dns.md`.

## What to check

1. Read `docs/autoapply/apply-nm7-si-dns.md`. Add the records in Resend and at the DNS provider, set up the webhook,
   and set the Render variables. Admin → Auto Apply → "email channel" should then say **On** with nothing missing.
2. In the Auto Apply 2.0 panel, leave the switch **OFF** and set **Test inbox** to a mailbox you own.
3. As a tester with 2.0 on (full auto), wait for an email job whose address the company published (a job your own
   test company posts on Nm7 with "apply by email" is the easiest). The test inbox should get the email with
   "[Test: would go to …]" in the subject, from `<firstname>.xxxx@apply.nm7.si`, with the resume PDF, the cover note,
   the profile link, the footer and the opt-out link. The real company must get nothing.
4. Reply to it from the test inbox. Within a minute, the tracker row should say **Replied**, the reply should be under
   "What was sent" and on the Email tab, and the tester should get it forwarded.
5. Open the opt-out link from the test email. The page shows, but nothing is blocked because it was a test email.
6. Read the email wording (`application_letter`, `follow_up_letter` and `footer` in `backend/app/autoapply/emailing.py`)
   and the opt-out page wording (`frontend/src/pages/AutoApplyOptOut.jsx`).
7. Check the limits (10 a day per candidate, 20 a day per company domain, 1 per job, 1 follow-up after 7 days) and the
   address rules (`address_source`).
8. On a phone (390 px), check the Email tab, "What was sent", the opt-out page and the Admin panel. Nothing should
   scroll sideways.
9. Leave the switch OFF until the testers are happy. Once it is public, keep an eye on bounces (under about 4%) and
   complaints (under about 0.1%).

## Tests

- Backend: the new `tests/test_auto_apply_a3.py` (24 tests) covers:
  - only company-published addresses;
  - every limit: 1 per job, the follow-up rules, 10 a day per candidate, 20 a day per domain;
  - bounce and complaint blocking, and the pause;
  - opt-out signature, block, switching scope and Admin's undo;
  - webhook signature checks (bad, missing and old signatures refused; each event once);
  - an inbound reply stored, forwarded and shown as Replied, including a body fetched from Resend's API;
  - switch OFF never emailing a company;
  - no pixels and no tracked links;
  - the channel off without the settings, falling back to Ready;
  - demo accounts never sending;
  - account deletion.

  `test_auto_apply_v2.py` was adjusted where an email job now needs the channel on. The whole suite passes, apart from
  `tests/test_test_users.py::test_create_open_and_remove`, which fails only locally.
- Frontend: `npm test`, `npm run build` and `npm run lint` pass (no new lint warnings). The Easy dashboard bundle is
  unchanged: Telugu / Hindi is still 149.1 of 150 KB, because the opt-out page loads through the existing
  `/stop-alerts` page, so no route was added to the main bundle.
- Live e2e: the new `e2e-live/auto-apply-v2-email.spec.mjs` covers the candidate, the opt-out page and Admin, on
  desktop and at 390 px. It passes with `--repeat-each 2`, together with the A1 and A2 specs.

## Done / not done

- [x] Only company-published addresses (company's own Nm7 post, or the company's own page on its own domain); source
      recorded; job boards, forms, people pages, free-mail-from-a-page and other domains refused
- [x] Personal apply address on apply.nm7.si as From / Reply-To
- [x] Signed Resend webhook: replies stored, forwarded (by `may_mail` while OFF), tracker "Replied", replies list
- [x] Message: cover note, tailored resume PDF, profile link, honest footer, one-click opt-out (+ List-Unsubscribe)
- [x] Limits: 1 per job ever, opt-in follow-up after 7 days only without a reply, 10 a day per candidate, 20 a day per
      company domain
- [x] Bounce and complaint auto-block; complaint pauses the candidate's channel; rates in Admin
- [x] Employer opt-out: signed link, page, domain or address, test links block nothing, Admin list with undo
- [x] No open tracking, no pixels, no click tracking
- [x] Switch OFF: never a company address; Admin test inbox; demo never sends
- [x] Channel off without the settings → Ready (one tap)
- [x] Candidate Email tab, "What was sent" with the exact email and attachment; Admin health panel; 390 px
- [x] DNS doc for apply.nm7.si (no invented key values)
- [x] Tests: backend, frontend, live e2e
- [ ] Resend inbound needs receiving turned on for apply.nm7.si. If Resend's event has no body, Nm7 fetches it from
      Resend's receiving API (`/emails/receiving/{id}`). Check once with a real reply that the text arrives.
- [ ] Today's Auto Apply (not 2.0) email channel still uses Nm7's own sender and doesn't check the address source.
      It does now respect the new opt-out blocks. Moving it over is for after launch.
- [ ] Attachments in replies are not stored or forwarded (only the text). The candidate can reply to the company
      directly.
- [ ] Admin job form: there is no field yet for "where the apply email was published". The collector / bulk import can
      send `applyEmailSource`, and jobs companies post on Nm7 don't need it.
- [ ] Telugu / Hindi strings for the new screens (English only while it is tested)

🤖 Generated with [Claude Code](https://claude.com/claude-code)

https://claude.ai/code/session_01SBaqRLDLwSKFN3nQpCsLVw
