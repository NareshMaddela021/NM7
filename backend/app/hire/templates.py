# ruff: noqa: E501  (one template a block: easier to read and edit)
"""H8 Job templates (Phase 5): ready job posts across IT and non-IT roles, so a company can post in a minute.

  GET /api/hire/templates      every template: title, domain, kind of job, experience, lowest qualification, skills
                               (names from the skills dictionary), a description to edit, and the linked skill check
                               (H3) when the bank has a test for it

The salary is always left blank: the company fills its own. The descriptions are plain, original and fresher-friendly;
the company can change every word before posting (the usual safe-posting checks still run).
"""

from typing import Any

from fastapi import APIRouter

from app.core.db import DB
from app.hire.skillcheck import ensure_bank
from app.hire.skillcheck import skills as test_skills

router = APIRouter(prefix="/api/hire/templates", tags=["hire in 30 minutes"])

# id, domain, title, job type, experience, education, skills, test skill, description
TEMPLATES: list[dict[str, Any]] = [
    # IT
    {
        "id": "data-analyst",
        "domain": "IT",
        "title": "Junior Data Analyst",
        "jobType": "full_time",
        "experience": "fresher",
        "education": "graduate",
        "skills": ["SQL", "Microsoft Excel", "Power BI"],
        "test": "SQL",
        "description": "Prepare weekly sales and stock reports from our database. Clean data in Excel, write SQL queries and "
        "build simple Power BI dashboards for the team. Freshers who have done a data project are welcome; "
        "training is given in the first month.",
    },
    {
        "id": "python-developer",
        "domain": "IT",
        "title": "Python Developer (Fresher)",
        "jobType": "full_time",
        "experience": "fresher",
        "education": "graduate",
        "skills": ["Python", "SQL", "Git"],
        "test": "Python",
        "description": "Write and test Python code for our internal tools and APIs. You will fix bugs, add small features and "
        "review code with a senior developer. Good basics in Python and SQL matter more than years.",
    },
    {
        "id": "web-developer",
        "domain": "IT",
        "title": "Front-end Web Developer",
        "jobType": "full_time",
        "experience": "0_1",
        "education": "graduate",
        "skills": ["HTML", "CSS", "JavaScript", "React"],
        "test": "",
        "description": "Build and update pages of our web app with HTML, CSS, JavaScript and React. Make screens work well on "
        "phones, fix layout bugs and work with the design and back-end teams.",
    },
    {
        "id": "it-support",
        "domain": "IT",
        "title": "IT Support Executive",
        "jobType": "full_time",
        "experience": "fresher",
        "education": "diploma",
        "skills": ["Desktop support", "Technical support", "Networking"],
        "test": "",
        "description": "Set up laptops and printers, install software, fix common Windows and network problems and help "
        "colleagues on call or in person. A diploma or degree in computers or electronics is enough to start.",
    },
    {
        "id": "qa-tester",
        "domain": "IT",
        "title": "Software Tester (Manual)",
        "jobType": "full_time",
        "experience": "fresher",
        "education": "graduate",
        "skills": ["Manual testing", "Test cases", "SQL"],
        "test": "SQL",
        "description": "Test new features of our app before each release. Write test cases, report bugs clearly with steps to "
        "repeat them, and check fixes. Training on our tools is given.",
    },
    {
        "id": "data-entry",
        "domain": "IT",
        "title": "Data Entry Operator",
        "jobType": "full_time",
        "experience": "fresher",
        "education": "12th",
        "skills": ["Data entry", "Microsoft Excel", "Typing"],
        "test": "Microsoft Excel",
        "description": "Enter and check customer and order details in our system and in Excel sheets. Accuracy and a steady "
        "typing speed matter. 12th pass with basic computer knowledge can apply.",
    },
    # Non-IT
    {
        "id": "customer-support",
        "domain": "Customer service",
        "title": "Customer Support Executive",
        "jobType": "full_time",
        "experience": "fresher",
        "education": "12th",
        "skills": ["Customer service", "Communication skills", "Telesales"],
        "test": "Customer support",
        "description": "Answer customer calls and chats, solve order and delivery questions, and follow up until the problem "
        "is closed. Clear speaking in English and one Indian language helps. Rotational shifts.",
    },
    {
        "id": "sales-executive",
        "domain": "Sales",
        "title": "Field Sales Executive",
        "jobType": "full_time",
        "experience": "fresher",
        "education": "12th",
        "skills": ["Field sales", "Lead generation", "Negotiation"],
        "test": "Sales",
        "description": "Visit shops and offices in your area, explain our products, take orders and follow up on payments. "
        "Travel allowance is paid. A two-wheeler and a driving licence are useful.",
    },
    {
        "id": "accounts-assistant",
        "domain": "Accounts",
        "title": "Accounts Assistant",
        "jobType": "full_time",
        "experience": "fresher",
        "education": "graduate",
        "skills": ["Tally", "GST", "Bookkeeping", "Microsoft Excel"],
        "test": "Accounting",
        "description": "Record purchases, sales and payments in Tally, prepare GST working papers and help with bank "
        "reconciliation every month. B.Com freshers who know Tally basics are welcome.",
    },
    {
        "id": "electrician",
        "domain": "Technician",
        "title": "Electrician (ITI)",
        "jobType": "full_time",
        "experience": "fresher",
        "education": "iti",
        "skills": ["Electrical wiring", "Multimeter", "Workplace safety"],
        "test": "Electrical",
        "description": "Install and repair wiring, switchboards and fittings at our sites, find faults with a multimeter and "
        "follow safety rules every time. ITI Electrician pass; safety gear is provided.",
    },
    {
        "id": "fitter",
        "domain": "Technician",
        "title": "Fitter (ITI)",
        "jobType": "full_time",
        "experience": "fresher",
        "education": "iti",
        "skills": ["Fitting", "Workplace safety"],
        "test": "",
        "description": "Assemble, fit and maintain machine parts on the shop floor, read simple drawings and keep the work "
        "area safe. ITI Fitter pass. Shift work with overtime pay.",
    },
    {
        "id": "warehouse-associate",
        "domain": "Logistics",
        "title": "Warehouse Associate",
        "jobType": "full_time",
        "experience": "fresher",
        "education": "10th",
        "skills": ["Inventory management", "Picking and packing", "Forklift operation"],
        "test": "Warehouse",
        "description": "Receive goods, check them against the invoice, store them, and pick and pack orders on time. Scanner "
        "training is given. 10th pass can apply; forklift experience is a plus.",
    },
    {
        "id": "delivery",
        "domain": "Logistics",
        "title": "Delivery Executive",
        "jobType": "full_time",
        "experience": "fresher",
        "education": "10th",
        "skills": ["Last-mile delivery", "Driving"],
        "test": "",
        "description": "Deliver parcels to homes and shops in your area using our app for routes. A two-wheeler with a valid "
        "licence is needed. Daily incentives on top of salary.",
    },
    {
        "id": "store-staff",
        "domain": "Retail",
        "title": "Retail Store Associate",
        "jobType": "full_time",
        "experience": "fresher",
        "education": "12th",
        "skills": ["Retail sales", "Billing counter", "Customer service"],
        "test": "",
        "description": "Help customers find products, handle billing at the counter, keep shelves stocked and tidy, and "
        "count stock at the end of the day. Friendly, on-time people are welcome.",
    },
    {
        "id": "nurse",
        "domain": "Healthcare",
        "title": "Staff Nurse",
        "jobType": "full_time",
        "experience": "fresher",
        "education": "diploma",
        "skills": ["Nursing", "First aid"],
        "test": "",
        "description": "Care for patients on the ward, give medicines as prescribed, record vital signs and support doctors "
        "on rounds. GNM or B.Sc Nursing with a valid registration.",
    },
    {
        "id": "office-assistant",
        "domain": "Office",
        "title": "Office Assistant",
        "jobType": "full_time",
        "experience": "fresher",
        "education": "12th",
        "skills": ["Microsoft Excel", "Data entry", "Communication skills"],
        "test": "Microsoft Excel",
        "description": "Keep files and records in order, update Excel sheets, answer calls and help the team with daily "
        "office work. 12th pass with basic computer skills.",
    },
]


@router.get("")
async def templates(db: DB) -> list[dict[str, Any]]:
    await ensure_bank(db)
    have = await test_skills(db)
    return [{**t, "salary": None, "test": t["test"] if t["test"] in have else ""} for t in TEMPLATES]
