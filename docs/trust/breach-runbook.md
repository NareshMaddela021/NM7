# Personal data breach: what to do in the first 72 hours

Plain steps for nm7.si (AsuraaX AI Private Limited). Use them for anything that may have exposed personal data:
a leaked database or backup, a public storage bucket, a stolen laptop or password, an admin account used by someone
else, data sent to the wrong person, or a vendor (KYC, face match, voice, WhatsApp, email) telling us they had a breach.

**When in doubt, treat it as a breach and log it.** Logging costs nothing; missing a deadline is a legal problem.

## Who does what

| Role | Who | Does |
|---|---|---|
| Incident lead | Naresh (owner) | Decides, signs notices, talks to the Board and CERT-In |
| Tech lead | Whoever is on engineering duty | Stops the leak, keeps evidence, finds out what and how many |
| Writer | Support (info@nm7.si) | Sends the notice to affected people, answers their replies |

If Naresh can't be reached within 1 hour, the tech lead starts the steps below and keeps trying.

## The clock

The clock starts when anyone at Nm7 **first notices** the breach, not when we are sure.

| Deadline | Who to tell | Rule |
|---|---|---|
| **6 hours** | CERT-In (incident@cert-in.org.in, form on cert-in.org.in) | CERT-In Directions, 28 April 2022 |
| **Without delay** (same day if we can) | Data Protection Board: first short notice | DPDP Rules 2025, rule 7(2)(a) |
| **Without delay** | Every affected person (email, and in-app where possible) | DPDP Rules 2025, rule 7(1) |
| **72 hours** | Data Protection Board: full report | DPDP Rules 2025, rule 7(2)(b) |

Admin → Skill checks → Vetting Trust → **Breach log** shows both countdowns for each incident.

## Step by step

### Hour 0–1: contain and log
1. **Log it now**: Admin → Skill checks → Vetting Trust → Breach log → "Log a breach". Put the time it was first
   noticed in "Detected at", even if that was earlier than now.
2. **Stop the leak**: rotate the leaked key or password (Render env vars, MongoDB Atlas user, vendor API key),
   make the bucket private, disable the admin account, revoke sessions (Admin → Customers / Team).
3. **Keep evidence**: don't delete logs. Take screenshots and note times (IST) in the incident's notes.

### Hour 1–6: find out, tell CERT-In
4. Work out **what data** (names, emails, phones, resumes, selfies, voice, documents, interview texts…), **how many
   people**, and **since when**. Update the incident (status "Contained" once it is stopped).
5. **Tell CERT-In within 6 hours** (email incident@cert-in.org.in using their incident form). Then press "Record" in
   the breach log with "CERT-In" and the reference number.
6. **Send the Board the first short notice** (what happened, when, rough size, likely impact). Record it ("Data
   Protection Board").

### Hour 6–24: tell the people affected
7. Send the notice below to every affected person (support sends it from info@nm7.si; for many people use the
   normal email provider in batches). Record it ("Affected people") with how many were sent.
8. If a vendor (processor) caused it, ask them in writing for their report and record it ("Vendor / processor").
9. If there was theft or fraud, file at cybercrime.gov.in / the local cyber cell and record it ("Police / cyber cell").

### Hour 24–72: the full report to the Board
10. Send the Board the full report: what happened and how, the data and people affected, what we did to stop it and
    reduce harm, what we changed so it doesn't happen again, and the notices we sent. Record it. Set status
    "Notified".
11. When everything is done and lessons are written down, set status "Closed".

## Notice to affected people (template)

> **Subject: Important: a problem with your Nm7 data**
>
> Hi {first name},
>
> On {date} we found that {plain description, e.g. "a file with some users' selfies could be opened by anyone with its
> link"} between {start} and {end}.
>
> **What was involved:** {e.g. your selfie from a skill check. Your password, phone number and documents were not
> involved.}
>
> **What we did:** {e.g. we closed the link within 2 hours, deleted the file and checked every other file.}
>
> **What you can do:** {e.g. nothing is needed / change your Nm7 password / be careful with calls or messages that ask
> for an OTP. Nm7 never asks for your OTP or password.}
>
> If you have questions, reply to this email or write to info@nm7.si. You can also complain to the Data Protection
> Board of India.
>
> We are sorry. — Naresh, Nm7 · nm7.si

Write it in plain words; send a Telugu or Hindi version too if the person chose that language.

## After it is closed
- Write 5 lines: what happened, why, what we changed. Keep it with the incident notes.
- Check the retention schedule (Admin → Vetting Trust → Retention): data we no longer need can't leak.
