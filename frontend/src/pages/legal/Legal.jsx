// Legal pages: Terms, Privacy, Refunds & cancellation, Delivery, Expert terms, Contact.
// DRAFT wording for a lawyer to review. Business details come from src/lib/legal.js; a sentence whose detail is
// still empty is left out. Lines starting "?? " are business decisions to confirm (tagged in the preview only).
import { Link } from 'react-router-dom';
import Header from '../../components/Header';
import SiteFooter from '../../components/SiteFooter';
import { LEGAL as L, join, missingLegal } from '../../lib/legal';
import { LIVE } from '../../services/http';
import { PLANS, ADDONS, PROMISES, FEES, inr } from '../../lib/pricing';

const PREVIEW = !LIVE && import.meta.env.VITE_PREVIEW === '1';
/** A line of text. "?? " at the start = a decision to confirm (tagged in the preview build only). */
function T({ s }) {
  const confirm = s.startsWith('?? ');
  return <>{confirm && PREVIEW && <span className="badge b-warning" style={{ marginRight: 6, fontSize: 11 }}>To confirm</span>}{confirm ? s.slice(3) : s}</>;
}

function Page({ title, intro, sections }) {
  return (
    <>
      <Header />
      <main id="main" className="container stack g20 legal" style={{ maxWidth: 820, padding: '32px 20px 64px' }}>
        <div className="stack g8">
          <span className="mono xs muted">LAST UPDATED · {L.updated.toUpperCase()}</span>
          <h1 className="display" style={{ fontSize: 36 }}>{title}</h1>
          {intro && <p className="lead" style={{ fontSize: 17, margin: 0 }}><T s={intro} /></p>}
          {PREVIEW && <div className="well small" style={{ borderLeft: '3px solid var(--warning)' }}><strong>Draft for review.</strong> Have a lawyer check this page before going live. Still empty in src/lib/legal.js (those lines are hidden): {missingLegal().join(', ') || 'nothing'}.</div>}
        </div>
        <nav aria-label="On this page" className="card stack g4 small" style={{ padding: 16 }}>
          <strong className="xs muted">ON THIS PAGE</strong>
          {sections.filter(([, body]) => body.length).map(([h], i) => <a key={h} href={`#s${i + 1}`} onClick={(e) => { e.preventDefault(); document.getElementById(`s${i + 1}`)?.scrollIntoView({ behavior: 'smooth' }); }}>{i + 1}. {h}</a>)}
        </nav>
        {sections.filter(([, body]) => body.length).map(([h, body], i) => (
          <section key={h} id={`s${i + 1}`} className="stack g8" style={{ scrollMarginTop: 90 }}>
            <h2 style={{ fontSize: 21 }}>{i + 1}. {h}</h2>
            {body.map((b, j) => (Array.isArray(b)
              ? <ul key={j} className="stack g4" style={{ margin: 0, paddingLeft: 20, lineHeight: 1.6 }}>{b.map((li) => <li key={li}><T s={li} /></li>)}</ul>
              : <p key={j} style={{ margin: 0, lineHeight: 1.65 }}>{typeof b === 'string' ? <T s={b} /> : b}</p>))}
          </section>
        ))}
        <p className="small muted" style={{ margin: 0 }}>Questions? Write to {L.email} or see <Link to="/contact">Contact us</Link>.</p>
      </main>
      <SiteFooter />
    </>
  );
}

const grievance = [
  L.grievance.name ? `Grievance Officer: ${join(' · ', L.grievance.name, L.grievance.email, L.grievance.phone)}.` : `Complaints and grievances: ${L.grievance.email || L.email}.`,
  'We acknowledge every complaint within 48 hours and aim to resolve it within one month, as the Consumer Protection (E-Commerce) Rules, 2020 require.',
];

