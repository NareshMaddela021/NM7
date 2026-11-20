# Vetting Trust T4: vendors for the employer business check (GSTIN / Udyam / CIN)

Until a real provider is set up, Nm7 uses the **test provider** (no real registry lookup). On the live site the test
provider works only for the demo company and companies whose admin is a Trust tester, and its badge says "(test)". So
nothing changes for real companies or candidates until you finish the steps below **and** switch the provider in Admin
(Skill checks → Vetting Trust → Employer checks).

The "Never pay for a job on Nm7" promise and "Report fraud" need **no vendor**.

## What we picked: Surepass KYC APIs (one vendor for all three registries)

Why: one account and one API token cover **GSTIN** (GST portal), **Udyam / MSME** and **MCA company details (CIN)**;
pay-per-call with prepaid credits, a sandbox with test numbers, an Indian company with GST invoices, and a plain JSON
REST API (no SDK). The adapter is one file (`backend/app/trust/employer/surepass.py`).

What Nm7 calls (one call per lookup):

| Registration | Call | When |
|---|---|---|
| GSTIN | `POST /api/v1/corporate/gstin` `{"id_number": "…", "filing_status_get": false}` | the company presses "Check my business", an admin presses "Look up again", and the re-check every 90 days |
| CIN (MCA) | `POST /api/v1/corporate/company-details` `{"id_number": "…"}` | same |
| Udyam (MSME) | `POST /api/v1/corporate/udyog-aadhaar` `{"id_number": "UDYAM-…"}` | same |

**Needs vendor docs confirmation** (we could not check these against Surepass's current documents from here): the exact
Udyam path (`udyog-aadhaar` vs `udyam-aadhaar`), and the field names for status and dates in each answer. The adapter
reads each with several fallbacks (`gstin_status` / `status`, `date_of_registration`, `company_status`,
`date_of_incorporation`, `main_details.name_of_enterprise`, …). Try one real GSTIN, one CIN and one Udyam number in the
sandbox and send us the answers if anything shows as "unknown".

Format checks run first, on our side and for free: a GSTIN with a wrong check character, a CIN or Udyam number with the
wrong shape never costs a lookup. Each company can look up at most 5 numbers a day and 15 in 30 days.

### Approximate cost (ask Surepass for the current rate card; it depends on volume)

- About **₹1–3 per GSTIN lookup**, **₹2–5 per MCA company lookup**, **₹2–4 per Udyam lookup** at low volumes (credits
  bought in advance, typically from ₹5,000–10,000). GST is added on top.
- One company usually needs **one lookup to verify** plus **4 re-checks a year** (every 90 days) ≈ ₹5–15 a year.
- 500 companies ≈ ₹2,500–7,500 a year. Admin → Vetting Trust → Employer checks shows lookups today / in 30 days and how
  many were paid (not the test provider).
- The sandbox is free.

### Alternatives (if Surepass doesn't suit)

| Vendor | GSTIN | Udyam | MCA | Notes |
|---|---|---|---|---|
| IDfy | yes | yes | yes | Enterprise contract, ₹3–8 a call; more paperwork to start |
| Signzy | yes | yes | yes | Enterprise contract; similar prices |
| Setu (we already use it for DigiLocker in T2) | GST only (via partners) | no | no | Would need a second vendor for Udyam / MCA |
| A GSP (GST Suvidha Provider) public search | yes | no | no | Cheapest for GSTIN only |

Switching vendors means one new adapter file with the same `lookup(kind, number)` as `surepass.py`; nothing else changes.

## What Naresh must do

1. Sign up at **surepass.io** (business account; they ask for the company PAN / GST and a short KYC of the business).
2. In the Surepass dashboard, turn on these APIs for your account: **GSTIN Verification (advanced or basic)**, **Company
   Details (MCA / CIN)**, **Udyam Aadhaar**. Ask for the **sandbox** token first.
3. On Render (the API service → Environment), set:
   - `SUREPASS_TOKEN` = the sandbox token
   - `SUREPASS_BASE_URL` = `https://sandbox.surepass.io`
4. Admin → Skill checks → Vetting Trust → **Employer checks** should now say `SUREPASS_TOKEN: set`. Choose **Surepass**
   as the provider, then, as a tester company, check one GSTIN, one CIN and one Udyam number you know.
5. When that works: buy credits, swap to the live token, and set `SUREPASS_BASE_URL` = `https://kyc-api.surepass.io`.
6. Keep the token only in Render. Nm7 never shows it, logs it or returns it from any API (Admin only sees set / not set).

## What we keep (DPDP)

Business facts about companies, not people: the registered name and trade name, status, registration date, state and
city, the vendor's reference, when it was checked, and a **masked** copy of the number (plus a keyed hash, and the full
number only **encrypted**, for the 90-day re-check). The company agrees on the card before the lookup and can remove it
at any time (everything is deleted at once). The T1 retention job deletes a check that hasn't been refreshed for 365
days (Admin → Retention, 120–730) and old lookup rows. Fraud reports from candidates are deleted 365 days after a person
closed them (90–730).

## Render env vars (summary)

| Variable | Value |
|---|---|
| `SUREPASS_TOKEN` | the Surepass API token (sandbox first, then live) |
| `SUREPASS_BASE_URL` | `https://sandbox.surepass.io`, later `https://kyc-api.surepass.io` |
