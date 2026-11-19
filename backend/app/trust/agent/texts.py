# ruff: noqa: E501, RUF001  (message texts in three languages)
"""What the agent says, in English, Hindi and Telugu: the WhatsApp templates (to submit to Meta for approval), the
in-conversation messages, the AI call script, and the words that mean Stop / Yes / No / Interested / Not now.

Templates are category UTILITY (a transactional update about a job the person asked to hear about), never MARKETING.
Hindi and Telugu texts need a native speaker's check before they are submitted to Meta (see the PR).
Never anything about payments: Nm7 never asks for money on WhatsApp or a call (a test checks every text here).
"""

import re
import unicodedata

LANGS = {"en": "English", "hi": "हिन्दी (Hindi)", "te": "తెలుగు (Telugu)"}

# The one template that opens a conversation (Meta: a template is needed outside the 24-hour reply window).
# {{1}} first name · {{2}} job title · {{3}} company · {{4}} city or "Remote"
TEMPLATE_NAME = "nm7_job_match"
TEMPLATES: dict[str, dict] = {
    "en": {
        "body": "Hi {{1}}, a new job on Nm7 matches your profile: {{2}} at {{3}} ({{4}}). Are you interested? If you tap Interested, we share your resume with {{3}} and ask 1–3 quick questions. Reply STOP any time and we won't message you again.",
        "buttons": ["Interested", "Not now", "Stop"],
        "footer": "Nm7 · You chose job messages on WhatsApp",
    },
    "hi": {
        "body": 'नमस्ते {{1}}, Nm7 पर एक नई नौकरी आपकी प्रोफ़ाइल से मेल खाती है: {{3}} में {{2}} ({{4}})। क्या आप इच्छुक हैं? Interested दबाने पर हम आपका रिज़्यूमे {{3}} के साथ साझा करेंगे और 1–3 छोटे सवाल पूछेंगे। कभी भी STOP या "बंद करो" लिखें, हम फिर संदेश नहीं भेजेंगे।',
        "buttons": ["Interested", "अभी नहीं", "Stop"],
        "footer": "Nm7 · आपने WhatsApp पर नौकरी संदेश चुने हैं",
    },
    "te": {
        "body": 'నమస్తే {{1}}, Nm7లో ఒక కొత్త ఉద్యోగం మీ ప్రొఫైల్‌కు సరిపోతుంది: {{3}}లో {{2}} ({{4}}). మీకు ఆసక్తి ఉందా? Interested నొక్కితే మీ రెజ్యూమ్‌ను {{3}}కి పంపి, 1–3 చిన్న ప్రశ్నలు అడుగుతాం. ఎప్పుడైనా STOP లేదా "ఆపు" అని పంపండి, మళ్ళీ మెసేజ్ చేయం.',
        "buttons": ["Interested", "ఇప్పుడు కాదు", "Stop"],
        "footer": "Nm7 · మీరు WhatsAppలో ఉద్యోగ సందేశాలు ఎంచుకున్నారు",
    },
}
BUTTON_KEYS = ["interested", "not_now", "stop"]  # the payload of each quick-reply button, in order

