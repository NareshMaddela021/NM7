# Nm7 (nm7.si)

Resume services by **AsuraaX AI** — free ATS scan, resume builder, verified expert rewrites, customer dashboard, expert workspace and admin console.

| Folder | What | Status |
|---|---|---|
| `frontend/` | React 18 + Vite app (all screens) | Built — runs on sample data |
| `backend/` | FastAPI + MongoDB Atlas (auth, orders, Razorpay, notifications) | In progress — see [`backend/PLAN.md`](backend/PLAN.md) |

## Run the frontend
```bash
cd frontend
npm install
npm run dev        # http://localhost:5173
npm run build      # production build in frontend/dist
```
Details, settings and what's left: see [`frontend/README.md`](frontend/README.md).

## Branches
- `main` — what goes live
- `dev` — work in progress; merge into `main` when tested

## Home page (nm7.si/)

Two equal pillars: **job seekers** (build a resume) and **Nm7 for Organizations** (resume drives). The ATS scan and the
expert rewrite are supporting features further down ("Make it stronger").

- **Sections:** split hero → Start from where you are → Speak it, we write it → resumes for every kind of job →
  templates → Make it stronger (line fixer, free ATS score, expert before/after) → pricing for job seekers → run your
  resume drive → kiosks → plans for organizations (from `GET /api/public/org-plans`, same table as /for-orgs) →
  partner band → FAQ (job seekers / organizations) → final call → blog.
- **Builder links:** `/builder?start=resume|linkedin|photos|scratch|templates|summary` opens that mode directly.
- **Speed:** `src/pages/Home.jsx` is only the hero and section 2; `home/HomeMore.jsx` loads just after the first
  paint, the blog cards only near the bottom. No builder, PDF or resume-preview code loads on the home page.
- **Images** are static WebP files in `frontend/public/home/` (each under 40 KB; lazy-loaded except the first hero
  image, which `index.html` preloads on the home page only). They are drawn from the real templates with invented
  sample people: after changing a template or a sample, run `node scripts/home-images/make.mjs` (and
  `scripts/home-images/og.mjs` for the link-preview image) from `frontend/`.
- **Template count** comes from `src/pages/home/templateMeta.js`, which a unit test keeps identical to the builder's
  templates, so "{n} templates" is always right.
- **Languages (phase 1):** English / తెలుగు / हिन्दी switch on the home page for the hero, "Start from where you are",
  the "Speak it" labels, the header links and the final call. Strings: `frontend/src/i18n/home.json` (a missing string
  falls back to English). The choice is kept in the browser (`localStorage nm7-lang`); the first visit follows the
  phone's language (te-IN → Telugu, hi-IN → Hindi). Noto Sans Telugu / Devanagari load only when picked.
  **The Telugu and Hindi strings NEED NATIVE REVIEW** before they are promoted.
- **Tap counters** (no third-party trackers): hero buttons, "Start from" cards, the summary-writer demo, links to
  /for-orgs and /partners, and the language switch post `{name}` to `POST /api/public/events` — no cookies, no user
  or IP stored, only a per-day count. Admin → Dashboard shows the last 7 days ("Home page taps").

## Templates page (nm7.si/templates)

- All 18 templates with a **Sample resume | My details** switch, above the grid and inside the large preview.
  Sample shows the example person. My details shows the signed-in person's own saved resume, the same one the
  builder edits. With more than one resume, a "Showing:" picker chooses which.
- Default: My details when the resume has a name, else Sample. The choice is remembered on the device
  (`nm7-template-view` in localStorage).
- Signed out, or a resume without a name: My details shows "Add your details to see them here" and
  "Start my resume".
- A builder save is announced on a same-origin `BroadcastChannel` (`nm7-resume`), so an open Templates tab shows
  the edit within about a second.
- Tapping a card opens the large preview and never makes a file. "Use this template" applies it and opens the
  builder, the way the builder applies a template (`withTemplate` in `builder/templatePick.js`): a look-only
  switch keeps the person's hidden sections, personal information, declaration and photo choices.
  "Download PDF" (own resume only) is the one button here that makes a file, through the usual account/plan check.
- In the builder, "Change template" next to the template name opens the picker on My details. Content is kept
  and the 1-page check carries on.
- Privacy: own details are drawn only in the owner's browser. The page's HTML, share image and caches never
  hold them. The API answers personal routes (`/api/me`, `/api/auth`, …) with `Cache-Control: private, no-store`.
- Speed: thumbnails are HTML, drawn only as they come on screen. No PDF code loads until Download is tapped, on
  this page or in the builder.

## The sample person is never saved

"Sai Varsha" (the example resume, `INITIAL` in `frontend/src/pages/builder/schema.js`) is only shown — in template
previews and demos. A new resume starts empty: **New blank** fills in only the account's name, email and phone, and
the Job Profile is used only when the person picks **Start from my Job Profile**. Saved resumes are completed with
`completeResume()` (empty values), never with the sample.

Older versions seeded new resumes and browser drafts from the sample, so some saved resumes still hold its values.

- **Exact values only.** `frontend/src/lib/sampleData.js` and `backend/app/maintenance/sample_data.py` use the same
  list (`backend/app/maintenance/sample_values.json`; a unit test checks it still matches the sample). A resume counts
  as holding sample data only when it has a value nobody else has (the sample LinkedIn/GitHub links, the parents
  "R. Raman"/"S. Lakshmi", the sample email, or the exact sample education/internship entry); then only fields that
  still equal the sample exactly are cleared. A real "Lakeview" college on its own is never touched.
- **Browser drafts** are cleaned once per browser on the next visit (`nm7-sample-drafts-cleared`); a draft with
  nothing of the person's own left is removed.
- **The server** strips the sample from any new resume it is sent.
- **Shared-resume lists** (admin and coordinator) show **Contains sample data** next to a resume that still has it.
- **Cleanup of saved resumes (owner only):** the `sample-scan` workflow prints a read-only dry run (count, resume
  ids, field names; never names or text) using the backup workflow's read-only `MONGODB_BACKUP_URI`. Admin →
  Settings → **Sample data cleanup**: *Check (dry run)* lists the same; *Remove sample values* clears exactly the
  listed resumes. Both are in the audit log. Resume versions (history) are not changed.

### Templates change only the look

Picking a template (builder, Change template, Edit design, /templates "Use this template") changes fonts, colours
and columns only. Which sections show, their order, titles, the photo switch and all content stay as the person set
them. When a template usually shows a section that is off (Kio: hobbies, strengths, personal information,
declaration; Formal: personal information, declaration; Portrait: a photo), the builder asks "This template usually
shows … Turn it on?" with **Turn on** / **No thanks**; nothing changes until Turn on.

### Live preview: "My resume | Sample"

Above the builder's live preview, next to Edit design / Download PDF / Word. **My resume** (the default) shows only
what the person typed: a new resume shows light grey hints ("Your name", "Your job title", "Add your first job") that
are never printed, typing shows at once, and empty sections are left out. **Sample** shows the example person in the
chosen template ("Sample: how this template looks when filled"), read-only and never saved, with **Back to my
resume**. Download PDF / Word always make the person's own resume: from Sample it switches back and says
"Downloading your resume, not the sample". With no name, download is off: "Add your name to download".

### Small QA fixes (PDFs, two tabs, file names)

- **₹ and emoji in PDFs** (builder downloads and organization exports use the same maker): ₹ is drawn with the Noto
  Sans font already shipped for Indian scripts (public/fonts, all of them have it); emoji are left out of the PDF
  (no font here can draw them).
- **The same resume in two tabs:** when the other tab saved first, this tab no longer stays on "Not saved yet —
  retrying": it asks **Use latest** (take the other copy) or **Keep mine** (save this tab's copy over it).
- **File names:** one rule for builder PDF / Word, organization exports and recruiter links (lib/fileName.js, the
  same as the server's): letters and digits stay (in any script), every other run of characters — spaces, dashes,
  en dashes, dots, emoji — becomes one underscore. `Asha – Data Analyst` → `Asha_Data_Analyst_Resume.pdf`.
- "Write it from my resume" picks the job that matches the target role first, and mentions a certificate together
  with a project when there are both.

### QR codes (join links, kiosk links)

"Download QR code (PNG)" on a group card saves `<org>_<group>_QR.png` (same file-name rule as resume files): 1024 px,
black on white with a 4-module white quiet zone, made in the browser (`lib/qr.js`) with `canvas.toBlob()` — never by
fetching a `data:` URL, which the CSP's connect-src blocks (that once made the button do nothing; a unit test now
fails if any code fetches a `data:` URL). "Download QR poster (PDF)" makes an A4 page with the QR, the group's name,
its join code and "Scan to share your resume". A new kiosk link has the same PNG download. If the browser can't make
the file, the page says: "Couldn't download the QR. Long-press or right-click the QR to save it."

### Job preferences removed (October 2026)

