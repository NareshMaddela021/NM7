"""Vetting Trust T14: coding tasks for tech roles — code runs in an external sandbox (Judge0 CE, or the test sandbox)
against hidden tests; an optional keystroke replay of the code editor for reviewers (own consent, 90 days).

providers.py  the sandbox interface, the test sandbox (Mock), the registry, languages, limits
judge0.py     Judge0 CE (RapidAPI or self-hosted), the real adapter (isolated; httpx)
problems.py   coding problems (hidden tests stay server-side), the two built-in ones, validation rules
replay.py     the compact replay format, its size cap, the numbers and the T8 signals worked out from it
service.py    settings, the task (draft, run, submit, the queue with retries), results, reviewers' views
router.py     the candidate's, the company's and the Admin endpoints
"""
