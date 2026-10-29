# Uptime alerts for Nm7 (free, set up by Naresh)

Nm7 has two things to watch:

- **The website** — `https://nm7.si` (Vercel).
- **The API** — your Render web service's address with `/health` on the end, for example
  `https://<your-service>.onrender.com/health`. Find the address in Render → your API service → the URL at the top
  of the page. `/health` answers `{"status": "ok", "db": "ok"}` when the API and its database are fine, and an error
  (503) when the database can't be reached. It accepts GET and HEAD, so any monitor works with it.

The public page **https://nm7.si/status** shows the same states to students and colleges (website, API, email),
with no internal details.

**Keeps Render awake.** A check every 5 minutes also stops the free Render server from going to sleep after 15
minutes without visits, so the first visitor of the morning doesn't wait for a cold start.

Both services below have free plans. Pick one. Plans change: check the pricing page when you sign up.

## Option A: UptimeRobot

1. Go to uptimerobot.com and create a free account with your own email. Confirm the email.
2. **Add the API monitor.** Dashboard → **+ New monitor**.
   - Monitor type: **HTTP(s)**.
   - Friendly name: `Nm7 API`.
   - URL: `https://<your-service>.onrender.com/health`.
   - Monitoring interval: **5 minutes** (the free plan's shortest when this was written).
   - Under alert contacts, tick your email. Save.
3. **Add the website monitor.** **+ New monitor** again: type **HTTP(s)**, name `Nm7 website`, URL
   `https://nm7.si`, interval 5 minutes. Save.
4. **Phone push alerts.**
   - Install the **UptimeRobot** app from the Play Store or App Store and sign in with the same account.
   - Allow notifications when the app asks.
   - In the web dashboard open **Integrations & Team** (older accounts: **My Settings → Alert contacts**). The app
     should be listed as a contact. If it isn't, add **Mobile app** there.
   - Open each monitor → **Edit** → tick the app as an alert contact → Save.
5. **Test it.** In Render, suspend the API service for a few minutes (Render → service → Settings → Suspend), wait
   for the push, then resume it. You should also get a "back up" alert.

If your plan doesn't offer app push, keep email alerts on and turn on notifications for that email in the Gmail app.

## Option B: Better Stack (Uptime)

1. Go to betterstack.com, choose **Uptime**, and create a free account with your own email.
2. **Monitors → Create monitor.**
   - Alert us when: **URL becomes unavailable**.
   - URL: `https://<your-service>.onrender.com/health`.
   - Check frequency: the shortest the free plan allows (up to 5 minutes keeps Render awake).
   - Name it `Nm7 API`. Create.
3. Create a second monitor for `https://nm7.si` named `Nm7 website`.
4. **Phone push alerts.** Install the **Better Stack** app, sign in, allow notifications. In the web dashboard open
   your profile (**Notification settings**) and turn on **Push** for incidents. Email alerts are on by default.
5. **Test it** the same way: suspend the Render service briefly, wait for the alert, resume.

## What each alert means

- **Nm7 API down:** sign-in, saving to the account, payments and downloads fail. Check Render → the service →
  Logs and Events. A 503 from `/health` means the database (MongoDB Atlas) can't be reached.
- **Nm7 website down:** Vercel isn't serving nm7.si. Check vercel.com → the project → Deployments.
- **Email delayed** shows on /status only (no monitor needed): check the Resend dashboard for failed sends.
