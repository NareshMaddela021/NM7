# Vetting Trust T6: vendors for knock-out questions, Work preferences and the non-tech filters

**Nothing to sign up for.** T6 uses no outside service and needs no new Render env vars.

- **Knock-out questions, templates and the unfair-question check**: rules in our own code
  (`backend/app/trust/knockout.py`), no AI call.
- **Driving licence (verified)**: the DigiLocker documents from T2. Whatever T2's provider is (test now, Setu later; see
  `docs/trust/T2-vendors.md`), Hire now reads the classes of vehicle from what T2 already keeps.
- **Distance from the job**: the browser's own location (free, asks the person first) rounded to about 1 km on the
  phone and again on the server, or a city picked from a built-in list of about 70 city centres; the job's office pin
  comes the same way from the company's device, else its city centre. Distance is worked out on our server (no maps
  API).
- **WhatsApp / AI calls asking number and choice questions**: the T5 providers (Meta Cloud API, Bolna), no extra cost
  beyond T5's (a few more messages per conversation inside the free 24-hour reply window).

## Later, only if wanted

- **Pincode → place** (for people who'd rather type a pincode than share a pin or pick a city): the India Post
  pincode directory on data.gov.in is free (download once, about 19,000 post offices with coordinates); no account
  needed beyond a data.gov.in API key (free). Not built yet.
- **Spoken-English score** (verified languages) comes with T10.
