// Legal pages: Terms, Privacy, Refunds & cancellation, Delivery, Expert terms, Terms for companies and colleges, Contact.
// Plain wording; a lawyer may still review it. Business details come from src/lib/legal.js; a sentence whose detail
// is still empty is left out. Lines starting "?? " are business decisions to confirm (tagged in the preview only).
import { PageArt } from '../../components/PageHero';
import { useEffect } from 'react';
import { Link, useLocation, useSearchParams } from 'react-router-dom';
import JobRemovalForm from './JobRemovalForm';
import Header from '../../components/Header';
import SiteFooter from '../../components/SiteFooter';
import { LEGAL as L, LEGAL_UPDATED, join, missingLegal } from '../../lib/legal';
import { LIVE } from '../../services/http';
import { PLANS, ADDONS, PROMISES, FEES, inr } from '../../lib/pricing';

const PREVIEW = !LIVE && import.meta.env.VITE_PREVIEW === '1';
/** A line of text. "?? " at the start = a decision to confirm (tagged in the preview build only). */
function T({ s }) {
  const confirm = s.startsWith('?? ');
  return <>{confirm && PREVIEW && <span className="badge b-warning" style={{ marginRight: 6, fontSize: 11 }}>To confirm</span>}{confirm ? s.slice(3) : s}</>;
}

/** Round W: the page is full width; on a wide screen "On this page" stays in view in a left column and the text keeps a
 *  readable line (about 72 characters); on a phone the list sits above the text.
 *  A section is [heading, body] or [heading, body, id]: the id is the anchor (nm7.si/privacy#extension); else s1, s2, …
 *  The page is lazy, so it scrolls to the address's #anchor itself once it is drawn. */
function Page({ title, intro, sections, updated = L.updated }) {
  const { hash } = useLocation();
  useEffect(() => {
    if (hash) document.getElementById(decodeURIComponent(hash.slice(1)))?.scrollIntoView();
  }, [hash]);
  const shown = sections.filter(([, body]) => body.length).map(([h, body, id], i) => [h, body, id || `s${i + 1}`]);
  return (
    <>
      <Header />
      <main id="main" className="app-wide stack g20 legal legal-page">
        <div className="ph-row"><div className="stack g8">
          <span className="kicker">Last updated · {updated}</span>
          <h1 className="display" style={{ fontSize: 36 }}>{title}</h1>
          {intro && <p className="lead" style={{ fontSize: 17, margin: 0 }}><T s={intro} /></p>}
          {PREVIEW && <div className="well small" style={{ borderLeft: '3px solid var(--warning)' }}><strong>Draft for review.</strong> Have a lawyer check this page before going live. Still empty in src/lib/legal.js (those lines are hidden): {missingLegal().join(', ') || 'nothing'}.</div>}
        </div><PageArt shape="resume" /></div>
        <div className="legal-body">
        <nav aria-label="On this page" className="card stack g4 small legal-toc" style={{ padding: 16 }}>
          <strong className="xs muted">ON THIS PAGE</strong>
          {shown.map(([h, , id], i) => <a key={h} href={`#${id}`} onClick={(e) => { e.preventDefault(); document.getElementById(id)?.scrollIntoView({ behavior: 'smooth' }); }}>{i + 1}. {h}</a>)}
        </nav>
        <div className="stack g20 legal-text">
        {shown.map(([h, body, id], i) => (
          <section key={h} id={id} className="stack g8" style={{ scrollMarginTop: 90 }}>
            <h2 style={{ fontSize: 21 }}>{i + 1}. {h}</h2>
            {body.map((b, j) => (Array.isArray(b)
              ? <ul key={j} className="stack g4" style={{ margin: 0, paddingLeft: 20, lineHeight: 1.6 }}>{b.map((li) => <li key={li}><T s={li} /></li>)}</ul>
              : <p key={j} style={{ margin: 0, lineHeight: 1.65 }}>{typeof b === 'string' ? <T s={b} /> : b}</p>))}
          </section>
        ))}
        <p className="small muted" style={{ margin: 0 }}>Questions? Write to <a href={`mailto:${L.email}`}>{L.email}</a> or see <Link to="/contact">Contact us</Link>.</p>
        </div>
        </div>
      </main>
      <SiteFooter />
    </>
  );
}

const officer = join(', ', L.grievance.name, L.grievance.title);
const grievance = [
  L.grievance.name ? `Grievance Officer: ${join(' · ', officer, L.grievance.email, L.grievance.phone)}.` : `Complaints and grievances: ${L.grievance.email || L.email}.`,
  L.address && `Postal address: ${L.company}, ${L.address}.`,
  'We acknowledge every complaint within 48 hours and aim to resolve it within one month, as the Consumer Protection (E-Commerce) Rules, 2020 require.',
].filter(Boolean);

