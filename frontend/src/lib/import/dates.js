// Finds and normalises date ranges in resume text ("Feb 2020 – Jun 2024", "2017 - 2022", "06/2023 - Present", "Jun'23").
const MON = { jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, sept: 9, oct: 10, nov: 11, dec: 12 };
const MONTH = '(?:jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|june?|july?|aug(?:ust)?|sep(?:t(?:ember)?)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)';
const ONE = `(?:${MONTH}\\.?[\\s,'’-]*\\d{2,4}|\\d{1,2}[/.-]\\d{4}|(?:19|20)\\d{2})`;
const NOW = '(?:present|current(?:ly)?|till\\s*date|to\\s*date|now|ongoing|pursuing|expected\\s+' + ONE + ')';
export const RANGE_RE = new RegExp(`(${ONE})\\s*(?:–|—|-|−|to|till|until)\\s*(${ONE}|${NOW})`, 'i');
export const SINGLE_RE = new RegExp(`(${ONE})`, 'i');

const pad = (n) => String(n).padStart(2, '0');
function fullYear(y) { const n = parseInt(y, 10); return y.length === 2 ? (n > 50 ? 1900 + n : 2000 + n) : n; }

/** "Feb 2020" → "2020-02", "2017" → "2017" (year only stays year only), "06/2023" → "2023-06" */
export function normDate(s) {
  if (!s) return '';
  const t = s.trim().toLowerCase().replace(/[’']/g, ' ');
  let m = t.match(new RegExp(`^(${MONTH})\\.?[\\s,-]*(\\d{2,4})$`, 'i'));
  if (m) return `${fullYear(m[2])}-${pad(MON[m[1].slice(0, 4) === 'sept' ? 'sept' : m[1].slice(0, 3)])}`;
  m = t.match(/^(\d{1,2})[/.-](\d{4})$/);
  if (m && +m[1] >= 1 && +m[1] <= 12) return `${m[2]}-${pad(m[1])}`;
  m = t.match(/^((?:19|20)\d{2})$/);
  if (m) return m[1];
  return '';
}

/** Finds the first date range (or a single date) in a string. */
export function findDates(text) {
  const r = text.match(RANGE_RE);
  if (r) {
    const endRaw = r[2];
    const current = new RegExp(`^${NOW}$`, 'i').test(endRaw.trim()) && !/^expected/i.test(endRaw.trim());
    const expected = endRaw.match(/^expected\s+(.*)$/i);
    return { from: normDate(r[1]), to: current ? '' : normDate(expected ? expected[1] : endRaw), current, raw: r[0], index: r.index };
  }
  const s = text.match(new RegExp(`(?:^|[\\s(·,|–-])(${MONTH}\\.?[\\s,'’-]*\\d{2,4}|\\d{1,2}/\\d{4}|(?:19|20)\\d{2})(?=$|[\\s),.·|])`, 'i'));
  if (s) return { from: '', to: normDate(s[1]), current: false, raw: s[1], index: s.index + s[0].indexOf(s[1]), single: true };
  return null;
}

/** Removes a found date (and any brackets / separators left around it). */
export function stripDate(text, found) {
  if (!found) return text;
  return text.replace(found.raw, ' ').replace(/[([]\s*[)\]]/g, ' ').replace(/\s*[·|,–-]\s*$/g, '').replace(/^\s*[·|,–-]\s*/g, '').replace(/\s+/g, ' ').trim();
}

/** Months between two YYYY-MM values (to = today when current). */
export function monthsBetween(from, to) {
  if (!from) return 0;
  const [fy, fm = '06'] = from.split('-');
  const now = new Date();
  const [ty, tm = '06'] = (to || `${now.getFullYear()}-${pad(now.getMonth() + 1)}`).split('-');
  return Math.max(0, (+ty - +fy) * 12 + (+tm - +fm) + 1);
}
