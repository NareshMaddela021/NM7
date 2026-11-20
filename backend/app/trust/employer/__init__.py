"""Vetting Trust T4: employer business verification (GSTIN / Udyam / CIN through a registry-lookup provider), the
"Verified employer" badge, the "Never pay for a job on Nm7" promise and candidates' fraud reports.

  formats.py    local format checks first (GSTIN pattern + check character, CIN, Udyam), masking, the state in a number
  providers.py  the lookup provider interface, the deterministic test provider and the registry
  surepass.py   the real adapter (Surepass KYC APIs: GSTIN, Udyam, MCA company details); isolated
  service.py    settings, matching against the company profile, the badge, re-checks, review, retention
  fraud.py      candidates' "Report fraud" (reuses the job reports collection), N-report auto-pause, the Admin queue
  router.py     company, candidate, public-page and Admin endpoints
"""