export function Terms() {
  return <Page title="Terms of Service" intro={`These terms are an agreement between you and ${L.company}${L.entity ? ` (${L.entity})` : ''}, which runs Nm7 at ${L.site}. By creating an account or buying a service you accept them.`} sections={[
    ['Who we are', [`${L.company} runs ${L.brands}. Nm7 helps job seekers improve their resumes with free tools, paid tools and verified human experts.${L.address ? ` Registered office: ${L.address}.` : ''}`]],
    ['Who can use Nm7', ['You must be 18 or older. If you are younger, a parent or guardian must agree to these terms and to our Privacy Policy for you.', 'Give true details when you sign up, keep your password private and tell us at once if someone else uses your account.']],
    ['Our services', [[
      `Free resume scan and the resume builder.`,
      `${PLANS.diy.name} — ${inr(PLANS.diy.price)}: ${PLANS.diy.blurb}.`,
      `${PLANS.expert.name} — ${inr(PLANS.expert.price)}: ${PLANS.expert.blurb}.`,
      `${PLANS.launch.name} — ${inr(PLANS.launch.price)}: ${PLANS.launch.blurb}.`,
      `Add-ons: ${Object.values(ADDONS).map((a) => `${a.name} (${inr(a.price)})`).join(', ')}.`,
    ], 'What each plan includes is shown on the page where you buy it. That description is part of these terms.']],
    ['Prices and payment', [`Prices are in Indian rupees and include GST. Payments are processed by ${PROMISES.paymentProvider}; we never see or store your full card or bank details. A GST invoice is emailed and kept in your dashboard.`, 'Upgrades charge only the difference between plans.']],
    ['How expert orders work', [[
      `After payment, a verified expert in your field accepts the order and you answer a few intake questions.`,
      `Your first draft arrives within ${PROMISES.delivery} of completing the intake questions.`,
      'You comment on the draft; the expert revises it. When you are happy, you approve the final.',
      `If you don’t respond, a delivered final is approved automatically after ${PROMISES.autoApproveDays}.`,
    ]]],
    ['What we promise — and what we don’t', ['We promise a resume written to the standard described for your plan, on time. We do not promise interviews, job offers or any particular result from employers or their tracking systems; those decisions are theirs.', 'ATS scores and keyword matches on Nm7 are our own guidance, not a score any employer uses.']],
    ['Your content', ['You own your resume and everything you upload. You let us store, process and show it only to provide the service — for example, to your assigned expert, to the share link you turn on, and to our tools that check and format it.', 'Only give us information that is true and that you are allowed to share. Do not ask an expert to invent degrees, jobs or skills; experts will refuse.']],
    ['Experts', ['Experts are independent professionals we verify through a profile review and a test task. They are not our employees. They must keep your resume confidential and may not contact you outside Nm7.']],
    ['AI features', ['Some tools suggest wording automatically. Suggestions can be wrong — read them before you use them. You are responsible for what your resume says.']],
    ['Share links', ['If you turn on a share link, anyone with the link can view and download that resume until you turn it off. You can hide your phone number on the link.']],
    ['Refunds', [<>Refunds follow our <Link key="r" to="/refund-policy">Refund &amp; Cancellation Policy</Link>.</>]],
    ['Things you must not do', [['Break the law, or upload content that is false, abusive or belongs to someone else.', 'Try to get around payments, scrape the site or access other people’s accounts.', 'Pay an expert outside Nm7 for an order that started here.']]],
    ['Ending your account', ['You can delete your account any time from Profile & settings. We may suspend accounts that break these terms; we will tell you why unless the law stops us.']],
    ['Liability', ['To the extent the law allows, our total liability for any claim about a service is limited to the amount you paid for that service. We are not liable for indirect losses such as lost job opportunities.']],
    ['Changes to these terms', ['If we change these terms in a way that matters, we tell you by email or in your dashboard at least 7 days before the change applies.']],
    ['Law and disputes', [`Indian law applies. Courts in ${L.courts} have jurisdiction. Please contact us first — most problems are solved quickly.`]],
    ['Grievances and contact', grievance],
  ]} />;
}