The Job Profile's "Job preferences" card (target roles, preferred cities, notice period, expected salary) and the
builder's "Preferences" step are gone. Experience level now sits in the Job Profile's Basics (and stays in the
builder's Personal info); ready-summary ordering, "Write it from my resume" and cover letters use the headline;
fresher-only summary cards use the experience level. Job Profile completeness and Profile strength reach 100% without
them (the step's 7 points moved to Personal info, Summary and Experience).

Old saved values are left in the database, unused, for 30 days: nothing shows, saves, prints, exports or shares them
(experts no longer see them, even with the old salary switch on). Clearing them will be a separate change with a
dry run first. The drive join form's "Preferred job / location" questions are a different thing and stay.

### Bold words in resume text

A small toolbar with a **B** button sits above every text box that prints as running text: the summary and the
descriptions of experience, projects, achievements and custom sections. Select words and tap **B** (or press
Ctrl+B / Cmd+B) to bold them; again to unbold. It works with a phone's long-press selection, and the preview shows it
at once. A bullet that is more than about 30% bold gets a tip: "Bold a few key words, like results and tools."

- Stored as `**word**` markers inside the same strings (lib/bold.js), so old resumes are unchanged and typing the
  markers by hand works too. A stray, unpaired `**` is never printed. Bold only: no italic, underline or colour.
- Pasting from Word, Google Docs or a website keeps text + bold only; on save the server also drops any other markup
  from those fields (`<b>`/`<strong>` become markers; a word like `<Button>` in a bullet stays).
- Printed bold in the preview, the PDF of all templates (Telugu, Hindi and ₹ use the bold Noto fonts), the Word file
  and the organization exports. Everything else gets the plain text: ATS score, auto summary, anything sent to AI,
  the compare view, the LinkedIn text and the org CSV. "Shorten" / "Make ATS-friendly" / the sample rewrite keep bold
  on the words that survive and drop it otherwise.

### Academic template (LaTeX look)

A 19th template, "Academic", in the style of LaTeX resumes (like Jake's resume): CMU Serif (Computer Modern, OFL,
served from our own origin), the name large and centred, phone | email | links | city on one line, uppercase
headings with a thin full-width rule, and each entry on two lines: Company (bold) · location on the right, then
Role (Employment type) · dates in italic; education and projects follow the same pattern (institution · city, degree
· dates; project name + links · dates, then the tech line). Empty parts are left out, so there is never a "()" or a
stray dash. Small round bullets sit indented under each entry; 10.5 pt, narrow margins, aims for one page.

- Look-only like every template; ATS-safe (real text, no layout tables, clickable links). Bold words work here too.
- Experience and education have a new optional Location / City field (printed by the other templates too, only when
  filled, so existing resumes look the same).
- Telugu and Hindi print with Noto Serif Telugu / Devanagari (hinted builds, public/fonts/; the rupee sign comes from
  them too, since CMU Serif has none); other Indian scripts use Noto Sans as before. Word uses Cambria (CMU Serif is
  not installed on most computers) with the same two-line layout. Font notices: public/fonts/CMU-SERIF-NOTICE.txt.

### Contact details and links: Icon + text, Text only, Icon only

One setting per resume (Design › Style details, and the Links step), kept when the template changes, followed by all
19 templates: Icon + text (the default), Text only, or Icon only (for LinkedIn, GitHub, portfolio and other links;
phone, email and city always keep their text). Resumes that never chose keep their template's look (Academic now
shows icons, small and on the text baseline, with the | separators kept). In the PDF the icons are vector shapes
(no pictures, emoji or icon fonts); each item, icon and text, is one link (tel:, mailto:, https) in the preview, the
PDF and the Word file, and the text stays real text for tracking systems.

### Relevant courses in Education

Each Education entry (builder and Job Profile) has "Relevant courses (optional)": Enter or a comma makes a chip (a
pasted comma list works too), × removes, drag (mouse or finger) or Alt+←/→ reorders, duplicates are ignored, at most
12 courses of 60 characters. Quick-add ideas from the field of study (e.g. Computer Science: Data Structures, DBMS,
Operating Systems, Computer Networks, OOP, AI/ML) are added only when tapped; B bolds a course. Stored as
`edu[].courses` (a list of strings; lib/courses.js).

- Printed under the entry, after the grade: bold "Courses:" and the comma list with a hanging indent (italic in
  Academic), in all 19 templates, the Word file and the organization PDFs; an empty list prints nothing. The label is
  set in Design › Style details (Courses / Relevant coursework / Coursework).
- Counted by the ATS score and the job match; "Write it from my resume" may mention up to 2 courses for a fresher
  without experience; resume, LinkedIn and photo imports fill it from a "Courses / Coursework" line; the organization
  CSV has one "Courses" column (semicolon-separated, switched-off entries left out).

### Long skill lists are easy to see

Each skill group is an auto-growing box (starts at 2 lines, grows to about 6, then scrolls inside, and wraps instead
of scrolling sideways); Enter types ", " and the saved value never holds a line break. Under each box: Edit as text |
Edit as chips (× removes, drag reorders, a repeated skill is flagged, e.g. "SQL appears twice"; both views save the
same text), a counter ("14 skills · about 2 lines on your resume"), a tip above 15 skills and a hint for a skill
longer than 40 characters. The same box is used for the headline, a project's tech line, a certification name, an
achievement title, languages and the Relevant courses box (builder, Job Profile and kiosk). Printing is unchanged.

### A browser draft moves into an account at most once

The resume built in a browser before signing in is added to the account once. Each import is noted in that browser
(a fingerprint of the text, kept through sign-outs, nothing personal), so the same draft is never added again after a
reload, a second tab or another sign-in; a draft identical to one of the account's resumes is not added; after one
import, a later draft in the same browser is only offered ("Is it yours?") unless the person clicked Download on it;
an empty draft, or one holding only the sample person, is never imported. Admins, experts and coordinators now keep
their own builder draft, so they never write the guest draft.

## Summary writer

On the builder's **Summary** step, in **Job Profile → Summary → About me** and in the kiosk builder, anyone can get a
resume summary in under a minute:

1. **Tell us about yourself** (optional): type or **Speak** in any language — English, Telugu, Hindi, Tamil, Kannada,
   Malayalam, Marathi or Bengali — e.g. *"Nenu inter chadivanu, 2 samvatsaralu delivery boy ga pani chesanu, driver
   job kavali"*. Speaking uses the browser's own speech recognition (free, `lib/summary/speech.js`): it keeps
   listening until **Stop** (restarting itself when the browser pauses, until 20 seconds of silence), shows the
   words being heard in grey and adds only the final ones to the note — after what was typed, never over it — with
   a timer and plain messages when the mic is blocked or nothing was heard. The language picker remembers the last
   choice and starts from the phone's own Indian locale; *English + mixed* (en-IN) usually hears Telugu or Hindi
   mixed with English best. Where the browser has no speech recognition (Firefox, some iOS browsers) the button is
   hidden and a tip points to the phone keyboard's mic, which is often more accurate anyway. Chips start the note:
   *I'm a fresher*, *I have work experience*, *Returning after a break*, *Changing my field*. The note is saved with
   the draft and **never printed** on the resume.
2. **Make my summary** (Layer A, no network, always available): three cards — **Role-first**, **Skills-first**,
   **Simple** — built from the resume's own sections (highest education, total experience, latest role, top skills,
   target role, certificates, one achievement with a number, languages) plus what the note says (education words,
   years of experience, about 150 common Indian job titles with synonyms, the role wanted). The resume wins when the
   two disagree. Tap a card to fill the summary box, then edit it. **Shorter** drops the last sentence; **Try again**
   gives the next variant. Templates and word lists are plain data: `frontend/src/lib/summary/templates.json`
   (about six templates per persona: fresher graduate, fresher school/ITI, experienced, skilled worker, career
   changer, returning after a break, unknown) and `dictionary.json`.
3. **Write with AI** (Layer B, signed in; kiosk sign-ins too): the same three cards written by Claude Haiku 5.5 from
   the facts and the note (`POST /api/me/summary/generate`, `backend/app/summary/`). "Writing… (about 5 seconds)"
   with a **Cancel** button; then **Shorter**, **More professional**, **Simpler words** and **Try again** rewrite the
   text with AI (each counts as one use). What leaves the browser is only what the templates use — education, years,
   role, company, target role, skills, strengths, certificate, achievement, languages, persona — never the name,
   phone, email, address, date of birth or an ID number; the note is wrapped as data, never as instructions. The
   server checks every option (length, no contact details or IDs, every number must be in the facts or the note) and
   the browser checks again; a dropped slot is filled by a template card marked *quick suggestion*. Haiku → Sonnet
   once → templates: when AI is off, busy, over its limit or gives nothing usable, people see the template cards
   with one line, *"AI is busy, here are quick suggestions"* — never an error screen. A 2,500-token answer budget
   with thinking switched off on Haiku (thinking tokens count toward the budget; the Sonnet retry runs with its
   default thinking), a 30-second timeout and one retry: a fraction of a rupee a generation.
   `backend/scripts/summary_smoke.py` runs eight sample notes through the real API.

Rules for both layers: nothing is invented (no numbers, companies, degrees or certificates that aren't in the resume
or the note), a sentence whose facts are missing is left out rather than printed with a blank, no *I / me / my*, no
clichés ("hardworking team player", "go-getter", …), and never an ID number, phone, email or address.

### "Write it from my resume" (no AI)

- At the top of the Summary step. The summary is built only from what the resume says:
  - target role (headline) and experience level;
  - the latest job or internship (role + company);
  - the top 3 skills, in the order added;
  - the first project, a certification, and languages;
  - the course, only when "Mention my course" is on (off by default).
- Up to 3 sentences: who they are, one proof (project, else certification, else internship), and the goal
  ("Looking for an entry-level … role."). A sentence whose facts are missing is left out.
- It never leaves an empty blank, never invents anything, and uses numbers only as typed. The usual gate applies:
  no I/me/my, no banned clichés, no contact details or ID numbers, at most 400 characters.
- Three versions to pick from: Role-first, Skills-first, Simple.
- Reaching the step with an empty summary fills it (Role-first) and labels it "Written from your resume, edit
  anything".
- If skills, role or experience change afterwards, the step asks "Your resume changed. Update the summary?" with
  Update / Keep mine. A summary the person wrote or edited is never replaced without them tapping Update.
- Code: `lib/summary/fromResume.js`. The resume stores `summaryFrom` (version, text, what it was written from) and
  `summaryCourse`.

### Profile strength

- The score comes only from the ticks: the weights of the ticked steps over the weights of the steps shown
  (`SCORE_WEIGHTS` in `builder/schema.js`, totalling 100).
- 100% means every scored step is ticked. "Review & Submit" ticks when "Submit profile & finish" passes its checks.
- Hobbies, Strengths, Personal Information, Declaration and own sections don't count and show "optional" until
  filled.

### Ready summaries for freshers ("Pick a ready summary")

- Shown on the builder's Summary step when the experience level is Fresher: 12 hand-picked summaries, each with
  its heading.
- Edit them in `frontend/src/lib/summary/summaries.json` (heading, text, tags, role keywords) without code changes.
- Order: the card whose role keywords appear in the person's headline (target role) comes first, e.g.
  "Data Analyst" → #3. Otherwise #1 is first.
- Chips: All, Tech, Data, Business, Non-technical.
- A tap fills the summary box, which stays freely editable. A tip under the panel asks people to make it their own.
- Personal touches, only where the resume has the data:
  - #11: "English and Hindi" becomes the resume's languages.
  - #3, #4, #8 and #12: the listed tools become the person's own skills, in the order added.
  - Otherwise the text is used exactly as written.
- These texts are hand-picked, so they skip the summary writer's automatic banned-phrase check.
- Headings follow the page language: **Telugu / Hindi headings — NEED NATIVE REVIEW**. The summary text stays
  English, like the resume.

## AI features and their daily limits

Snap photos (reading resume details from photos), the summary writer's "Write with AI" and the LinkedIn headlines use the Claude API
(`ANTHROPIC_API_KEY` on Render; Claude Haiku 5.5, with one retry on Claude Sonnet 5.5). Every AI attempt is counted
**before** the call, failed ones included, so requests sent at the same time can't get past a limit
(`backend/app/core/ai_quota.py`, counters reset at midnight India time):

| Limit | Snap photos | Summary writer | LinkedIn headlines |
|---|---|---|---|
| per person, per day | 5 | 10 (each quick fix counts 1) | 10 |
| per kiosk link, per day (all candidates at that screen) | 300 | 600 | 600 |
| the whole site, per day | 2,000 AI calls, all features together | | |

When the site-wide cap is reached, Snap photos says it is busy today and the summary writer quietly uses its free
smart templates (and the LinkedIn page its rules-based headlines). Admin → Dashboard → **AI usage** shows each day's calls, fallbacks (with why the first model's
answer was unusable, e.g. `too_long 2, empty 1`), failures, refusals and the summary options dropped by the server's
checks, and "AI daily cap reached" when it happens. The limits are constants in code (no environment variables).

## LinkedIn services (Phase 1, free)

Code: `frontend/src/lib/linkedin/` (checks, headlines, guide) and `backend/app/linkedin/` (`/api/me/linkedin`).

- **Never** opens linkedin.com, logs in to LinkedIn or asks for a LinkedIn password. A pasted profile link
  (`linkedin.com/in/...` only) is stored and shown, nothing more. The profile content comes from the person's
  LinkedIn PDF (Profile > More > Save to PDF, read by the same reader as the resume import) or the sections they
  paste.
