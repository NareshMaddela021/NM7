"""Vetting Trust T3: ID + live selfie check before the AI interview or a skill check; "same person" at joining.

providers.py    the provider interface, the deterministic test provider (Mock) and the registry
rekognition.py  Amazon Rekognition in Mumbai (ap-south-1), the real adapter (isolated; httpx + SigV4, no SDK)
service.py      settings, the gate, a check, the joining continuity, the review, badges, retention
router.py       the candidate's and the Admin endpoints

Photos (the selfie frames and the ID card) are read from the request into memory, sent to the provider and dropped:
never written to disk or to the database. Kept: the result (liveness and match yes/no + scores, vendor reference,
time), and for continuity the provider's face reference (encrypted; deleted with the state). Never Aadhaar.
"""