export function Privacy() {
  return <Page title="Privacy Policy" intro={`How ${L.company} collects, uses and protects your personal data on ${L.site}, in line with the Digital Personal Data Protection Act, 2023 and the Information Technology Act, 2000.`} sections={[
    ['What we collect', [[
      'Account details: name, email, mobile number, password (stored encrypted).',
      'Resume content you add or upload — this can include education, work history, photo, date of birth, family names and address if you choose to add them.',
      'Order details: plan, intake answers, messages with your expert, drafts and ratings.',
      `Payment records: amount, date, ${PROMISES.paymentProvider} payment ID and GST invoice. Card, UPI and bank details are handled by ${PROMISES.paymentProvider}, not by us.`,
      'Usage data: pages visited, device and browser type, and error logs, to keep the site working.',
    ]]],
    ['Why we use it', [['To provide what you ask for: scans, the builder, expert orders, downloads and share links.', 'To match you with an expert and let them work on your order.', 'To take payments, send invoices and process refunds.', 'To send order updates on WhatsApp, SMS and email (you choose which in Settings; order emails stay on because they carry receipts).', 'To prevent fraud and keep accounts secure, and to meet legal and tax duties.'], 'We use your data for these purposes because you consent to them when you sign up or place an order, or because the law requires it. You can withdraw consent any time — some services may then stop working.']],
    ['Who we share it with', [['Your assigned expert — only for the order they work on.', `${PROMISES.paymentProvider} — to take payments and refunds.`, 'Messaging providers that deliver our WhatsApp, SMS and email.', `Cloud hosting and storage providers that run Nm7${L.hosting ? ` (${L.hosting})` : ''}.`, 'Authorities, when the law requires it.'], 'We do not sell your personal data and we do not share it for advertising.']],
    ['How long we keep it', [[`Files your expert creates: ${PROMISES.retentionDays} days after delivery, then deleted.`, 'Your own resumes, cover letters and applications: until you delete them or your account.', 'Invoices and payment records: as long as Indian tax law requires, even after you delete your account.', L.supportRetention && `Support messages: ${L.supportRetention}.`].filter(Boolean)]],
    ['Your rights', [['See a summary of your data and download a copy (Profile & settings → Download my data).', 'Correct or update your data.', 'Erase your data (Profile & settings → Delete account).', 'Withdraw consent.', 'Nominate someone to exercise these rights if you cannot.', 'Complain to our Grievance Officer, and then to the Data Protection Board of India.']]],
    ['Children', ['Nm7 is for people 18 and older. If you are under 18, we need verifiable consent from a parent or guardian before we process your data.']],
    ['Security', ['We use encryption in transit (HTTPS), encrypted passwords, two-step login for staff, access only on a need-to-know basis, and audit logs of admin actions. No system is perfectly secure; if a breach affects you, we will tell you and the authorities as the law requires.']],
    ['Cookies and local storage', ['We use essential cookies and browser storage to keep you signed in and to save drafts on your device. We do not use advertising cookies.']],
    ['Changes', ['We will post changes here and tell you by email if they matter.']],
    ['Grievance Officer and contact', grievance],
  ]} />;
}

export function RefundPolicy() {
  return <Page title="Refund & Cancellation Policy" intro="Our promise is simple: if we don’t deliver what you paid for, you get your money back." sections={[
    ['Late delivery — automatic full refund', [`If your first draft from an expert doesn’t arrive within ${PROMISES.delivery} of completing the intake questions, you get a full refund automatically. You don’t need to ask.`]],
    ['Not happy with the quality — re-do first', ['Tell us what is wrong from your order page. Your expert re-works it free, using your comments.', 'If the re-do still doesn’t meet the standard described for your plan, ask for a refund from the order page. Our team reviews it within 24 hours and replies by WhatsApp and email.']],
    ['Cancelling an order', ['?? Before an expert accepts your order: cancel from your order page for a full refund.', '?? After an expert has started: please use the re-do and refund steps above.']],
    [`${PLANS.diy.name} (${inr(PLANS.diy.price)})`, [`?? The DIY plan unlocks tools straight away, so it is refunded only if a problem on our side stops you using them and we can’t fix it${L.diyFixTime ? ` within ${L.diyFixTime}` : ''}.`]],
    ['Add-ons and upgrades', [`?? Express delivery (${inr(ADDONS.express.price)}): refunded if your first draft misses the 24-hour promise.`, 'Upgrades and other add-ons follow the same rules as the order they were added to.']],
    ['How and when you get the money', [`Refunds go back to the account or card you paid from, through ${PROMISES.paymentProvider}. They usually reach you in ${PROMISES.refundDays} after approval. You can see the status under Payments & refunds.`]],
    ['Contact', [`Write to ${L.email} with your order number, or use Help → Raise an issue in your dashboard.`, ...grievance]],
  ]} />;
}

