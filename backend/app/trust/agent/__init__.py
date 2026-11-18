"""Vetting Trust T5: the calling agent. When a company posts a job (and turned it on for that job), Nm7 messages the
best-matching people who said yes to calls / WhatsApp, calls them with an AI voice agent if they don't reply, asks the
job's yes/no knock-out questions and books an interview time from the company's slots.

  texts.py       what it says in English / Hindi / Telugu (WhatsApp templates for Meta, messages, the call script) and
                 the words for Stop / yes / no
  providers.py   the WhatsApp and voice interfaces, the deterministic test providers, Meta's webhook parser
  meta.py        WhatsApp through Meta's Cloud API (the real adapter)
  bolna.py       AI calls through Bolna (the real adapter; needs vendor docs confirmation)
  understand.py  reading free-text replies: rules first, the AI only when they can't tell
  service.py     consent purpose, retention, choices, quiet hours and caps, picking people, the conversation, booking
  router.py      company, candidate, webhook and Admin endpoints
The shared knock-out model is app/trust/knockout.py (T6 extends it).
"""
