# Nm7 Apply helper: Chrome Web Store "Test instructions"

What to paste into the Chrome Web Store Developer Dashboard, **Test instructions** tab, so Google's reviewer can sign
in and try the helper. The rest of the listing is in [`store-listing.md`](store-listing.md).

## Before you paste

1. Sign in to Admin, open **Admin > Auto Apply** and find the card **Chrome Web Store reviewer** (near the bottom,
   under Demo student). Only the Owner sees it.
2. The first time, press **Create the reviewer account**: the password shows. Later, press **Show password**. Then
   press **Copy password**. (Each showing is in the audit log. **Reset password** makes a new one; the old one stops
   working at once and the reviewer is signed out.)
3. Paste the text below into the Test instructions box, then paste the password after the last line ("Password:").

## The text to paste

921 characters without the password. With the 27-character password and a space it is 949, under the 1,000 limit.

```
Test account (made-up; nothing is ever sent from it):
Username: chrome-review@nm7.si
Password: see below

1. Install the extension.
2. Sign in at https://nm7.si/login with the email and password.
3. Open https://nm7.si/me/auto-apply/v2?tab=ready (Auto Apply 2.0 > Jobs ready). Two jobs are ready.
4. In the Nm7 Apply helper box, tap Make a pairing code.
5. Click the extension icon, paste the code under Pairing code from Nm7 and tap Connect.
6. Open the practice form of a made-up company: https://nm7.si/demo/apply/customer-support-executive
7. Click the extension icon and tap Fill this page.
8. Check the fields: name, email, phone, city, LinkedIn, notice period, degree, resume and cover note.
9. Press Submit application. The page says: Practice form: nothing was sent.
10. Tap Mark as applied on Nm7 (in the bar at the bottom of the page, or in the extension).

The account resets each time you sign in.

Password:
```

## What the reviewer gets

- **The account:** Priya Sharma (demo), `chrome-review@nm7.si`, email and password only (no two-step login, no
  Google). It is a made-up person, marked demo: never counted, never shown to a company, never emailed.
- **Jobs ready:** always the same 2 jobs from the made-up company Demo Tech Solutions (Customer Support Executive and
  Junior Data Analyst), each with its apply kit. Every sign-in resets them: 2 jobs ready, nothing applied, no browser
  paired.
- **The practice pages:** https://nm7.si/demo/apply/customer-support-executive and
  https://nm7.si/demo/apply/junior-data-analyst. A plain form (name, email, phone, city, LinkedIn, notice period,
  degree, resume, cover note). Submit only shows "Practice form: nothing was sent." Nothing is sent or saved; the
  pages are not indexed and not in the sitemap.
- **What it can't do:** change its password or email, delete the account, pay, upload ID documents or join Ready to
  join (the server answers with a plain message). Nothing is ever sent for it: no Auto Apply email, no company form,
  no partner hiring system, no application to a company.

The Customer Support Executive link is the one in the steps: its kit is first in Jobs ready, so the helper picks it
by itself on that page ("Which job is this page for?").

The password can also come from the server: set `CWS_REVIEWER_PASSWORD` in Render (12+ letters and digits), then
press **Reset password** once. Admin still shows it to the Owner only.
