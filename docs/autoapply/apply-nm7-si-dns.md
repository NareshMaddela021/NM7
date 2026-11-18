# Setting up apply.nm7.si (Auto Apply 2.0 email applications)

Auto Apply 2.0 sends each email application from the candidate's own apply address, for example
`sai.x7k2@apply.nm7.si`. When a company replies, the reply comes back to Nm7: Nm7 stores it, shows it in the
candidate's tracker as "Replied", and forwards it to the candidate's own email.

For this to work, `apply.nm7.si` must be a verified sending and receiving domain in Resend. You add a few DNS records
where nm7.si's DNS is managed (the same place the records for `nm7.si` are), then set three environment variables on
Render.

Until all of this is done, the email channel stays **off**. Email jobs show as "Ready" so the candidate can apply
with one tap, and nothing breaks.

> **Important: copy the values from Resend.** Resend creates the DKIM key separately for every domain, so this page
> can't tell you the exact values. Copy every value exactly as Resend → Domains → apply.nm7.si shows it. The values
> below only show what each record looks like.

## 1. Add the domain in Resend

1. Sign in to Resend and open **Domains → Add domain**.
2. Enter `apply.nm7.si` (the subdomain, not `nm7.si`). Pick the region closest to India, if Resend offers one.
3. Resend now shows a list of DNS records. Keep that page open. Steps 2 to 4 below add each of them.
4. In the domain's settings, make sure **open tracking** and **click tracking** are both **off**. Auto Apply must not
   track opens or clicks, and Nm7's code never adds tracking pixels or tracked links.

## 2. Sending records: SPF and DKIM

Resend shows these under "DNS records" for apply.nm7.si. Add each one at your DNS provider with the same type, name
and value.

| What it is | Type | Name (host) | Value |
|---|---|---|---|
| SPF for the bounce subdomain Resend uses | `TXT` | as shown, usually `send.apply` | as shown, something like `v=spf1 include:amazonses.com ~all` |
| Bounce handling for that subdomain | `MX` | as shown, usually `send.apply` | as shown, something like `feedback-smtp.<region>.amazonses.com`, priority as shown (often 10) |
| DKIM (proves the email really comes from Nm7) | `TXT` (Resend may show `CNAME` instead) | as shown, usually `resend._domainkey.apply` | the long key Resend shows, copied exactly |

Notes:
- Some DNS providers add `.nm7.si` to the name on their own. If yours does, enter only the part before `.nm7.si`
  (for example `send.apply`, not `send.apply.nm7.si`). If it doesn't, enter the full name.
- Don't add a second SPF record for `nm7.si` itself. These records are only for `apply.nm7.si` and its `send`
  subdomain, so the main site's email (no-reply@nm7.si) is not affected.

## 3. Receiving record: MX for replies

So that companies' replies to `…@apply.nm7.si` reach Resend (and from there Nm7), turn on **receiving** (inbound) for
apply.nm7.si in Resend. Resend then shows an MX record. Add it:

| What it is | Type | Name (host) | Value | Priority |
|---|---|---|---|---|
| Replies to apply addresses go to Resend | `MX` | `apply` (that is, apply.nm7.si itself) | the inbound server Resend shows for receiving, copied exactly | as shown (often 10) |

This MX record is only for `apply.nm7.si`. Your normal mailbox for `@nm7.si` (info@nm7.si) keeps its own MX records,
untouched.

## 4. DMARC: tell other mail servers what to do with fakes

Add one TXT record. Start in "watch only" mode (`p=none`) and send the reports to a mailbox you own and read, for
example `dmarc@nm7.si` or your own address:

| Type | Name (host) | Value |
|---|---|---|
| `TXT` | `_dmarc.apply` | `v=DMARC1; p=none; rua=mailto:dmarc@nm7.si; adkim=s; aspf=s` |

Replace `dmarc@nm7.si` with a mailbox you really own. If `nm7.si` already has a DMARC record (`_dmarc`), it also
covers subdomains, but a separate one for `apply` lets you tighten this one on its own.

**After 2–4 weeks**, when the reports show that only Resend sends as apply.nm7.si and SPF/DKIM pass, change the value
to:

`v=DMARC1; p=quarantine; rua=mailto:dmarc@nm7.si; adkim=s; aspf=s`

(Later, if all is still clean, you can use `p=reject`.)

## 5. Check in Resend

Back on Resend → Domains → apply.nm7.si, press **Verify**. DNS can take from a few minutes up to a day. Every record
should show "Verified". Sending works once SPF and DKIM pass, and receiving works once the MX record passes.

## 6. The webhook (replies, bounces, complaints)

1. In Resend, open **Webhooks → Add endpoint**.
2. URL: `https://nm7-api.onrender.com/api/webhooks/resend` (the API's address today; once `api.nm7.si` points at
   the API, `https://api.nm7.si/api/webhooks/resend` works the same).
3. Events: tick **email.received**, **email.bounced** and **email.complained**. Others aren't needed, and Nm7 ignores
   them.
4. Save. Resend shows a **signing secret** that starts with `whsec_`. Copy it for step 7. It is a secret: don't paste
   it in chat, email or code.

## 7. Render environment variables (the API service)

| Variable | Value | Why |
|---|---|---|
| `RESEND_API_KEY` | (already set) | The same key that sends today's emails. Make sure it is allowed to send from apply.nm7.si. A full-access key, or a sending key that includes this domain, works. |
| `RESEND_INBOUND_SECRET` | the `whsec_…` signing secret from step 6 | Nm7 checks every webhook call with it and refuses anything not signed by Resend. **Without it the email channel stays off.** |
| `AUTOAPPLY_EMAIL_DOMAIN` | `apply.nm7.si` | The domain of the candidates' apply addresses. This is already the default, so it is only needed if you ever change it. |

After saving, Render restarts the API. Then open Admin → Auto Apply → "Email channel". It should say **On**, with no
missing settings listed.

## 8. Test before launch

While the Auto Apply 2.0 switch is **OFF**, a company address is never emailed:
- In Admin → Auto Apply → "Auto Apply 2.0", set **Test inbox** to a mailbox you own. Leave it empty to use each
  tester's own inbox.
- As a tester, let Auto Apply send to an email job. The test inbox gets exactly what the company would get, with
  "[Test: would go to hr@company…]" in the subject.
- Reply to that email from the test inbox. Within a minute the tester's tracker should show "Replied", the reply
  should be listed under "What was sent", and the tester should get it forwarded.
- The opt-out link in a test email shows the page but blocks nothing.

Only when this all works, and the testers are happy, turn the switch on.

## What to watch after launch

Admin → Auto Apply → "Email channel" shows emails sent today, bounces and complaints in the last 30 days (as a rate),
blocked addresses and domains, employer opt-outs (you can undo any of them), and candidates whose email channel was
paused after a complaint (you can turn it back on after looking). Keep the bounce rate under about 4% and complaints
under about 0.1%. Resend and the mail providers start limiting senders above those numbers.
