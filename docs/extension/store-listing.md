# Nm7 Apply helper: Chrome Web Store listing pack

Everything to copy into the Chrome Web Store Developer Dashboard for the Nm7 Apply helper (the extension in
`extension/`). The step-by-step guide (developer account, upload, review, updates, trying it unpacked) is in
[`docs/autoapply/chrome-web-store.md`](../autoapply/chrome-web-store.md). This page is only the text to paste and
the answers to give.

Checked against the code on 24 Nov 2026: `extension/manifest.json` version **1.0.0**, Manifest V3, permissions
`activeTab`, `scripting`, `storage`, host permission `https://nm7-api.onrender.com/*` only, icons 16 / 32 / 48 / 128
present (PNG, right sizes), content security policy `script-src 'self'; object-src 'self'`, no remote code, no
analytics. The test `frontend/scripts/extension-helper.test.mjs` checks all of this on every run.

## Store listing tab

**Name**

```
Nm7 Apply helper
```

**Summary** (the short description, at most 132 characters; this one is 103)

```
Fills a company's job application form from your Nm7 apply kit. You check it and press Submit yourself.
```

**Description**

```
Applying on a company's own careers page means typing the same details again and again. The Nm7 Apply helper fills them in for you from your Nm7 apply kit: your name, email, phone, city, links, education, notice period, a cover note and ready answers. It attaches your tailored resume PDF where the page allows it.

You stay in control:
- It fills a page only when you open the helper and tap "Fill this page".
- It never presses Submit. You check everything and press Submit yourself.
- It never signs in, never creates accounts and never asks for passwords for other sites.
- It never touches "I'm not a robot" checks.
- It leaves personal questions (like gender or date of birth) for you.
- It does nothing on job boards.

After you press Submit, tap "Mark as applied on Nm7" and your Nm7 tracker moves the job to Applied.

Your privacy:
- It works only on the page you are on, when you tap Fill. It never reads your other tabs or your browsing history.
- It keeps only a sign-in token (and which job you just submitted) on your device.
- It talks only to Nm7. No analytics, no ads, no code from the internet.
- "Sign this browser out" removes the token.

You need an Nm7 account with Auto Apply 2.0. Connect the helper with a short code from nm7.si: no password.

Works in Chrome on a computer. On Android it works only in browsers that allow extensions; the normal Chrome app on phones doesn't allow extensions.

Privacy policy: https://nm7.si/privacy#extension
Help: info@nm7.si
```

**Category:** Productivity (Workflow & planning, if the dashboard asks for a sub-category; "Tools" also fits).

**Language:** English.

**Icon:** `extension/icons/icon128.png` (128 x 128, already in the zip).

**Official URL:** https://nm7.si · **Support URL:** https://nm7.si/contact · **Support email:** info@nm7.si

### Screenshots to take (5, each 1280 x 800 PNG, no borders added)

Use a made-up candidate (the demo student) and a test company page, never a real person's details.

1. **Pairing:** the helper open with the "Pairing code from Nm7" box and a code typed in.
2. **Ready to fill:** a company's apply page with the helper open, the job chosen and "Fill this page" visible.
3. **Filled:** the same page after filling: "Filled N fields and attached your resume" and "Check everything, then
   press the company's Submit button yourself".
4. **After Submit:** the "Mark as applied on Nm7" bar at the bottom of the page.
5. **On Nm7:** the Jobs ready tab on nm7.si with the apply kit and the Nm7 Apply helper panel (where the data comes
   from, and where to sign a browser out).

## Privacy practices tab

**Single purpose** (paste)

```
Fill a job application form on a company's website with the user's own details from their Nm7 apply kit, only when the user taps Fill, and let the user mark that job as applied on Nm7.
```

**Permission justifications** (one per permission, exactly the manifest's list; no differences found)

| Permission | Justification (paste) |
| --- | --- |
| `activeTab` | Used only when the user opens the helper and taps Fill this page, to read the form on that one tab and type the user's own details into it. No access to any other tab or page. |
| `scripting` | Injects the extension's own form-filling script into that tab when the user taps Fill this page. The script is inside the package; no remote code. |
| `storage` | Keeps the pairing token from Nm7 (with its expiry date) and which job the user just submitted, on this device only, so the helper stays signed in and can offer Mark as applied. |
| Host `https://nm7-api.onrender.com/*` | The Nm7 API, the only server the helper talks to: it reads the user's own apply kits and resume and marks a job as applied in their Nm7 account. |

**Are you using remote code?** No, I am not using remote code. (All scripts are in the package; `importScripts` and
`executeScript` load only files from the package.)

**Data usage: what the helper handles**

| Data type (dashboard name) | Tick? | What and why |
| --- | --- | --- |
| Personally identifiable information | Yes | Name, email, phone, city, links, education and the resume PDF from the user's own Nm7 apply kit, typed into the form the user chose. App functionality only. |
| Authentication information | Yes | Only the Nm7 pairing token (expires after 30 days), kept in `chrome.storage.local`. Never a password. |
| Website content | No | The labels of the form on the open page are read on the device to decide which field gets which value. Nothing from the page is sent anywhere. |
| User activity | No | The helper notices a Submit on the page it filled only to offer "Mark as applied on Nm7"; nothing is sent unless the user taps it. |
| Health, financial and payment, personal communications, location, web history | No | Not collected. (The kit's city and expected salary are part of the user's own profile, typed into the form; see "For Naresh" below.) |

**Certify all three** (tick each):

- I do not sell or transfer user data to third parties, outside of the approved use cases.
- I do not use or transfer user data for purposes that are unrelated to my item's single purpose.
- I do not use or transfer user data to determine creditworthiness or for lending purposes.

**Privacy policy URL**

```
https://nm7.si/privacy#extension
```

The section there ("Nm7 Apply helper (Chrome extension)") includes the Limited Use line: "The use of information
received from Nm7 Apply helper will adhere to the Chrome Web Store User Data Policy, including the Limited Use
requirements."

## Distribution tab

Visibility **Unlisted** first (testers get the link), **Public** when Auto Apply 2.0 launches. Regions: India (or
all). Price: free.

## Make the zip

From the repository root (there is no build step; `manifest.json` must be at the top of the zip):

```sh
cd extension
zip -r ../nm7-apply-helper-1.0.0.zip . -x '.*'
```

## For Naresh to check before submitting

- The dashboard's data categories change from time to time. If it asks about **Location** or **Financial
  information**, the honest answer is that the city and the expected salary the user saved on Nm7 are typed into
  the form; tick them with "app functionality" if Google's reviewer asks.
- The privacy policy section must be live on nm7.si (this PR) before you submit.
- Small fixes made for the listing in this PR: the helper's badge after Submit now says "OK" instead of a check-mark
  symbol, and the pairing help text says "then" instead of arrow symbols (no emoji or icon symbols in the UI text).
