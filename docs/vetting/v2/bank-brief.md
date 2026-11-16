# Writing a skill-check question bank (Vetting V2)

This brief is used by the bank generator (`backend/scripts/gen_vetting_bank.py`) and by anyone writing or extending a
bank by hand. Each role has one file: `backend/app/hire/vetting/banks/<slug>.json`. The roles (slug, test name, group,
languages, task type) are in `backend/app/hire/vetting/roles.py`. The exact file format is at the top of
`backend/app/hire/vetting/validate.py`. A bank is done only when this prints OK:

    cd backend && python3 -m app.hire.vetting.validate <slug>

## Content rules (non-negotiable)
- **Original only.** Write every question, option, scenario and rubric yourself for nm7.si. Never copy or closely
  paraphrase questions from other test sites, certification exams (AWS, Salesforce, ISTQB, CompTIA, NCLEX ...),
  books, question dumps or any website. Don't look anything up online.
- **Real work, India context.** Questions test what the person will actually do on the job in India (₹, GST, UPI,
  Indian addresses, IS/ISI standards, Indian traffic rules, common Indian workplaces). Trades and services use
  practical, real-situation questions (safety, tools, customer handling), not textbook theory.
- **Fair.** Nothing about religion, caste, gender, region or politics. Names in scenarios are varied and neutral.
  No trick wording. Exactly one option is clearly right to someone who knows the job; the other three are plausible
  mistakes a less skilled person makes (not silly).
- **Simple words** for non-tech roles: short sentences (≤25 words), questions ≤200 characters (scenarios ≤260).
- **No "all of the above / none of the above / both"** options. 4 options per question. Vary where the right answer
  sits (the validator wants each position right in 15–35% of questions) and don't make the right option the longest.
  Don't repeat words of the right option in the question.

## Size and spread
- At least **40 questions** per role (for the 18 existing tests: the 24 existing questions count, so add at least
  16 new ones). Aim for ~44 so Admin can turn a few off.
- **4–6 topics** per role, at least 4 questions each (aim for 7+).
- Difficulty: at least 10 easy, 12 medium, 10 hard (aim ~14 / 16 / 14). Experience bands use this:
  Fresher papers are mostly easy, 8+ year papers mostly hard. "Hard" means what a 5–8+ year professional knows
  (judgement, trade-offs, troubleshooting, edge cases), not obscure trivia.
- Mostly `"kind": "mcq"`, plus about a quarter `"kind": "scenario"` ("A customer says X. What do you do first?").
- Ids: `<slug>-001`, `<slug>-002`, ...

## Telugu and Hindi (roles whose `langs` include "te" and "hi")
- Every question (and, for the 18 existing tests, every entry in `"existing"`, and every task situation) gets
  `"te": {"q", "options"}` and `"hi": {"q", "options"}`, options in the SAME order as English.
- Natural, simple spoken-style Telugu and Hindi as used at work. Keep common English work words people actually use
  (AC, MCB, helmet, GST, UPI, order, customer) in the local script or as-is. These are marked "needs native review"
  in Admin automatically.

## The 18 existing tests
- Their 24 questions live in `backend/app/hire/bank.py` and `bank2.py` (rows whose first value is the test name).
  Put each one, by its EXACT question text, in `"existing"` with its topic (and te/hi if the role has them).
  Don't change or repeat them; add new questions in `"questions"`.

## The practical task (`"task"`)
One short task per role, done after passing the MCQ. Type comes from roles.py:
- **tech**: a small realistic problem answered in writing in 20–30 minutes (no code is run). Put the sample code /
  table / log in `"material"` (≤3000 chars). Examples: find and fix the bug in this function and explain; write the
  SQL for this question on this table; list test cases for this form; read this small dataset and answer 3
  questions. `key_points` = what a correct answer must contain.
- **written**: a realistic workplace message to write in 10–20 minutes (reply to an angry customer email, fix the
  mistakes in this GST invoice, write a job post, a short sales pitch...). Put any invoice/email in `"material"`.
- **voice**: a scenario the candidate answers out loud for 60–90 seconds (the browser turns speech into text).
  Brief = the situation and what to say. Communication IS the skill here.
- **proof**: 6–8 `"situations"`: picture-style practical questions described in words ("Which of these is the safe
  way to ...", 3–4 options, `answer` index, `topic`), plus a brief inviting an OPTIONAL photo of the candidate's own
  past work or ITI certificate (tell them: no faces).
- `rubric`: 3–5 criteria, each `{"key": "lower_case", "label": "...", "guide": "0 = ..., 3 = ..., 5 = ..."}`.
  Typical: clarity, correctness, tone, completeness (written); correctness, edge_cases, explanation (tech);
  greeting_structure, correctness, empathy, clarity (voice); relevance, genuineness, safety (proof photo).
- `title` (≤120 chars), `brief` (40–1500 chars, plain words, tell them how long and what a good answer covers),
  `minutes` (5–30).