# Messages inside the conversation (the 24-hour window the candidate's reply opens). {x} placeholders.
MSG: dict[str, dict[str, str]] = {
    "en": {
        "question": "Question {n} of {of}: {q}",
        "slots": "Thanks! {company} has these interview times. Reply with the number:\n{list}\n(Or reply 0 if none suits you.)",
        "booked": "Booked: interview for {role} at {company} on {when}. Details and a calendar file are in your email and on Nm7 → Ready to join.",
        "no_slots": "Thanks! Your answers are with {company}. They will send you interview times on Nm7.",
        "not_fit": "Thanks for answering. {company} asked for a few things that don't match your answers, so we've passed them on and they decide. You can still see the job on Nm7.",
        "not_now": "No problem. We won't message you about this job again.",
        "stopped": "Done: you won't get WhatsApp messages from Nm7 any more. To turn them back on: Nm7 → Profile & settings → Calls & WhatsApp.",
        "stopped_call": "Done: Nm7 won't call you any more. To turn calls back on: Nm7 → Profile & settings → Calls & WhatsApp.",
        "unclear": "Sorry, I didn't get that. Please reply {options}.",
        "yes_no": "Yes or No",
        "slot_pick": "with the number of a time (or 0)",
        "interest": "Interested or Not now",
        "taken": "That time was just taken. Here are the times still open:\n{list}",
        "none_suits": "OK. {company} will see your answers and can send you other times on Nm7.",
        "closed": "This job is no longer open. We'll message you when another one fits.",
    },
    "hi": {
        "question": "सवाल {n}/{of}: {q}",
        "slots": "धन्यवाद! {company} के पास ये इंटरव्यू समय हैं। नंबर लिखकर भेजें:\n{list}\n(कोई समय ठीक नहीं तो 0 भेजें।)",
        "booked": "बुक हो गया: {company} में {role} का इंटरव्यू {when}। जानकारी और कैलेंडर फ़ाइल आपके ईमेल और Nm7 → Ready to join में है।",
        "no_slots": "धन्यवाद! आपके जवाब {company} को भेज दिए गए हैं। वे Nm7 पर इंटरव्यू का समय भेजेंगे।",
        "not_fit": "जवाब देने के लिए धन्यवाद। {company} ने कुछ बातें माँगी हैं जो आपके जवाबों से मेल नहीं खातीं; हमने जवाब भेज दिए हैं, फ़ैसला वे करेंगे। आप Nm7 पर नौकरी देख सकते हैं।",
        "not_now": "ठीक है। इस नौकरी के बारे में हम फिर संदेश नहीं भेजेंगे।",
        "stopped": "हो गया: अब आपको Nm7 से WhatsApp संदेश नहीं आएँगे। फिर से चालू करने के लिए: Nm7 → Profile & settings → Calls & WhatsApp।",
        "stopped_call": "हो गया: Nm7 अब आपको कॉल नहीं करेगा। फिर से चालू करने के लिए: Nm7 → Profile & settings → Calls & WhatsApp।",
        "unclear": "माफ़ कीजिए, समझ नहीं आया। कृपया {options} लिखें।",
        "yes_no": "हाँ या नहीं",
        "slot_pick": "समय का नंबर (या 0)",
        "interest": "Interested या अभी नहीं",
        "taken": "वह समय अभी किसी और ने ले लिया। ये समय अभी खाली हैं:\n{list}",
        "none_suits": "ठीक है। {company} आपके जवाब देखेगा और Nm7 पर दूसरे समय भेज सकता है।",
        "closed": "यह नौकरी अब खुली नहीं है। कोई और मेल खाएगी तो हम बताएँगे।",
    },
    "te": {
        "question": "ప్రశ్న {n}/{of}: {q}",
        "slots": "ధన్యవాదాలు! {company} దగ్గర ఈ ఇంటర్వ్యూ సమయాలు ఉన్నాయి. నంబర్ పంపండి:\n{list}\n(ఏదీ సరిపోకపోతే 0 పంపండి.)",
        "booked": "బుక్ అయింది: {company}లో {role} ఇంటర్వ్యూ {when}. వివరాలు, క్యాలెండర్ ఫైల్ మీ ఈమెయిల్‌లో మరియు Nm7 → Ready to joinలో ఉన్నాయి.",
        "no_slots": "ధన్యవాదాలు! మీ సమాధానాలు {company}కి పంపాం. వాళ్ళు Nm7లో ఇంటర్వ్యూ సమయాలు పంపుతారు.",
        "not_fit": "సమాధానాలకు ధన్యవాదాలు. {company} అడిగిన కొన్ని విషయాలు మీ సమాధానాలతో సరిపోలలేదు; మేము వాటిని పంపాం, నిర్ణయం వాళ్ళదే. Nm7లో ఉద్యోగం చూడవచ్చు.",
        "not_now": "సరే. ఈ ఉద్యోగం గురించి మళ్ళీ మెసేజ్ చేయం.",
        "stopped": "అయింది: ఇకపై Nm7 నుండి WhatsApp మెసేజ్‌లు రావు. మళ్ళీ ఆన్ చేయడానికి: Nm7 → Profile & settings → Calls & WhatsApp.",
        "stopped_call": "అయింది: Nm7 ఇకపై మీకు కాల్ చేయదు. మళ్ళీ ఆన్ చేయడానికి: Nm7 → Profile & settings → Calls & WhatsApp.",
        "unclear": "క్షమించండి, అర్థం కాలేదు. దయచేసి {options} పంపండి.",
        "yes_no": "అవును లేదా కాదు",
        "slot_pick": "సమయం నంబర్ (లేదా 0)",
        "interest": "Interested లేదా ఇప్పుడు కాదు",
        "taken": "ఆ సమయం ఇప్పుడే వేరొకరు తీసుకున్నారు. ఇంకా ఖాళీగా ఉన్నవి:\n{list}",
        "none_suits": "సరే. {company} మీ సమాధానాలు చూసి Nm7లో వేరే సమయాలు పంపవచ్చు.",
        "closed": "ఈ ఉద్యోగం ఇప్పుడు తెరిచి లేదు. వేరేది సరిపోతే చెబుతాం.",
    },
}
YES_NO_BUTTONS = {"en": ["Yes", "No"], "hi": ["हाँ", "नहीं"], "te": ["అవును", "కాదు"]}