// round J2 (agreed by Naresh): jobs from companies' own careers pages, and how a company has one removed
const jobRemoval = <>Some jobs on Nm7 come from companies’ own careers pages. A company can ask us to remove a job at <Link to="/contact?topic=job-removal">nm7.si/contact?topic=job-removal</Link>; we remove it, usually within 2 working days.</>;

const companyTermsLink = <Link key="ct" to="/company-terms">Terms for companies and colleges</Link>;
const helperLink = <Link key="ph" to="/privacy#extension">Privacy Policy, section “Nm7 Apply helper”</Link>;

export function Terms() {
  return <Page updated={LEGAL_UPDATED} title="Terms of Service" intro={`These terms are an agreement between you and ${L.company}, which runs Nm7 at ${L.site}. By creating an account or buying a service you accept them.`} sections={[
    ['Who we are', [`${L.company} runs ${L.brands}. Nm7 is a job site: it helps job seekers find jobs, apply, prove their skills and improve their resumes with free tools, paid tools and verified human experts, and it helps companies and colleges hire and place people.${L.address ? ` Registered office: ${L.address}.` : ''}`]],
    ['Who can use Nm7', ['You must be 18 or older. If you are younger, a parent or guardian must agree to these terms and to our Privacy Policy for you.', 'Give true details when you sign up, keep your password private and tell us at once if someone else uses your account. One person, one account.']],
    ['Our services', [[
      'The job board, Ready to join, skill checks and the Nm7 Apply helper (free).',
      'Auto Apply: Nm7 applies to jobs for you within rules you set.',
      `Free resume scan and the resume builder.`,
      `${PLANS.diy.name} — ${inr(PLANS.diy.price)}: ${PLANS.diy.blurb}.`,
      `${PLANS.expert.name} — ${inr(PLANS.expert.price)}: ${PLANS.expert.blurb}.`,
      `${PLANS.launch.name} — ${inr(PLANS.launch.price)}: ${PLANS.launch.blurb}.`,
      `Add-ons: ${Object.values(ADDONS).map((a) => `${a.name} (${inr(a.price)})`).join(', ')}.`,
    ], 'What each plan includes is shown on the page where you buy it. That description is part of these terms. Auto Apply 2.0 is live for everyone; some skill-check and vetting features are still being tested and may not be on for your account yet.', <>Companies and colleges also follow our {companyTermsLink}.</>]],
    ['Prices and payment', [`Prices are in Indian rupees and include GST. You pay through ${PROMISES.paymentProvider} by UPI, card, netbanking or wallet; we never see your card, UPI or bank details.`, 'A GST invoice is emailed to you after each payment and stays in My orders. Upgrades charge only the difference between plans.']],
    ['How expert orders work', [[
      `After payment, a verified expert in your field accepts the order and you answer a few intake questions.`,
      `Your first draft arrives within ${PROMISES.delivery} of completing the intake questions.`,
      'You comment on the draft; the expert revises it. When you are happy, you approve the final.',
      `If you don’t respond, a delivered final is approved automatically after ${PROMISES.autoApproveDays}.`,
    ]]],
    ['The job board', ['Jobs on Nm7 are posted by companies on Nm7 or come from companies’ own careers pages. We check new jobs for scam signs and unfair wording, but we cannot promise that every job is real or still open. The hiring decision is always the company’s.', 'You never have to pay anyone to apply for a job on Nm7. If a company asks you for money, do not pay: report the job from its page or write to us.']],
    ['Auto Apply', [
      'Auto Apply is off until you turn it on, set your rules (roles, cities, salary, job types and a daily limit) and agree that Nm7 may apply for you and share your profile with those companies.',
      [
        'Approve each (the default): every morning you get a list. Nothing is sent until you tap Approve or Approve all.',
        'Full auto: Nm7 applies for you within your rules and daily limit. You can see everything it sent.',
        'Weekly digest: jobs collect in one list for the week and you approve them when it suits you.',
      ],
      'Nm7 applies on Nm7 itself, by email from your own apply address on apply.nm7.si, through a company’s hiring system, through a simple form on the company’s own website, or it leaves the job ready for you to send with one tap. What was sent for each job is shown in your tracker.',
      'Nm7 only uses facts from your own resume, profile and saved answers. It may reorder and rephrase your resume for a job, but never adds degrees, jobs or skills you did not give. If a job asks something we don’t know, it waits for you.',
      'You stay responsible for what is sent in your name. Keep your resume, profile and answers true and up to date, and check your tracker.',
      'We never ask for, keep or use your passwords or logins for other websites. Nm7 never signs in to job sites for you, never creates accounts for you there and never solves “I’m not a robot” checks.',
      'You can pause or stop Auto Apply at any time. Stopping it means nothing more is prepared or sent; applications already sent stay with the companies. We do not promise replies, interviews or offers.',
    ]],
    ['Skill checks and vetting', [
      'Skill checks, practical tasks, AI interviews and the other checks show companies what you can do. Their results only mean something if they are honest, so these rules apply:',
      ['Take every check yourself, alone, on your own account.', 'Don’t get help from another person, and don’t copy, search or use AI tools unless the check says you may.', 'Don’t share the questions, and don’t use someone else’s ID, photo or voice.'],
      'Before your first check we tell you what is watched (for example leaving the page, copy and paste, and answer timing), and you agree to it. Some checks also need your camera or microphone; we ask first, and you can ask for a manual check instead.',
      'A warning sign on its own never rejects, hides or removes you. A person at Nm7 looks at it first, and you can explain. If a person confirms cheating, we may cancel the result or badge, stop retests for a while, or close the account.',
      'If you think a result is wrong, tap “I think this is wrong” on it. A person reviews it within 72 hours and gives a free retest, a corrected score, or a reason for keeping it.',
    ]],
    ['Ready to join and company invites', ['When you turn on Ready to join, verified companies hiring now can see your profile and invite you. Your phone number and email are shown to a company only after you accept its invite. You can pause it or turn it off at any time.']],
    ['Nm7 Apply helper', [<>The Nm7 Apply helper is our free Chrome extension. It fills a company’s application form from your Nm7 apply kit, only when you tap Fill. It never presses Submit: you check the form and send it yourself, and you are responsible for what you send. It does nothing on job boards. What it does with your data is in our {helperLink}.</>]],
    ['Students and colleges', ['If you join your college’s (or another organization’s) group on Nm7 with its join code, you share the resume you choose and the details the group asks for with that organization, for printing and placement support. You can change the shared resume, or leave the group, at any time.', <>Colleges and organizations must follow our {companyTermsLink}.</>]],
    ['What we promise — and what we don’t', ['We promise a resume written to the standard described for your plan, on time. We do not promise interviews, job offers or any particular result from employers or their tracking systems; those decisions are theirs.', 'ATS scores, match scores and keyword matches on Nm7 are our own guidance, not a score any employer uses.']],
    ['Your content', ['You own your resume and everything you upload. You let us store, process and show it only to provide the service — for example, to your assigned expert, to companies you apply to or that you let see you, to your college if you join its group, to the share link you turn on, and to our tools that check and format it.', 'Only give us information that is true and that you are allowed to share. Do not ask an expert to invent degrees, jobs or skills; experts will refuse.']],
    ['Experts', ['Experts are independent professionals we verify through a profile review and a test task. They are not our employees. They must keep your resume confidential and may not contact you outside Nm7.']],
    ['AI features', ['Some tools suggest wording, tailor your resume, grade answers or read replies automatically. Suggestions can be wrong — read them before you use them. You are responsible for what your resume says. An AI grade can be checked again by a person if you ask.']],
    ['Share links', ['If you turn on a share link, anyone with the link can view and download that resume until you turn it off. You can hide your phone number on the link.']],
    ['Refunds', [<>Refunds follow our <Link key="r" to="/refund-policy">Refund &amp; Cancellation Policy</Link>.</>]],
    ['Things you must not do', [['Break the law, or upload content that is false, abusive or belongs to someone else.', 'Cheat on a skill check or another check, or help someone else cheat.', 'Try to get around payments, scrape the site or access other people’s accounts.', 'Pay an expert outside Nm7 for an order that started here.']]],
    ['Ending your account', ['You can delete your account any time from Profile & settings. We may suspend accounts that break these terms; we will tell you why unless the law stops us.']],
    ['Liability', ['To the extent the law allows, our total liability for any claim about a service is limited to the amount you paid for that service. We are not liable for indirect losses such as lost job opportunities.']],
    ['Changes to these terms', ['If we change these terms in a way that matters, we tell you by email or in your dashboard at least 7 days before the change applies.']],
    ['Law and disputes', [`Indian law applies. Courts in ${L.courts} have jurisdiction. Please contact us first — most problems are solved quickly.`]],
    ['Grievances and contact', [...grievance, jobRemoval]],
  ]} />;
}

