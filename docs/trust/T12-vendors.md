# Vetting Trust T12: vendors

**Nothing new to sign up for, and no new Render env vars.**

- **Blind grading** (one anonymiser before every AI grading call) is plain code: it changes what is sent to the AI, not
  who it is sent to. It costs nothing (prompts get slightly shorter).
- **Discriminatory-filter warnings** (job posts, screening questions, requirements, Hire now filters) are rules (word and
  phrase lists), no AI, no vendor.
- **Pass-rate gap report** is counting in our own database once a week, no AI, no vendor.
- **Second-opinion re-grades** use the **Claude key Nm7 already has** (`ANTHROPIC_API_KEY`, the same cheap configured
  model as the V2 / V3 grading), counted in the daily AI allowance as their own feature **"regrade"** (3 a person a day;
  the site-wide daily cap still applies). One call per re-graded item:

  | Item | What is sent | Approx. cost a call |
  | --- | --- | --- |
  | Practical task (V2) | the role's rubric + the anonymised answer | ~₹0.30 |
  | AI interview (V3) | the rubric + the anonymised transcript | ~₹0.45 |
  | Explained own work (T9) | the anonymised task answer + the replies | ~₹0.30 |

  About 5% of AI-graded answers a week, **at most 60 calls a week** by default (Admin → Vetting Trust → Fairness:
  sample 1–20%, cap 0–500). At the default cap that is **at most ~₹25 a week (~₹110 a month)**; with today's volumes it
  is far less. Setting the cap to 0 turns the second opinions off. Without the key or with the allowance used up, nothing
  is re-graded that week and nothing breaks.
- The old V3 weekly interview check (5% of interviews, a second grading) keeps running as before for everyone; it is
  already counted under "interview".

## Render env vars

None new.