# The AI call: what the voice agent says (the provider's agent reads these; it must say it is an AI, at the start).
CALL: dict[str, dict[str, str]] = {
    "en": {
        "intro": "Hello {name}, this is Nm7's AI assistant, an automated call, about a job you may like: {role} at {company} in {city}. This call is not recorded; we keep a written note of what we say so you can read it on Nm7. Say stop at any time and we won't call again.",
        "interest": "Are you interested in this job? Please say yes or no.",
        "question": "{q} Please say yes or no.",
        "slots": "{company} has these interview times: {list}. Which one suits you? Say the number, or say none.",
        "booked": "Your interview is booked for {when}. You'll get the details by email. Thank you, goodbye.",
        "bye": "Thank you for your time. Goodbye.",
        "stopped": "OK, Nm7 won't call you again. Goodbye.",
    },
    "hi": {
        "intro": 'नमस्ते {name}, मैं Nm7 की AI सहायक हूँ, यह एक ऑटोमैटिक कॉल है, एक नौकरी के बारे में: {city} में {company} में {role}। यह कॉल रिकॉर्ड नहीं होती; हम जो कहते हैं उसका लिखित नोट रखते हैं ताकि आप Nm7 पर पढ़ सकें। कभी भी "बंद करो" कहें, हम फिर कॉल नहीं करेंगे।',
        "interest": "क्या आप इस नौकरी में इच्छुक हैं? कृपया हाँ या नहीं कहें।",
        "question": "{q} कृपया हाँ या नहीं कहें।",
        "slots": "{company} के पास ये इंटरव्यू समय हैं: {list}। कौन-सा ठीक है? नंबर बताइए, या कहिए कोई नहीं।",
        "booked": "आपका इंटरव्यू {when} के लिए बुक हो गया है। जानकारी ईमेल पर आएगी। धन्यवाद।",
        "bye": "आपके समय के लिए धन्यवाद।",
        "stopped": "ठीक है, Nm7 आपको फिर कॉल नहीं करेगा। धन्यवाद।",
    },
    "te": {
        "intro": 'నమస్తే {name}, నేను Nm7 AI అసిస్టెంట్‌ని, ఇది ఆటోమేటిక్ కాల్, మీకు నచ్చే ఒక ఉద్యోగం గురించి: {city}లో {company}లో {role}. ఈ కాల్ రికార్డ్ చేయడం లేదు; మేము చెప్పినది Nm7లో మీరు చదవడానికి రాతపూర్వకంగా ఉంచుతాం. ఎప్పుడైనా "ఆపు" అని చెప్పండి, మళ్ళీ కాల్ చేయం.',
        "interest": "ఈ ఉద్యోగంపై మీకు ఆసక్తి ఉందా? దయచేసి అవును లేదా కాదు అని చెప్పండి.",
        "question": "{q} దయచేసి అవును లేదా కాదు అని చెప్పండి.",
        "slots": "{company} దగ్గర ఈ ఇంటర్వ్యూ సమయాలు ఉన్నాయి: {list}. ఏది సరిపోతుంది? నంబర్ చెప్పండి, లేదా ఏదీ వద్దు అనండి.",
        "booked": "మీ ఇంటర్వ్యూ {when}కి బుక్ అయింది. వివరాలు ఈమెయిల్‌లో వస్తాయి. ధన్యవాదాలు.",
        "bye": "మీ సమయానికి ధన్యవాదాలు.",
        "stopped": "సరే, Nm7 మళ్ళీ కాల్ చేయదు. ధన్యవాదాలు.",
    },
}


def fill(s: str, **kw: object) -> str:
    for k, v in kw.items():
        s = s.replace("{" + k + "}", str(v))
    return s


def msg(lang: str, key: str, **kw: object) -> str:
    return fill((MSG.get(lang) or MSG["en"]).get(key) or MSG["en"][key], **kw)


