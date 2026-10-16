# Nm7 Resume Services (nm7.si)

> Brand: **Nm7** · domain **nm7.si** · support **info@nm7.si** · company **AsuraaX AI**. Brand settings live in `src/lib/brand.js`, `src/lib/legal.js` and `index.html`. Renamed from asuraa.in on 14 Oct 2026 — a backup of the old version is in `BACKUP-asuraa-in-before-NM7-2026-10-14.zip`.


The full Resume Services system for Nm7, as a working React website.
Every screen works today with **sample data**. The backend (FastAPI, Razorpay, AI) gets connected later through **one file**.

---

## What's inside

| Page | Address | What it does |
|---|---|---|
| Home | `/` | Free scan upload (drag & drop), what we check, pricing, FAQ |
| Scan & report | `/scan` | Scanning animation → marked-up resume, score, “Fix with AI”, **6-second view** |
| Checkout | `/checkout` | Expert rewrite ₹999 or Career Launch ₹2,999, UPI / card via Razorpay |
| Order tracking | `/orders/RS-1051` | Timeline + “answer 4 questions” next step |
| Intake | `/orders/RS-1051/intake` | The 4 questions for the expert |
| Refund | `/orders/RS-1051/refund` | Reason → confirm → refund approved (3–5 business days) |
| Editor | `/editor` | Fix an existing resume line by line with AI (₹99 export) |
| Resume builder | `/builder` | Your 12 sections + add any custom section, photo, live preview |
| Expert workspace | `/expert` | Orders, original vs draft, quality checklist, chat |
| Expert earnings | `/expert/earnings` | 15% + GST + transaction charges, withdraw anytime |
| Admin queue | `/admin` | Orders sorted by 48-hour deadline, assign experts |

Light and dark mode, phone-friendly, keyboard accessible.

---

## Run it on your computer

You need **Node.js 18 or newer** (download from nodejs.org).

```bash
npm install
npm run dev
```

