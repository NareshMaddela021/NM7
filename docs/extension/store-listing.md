# Nm7 Apply helper: Chrome Web Store listing pack

Everything to copy into the Chrome Web Store Developer Dashboard for the Nm7 Apply helper (the extension in
`extension/`). The step-by-step guide (developer account, upload, review, updates, trying it unpacked) is in
[`docs/autoapply/chrome-web-store.md`](../autoapply/chrome-web-store.md). This page is only the text to paste and
the answers to give.

Checked against the code on 24 Nov 2026: `extension/manifest.json` version **1.1.0** (the first public version;
1.0.0 was never submitted), Manifest V3, required permissions `activeTab`, `scripting`, `storage`, host permission
`https://nm7-api.onrender.com/*` only, and one **optional** host permission `https://*/*` that is never granted at
install: the helper asks Chrome for one site at a time (`chrome.permissions.request`), only when a form sits in a
frame from that site. Icons 16 / 32 / 48 / 128 present (PNG, right sizes), content security policy
`script-src 'self'; object-src 'self'`, no remote code, no analytics. The tests in `frontend/scripts/extension-*.test.mjs`
check all of this on every run.

Why everything new is optional: Chrome disables an installed extension until the user accepts when an update adds a
*required* permission. Optional permissions never do that, so later versions can add sites without disabling
anyone's helper.

## Store listing tab

**Name**

```
Nm7 Apply helper
```

**Summary** (the short description, at most 132 characters; this one is 117, the same as the manifest)

```
Fills a company's job application form from your Nm7 apply kit, step by step. You check it and press Submit yourself.
```

**Description**

```
Applying on a company's own careers page means typing the same details again and again. The Nm7 Apply helper fills them in for you from your Nm7 apply kit: your name, email, phone, city, links, work and education, notice period, a cover note and ready answers. It attaches your tailored resume PDF where the page allows it.

It knows the forms of the common hiring systems companies use in India: drop-down lists, radio buttons, dates, type-to-search lists like city and college, and repeating work and education sections. On a form with several pages it remembers your job for that tab: press the page's Next yourself, then tap Fill this step.

Colours show what happened: green is filled, yellow please check, red is left for you. A small bar on the page counts them ("9 filled, 2 to check, 1 for you"); tap it to jump to the next one. Undo puts the page back as it was.

Smart answers: for a question your kit doesn't answer, tap Draft answers. Nm7 drafts one from your own profile only, never for personal questions. You use, edit or discard each draft yourself.

You stay in control:
- It fills a page only when you open the helper and tap Fill.
- It never presses Submit, Next or any other button. You check everything and press Submit yourself.
- It never signs in, never creates accounts and never asks for passwords for other sites.
- It never touches "I'm not a robot" checks.
- It leaves personal questions (like gender or date of birth) for you.
- It does nothing on job boards.

After you press Submit, tap "Mark as applied on Nm7" and your Nm7 tracker moves the job to Applied.

Your privacy:
- It works only on the page you are on, when you tap Fill. It never reads your other tabs or your browsing history.
- If a form is inside a box from another site, Chrome asks you first, for that one site only.
- It keeps only a sign-in token and small settings on your device.
- It talks only to Nm7. No analytics, no ads, no code from the internet. With each fill it sends only counts (how many fields it filled).
- "Help improve the helper" is off unless you switch it on: it then sends only the labels of fields it couldn't fill, never what you typed.
- "Sign this browser out" removes the token.

You need an Nm7 account with Auto Apply 2.0. Connect the helper with a short code from nm7.si: no password.

Works in Chrome on a computer. On Android it works only in browsers that allow extensions; the normal Chrome app on phones doesn't allow extensions.

Privacy policy: https://nm7.si/privacy#extension
Help: info@nm7.si
```

