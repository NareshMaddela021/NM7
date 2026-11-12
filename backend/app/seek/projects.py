# ruff: noqa: E501  (one project a block: easier to read and edit)
"""Phase 6 S2: the first guided project of each learning path (Admin → Learning paths edits them afterwards).

Small, free to do (a phone or a free tool is enough; nothing to buy, never paid work for anyone), a few hours, and
something to send: a link (a shared sheet, a GitHub repo, a document) or a short text. The project is checked by the
student finishing it, not marked by Nm7: the badge needs the skill check too.
"""

PROJECTS: dict[str, dict] = {
    "data-analyst": {
        "title": "A one-page sales report",
        "brief": "Make a small sales report from made-up data for a corner shop: what sold most, which day was busiest.",
        "steps": [
            "Type 30 rows of sales in Google Sheets or Excel: date, item, quantity, price",
            "Add a total column and a pivot table by item",
            "Make one chart and write three lines on what it shows",
        ],
        "submit": "link",
    },
    "python-developer": {
        "title": "A to-do list in Python",
        "brief": "Write a small command-line to-do list that saves tasks in a file.",
        "steps": [
            "Add, list and remove tasks",
            "Save the list to a text or JSON file",
            "Put the code on GitHub with a short README",
        ],
        "submit": "link",
    },
    "web-developer": {
        "title": "A one-page shop website",
        "brief": "Build a single responsive page for a local shop: name, timings, three products, a contact button.",
        "steps": [
            "Write it in HTML and CSS (React is optional)",
            "Make it look right on a phone",
            "Publish it free with GitHub Pages and share the link",
        ],
        "submit": "link",
    },
    "qa-tester": {
        "title": "Test cases for a login page",
        "brief": "Write test cases for the sign-in page of any public website and report two bugs or doubts you find.",
        "steps": [
            "Write 10 test cases: steps, expected result, actual result",
            "Cover wrong password, empty fields and a long email",
            "Share the sheet or document",
        ],
        "submit": "link",
    },
    "it-support": {
        "title": "A home Wi-Fi fix guide",
        "brief": "Write a simple step-by-step guide that helps someone whose laptop can't connect to Wi-Fi.",
        "steps": [
            "List 6 checks in order, simplest first",
            "Say what to try when each check fails",
            "Send the guide as text or a document link",
        ],
        "submit": "text",
    },
    "data-entry": {
        "title": "Clean a customer list",
        "brief": "Type 25 made-up customer records into a sheet and clean them: same date format, no duplicates, proper names.",
        "steps": [
            "Type the 25 rows with a few mistakes on purpose",
            "Fix the formats and remove duplicates",
            "Share the sheet and note your typing speed",
        ],
        "submit": "link",
    },
    "customer-support": {
        "title": "Reply to three customer messages",
        "brief": "Write polite, clear replies to three common complaints: a late delivery, a wrong item and a refund question.",
        "steps": [
            "Write each reply in under 80 words",
            "Say sorry once, say what happens next, give a time",
            "Send the three replies as text",
        ],
        "submit": "text",
    },
    "sales-executive": {
        "title": "A one-minute sales pitch",
        "brief": "Write the pitch you would use to sell a water purifier to a family, and three answers to common objections.",
        "steps": [
            "Write a pitch you can say in one minute",
            "Answer: too costly, I'll think about it, I already have one",
            "Send it as text",
        ],
        "submit": "text",
    },
    "retail-associate": {
        "title": "Help a customer choose",
        "brief": "Write how you would greet a customer, ask what they need and help them pick between two phones or two shirts.",
        "steps": [
            "Write the greeting and three questions you would ask",
            "Compare the two items in simple words",
            "Send it as text",
        ],
        "submit": "text",
    },
    "hr-recruiter": {
        "title": "Screen candidates for a job",
        "brief": "Write a job post for a fresher sales role and a short sheet to screen five made-up candidates.",
        "steps": [
            "Write the job post: role, skills, location, timings",
            "Make a sheet with 5 candidates and 4 screening questions",
            "Share the document or sheet link",
        ],
        "submit": "link",
    },
    "accounts-assistant": {
        "title": "A month of shop accounts",
        "brief": "Record one month of made-up purchases and sales for a small shop and work out the GST and the profit.",
        "steps": [
            "Enter 20 purchases and sales with GST in a sheet",
            "Add totals for GST paid and collected",
            "Write the month's profit and share the sheet",
        ],
        "submit": "link",
    },
    "office-assistant": {
        "title": "Plan a team meeting",
        "brief": "Make a meeting plan for 10 people: a calendar invite text, an agenda and a sheet to track who is coming.",
        "steps": [
            "Write the invite and a 5-point agenda",
            "Make an attendance sheet",
            "Share the document or sheet link",
        ],
        "submit": "link",
    },
    "electrician": {
        "title": "Plan the wiring of one room",
        "brief": "Draw (on paper is fine) the wiring of a bedroom with 2 lights, a fan and 3 sockets, and list the safety steps.",
        "steps": [
            "Draw the circuit with the switch board",
            "List the wire sizes and the parts needed",
            "Write 5 safety steps; send a photo link of the drawing or the text",
        ],
        "submit": "text",
    },
    "fitter": {
        "title": "Explain a fitting job",
        "brief": "Pick a job you have done or seen (fixing a pump, aligning a motor) and write it as clear steps.",
        "steps": ["List the tools", "Write the steps in order", "Add the safety checks before and after"],
        "submit": "text",
    },
    "cnc-operator": {
        "title": "Read a simple drawing",
        "brief": "Take any simple part drawing (a flange or a bush) and write how you would set up and check it on the machine.",
        "steps": ["Write the set-up steps", "Write which sizes you would measure and with what", "Send it as text"],
        "submit": "text",
    },
    "service-technician": {
        "title": "Fix guide for one problem",
        "brief": "Write how you would find and fix one common problem: an AC that doesn't cool, or a phone that won't charge.",
        "steps": ["List the checks in order", "Say what you would tell the customer", "Send it as text"],
        "submit": "text",
    },
    "delivery": {
        "title": "Plan a delivery route",
        "brief": "Plan the order for 8 deliveries in your area so the route is short, and say what you do when a customer is not home.",
        "steps": [
            "List the 8 stops in order",
            "Note the time you expect",
            "Write what you do for a failed delivery; send it as text",
        ],
        "submit": "text",
    },
    "warehouse-associate": {
        "title": "Count and arrange stock",
        "brief": "Make a stock sheet for 20 items at home or a shop and say how you would arrange them so picking is fast.",
        "steps": [
            "Make a sheet: item, place, quantity",
            "Mark the 5 items that move fastest",
            "Share the sheet link or send it as text",
        ],
        "submit": "link",
    },
    "field-executive": {
        "title": "A day plan for field visits",
        "brief": "Plan 6 customer visits in one day and write what you will say at the first visit.",
        "steps": ["List the visits in order with times", "Write a short opening you would say", "Send it as text"],
        "submit": "text",
    },
    "staff-nurse": {
        "title": "A patient care checklist",
        "brief": "Write a checklist for the first hour with a newly admitted patient: what you check, record and tell the doctor.",
        "steps": ["List the checks in order", "Say what you write down", "Send it as text"],
        "submit": "text",
    },
}
