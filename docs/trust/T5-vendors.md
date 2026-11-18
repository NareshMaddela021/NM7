# Vetting Trust T5: what to sign up for (WhatsApp + AI calls)

Until the keys below are set, Nm7 uses the **test providers**: nothing real is sent and nobody's phone rings. Admin →
Skill checks → Vetting Trust → **Calls & WhatsApp** shows each key as *set / not set* (never the value), and has a test
console to play the candidate's side.

Prices are approximate (late 2026), before 18% GST. Check the current rate cards when you sign up.

## 1. WhatsApp: Meta WhatsApp Cloud API (direct, no BSP)

We picked Meta's own Cloud API: no monthly BSP fee, Meta's per-message price only. A BSP (Gupshup, Interakt, AiSensy)
is easier to set up but adds ₹1,000–3,000 a month or a markup per message. If you would rather use one, tell us: the
adapter is one small file (`backend/app/trust/agent/meta.py`).

What Naresh does:

1. **Meta Business account** (business.facebook.com) for Nm7, then **Business verification** (Security Centre →
   Start verification): legal name, address, GST or incorporation certificate, a website on nm7.si, a phone/email for
   the code. Free. Takes 2–10 working days.
2. **A WhatsApp Business phone number**: a number that is **not** already on the WhatsApp or WhatsApp Business app
   (a new SIM or a landline that can get an SMS / voice code). In developers.facebook.com → My Apps → Create app →
   *Business* → add **WhatsApp** → add the number → set the **display name** "Nm7" (Meta approves it).
3. **A permanent token**: Business Settings → System users → add an *Admin* system user → assign the app and the
   WhatsApp account → *Generate token* with `whatsapp_business_messaging` and `whatsapp_business_management`, no expiry.
4. **The template**: WhatsApp Manager → Message templates → Create → category **Utility** → name `nm7_job_match`, one
   per language (**English `en`, Hindi `hi`, Telugu `te`**). Copy the body, the three **quick-reply buttons**
   (Interested / Not now / Stop) and the footer exactly from Admin → Calls & WhatsApp → *WhatsApp templates to submit to
   Meta*. The `{{1}}..{{4}}` are name, job title, company, city. Sample values: "Asha", "Data Analyst", "Acme", "Hyderabad".
   Approval takes minutes to a day. **Then tick "Meta approved it"** for that language in Admin (a real provider only
   sends approved ones; a language not approved yet falls back to English if English is approved).
   *The Hindi and Telugu texts need a native speaker's read before you submit them.*
5. **The webhook**: in the app → WhatsApp → Configuration → Callback URL
   `https://nm7-api.onrender.com/api/public/trust/agent/whatsapp`, Verify token = the `WHATSAPP_VERIFY_TOKEN` you choose
   (any long random string), then *Verify and save*, and subscribe to **messages**.
6. **Render env vars** (the API service):
   - `WHATSAPP_ACCESS_TOKEN` (the system user token)
   - `WHATSAPP_PHONE_NUMBER_ID` (WhatsApp → API setup → "Phone number ID", not the phone number)
   - `WHATSAPP_APP_SECRET` (App settings → Basic → App secret: signs every webhook; we refuse unsigned ones)
   - `WHATSAPP_VERIFY_TOKEN` (the string from step 5)
   - optional `WHATSAPP_GRAPH_URL` (default `https://graph.facebook.com/v21.0`)
7. Admin → Calls & WhatsApp → WhatsApp → **Meta WhatsApp Cloud API** → Save. Try it with your own number as a Trust
   tester (and a test company) first.