- **Check** (rules, no AI): a score out of 100 — headline 20, About 20, experience 15, skills 15, education 10,
  Featured 5, photo and banner 5, custom URL 5, Open to Work 5 — with what is wrong, why and the fix per section,
  and "Keep as it is" for a section with full points. Photo, banner, Featured and Open to Work are ticked by the
  person (the PDF doesn't show them). The keyword match uses the role box, else the headline ("Data Analyst:
  missing Excel, Dashboards").
- **LinkedIn's limits**: headline 220 characters, About 2,600, each experience 2,000.
- **Headlines**: role first, 2-4 skills the person has, one proof point from their own facts; never a number,
  company, degree or certificate they didn't give, and never a phone, email or ID number. AI writes them when it
  is on (checked on the server and again in the browser); the rules write them when AI is off, busy or over the
  limit — never an error page.
- **Create**: 5 headline options and a step-by-step guide in English, Telugu and Hindi (Telugu and Hindi are marked
  NEED NATIVE REVIEW). Profile text to paste is always English.
- **Locked, "Coming soon"** (Phase 2, no checkout): the full About and experience rewrites, the complete profile
  text and the banner.
- **Data**: the link, the PDF / pasted text and the latest result are kept on the person's account only
  (`linkedin_profiles`, one per person, ID numbers removed before saving), never shared with an organization, and
  deleted with "Delete my LinkedIn data" in Profile & settings (`DELETE /api/me/linkedin`). Asking to delete the
  account deletes the LinkedIn data at once too, and "Download my data" includes it.
- **My dashboard** has a LinkedIn card: the latest score, the top 3 fixes and Re-check (the saved PDF text or pasted
  sections come back, no new upload needed), or "Create your LinkedIn" for a new profile.
- **Builder**: after a resume download, a small "Your resume is ready. Check your LinkedIn for free" prompt
  (once per browser session; × hides it).

### LinkedIn pack (Phase 2, Rs 149)

- A self-serve plan `linkedin_pack` (price and on/off in Admin → Settings & prices, like the other plans). Paid →
  the order is done at once (no expert) with its GST invoice number, like "Fix it yourself". It does not unlock
  resume downloads. **Career Launch includes it.**
- Who owns it (`backend/app/linkedin/pack.py`): a paid, not refunded `linkedin_pack` or Career Launch order, or an
  admin grant. `linkedin_packs` keeps one record per account (order, date, source); it is written when the order
  is paid and removed by a full refund, and access is always checked against the order itself.
- **While payments are off** (no Razorpay keys) nothing can be bought (`POST /api/orders` is 503) and the pack shows
  "Coming soon". To test it, an admin grants it: Admin → Customers → a customer → **Grant LinkedIn pack** (and
  "Take back"), written to the audit log (`linkedin_pack.granted` / `.revoked`). A paid pack is never taken back
  there: refund its order instead.
- `GET /api/me/linkedin/pack/status` → owned, source (order / launch / grant), price, paymentsOn, onSale.
- **Contents** (owners only, checked on the server: `GET /api/me/linkedin/pack`, `POST …/generate`,
  `POST …/regenerate`, `PUT …/edit`; 403 `pack_locked` for anyone else): 5 headlines (≤ 220), About in 3 styles
  (simple, professional, story; ≤ 2,600), each job rewritten (≤ 2,000; freshers' projects become experience-style
  entries), education lines, skills ranked for the target role (best 5 first, up to 50, plus the role's missing
  ones to add only if true), a Featured plan (projects, certificates, the Nm7 resume link), the banner text and 3
  custom URL ideas. Path 1 shows before → after and marks what is already good "Keep as it is" (never rewritten).
- Written once and saved on the account (shown as often as the person likes). AI (Haiku) writes it when on and
  within the daily limit (counted before the call, shared with the headlines: 10 a day); every AI piece is checked
  (limits, no contact details / links / ID numbers / emoji, English, no number that wasn't given) and the rules
  (`pack_rules.py`) fill in anything that fails, or everything when AI is off, busy or over the limit.
- One free regenerate per written section (headline, About, experience, education). The person's own edits are
  kept; regenerating an edited section asks first.
- **Where it shows**: /linkedin under both paths (what is in it, price, "Buy ₹149" only while payments are on, else
  "Coming soon"; owners get "Make my LinkedIn pack" and then the pack), the dashboard LinkedIn card, Upgrade &
  add-ons, and the home Pricing section. Buying uses the same Razorpay checkout as the other plans; the page unlocks
  once the server has the payment (checkout confirmation or Razorpay's webhook). A closed window or a failed payment
  never unlocks it.
- **The page** (`frontend/src/pages/linkedin/Pack.jsx`): Copy on every item, where to paste each one (English,
  తెలుగు, हिन्दी; the last two marked NEED NATIVE REVIEW), Regenerate (1 free) per written section, Edit (saved; a
  regenerate asks before replacing your changes), and the banner: 1584 × 396 PNG with the name, role and top
  skills in the resume's accent colour, drawn on a canvas and saved with `toBlob` (no `data:` URL is fetched).
- **Testing before Razorpay is live**: Admin → Customers → pick the customer → LinkedIn pack → **Grant LinkedIn
  pack**. That account (only) sees the full pack on /linkedin; "Take back" locks it again.

## Payments: Off, WhatsApp or Razorpay

Admin → Settings → Payments chooses how Nm7 takes money (`backend/app/wapay/`):

- **Off**: nothing can be bought; paid buttons show "Coming soon" and downloads stay free.
- **WhatsApp**: every paid button becomes "Buy on WhatsApp". A pending order is made first (NM7-24001, …, status
  `awaiting_payment`), then WhatsApp opens with "Hi Nm7, I want to buy <item> (Rs <price>). Order <number>." (only the
  item, price and order number in the link). Naresh shares the UPI ID in the chat (it is never stored or shown on the
  site). An Owner or Finance admin then marks it paid in Admin → Orders → WhatsApp payments (method, UTR / reference,
  amount, date; a different amount needs a reason; a UTR is used once; never twice; never a cancelled order), and
  the same `mark_paid()` as Razorpay unlocks it (pack, downloads, expert order, organization plan). Unpaid orders
  are cancelled after the hours set there (default 72). Refunds there too (method + reference; a full refund removes
  access). Every action is in the audit log.
- **Razorpay**: the checkout as before (needs the Razorpay keys on the server). If no mode has been saved yet, the old
  rule applies: Razorpay when its keys are set, else Off.
- The WhatsApp number is entered in Admin only and stored in the database (never in the code). Until business details
  (Admin → Billing settings: legal name, address, GSTIN) are set, a WhatsApp payment gets a receipt from "Nm7"
  (NM7R/…) and no GST invoice.
- Reports: money in by method (WhatsApp / Razorpay), pending / paid / cancelled, and a CSV (order, customer, item,
  amount, method, UTR, date): `GET /api/admin/whatsapp/report(.csv)`.
- In the site (`frontend/src/lib/waPay.js`): the download unlock, checkout (Expert rewrite / Career Launch), the
  LinkedIn pack, Upgrade & add-ons and an organization's Billing page all read the mode. After "Buy on WhatsApp" the
  order number and a tappable WhatsApp link are always shown (in case the app didn't open). My orders and the order
  page say "Waiting for payment confirmation", with the safety line about the UPI ID and that delivery time starts
  after payment is confirmed. Adding an add-on or upgrade to a paid order opens the chat with the order number and the
  item (`POST /api/orders/{id}/whatsapp-addon`); Nm7 adds it after payment, as before.

**Switching WhatsApp on:** Admin → Settings & prices → Payments → type the WhatsApp number (+91) → choose
**WhatsApp** → optionally the reply hours and the auto-cancel hours → **Save payments**. Confirm each payment in
Admin → WhatsApp payments → **Mark as paid**. Choose **Off** to stop taking orders.

## Codes (Admin → Codes)

Codes work at every pay step: a resume download, the Tailor / Interview / LinkedIn packs, Career Launch, the expert
rewrite, and an organization's Drive or Campus plan. Server side in `backend/app/coupons/`.

- **Types**: Free unlock (100%), Percent off (1-99%), Flat Rs off. One code per order, no stacking.
- **Free**: unlocks at once in any payment mode, no WhatsApp step; an order at Rs 0 is recorded (method `coupon`).
  A free code on a resume download unlocks *that resume* for good (PDF and Word, any number of downloads), not the
  whole account. A pack / Career Launch / organization plan unlocks exactly as a paid order does.
- **Discounts**: the price updates ("Rs 99 -> Rs 49 with SAVE50"); the WhatsApp message carries the code and the new
  price, and the admin marks it paid as usual. With Razorpay the lower amount is charged (same hook).
  Payments Off: only free codes work (a discount answers `code_needs_payment`).
- **Rules** (all on the server): codes are case- and space-insensitive and unique; status Active / Paused / Expired /
  Scheduled / Used up; total uses (or unlimited) and uses per person (per organization for org plans), both taken
  atomically, so two people can't take the last use; an order waiting for payment holds its use and gives it back
  if cancelled; "Only for" one organization or group (an org plan: that organization); 10 wrong codes an hour per
  person and per address, then a wait.
- **Orders** keep `coupon: {code, type, value, original, discount, final}` and a "Code …" discount line; the WhatsApp
  payments list, report (codes total) and CSV show it.
- **Admin** (Owner only; everyone else gets 403): list with search and filters, create (typed or made-up code),
  edit (past uses keep their record), pause / resume, delete only if never used, bulk one-time codes with a prefix
  (`DRIVE-7KQ2`) and "Who used it" (+ CSV). Every create / edit / pause / delete / use goes to the activity log.
- **Links**: `/builder?code=CAMPUS26` and `/for-orgs?code=…` fill in the code at the pay step (never used by itself).
- **Account deletion**: `coupons.service.forget_user()` keeps the use counted but drops who it was.

API: `POST /api/me/codes/apply`, `GET/POST /api/admin/coupons`, `POST …/bulk`, `PUT/DELETE …/{code}`,
`POST …/{code}/pause|resume`, `GET …/{code}/uses(.csv)`; org plans: `GET …/billing/quote?code=`,
`POST /api/org/{id}/billing/code`, and `code` on `…/checkout` / `…/whatsapp`; customer orders take `code` too.

## Job search: job match, tailored copies, cover letters, interview prep

`backend/app/jobsearch/` (API under `/api/me/jobs`). Everything is saved on the person's account only, never shared
with an organization, and deleted with `DELETE /api/me/jobs` (Settings → Delete my job-search data, and account
deletion).

- **Skills dictionary**: `jobsearch/skills.json`, about 2,100 common Indian job skills with synonyms (Power BI /
  PowerBI, JS / JavaScript, MS Excel / Excel). Everyday words (Word, Spark, Go, CA) only count when written like the
  skill. Used by every job-search feature.
- **Reading a job post** (`parse.py`): fixed rules first (title, company, location, years, education, must-have vs
  nice-to-have skills, tools, certifications, soft skills, languages, duties; Hindi-English posts too). A messy post
  (or a screenshot, `POST /api/me/jobs/read-image`) is read by Claude Haiku, and only what the post really says is
  kept (`ai.py`). Job links can't be opened: people paste the text. AI calls are counted before the call
  (`core/ai_quota.py`, feature `jobs`, 20 a day per person); with AI off or over a limit the rules' reading is used.
- **Score /100** (`score.py`): must-have skills 35, role/title 15, experience 15, nice-to-have 10, education 10,
  duties in the bullets 10, ATS basics 5. Each skill is Found (proven in a bullet, a project or a certificate), Weak
  (only listed) or Missing, with an honest next step ("Not something you've done? Leave it out.").
- **Packs** (`access.py`): the Tailor pack (Rs 49; included in the Rs 99 plan and the expert plans) and the Interview
  pack (Rs 99; included in Career Launch). Prices are in Admin → Settings & prices; buying follows the payment mode
  (Off: Coming soon; WhatsApp: a pending order). Admin → Customers can grant either pack for testing (audit log). A
  refund takes the pack away at once. Free: 3 job matches a day.
- **Tailor this resume** (`tailor.py`, Tailor pack): a COPY named "<Role> - <Company> - <date>" (the original never
  changes) and suggestions, each before → after with Accept / Skip: headline to the job title, summary for the role,
  skills reordered must-haves first, bullets with the job's words only where the work already exists, the most
  relevant projects first. Every AI line passes the fact check (`facts.py`: no number, skill, certificate, degree or
  name that isn't on the resume) or the rules version is offered instead. The copy is scored again as suggestions
  are accepted. Applications in My applications can carry the match, its score and the tailored copy.
- **Write cover letter** (`cover.py`, from the match screen): short email (80-120 words), standard (200-250) or
  formal; tones for a fresher, experienced, a career switch or returning after a break. Why this role, 2-3 proofs
  taken from the person's own bullets, projects or certificates (marked on the page), and a call to action.
  "[Hiring Manager]" stays with a reminder when the name isn't known. PDF and Word use the resume's template; copy as
  an email with a subject line; a cold email / LinkedIn message under 300 characters. AI letters pass the same fact
  check and the length check, or the rules letter is used (rules letters run a little shorter than the AI target).
  Letters are saved with the job. Free: 1 a day; unlimited with the Tailor pack.
- **Interview prep** (`interview.py`, `/me/interview/<match>`, from the match screen and My applications): 10
  questions (about you 3, the person's own projects and work 3, the job's must-have skills 3, one situation question)
  with model answers from the resume (STAR for the situation question) and "make it yours" tips; "Tell me about
  yourself" in 60 seconds and 2 minutes; weak spots with honest answers (a missing skill is never claimed); 5
  questions to ask; a company homework checklist. Missing details are left as [gaps] to fill in, never made up. AI
  answers are checked one by one (fact check, plus: a skill they don't have may only be named in an answer that says
  so). Practice mode: one question at a time, typed or spoken (Speak), with feedback on structure (STAR), a missing
  result or number, length (about 140 words a minute) and filler words, and a better version that uses only what
  they said and their resume. Progress is saved ("7 of 10 practised"). Free: the first 3 questions; the Interview
  pack unlocks the rest.
- **Fact check numbers** are compared as whole numbers ("5 years" is not backed by the "2025" in a date).

## Nm7 for Organizations (Phase 1)

Any organization — a college, coaching or training institute, job fair, skill centre, NGO, placement agency or company hiring drive — can get its people to build resumes on nm7.si. The Nm7 super-admin (the **Owner** role, with two-step login) then sees, prints and exports all of them from the admin console.

**Running a college or job-fair session**

1. **Create the group.** In the admin console, open **Organizations** (`/admin/orgs`) → **New organization** (name, type, city) → **New group**. A group is one batch, event or drive, for example "B.Tech 2026 placements".
   - The join code is made for you (e.g. `JA26`). You can type your own, e.g. `JNTUA26`.
   - Optional settings: start and end dates, a member limit, and **Members download free** (no ₹99 unlock for them).
   - Add the questions you need (roll number, branch, course, trade, preferred job, location). ID numbers such as Aadhaar or PAN are refused.
2. **Show the QR code.** Each group card shows its join link (`nm7.si/join/<CODE>`) and a QR code. Use **Download QR code (PNG)** to put it on a slide or a printed poster, or **Copy link** to send it on WhatsApp. People can also type the code in their dashboard under **My groups → Join a group**.
3. **Students join.** The link shows the organization and group. Each student:
   - ticks the consent box ("My resume will be shared with <Organization> and Nm7 for printing and placement support.");
   - creates a free account or signs in;
   - answers the group's questions;
   - picks which resume to share (or starts a new one) and builds it in the builder.

   They can change the shared resume or **Leave group** at any time from **My groups** (`/me/groups`). Once they leave, their resume disappears from the organization's view.
4. **Print.** Open **Shared resumes** (`/admin/shared-resumes`) and filter by organization, group, dates, an answer (e.g. Branch = CSE), "incomplete only" or "not printed yet". Search works on name, email or roll number. Then:
   - **View**, **PDF** or **Print** a single resume (it looks exactly like the student's template; hidden entries stay hidden);
   - tick some rows, or use everything that matches the filters, and choose:
     - **Combined PDF**: one file, ordered by roll number or name, with an optional cover page;
     - **ZIP**: one PDF per person, named `<Roll>_<Name>_Resume.pdf`;
     - **CSV**: name, email, phone, organization, group, answers, completeness, last updated, printed.

   Combined PDF and ZIP mark those resumes as printed, so **Not printed yet** finds the latecomers. These downloads are always free. Every view, download, print and export is written to the **Audit log** (bottom of the Organizations page, and in Team & audit log).

**How the bulk PDFs are made.** They are drawn in the admin's browser, with the same code members use to download their own resume, so every page matches their template. The API only hands out the data in batches of 25 and records what was printed, so a few hundred resumes never time out the Render free plan. A progress bar shows how far it has got. Keep the tab open until the file downloads. Photos are not included in organization prints.

**Privacy rules**
- Only members who gave consent and haven't left are shown.
- Disabled accounts and deleted resumes drop out at once.
- No ID numbers are stored or exported.
- Joining and exports are rate-limited.

**API**
- `GET /api/public/join/{code}`
- `GET|POST /api/me/groups…` (join, change resume, leave)
- `/api/admin/orgs…`, `/api/admin/groups/{id}`
- `/api/admin/shared-resumes…` (list, view, `export.csv`, export jobs)
- `/api/admin/org-audit`

No new environment variables are needed.

Later phases (organization logins for coordinators, dashboards and reminders, approvals, kiosk mode, branded templates, recruiter links, pricing, WhatsApp, regional languages) fit onto the same `organizations`, `org_groups` and `memberships` collections.

## Nm7 for Organizations (Phase 2)

Phase 2 lets a college, job fair or NGO run its own resume drive. Their **coordinators** sign in with their own Nm7 account at **nm7.si/org**. There they see only their organization's people. They can approve members, ask for changes, send reminders and print. Nm7 doesn't need to be involved.

**What's new**

- **Coordinator logins** (`org_staff`). The Nm7 owner invites people by email from **Organizations → (organization) → Coordinators**. Each person gets a role:
  - **Coordinator**: groups, approvals, reviews, reminders and every export.
  - **Viewer**: view and print only.

  Access covers either all of the organization's groups or only the groups you pick. The invite link:
  - is emailed through Resend;
  - works once and expires after 7 days;
  - can only be accepted by a signed-in account whose verified email matches the invited address.

  From the same panel you can resend an invite, change someone's role or groups, or remove their access. Removing someone takes effect on their very next click.
- **Server-side scoping.** Everything a coordinator calls lives under `/api/org/{orgId}/…`. On every request the server re-checks:
  - that the organization exists;
  - that this account is an active staff member of it;
  - which groups they may see.

  Anything outside that answers **404**, so a coordinator can't even learn that another organization's group or member exists. Org and group ids from the browser are always intersected with the person's access. The admin console and the portal use the same endpoints, written once (`register_shared` in `backend/app/orgs/router.py`, rules in `backend/app/orgs/scope.py`).
- **Group dashboard** (one request per group). It shows:
  - counts: joined, pending, approved, ≥ 80% complete, incomplete, needs changes, ready, printed, and ready & not printed;
  - joins per day over the last 30 days;
  - completeness buckets;
  - the incomplete members with their missing sections.

  Quick actions: *Remind incomplete*, *Print ready & not printed*, *Download CSV*.
- **Reminders** go by email only. You can remind a whole segment of a group (incomplete, needs changes, or not updated since a date) or members you've ticked. The email:
  - uses a fixed template: the organization, what's missing, a link to the builder, and the coordinator's note (plain text, at most 300 characters);
  - has a one-click **Stop reminders from this group** link.

  Limits:
  - one email per member per 24 hours;
  - three sends per group per day;
  - 500 emails per send (sent through Resend's batch API).

  The result says who was skipped and why. The audit log records the counts but never member emails.
- **Approval and review.** A group can require approval:
  - New members start as *Pending*. Coordinators approve or reject them, one at a time or in bulk.
  - Pending and rejected members are hidden from the table unless you filter for them, and are **never** exported.

  Review status per member goes *Not reviewed → Needs changes* (with a note of up to 500 characters; the member is emailed and sees the note in **My groups**) *→ Ready*. When a member actually changes their resume, the status goes back to *Not reviewed* so you can check it again. On the export bar, **Export only Ready** limits PDFs and CSV to *Ready* resumes.
- **Printed status:** **Mark not printed** (for reprints; the print count stays) and the **Ready & not printed** filter.
- **For members:** **My groups** shows each group's status (Pending / Approved / Needs changes with the note / Ready), a **Reminder emails** switch and **Leave group**.
- **Free downloads stay Nm7's call.** Coordinators can't turn on "Members download free"; the server refuses it.

No new environment variables and no new paid services: emails use the existing Resend setup.

### Coordinator guide (for the college or job-fair team)

1. **Get access.** Nm7 sends you an invite email. Open the link, then sign in or create a free Nm7 account **with the same email address**, and tap **Accept the invite**. From then on, open **nm7.si/org** (or **My groups → Open organization** in your dashboard).
2. **Set up the drive.** Under **My groups**, each group shows its join link, a **Copy link** button and a **QR code** you can download for a slide or a poster.
   - Use **Close joining** / **Open joining** to control sign-ups.
   - Coordinators with access to the whole organization can add new groups.
   - Turn on **Approve members before they're shared** if you want to check who joins.
3. **Run it.** Students scan the QR code, agree to share, answer your questions (roll number, branch…) and build their resume. Open a group's **Dashboard** to see who has joined and who is still incomplete.
4. **Approve and review.** In **Shared resumes**:
   - set **Approval → Pending**, tick the students and choose **Approve** (or **Reject**);
   - open a resume with **View**;
   - choose **Needs changes** with a short note, or **Mark ready**.
5. **Remind.** On the dashboard, choose **Remind incomplete**, or use **Remind…** in the table. Add a note such as "Bring a printout on Friday". Each student gets at most one reminder a day and can switch reminders off.
6. **Print.** Choose **Print ready & not printed** on the dashboard, or in the table tick **Export only Ready** and choose **Combined PDF** (one file, ordered by roll number, with a cover page). You can also download a **ZIP** with one PDF per student, or a **CSV**. Printed resumes are marked so that latecomers are easy to find. Use **Mark not printed** if you need to reprint.
7. **Check the log.** **Activity** lists everything done with your organization's resumes, by your team and by Nm7.
8. **Helping candidates write a summary at a kiosk.** On the kiosk builder's **Summary** step, ask the candidate to
   tap **Speak** and say, in their own language, what they studied, what work they have done and for how long, and
   what job they want; it keeps listening until they tap **Stop**, and the words are added to the box (or type it for
   them in the **Tell us about yourself** box — it is never printed; the phone keyboard's mic works too). Tap **Make
   my summary**, read the three cards out, and let them pick one. **Shorter** and **Try again** adjust it; they can
   also edit the text. Where AI is on, **Write with AI** gives a more tailored version; if it says *AI is busy*, the
   cards still work. Never type ID numbers, phone numbers or addresses into the note.

Viewers can view and print only.

**Plan limits (since Phase 4).** Your organization's plan sets how many members, groups, coordinators and kiosks it
can have. A banner shows when 80% of a limit is used or the plan is about to end. When a limit is reached, new joins,
groups, invites or kiosks are paused with *ask your Owner to upgrade* — nothing already there is removed. Plans,
payments and invoices are handled by your organization's **Owner** (Billing).

#### Running kiosks at an event (when Nm7 has switched kiosks on for you)

1. **Make a kiosk link.** Open **Kiosks** in your portal. Choose the group, a label such as "Stall 1", how long it works (end of today, tomorrow or the day after; 3 days at most) and a 4–6 digit **exit PIN**. Choose **Make kiosk link**. The link and its QR code are shown **once**, so open it on the kiosk device straight away.
2. **Set up the device.** Open the link on a tablet or laptop that's connected to a printer and tap **Start** once (the screen goes full-screen). There is no site menu on a kiosk, and leaving the kiosk screen needs the exit PIN (**Staff: exit kiosk**, at the bottom).
3. **What candidates do.**
   - They type their email and enter the 6-digit code sent to it. This signs them into their own free Nm7 account, which is created if they don't have one.
   - They agree to share and answer your questions.
   - They fill six short steps, or use **Snap photos** of their papers.
   - They tap **Print now**. **Send to my email** gives them a one-time link to keep going on their phone.
   - In a group that approves members, they show as **Pending** for you, but can still print their own copy.
4. **Privacy.** After **Finish and sign out**, or 2 minutes without a touch (with a 20-second warning), the kiosk signs out and clears everything stored in the browser. Resumes are saved in the candidates' own accounts, never on the device.
5. **Watch and stop.** The **Kiosks** list shows each kiosk as **Active now** or **Idle**, with today's sign-ins and prints. **Revoke** stops a kiosk at once and signs out whoever is using it. Every kiosk action is in **Activity** (`kiosk_create`, `kiosk_session`, `kiosk_print`, `kiosk_revoke`).

## Nm7 for Organizations (Phase 3)

Phase 3 adds tools for big events and placements. It ships in three parts, each behind a **per-organization feature switch**: `kiosk` (3A), `branding` (3B) and `recruiter_links` (3C).

**Feature switches**
- Every switch is **off** by default.
- Only the Nm7 owner can switch them, under **Admin → Organizations → (organization) → Features** (`PUT /api/admin/orgs/{id}/features`, audited as `org_features`). Coordinators can't.
- When a switch is off, the server answers 404 for that feature (staff endpoints and public links alike) and the screens hide it.
- Since Phase 4 the organization's **plan** decides them; the admin switches are overrides on top (see Phase 4).

### 3A · Kiosk mode

**Kiosk links**
- Endpoints: `POST /api/org/{org}/kiosks` (coordinators, or the owner through the portal API), `GET …/kiosks` (viewers too) and `POST …/kiosks/{id}/revoke`.
- Each link has:
  - a label;
  - an expiry at the end of a day, India time (default today; at most today plus two days);
  - a 4–6 digit exit PIN.
- Only HMAC hashes of the link token and the PIN are stored, in the `kiosks` collection.
- Revoking, or expiry, ends the link at once. Any candidate signed in on it is signed out on their next request, because kiosk sessions are checked against their kiosk.

**The kiosk screen (`/kiosk/:token`)**
- Endpoints, all under `/api/kiosk/{token}`:
  - `GET` (welcome details; also the once-a-minute heartbeat behind *Active now*)
  - `/code` (a 6-digit code by Resend: 10 minutes, 5 tries, one use)
  - `/verify` (signs in, creating the account if needed; also needs the name and the Terms box for a new account)
  - `/join` (consent + the group's questions; the same rules as a join link, so approval groups give *Pending*)
  - `/print` (logs `kiosk_print`)
  - `/send-link` (emails a one-time link, valid 24 hours: `/continue` → `POST /api/public/continue`)
  - `/exit` (checks the PIN)
- A kiosk sign-in lasts at most 45 minutes, is never extended, and is tied to that kiosk.
- An address that signed up earlier but never confirmed its email gets a fresh random password when the code proves it. This means nobody can claim someone else's email in advance.
- The builder at the kiosk is a six-step simple mode of the normal builder (same resume data and templates). It also has the existing **Snap photos** option.
- **Print now** draws the candidate's own PDF (the same PDF maker as downloads) and prints it with the browser's print dialog.

**Wiping the device**
- Finish, or 2 minutes idle with a 20-second warning, signs out and clears localStorage, sessionStorage, every IndexedDB database of the site and Cache Storage (`frontend/src/lib/kiosk.js`).

**Limits**
- Per kiosk: 600 requests, 120 codes and 200 sign-in tries an hour; 5 wrong exit PINs per 15 minutes.
- Per email address: the existing code limits (1 a minute, 5 an hour).
- Per account: 3 "continue" emails an hour.

**Rules:** the kiosk never asks for Aadhaar, PAN or bank numbers. Group questions still refuse them, and Snap photos still drops ID numbers.

**Deploys during an event (stale builds).** A tab opened before a deploy (a kiosk, the portal, the builder) still runs the old build, and the old build's lazily loaded files are gone from the new deploy. `frontend/src/lib/chunks.js` handles this in four ways:
- **Pages:** a page whose file is missing reloads once onto the new build. This is guarded to once a minute in `sessionStorage`, so it can't loop, and it also covers `vite:preloadError`.
- **Actions** (Print, Export, Download): show "Nm7 was just updated…" instead of the raw error, then reload.
- **The kiosk, signed in:** it loads its print files (PDF maker, pdf.js, fonts) as soon as someone signs in. If it does reload, it brings the candidate back to the same step, still signed in. A reload in the middle of Print finishes the print by itself afterwards.
- **The kiosk, idle on the welcome screen:** it checks every 5 minutes whether a new build is live and reloads quietly.

Vercel's own fix for this (keeping the previous deploy's files reachable, called "Skew Protection") needs a paid Vercel plan, so it is not switched on. The steps above cover the same cases.

### 3B · Branded templates

**Organization branding**
- Endpoints: `GET/PUT /api/org/{org}/branding`, `PUT/DELETE …/branding/logo`. Everyone on the team can read it; coordinators and Nm7 can change it. It needs the `branding` feature (otherwise 404) and is audited as `branding_update`.
- **Logo:** PNG, JPG or SVG, up to 300 KB, stored with the organization in MongoDB (no new storage service).
  - PNG and JPG are checked by their file signature.
  - SVGs are cleaned to plain drawing elements and attributes: no scripts, event handlers, outside links, embedded HTML, `data:` / `javascript:` values, DTDs or entities (`backend/app/orgs/branding.py`).
- **Colour:** one colour. The screen warns below 4.5:1 contrast on white.
- **Lines:** a header line and an optional footer line.
- **Base template:** one of the single-column ATS-safe templates (Fresher First, Campus, Starter, Work-first, Classic, Formal, Care).
- The portal's **Branding** tab shows a live preview on a sample resume.

**Group setting: "Print with organization template"** (off by default; needs the feature)
- When it's on, every org-side copy uses the branded template: View, PDF, Print, Combined PDF, ZIP, kiosk **Print now** and (Phase 3C) recruiter links.
- Each copy is the member's content (hidden entries still removed by the server) in the base template.
- The logo, header line and colour go in a header strip; the footer line goes at the foot of every page. Everything stays real, selectable text.
- Members' own resumes and downloads never change.
- Switching the feature off stops branding at once.

#### Setting your branding (when Nm7 has switched branding on for you)

1. Open **Branding** in your portal.
2. Upload your logo, pick your colour (if you see a contrast warning, choose a darker shade), type a header line such as "XYZ College · Placement Cell", optionally a footer line, and choose a base template. Check the live preview, then choose **Save branding**.
3. For each group that should print this way, choose **Edit** on the group, tick **Print with organization template** and choose **Save group**. Views, PDFs, combined PDFs, ZIPs and kiosk prints for that group now use your template.

### 3C · Recruiter share links

**Consent first**
- A group must have **Share with recruiters** on. This needs the `recruiter_links` feature.
- Each member chooses **"Allow <Org> to share my resume with recruiters"**, on the join page or later in **My groups**. It is never ticked for them.
- Members who joined earlier are not included until they tick it themselves.
- Only **approved** members who opted in can be on a link.
- Every recruiter request checks this again. Anyone who leaves, opts out or is rejected disappears from every link at once.

**Making a link** (`POST /api/org/{org}/recruiter-links`, from Shared resumes → **Share with a recruiter…**)
- Works on a selection or the current filters. Anyone who isn't eligible is left out, and the screen says how many.
- Settings:
  - company and label;
  - expiry (default 14 days, max 90);
  - **Allow downloads**;
  - **Include contact details** (off by default; when off, email, phone and address are hidden);
  - which group answers to show;
  - an optional 6-digit **access code**.
- The link (a 43-character token) and the code are shown once. Only their HMAC hashes are stored, in `recruiter_links`.

**Managing links:** the **Recruiter links** tab lists each link with how many candidates are still on it, views, downloads and shortlisted people, plus **Extend** (`…/{id}/extend`) and **Revoke** (`…/{id}/revoke`).

**The recruiter page `/r/:token`**
- No account needed. The page is `noindex`; the API and Vercel send `no-store`. Short `/r/<name>` addresses are still members' own resume links.
- The list shows name, chosen answers and completeness, with **View**. When downloads are allowed it also has **Download** and **Download all as one PDF**.
- PDFs are drawn in the browser by the members' PDF maker, in the organization's template when the group prints branded. Each page carries a small footer: "Shared with <Company> via Nm7 · expires <date>".
- The recruiter can tick **Interested**. The organization then sees a **Shortlisted by** filter and a **Shortlisted** column in Shared resumes.
- Expired or revoked links show "This link has expired".
- API: `GET /api/recruit/{token}`, `GET …/candidates/{id}`, `POST …/downloads`, `POST …/candidates/{id}/interest`. The access code goes in the `X-Access-Code` header.

**Limits:** per link, 600 requests an hour; per address, 300 an hour (keyed by a hash of the address); 10 wrong access codes per 15 minutes.

**Audit log:** `share_create`, `share_view`, `share_download`, `share_shortlist`, `share_extend` and `share_revoke`, with the link id. Recruiters' IP addresses are never logged.

**Data rules:** candidates appear under ids that don't reveal membership ids, ID numbers are never included, and hidden entries stay hidden.

#### Sharing with recruiters (when Nm7 has switched recruiter links on for you)

1. Edit the group and tick **Share with recruiters**. Students then see "Allow <your organization> to share my resume with recruiters" when joining and in **My groups**. Anyone who joined before has to tick it themselves.
2. In **Shared resumes**, filter or tick the students you want, then choose **Share with a recruiter…**. Fill in the company, how long the link should work, whether downloads and contact details are allowed, and which answers to show. Add an access code if you like. Choose **Make link**, then send the link to the recruiter. Send the code separately.
3. The recruiter opens the link without an account, views or downloads resumes, and ticks **Interested**. You'll see **Shortlisted by <Company>** in Shared resumes, and you can filter by it.
4. **Recruiter links** shows views, downloads and shortlists. **Extend** a link if the recruiter needs more time, or **Revoke** it to stop it at once.

## Nm7 for Organizations (Phase 4)

Phase 4 adds paid plans, GST invoices and partner referrals. **Every business value is an admin setting with a
default** (nothing is hard-coded): Admin → **Organization plans** and Admin → **Billing settings**.

### 4A · Plans and limits

**Plans** (`org_plans`, edited in Admin → Organization plans; prices exclude GST):

| Plan | Price | Members | Groups | Coordinators | Kiosk stalls | Branding · recruiter links · free downloads |
|---|---|---|---|---|---|---|
| Free | ₹0 | 50 | 1 | 1 | 0 | no |
| Drive | ₹4,999 per 60 days | 500 | 5 | 3 | 3 | yes |
| Campus | ₹24,999 per 12 months | 3,000 | unlimited | 10 | 10 | yes |
| Custom | set per organization by the admin | | | | | |

- Each save of a plan is a new **version** (old terms kept in `history`). A purchase copies the terms it was sold on into
  the order and the organization's `subscription`, so editing a plan never changes what someone already bought.
- **Subscription** (on the organization): plan, start / end (IST days, inclusive), price, discount, source (razorpay /
  offline / admin). State: **active** → **grace** (Billing settings: 7 days) → **expired** = the Free limits apply.
  Nothing is ever deleted; everything stays readable.
- **Features** (kiosk, branding, recruiter links, members download free) come from the plan. The admin's per-organization
  switches are overrides: *Follow the plan* / *Always on* / *Always off* (`PUT /api/admin/orgs/{id}/features`, `null` =
  follow the plan).
- **Limits are enforced on the server** on join (members), group create, coordinator invite and kiosk create. Over a
  limit the action answers 409 with "ask your Owner to upgrade"; nothing is removed. Nm7's own admins may go over on
  purpose (group create, invites); joins and kiosks never.
- **Banners** in the portal at 80% of a limit (setting), when the plan ends within 7 days (setting), in grace and after.
- **Reminders** (automation rule `org_plan_reminders`): emails to the Owners 14, 7 and 1 day before the end (setting),
  when grace starts and when the Free limits apply — each once, claimed before sending; a missed one isn't sent late.
- **Organizations created before Phase 4** keep working without plan limits (`limit_overrides`, flagged *legacy*) until
  the admin assigns a plan. Their old feature switches that were *on* stay on. (One-time start-up migration.)

**Owner role.** `org_staff.role = "owner"`: everything a coordinator can do, plus **Billing** and **Team** (invite /
remove coordinators and viewers within the plan's limit). Owners are made by Nm7 (invite with role Owner) or by
**Start free** on `/for-orgs` (the person who creates the organization).

**Buying a plan** (`/org/{id}/billing`):
1. The Owner fills **billing details** (legal name, address, state, optional GSTIN — format, check digit and state code are
   validated).
2. `GET /api/org/{id}/billing/quote?plan=drive` → plan price − discount (the organization's discount set by Nm7, and the
   partner discount when on) → GST on the taxable value when GST is on.
3. `POST /api/org/{id}/billing/checkout` creates an order (`orders.kind = "org"`) and a Razorpay order for the total.
4. **The plan turns on only from Razorpay's verified webhook** (`payment.captured` / `order.paid`, signature checked,
   amount checked) — or an admin-recorded offline payment. `/api/payments/verify` never activates an organization plan;
   the page waits for the webhook and updates by itself. Renewing the same plan continues from the day after it ends.
- Organization orders never appear in the Owner's personal orders and never unlock personal downloads.
- **Test mode:** checkout refuses a live Razorpay key until Admin → Billing settings → *Live payments* is on (and a
  test key once it is on).

**Admin**
- Admin → **Organization plans**: edit each plan (price, period, limits, features, on sale, shown on /for-orgs).
- Admin → **Billing settings**: supplier details (legal name, address, state, GSTIN, signatory, SAC), GST rate, grace,
  reminder days, banner thresholds, partner commission, referral cookie length, partner discount, live payments,
  *Start free* open.
- Admin → Organizations → (organization) → **Plan and billing**: assign a plan without payment (dates, price,
  discount), extend, the organization's discount %, a custom plan only it can buy, per-organization limits.
- Dashboard: organization revenue after refunds, active paid organizations, renewals due in 30 days.
- API: `/api/public/org-plans`, `POST /api/me/orgs` (Start free), `/api/org/{id}/billing…`, `/api/org/{id}/team…`,
  `/api/admin/billing/{settings,plans,summary}`, `/api/admin/orgs/{id}/billing…`.
- Audit: `billing_details`, `billing_checkout`, `plan_activated`, `plan_assign`, `plan_extend`, `plan_reminder`,
  `org_pricing`, `plan_edit`, `billing_settings`.

#### Owner guide: plan and billing

1. **Start.** On **nm7.si/for-orgs** choose **Start free**, sign in, and name your organization. You are its **Owner**,
   on the Free plan (one group of up to 50 members, one coordinator).
2. **Invite your team.** **Team** → enter an email and choose Coordinator or Viewer. Your plan sets how many you can have.
3. **Upgrade.** **Billing** → fill your billing details once (legal name, address, state, GSTIN if you have one) →
   **Upgrade** on Drive or Campus → check the total → **Pay**. The page shows *waiting for Razorpay* for a few seconds,
   then your new plan. You also get an email.
4. **Renew.** We email you 14, 7 and 1 day before the plan ends. **Renew** continues from the day after it ends. If it
   lapses, everything keeps working for 7 more days, then the Free limits apply — nothing is deleted, but new joins,
   groups, coordinators and kiosks over the Free limits wait until you renew.
5. **Bank transfer or purchase order?** Use **Talk to us** on /for-orgs; Nm7 sends a proforma invoice (with a
   Razorpay payment link if you like). Referred by an Nm7 partner? Enter their code under *Partner code* when you pay.
6. **Invoices.** **Billing → Invoices** lists every tax invoice and credit note (and proformas) — **Download PDF** any
   time. The invoice is also attached to the "plan active" email.

Coordinators and viewers see the plan banners too, with "ask your Owner to upgrade".

### 4B · Invoices, credit notes, offline payments

**Numbering** (atomic counters per Indian financial year, April–March IST; consecutive, never reused, edited or deleted;
at most 16 characters):

| Document | Format | Notes |
|---|---|---|
| Tax invoice / invoice | `NM7/26-27/0001` | the same series as resume orders (`orders.invoice_no`), allocated in the payment's own transaction |
| Credit note | `NM7CN/26-27/0001` | `NM7-CN/26-27/0001` would be 17 characters, over the GST limit of 16 |
| Proforma | `NM7PF/26-27/0001` | a request for payment, not a tax document |

- **GST off** (no supplier GSTIN in Billing settings): a plain **Invoice** — no GSTIN, SAC, place of supply or tax lines.
  **GST on**: a **Tax Invoice** with the GST rule 46 fields — supplier name, address, GSTIN, state; recipient name,
  address, GSTIN (if any) and state; number and date; place of supply; SAC; quantity, rate, discount and taxable value;
  CGST + SGST (same state) or IGST (other state) with rate and amount; total in figures and words (Indian system);
  reverse charge "No"; authorised signatory. Fields for a future IRN / acknowledgement / QR are kept (empty).
- GST is decided once, at checkout, and stored with the order (integer paise, computed once per line). Each document
  stores a **frozen JSON snapshot** and the **PDF drawn from it** (fpdf2 with HarfBuzz shaping; DejaVu Sans for ₹ and
  Latin, Noto Sans for Devanagari, Bengali, Tamil, Telugu, Kannada, Malayalam — fonts and their licences in
  `backend/app/billing/fonts/`). Editing a plan, the billing settings or the organization's details never changes an
  issued document.
- **Offline payment** (Admin → Organization → Plan and billing → *Record offline payment*): method, reference (UTR /
  cheque / PO no.), date received, amount (must equal the order total). Uses the same `mark_paid()` as Razorpay: plan on +
  tax invoice in one transaction, invoice emailed. Logged as `payment_offline`.
- **Proforma** (*Proforma invoice*): for a plan with an optional extra discount, optionally with a **Razorpay payment
  link** (valid for the days in Billing settings). When the link is paid, Razorpay's signed `payment_link.paid` webhook
  pays the order (same checks as checkout) → plan on → tax invoice. Paying the proforma by bank instead: record an offline
  payment against it; its link is cancelled. **Razorpay dashboard: add the `payment_link.paid` event to the webhook.**
- **Refunds** (*Refund* on a paid order): through the existing refund records (`refunds`, one open refund per order) —
  Razorpay refund for Razorpay payments, or an offline refund with the bank reference. Each refund issues a **credit
  note** against the original invoice (GST split in the same proportion). A full refund of the order that bought the
  current plan takes the plan back (to the plan it was renewing if that is still running, else Free); a part refund
  keeps the plan.
- Admin → **Organization invoices**: by financial year, totals, PDF download, **GSTR-1 CSV** (one line per invoice /
  credit note: B2B, B2CL, B2CS, CDNR, CDNUR; invoices issued while GST was off are marked `NOT_GST`).
- API: `/api/org/{id}/billing/invoices[/{doc}/pdf]` (the Owner's organization only),
  `/api/admin/org-invoices[?fy=&kind=&orgId=]`, `/api/admin/org-invoices/{doc}/pdf`, `/api/admin/org-invoices/gstr1.csv?fy=`,
  `POST /api/admin/orgs/{id}/billing/{proforma,offline-payment,orders/{order}/refund}`.
- Audit: `proforma_issued`, `payment_offline`, `refund.sent` / `refund.offline`, `credit_note_issued`, `plan_refunded`.

### 4C · Partner referrals

- **Apply** at **nm7.si/partners**: name, organisation, email, phone — nothing else (no PAN or bank details; those
  are asked by email before the first payout and never stored). Admin → **Partners** → *Review* → **Approve** gives a
  code like `ASX-RAVI` (editable) and emails it with the link `/for-orgs?ref=ASX-RAVI`.
- **Link and code.** Opening the link remembers the code in a first-party cookie (`nm7_ref`, HttpOnly; Billing
  settings: 90 days). The code can also be typed at checkout (*Partner code*). A wrong typed code is an error; a stale
  cookie is ignored.
- **Attribution.** An organization is tied to one partner at its **first payment** (the code on that order, recorded in
  `organizations.partner`), never later. **Self-referral is blocked**: the partner can't be the payer or an Owner /
  coordinator / viewer of the organization (by account or email). Admin → Organization → Plan and billing →
  *Partner: Change* corrects the tie (logged; commission already booked stays where it is).
- **Commission ledger** (`commissions`; Billing settings: 20% for 12 months, payable after 30 days): on every payment
  in the organization's first 12 months, `pct × taxable value` (before GST, integer paise, half-up), payable 30 days
  after the payment. A refund adds a negative entry for the matching part (by the credit note's taxable value), taken
  off the next payout. Optional partner discount for organizations (Billing settings, off by default).
- **Payouts.** Admin → Partners → partner → **Mark paid** records everything payable today with the transfer reference
  and a TDS note (`partner_payouts`). Send the money by bank first; this only records it.
- **Partner page** (**nm7.si/partner**, signed in with the approved email): code, link, referred organizations (**name
  and plan only**), commission earned / pending / payable / paid. Partners get no access to organizations, members or
  resumes.
- API: `POST /api/public/partners/apply`, `GET /api/public/partner-terms`, `POST|GET /api/public/referral`,
  `GET /api/partner`, `/api/admin/partners[/{id}[/approve|/status|/payouts]]`, `PUT /api/admin/orgs/{id}/partner`;
  checkout and quote take `refCode` / `ref`.
- Audit: `partner_apply`, `partner_approve`, `partner_status`, `partner_attributed`, `commission_earned`,
  `commission_reversed`, `commission_payout`, `org_partner_set`.

#### Before going live (Admin → Billing settings)

1. **Supplier**: GSTIN, address, state, authorised signatory, SAC code (GST invoices start the moment GSTIN and state
   are saved; until then invoices print without tax lines).
2. **Razorpay live keys** in Render (`RAZORPAY_KEY_ID`, `RAZORPAY_KEY_SECRET`, `RAZORPAY_WEBHOOK_SECRET`), then switch
   **Live payments** on. In the Razorpay dashboard the webhook needs `payment.captured`, `payment.failed`,
   `refund.processed`, `refund.failed` and `payment_link.paid`.
3. Assign plans to organizations created before Phase 4 (they have no limits until then).

## Colleges: placement dashboard, placement template, recruiter portal

### Placement dashboard (Org > Dashboard)

`backend/app/orgs/placement.py`, under `/api/org/{org_id}/placement` (staff scope: a coordinator sees only their own
organization and groups; only members who joined, consented and haven't left; rejected members aren't counted).

- **Tiles (every plan):**
  - joined (vs invited when a roll list was uploaded);
  - resumes shared (%);
  - approved / ready;
  - average ATS score with bands (< 60, 60-79, 80+);
  - LinkedIn-ready (a LinkedIn link on the resume, or the student's LinkedIn check scored 70+; only this yes / no is
    used, nothing else from the LinkedIn check);
  - printed vs ready;
  - shortlisted by recruiters.
- **Drive / Campus** (plan switch `placement_insights`, editable in Admin → Plans, or per organization in Admin →
  Organizations):
  - charts: readiness funnel, ATS bands by branch (or group), top missing items, skills cloud, weekly progress;
  - "who's missing" tabs: Not joined, Joined no resume, Low ATS, Not LinkedIn-ready, Needs changes, Not printed;
  - bulk reminder email, mark needs changes, CSV per tab;
  - roll list upload (CSV: name, roll number, branch, email).
- **ATS score** is computed on the server with the same rules as the student's ATS check (`app/orgs/ats.py`). The
  parity cases live in `backend/tests/fixtures/ats_cases.json`, checked by both pytest and vitest.
- **Roll lists** are matched to members by email or roll number each time the dashboard is read, so a late joiner
  counts at once. A roll list with an ID number (Aadhaar, PAN…) in any column is refused.
- **Activity log:** roll-list uploads and deletes, CSV downloads and reminders are written to the organization's
  Activity log.

### Demo organization

`Demo Engineering College` (`backend/app/orgs/demo.py`): two closed groups (CSE, ECE), 48 made-up students of mixed
resume quality, and a roll list of 60 (12 not joined), on the Campus plan.

- **Create or reset:**
  - Admin → Organizations → Demo organization;
  - or `python -m app.cli demo-org`;
  - `--remove` (or the Remove button) deletes it and every demo student.
- **Marked as demo:** everything has `demo: true`, and is left out of real numbers (admin customer counts, the
  customers list, paid organizations, renewals).
- **Safe:** demo students can't sign in, are never emailed (reminders skip them), and use `…@demo.nm7.invalid`
  addresses.

### Official placement template (Org > Branding)

The organization's branding (`app/orgs/branding.py`) also holds the college's official placement format, applied to
every org-side copy of a group with "Print with organization template" on:
- the view and PDF;
- the combined PDF and ZIP;
- kiosk prints;
- recruiter links.

What the format can set:
- **Drive and Campus (`branding`):**
  - logo (PNG / SVG / JPG) and colour;
  - college name and placement cell line;
  - header style: logo left with the name beside it, or logo centred;
  - footer, plus "Page n of N" on every page once a college name is set;
  - one base template out of all 19.
- **Campus (`template_rules`, editable in Admin → Plans):**
  - up to 3 allowed templates (a student's own template is used when it's allowed, else the first);
  - section order (the college's order first, then the student's other sections);
  - required sections, and CGPA required in Education;
  - allowed optional sections;
  - a page limit (1 or 2);
  - photo yes / no;
  - roll number in the header.

How it behaves:
- **Layout only** (`frontend/src/lib/placementFormat.js`): the content never changes, and a section the student
  switched off stays off (one switched on stays on).
- **Students** of the group see "Your college uses an official placement format" in My groups, with their resume in
  it and a checklist of unmet rules ("CGPA required", "Keep to 1 page", a section the format doesn't include,
  a photo that won't print).
- **Cover page:** combined PDFs and ZIPs of one college start with a cover page: logo, college name, batch, branch,
  date and count. In the ZIP it's `00_Cover.pdf`.

### Recruiter portal (Org > Recruiters)

`backend/app/orgs/recruiter_portal.py` (staff: `/api/org/{org_id}/recruiter-invites`; recruiter:
`/api/recruiter/{token}`). It upgrades recruiter links, which stay as they were.

The coordinator's invite:
- company, recruiter name and email, which groups (only groups that share with recruiters) and branches, expiry date
  (up to 120 days);
- permissions: resume PDF downloads on / off; contact details hidden, shown, or shown only after the recruiter
  shortlists that student;
- extend, revoke, and per-invite activity (sign-ins, searches, views, stage changes, downloads);
- "Show students Shortlisted by &lt;company&gt;" (an organization setting).

The recruiter (no Nm7 account):
- the emailed link plus a 6-digit code sent to the invited address (10 minutes, 5 codes a day, 8 tries per
  15 minutes), then a 12-hour session sent in the `X-Recruiter-Session` header;
- search: skills (the job match skills dictionary, with synonyms), branch, CGPA range, passing year, location
  preference, ATS score, internship, projects, certifications, languages;
- job match mode: paste a job description and every visible student gets a match score from the job match engine,
  best first;
- student cards (name, branch, CGPA, top skills, match score) with a quick view in the college format;
- the shortlist board (Shortlisted → Interview → Selected / Rejected, with notes), downloaded as a ZIP or one
  combined PDF in the college format with its cover page, or as CSV.

Safety:
- only students who ticked "Allow recruiter sharing", approved, in the groups (and branches) given; withdrawing
  consent, leaving or being rejected removes a student at once;
- invites expire; the link and codes are stored as keyed hashes; no ID numbers anywhere; contact details (and the
  Personal Information section and photo) only when allowed;
- every view and download is in the organization's Activity log (without IP addresses); downloads are rate-limited
  (20 an hour, 60 a day per invite).

Plans: recruiter invites come with recruiter links (Drive and Campus). Active invites: 1 on Drive, unlimited on Campus
(the `recruiters` limit). Job match mode is Campus only (`recruiter_job_match`). Both are editable in Admin → Plans.

The demo organization has a recruiter invite from "Demo Tech Pvt Ltd (demo)" with six students on its board. Admin →
Organizations → Demo organization → **Reset and open as a recruiter** signs the admin straight in to it (the code
email would go to a made-up address).

## Student tools

### Check before download (free)
Every resume / cover letter download from the builder, My resumes and Templates first opens **Check before you
download** (`components/PrintCheck.jsx`, opened by `exportFile` in `lib/downloads.js`): the exact print preview —
the very PDF that is saved, drawn page by page with pdf.js on white paper whatever the site theme — and a checklist
(`lib/printCheck.js`): page count vs target (a college's page limit, else 1 page under 3 years of work, else 2), text
running off the page edge, sections with a heading and nothing under it, missing name / phone / email, links that
aren't web addresses or aren't clickable in the PDF, bullets over 35 words, photo switched on without a photo, and the
college format rules when the student is in a group with one. **Download anyway** is always there. Shared-link and
organization copies skip the check. The PDF and Word files are the same in light and dark mode (e2e
`print-check.spec.mjs` compares them).

### Version compare (free)
My resumes → **Versions**: pick any two versions (or a version and the current resume) and see the changes side by
side, section by section — added lines green, removed red, changed lines with the changed words marked
(`lib/versionDiff.js`). Template and design changes are listed separately. **Restore this version** works as before.
On a phone the two sides stack (older line above newer).

### Fresher project helper (free: 3 AI uses a day, then rules)
Builder → Projects → **Make this project stronger**: six short questions (what you built, tools, your part, team
size, what it does, a real result or number — optional), typed or spoken in any language. 2-4 bullets come back
(action + tools + result) written only from the answers, shown before → after with **Accept / Edit / Skip**.
`POST /api/me/projects/strengthen` (`app/projects/`): Claude Haiku while today's 3 free AI uses last (core/ai_quota.py
"projects"), each bullet fact-checked — a number, a tool (the skills dictionary) or a claim word (users, award,
accuracy, deployed …) that isn't in the answers drops it; with fewer than 2 left, or after the 3 uses, or with AI off,
rules write the bullets from the answers' own words. Never an error page. No number in the answers → no number in the
bullets and a tip: "Add a number if you have one (users, accuracy, time saved)".
### Resume health alerts (free, opt-out)
My dashboard shows a **Resume health** card (`pages/me/HealthCard.jsx`, `GET /api/me/health`, rules in
`backend/app/health/alerts.py`): not updated in 90 days, ATS score under 60, no LinkedIn link, a saved job match never
tailored, a new job in the profile that isn't on the resume, an empty Certifications section, and "currently
studying" after the course end year. Each alert has one button that opens the exact builder section (or the job
match) and a ✕ that dismisses it for good. A daily batch (inside the 10-minute automation pass, once per day under a
lock) emails verified users at most once every 14 days, skips bounced addresses, and every email has a **Stop these
emails** link (`/stop-alerts`, signed token, no login). Profile → Settings has the same switch. Alert data is deleted
with the account (`backend/app/me/erase.py`).

### Skill gap courses (free)
After a job match, the result shows **"N of M must-have skills missing"** with up to 3 free learning links per
missing skill (`pages/me/SkillGap.jsx`, `GET /api/me/courses`). The list lives in **Admin → Courses** (Owner;
`backend/app/courses/`), first filled from well-known free sources (Kaggle Learn, freeCodeCamp, Microsoft Learn,
Google, official docs, GCFGlobal, Khan Academy…); when no course fits, NPTEL and SWAYAM are suggested to search.
Only free, active courses are shown, and a link with tracking or affiliate parts (utm_, ref, aff…) is refused. **I
learned this** never adds the skill to the resume: it asks for a project or a certificate that proves it.

### Certificate wallet (free)
Profile → **Certificates** (`pages/me/MeCertificates.jsx`, `backend/app/certs/`): upload a PDF, JPG or PNG (up to
10 per student, 2 MB each; photos are shrunk in the browser to about 150–400 KB) with title, issuer, date and an
optional credential link. A clear warning says not to upload Aadhaar, PAN or other ID documents; titles or file
names that look like ID documents are refused and ID numbers are removed. **Add to resume** puts it in the resume's
Certifications in one tap. Files are stored in MongoDB next to their details (like organization logos and invoice
PDFs); a site-wide cap (300 MB) pauses uploads before the database plan fills up. Only the owner can open a file —
unless they switch on **Share certificates** (off by default) and tick certificates: then the college staff who see
their shared resume and the recruiters invited to see it (recruiter portal and recruiter links) can open just those.
Files are sent with `nosniff`, a sandboxing CSP and `no-store`. Deleted with the account (`backend/app/me/erase.py`).
### Mock interview by voice (Interview pack; the first 3 questions stay free)
Interview prep → **Practise** (`pages/me/MeInterview.jsx`): **Read aloud** speaks the question with the browser's own
voice (`lib/readAloud.js`; English (India) by default, Telugu or Hindi when the device has that voice, otherwise the
text stays on screen with a note), and the student answers with **Speak** in their chosen language or by typing.
**Clarity feedback** (`backend/app/jobsearch/interview.py`) covers length, speaking pace in words a minute (only for
spoken answers), filler words, structure and a clear result. The better version uses only facts from the
student's own answer and resume. Nothing about emotions or confidence is read from the voice, and the screen says so.
Progress is saved per question. If the microphone is blocked, the page says how to allow it and typing still works.

## College features

Seven switches in **Admin → Plans** (and per organization in Admin → Organizations → Features), on by default as
below. A switched-off feature doesn't exist for that organization (404). Every staff action is in the organization's
**Activity** log; coordinators see only their own organization (and groups); students appear only after joining
with consent.

| Feature | Free | Drive | Campus |
|---|---|---|---|
| Drive days + QR check-in | – | ✓ | ✓ |
| Eligibility filters | – | ✓ | ✓ |
| Offer tracking + placement report | – | ✓ | ✓ |
| WhatsApp / SMS reminder links | – | ✓ | ✓ |
| Alumni network | – | – | ✓ |
| Faculty reviewers | – | ✓ | ✓ |
| Multiple campuses | – | – | ✓ |

### Drive days and QR check-in
Org → **Drives** (`backend/app/college/drives.py`, `pages/org/Drives.jsx`): a drive day has companies, time slots,
rooms and rounds (test / group discussion / interview) for chosen groups. **Auto-assign** spreads each company-and-
round's students over its rooms in roll-number order (or pick students per slot). Each slot's **Check-in QR** opens a
full-screen room screen (a laptop, projector or kiosk tablet) with a QR and a 6-digit code that change every minute.
Students see **My drive day** (`/me/drive`, also linked from My groups) and check in from their own account by
scanning (phone camera, or the in-page camera where the browser reads QR codes) or typing the code — only for a slot
they are in, on the day, from an hour before it starts until it ends. No location tracking. Coordinators see live
attendance (present, late after 10 minutes, absent after the slot, not yet), can mark present by hand, and download
a CSV. The demo organization has a drive day for today.

### Eligibility filters per company
On a drive day, each company's **Eligibility** (`backend/app/college/eligibility.py`, `pages/org/Eligibility.jsx`)
sets rules on marks only: CGPA at least, active backlogs at most, branch, passing year, 10th / 12th % at least
(optional). There are no rules on gender, religion, caste or any other personal attribute. Students fill in **My
marks for placements** under My groups (self-declared); a coordinator can tick them verified, and changing a number
clears the tick. The list is built automatically with the reason a student isn't eligible ("CGPA 6.4 < 7.0");
coordinators can add an exception with a note. The company's drive slots take students from this list, and **Share**
makes it what a recruiter invite shows — still only students who allowed recruiter sharing.

### Offer tracking
Org → **Offers** (`backend/app/college/offers.py`, `pages/org/Offers.jsx`): record each offer — student, company,
role, CTC (LPA), type (full-time / internship / PPO), date, status (offered / accepted / declined / joined). A student
a recruiter marked **Selected** on the shortlist board shows up ready to pre-fill. The placement dashboard shows placed
vs not placed by branch and batch (placed = a full-time or PPO offer that wasn't declined), highest / median / average
package, offers per company and students with more than one offer, with a CSV and a printable placement report (PDF).
Packages are visible only to the college's coordinators and Owner; each student sees their own offers (My groups);
recruiters and other students never see them. Offers are deleted with the student's account.

### WhatsApp / SMS reminders (free links)
No WhatsApp Business API or SMS gateway (both paid, both need keys). From any **who's missing** list (placement
dashboard) or a drive slot's absent / not-yet list, **WhatsApp / SMS** makes a batch (`backend/app/college/
reminders.py`, `pages/org/WaReminders.jsx`): a ready message (only `{name}` — the first name — is filled in), and per
student a one-tap **Send on WhatsApp** link (`https://wa.me/<number>?text=<message>`) that opens the coordinator's own
WhatsApp, or on phones an **SMS** link (`sms:`). Tick each sent: "18 of 40 sent". **Phone list (CSV)** is for a
WhatsApp Business broadcast list. Only students who gave a mobile number and didn't switch reminders off are
included. `Gateway` / `DisabledGateway` is the (disabled) interface a paid provider can be plugged into later. Email
reminders work as before.

### Alumni network (Campus)
Students of a past batch (their group has ended, or their passing year is past) — or anyone a coordinator invited by
email — opt in at **Alumni network** (`/me/alumni`, linked from My groups; `backend/app/college/alumni.py`) with
company, role, city, batch and whether they're open to referrals / mentoring. Current students of the same college
browse them and send a request with a short note (5 a week); the alumnus is emailed and replies inside Nm7. Nm7
never shows an email address or phone number — an alumnus may write contact details in a reply if they choose.
Alumni can pause or leave at any time. Org → **Alumni**: invite by email and see counts only, never the messages.
Alumni profiles and requests are deleted with the account. The demo organization has four made-up alumni.

### Faculty reviewers
Org → **Reviewers** (`backend/app/college/reviews.py`, `pages/org/Reviewers.jsx`): coordinators invite faculty mentors
by email (a new staff role, **Reviewer**, not counted against the coordinator limit) and assign students to each. A
reviewer signs in with their own account and works at **/review/{org}**: only their assigned students, each one's
shared resume in the college format, comments on a section (optionally quoting a line), and **Needs changes** /
**Approve** — the same review status coordinators already see (needs changes / ready). Every other organization page
answers 404 for a reviewer. Students see open comments in the builder above the section they're about and mark them
resolved. Comments are deleted with the student's account. The demo organization has a reviewer with six students.

### Multiple campuses (college groups)
Admin → **College groups** (`backend/app/college/campuses.py`): a parent group owning several campus organizations,
with owners (existing Nm7 accounts) and, if agreed, a group price recorded for billing (each campus otherwise keeps
its own Campus plan; the admin applies a group price to each campus as a custom plan). Owners open
**/college-group/{id}** (linked from My groups): joined, ready, placed, offers and packages by campus and in total —
numbers only, never a student's details. They can apply one campus's college format (logo, header, colours,
placement-template rules) to every campus, and share a drive day's schedule or a recruiter invite with other campuses
(each campus gets its own copy; the recruiter gets its own emailed link). Campus coordinators still see only their own
campus. Only campuses with the `multiCampus` switch (Campus plan) count. The demo organization is in a demo college
group — add your own email as its owner to see the roll-up.

## Growth: sharing, referral rewards, placement report, ownership transfer

**Share on WhatsApp and the short link.** My resumes, the builder's Done step, Share link and job match have a
"Share on WhatsApp" button: a wa.me link with a short message and the resume link, nothing else (no phone, email or
other details). The public resume link stays opt-in: when it is off, the button explains it and turns it on (hide
phone and hide email are ticked by default). Turning the link on makes a 6-character short link `nm7.si/r/<code>` (no
0/o or 1/l/i), which opens the same resume as the named link; Share link has a QR PNG of the short link. Public
links never show ID numbers, are `noindex`, count views for the owner only, and stop when turned off. A link name
can't take someone's short code.

**Referral rewards.** Help & referral shows the invite link and "2 of 3". A friend counts once they sign up with the
link, confirm their email and build a resume with their name. Friends signing up from the inviter's own browser or
network, or with throwaway email addresses, don't count (worked out at sign-up; no address is stored). When enough
friends count, the inviter's downloads unlock free: the same account-wide unlock as paying for the resume plan, with
no order or invoice. One reward per account. Admin → Settings: on/off and the number (default 3), the rewards given,
and Revoke (the downloads lock again; the reward isn't given again).

**Placement report PDF** (Drive and Campus). Org → Drives: "Placement report for the year" (academic year June–May)
and "Drive report (PDF)" on each drive day. Numbers only, by branch and by company: joined, ready, shortlisted,
selected, offers, placed, attendance for a drive, and packages when offer tracking is on. The college's logo, colour
and header line and the date are on top. It says it helps with NAAC / NIRF and management reports and is not an
official NAAC or NIRF format. No student names or contact details.

**Transfer ownership.** Org → Team → Transfer ownership (the Owner) or Admin → Organizations → the organization →
Transfer ownership (Nm7's admin, on the Owner's request). Send to a coordinator or any email address and choose
whether the old Owner stays as a coordinator or leaves. The new owner gets a 6-digit code by email and enters it at
`/org/transfer`, signed in with that address (48 hours, 5 tries; only a hash is stored). My organizations shows a
waiting transfer. Billing belongs to the organization, so the plan, invoices and payment reminders follow the Owner.
Start, cancel and done are in the Activity log.

**Demo college as its coordinator.** Admin → Organizations → Demo organization → **Reset and open as coordinator**
resets the demo college and signs that browser in as its made-up coordinator, with no email code (a one-time link,
5 minutes, only a hash stored). The session lasts 3 hours and reaches only the demo college's portal and its demo
college group: real organizations, resumes, orders, payments and the admin console answer 403. It replaces the admin
session in that browser, so use a private window to keep both. A yellow **Demo** banner shows on every portal page,
with "Sign out of the demo".

## Trust and operations

**Delete my account.** Profile & settings → Delete account lists what is removed, emails a 6-digit code and, once
it is entered, schedules the erase for 7 days later. The public resume link stops at once; Undo (same place) keeps
the account. After 7 days the automation pass erases everything personal (`backend/app/me/erase.py`: resumes and
their versions, cover letters, applications, ATS checks, certificates, health alerts, job posts and interview data,
LinkedIn data, group memberships with their check-ins, reminder rows and shortlists, offers, alumni profile and
requests, reviewer comments, stories, referral rewards, public links, code-use names, sessions). Paid orders and
invoices are kept for GST, no longer linked to the person (the invoice keeps a business's legal name only when it
has a GSTIN). The account becomes a tombstone, so the email address can sign up again. Organization Owners transfer
ownership first. Admin → Customers & support → Deletion requests lists them (name and email only while open).

**Status page and uptime alerts.** `nm7.si/status` shows whether the website, the API (and its database) and email
are working, as states only, refreshed every minute (footer link "Status"). `/health` on the API answers GET and
HEAD for uptime monitors. Setup steps for a free UptimeRobot or Better Stack account with phone push alerts are in
[docs/uptime-monitoring.md](docs/uptime-monitoring.md); a 5-minute check also keeps the free Render server awake.

**Admin daily summary.** At 8:00 IST the automation pass emails the Owner admins yesterday's numbers: new users,
resumes started, paid orders and revenue, codes used, new organizations and server errors (unexpected errors are
counted per day). Admin → Dashboard has a "Today so far" card with the same numbers and a Share to WhatsApp button
(wa.me with the text; automatic WhatsApp sending would need a paid API). Admin → Settings → Daily summary turns the
email off.

**Student stories.** Help & referral → Share your story: a short story (40–700 characters), the name to show, an
optional photo (PNG/JPG up to 300 KB), company and role, and a consent tick for public use. Stories can't hold phone
numbers, emails or ID numbers. Admin → Stories approves (typo fixes only: a bigger change is refused and the
original is kept) or doesn't use it; "Take down" removes an approved one. Approved stories show on the home page and
/for-orgs — nothing shows until there are real ones. The student can withdraw a story at any time and it is deleted.
The demo college's two stories are marked demo and never public.

**Accessibility.** We aim for WCAG 2.1 AA; the statement is at `nm7.si/accessibility` (footer link). Every dialog
closes with Escape, keeps focus inside and returns it to the opener; focus is always visible. `e2e-live/a11y.spec.mjs`
runs axe (WCAG 2.1 A and AA rules) on the public pages, a student's dashboard, a coordinator's portal and the admin
console, in light and dark, on desktop and a 390 px phone; serious and critical problems fail CI. It also checks
that the public pages don't scroll sideways at 390 px with 200% zoom.
