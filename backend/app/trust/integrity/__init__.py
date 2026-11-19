"""Vetting Trust T8: one integrity rating per candidate (Low / Medium / High risk, or Not enough data) from the signals
Nm7 already collects, with a documented weighting (rating.py), the evidence view, the human review and optional webcam
snapshots.

rating.py   the weights, decay (half-life 60 days), caps and levels: pure functions
signals.py  reading the signals from V2 / V3 / V5 / T2 / T3 / T8 for many people at once (read only)
service.py  the stored rating, the review, the company label, the snapshots, the automation pass, retention
router.py   the candidate's and the Admin endpoints
"""
