# Vetting Trust T5: AI calling agent + WhatsApp the moment a job is posted

Base: `claude/confident-knuth-pu6nd3-trust-t4` · Branch: `claude/confident-knuth-pu6nd3-trust-t5` · **Stacked on #246 (T4)**, which is stacked on #245 (T3), #244 (T2) and #243 (T1): merge #243, #244, #245, #246, then this one (GitHub switches the base each time).

Everything here is behind the one **Vetting Trust** switch from T1. While it is OFF nobody real is messaged or called: only testers and admins, and only about jobs of a **test company** (the demo company or one with a tester on its team) — Auto Apply 2.0's pairing rule. Until the keys are set, the **test providers** send nothing at all.

## What this does, in plain words

- **Companies: one switch per job.** Company dashboard → **Jobs** → a new card **Call / message matching candidates**.
  Per job: an on/off box, up to 5 extra **yes/no questions** ("Can you start within 2 weeks?" + the answer that fits),
  and the **live status**: picked, contacted, interested, booked, waiting for a reply; for each person who said
  *Interested*: their name, their answers, "Not a fit" if an answer doesn't fit (only a label: nobody is rejected
  automatically), and the booked interview time. **Never** transcripts, recordings or phone numbers. Refreshes every 30 s.
  (It can also be switched on with the post itself: `agent: {on: true}` in the posting API.)
- **Who is picked**: right after the post (a background task, never inside the company's request) and on every
  automation pass: people with the new consent, a channel on and a phone number, not opted out, not hiding from or
  blocking the company, not already applied; scored with **Auto Apply 2.0's match score** (skills, experience, city,
  salary, vetting level, freshness: never gender, religion, caste, age, photo, name or college); at least the lowest
  score (Admin, default 50); the best **30 per job** (Admin). Heavy lease, at most 400 people looked at and 60
  contacts per pass, small batches.
- **WhatsApp first**: a Meta-approved **template** in the person's language (English / Hindi / Telugu) with three
  buttons **Interested / Not now / Stop**. *Interested* → the job's yes/no questions one by one (Yes / No buttons;
  typed "haan", "avunu", "ledu", "नहीं" work too) → their **application** is made (as if they had applied on Nm7, with
  the answers and the fit label) → up to 3 of the company's **interview times** (Hire → Interview times) as buttons →
  **booked**: the application moves to *Interview*, both sides get the calendar email (the existing one-tap slots
  flow), and the tracker shows it. No times yet → "the company will send times".
- **Then an AI call** if there's no reply within **4 hours** (Admin) **and the person allowed calls**: the AI says first
  that it is Nm7's AI assistant, that the call is not recorded and that "stop" ends it; asks the same things; books a
  time. The provider calls back with the transcript and the answers.
- **Stop in any language** — *STOP, stop, unsubscribe, band karo, बंद करो, mat bhejo, aapu, aapandi, ఆపు, ఆపండి,
  don't call…* (a button or typed) → **that channel is off at once for every job**, one confirmation message, and never
  used again until the person turns it back on in settings. Saying stop on a call turns calls off.
- **Quiet hours 9 PM–9 AM IST** (Admin can change them), the person's **quiet days**, at most **2 new contacts a person
  a day** (Admin), at most 30 people a job. A contact that falls in a quiet time waits for the next allowed time; replies
  inside a conversation the person started don't count. These are transactional messages to opted-in people (see the
  DND / DLT notes in `docs/trust/T5-vendors.md`).
- **Candidates**: Profile & settings → **Calls & WhatsApp** (next to Privacy & consent): agree in one tap (the T1
  consent *Calls and WhatsApp about matching jobs*: which channels, quiet hours, what we keep and for how long), WhatsApp
  on/off, AI calls on/off, language, quiet days, "You said Stop on …" with the way back, "Stop all calls and messages",
  and **What we said**: every message and call transcript per job. **No audio is ever stored.**
- **Transcripts**: kept only while the consent stands, **90 days** in the T1 retention schedule (7–180), deleted at once
  when the consent is taken back (open conversations end, both channels go off). The record of who was contacted
  (state, answers, booked time) 365 days; the counts 365 days; the person's choices and opt-outs while the account exists
  (so a Stop is never forgotten); all erased with the account.
- **Free-text replies the rules can't read** go to the cheap configured Claude model (strict JSON schema, registered in
  `SENT`, counted in `ai_quota` as `agent_reply`, 10 a person a day; only the reply text). No key / limit reached → it
  asks again (at most twice).
- **Webhooks are signed**: WhatsApp with Meta's `X-Hub-Signature-256` (the app secret), the set-up check with the verify
  token; calls with the secret token (or an HMAC header). The test secrets are refused on production. Repeated webhooks
  are handled once.