Cost (Meta's India rates, per message since July 2025):
- **Utility template** (our "a job matches you" message): about **₹0.12 per message**.
- **Replies inside the 24-hour window** the candidate opens by answering (the questions, the times, "Booked"): **free**.
- Marketing templates (~₹0.80) are never used.
- So about ₹0.12 a person a job; 30 people a job ≈ **₹4 a job**; 1,000 jobs a month ≈ ₹4,000.
- Meta gives some free service conversations; there is no monthly fee for the Cloud API itself.

WhatsApp is used only for job alerts and support. **WhatsApp payments were removed and never come back** (a test fails
if a payment word appears in any message the agent can send).

## 2. AI voice calls: Bolna (with an Exotel or Plivo Indian number)

We picked **Bolna** (bolna.ai, Bengaluru): an AI voice-agent platform that does the speech-to-text, the conversation and
text-to-speech in English, Hindi and Telugu, and dials through Indian telephony (Exotel or Plivo). One isolated adapter
(`backend/app/trust/agent/bolna.py`). **Needs vendor docs confirmation**: the `/call` path and body, the webhook's field
names and statuses, and whether Bolna can sign webhooks (we use a secret token in the URL meanwhile). Alternatives with
the same shape: Retell, Vapi, ElevenLabs agents (pricier in INR), or Exotel + our own speech (much more work).

What Naresh does:

1. Sign up at bolna.ai → add credits. Connect a telephony provider in Bolna (Exotel recommended for India, or Plivo) and
   buy an **Indian virtual number**. Exotel/Plivo will ask for **KYC** (company PAN, GST, address proof, authorised
   signatory) before outbound calls in India.
2. Create **one agent** ("Nm7 job call") with:
   - languages English / Hindi / Telugu (voice and transcriber per language; we send `language` = en / hi / te);
   - a prompt that reads our variables: `{intro}` first (it says it is Nm7's AI assistant, that the call is not
     recorded and that "stop" ends it), then `{interest}`, then each line of `{questions}` (yes/no), then `{slots_line}`
     and the number they pick, then `{booked}` / `{bye}`; if the person says stop / band karo / aapu → `{stopped}`;
   - **extraction** (post-call analysis) as JSON: `{"interest": "interested|not_now|stop", "knockouts": {"<id from
     question_ids>": "yes|no"}, "slot": <number or 0>}`;
   - **call recording OFF** (we never store audio; the adapter drops any recording URL);
   - **webhook** (call completed): `https://nm7-api.onrender.com/api/public/trust/agent/voice/bolna?token=<VOICE_WEBHOOK_SECRET>`.
3. **Render env vars**: `BOLNA_API_KEY`, `BOLNA_AGENT_ID`, `VOICE_WEBHOOK_SECRET` (a long random string you choose; the
   same one in the webhook URL), optional `BOLNA_BASE_URL` (default `https://api.bolna.ai`).
4. Admin → Calls & WhatsApp → AI calls → **Bolna** → Save. Call yourself first (a Trust tester with calls allowed).

Cost (approx.): Bolna platform + speech + LLM ≈ **₹3–6 a minute**, telephony (Exotel/Plivo outbound to Indian mobiles)
≈ **₹0.6–1.5 a minute**, an Indian number ≈ **₹500–1,000 a month** (Exotel plans start around ₹5,000 a quarter
including a number). A call is about 2 minutes → **₹8–15 a call**. Calls only happen when someone allowed calls and
didn't reply on WhatsApp within the wait (Admin, default 4 hours), so most contacts cost only the WhatsApp ₹0.12.

## 3. DND, TRAI and DLT (please read with a lawyer)

- These are **transactional / service** messages and calls: about a job the person asked to hear about, only to people
  who gave the "Calls and WhatsApp about matching jobs" consent (kept with its text version and time), with Stop in
  every message, quiet hours 9 PM–9 AM IST (Admin), quiet days, at most 2 new contacts a person a day and at most 30
  people a job. They are **not promotional**.
- **WhatsApp** is outside TRAI's DLT rules (Meta's own opt-in and quality rules apply: keep the opt-in, honour Stop).
- **Voice calls**: under TRAI's TCCCPR 2018 (and the 2025 amendments) **promotional** calls need a registered
  telemarketer, the 140-series and DND (NCPR) scrubbing; we make none. **Service / transactional** calls to people who
  consented are allowed, but telephony providers increasingly require the business and its calling purpose to be
  registered on a **DLT** platform (as a principal entity, with consent templates) and may move service calls to the
  **160-series** numbers TRAI introduced. Ask Exotel/Plivo what they need for "service calls to opted-in users" and do
  it before going live; if they require DND scrubbing anyway, turn it on in their dashboard.
- Keep the consent records (Admin can export them per person) as proof of opt-in.

## 4. The AI that reads free-text replies

Rules first (Stop / yes / no / a number in English, Hindi and Telugu). Only when they can't tell, the configured cheap
Claude model reads the reply (strict JSON, at most 10 a person a day, counted in the AI allowance as `agent_reply`;
the reply text only, never the person's name or number). No new key: it uses the existing `ANTHROPIC_API_KEY`.