The description does not name the hiring systems (Workday, SuccessFactors, Taleo, iCIMS, Darwinbox, Keka, Greenhouse,
Lever, Zoho Recruit, SmartRecruiters), to stay clear of the store's keyword and impersonation rules. Naming them once
as a plain compatibility list is allowed; add it only if you want to (Naresh's call).

**Category:** Productivity (Workflow & planning, if the dashboard asks for a sub-category; "Tools" also fits).

**Language:** English.

**Icon:** `extension/icons/icon128.png` (128 x 128, already in the zip).

**Official URL:** https://nm7.si · **Support URL:** https://nm7.si/contact · **Support email:** info@nm7.si

### Screenshots to take (6, each 1280 x 800 PNG, no borders added)

Use the review account (made-up person) on the practice pages, never a real person's details.

1. **Pairing:** the helper open with the "Pairing code from Nm7" box and a code typed in.
2. **Ready to fill:** https://nm7.si/demo/apply/cloud-portal with the helper open, the job picked by itself and
   "Fill this page" visible.
3. **Filled, with colours:** step 1 after filling: green outlines with "Nm7: filled" badges and the status bar
   "6 filled, 0 to check, 0 for you"; the popup's summary next to it.
4. **The next step:** step 2 (My Experience) after pressing the page's Next: the bar "A new step loaded. Fill it from
   your Nm7 kit?" with Fill this step; then the work and education blocks filled, the school picked from the list.
5. **A smart answer:** step 3 with a purple draft and its Use it / Edit / Discard box, and the yellow notice period.
6. **Left for you and after Submit:** step 4 with the personal questions in red, then the "Mark as applied on Nm7"
   bar after Submit application.

Optional 7th (only if the dashboard allows more): Admin > Auto Apply > Nm7 Apply helper is internal, never a store
screenshot.

## Privacy practices tab

**Single purpose** (paste)

```
Fill a job application form on a company's website with the user's own details from their Nm7 apply kit, only when the user taps Fill, and let the user mark that job as applied on Nm7.
```

**Permission justifications** (one per permission, exactly the manifest's list; no differences found)

| Permission | Justification (paste) |
| --- | --- |
| `activeTab` | Used only when the user opens the helper and taps Fill this page or Fill this step, to read the form on that one tab (and its frames from the same site) and type the user's own details into it. No access to any other tab or page. |
| `scripting` | Injects the extension's own form-filling scripts into that tab and its frames when the user taps Fill. The scripts are inside the package; no remote code. |
| `storage` | Keeps the pairing token from Nm7 (with its expiry date), the user's helper settings, and, for the open tab only (session storage, removed when the tab closes), which job and step were filled, so the helper can offer Fill this step on the next page of the same form. |
| Host `https://nm7-api.onrender.com/*` | The Nm7 API, the only server the helper talks to: it reads the user's own apply kits and resume, drafts answers the user asks for, and marks a job as applied in their Nm7 account. |
| Optional host `https://*/*` | Never granted at install. Some company careers pages show the application form inside a frame from the hiring system's own site. Only then, and only after the user taps Allow and fill, the helper asks Chrome (chrome.permissions.request) for that one site so it can fill the form in the frame. If the user declines, it offers to open the form on its own page instead. |

**Are you using remote code?** No, I am not using remote code. (All scripts are in the package; `importScripts` and
`executeScript` load only files from the package.)

**Data usage: what the helper handles**

| Data type (dashboard name) | Tick? | What and why |
| --- | --- | --- |
| Personally identifiable information | Yes | Name, email, phone, city, links, work and education and the resume PDF from the user's own Nm7 apply kit, typed into the form the user chose. App functionality only. |
| Authentication information | Yes | Only the Nm7 pairing token (expires after 30 days), kept in `chrome.storage.local`. Never a password. |
| Website content | Yes | Smart answers: when the user taps Draft answers, the text of the questions on the form that the kit doesn't answer is sent to Nm7 to draft an answer from the user's own profile (with Anthropic, Nm7's AI provider). If the user switched on "Help improve the helper" (off by default), the labels of fields it couldn't fill, with the field type, the hiring system and the site's name (never values, never the page address, not linked to the user). App functionality only. |
| User activity | No | The helper notices a Submit on the page it filled only to offer "Mark as applied on Nm7"; nothing is sent unless the user taps it. The counts of fields filled per fill are about the form, not about the user's browsing. |
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
zip -r ../nm7-apply-helper-1.1.0.zip . -x '.*'
```

Check the zip before uploading: `unzip -l ../nm7-apply-helper-1.1.0.zip | head` must show `manifest.json` at the top
level, and the version inside must be 1.1.0 (`unzip -p ../nm7-apply-helper-1.1.0.zip manifest.json | grep version`).

## Test instructions tab

The reviewer's demo account and the text to paste are in [`test-instructions.md`](test-instructions.md) (the password
is copied from Admin > Auto Apply > Chrome Web Store reviewer).

## For Naresh to check before submitting

- The dashboard's data categories change from time to time. If it asks about **Location** or **Financial
  information**, the honest answer is that the city and the expected salary the user saved on Nm7 are typed into
  the form; tick them with "app functionality" if Google's reviewer asks.
- The privacy policy section must be live on nm7.si (this PR) before you submit.
- "Promote the helper" (Admin > Auto Apply > Nm7 Apply helper) stays OFF until the listing is approved. Then paste
  the real store link there and switch it on: Jobs ready and the morning email start showing it, and the one-time
  rating request (after a fill and Mark as applied) uses that link.
- Smart answers cost: Rs 200 a day for the site and 20 drafts a person a day by default (same Admin card).
- Small fixes made for the listing in this PR: the helper's badge after Submit now says "OK" instead of a check-mark
  symbol, and the pairing help text says "then" instead of arrow symbols (no emoji or icon symbols in the UI text).