export function Privacy() {
  return <Page updated={LEGAL_UPDATED} title="Privacy Policy" intro={`How ${L.company} collects, uses and protects your personal data on ${L.site}, in line with the Digital Personal Data Protection Act, 2023 and the Information Technology Act, 2000.`} sections={[
    ['Who we are', [`${L.company} runs Nm7 and decides how your personal data on Nm7 is used.${L.address ? ` Registered office: ${L.address}.` : ''} Auto Apply 2.0, including email applications from apply.nm7.si and the replies companies send back, is live for everyone. Some skill-check and vetting features below are still being tested and may not be on for your account yet; this policy covers them anyway.`]],
    ['What we collect', [[
      'Account details: name, email, mobile number, password (stored encrypted).',
      'If you sign in with Google: your Google account ID, email, name and picture link. Never your Google password.',
      'Resume content you add or upload — this can include education, work history, photo, date of birth, family names and address if you choose to add them.',
      'Job search details: your job profile, saved jobs, applications, the answers you give to companies’ questions, and your Auto Apply rules.',
      'Ready to join details, if you turn it on: when you can join, cities, expected salary, notice period and job types.',
      'Skill checks and vetting, if you take them: your answers, scores and what is watched during a check (see “Skill checks and vetting” below).',
      'Your date of birth, once, before skill checks or AI interviews (only to check your age).',
      'Order details: plan, intake answers, messages with your expert, drafts and ratings.',
      `Payment records: amount, date, ${PROMISES.paymentProvider} payment ID and GST invoice. ${PROMISES.paymentProvider} processes payments; Nm7 never sees your card, UPI or bank details.`,
      'Usage data: pages visited, device and browser type, and error logs, to keep the site working. Some taps are counted without cookies or any ID.',
    ]]],
    ['Why we use it', [['To provide what you ask for: the job board, applications, Auto Apply, scans, the builder, expert orders, downloads and share links.', 'To show your profile to companies when you apply or turn on Ready to join, and to your college when you join its group.', 'To run skill checks and vetting, and to keep their results honest.', 'To match you with an expert and let them work on your order.', 'To take payments, send invoices and process refunds.', 'To send order and job updates by email (order emails stay on because they carry invoices), and on WhatsApp or SMS if you turn them on in Settings.', 'To prevent fraud and keep accounts secure, and to meet legal and tax duties.'], 'We use your data for these purposes because you consent to them when you sign up, turn a feature on or place an order, or because the law requires it. You can withdraw consent any time — some services may then stop working.']],
    ['Auto Apply', [
      'When you turn on Auto Apply (Auto Apply and Auto Apply 2.0), we send your resume, the answers you saved and a short cover note to the companies whose jobs you approve or that match your rules. We may reorder and rephrase your resume for each job, using only your own facts.',
      ['On Nm7: the company sees your application in its Nm7 dashboard.', 'By email, sent through Resend: in Auto Apply 2.0 from your own apply address (for example firstname.x7k2@apply.nm7.si), only to an address the company published itself, with your tailored resume and a link to your Nm7 profile; in the first Auto Apply from Nm7’s address, with your own email as the reply address.', 'Through the company’s own hiring system, when the company has connected it to Nm7 (Zoho Recruit, Greenhouse or Lever).', 'Through a simple application form on the company’s own website, without any login.'],
      'Replies that companies send to your apply address (Auto Apply 2.0) come to Nm7. We store them, read them (with our rules, and with AI only when the rules can’t tell) to show them in your dashboard and spot interview invitations, and forward them to your own email. We also read status updates from Nm7 companies and connected hiring systems.',
      'We do not track whether a company opens our emails.',
    ]],
    ['What companies and colleges see', [
      [
        'When you apply to a job on Nm7 (yourself or through Auto Apply): the company sees your application, the resume you applied with, your answers and your match score. Your email and phone are shown once the company shortlists you. ID numbers are never shown. A company sees an application for 12 months after you apply; you can withdraw it any time.',
        'When Ready to join is on: verified companies hiring now see, in Hire now, your first name and the first letter of your last name, your match score and why you fit, when you can join, whether your salary fits, and your skill check badges and reliability. Your email and phone are shown only after you accept that company’s invite.',
        'Skill checks: companies see your badge and level, and your scores only if you choose to share them. They never see what was watched during a check. For integrity they see only a short label (such as “Low risk” or “Reviewed by Nm7”).',
        'Colleges and other organizations: when you join a group with its join code, the organization sees the resume you chose to share, the details the group asks for (such as roll number and branch), your resume review and print status, your ATS score, whether your resume is LinkedIn-ready, drive-day check-ins, shortlists from recruiters it invited, and the offers recorded for you. You can change the shared resume or leave at any time.',
      ],
    ]],
    ['Skill checks and vetting', [
      [
        'What we keep: your answers, scores, time per question and, for coding and typing tasks, your code and typing timing.',
        'What is watched during a check (told before your first check, and only with your agreement): leaving the page and for how long, copy and paste, right-click and developer tools, answer timing and typing speed, and a scrambled (hashed) code for your device and network.',
        'AI interviews: the transcript of your answers.',
        'Spoken English: your voice is sent to our speech partner to measure pronunciation; we keep the scores, not the audio (unless we tell you otherwise).',
        'ID + selfie check, only if you agree: a live selfie and a photo of your driving licence or PAN card are compared by our face-check partner. We keep the result, the scores and an encrypted face reference for the joining-day check — never the photos. Aadhaar cards are refused.',
        'Webcam snapshots, only with a separate agreement and never needed to take a test: a few photos at random moments during a test, stored encrypted.',
        'Documents from DigiLocker, only if you choose to share them (never Aadhaar numbers).',
      ],
      'Who sees results: you, and the Nm7 team and reviewers who check results. Companies see only what is listed above. A warning sign is never a rejection on its own: a person reviews it, and you can explain.',
      'You can ask for a manual check instead of the camera checks — a short video call with the Nm7 team — from the ID + selfie card in Profile & settings, or by writing to info@nm7.si. You can take back any of these agreements in Profile & settings > Privacy & consent; the data it covers is then deleted.',
    ]],
    ['Nm7 Apply helper (Chrome extension)', [
      'The Nm7 Apply helper is our Chrome extension. It fills a company’s application form with the details in your Nm7 apply kit.',
      [
        'It works only on the page you are on, and only when you open it and tap Fill (Chrome’s “activeTab” permission). It reads the form on that page only to fill it. It never reads your other tabs or your browsing history.',
        'It stores only the pairing token (with its expiry date) and a marker of the last job you pressed Submit for, in Chrome’s storage on your device (chrome.storage.local).',
        'It sends data only to the Nm7 API (nm7-api.onrender.com): to get your apply kit and resume, and to mark a job as applied when you tap “Mark as applied on Nm7”. Nothing from the company’s page is sent to Nm7.',
        'It has no analytics and no advertising, and it runs no code from the internet: all its code is inside the extension.',
        'It never presses Submit, never signs in or creates accounts, and never fills passwords or solves “I’m not a robot” checks. It does nothing on job boards.',
        'Signing the browser out (“Sign this browser out”) removes the token from your device and ends it on Nm7.',
      ],
      'The use of information received from Nm7 Apply helper will adhere to the Chrome Web Store User Data Policy, including the Limited Use requirements.',
    ], 'extension'],
    ['Who we share it with', [[
      'Companies you apply to, that you let see you, or whose jobs Auto Apply sends you to — as described above.',
      'Your college or organization, if you join its group.',
      'Your assigned expert — only for the order they work on.',
      'AI: Anthropic (Claude models) reads resume text, job posts, skill-check and interview answers and company replies to suggest wording, tailor resumes, grade answers and sort replies.',
      'Sign-in: Google, if you choose “Continue with Google”.',
      `Payments: ${PROMISES.paymentProvider}, to take payments and refunds.`,
      'Email: Resend sends our emails, including Auto Apply emails, and receives companies’ replies.',
      'Messages and calls about jobs, only if you agree: Meta (WhatsApp) and Bolna (AI phone calls).',
      'Checks, only when you use them: Amazon Web Services (face check, Mumbai), Microsoft Azure (spoken English pronunciation), Setu (DigiLocker documents), Judge0 (running your code in coding tasks), and Surepass (checking companies’ business registration).',
      'Error reports: Sentry, to find and fix errors.',
      'Blog: Hygraph stores our older blog articles, which nm7.si/blog shows (no personal data from your account).',
      `Cloud hosting and storage providers that run Nm7${L.hosting ? ` (${L.hosting})` : ''}.`,
      'Authorities, when the law requires it.',
    ], 'Some of these providers process data outside India. We do not sell your personal data and we do not share it for advertising.']],
    ['How long we keep it', [[
      `Files your expert creates: ${PROMISES.retentionDays} days after delivery, then deleted.`,
      'Your own resumes, cover letters, applications, Auto Apply history and the company replies to your apply address: until you delete them or your account.',
      'Skill check answers, scores, badges and what was watched during the checks: while your account is open (a badge stays valid for 90 days unless renewed); deleted with your account.',
      'Face-match results and webcam snapshots: 30 days. The ID + selfie result and face reference: 30 days after your hiring process ends.',
      'Photos of past work: 30 days. Voice recordings: 90 days. Spoken-English scores: 180 days.',
      'AI interview transcripts: 180 days. DigiLocker documents: 180 days (or sooner when the check ends).',
      'Raw IP addresses in our activity log and device codes from skill checks: 30 days.',
      'Integrity rating and the review by a person: 1 year after it was last worked out. Coding replays: 90 days; code from coding tasks: 1 year.',
      'Typing, situational and aptitude test results, joining-day answers and reliability records: 2 years.',
      'WhatsApp messages and call transcripts: 90 days. Location pin: 1 year. Work preferences: 2 years after the last change.',
      'Invoices and payment records: as long as Indian tax law requires, even after you delete your account.',
      L.supportRetention && `Support messages: ${L.supportRetention}.`,
    ].filter(Boolean), 'These are our standard periods; the current list is always in Profile & settings > Privacy & consent. A daily job deletes data when its time is over. When you delete your account, everything above is deleted except what the law makes us keep.']],
    ['Your rights', [['See a summary of your data and download a copy (Profile & settings > Download my data).', 'Correct or update your data.', 'Erase your data (Profile & settings > Delete account).', 'Withdraw consent.', 'Nominate someone to exercise these rights if you cannot.', 'Complain to our Grievance Officer, and then to the Data Protection Board of India.']]],
    ['Children', ['Nm7 is for people 18 and older. If you are under 18, we need verifiable consent from a parent or guardian before we process your data.']],
    ['Security', ['We use encryption in transit (HTTPS), encrypted passwords, two-step login for staff, access only on a need-to-know basis, and audit logs of admin actions. No system is perfectly secure; if a breach affects you, we will tell you and the authorities as the law requires.']],
    ['Cookies and local storage', ['We use essential cookies and browser storage to keep you signed in and to save drafts on your device. We do not use advertising cookies.']],
    ['Changes', ['We will post changes here and tell you by email if they matter.']],
    ['Grievance Officer and contact', [...grievance, jobRemoval]],
  ]} />;
}

