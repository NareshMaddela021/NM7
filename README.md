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
   with one line, *"AI is busy, here are quick suggestions"* — never an error screen. About 600 output tokens, a
   30-second timeout and one retry: roughly Rs 0.05 a generation. `backend/scripts/summary_smoke.py` runs eight
   sample notes through the real API.

Rules for both layers: nothing is invented (no numbers, companies, degrees or certificates that aren't in the resume
or the note), a sentence whose facts are missing is left out rather than printed with a blank, no *I / me / my*, no
clichés ("hardworking team player", "go-getter", …), and never an ID number, phone, email or address.

## AI features and their daily limits

Snap photos (reading resume details from photos) and the summary writer's "Write with AI" use the Claude API
(`ANTHROPIC_API_KEY` on Render; Claude Haiku 5.5, with one retry on Claude Sonnet 5.5). Every AI attempt is counted
**before** the call, failed ones included, so requests sent at the same time can't get past a limit
(`backend/app/core/ai_quota.py`, counters reset at midnight India time):

| Limit | Snap photos | Summary writer |
|---|---|---|
| per person, per day | 5 | 10 (each quick fix counts 1) |
| per kiosk link, per day (all candidates at that screen) | 300 | 600 |
| the whole site, per day | 2,000 AI calls, both features together | |

When the site-wide cap is reached, Snap photos says it is busy today and the summary writer quietly uses its free
smart templates. Admin → Dashboard → **AI usage** shows each day's calls, fallbacks, failures and refusals, and
"AI daily cap reached" when it happens. The limits are constants in code (no environment variables).

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
- These switches become paid plan features in Phase 4.

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
