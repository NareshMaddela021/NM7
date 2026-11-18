"""Auto Apply 2.0, phase A4: a company's own hiring system (Zoho Recruit, Greenhouse, Lever, Darwinbox).

base.py: the HTTP helper (timeouts, polite retries, error kinds without secrets) and the adapter interface;
adapters.py: Greenhouse, Lever, Zoho Recruit and the no-network sandbox / demo; darwinbox.py: Darwinbox, isolated
until its partner docs are confirmed; service.py: connections (key encrypted at rest), delivery with bounded retries,
the status read-back; router.py: the company's "Connect your hiring system" endpoints.
"""
