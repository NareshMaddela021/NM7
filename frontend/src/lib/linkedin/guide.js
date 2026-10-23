// "Create your LinkedIn", step by step, in English, Telugu and Hindi. The profile text itself (headline, skills)
// is always English: LinkedIn recruiters search in English. Steps with text to paste get a Copy button.
// NEED NATIVE REVIEW: the Telugu and Hindi wording below was written without a native speaker; have it checked
// before it is promoted.

export const LANGS = [
  { id: 'en', label: 'English' },
  { id: 'te', label: 'తెలుగు', review: true },
  { id: 'hi', label: 'हिन्दी', review: true },
];
export const NEEDS_REVIEW = { te: true, hi: true };
export const REVIEW_NOTE = 'NEED NATIVE REVIEW';

/** Paid parts (Phase 2): shown locked, "Coming soon", never a checkout. */
export const LOCKED = [
  { id: 'about', title: 'Full About section written for you' },
  { id: 'experience', title: 'Experience entries rewritten' },
  { id: 'profile', title: 'Your complete profile text, ready to paste' },
  { id: 'banner', title: 'A banner image for your field' },
];
export const COMING_SOON = 'Coming soon';

const T = {
  signup: {
    en: ['Sign up', 'Go to linkedin.com (or open the LinkedIn app) and tap Join now. Use your real name as on your certificates, and an email you check often.'],
    te: ['సైన్ అప్ చేయండి', 'linkedin.com కి వెళ్ళండి (లేదా LinkedIn యాప్ తెరవండి), Join now నొక్కండి. మీ సర్టిఫికెట్లలో ఉన్న అసలు పేరు, మీరు తరచూ చూసే ఈమెయిల్ వాడండి.'],
    hi: ['साइन अप करें', 'linkedin.com पर जाएँ (या LinkedIn ऐप खोलें) और Join now दबाएँ। अपने सर्टिफिकेट वाला असली नाम और वह ईमेल डालें जो आप अक्सर देखते हैं।'],
  },
  photo: {
    en: ['Add a photo', 'A clear, recent photo of your face: plain background, good light, you looking at the camera. No group photos or sunglasses.'],
    te: ['ఫోటో పెట్టండి', 'మీ ముఖం స్పష్టంగా కనిపించే ఇటీవలి ఫోటో: సాదా బ్యాక్‌గ్రౌండ్, మంచి వెలుతురు, కెమెరా వైపు చూస్తూ. గ్రూప్ ఫోటోలు, కూలింగ్ గ్లాసెస్ వద్దు.'],
    hi: ['फ़ोटो लगाएँ', 'अपने चेहरे की साफ़, हाल की फ़ोटो: सादा बैकग्राउंड, अच्छी रोशनी, कैमरे की तरफ़ देखते हुए। ग्रुप फ़ोटो या धूप का चश्मा नहीं।'],
  },
  headline: {
    en: ['Write your headline', 'Profile > the pencil next to your name > Headline. Paste one of your headlines (at most 220 characters).'],
    te: ['హెడ్‌లైన్ రాయండి', 'Profile > మీ పేరు పక్కన పెన్సిల్ > Headline. మీ హెడ్‌లైన్‌లలో ఒకటి పేస్ట్ చేయండి (220 అక్షరాల లోపు).'],
    hi: ['हेडलाइन लिखें', 'Profile > अपने नाम के पास पेंसिल > Headline. अपनी कोई एक हेडलाइन पेस्ट करें (ज़्यादा से ज़्यादा 220 अक्षर)।'],
  },
  about: {
    en: ['Write your About', 'Profile > Add profile section > About. 3 short paragraphs: the role you want, what you can do (with your skills and a real project), and what you are looking for. At most 2,600 characters.'],
    te: ['About రాయండి', 'Profile > Add profile section > About. 3 చిన్న పేరాలు: మీకు కావలసిన ఉద్యోగం, మీరు ఏమి చేయగలరు (మీ స్కిల్స్, ఒక నిజమైన ప్రాజెక్ట్‌తో), మీరు ఏమి వెతుకుతున్నారు. 2,600 అక్షరాల లోపు.'],
    hi: ['About लिखें', 'Profile > Add profile section > About. 3 छोटे पैराग्राफ़: आपको कौन-सी नौकरी चाहिए, आप क्या कर सकते हैं (अपनी स्किल्स और एक असली प्रोजेक्ट के साथ), और आप क्या ढूँढ रहे हैं। ज़्यादा से ज़्यादा 2,600 अक्षर।'],
  },
  experience: {
    en: ['Add experience', 'Profile > Add profile section > Experience. Add each job or internship with its title and company. No job yet? Add a college project or volunteering instead. At most 2,000 characters each.'],
    te: ['అనుభవం జోడించండి', 'Profile > Add profile section > Experience. ప్రతి ఉద్యోగం లేదా ఇంటర్న్‌షిప్‌ను దాని పేరు, కంపెనీతో జోడించండి. ఇంకా ఉద్యోగం లేదా? కాలేజీ ప్రాజెక్ట్ లేదా వాలంటీర్ పని జోడించండి. ఒక్కోదానికి 2,000 అక్షరాల లోపు.'],
    hi: ['अनुभव जोड़ें', 'Profile > Add profile section > Experience. हर नौकरी या इंटर्नशिप उसके पद और कंपनी के साथ जोड़ें। अभी नौकरी नहीं है? कॉलेज प्रोजेक्ट या वॉलंटियर काम जोड़ें। हर एक में ज़्यादा से ज़्यादा 2,000 अक्षर।'],
  },
  skills: {
    en: ['Add skills', 'Profile > Add profile section > Skills. Add 10 or more skills you really have, the ones for your target role first. Pin your top 3.'],
    te: ['స్కిల్స్ జోడించండి', 'Profile > Add profile section > Skills. మీకు నిజంగా ఉన్న 10 లేదా అంతకంటే ఎక్కువ స్కిల్స్ జోడించండి, మీ లక్ష్య ఉద్యోగానికి సంబంధించినవి ముందు. ముఖ్యమైన 3 పైన ఉంచండి.'],
    hi: ['स्किल्स जोड़ें', 'Profile > Add profile section > Skills. 10 या ज़्यादा स्किल्स जोड़ें जो आपके पास सच में हैं, अपनी लक्ष्य नौकरी वाली पहले। सबसे ज़रूरी 3 ऊपर रखें।'],
  },
  openToWork: {
    en: ['Turn on Open to Work', 'Profile > Open to > Finding a new job. Add your target roles and cities. Choose "Recruiters only" if you don\'t want the green photo frame.'],
    te: ['Open to Work ఆన్ చేయండి', 'Profile > Open to > Finding a new job. మీ లక్ష్య ఉద్యోగాలు, నగరాలు జోడించండి. ఫోటో చుట్టూ ఆకుపచ్చ ఫ్రేమ్ వద్దంటే "Recruiters only" ఎంచుకోండి.'],
    hi: ['Open to Work चालू करें', 'Profile > Open to > Finding a new job. अपनी लक्ष्य नौकरियाँ और शहर जोड़ें। फ़ोटो पर हरा फ्रेम नहीं चाहिए तो "Recruiters only" चुनें।'],
  },
};
export const STEP_IDS = ['signup', 'photo', 'headline', 'about', 'experience', 'skills', 'openToWork'];

/** Text to copy for a step (always English), or '' when the step has none. */
function copyFor(id, c) {
  if (id === 'headline') return c.headline || '';
  if (id === 'skills') return (c.skills || []).join(', ');
  if (id === 'experience') return (c.experience || []).map((e) => [e.title, e.company].filter(Boolean).join(' at ')).filter(Boolean).join('\n');
  if (id === 'openToWork') return c.role || '';
  return '';
}

/**
 * The steps in a language, with copy text from `content` ({ headline, skills, experience, role }).
 * Experience is left out when the person has none. → [{ id, n, title, body, copy, locked, review }]
 */
export function guideSteps(lang = 'en', content = {}) {
  const l = T.signup[lang] ? lang : 'en';
  return STEP_IDS
    .filter((id) => id !== 'experience' || (content.experience || []).length)
    .map((id, i) => ({
      id, n: i + 1, title: T[id][l][0], body: T[id][l][1],
      copy: copyFor(id, content), locked: id === 'about' ? LOCKED[0] : null, review: !!NEEDS_REVIEW[l],
    }));
}
