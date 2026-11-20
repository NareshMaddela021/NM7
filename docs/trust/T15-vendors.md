# Vetting Trust T15 — vendors: typing, situational-judgement and aptitude tests; the reliability record

**No new vendor, no new cost to sign up for, and no new Render env vars.**

- **The three tests** (typing, situational judgement, aptitude) run entirely on Nm7: the question banks are files in
  the code (`backend/app/trust/worktests/banks/`), every grade is fixed arithmetic (no AI call, no outside service).
- **The reliability record** reuses what is already set up:
  - **Email** (the existing mailer, Resend): the company's one-tap "Did they come to the interview?" and "Still working
    with you after 30 / 90 days?", and the candidate's "tell us what happened" / "still working there?" messages.
  - **WhatsApp** for the candidate: the T5 / T11 provider (Meta WhatsApp Cloud API), the same number, the same keys
    (`WHATSAPP_ACCESS_TOKEN`, `WHATSAPP_PHONE_NUMBER_ID`, `WHATSAPP_APP_SECRET`, `WHATSAPP_VERIFY_TOKEN`), the same rules
    (only with the "Calls and WhatsApp" consent, quiet hours, the daily cap, Stop). Until those keys are set, the test
    provider sends nothing real. Companies get email only (Nm7 does not keep a company WhatsApp number).

## What Naresh does (once, in Meta's WhatsApp Manager)

Submit **two more UTILITY templates** in English, Hindi and Telugu (6 in all), together with the T11 ones. The texts
are in Admin → Skill checks → Vetting Trust → **Interview booking & joining day** → "WhatsApp templates" (T11's list
now shows 7 a language). The "approved" ticks there (per language) cover these too.

| Template name | Sent when | Variables |
|---|---|---|
| `nm7_reliability_reply` | a company marked a no-show / didn't join / no longer working: the candidate has 48 hours to say what happened | first name, what the company said, company, link |
| `nm7_still_working` | 30 and 90 days after an employer-confirmed join | first name, company, days, link |

Hindi and Telugu need a native speaker's check before they go to Meta (as for T5 / T11).

## Cost (approximate, INR)

- Meta **utility template** messages in India: about **₹0.12–0.15** each. At most **3 a person per job** (a no-show
  question, day 30, day 90), usually 0–2 → **under ₹0.50 a hire**. Email: nothing extra.
- The tests: **₹0** (no AI, no vendor).
