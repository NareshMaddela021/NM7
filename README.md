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

Viewers can view and print only.
