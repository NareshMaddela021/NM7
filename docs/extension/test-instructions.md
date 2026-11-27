# Nm7 Apply helper: Chrome Web Store "Test instructions"

What to paste into the Chrome Web Store Developer Dashboard, **Test instructions** tab, so Google's reviewer can sign
in and try the helper (version 1.1.0). The rest of the listing is in [`store-listing.md`](store-listing.md).

## Before you paste

1. Sign in to Admin, open **Admin > Auto Apply** and find the card **Chrome Web Store reviewer** (near the bottom,
   under Demo student). Only the Owner sees it.
2. The first time, press **Create the reviewer account**: the password shows. Later, press **Show password**. Then
   press **Copy password**. (Each showing is in the audit log. **Reset password** makes a new one; the old one stops
   working at once and the reviewer is signed out.)
3. Paste the text below into the Test instructions box, then paste the password after the last line ("Password:").

## The text to paste

888 characters without the password. With the 27-character password and a space it is 916, under the 1,000 limit.
(Counted by `frontend/scripts/extension-helper.test.mjs`, which also checks every word and link below is real.)

```
Test account (made-up; nothing is ever sent from it):
Username: chrome-review@nm7.si
Password: see below

1. Install the extension.
2. Sign in at https://nm7.si/login with the email and password.
3. Open https://nm7.si/me/auto-apply/v2?tab=ready (Jobs ready). Three jobs are ready.
4. In the Nm7 Apply helper box, tap Make a pairing code.
5. Click the extension icon, paste the code under Pairing code from Nm7, tap Connect.
6. Open the practice form of a made-up company: https://nm7.si/demo/apply/cloud-portal
7. Click the extension icon, tap Fill this page. Green = filled, yellow = check, red = left for you.
8. Press the page's Next yourself, then tap Fill this step (on the page or in the extension). Repeat.
9. On the last step press Submit application. The page says: Practice form: nothing was sent.
10. Tap Mark as applied on Nm7.

The account resets at each sign-in.

Password:
```

## What the reviewer gets

- **The account:** Priya Sharma (demo), `chrome-review@nm7.si`, email and password only (no two-step login, no
  Google). It is a made-up person, marked demo: never counted, never shown to a company, never emailed.
- **Jobs ready:** always the same 3 jobs: Operations Trainee at the made-up Nimbus Freight (demo), on a multi-step
  practice form, and Customer Support Executive and Junior Data Analyst at Demo Tech Solutions, on the plain practice
  form. Each has its apply kit. Every sign-in resets them: 3 jobs ready, nothing applied, no browser paired, no saved
  helper answers.
- **The practice pages:** https://nm7.si/demo/apply/cloud-portal (four steps: My Information, My Experience with a
  work and an education block and a type-to-search school list, Application Questions with a radio choice and a
  question for a smart answer, Voluntary Disclosures with personal questions the helper always leaves red), plus
  https://nm7.si/demo/apply/customer-support-executive and https://nm7.si/demo/apply/junior-data-analyst (one page).
  Next only moves to the next step; Submit only shows "Practice form: nothing was sent." Nothing is sent or saved;
  the pages are not indexed and not in the sitemap. Eight more multi-step practice forms (one per kind of hiring
  system, all made-up companies) are listed in `frontend/src/pages/demo/practiceSystems.js`.
- **Smart answers:** on step 3, "Draft 1 answer" (in the status bar on the page) gives a practice answer from the
  demo profile, never from the AI, highlighted in purple with Use it / Edit / Discard.
- **What it can't do:** change its password or email, delete the account, pay, upload ID documents or join Ready to
  join (the server answers with a plain message). Nothing is ever sent for it: no Auto Apply email, no company form,
  no partner hiring system, no application to a company.

The cloud-portal link is the one in the steps: its kit is first in Jobs ready and its apply link is that page, so the
helper picks it by itself from the address ("Which job is this page for?").

The password can also come from the server: set `CWS_REVIEWER_PASSWORD` in Render (12+ letters and digits), then
press **Reset password** once. Admin still shows it to the Owner only.
