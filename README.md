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
