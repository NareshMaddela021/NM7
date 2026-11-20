# ruff: noqa: E501, RUF001  (message texts in three languages)
"""What T11 sends, in English, Hindi and Telugu: five WhatsApp templates (to submit to Meta, category UTILITY: an update
about the person's own interview or joining day) and the email subjects. The email body is the same text as the
WhatsApp message, so a person reads the same words on both.

Every message carries a signed one-tap link (no sign-in) that opens the page to book, move or cancel the interview, or
answer for the joining day. Never anything about payments. Hindi and Telugu need a native speaker's check before they
are submitted to Meta (as for T5).
"""

LANGS = ("en", "hi", "te")

# name → the Meta template name. {{n}} placeholders, filled in order.
NAMES = {
    "book": "nm7_interview_book",  # 1 first name · 2 role · 3 company · 4 link
    "reminder": "nm7_interview_reminder",  # 1 first name · 2 role · 3 company · 4 when · 5 where · 6 link
    "join_eve": "nm7_joining_eve",  # 1 first name · 2 company · 3 time and place · 4 link
    "join_morning": "nm7_joining_morning",  # 1 first name · 2 company · 3 time and place · 4 directions
    "join_checkin": "nm7_joining_checkin",  # 1 first name · 2 company · 3 link
    "rel_reply": "nm7_reliability_reply",  # T15: 1 first name · 2 what the company said · 3 company · 4 link
    "rel_stay": "nm7_still_working",  # T15: 1 first name · 2 company · 3 days · 4 link
}

TEMPLATES: dict[str, dict[str, str]] = {
    "en": {
        "book": "Hi {{1}}, {{3}} would like to interview you for {{2}}. Pick a time that suits you in one tap (no sign-in needed): {{4}}\nYou can move or cancel it with the same link until 2 hours before. Reply STOP to stop WhatsApp messages from Nm7.",
        "reminder": "Hi {{1}}, a reminder: your interview for {{2}} at {{3}} is {{4}}.\n{{5}}\nCan't make it? Move or cancel it here: {{6}}\n— Nm7",
        "join_eve": "Hi {{1}}, see you tomorrow at {{2}}{{3}}! Are you still coming? Tap Yes, or tell them you need to reschedule: {{4}}\n— Nm7",
        "join_morning": "Good luck today at {{2}}, {{1}}!{{3}}\nDirections: {{4}}\n— Nm7",
        "join_checkin": "Hi {{1}}, did you join {{2}} today? Tap “I’ve joined” here: {{3}}\n— Nm7",
        "rel_reply": "Hi {{1}}, {{3}} told us: {{2}}. Before it goes on your record, tell us what happened (you have 48 hours): an emergency, or the company cancelled? {{4}}\n— Nm7",
        "rel_stay": "Hi {{1}}, are you still working at {{2}} ({{3}} days since you joined)? One tap to confirm: {{4}}\n— Nm7",
    },
    "hi": {
        "book": "नमस्ते {{1}}, {{3}} आपका {{2}} के लिए इंटरव्यू लेना चाहता है। एक टैप में अपना समय चुनें (साइन-इन की ज़रूरत नहीं): {{4}}\nइसी लिंक से 2 घंटे पहले तक समय बदल या रद्द कर सकते हैं। Nm7 के WhatsApp संदेश बंद करने के लिए STOP लिखें।",
        "reminder": "नमस्ते {{1}}, याद दिलाना: {{3}} में {{2}} का आपका इंटरव्यू {{4}} है।\n{{5}}\nनहीं आ पाएँगे? यहाँ समय बदलें या रद्द करें: {{6}}\n— Nm7",
        "join_eve": "नमस्ते {{1}}, कल {{2}} में मिलते हैं{{3}}! क्या आप आ रहे हैं? हाँ दबाएँ, या बताएँ कि तारीख बदलनी है: {{4}}\n— Nm7",
        "join_morning": "आज {{2}} में आपके पहले दिन के लिए शुभकामनाएँ, {{1}}!{{3}}\nरास्ता: {{4}}\n— Nm7",
        "join_checkin": "नमस्ते {{1}}, क्या आपने आज {{2}} जॉइन किया? यहाँ “मैंने जॉइन किया” दबाएँ: {{3}}\n— Nm7",
        "rel_reply": "नमस्ते {{1}}, {{3}} ने हमें बताया: {{2}}। आपके रिकॉर्ड में जाने से पहले बताएँ कि क्या हुआ (48 घंटे हैं): कोई इमरजेंसी, या कंपनी ने रद्द किया? {{4}}\n— Nm7",
        "rel_stay": "नमस्ते {{1}}, क्या आप अभी भी {{2}} में काम कर रहे हैं (जॉइन किए {{3}} दिन हुए)? एक टैप में बताएँ: {{4}}\n— Nm7",
    },
    "te": {
        "book": "నమస్తే {{1}}, {{3}} మిమ్మల్ని {{2}} కోసం ఇంటర్వ్యూ చేయాలనుకుంటోంది. ఒక్క ట్యాప్‌లో మీకు సరిపడే సమయం ఎంచుకోండి (సైన్-ఇన్ అవసరం లేదు): {{4}}\nఇదే లింక్‌తో 2 గంటల ముందు వరకు సమయం మార్చవచ్చు లేదా రద్దు చేయవచ్చు. Nm7 WhatsApp మెసేజ్‌లు ఆపడానికి STOP అని పంపండి.",
        "reminder": "నమస్తే {{1}}, గుర్తు చేస్తున్నాం: {{3}}లో {{2}} కోసం మీ ఇంటర్వ్యూ {{4}}.\n{{5}}\nరాలేకపోతున్నారా? ఇక్కడ మార్చండి లేదా రద్దు చేయండి: {{6}}\n— Nm7",
        "join_eve": "నమస్తే {{1}}, రేపు {{2}}లో కలుద్దాం{{3}}! మీరు వస్తున్నారా? అవును నొక్కండి, లేదా తేదీ మార్చాలని చెప్పండి: {{4}}\n— Nm7",
        "join_morning": "ఈరోజు {{2}}లో మీ మొదటి రోజుకి శుభాకాంక్షలు, {{1}}!{{3}}\nదారి: {{4}}\n— Nm7",
        "join_checkin": "నమస్తే {{1}}, ఈరోజు {{2}}లో చేరారా? ఇక్కడ “చేరాను” నొక్కండి: {{3}}\n— Nm7",
        "rel_reply": "నమస్తే {{1}}, {{3}} మాకు చెప్పింది: {{2}}. ఇది మీ రికార్డులోకి వెళ్ళే ముందు ఏం జరిగిందో చెప్పండి (48 గంటలు ఉన్నాయి): ఏదైనా అత్యవసరం, లేదా కంపెనీ రద్దు చేసిందా? {{4}}\n— Nm7",
        "rel_stay": "నమస్తే {{1}}, మీరు ఇంకా {{2}}లో పని చేస్తున్నారా (చేరి {{3}} రోజులు అయింది)? ఒక్క ట్యాప్‌తో చెప్పండి: {{4}}\n— Nm7",
    },
}

