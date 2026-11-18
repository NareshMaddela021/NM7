"""Vetting Trust T2: documents fetched from DigiLocker through a KYC vendor.

providers.py  the provider interface, the deterministic test provider (Mock) and the registry
setu.py       Setu DigiLocker (the real adapter; isolated, needs only httpx)
xmldoc.py     reads a DigiLocker issued-document XML into a plain dict (the XML itself is never stored)
service.py    what is kept (a whitelist per document; never Aadhaar, never a full PAN), the name match, badges
router.py     the candidate's, the vendor callback's, the company's and the Admin endpoints
"""
