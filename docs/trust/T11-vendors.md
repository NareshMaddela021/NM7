# Vetting Trust T11 — vendors: one-tap interview booking, reminders and the joining day

**No new vendor.** T11 reuses what is already set up:

- **WhatsApp**: the T5 provider (Meta WhatsApp Cloud API, chosen in Admin → Skill checks → Vetting Trust → Calls &
  WhatsApp), the same number, the same keys (`WHATSAPP_ACCESS_TOKEN`, `WHATSAPP_PHONE_NUMBER_ID`,
  `WHATSAPP_APP_SECRET`, `WHATSAPP_VERIFY_TOKEN`) and the same webhook (a "STOP" reply to a T11 message turns WhatsApp
  off exactly as in T5). Until those keys are set, the test provider sends nothing real.
- **Email**: the existing mailer (Resend). Nothing new to set.
- No calls are made by T11 (reminders are WhatsApp + email only).

No new Render environment variables.

## What Naresh does (once, in Meta's WhatsApp Manager)

Meta only lets a business start a WhatsApp conversation with an **approved template**. T11 adds **five templates**,
each in **English, Hindi and Telugu** (15 in all), category **UTILITY** (an update about the person's own interview or
joining day — not marketing). The exact texts are in Admin → Skill checks → Vetting Trust → **Interview booking &
joining day** → "WhatsApp templates to submit to Meta":

| Template name | Sent when | Variables |
|---|---|---|
| `nm7_interview_book` | a company shortlists / invites someone and has free interview times | first name, role, company, link |
| `nm7_interview_reminder` | the evening before and 2 hours before the interview | first name, role, company, when, where, link |
| `nm7_joining_eve` | the evening before the joining day | first name, company, time and place, link |
| `nm7_joining_morning` | the morning of the joining day | first name, company, time and place, directions |
| `nm7_joining_checkin` | the afternoon of the joining day ("I've joined") | first name, company, link |

Steps: business.facebook.com → WhatsApp Manager → Message templates → Create template → Category **Utility** → the name
above → language → paste the body; Meta asks for an example of each `{{n}}` (use e.g. "Asha", "Data Analyst",
"Acme Foods", `https://nm7.si/stop-alerts#k=book&t=example`). Approval usually takes minutes to a day. When all five
are approved for a language, tick **"Meta approved all five"** for that language on the Admin card. A real provider
never sends a template that isn't ticked (the email still goes).

**Please have the Hindi and Telugu texts read by a native speaker before submitting them** (we wrote them; as in T5).

## Cost (approximate, INR)

- Meta charges per **utility template** message delivered in India: about **₹0.12–0.15** each (Meta's India utility
  rate; it changes from time to time — check WhatsApp Manager → Insights → Pricing). A message inside a conversation the
  person opened in the last 24 hours is free.
- Per interview: an invite + 2 reminders ≈ 3 messages ≈ **₹0.40**. Per joining: 3 messages ≈ **₹0.40**.
- The Admin cap "WhatsApp a person a day" (default 4) keeps the worst case at ≈ ₹0.60 a person a day.
- Email: within the existing Resend plan.

## DND / DLT

These are transactional updates about the person's own interview or joining day, sent only to people who agreed to
"Calls and WhatsApp" (T1 consent `calls_whatsapp`), outside quiet hours (9 PM–9 AM IST by default), and they can reply
STOP at any time. WhatsApp business messages are not covered by TRAI's SMS DLT registration; see the DND notes in
`docs/trust/T5-vendors.md`.