- **Admin → Skill checks → Vetting Trust → Calls & WhatsApp**: providers (test / Meta Cloud API; test / Bolna) with each
  key *set / not set*, the webhook URLs, people per job, contacts a day, quiet hours, the call wait, the close-after
  time, the lowest score, the **templates in three languages to submit to Meta** with "Meta approved it" ticks (a real
  provider only sends approved ones), the call script, **counts** (24 h / 30 days: sent, replied, calls, call minutes,
  booked, opt-outs), the latest conversations and the log, "Run a pass now", and a **test console** to play the
  candidate (buttons, a typed reply, a call result) with the test providers. All changes audited.
- **Knock-out model for T6**: `backend/app/trust/knockout.py` — one shared yes/no model (the job's own yes/no questions
  with a rule, then the per-job extra list, optional Hindi/Telugu texts, stable ids that match the apply form). T6 makes
  it self-serve and extends it.
- **No WhatsApp payments**, anywhere: WhatsApp is for job alerts and support only; a test fails if any text the agent can
  send mentions paying, UPI, fees or refunds.

## What Naresh should check

1. Admin → Skill checks → **Vetting Trust** → **Calls & WhatsApp**: both providers say *Test mode: nothing real is sent*.
   Read the three templates and the call script (true for us? plain enough?). **Get the Hindi and Telugu read by a
   native speaker** before submitting them to Meta.
2. Make your company admin email and a candidate email Trust testers. As the candidate: add your mobile number in
   Profile, then Profile & settings → **Calls & WhatsApp** → *I agree* → pick Hindi.
3. As the company: post a job with a yes/no question; add 2 interview times (Hire → Interview times); Jobs → **Call /
   message matching candidates** → tick it for the job.
4. Admin → Calls & WhatsApp → **Run a pass now** (between 9 AM and 9 PM IST) → the test console → *interested* → *yes* →
   *slot:1*. Check: the company card says *1 booked* with the answer and time; the candidate's **What we said** shows the
   conversation; the application is at *Interview*; the calendar emails went out.
5. With a second test candidate, type **band karo** in the console → their card says *You said Stop*; tick WhatsApp again
   to opt back in.
6. Decide: people per job (30), contacts a person a day (2), quiet hours (9 PM–9 AM), the call wait (4 h), the lowest
   match score (50).
7. Sign up as in `docs/trust/T5-vendors.md`: **Meta Business verification + a WhatsApp number + the template**, then
   **Bolna + an Exotel/Plivo Indian number** (KYC; ask them about DLT for service calls). Put the keys in Render, try with
   your own number, then pick the real providers.

## Done / not done