export function DeliveryPolicy() {
  return <Page title="Delivery Policy" intro="Nm7 sells digital services. Nothing is shipped to a physical address." sections={[
    ['How you receive your order', ['Everything is delivered in your dashboard on Nm7, and we notify you by WhatsApp and email. Final resumes can be downloaded as PDF and Word and stay in My resumes.']],
    ['Timelines', [[`${PLANS.diy.name}: tools unlock immediately after payment.`, `${PLANS.expert.name} and ${PLANS.launch.name}: first draft within ${PROMISES.delivery} of completing the intake questions; revisions usually within 24 hours of your comments.`, `${ADDONS.express.name}: first draft within 24 hours of buying it.`, `Mentor calls (${PLANS.launch.name}): booked at a time you pick from three your expert offers.`]]],
    ['If we are late', [<>You get a full refund automatically — see our <Link key="r" to="/refund-policy">Refund &amp; Cancellation Policy</Link>.</>]],
    ['Contact', [join(' · ', L.email, L.phone, L.hours)]],
  ]} />;
}

export function ExpertTerms() {
  return <Page title="Expert Terms" intro={`These terms apply to resume experts working on ${L.site}, in addition to the Terms of Service.`} sections={[
    ['Joining', ['You apply with a profile, go through a review and complete a short test task. We approve experts who meet our quality bar; we may decline without giving detailed reasons.', 'You are an independent professional, not an employee of ' + L.company + '.']],
    ['Taking orders', [['Offers must be accepted within 30 minutes or they go to another expert.', `Deliver the first draft within ${PROMISES.delivery} of the customer completing the intake. Late delivery means an automatic full refund to the customer and no payout for that order.`, 'If a customer raises a quality complaint, you do one free re-do within 24 hours.', 'Set your weekly capacity, working days and hours, and use holiday mode when you are away.']]],
    ['Quality and honesty', [['Use only facts the customer gives you. Never invent degrees, jobs, numbers or skills — if a fact is missing, mark the gap clearly and ask the customer.', 'Keep layouts ATS-safe and follow the 5-point checklist in the workspace before sending.']]],
    ['Confidentiality', ['Customer resumes and messages are confidential. Do not copy, keep, share or reuse them, and do not contact customers outside Nm7.']],
    ['Fees and payouts', [[`For each order, ${L.company} keeps a platform fee of ${FEES.platformPct}% of the order price, plus GST (${FEES.gstPct}%) on that fee, plus payment transaction charges (about ${FEES.txPct}%).`, `TDS is deducted where Indian tax law requires it${L.tdsRate ? ` (${L.tdsRate})` : ''}.`, `Your earning becomes available when the customer approves the order, or automatically ${PROMISES.autoApproveDays} after delivery.`, `You can withdraw any time; money reaches your bank or UPI in ${PROMISES.withdrawalDays}.`, 'If an order is refunded because of late delivery or a quality failure on your side, you are not paid for it.']]],
    ['Ratings and removal', ['Customers rate every order. We may pause or remove experts with repeated late deliveries, low ratings or any breach of these terms.']],
    ['Contact', [join(' · ', L.email, L.phone)]],
  ]} />;
}

export function Contact() {
  return (
    <>
      <Header />
      <main id="main" className="container stack g20 legal" style={{ maxWidth: 820, padding: '32px 20px 64px' }}>
        <h1 className="display" style={{ fontSize: 36 }}>Contact us</h1>
        <div className="row g16" style={{ alignItems: 'stretch' }}>
          <section className="card stack g8" style={{ flex: '1 1 300px' }}>
            <strong>Support</strong>
            <span>Email: <span style={{ userSelect: 'all' }}>{L.email}</span></span>
            {L.phone && <span>Phone / WhatsApp: {L.phone}</span>}
            <span className="small muted">{L.hours}</span>
            <span className="small">Have an order? The fastest way is <Link to="/me/help">Help → Raise an issue</Link> in your dashboard.</span>
          </section>
          <section className="card stack g8" style={{ flex: '1 1 300px' }}>
            <strong>Company</strong>
            <span>{join(' · ', L.company, L.entity)}</span>
            <span>{L.address || L.city}</span>
            <strong style={{ marginTop: 8 }}>{L.grievance.name ? 'Grievance Officer' : 'Complaints'}</strong>
            <span>{L.grievance.name ? join(' · ', L.grievance.name, L.grievance.email, L.grievance.phone) : (L.grievance.email || L.email)}</span>
            <span className="small muted">We acknowledge complaints within 48 hours.</span>
          </section>
        </div>
      </main>
      <SiteFooter />
    </>
  );
}
