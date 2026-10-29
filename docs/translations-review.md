# Telugu and Hindi: native review

The main public pages can be read in English, Telugu or Hindi: the home page (with its pricing and FAQ),
`/for-orgs`, the first step of the builder (`/builder`) and sign-in (`/login`). English stays the default; the
language switch (English · తెలుగు · हिन्दी) is at the top of each of these pages and the choice is remembered in the
browser. Legal pages (terms, privacy, refund, delivery, expert terms), the dashboards and the rest of the builder are
English only.

**Every Telugu and Hindi string is an AI draft until a native speaker has reviewed it.** Treat the translated pages
as drafts until then.

## The list to send

`docs/translations-review.csv` has one row per string:

| column  | what it is |
|---------|------------|
| key     | the string's name in the code — do not change it |
| page    | where the string appears |
| English | the original |
| Telugu  | the AI draft |
| Hindi   | the AI draft |
| status  | `needs native review` for every row |

It opens in Excel, Google Sheets or LibreOffice (UTF-8; Telugu and Hindi show correctly).

## What the reviewer does

1. Open the CSV in a spreadsheet. Read each Telugu (or Hindi) draft next to the English.
2. Where a draft is wrong, unclear or unnatural, write the corrected text in a **new column** at the end
   (`Telugu fix` or `Hindi fix`). Leave the draft columns as they are, and leave the fix empty when the draft is fine.
3. Keep these as they are: words in `{curly braces}` (the site fills in a number, price or link there), the `*stars*`
   around a word (they mark the highlighted word — move them if the word order changes), brand names (Nm7, LinkedIn,
   WhatsApp, Razorpay) and short forms such as ATS, PDF, GST, UPI.
4. Write simply, for students and first-time job seekers. Do not add promises or facts the English does not make.
5. Send the file back.

## After the review

1. Copy each fix into `frontend/src/i18n/home.json` or `frontend/src/i18n/pages.json` (same key, under `te` or
   `hi`).
2. Run `cd frontend && npm run i18n:review` to regenerate the CSV, then `npx vitest run src/lib/i18n.test.js`
   (it fails if the CSV is out of date, a draft is missing, or a `{value}` was dropped).
3. When a language has been fully reviewed, update the `_note` in both JSON files and the `STATUS` in
   `frontend/scripts/i18n-review.mjs` (and the test that expects it), so the list shows what is still open.
