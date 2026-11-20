"""Vetting Trust (T1–T15): identity, consent and integrity features built on the vetting engine.

T1 (this package's base): the launch switch (access.py), consents per purpose (consent.py), the age gate and parental
consent (age.py), the retention schedule and its deletion job (retention.py), erase-after-inactivity (inactivity.py),
the 72-hour breach log (breach.py) and the Admin endpoints (admin.py). Later items add consent purposes and data types
to the registries in consent.py and retention.py.
"""