export function RefundPolicy() {
  return <Page updated={LEGAL_UPDATED} title="Refund & Cancellation Policy" intro="Our promise is simple: if we don’t deliver what you paid for, you get your money back." sections={[
    ['Late delivery — automatic full refund', [`If your first draft from an expert doesn’t arrive within ${PROMISES.delivery} of completing the intake questions, you get a full refund automatically. You don’t need to ask.`]],
    ['Not happy with the quality — re-do first', ['Tell us what is wrong from your order page. Your expert re-works it free, using your comments.', 'If the re-do still doesn’t meet the standard described for your plan, ask for a refund from the order page. Our team reviews it within 24 hours and replies by email.']],
    ['Cancelling an order', ['Before an expert accepts your order: cancel from your order page for a full refund.', 'After an expert has started: please use the re-do and refund steps above.']],
    [`${PLANS.diy.name} (${inr(PLANS.diy.price)})`, [`The DIY plan unlocks tools straight away, so it is refunded only if a problem on our side stops you using them and we can’t fix it${L.diyFixTime ? ` within ${L.diyFixTime}` : ''}.`]],
    ['Add-ons and upgrades', [`Express delivery (${inr(ADDONS.express.price)}): refunded if your first draft misses the 24-hour promise.`, 'Upgrades and other add-ons follow the same rules as the order they were added to.']],
    ['How and when you get the money', [`Refunds go back to your original payment method (the UPI app, card, bank account or wallet you paid with) through ${PROMISES.paymentProvider}. They usually reach you in ${PROMISES.refundDays} after approval.`, 'You can see the refund status in My orders.']],
    ['Plans for colleges and organizations', [
      'The Free plan costs nothing. The Drive, Campus and Custom plans are paid once for a fixed period, at the price shown when you buy (GST is added when it applies). They do not renew by themselves: we email the Owner before a plan ends, and after a 7-day grace period the Free limits apply. Nothing is deleted.',
      'You can cancel a paid plan within 7 days of payment for a full refund, if your organization has not used the paid features yet (for example no drive day, kiosk or recruiter link was set up).',
      'After that, we refund only if a problem on our side stops you using the plan and we can’t fix it; then we refund the unused part of the plan.',
      `To ask, write to ${L.email} with your organization’s name and the invoice number. Money paid through ${PROMISES.paymentProvider} goes back to the original payment method; a bank transfer, cheque or purchase order payment is refunded by bank transfer. We issue a GST credit note against the invoice and adjust the plan.`,
    ]],
    ['Companies', ['Posting jobs and the hiring tools for companies on Nm7 are free today. Nm7 takes no payment from companies, so there is nothing to refund. If we start charging for something, we will show the price and its refund rules before you pay.', 'Job seekers never pay to apply for a job on Nm7.']],
    ['Contact', [`Write to ${L.email} with your order number, or use Help > Raise an issue in your dashboard.`, ...grievance]],
  ]} />;
}

