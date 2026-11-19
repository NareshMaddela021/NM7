// Vetting V1 strings for the level badge and the company Hire now / Applicants additions, in English, Telugu and Hindi.
// They live here (not in src/i18n/pages.json) so they load only with the company pages: pages.json's English is in
// the main bundle and its Telugu / Hindi count towards the Easy dashboard's 150 KB budget (scripts/simple-budget.mjs).
// Telugu and Hindi are AI drafts and NEED NATIVE REVIEW. A missing string falls back to English.
import { translate } from '../lib/i18n';

export const LV_STRINGS = {
  en: {
    'lv.0': 'Signed up', 'lv.1': 'Profile ready', 'lv.2': 'Skill verified', 'lv.3': 'Interview-ready', 'lv.4': 'Nm7 verified',
    'lv.level': 'Level {n} of 4', 'lv.ready': 'Ready now', 'lv.readyTip': 'Confirmed in the last 7 days that they can join now',
    'lv.readiness': 'Readiness {n}/100', 'lv.why': 'Why this score', 'lv.whyOf': '{got} of {max}',
    'lv.p.skill': 'Skill match', 'lv.p.level': 'Level', 'lv.p.reliability': 'Reliability', 'lv.p.freshness': 'Confirmed recently',
    'lv.p.salary': 'Salary fit', 'lv.p.distance': 'Can work where the job is',
    'lv.f.legend': 'Level and availability', 'lv.f.min': 'Minimum level', 'lv.f.anyLevel': 'Any level', 'lv.f.atLeast': 'L{n} {label} or higher',
    'lv.f.ready': 'Ready now only', 'lv.f.notice': 'Notice period at most', 'lv.f.anyNotice': 'Any notice period',
    'lv.f.days': '{n} days', 'lv.f.zero': 'Can join now (0 days)', 'lv.f.salary': 'Salary at most (₹ a month)', 'lv.f.salaryPh': 'e.g. 30000',
    'lv.f.city': 'City', 'lv.f.cityPh': 'e.g. Hyderabad', 'lv.f.band': 'Experience', 'lv.f.anyBand': 'Any experience',
    'lv.b.fresher': 'Fresher', 'lv.b.1-3': '1–3 years', 'lv.b.3-5': '3–5 years', 'lv.b.5-8': '5–8 years', 'lv.b.8+': '8+ years',
    'lv.f.clear': 'Clear the filters',
  },
  te: {
    'lv.0': 'సైన్ అప్ అయ్యారు', 'lv.1': 'ప్రొఫైల్ సిద్ధం', 'lv.2': 'నైపుణ్యం ధృవీకరించబడింది', 'lv.3': 'ఇంటర్వ్యూకి సిద్ధం', 'lv.4': 'Nm7 ధృవీకరించింది',
    'lv.level': '4లో లెవెల్ {n}', 'lv.ready': 'ఇప్పుడే సిద్ధం', 'lv.readyTip': 'ఇప్పుడే చేరగలమని గత 7 రోజుల్లో నిర్ధారించారు',
    'lv.readiness': 'సంసిద్ధత {n}/100', 'lv.why': 'ఈ స్కోర్ ఎందుకు', 'lv.whyOf': '{max}లో {got}',
    'lv.p.skill': 'నైపుణ్య సరిపోలిక', 'lv.p.level': 'లెవెల్', 'lv.p.reliability': 'విశ్వసనీయత', 'lv.p.freshness': 'ఇటీవల నిర్ధారించారు',
    'lv.p.salary': 'జీతం సరిపోలిక', 'lv.p.distance': 'ఉద్యోగం ఉన్న చోట పని చేయగలరు',
    'lv.f.legend': 'లెవెల్ మరియు అందుబాటు', 'lv.f.min': 'కనీస లెవెల్', 'lv.f.anyLevel': 'ఏ లెవెల్ అయినా', 'lv.f.atLeast': 'L{n} {label} లేదా పైన',
    'lv.f.ready': 'ఇప్పుడే సిద్ధం ఉన్నవారు మాత్రమే', 'lv.f.notice': 'నోటీస్ పీరియడ్ గరిష్టంగా', 'lv.f.anyNotice': 'ఏ నోటీస్ పీరియడ్ అయినా',
    'lv.f.days': '{n} రోజులు', 'lv.f.zero': 'ఇప్పుడే చేరగలరు (0 రోజులు)', 'lv.f.salary': 'జీతం గరిష్టంగా (నెలకు ₹)', 'lv.f.salaryPh': 'ఉదా. 30000',
    'lv.f.city': 'నగరం', 'lv.f.cityPh': 'ఉదా. హైదరాబాద్', 'lv.f.band': 'అనుభవం', 'lv.f.anyBand': 'ఏ అనుభవం అయినా',
    'lv.b.fresher': 'ఫ్రెషర్', 'lv.b.1-3': '1–3 సంవత్సరాలు', 'lv.b.3-5': '3–5 సంవత్సరాలు', 'lv.b.5-8': '5–8 సంవత్సరాలు', 'lv.b.8+': '8+ సంవత్సరాలు',
    'lv.f.clear': 'ఫిల్టర్లు తీసివేయండి',
  },
  hi: {
    'lv.0': 'साइन अप किया', 'lv.1': 'प्रोफ़ाइल तैयार', 'lv.2': 'कौशल सत्यापित', 'lv.3': 'इंटरव्यू के लिए तैयार', 'lv.4': 'Nm7 सत्यापित',
    'lv.level': '4 में से लेवल {n}', 'lv.ready': 'अभी तैयार', 'lv.readyTip': 'पिछले 7 दिनों में पुष्टि की कि वे अभी जुड़ सकते हैं',
    'lv.readiness': 'तैयारी {n}/100', 'lv.why': 'यह स्कोर क्यों', 'lv.whyOf': '{max} में से {got}',
    'lv.p.skill': 'कौशल मिलान', 'lv.p.level': 'लेवल', 'lv.p.reliability': 'भरोसेमंदी', 'lv.p.freshness': 'हाल ही में पुष्टि की',
    'lv.p.salary': 'वेतन मेल', 'lv.p.distance': 'नौकरी की जगह पर काम कर सकते हैं',
    'lv.f.legend': 'लेवल और उपलब्धता', 'lv.f.min': 'न्यूनतम लेवल', 'lv.f.anyLevel': 'कोई भी लेवल', 'lv.f.atLeast': 'L{n} {label} या ऊपर',
    'lv.f.ready': 'केवल अभी तैयार', 'lv.f.notice': 'नोटिस अवधि अधिकतम', 'lv.f.anyNotice': 'कोई भी नोटिस अवधि',
    'lv.f.days': '{n} दिन', 'lv.f.zero': 'अभी जुड़ सकते हैं (0 दिन)', 'lv.f.salary': 'वेतन अधिकतम (₹ प्रति माह)', 'lv.f.salaryPh': 'जैसे 30000',
    'lv.f.city': 'शहर', 'lv.f.cityPh': 'जैसे हैदराबाद', 'lv.f.band': 'अनुभव', 'lv.f.anyBand': 'कोई भी अनुभव',
    'lv.b.fresher': 'फ्रेशर', 'lv.b.1-3': '1–3 साल', 'lv.b.3-5': '3–5 साल', 'lv.b.5-8': '5–8 साल', 'lv.b.8+': '8+ साल',
    'lv.f.clear': 'फ़िल्टर हटाएँ',
  },
};

/** lt(lang)('lv.ready') -> the string in that language, else English. */
export const lt = (lang = 'en') => (key, vars) => translate(lang, key, vars, LV_STRINGS);

export const BANDS = ['fresher', '1-3', '3-5', '5-8', '8+'];
export const NOTICE = [-1, 0, 15, 30, 60, 90];
export const PART_MAX = { skill: 35, level: 25, reliability: 15, freshness: 10, salary: 10, distance: 5 };
