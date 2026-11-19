# Vetting Trust T10 — vendors: the spoken-English score

The spoken-English score works **without any new vendor**: fluency comes from the timing of the speech the browser
already recognises, grammar and comprehension from the existing Claude key (or rules without it). Only the
**pronunciation** sub-score needs a speech-assessment service. Until one is set up, Admin → Skill checks → Vetting Trust
→ Spoken English shows "Pronunciation not measured" for real users and the band uses the other three sub-scores (the
test provider works for admins, demo accounts and testers).

## What Naresh signs up for (one, optional)

**Microsoft Azure — Azure AI Speech (Pronunciation Assessment)**

1. Sign in at portal.azure.com (a Microsoft account with a card; Azure gives new accounts a free credit).
2. Create a resource → search "Speech" → **Speech service** (Azure AI services).
   - Region: **Central India** (Pune) — keeps the audio in India. (South India / West India also work if Central India
     is not offered.)
   - Pricing tier: **Free F0** to try it (5 audio hours a month free, low request rate), then **Standard S0**.
3. Open the resource → **Keys and Endpoint** → copy **KEY 1** and note the **Location/Region** (e.g. `centralindia`).
4. In Render (the API service) → Environment, add:

   | Variable | Value |
   |---|---|
   | `AZURE_SPEECH_KEY` | KEY 1 from step 3 (secret; never shown anywhere in Nm7) |
   | `AZURE_SPEECH_REGION` | the region name, e.g. `centralindia` (this is the default if left out) |

5. Admin → Skill checks → Vetting Trust → Spoken English → Pronunciation provider: **Azure AI Speech** → Save. The card
   then says "Connected" and lists both keys as "set" (never their values).

**Before turning it on for real users (needs vendor docs confirmation):** check on Microsoft's "Pronunciation
assessment — language support" page that **en-IN** (English, India) is supported in your region, and send one test
clip from a tester account (the Admin counts show "clips assessed" and "failed"). The adapter reads both answer shapes
Microsoft documents (scores directly in `NBest[0]` or under `NBest[0].PronunciationAssessment`).

### Approximate cost (check the Azure pricing page; prices change)

- Pronunciation Assessment is billed as **speech to text, standard (real-time)** audio time: about **US$1 per audio
  hour ≈ ₹85–90 per hour ≈ ₹1.5 per minute assessed** (some regions/offers add a small pronunciation-assessment charge:
  budget **up to ~₹2 per minute** to be safe).
- Per interview: at most 7 answers + follow-ups, each clip capped at **20 seconds** → usually **2–3 minutes ≈ ₹3–6 per
  interview**, only for people who choose "Also measure my spoken English" on a spoken English interview.
- Free tier F0: **5 audio hours a month** (≈ 100–150 interviews) at no cost.
- The Claude part (grammar + comprehension): one small call per measured interview on the configured cheap model,
  about **₹0.3–0.5**, counted in the AI allowance (feature "spoken", 3 per person a day). Without the key: rules, free.

### Privacy notes for the contract / privacy page

- Only the audio of the answer is sent (no name, email or other details), from Nm7's server, straight from memory.
  Nm7 does **not** keep the audio unless Admin turns on "Keep voice clips" (then encrypted, deleted after the "Voice
  clips" retention: 7 days by default, Admin 1–30).
- Microsoft states that audio sent to the Speech REST API for real-time recognition is not stored by the service
  (no "data logging" unless enabled). Confirm in the Azure data-privacy page for Speech before going live.

## Not built (alternatives if Azure doesn't suit)

- **Speechace** (speechace.com) — pronunciation and fluency API, priced per API call (ask them for an India quote).
- **ELSA Speech Analyzer API** — enterprise pricing.

Either can be added as another provider next to `app/trust/spoken/azure.py` (same `assess(audio, reference)` shape).

## Nothing else to sign up for

No new email, WhatsApp or calling vendor. No new Render env vars besides the two above (both optional).
