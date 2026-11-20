# Vetting Trust T2: DigiLocker vendor (what to sign up for)

Nm7 never talks to DigiLocker directly. A licensed KYC / DigiLocker vendor runs the DigiLocker consent page; the
candidate signs in to DigiLocker there and allows Nm7 to read the documents they picked; Nm7 then reads only the fields
it needs (licence class and validity, board / university + year + pass, "PAN verified" + name match) and throws the
file away. **Aadhaar is never requested** (Nm7 does not call the vendor's Aadhaar endpoint, and drops Aadhaar data if a
vendor sends it anyway).

Until keys are set, Admin → Skill checks → Vetting Trust → **DigiLocker documents** stays on the **Test provider**:
it works for admins, demo accounts and testers only, gives test documents, and companies see "(test)" on its badges.

## Primary: Setu DigiLocker (the adapter that is built)

| | |
|---|---|
| Sign up | https://bridge.setu.co → create an organisation → **Data → DigiLocker** product. Sandbox is self-serve and free. Production needs KYB (company PAN, GST, incorporation certificate, director KYC) and Setu's agreement; usually 1–3 weeks. |
| Sandbox | Yes, free, immediately (test DigiLocker accounts in Setu's docs). |
| Cost (approx., confirm with Setu sales) | About **₹5–₹10 per successful DigiLocker request** (one candidate consent, several documents). Some plans have a monthly minimum of about **₹5,000–₹10,000** or a prepaid wallet. |
| Monthly estimate | 300 candidates verify a month ≈ ₹1,500–₹3,000 + any minimum. 1,000 a month ≈ ₹5,000–₹10,000. |
| What to give Setu | The redirect is built by Nm7 per request (`https://nm7.si/me/settings?dl=<id>`). Callback / webhook URL: shown in Admin (default `https://nm7-api.onrender.com/api/public/trust/digilocker/callback/setu`). |

### Render env vars (API service)

| Variable | Value |
|---|---|
| `SETU_DG_CLIENT_ID` | from Setu Bridge → DigiLocker product → API keys |
| `SETU_DG_CLIENT_SECRET` | same place (secret: never shown by Nm7, Admin only says "set / not set") |
| `SETU_DG_PRODUCT_INSTANCE_ID` | the DigiLocker product instance id in Setu Bridge |
| `SETU_DG_BASE_URL` | `https://dg-sandbox.setu.co` while testing; `https://dg.setu.co` for production |
| `DIGILOCKER_WEBHOOK_SECRET` | the signing secret for Setu's callback, if Setu offers one for your product (optional: without it Nm7 refuses callbacks and relies on the candidate's return + "Check now") |
| `API_PUBLIC_URL` | `https://nm7-api.onrender.com` (or `https://api.nm7.si` once that domain points at the API); used for the callback URL shown in Admin |

Then Admin → Skill checks → Vetting Trust → DigiLocker documents → Provider **Setu DigiLocker** → Save.

### Needs vendor docs confirmation (check in the Setu sandbox before going live)

The adapter (`backend/app/trust/digilocker/setu.py`) follows Setu's documented DigiLocker flow, but these details could
not be checked against Setu's current docs from here:
- the exact `orgId` for each document type (`DOCS` table: PAN `001891`, DL `000048`, CBSE `001925`, degrees via NAD);
  state boards and universities have their own orgIds and can be added to the table;
- whether `format: "xml"` is offered for every document (the reader expects the DigiLocker "Certificate" XML);
- the callback: whether Setu sends one for DigiLocker, its header name (we use `x-setu-signature`, HMAC-SHA256 of the
  body) and its body (we read `id` / `requestId`). Nm7 never trusts the callback body: it only triggers a fetch.

## Alternatives (not built; each would be one more file next to `setu.py`)

| Vendor | Sandbox | Approx. cost | Notes |
|---|---|---|---|
| Surepass (DigiLocker API) | Yes | ₹3–₹8 per call, prepaid wallet | Quick self-serve onboarding; separate "download Aadhaar" call we would never use. |
| IDfy / Signzy / Digio | On request | Enterprise pricing, often ₹25,000+/month minimum | Good if Nm7 later needs video KYC too. |
| DigiLocker direct ("Requester" via MeitY / API Setu partner onboarding) | Yes (partners portal) | Free | Needs organisation onboarding with MeitY; slow (weeks to months). |

## Nothing else

No SMS, no storage bucket, no new paid service besides the vendor. Fetched data lives in MongoDB (`trust_documents`,
`trust_dl_sessions`) and is deleted by the T1 retention job (documents 180 days, requests 30 days) or at once when the
candidate takes back the Documents consent.
