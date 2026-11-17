// Help & rules for experts: style guide, checklist, re-do/refund rules, privacy.
import { ExpertPage } from './ExpertFrame';
import { MeCard } from '../me/kit';
import { PROMISES, FEES } from '../../lib/pricing';

const SECTIONS = [
  ['How an order works', ['Accept the offer within 30 minutes.', 'Read the brief: target role, wins, the job description and their original resume (already filled into the builder).', 'Ask for missing numbers in Messages early — it saves a revision.', 'Send draft 1 with a short note. The customer comments on sections; fix and send again.', `Deliver the final (PDF + Word + into their builder) within ${PROMISES.delivery}. It auto-approves ${PROMISES.autoApproveDays} after delivery.`]],
  ['Style guide', ['One page for 0–3 years. One column, standard headings, no tables or text boxes.', 'Every bullet: action verb + what you did + result with a number.', 'Summary: 3–4 sentences, target role in the first line, one result.', 'Skills: only what the customer can talk about in an interview; match the job description wording.', 'Indian formats (Kio / Formal) only when the customer applies to govt, PSU or asks for it.']],
  ['Quality checklist (needed to send)', ['ATS-safe layout', 'Numbers / results in most bullets', 'No spelling or grammar mistakes', 'Matches the target role and job description', 'One page for 0–3 years']],
  ['Re-dos and refunds', ['Late delivery = automatic full refund, and the order isn’t paid.', 'Quality complaint = you do one free re-do within 24 hours. If it still isn’t right, our team decides within 24 hours.', `Fees: ${FEES.platformPct}% platform fee + ${FEES.gstPct}% GST on the fee + ~${FEES.txPct}% transaction charges.`]],
  ['Privacy & conduct', ['Never contact customers outside Nm7 or share their resume.', `Customer files are deleted ${PROMISES.retentionDays} days after delivery. Downloads are logged.`, 'Don’t invent experience, numbers or certificates — ask the customer instead.']],
];

const ICONS = ['⇢', '✎', '✓', '↺', '⛨'];

export default function Help() {
  return (
    <ExpertPage width="wide" kicker="For experts" title="Help & rules" sub="How orders work, how to write, and what we check before a draft goes out." shape="badge">
      <div className="ex-help">
        {SECTIONS.map(([t, items], i) => (
          <MeCard key={t} title={t} icon={ICONS[i]} headingLevel={2}><ul>{items.map((x) => <li key={x}><span>{x}</span></li>)}</ul></MeCard>
        ))}
        <MeCard title="Strong vs weak bullets" icon="★">
          <span className="ex-weak">✗ Responsible for MIS reports</span>
          <span className="ex-strong">✓ Automated the weekly MIS report with Excel macros, saving 4 hours a week for a 6-person sales team</span>
        </MeCard>
      </div>
      <span className="small muted">Questions? Write to experts@nm7.si.</span>
    </ExpertPage>
  );
}
