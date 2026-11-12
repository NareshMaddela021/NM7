# ruff: noqa: E501  (one question a line: easier to read and check)
"""Phase 6 S3: the practice question bank. Written for Nm7 (original; not copied from any test or book), and kept
apart from the official skill-check bank (H3): practising here never shows an official question or its answer, and
a practice score never counts as a verified skill.

Each set: a title, an area, the course skill that weak topics point to (Admin → Courses), and questions:
(topic, question, options, index of the right option, why). A question with a new line shows as code.
"""

SETS: dict[str, dict] = {
    "aptitude-numbers": {
        "title": "Aptitude: numbers", "area": "Aptitude", "course": "Aptitude",
        "questions": [
            ("Percentages", "What is 15% of 240?", ["32", "36", "38", "40"], 1, "15% of 240 = 240 × 15 ÷ 100 = 36."),
            ("Percentages", "A price goes up from ₹400 to ₹500. By what percent did it rise?", ["20%", "25%", "30%", "100%"], 1, "The rise is ₹100 on ₹400: 100 ÷ 400 = 25%."),
            ("Percentages", "A student scores 45 out of 60. What percentage is that?", ["65%", "70%", "75%", "80%"], 2, "45 ÷ 60 = 0.75, so 75%."),
            ("Ratios", "Share ₹600 between A and B in the ratio 2 : 3. How much does B get?", ["₹240", "₹300", "₹360", "₹400"], 2, "There are 2 + 3 = 5 parts; one part is ₹120; B gets 3 parts = ₹360."),
            ("Profit and loss", "Bought for ₹800 and sold for ₹1,000. What is the profit percent?", ["20%", "25%", "80%", "200%"], 1, "Profit ₹200 on the cost of ₹800: 200 ÷ 800 = 25%."),
            ("Profit and loss", "A shirt marked ₹1,200 is sold at a 10% discount. What is the selling price?", ["₹1,080", "₹1,090", "₹1,100", "₹1,180"], 0, "10% of ₹1,200 is ₹120; ₹1,200 − ₹120 = ₹1,080."),
            ("Time and work", "A finishes a job in 6 days and B in 3 days. Working together, how many days?", ["2", "3", "4.5", "9"], 0, "In a day A does 1/6 and B 1/3 = 2/6; together 3/6 = 1/2 of the job, so 2 days."),
            ("Averages", "What is the average of 12, 15, 18, 21 and 24?", ["17", "18", "19", "20"], 1, "The sum is 90 and there are 5 numbers: 90 ÷ 5 = 18."),
            ("Averages", "The average of 4 numbers is 25. Three of them are 20, 25 and 30. What is the fourth?", ["20", "25", "30", "35"], 1, "The 4 numbers add up to 4 × 25 = 100; 100 − 75 = 25."),
            ("Simple interest", "Simple interest on ₹5,000 at 8% a year for 2 years?", ["₹400", "₹800", "₹1,000", "₹1,600"], 1, "5,000 × 8 × 2 ÷ 100 = ₹800."),
            ("Speed and distance", "A bus goes 180 km in 3 hours. What is its speed?", ["50 km/h", "60 km/h", "90 km/h", "540 km/h"], 1, "Speed = distance ÷ time = 180 ÷ 3 = 60 km/h."),
            ("Speed and distance", "Walking at 5 km/h, how long does 2.5 km take?", ["20 minutes", "30 minutes", "45 minutes", "2 hours"], 1, "Time = 2.5 ÷ 5 = 0.5 hours = 30 minutes."),
        ],
    },
    "aptitude-reasoning": {
        "title": "Aptitude: reasoning", "area": "Aptitude", "course": "Aptitude",
        "questions": [
            ("Series", "What comes next: 2, 6, 12, 20, 30, ?", ["36", "40", "42", "44"], 2, "The gaps grow by 2 (4, 6, 8, 10), so the next gap is 12: 30 + 12 = 42."),
            ("Series", "What comes next: 3, 9, 27, 81, ?", ["108", "162", "243", "324"], 2, "Each number is 3 times the one before: 81 × 3 = 243."),
            ("Series", "What comes next: A, C, E, G, ?", ["H", "I", "J", "K"], 1, "Every second letter is skipped: G, (H), I."),
            ("Coding-decoding", "If CAT is written as DBU, how is DOG written?", ["CNF", "DPG", "EPH", "FQI"], 2, "Each letter moves one step forward: D→E, O→P, G→H."),
            ("Directions", "Ravi walks 5 km north, turns right and walks 3 km, then turns right again and walks 5 km. Where is he from the start?", ["3 km east", "3 km west", "5 km north", "8 km south"], 0, "North 5, east 3, south 5: the north and south cancel, leaving 3 km east."),
            ("Blood relations", "Meena's father's only son is Arjun. Who is Arjun to Meena?", ["Brother", "Father", "Uncle", "Cousin"], 0, "Her father's son is her brother."),
            ("Odd one out", "Which is the odd one out: Apple, Mango, Potato, Banana?", ["Apple", "Mango", "Potato", "Banana"], 2, "Potato is a vegetable; the others are fruits."),
            ("Odd one out", "Which is the odd one out: 2, 3, 5, 9, 11?", ["2", "3", "9", "11"], 2, "9 = 3 × 3 is not a prime number; the others are."),
            ("Syllogism", "All pens are tools. All tools are useful. Which must be true?", ["All pens are useful", "All useful things are pens", "Some tools are not pens", "No pen is useful"], 0, "Pens are inside tools and tools are inside useful things, so every pen is useful. Nothing else follows for sure."),
            ("Calendar", "If today is Monday, what day is it 10 days from now?", ["Wednesday", "Thursday", "Friday", "Sunday"], 1, "10 days = 1 week and 3 days; Monday + 3 days = Thursday."),
        ],
    },
    "english-grammar": {
        "title": "English: grammar", "area": "English", "course": "English grammar",
        "questions": [
            ("Tenses", "She ___ to college every day.", ["go", "goes", "going", "gone"], 1, "With he / she / it in the simple present, add -s: she goes."),
            ("Tenses", "Yesterday I ___ the report to my manager.", ["send", "sends", "sent", "sending"], 2, "Yesterday means the past: sent."),
            ("Tenses", "I have ___ here since 2022.", ["work", "works", "worked", "working"], 2, "Have + past participle: I have worked here since 2022."),
            ("Articles", "He is ___ engineer.", ["a", "an", "the", "(no word)"], 1, "Use an before a vowel sound: an engineer."),
            ("Articles", "___ sun rises in the east.", ["A", "An", "The", "(no word)"], 2, "There is only one sun, so we say the sun."),
            ("Prepositions", "The meeting is ___ Monday.", ["in", "on", "at", "by"], 1, "Use on with days: on Monday."),
            ("Prepositions", "She is good ___ Excel.", ["in", "at", "on", "for"], 1, "In standard English we are good at a skill."),
            ("Agreement", "Each of the students ___ a laptop.", ["have", "has", "are having", "were having"], 1, "Each is singular, so the verb is has."),
            ("Agreement", "Neither Ravi nor his friends ___ late.", ["was", "were", "is", "has"], 1, "With neither … nor, the verb follows the nearer subject: friends were."),
            ("Common mistakes", "Which sentence is correct?", ["I am having two brothers.", "I have two brothers.", "I having two brothers.", "I has two brothers."], 1, "Have (owning) is not used in the -ing form here: I have two brothers."),
        ],
    },
    "english-reading": {
        "title": "English: reading", "area": "English", "course": "Communication skills",
        "questions": [
            ("Reading", "Read: “Our store opens at 9 am on weekdays and at 10 am on Sundays. It is closed on the second Tuesday of every month for stock-taking.” When does the store open on Sunday?", ["9 am", "10 am", "It is closed", "Not given"], 1, "The text says 10 am on Sundays."),
            ("Reading", "Read: “Our store opens at 9 am on weekdays and at 10 am on Sundays. It is closed on the second Tuesday of every month for stock-taking.” Why is it closed on the second Tuesday?", ["A holiday", "Stock-taking", "Repairs", "Not given"], 1, "It says: closed … for stock-taking."),
            ("Reading", "Read: “Please send your leave request at least three working days before. Requests for more than five days need your manager's approval.” Ravi wants 7 days off. What does he need?", ["Nothing extra", "His manager's approval", "A doctor's note", "HR's phone call"], 1, "More than five days needs the manager's approval; 7 is more than 5."),
            ("Reading", "Read: “Please send your leave request at least three working days before. Requests for more than five days need your manager's approval.” When should a request be sent?", ["On the same day", "One day before", "At least three working days before", "A month before"], 2, "The text says at least three working days before."),
        ],
    },
    "english-email": {
        "title": "English: emails at work", "area": "English", "course": "Communication skills",
        "questions": [
            ("Email writing", "Which is the best subject line for a leave request?", ["Hi", "Urgent!!!", "Leave request: 12–13 Dec (Ravi Kumar)", "Please read"], 2, "A good subject says what the email is about, with the dates and your name."),
            ("Email writing", "How do you start a formal email to a manager you haven't met?", ["Hey dude,", "Dear Ms Rao,", "Yo,", "Hi dear,"], 1, "Dear + title + surname is polite and formal."),
            ("Email writing", "Which closing fits a job application email?", ["Bye", "Love, Ravi", "Regards, Ravi Kumar", "TTYL"], 2, "Regards with your full name is polite and professional."),
            ("Email writing", "You missed a call from HR. What is the best first line of your email?", ["Why did you call?", "I'm sorry I missed your call today. I'm free after 3 pm.", "Call me again.", "I was busy."], 1, "Say sorry briefly and give a time you are free."),
        ],
    },
    "coding-basics": {
        "title": "Basic coding (read the code)", "area": "Coding", "course": "Python",
        "questions": [
            ("Python basics", "What does this print?\nx = 5\ny = 2\nprint(x * y + 1)", ["7", "10", "11", "12"], 2, "Multiplication first: 5 × 2 = 10, then + 1 = 11."),
            ("Loops", "What does this print?\nfor i in range(3):\n    print(i)", ["1 2 3 (one a line)", "0 1 2 (one a line)", "0 1 2 3 (one a line)", "3"], 1, "range(3) gives 0, 1 and 2."),
            ("Lists", "What does this print?\nnums = [4, 7, 1]\nnums.append(9)\nprint(len(nums))", ["3", "4", "9", "21"], 1, "append adds one item, so the list has 4 items."),
            ("Conditions", "What does this print?\nage = 17\nif age >= 18:\n    print('adult')\nelse:\n    print('minor')", ["adult", "minor", "17", "Nothing"], 1, "17 is not 18 or more, so the else part runs."),
            ("Python basics", "What does this print?\ns = 'nm7'\nprint(s.upper())", ["nm7", "NM7", "Nm7", "An error"], 1, "upper() turns the letters into capitals; the 7 stays."),
            ("Loops", "What does this print?\ntotal = 0\nfor n in [1, 2, 3, 4]:\n    total += n\nprint(total)", ["4", "6", "10", "24"], 2, "It adds 1 + 2 + 3 + 4 = 10."),
            ("SQL reading", "What does this return?\nSELECT name FROM students WHERE marks > 80;", ["All students", "Names of students with marks above 80", "Only the marks above 80", "It deletes students"], 1, "SELECT name picks the names; WHERE keeps only marks above 80."),
            ("SQL reading", "Which clause sorts the rows a query returns?", ["WHERE", "GROUP BY", "ORDER BY", "SORT"], 2, "ORDER BY sorts; WHERE filters and GROUP BY groups."),
        ],
    },
    # practice for each official skill check (H3): different questions, never the official bank
    "role-SQL": {
        "title": "SQL (practice)", "area": "Skill check practice", "course": "SQL",
        "questions": [
            ("SQL", "Which keyword removes repeated rows from a SELECT result?", ["DISTINCT", "UNIQUE ROWS", "REMOVE", "ONLY"], 0, "SELECT DISTINCT returns each different row once."),
            ("SQL", "COUNT(*) returns…", ["the number of rows", "the sum of a column", "the largest value", "the column names"], 0, "COUNT(*) counts rows."),
            ("SQL", "Which join keeps every row of the left table?", ["INNER JOIN", "LEFT JOIN", "RIGHT JOIN", "CROSS JOIN"], 1, "LEFT JOIN keeps all left rows, with empty values where nothing matches."),
            ("SQL", "To filter groups after GROUP BY, you use…", ["WHERE", "HAVING", "ORDER BY", "LIMIT"], 1, "WHERE filters rows before grouping; HAVING filters the groups."),
        ],
    },
    "role-Excel": {
        "title": "Excel (practice)", "area": "Skill check practice", "course": "Microsoft Excel",
        "questions": [
            ("Excel", "Which formula adds the cells A1 to A10?", ["=SUM(A1:A10)", "=ADD(A1-A10)", "=TOTAL(A1,A10)", "=A1+A10"], 0, "SUM with a range (A1:A10) adds every cell in it; A1+A10 adds only two cells."),
            ("Excel", "What does $A$1 mean in a formula?", ["A cell that stays fixed when the formula is copied", "A cell with money in it", "A hidden cell", "An error"], 0, "The $ signs lock the column and the row."),
            ("Excel", "Which function finds a value in a table using a key (like an ID)?", ["CONCAT", "VLOOKUP or XLOOKUP", "TRIM", "LEN"], 1, "VLOOKUP / XLOOKUP look up a key and return a matching value."),
            ("Excel", "=IF(B2>=40,\"Pass\",\"Fail\") — what does it show when B2 is 35?", ["Pass", "Fail", "35", "An error"], 1, "35 is not 40 or more, so it shows the second value, Fail."),
        ],
    },
    "role-Customer support": {
        "title": "Customer support (practice)", "area": "Skill check practice", "course": "Customer service",
        "questions": [
            ("Customer support", "A customer is angry about a late order. What do you do first?", ["Listen and say sorry for the trouble", "Say it isn't your fault", "Put them on hold at once", "Offer a refund before listening"], 0, "Listening and saying sorry calms things down before you solve it."),
            ("Customer support", "What does “first contact resolution” mean?", ["Solving the problem in the first call or chat", "Answering the day's first call", "Calling a new customer", "Closing the chat quickly"], 0, "The problem is solved without the customer having to come back."),
            ("Customer support", "You don't know the answer. What is the best reply?", ["“I don't know.”", "“Let me check and get back to you by 4 pm.”", "“Ask someone else.”", "“Search online.”"], 1, "Promise a check and give a time, then keep it."),
            ("Customer support", "Which line ends a chat well?", ["“Bye.”", "“Okay, done.”", "“Is there anything else I can help you with today?”", "“Don't message again.”"], 2, "It is polite and makes sure nothing is left."),
        ],
    },
    "role-Sales": {
        "title": "Sales (practice)", "area": "Skill check practice", "course": "Field sales",
        "questions": [
            ("Sales", "In sales, a “lead” is…", ["a person who may buy", "a closed sale", "a product", "a discount"], 0, "A lead is a possible customer to follow up."),
            ("Sales", "A customer says “too costly”. What is a good reply?", ["Argue with them", "Ask what budget they had in mind and show the value", "Cut the price by half at once", "Walk away"], 1, "Understand their budget, then show why it is worth it."),
            ("Sales", "Which is a follow-up?", ["Calling the customer again after a demo, as promised", "Posting an advert", "Printing a brochure", "Changing the price list"], 0, "A follow-up is the next contact you promised."),
            ("Sales", "Your target is 50 sales this month. You have made 30 in three weeks. How many in the last week?", ["10", "15", "20", "30"], 2, "50 − 30 = 20 more."),
        ],
    },
    "role-Accounting": {
        "title": "Accounting (practice)", "area": "Skill check practice", "course": "Bookkeeping",
        "questions": [
            ("Accounting", "Which of these is an asset?", ["Cash in the bank", "A loan taken", "Salary still to pay", "A bill to pay a supplier"], 0, "Cash is something the business owns; the others are amounts it owes."),
            ("Accounting", "GST at 18% on an item of ₹1,000 is…", ["₹18", "₹100", "₹180", "₹1,180"], 2, "18% of 1,000 = ₹180 (₹1,180 is the total with GST)."),
            ("Accounting", "In double entry, every transaction affects…", ["one account", "at least two accounts", "only the cash book", "only the bank"], 1, "Each entry has a debit and a credit."),
            ("Accounting", "Goods bought on credit increase…", ["cash", "creditors (accounts payable)", "sales", "debtors"], 1, "You owe the supplier, so creditors go up."),
        ],
    },
    "role-Electrical": {
        "title": "Electrical (practice)", "area": "Skill check practice", "course": "Electrical wiring",
        "questions": [
            ("Electrical", "What is the unit of electrical resistance?", ["Volt", "Ampere", "Ohm", "Watt"], 2, "Resistance is measured in ohms (Ω)."),
            ("Electrical", "Before working on a circuit, you first…", ["switch it off and check it is dead", "wear gloves only", "work fast", "call the customer"], 0, "Isolate the supply and test that no voltage is present."),
            ("Electrical", "Power in watts equals…", ["voltage × current", "voltage ÷ current", "current ÷ resistance", "voltage + current"], 0, "P = V × I."),
            ("Electrical", "Which device switches off a circuit by itself on overload?", ["Transformer", "MCB", "Capacitor", "Switchboard plate"], 1, "A miniature circuit breaker (MCB) trips on overload or short circuit."),
        ],
    },
    "role-Warehouse": {
        "title": "Warehouse (practice)", "area": "Skill check practice", "course": "Inventory management",
        "questions": [
            ("Warehouse", "FIFO means…", ["first in, first out: older stock goes out first", "fast items first", "fill in forms often", "first invoice, first order"], 0, "Older stock is sent out before newer stock."),
            ("Warehouse", "Before lifting a heavy box you…", ["bend your knees and keep your back straight", "bend your back", "lift it quickly", "twist while lifting"], 0, "Lift with your legs, not your back."),
            ("Warehouse", "A SKU is…", ["a code for one type of product", "a delivery van", "a type of shelf", "a pay slip"], 0, "Stock keeping unit: one code per product type."),
            ("Warehouse", "The count shows 95 pieces but the system shows 100. What is it?", ["A stock difference to report", "A sale", "Normal, ignore it", "A new delivery"], 0, "A mismatch must be reported and checked."),
        ],
    },
    "role-Python": {
        "title": "Python (practice)", "area": "Skill check practice", "course": "Python",
        "questions": [
            ("Python", "Which of these makes a dictionary?", ["{\"a\": 1}", "[\"a\", 1]", "(\"a\", 1)", "<a=1>"], 0, "Curly braces with key: value pairs make a dictionary."),
            ("Python", "What does len('hello') return?", ["4", "5", "6", "'hello'"], 1, "hello has 5 letters."),
            ("Python", "Which keyword defines a function?", ["func", "def", "function", "lambda only"], 1, "def name(): starts a function."),
            ("Python", "What does print(10 // 3) show?", ["3", "3.33", "1", "4"], 0, "// is whole-number division: 10 // 3 = 3."),
        ],
    },
}  # fmt: skip
