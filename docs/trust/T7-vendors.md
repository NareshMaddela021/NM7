# Vetting Trust T7: vendors for job requirements and Met / Not met / Unknown

**Nothing new to sign up for.** T7 uses the Anthropic key the site already has (`ANTHROPIC_API_KEY`, `ANTHROPIC_MODEL`
on Render: the cheap configured model) and needs no new Render env vars.

- **Reading a job's requirements** (once per version of the description): one AI call per job, about 1,500 tokens in
  and 300 out. At the cheap model's prices that is well under ₹0.10 a job.
- **Checking a candidate** (only for requirements the rules can't answer): one AI call per candidate per job for up
  to 10 requirements, about 2,000–3,000 tokens in and 400 out: roughly ₹0.10–0.20 a candidate. Cached: the same
  candidate and the same requirement words are never checked twice while their evidence is the same.
- **Limits**: counted in the daily AI allowance as `criteria`, 150 calls per company a day, inside the site's 2,000 a
  day (Admin → AI usage shows them). Past the limit the rules' answer (often Unknown) stays and the rest waits for
  the next day.
- **Without a key** (tests, demo, or if the key is removed): the rules read the requirements and check the evidence;
  everything still works, with more Unknowns.
- **Certificates candidates add as evidence**: stored in the existing certificate wallet (MongoDB), checked by a
  person at Nm7 (Admin → Skill checks → Vetting Trust → Job requirements: evidence to check). No outside service.