SUBJECTS: dict[str, dict[str, str]] = {
    "en": {"book": "Pick your interview time: {role} at {company}", "reminder_day": "Tomorrow: interview for {role} at {company}",
           "reminder_soon": "Soon: interview for {role} at {company}", "join_eve": "See you tomorrow at {company}",
           "join_morning": "Good luck today at {company}", "join_checkin": "Did you join {company} today?",
           "rel_reply": "Tell us what happened: {company}", "rel_stay": "Still working at {company}?"},
    "hi": {"book": "इंटरव्यू का समय चुनें: {company} में {role}", "reminder_day": "कल: {company} में {role} का इंटरव्यू",
           "reminder_soon": "जल्द: {company} में {role} का इंटरव्यू", "join_eve": "कल {company} में मिलते हैं",
           "join_morning": "आज {company} में शुभकामनाएँ", "join_checkin": "क्या आपने आज {company} जॉइन किया?",
           "rel_reply": "बताएँ क्या हुआ: {company}", "rel_stay": "क्या आप अभी भी {company} में हैं?"},
    "te": {"book": "ఇంటర్వ్యూ సమయం ఎంచుకోండి: {company}లో {role}", "reminder_day": "రేపు: {company}లో {role} ఇంటర్వ్యూ",
           "reminder_soon": "త్వరలో: {company}లో {role} ఇంటర్వ్యూ", "join_eve": "రేపు {company}లో కలుద్దాం",
           "join_morning": "ఈరోజు {company}లో శుభాకాంక్షలు", "join_checkin": "ఈరోజు {company}లో చేరారా?",
           "rel_reply": "ఏం జరిగిందో చెప్పండి: {company}", "rel_stay": "ఇంకా {company}లో ఉన్నారా?"},
}  # fmt: skip

# Little phrases put inside the templates.
BITS: dict[str, dict[str, str]] = {
    "en": {"tomorrow": "tomorrow, {when}", "soon": "in {hours} hours, at {time}", "at_time": " at {time}", "at_place": " ({place})",
           "where": "Where: {place} · Map: {map}", "online": "Online: {link}", "selfie": "Please also do your joining-day selfie check: {link}"},
    "hi": {"tomorrow": "कल, {when}", "soon": "{hours} घंटे में, {time} बजे", "at_time": ", {time} बजे", "at_place": " ({place})",
           "where": "जगह: {place} · नक्शा: {map}", "online": "ऑनलाइन: {link}", "selfie": "कृपया जॉइनिंग के दिन की सेल्फ़ी जाँच भी करें: {link}"},
    "te": {"tomorrow": "రేపు, {when}", "soon": "{hours} గంటల్లో, {time}కి", "at_time": ", {time}కి", "at_place": " ({place})",
           "where": "చోటు: {place} · మ్యాప్: {map}", "online": "ఆన్‌లైన్: {link}", "selfie": "దయచేసి చేరే రోజు సెల్ఫీ చెక్ కూడా చేయండి: {link}"},
}  # fmt: skip


def fill(s: str, **kw: object) -> str:
    for k, v in kw.items():
        s = s.replace("{" + k + "}", str(v))
    return s


def bit(lang: str, key: str, **kw: object) -> str:
    return fill((BITS.get(lang) or BITS["en"])[key], **kw)


def render(lang: str, kind: str, params: list[str]) -> str:
    """The template as the person reads it (the email body; the test provider's record)."""
    body = (TEMPLATES.get(lang) or TEMPLATES["en"])[kind]
    for i, p in enumerate(params, 1):
        body = body.replace("{{" + str(i) + "}}", p)
    return body


def subject(lang: str, key: str, **kw: object) -> str:
    return fill((SUBJECTS.get(lang) or SUBJECTS["en"])[key], **kw)


def all_texts() -> list[str]:
    out: list[str] = []
    for d in (TEMPLATES, SUBJECTS, BITS):
        for lang in d.values():
            out += list(lang.values())
    return out