Open the link it prints (usually http://localhost:5173).

## Put it online (Render, free)

1. Push this folder to a GitHub repo.
2. On render.com → **New → Static Site** → pick the repo.
3. Build command: `npm install && npm run build` · Publish directory: `dist`
4. Under **Redirects/Rewrites** add: Source `/*` → Destination `/index.html` → Action **Rewrite**
   (this `render.yaml` already includes it if you use Blueprints).

You can point a subdomain like `resume.Nm7` at it.

---

## Where to change things

| To change… | Edit this file |
|---|---|
| Prices, delivery time, refund days, fees (15% + GST + 2%), TDS | `src/lib/pricing.js` |
| Colours and fonts (light + dark) | `src/styles/tokens.css` |
| Builder sections, fields, dropdown lists, preset sections | `src/pages/builder/schema.js` |
| Sample data | `src/data/mock.js` |
| **Connecting the real backend** | `src/services/api.js` |

### Connecting to the backend

The app has two modes:

- **Live** — `VITE_API_BASE` is set (e.g. `https://api.nm7.si`, or `http://localhost:8000` with the backend running locally).
  Sign-up / sign-in / email codes / password reset / admin two-step login (`src/lib/auth.js`), checkout through
  **Razorpay's own window**, and refund requests (`src/services/api.js`) go to the FastAPI backend in `../backend`.
- **Preview** — `VITE_API_BASE` is not set. Everything runs in the browser on sample data (every code is `246810`).

`src/services/http.js` is the only place that calls `fetch`. Still on sample data in both modes (their backend comes
later): resume scan, intake answers, expert area, the admin console screens, and the customer dashboard's own copy of
orders (checkout writes the server's order id, invoice number and payment id into it).

## Still to fill in

- TDS rate → `FEES.tdsPct` in `src/lib/pricing.js` (after your CA confirms)
- Razorpay transaction % → `FEES.txPct` (currently 2%, check your plan)
- Real expert / customer names (come from the backend)

## Import LinkedIn / Rebuild old resume
- Code: `src/lib/import/` (readers) and `src/pages/builder/Import.jsx` (upload → reading → review screens).
- `linkedin.js` reads LinkedIn's "Save to PDF" profile by position and font size; `resume.js` reads any resume (PDF, Word, pasted text).
- Section names it understands are in `vocab.js` — add new ones there (e.g. another way people write "Education").
- Scanned/photo resumes need OCR on the server later (see `parseResumeOnServer` in `src/services/api.js`).

## Templates, cover letter, Word download
- 17 templates live in `src/pages/builder/design.js` (`TEMPLATE_PRESETS`): look + tags for the filters (level, industry, photo).
- Templates that change section order or names use a layout in `schema.js` (`SECTION_LAYOUTS`), e.g. Stack puts Skills first.
- Template screen with filters and colour swatches: `src/pages/builder/TemplatePicker.jsx`.
- Cover letter: `CoverPanel.jsx` (editor) and `cover.js` (draft from profile + job-description match). Swap `draftCover` for your AI endpoint later.
- Word download: `resumeDocx.js` (one column, Calibri/Cambria so it opens the same on any computer).

## Link logos
- Brand logos: `src/pages/builder/brands.js` (from Simple Icons, CC0). Line icons + URL detection: `icons.js`.
- Add a platform: copy its path/hex from the `simple-icons` package into brands.js and add the host to `HOSTS` in icons.js.
- Design › Style details › Logo colour: brand colours or one colour.

## Expert profile (join as an expert)
- Screen: `src/pages/expert/Profile.jsx` (route `/expert/profile`); admin review: `src/pages/admin/Experts.jsx` (`/admin/experts`).
- Fields, checks, strength and auto-fill: `src/lib/expert.js`.
- Fill from asuraa.ai: needs two endpoints on asuraa.ai (public profile + email code), called from the Nm7 backend — see `getAsuraaAiProfile` in `src/services/api.js`. The preview uses sample data for asuraa.ai/nareshmaddela and asuraa.ai/saivarsha (code 246810).
- Fill from a document reuses the resume/LinkedIn readers in `src/lib/import/`.

## Admin console (`/admin`)
- **Live site** (`VITE_API_BASE` set): `src/pages/admin/live/` — every page reads `/api/admin/*`, shows real empty states,
  and every action (assign, approve expert, refund decision, prices, rules, team) goes through the API and the audit log.
- **Preview build**: the sample console below (sample data never ships in a live build).
- Layout & navigation: `src/pages/admin/AdminLayout.jsx` (sidebar, Ctrl+K search, date range, alerts, role preview).
- Shared state + actions + audit log: `AdminContext.jsx`; sample data: `src/data/adminData.js`.
- Pages: Dashboard, Orders, ExpertsAdmin (+ Applications), Refunds, Payments, Customers, Quality, Reports, Settings, Automation, Team.
- Roles & access are in `ROLES` (`src/pages/admin/roles.js`); the backend enforces the same table.

## Expert area (`/expert`)
- **Home** — due today, new offers, revisions, earnings, tier progress, availability (holiday mode, orders per week, working days and hours).
- **Orders** — tabs New / In progress / Waiting / Revisions / Delivered / Approved. New offers must be accepted within 30 minutes.
- **Order workspace** (`/expert/orders/:id`) — the full resume builder, pre-filled from the customer's resume. Top bar: ATS score (original → now), job-description match and the 5-point quality checklist. Drawers: Brief, Checks, Versions & compare, Messages & section comments, Snippets, LinkedIn & mentor call (Career Launch).
- Send draft → customer reviews at `/orders/:id/review` (comments per section, ask for changes / looks good). Deliver final → PDF, Word and into the customer's own builder.
- **Snippets, Earnings, Performance & reviews, Help & rules** pages.
- Code: `src/lib/atsScore.js` (score rules), `src/lib/expertStore.js` (orders: `/api/work` on the live site), `src/lib/expert.js` (profile: `/api/expert/profile`), `src/pages/expert/`.
- Preview build: data is kept in this browser only; AI buttons are samples.

## Customer dashboard (`/me`)
- **Home** — "do this next" card, ATS score, active order countdown, current resume (edit / PDF / Word / share), orders, applications, share-link views.
- **My orders** — timeline (Paid → Expert assigned → Intake → Draft 1 → Changes → Final → Approved), 24–48h countdown with the auto-refund note, free re-do, refund, add-ons, upgrade (pay the difference), GST invoices (PDF).
- **Messages** — one thread per order, the same one the expert sees.
- **My resumes** — several resumes, duplicate / rename / delete, versions (auto-saves + expert drafts), compare, restore. The builder edits the one marked "Editing now".
- **ATS & job match**, **Cover letters**, **Applications** board (follow-up reminders, weekly chart), **Share link** (`/r/<name>`, on/off, hide phone, view counter).
- **Career Launch** (LinkedIn makeover with copy buttons, mentor-call booking + calendar file), **Payments & refunds**, **Upgrade & add-ons**, **Profile & settings** (notifications, download my data, delete account), **Help & referral** (FAQ, raise an issue → admin Customers page "Support inbox").
- Settings to fill in `src/lib/pricing.js`: `ADDONS` prices (sample ₹199 / ₹299 / ₹499), `REFERRAL.reward` (null = "coming soon"), `INVOICE.gstin` and `sacCode` (from your CA).
- Code: `src/lib/customerStore.js` + `src/lib/meLive.js` (live site: everything is loaded from and saved to `/api/me/*`
  and `/api/orders`; nothing personal is kept in the browser, and signing out or switching accounts clears it), `src/pages/me/`.
- Business details (company, address, phone, Grievance Officer, GSTIN…): `src/lib/legal.js` — empty values hide their line.

## Tests
- `npm test` — unit tests (scan, save layer, sign-out clearing, legal pages, vercel.json, titles).
- `npm run test:e2e` — browser tests on the preview build (scan).
- `npm run test:e2e:live` — browser tests against the real API (`backend/`, MongoDB replica set via `TEST_MONGODB_URI`):
  sign-up, per-user data, sign-out clearing, share link, password change, admin console, expert portal, downloads.
- `npm run test:e2e:csp` — the production build served with the `vercel.json` headers: no CSP violations, real 404s,
  and the pre-rendered blog (built from a Hygraph stand-in, `e2e-live/hygraph-mock.mjs`).

## Accounts, legal pages, expert test task
- **Sign in / sign up** (`/login`, `/signup`, `/forgot-password`): email + password; sign-up (customers or experts) asks for the password twice and confirms the email with a 6-digit code; forgot password uses an email code. **Admin** (`/admin/login`): password + 6-digit authenticator code (or a one-time recovery code), "trust this device 30 days".
- Pages are protected by role: `/me/*` and order pages → customer; `/expert/*` → expert (orders, earnings etc. only once approved); `/admin/*` → admin with two-step login.
- Each customer has their own dashboard data and builder draft; new accounts start blank. Code: `src/lib/auth.js`, `src/pages/auth/Auth.jsx`. Live mode uses the FastAPI backend (hashed passwords, httpOnly cookies, email codes, TOTP).
- **Legal pages**: `/terms`, `/privacy`, `/refund-policy`, `/delivery-policy`, `/expert-terms`, `/contact` — DRAFT for a lawyer to review. Fill `src/lib/legal.js` (address, legal form, phone, Grievance Officer). Lines tagged "To confirm" are decisions still open.
- **Expert test task**: admin → Experts → Applications → "Send test task" → expert rewrites a sample resume at `/expert/test` (48 h) → admin scores 5 criteria (pass: average 3.5+, none below 3) → approve / second try / reject.
- **Orders**: checkout now creates the order in the customer's dashboard and as an offer for experts; intake answers go to the expert; refunds (late = instant, otherwise reviewed in Admin → Customers → Support inbox); cancel before an expert accepts = full refund. Old `/orders/<id>` links open the dashboard order page.
- Preview: sample accounts use password `Nm7@2026`, every code is `246810`; the yellow bar has a "Signed in as" switcher.

## Home page
- Sections: hero (upload + animated scan demo), numbers, how it works, "Try it" line improver, templates rail (opens the builder with that template), before/after, experts, pricing (+ compare table, promise), reviews, who it's for, FAQ (searchable, with Google FAQ markup), final call to action.
- Edit numbers, reviews, expert cards and social links in `src/lib/homeContent.js`. Items marked `placeholder: true` show a "Sample" tag in the preview and are hidden in the live build until you replace them with real ones.
- Share preview (WhatsApp/LinkedIn): add `public/og-image.png` (1200×630).

## Blog (`/blog`, content in Hygraph)
- Posts, categories and authors are written in Hygraph (project **nm7-blog**). One module (`src/lib/blog/hygraph.js`)
  holds the queries the build and the browser both send; rich text is read as `content { raw }` (Hygraph's AST).
- **Two endpoints:** the **build** reads the uncached Content API
  `https://api-ap-south-1.hygraph.com/v2/cmup9f6ob0ktu06w8zze56jn9/master` (override: `HYGRAPH_BUILD_ENDPOINT`), so a build
  started by the publish webhook sees the post that was just published. The **browser** reads the CDN
  `https://ap-south-1.cdn.hygraph.com/content/cmup9f6ob0ktu06w8zze56jn9/master` (override: `VITE_HYGRAPH_ENDPOINT`). Both are
  public and read-only (published content only, no token).
- **Pre-rendered for search engines:** `npm run build` fetches every published post and writes real HTML pages
  (`dist/blog/index.html`, `dist/blog/<slug>/index.html`, `dist/blog/category/<slug>/index.html`) with their own title,
  description, canonical URL, OpenGraph/Twitter tags and JSON-LD, plus `dist/sitemap.xml` and `dist/blog/data.json`
  (`scripts/prerender-blog.mjs`). The build log says what it got, e.g.
  `[blog] reading Hygraph at …`, `[blog] posts: 1 published (my-post)`, `[blog] categories: 6 (…)`,
  `[blog] pre-rendered 1 post and 6 categories`. If a query fails the build still succeeds and logs
  `[blog] WARNING: the posts query failed: HTTP 400 — <the GraphQL error>`; `data.json` then says `posts: null`.
- **A missed build never hides posts:** in the browser, when the built list has no posts or is more than 10 minutes
  old, the blog also asks Hygraph's CDN and shows the live list. A post published after the last build still opens
  (fetched live).
- Rich text is turned into HTML by `src/lib/blog/richtext.js`: text is always escaped and only known blocks become
  tags (headings, lists, links, images, code, quotes, tables); Hygraph's `html` field is never used.
- The CSP in `vercel.json` allows images from `*.graphassets.com` and browser calls to `ap-south-1.cdn.hygraph.com`. If the
  Hygraph project ever moves region, change both endpoints and that `connect-src` entry together.
- CI runs a contract test against the live Hygraph APIs (`scripts/hygraph-contract.test.mjs`): the queries must be
  valid and the build step must pre-render every published post.

### New posts go live by themselves (rebuild on publish)
1. Vercel → the **nm7** project → **Settings → Git → Deploy Hooks** → name `hygraph-publish`, branch = the production
   branch → **Create Hook**. Copy the URL (it is a secret: never put it in the repository).
2. Hygraph → **nm7-blog** → **Webhooks → Add webhook**: URL = that Deploy Hook URL, method POST, stage **Published**,
   actions **Publish**, **Unpublish** and **Delete**. Save.
3. Publish a post: a new Vercel deployment starts within seconds and the post is live in about a minute.

**Several deploys per publish:** publishing a post can also fire events for the Category and Author it references, so
one publish may start ~4 deploys. Neither Hygraph webhooks nor Vercel Deploy Hooks can wait and merge them (no
debounce), and it is harmless on the Hobby plan (the last build wins). To cut it down, limit the webhook to the
**Post** model only; after changing a category name or an author, redeploy once by hand (Vercel → Deployments →
Redeploy) or republish any post.