- [x] Per-job company toggle (+ in the posting API), live status (contacted, interested, booked), extra yes/no questions; 404 while Trust is hidden from the company
- [x] Picking within caps with Auto Apply 2.0's match score (best first, per-job cap from Admin), memory-safe (heavy lease, caps, batches); only consented, opted-in, reachable people
- [x] New T1 consent purpose `calls_whatsapp` (plain text: channels, quiet hours, what we keep, how long), withdraw deletes the transcripts and stops contact
- [x] WhatsApp first (template with Interested / Not now / Stop), then an AI call after X hours only if allowed; English / Hindi / Telugu templates, messages and call script
- [x] Knock-out questions (shared model `app/trust/knockout.py` for T6), the application with answers and the fit label (never a rejection), slot offer and atomic booking through the H5 slots flow (application → Interview, calendar emails)
- [x] Stop words in English / Hindi / Telugu (button or typed) → immediate per-channel opt-out, confirmed, never contacted again until opt-in; quiet hours (Admin) and quiet days; daily cap per person; per-job cap
- [x] Transcripts / WhatsApp logs only with consent, 90-day retention (T1 schedule), the candidate's "What we said", company summary only (answers + slot), no audio
- [x] Provider interfaces + deterministic test providers; Meta Cloud API adapter (primary WhatsApp) and Bolna adapter (primary AI calls); signed webhooks; keys never shown (set / not set)
- [x] Rules first, then Claude for unclear replies (strict schema in `SENT`, `ai_quota` feature `agent_reply`)
- [x] Switch OFF isolation: real people never contacted; testers only with test companies; demo accounts only with the demo company and only through test providers; test providers on production only for testers
- [x] Admin: providers, keys, quiet hours, caps, waits, templates per language with approval ticks, counts, log, run now, test console (audited)
- [x] `docs/trust/T5-vendors.md` (Meta verification, WhatsApp number, template approval, Bolna + Exotel/Plivo number, DLT / DND notes, ₹ costs, Render env vars)
- [x] Design system, 390 px with no sideways scroll; no new routes; no new lazy chunks (the Easy dashboard bundle and the main bundle unchanged)
- [ ] **Bolna field names** (`/call` body, the webhook's statuses and `extracted_data`, webhook signing): need vendor docs confirmation; try one call in their dashboard first.
- [ ] **Meta**: the template-button payload parameter and the Graph version should be checked with Meta's test number before going live.
- [ ] **Hindi / Telugu texts** were written by us, not a native speaker: please have them read before submitting to Meta.
- [ ] **WhatsApp delivery statuses** (sent / delivered / read) are read but not stored or shown yet.
- [ ] Number and choice questions on a job are not asked by WhatsApp / the call (only yes/no ones); the company sees them unanswered. T6 can add them.
- [ ] The company's per-job toggle isn't in the posting form yet (it is on each job right after posting, and in the API).

## Tests

- Backend: `tests/test_trust_t5.py` — **27 passed** (stop words EN/HI/TE and the rules' yes / no / slot reading;
  no payment text in any agent text or the agent's code; knock-out model; quiet hours and quiet days; a job post triggers
  selection within the per-job cap, best first, only consented testers; company card hidden while OFF; the full WhatsApp
  flow: template → questions → slots → booking → application at Interview, calendar emails, the company view without
  transcripts or phone numbers, "What we said"; Not a fit is a label; Not now; Stop in 5 spellings → per-channel
  opt-out, confirmed, never used again, opt back in; Stop on a call; the AI call after 4 h without a reply books a
  slot, duplicate call results ignored; no call without permission → no reply; quiet hours / quiet days / daily cap
  make contacts wait; webhook signatures (Meta's app secret, the verify token, test secrets refused on production, the
  voice token); duplicate WhatsApp messages handled once; consent needed, withdrawal deletes transcripts and ends
  conversations; retention deletes logs after 90 days, erase removes the rest; switch OFF isolation (real people, real
  companies, re-check before contact); test providers on production only for testers, real providers never for demo
  accounts; the AI reader (rules first, counted, limit); Admin keys set / not set, settings, counts, console; the Meta and
  Bolna adapters against fake vendors). Also `tests/test_claude_schemas.py` (the new schema registered).
- Full backend suite: **1313 passed**, 1 failed (only the known local-only `test_test_users::test_create_open_and_remove`).
- `ruff check` / `ruff format --check`: clean. Frontend: vitest 637 passed, lint no new warnings, build OK. Easy dashboard
  Telugu / Hindi **149.2 / 150 KB**, the same as T4; the main bundle is unchanged (±10 bytes of chunk-name noise against a
  T4 build): the new screens are static imports inside the company page, Admin and Privacy & consent chunks, no new lazy
  chunk.
- e2e `frontend/e2e-live/trust-t5.spec.mjs`, desktop + 390 px, `--repeat-each 2`: **8 passed**. Also re-run and passing: trust-t1, trust-t4, company-jobs, company-dashboard (18 passed).

## Vendors to sign up for

- **Meta WhatsApp Cloud API** (direct, no BSP): Business verification (free), a number not on the WhatsApp app, the
  `nm7_job_match` template in 3 languages (Utility). About **₹0.12 per template message**, replies inside 24 h free →
  ≈ ₹4 a job (30 people). Render: `WHATSAPP_ACCESS_TOKEN`, `WHATSAPP_PHONE_NUMBER_ID`, `WHATSAPP_APP_SECRET`,
  `WHATSAPP_VERIFY_TOKEN`.
- **Bolna** AI voice agent + an **Exotel / Plivo** Indian number (KYC; ask about DLT for service calls): about **₹4–7 a
  minute** all in, ₹8–15 a 2-minute call, a number ≈ ₹500–1,000 a month. Render: `BOLNA_API_KEY`, `BOLNA_AGENT_ID`,
  `VOICE_WEBHOOK_SECRET`.
- Steps, alternatives and the TRAI / DND / DLT notes: `docs/trust/T5-vendors.md`.

## Database

Additive only: new collections `trust_agent_prefs` (one row per person), `trust_agent_convos` (one per job × person),
`trust_agent_events` (counts), `trust_agent_logs` (transcripts, 90 days); jobs may get `agent` {on, state, …} and
`knockouts` (the extra yes/no list); applications made by the agent carry `origin: "agent"` and `agent` {convo_id,
channel}; slots booked by it carry `via`. Site settings `trust.agent`. New retention types `agent_logs`,
`agent_contacts`, `agent_events`, `agent_prefs`.

🤖 Generated with [Claude Code](https://claude.com/claude-code)

https://claude.ai/code/session_01SBaqRLDLwSKFN3nQpCsLVw