def template_text(lang: str, params: list[str]) -> str:
    """The template as the candidate sees it (for "What we said")."""
    body = (TEMPLATES.get(lang) or TEMPLATES["en"])["body"]
    for i, p in enumerate(params, 1):
        body = body.replace("{{" + str(i) + "}}", p)
    return body


# --- reading replies (rules first) -----------------------------------------------------------------------------------

# Any of these, alone or as the whole point of a message, stops that channel at once (all three languages, the Latin
# spellings people type on WhatsApp, and the scripts).
STOP_WORDS = [
    "stop", "stop it", "unsubscribe", "opt out", "optout", "dont message", "don't message", "do not message",
    "dont call", "don't call", "do not call", "no more messages", "remove me", "block",
    "band karo", "band kar do", "band kardo", "bandh karo", "bas karo", "mat bhejo", "message mat karo", "call mat karo",
    "बंद करो", "बंद कर दो", "बंद", "मत भेजो", "कॉल मत करो", "मैसेज मत करो",
    "aapu", "aapandi", "apu", "aapeyandi", "message cheyakandi", "call cheyakandi",
    "ఆపు", "ఆపండి", "ఆపేయండి", "మెసేజ్ చేయకండి", "కాల్ చేయకండి",
]  # fmt: skip
YES_WORDS = ["yes", "y", "yeah", "yep", "ok", "okay", "sure", "haan", "han", "ha", "haa", "ji", "ji haan", "हाँ", "हां", "जी", "जी हाँ",
             "avunu", "aunu", "sare", "అవును", "సరే", "interested", "i am interested", "im interested"]  # fmt: skip
NO_WORDS = ["no", "n", "nope", "nahi", "nahin", "nai", "नहीं", "नही", "ledu", "kadu", "kaadu", "లేదు", "కాదు"]
NOT_NOW_WORDS = ["not now", "later", "not interested", "no thanks", "abhi nahi", "abhi nahin", "अभी नहीं", "नहीं चाहिए",
                 "ippudu kaadu", "ippudu kadu", "vaddu", "ఇప్పుడు కాదు", "వద్దు", "అవసరం లేదు"]  # fmt: skip
NONE_WORDS = ["0", "none", "no time", "koi nahi", "कोई नहीं", "edi vaddu", "ఏదీ వద్దు", "ఏదీ కాదు"]


def norm(text: str) -> str:
    s = unicodedata.normalize("NFC", text or "").strip().lower()
    s = re.sub(r"[\s‌‍]+", " ", s)
    return re.sub(r"[.!?,।:;\"'“”‘’()\[\]*_~-]+$", "", re.sub(r"^[.!?,।:;\"'“”‘’()\[\]*_~-]+", "", s)).strip()


def _words(s: str) -> str:
    return " " + re.sub(r"[.!?,।:;\"“”‘’()\[\]*_~]+", " ", s) + " "


def is_stop(text: str) -> bool:
    """A Stop in English, Hindi or Telugu: the whole message, or a stop phrase in a short message ("pls stop",
    "please band karo", up to 4 words). A longer message that only mentions stopping ("my bus stop is near the office")
    isn't read as one by the rules (the AI reader may still read it as Stop)."""
    s = norm(text)
    if not s:
        return False
    if s in STOP_WORDS:
        return True
    if len(s.split()) > 4:
        return False
    w = _words(s)
    return any(f" {p} " in w for p in STOP_WORDS if p not in ("block", "बंद"))


def rules_intent(text: str, expecting: str) -> tuple[str, int]:
    """(intent, slot number) from the rules alone: stop · interested · not_now · yes · no · slot · none · unclear.
    `expecting`: interest | yesno | slot (what the last message asked)."""
    s = norm(text)
    if is_stop(s):
        return "stop", 0
    if expecting == "slot":
        if s in NONE_WORDS:
            return "none", 0
        m = re.fullmatch(r"(?:#|no\.?\s*|number\s*|option\s*)?([1-9])", s)
        if m:
            return "slot", int(m.group(1))
        return "unclear", 0
    if s in NOT_NOW_WORDS:
        return "not_now", 0
    if s in YES_WORDS:
        return ("interested" if expecting == "interest" else "yes"), 0
    if s in NO_WORDS:
        return ("not_now" if expecting == "interest" else "no"), 0
    return "unclear", 0


def all_texts() -> list[str]:
    """Every text the agent can send (tests check none mentions payments)."""
    out: list[str] = []
    for t in TEMPLATES.values():
        out += [t["body"], t["footer"], *t["buttons"]]
    for d in (MSG, CALL):
        for lang in d.values():
            out += list(lang.values())
    return out