export function CompanyTerms() {
  return <Page updated={LEGAL_UPDATED} title="Terms for companies and colleges" intro={`These terms apply to companies hiring on ${L.site} and to colleges and other organizations (institutes, job fairs, skill centres, NGOs and placement agencies) using Nm7, in addition to our Terms of Service and Privacy Policy.`} sections={[
    ['Who we are', [`${L.company} runs Nm7.${L.address ? ` Registered office: ${L.address}.` : ''} By signing up your company or creating an organization on Nm7, you accept these terms for it, and you confirm you may do so.`]],
    ['Your account', ['Give true details about your company or organization, and keep your team’s sign-ins private. You are responsible for what your team does on Nm7.', 'A new company starts as Basic (1 job a week). Once our team checks it (for example its GSTIN, CIN or Udyam number), it becomes Verified and can post more and use Hire now. We may check again later, and we may pause an account while we check.']],
    ['Posting jobs', [[
      'Post only real jobs that you are hiring for now, that are legal, and that you can fill.',
      'Give the true role, place, salary or stipend and requirements. Show an unpaid internship as unpaid.',
      'Never ask candidates for money — no registration, training, deposit, kit or interview fee — and never ask them to buy anything. Applying through Nm7 is always free for candidates.',
      'No unfair conditions, such as “male only” or an age limit the law does not allow.',
      'Close a job as soon as it is filled.',
    ], 'We check new jobs for scam signs and unfair wording, with our rules and AI. We may hold a job for review, ask you to change it, or remove it. Repeated or serious breaks can close the account. Candidates can report a job to us.']],
    ['Job removal', [jobRemoval, 'You can close or remove your own jobs at any time from your company dashboard.']],
    ['Candidate data: only for hiring', [[
      'Use what you see about candidates — in Hire now, Ready to join, applications, skill checks and drive days — only to hire for the job they applied to or were invited for.',
      'Never sell, rent or give candidate data to anyone else, and never add it to other lists or databases.',
      'Never send candidates spam, marketing or messages that are not about the job.',
      'Share candidate data only with people in your team who are hiring for that job, keep it safe, and delete what you downloaded when you no longer need it for hiring or when the candidate asks.',
      'A candidate’s email and phone are shown only after they accept your invite or after you shortlist them. Don’t try to find them another way.',
    ], 'Under the Digital Personal Data Protection Act, 2023 you are responsible for the candidate data you take out of Nm7.']],
    ['Applications sent by Auto Apply', ['Some applications are sent by Nm7 Auto Apply on behalf of a candidate who agreed to it, from their own apply address on apply.nm7.si. Replies to that address reach the candidate. Each email has a one-click link to stop Auto Apply emails to your address or your whole domain.', 'If you connect your own hiring system (for example Zoho Recruit, Greenhouse or Lever), we keep its key encrypted and use it only to deliver applications and read their status. You can disconnect it at any time.']],
    ['Drive days and colleges', [[
      'A college or organization sees only the members who joined its group with consent, and only what they chose to share. Use it only for placement support, printing and your own placement reports.',
      'Don’t upload ID numbers (such as Aadhaar or PAN) in roll lists; Nm7 refuses them.',
      'On a drive day, students check in with the code shown in the room. There is no location tracking. Companies at a drive see only the students and resumes the college shares with them.',
      'Recruiters you invite can see the resumes you share with them. Invite only people who are hiring, and remove them when the drive is over.',
      'Students can change their shared resume or leave your group at any time.',
    ]]],
    ['Demo accounts', ['The demo company and the demo college hold made-up people only, so you can try Nm7. Do not put real people’s data in them. They can be reset or removed at any time, and they never appear on the job board.']],
    ['Plans and payments', ['For companies, posting jobs and the hiring tools are free today; Nm7 takes no payment from companies. If that changes, we will show the price before you pay.', <>Colleges and organizations can use the Free plan, or buy a Drive, Campus or Custom plan at the price shown when buying. Payment is through {PROMISES.paymentProvider}, or by bank transfer against our proforma invoice. Plans do not renew by themselves. Refunds follow our <Link key="r" to="/refund-policy">Refund &amp; Cancellation Policy</Link>.</>]],
    ['Things you must not do', [['Post fake jobs, or jobs that are really a sale, a course or a scheme.', 'Copy, scrape or download candidate data in bulk outside the tools Nm7 gives you.', 'Contact candidates to sell them something.', 'Pretend to be another company, or let someone outside your organization use your account.']]],
    ['Ending and changes', [`You can close your account by writing to ${L.email}. We may suspend or close an account that breaks these terms; we will tell you why unless the law stops us. If we change these terms in a way that matters, we tell your account’s main admin by email at least 7 days before.`]],
    ['Liability', ['To the extent the law allows, our total liability for any claim is limited to the amount you paid Nm7 in the 12 months before it. Nm7 does not promise that you will find candidates, or that a candidate will join or stay.']],
    ['Law and disputes', [`Indian law applies. Courts in ${L.courts} have jurisdiction. Please contact us first — most problems are solved quickly.`]],
    ['Grievances and contact', grievance],
  ]} />;
}

