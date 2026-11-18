# Vetting Trust T11: one-tap interview booking, reminders and joining-day confirmations

Base: `claude/confident-knuth-pu6nd3-trust-t10` · Branch: `claude/confident-knuth-pu6nd3-trust-t11` · **Stacked on #252 (T10)**, which is stacked on #251 (T9), #250 (T8), #249 (T7), #248 (T6), #247 (T5), #246 (T4), #245 (T3), #244 (T2) and #243 (T1): merge #243 … #252, then this one (GitHub switches the base each time).

Everything new is behind the one **Vetting Trust** switch from T1, using T5's pairing rule: while it is OFF only testers
and admins with a **test company** (the demo company, or one with a tester on its team), and demo accounts with the
demo company, get the new flow; background email goes **only to testers**. Everyone else keeps today's Hire flows
**exactly** (the H5 interview reminders 1 day / 1 hour before, the H6 "joining tomorrow" check-in): a test checks it.

**No new vendor**: WhatsApp goes through T5's provider (with T5's consent, opt-outs, quiet hours and quiet days), email
through the existing mailer. See `docs/trust/T11-vendors.md` (5 WhatsApp templates to get approved by Meta).

## What this does, in plain words

- **A one-tap booking link.** When a company wants to interview someone — they accepted a Hire invite, the company moved
  their application to Shortlisted / Interview, or the T5 calling agent made their application — and the job has free
  **interview times** (Hire → Interview times), Nm7 sends the person a link on **WhatsApp** (only with the "Calls and
  WhatsApp" consent, WhatsApp on, not opted out, outside quiet hours / quiet days, within a daily cap) **and by email**.
  The link opens a page with the company's free times: **one tap books, no sign-in**. The application moves to
  Interview and both sides get the usual calendar email (the H5 flow).
  - The link is **signed** (it can't be changed or guessed), **scoped** to that person and that job, and **expires**
    after 14 days (Admin: 1–30).
  - **One booking at a time**: tapping another time **moves** the booking (the old time is freed); two taps at once can't
    book two times; two people can't take one time.
  - **Move or cancel** with the same link until **2 hours before** (Admin). After that the page shows **"I can't make
    it"**, which tells the company by email (the time stays booked; the company decides).
  - A WhatsApp invite that falls in the quiet hours waits for the morning (up to 48 h) and is sent once; the email goes
    at once. Links are checked again on every tap: if the switch goes OFF for that person × company, the link stops.
  - The company sees it **live**: Hire now → (a job) → a new card **"Bookings by one-tap link"** (refreshes every 30 s):
    booked / moved / cancelled / can't make it, with the name, the time and the reason. Interview times show the booked
    name as before. The company member who added the times also gets the booking emails as before.
- **Reminders** (people on the new flow): **the evening before** (7 PM IST, Admin) and **2 hours before** (Admin 1–6), by
  WhatsApp and email, with the place and a **Google Maps link** or the **online link**, and **"Can't make it? Move or
  cancel it here"** (the same link). WhatsApp respects the quiet hours: a 2-hours-before message at 8 AM waits until
  9 AM, and is **dropped** if the interview has started (never sent late). Someone who booked after the evening time
  gets only the 2-hours-before one.
  - **No duplicates**: for these people the old H5 candidate reminders (1 day / 1 hour) don't go; the **company keeps its
    own H5 reminders**. Everyone else gets the old reminders exactly as today.
- **Joining day** (an accepted Hire offer):
  - **The evening before**: "See you tomorrow at Acme Foods at 10:00 AM (Hitech City, Gate 2)! Are you still coming?" →
    the link page: **Yes, I'm coming** / **Need to reschedule** (with a short note; the company is emailed).
  - **The morning of** (9 AM): "Good luck today" with **directions** (the company's map link, or Google Maps for the
    place).
  - **The afternoon** (1 PM): "Did you join today?" → one-tap **I've joined**. If the T3 joining-day selfie is set up for
    them and not done yet, the email and the page link to it (`/me/hire#offers`).
  - **The company** gets a one-tap **"Did they join?"** email at 5 PM: **Joined** / **Didn't join** (with a reason), no
    sign-in.
  - Every answer (coming, reschedule, joined, didn't join — from the links or the signed-in H6 buttons) is stored in a new
    collection **`trust_join_events`** for T15's reliability later. "I've joined" and the company's answer go through the
    existing H6 "Joined" rules, so the H4 reliability record is unchanged.
  - The company sets the **reporting time, place and map link** per accepted offer on the same card ("Reporting time
    and place"); they go into the messages. The old "joining tomorrow" email doesn't go for these people (the 7-day
    check-in stays).
- **Languages**: WhatsApp messages, emails and the candidate's link pages in **English, Hindi and Telugu** (the language
  the person chose in Calls & WhatsApp; else their Easy dashboard language). The company side is in English (as T5).
- **Admin → Skill checks → Vetting Trust → "Interview booking & joining day"**: on / off (off = everyone keeps the old
  reminders), the times (evening before, joining morning, "I've joined", company), hours before, the change window, how
  long a link works, WhatsApp a person a day (default 4), the **15 template texts** to submit to Meta with **"Meta approved
  all five"** per language (a real provider only sends approved ones), counts (24 h / 30 days), the latest links (never a
  token) and **Run a pass now**. All changes audited.
- **Privacy**: no message text is stored (only "sent / waiting / why not" per message and counts). The links store who,
  which job / offer and the expiry, never the token. New retention types in the T1 schedule: **one-tap links** 120 days
  (30–365) and **joining-day answers** 730 days (365–1095, kept for the reliability score); both erased with the account.
  WhatsApp needs the existing T1 consent "Calls and WhatsApp"; Stop / opt-out from T5 is respected at once.

## What Naresh should check

1. Make your company admin email and a candidate email Trust testers. As the candidate: Profile & settings → **Calls &
   WhatsApp** → I agree (pick Hindi to see the Hindi texts).
2. As the company: Hire now → pick a job → add 2 interview times; shortlist the candidate (or invite them and accept).
3. Admin → Vetting Trust → **Interview booking & joining day** → **Run a pass now** (between 9 AM and 9 PM IST for the
   WhatsApp; the email goes any time). The candidate's email "Pick your interview time" has the link. Open it in a
   private window (no sign-in): book, move to the other time, cancel with a reason, book again. Check the company's card
   "Bookings by one-tap link" and Interview times.
4. Read the 15 WhatsApp templates on the Admin card (true for us? plain enough?). **Have the Hindi and Telugu read by a
   native speaker**, then submit them to Meta (`docs/trust/T11-vendors.md`) and tick "Meta approved" per language.
5. Decide the times: evening before 7 PM, 2 hours before, joining morning 9 AM, "I've joined" 1 PM, company 5 PM, move /
   cancel until 2 hours before, links 14 days, 4 WhatsApp a person a day.
6. Make a test offer (Hire → Offers), accept it as the candidate with a join date of tomorrow, set the reporting time and
   place on the company card, and run a pass after 7 PM: "See you tomorrow" arrives; try Yes and Need to reschedule.

## Done / not done

- [x] Signed, expiring, person × job scoped one-tap link; book / move / cancel with no sign-in; one booking at a time; moves and cancels until 2 h before (Admin); "I can't make it" after that tells the company
- [x] Sent when a company invites (accepted invites become Shortlisted applications), moves an application to Shortlisted / Interview, or the T5 agent made the application, once the job has free times; WhatsApp (T5 provider, consent, opt-out, quiet hours / days, daily cap) + email
- [x] Atomic booking: two people one time → one wins; two taps on one link → one booking
- [x] Company sees bookings live (30 s) and gets the existing booking / moved / cancelled emails; "can't make it" emailed
- [x] Reminders the evening before and 2 h before (Admin), map or online link, the move / cancel link; quiet hours wait, too-late WhatsApp dropped; no duplicates (old H5 candidate reminders skipped for these people; the company keeps its own)
- [x] Joining day: evening before (Yes / Need to reschedule), morning of (good luck + directions), "I've joined" check-in (+ link to the T3 selfie when it applies), the company's one-tap Joined / Didn't join; all stored in `trust_join_events`; the old "joining tomorrow" email skipped for these people
- [x] EN / HI / TE messages and candidate pages; no payment words anywhere (a test checks)
- [x] Behind the Trust switch with T5's pairing rule; background email only to testers while OFF; switch OFF = old flows unchanged (tested)
- [x] Admin card (times, caps, template approvals, counts, links, run now), audited; `docs/trust/T11-vendors.md` (no new vendor)
- [x] No new route (the link pages live in the existing TrustLink chunk under `/stop-alerts#k=book|join|cjoin`); main bundle unchanged (342,834 bytes, same as T10); Easy dashboard Telugu / Hindi 149.2 / 150 KB unchanged; 390 px with no sideways scroll
- [ ] **Meta template approval** for the 5 templates × 3 languages (Naresh, in WhatsApp Manager). Until ticked, real WhatsApp isn't sent for T11 (the email is).
- [ ] **Hindi / Telugu texts** were written by us, not a native speaker.
- [ ] The **consent text** of "Calls and WhatsApp" (T5) talks about job messages and booking interview times, not reminders or the joining day. We kept the text (changing it makes a new version and asks everyone again). Decide whether to update it when T11 goes public.
- [ ] Invites go on the next automation pass (every 10 minutes), not the moment the company shortlists; "Run a pass now" in Admin sends them at once.
- [ ] "Need to reschedule" for the joining day emails the company; there is no joining-day slot picker (the company replies on Nm7).
- [ ] The company card shows joining days only under a selected job in Hire now (they are company-wide); the company's "Did they join?" is by email link (the H6 buttons in Hire → Offers work as before).
- [ ] WhatsApp delivery statuses (delivered / read) are not stored (as in T5).

## Tests

- Backend: `tests/test_trust_t11.py` — **11 passed**: the link (signature, expiry, scope to its kind, the same link per
  person × job, revoked / expired in the database refused); invite → book → second tap no-op → move → cancel (reason) →
  book again, the application at Interview, both sides emailed, the company's live view, a time of another job refused;
  the 2-hour window (move / cancel refused, "can't make it" emails the company, the time stays booked, times inside the
  window not offered); two people one time (one 409 "taken") and two taps on one link (one booking); reminders (nothing
  before 7 PM, the evening email + WhatsApp once, the old H5 reminder goes only to the company, 2 hours before at 8 AM →
  email now and WhatsApp at 9 AM); a too-late WhatsApp dropped, a late booking gets no "tomorrow", the daily cap; opt-out
  (email only), no consent (no WhatsApp), a quiet-hours invite sent in the morning once; joining day (company's time /
  place / map, the old "tomorrow" email skipped, evening WhatsApp in Hindi + email, Yes / reschedule (reason, company
  emailed) / joined not yet, morning with directions, check-in once, the company card's answers); "I've joined" and the
  company's one-tap confirm stored (and H4 reliability as before), a company link refused as a candidate link, the
  signed-in H6 path stored once; **switch OFF isolation** (no link, no WhatsApp, no T11 email; old H5 reminders to both
  sides and the old "joining tomorrow" email exactly as before; a hand-made link doesn't open; the company card 404; a
  tester with a real company not on the flow); Admin settings / run / 15 templates with the same placeholders in 3
  languages / retention types / no payment words.
- Also re-run and passing: `test_trust_t5.py`, `test_hire_slots.py`, `test_hire_offers.py`, `test_trust_t3.py`,
  `test_hire_reliability.py` (49 passed).
- Full backend suite: **1374 passed**, 1 failed (only the known local-only `test_test_users::test_create_open_and_remove`).
- `ruff check` / `ruff format --check`: clean. Frontend: vitest **654 passed** (2 skipped), lint no new warnings (the 3
  existing ones), build OK; main bundle unchanged; Easy dashboard Telugu / Hindi **149.2 / 150 KB** (unchanged).
- e2e `frontend/e2e-live/trust-t11.spec.mjs`, desktop + 390 px, `--repeat-each 2`: **12 passed** (book / move / cancel /
  book again with no sign-in and the company's live card; the joining day in Hindi: coming, reschedule, I've joined,
  the company's Joined; a changed link's plain error and the Admin card). Also re-run and passing: trust-t1, hire-slots, hire-offer, trust-t5 (16 passed).

## Vendors to sign up for

- **None new.** Get the 5 WhatsApp templates (× English / Hindi / Telugu) approved in Meta's WhatsApp Manager on the
  T5 number (category Utility), then tick them in Admin. About **₹0.12–0.15 per message** (≈ ₹0.40 per interview, ≈
  ₹0.40 per joining). No new Render env vars. Details: `docs/trust/T11-vendors.md`.

## Database

Additive only: new collections **`trust_book_links`** (one per person × job / offer / company × offer: kind, ids, source,
expiry, the current booking, a counter; never the token) and **`trust_join_events`** (offer, person, company, side,
kind, via, reason, time). Hire slots may get `t11_flow`, `t11` (what was sent when, per reminder and channel), `via:
"trust_link"`, `cant_make_it`; Hire offers may get `t11_flow`, `t11`, `t11_join` {time, place, map, reschedule}. Events
`t11_*` in `trust_agent_events` (no text). Site settings `trust.booking`. New retention types `book_links`,
`join_events`. Code: `backend/app/trust/booking/` (service, router, texts); small hooks in `app/hire/slots.py`
(`send_reminders` skips the candidate for people on the new flow; `notify(candidate=…)`), `app/hire/offers.py` (`_joined`
stores the event; `send_checkins` skips "tomorrow" for them); T5's `send_template` takes a template name.

🤖 Generated with [Claude Code](https://claude.com/claude-code)

https://claude.ai/code/session_01SBaqRLDLwSKFN3nQpCsLVw
