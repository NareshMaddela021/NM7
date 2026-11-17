# Nm7 Apply helper: putting it on the Chrome Web Store

The Nm7 Apply helper is the Chrome extension in the `extension/` folder. It fills a company's job application form
from the candidate's Nm7 apply kit. The candidate checks everything and presses Submit themselves. This page lists,
in plain words, what you (Naresh) need to do to publish it, and how to try it before that.

## What it does and doesn't do (for the listing and for review)

- The candidate connects it to Nm7 with a short pairing code made on nm7.si (Auto Apply 2.0 → Jobs ready → Nm7 Apply
  helper → Make a code). The code works once, for 10 minutes. No password is ever typed into the helper, and it never
  asks for a password for any other site.
- On a company's apply page, when the candidate taps **Fill this page**, it types the candidate's own details from
  Nm7 (name, email, phone, city, links, degree, notice period, expected salary, cover note, ready answers) into empty
  fields, and attaches the tailored resume PDF to the resume upload where the page allows it.
- It **never presses Submit** or any other button, never sends a form, never touches "I'm not a robot" checks
  (CAPTCHAs), never signs in, never creates accounts, never fills passwords, check boxes, drop-downs or personal
  questions like gender or date of birth.
- It does nothing at all on job boards (LinkedIn, Naukri, Indeed, Foundit, Glassdoor, Internshala and the others on
  Nm7's list).
- After the candidate presses Submit, it offers **Mark as applied on Nm7**, which moves the job to Applied in their
  Nm7 tracker.
- It talks only to `https://nm7.si/api/helper`. No analytics, no tracking, no code loaded from the internet.

## Where it works (say this honestly)

- **Laptop / desktop:** Chrome, and other Chrome-based browsers that use the Chrome Web Store (Edge, Brave).
- **Android:** the normal Chrome app on phones does **not** allow extensions. It works only in Chrome-based Android
  browsers that allow extensions, such as Kiwi Browser or Edge Canary, and those can change. On phones, the Jobs ready
  page on nm7.si has a copy mode (one field at a time, big Copy buttons) for everyone else.
- **iPhone:** not supported (iOS browsers don't run Chrome extensions). Copy mode on nm7.si works there.

## Before you start

1. The Auto Apply 2.0 switch must let people see the Jobs ready tab (testers while it is OFF).
2. A privacy policy page on nm7.si that covers the helper (see "Privacy policy URL" below). The store requires it.
3. Decide the version number in `extension/manifest.json` (`"version": "1.0.0"`). Every new upload needs a higher one.

## Step 1. Make a Chrome Web Store developer account (one time)

1. Go to the Chrome Web Store Developer Dashboard (search "Chrome Web Store developer dashboard"; it lives at
   chrome.google.com/webstore/devconsole).
2. Sign in with the Google account that should own the listing. Use a company account (for example one for
   nm7.si), not a personal one, so the listing doesn't depend on one person.
3. Accept the developer agreement and pay the **one-time registration fee** (USD 5 at the time of writing; Google shows
   the current amount).
4. Fill in the publisher name ("Nm7") and a contact email, and verify the email.
5. Optional but recommended: verify nm7.si as your site in Google Search Console and link it, so the listing shows
   "nm7.si" as the verified publisher.

## Step 2. Make the zip

From the repository root:

```sh
cd extension
zip -r ../nm7-apply-helper-1.0.0.zip . -x '.*'
```

The zip must have `manifest.json` at its top level (not inside an `extension/` folder). Nothing else is needed: there
is no build step.

## Step 3. Upload and fill in the listing

In the dashboard: **New item** → upload the zip. Then fill in each tab.

### Store listing

- **Name:** Nm7 Apply helper
- **Summary (up to 132 characters):** Fills a company's job application form from your Nm7 apply kit. You check it and press Submit yourself.
- **Description:**

  > Applying on a company's own careers page means typing the same details again and again. The Nm7 Apply helper
  > fills them in for you from your Nm7 apply kit: your name, email, phone, city, links, education, notice period, a
  > cover note and ready answers, and it attaches your tailored resume PDF where the page allows it.
  >
  > You stay in control:
  > • It only fills when you tap "Fill this page".
  > • It never presses Submit. You check everything and press Submit yourself.
  > • It never signs in, never creates accounts and never asks for passwords for other sites.
  > • It never touches "I'm not a robot" checks.
  > • It leaves personal questions (gender, date of birth and similar) for you.
  > • It does nothing on job boards.
  >
  > After you press Submit, tap "Mark as applied on Nm7" and your Nm7 tracker moves the job to Applied.
  >
  > You need an Nm7 account with Auto Apply 2.0. Connect the helper with a short code from nm7.si: no password.
  >
  > Works in Chrome on a computer. On Android it works only in browsers that allow extensions (such as Kiwi or Edge
  > Canary); the normal Chrome app on phones doesn't allow extensions.

- **Category:** Productivity (or "Tools").
- **Language:** English.
- **Icon:** 128 × 128 PNG: `extension/icons/icon128.png` (already in the zip).
- **Screenshots:** at least 1, up to 5. Size **1280 × 800** (or 640 × 400), PNG or JPEG, no rounded corners or
  borders added. Suggested:
  1. A company apply page with the helper open, "Fill this page" visible.
  2. The same page after filling, with the "Check everything, then press the company's Submit button yourself" note.
  3. The "Mark as applied on Nm7" bar at the bottom of the page after Submit.
  4. The pairing screen with a code.
  5. Nm7's Jobs ready tab with a kit (so people see where the data comes from).
  Use a made-up candidate (like the demo's Kavya) and a test company page, never a real person's details.
- **Small promo tile (optional):** 440 × 280 PNG/JPEG. **Marquee (optional):** 1400 × 560.
- **Official URL / homepage:** https://nm7.si
- **Support URL:** https://nm7.si/contact

### Privacy practices

- **Single purpose** (paste):

  > Fill a job application form on a company's website with the user's own details from their Nm7 apply kit, at the
  > user's request, and let the user mark the job as applied on Nm7.

- **Permission justifications** (paste one per permission):
  - `activeTab`: "Used only when the user taps Fill this page, to read the form fields on the open apply page and
    type the user's own details into them. No access to any page until the user taps."
  - `scripting`: "Injects the form-filling script into the open apply page, only when the user taps Fill this page.
    The script is part of the extension package; no remote code."
  - `storage`: "Keeps the sign-in token from pairing with Nm7 on this device, and which job the user just submitted,
    so it can offer Mark as applied."
  - Host permission `https://nm7.si/*`: "The extension's only server: reads the user's own apply kits and marks a job
    applied in their Nm7 account."
- **Remote code:** answer **No, I am not using remote code**. (All scripts are in the package; the manifest's content
  security policy is `script-src 'self'`.)
- **Data usage** — tick what it handles and what for:
  - **Personally identifiable information** (name, email, phone, city, links): yes. Purpose: app functionality (filling
    the form the user chose). It comes from the user's own Nm7 account and is typed into the page the user opened.
  - **Authentication information:** yes, only the Nm7 pairing token (kept on the device). No passwords.
  - **Website content:** the field labels of the open form are read on the device to decide what goes where. They
    are not sent anywhere.
  - Not collected: health, financial / payment, personal communications, location (beyond the city the user saved),
    web history, user activity tracking.
- Tick all three certifications: data is not sold to third parties; not used or transferred for purposes unrelated
  to the single purpose; not used to determine creditworthiness or for lending.

### Privacy policy URL

Use a page on nm7.si, for example **https://nm7.si/privacy** with a section "Nm7 Apply helper (Chrome extension)"
that says, in plain words:

- what the helper reads (the user's own apply kits from Nm7; the labels of the form on the page they chose),
- what it sends (only to nm7.si: the request for the kit, and "mark this job applied"),
- what it stores on the device (the pairing token, which expires after 30 days and can be signed out from Nm7 at any
  time; the job just submitted),
- that it sends nothing to anyone else, has no analytics, and never handles passwords for other sites,
- how to remove it (uninstall the extension, and "Sign out" next to the browser under Jobs ready → Nm7 Apply helper).

### Distribution

- **Visibility:** start with **Unlisted** (only people with the link can install), share the link with your testers,
  then switch to **Public** when Auto Apply 2.0 launches.
- **Regions:** India (or all regions).
- **Price:** free.

## Step 4. Submit for review

Press **Submit for review**. Google's review usually takes from a day to about a week (longer the first time, and
when the listing or permissions change). You get an email when it is approved or if they ask for changes. Common
reasons for a rejection, all already handled here: unused permissions, a missing privacy policy, a vague single
purpose, remote code.

After it is approved, put the store link in the Jobs ready → Nm7 Apply helper panel on nm7.si (it says "Coming to the
Chrome Web Store soon" until then; the text is in `frontend/src/pages/me/AutoApplyOneTap.jsx`, `HelperPanel`).

## Updates later

Raise `"version"` in `extension/manifest.json`, make a new zip the same way, and upload it on the item's **Package**
tab, then **Submit for review**. Adding a permission triggers a longer review and asks every user to accept it again,
so avoid that.

## Try it before publishing (load it unpacked)

1. In Chrome open `chrome://extensions`.
2. Turn on **Developer mode** (top right).
3. Click **Load unpacked** and choose the `extension/` folder of the repository.
4. Pin the "Nm7 Apply helper" icon (the puzzle piece → pin).
5. On nm7.si, signed in as a tester: Auto Apply 2.0 → **Jobs ready** → **Nm7 Apply helper** → **Make a pairing code**.
6. Click the helper icon and paste the code. It shows "Signed in as …".
7. Open one of the jobs' apply pages (the kit's **Apply now**), click the helper, choose the job, tap **Fill this
   page**. Check what it filled. Press the company's Submit only if it's a real test you want to send.
8. After Submit, the helper's icon shows ✓ and the page shows "Mark as applied on Nm7". The job moves to Applied on
   nm7.si.
9. To sign the browser out: in the helper, "Sign this browser out", or on nm7.si next to the browser in the helper
   panel.

**Against a test server instead of nm7.si:** change the address in `extension/src/config.js` and the
`host_permissions` entry in `extension/manifest.json` to the test server (for example `http://localhost:8000/*`),
load it unpacked, and change both back before making the zip. The unit test `frontend/scripts/extension-helper.test.mjs`
fails if anything other than nm7.si is left in.

**On Android (Kiwi Browser):** copy the zip to the phone, open Kiwi → menu → Extensions → Developer mode → "+ (from
.zip/.crx/.user.js)" and pick the zip. Once it's on the store, Kiwi can install from the Chrome Web Store page directly.