export function DeliveryPolicy() {
  return <Page title="Delivery Policy" intro="Nm7 sells digital services. Nothing is shipped to a physical address." sections={[
    ['How you receive your order', ['Everything is delivered digitally: in your dashboard on Nm7, with an email when something is ready. Final resumes download as PDF and Word and stay in My resumes.']],
    ['Timelines', [[`${PLANS.diy.name}, packs and the annual pass: unlocked as soon as the payment is confirmed.`, `${PLANS.expert.name} and ${PLANS.launch.name}: first draft within ${PROMISES.delivery} of completing the intake questions; revisions usually within 24 hours of your comments.`, `${ADDONS.express.name}: first draft within 24 hours of buying it.`, `Mentor calls (${PLANS.launch.name}): booked at a time you pick from three your expert offers.`]]],
    ['If we are late', [<>You get a full refund automatically — see our <Link key="r" to="/refund-policy">Refund &amp; Cancellation Policy</Link>.</>]],
    ['Contact', [join(' · ', L.email, L.hours)]],
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
    ['Contact', [L.email]],
  ]} />;
}

export function Contact() {
  const [params] = useSearchParams();
  const removal = params.get('topic') === 'job-removal'; // round J: the job-removal form
  return (
    <>
      <Header />
      <main id="main" className="container stack g20 legal" style={{ maxWidth: 820, padding: '32px 20px 64px' }}>
        <div className="ph-row"><div className="stack g8"><p className="kicker">Support, complaints and job removal</p><h1 className="display" style={{ fontSize: 36 }}>Contact us</h1></div><PageArt shape="sphere" /></div>
        {removal && <JobRemovalForm link={params.get('job') || ''} />}
        <div className="row g16" style={{ alignItems: 'stretch' }}>
          <section className="card stack g8" style={{ flex: '1 1 300px' }}>
            <strong>Support</strong>
            <span>Email: <a href={`mailto:${L.email}`}>{L.email}</a></span>
            <span className="small muted">{L.hours}</span>
            <span className="small">Have an order? The fastest way is <Link to="/me/help">Help, then Raise an issue</Link> in your dashboard.</span>
          </section>
          <section className="card stack g8" style={{ flex: '1 1 300px' }}>
            <strong>Company</strong>
            <span>{L.company}</span>
            {L.address ? <span data-testid="contact-address">Registered office: {L.address}</span> : <span>{L.city}</span>}
            <strong style={{ marginTop: 8 }}>{L.grievance.name ? 'Grievance Officer' : 'Complaints'}</strong>
            {L.grievance.name
              ? <span>{join(' · ', officer, L.grievance.phone)}{(L.grievance.email || L.email) && <> · <a href={`mailto:${L.grievance.email || L.email}`}>{L.grievance.email || L.email}</a></>}</span>
              : <a href={`mailto:${L.grievance.email || L.email}`}>{L.grievance.email || L.email}</a>}
            <span className="small muted">We acknowledge complaints within 48 hours.</span>
            {!removal && <Link className="small" to="/contact?topic=job-removal" data-testid="contact-job-removal">Ask us to remove a job from Nm7</Link>}
          </section>
        </div>
      </main>
      <SiteFooter />
    </>
  );
}
