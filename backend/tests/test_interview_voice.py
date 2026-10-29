"""Mock interview by voice: clarity feedback adds the speaking pace (from the time actually spoken) and a better
version that uses the person's own resume result; nothing is said about emotions."""

from app.jobsearch import interview


def test_pace_from_spoken_time():
    assert interview.pace_of(10, None) is None
    assert interview.pace_of(10, 2) is None  # too short to judge
    slow = "60 words a minute: a little slow. Speak a bit faster, but keep pausing between points."
    assert interview.pace_of(60, 60) == {"wpm": 60, "text": slow}
    assert interview.pace_of(130, 60)["text"] == "130 words a minute: a clear, easy pace."
    assert interview.pace_of(200, 60)["text"].startswith("200 words a minute: a little fast")


def test_feedback_uses_spoken_seconds_and_says_nothing_about_emotions():
    q = {"id": "q5", "group": "tech", "q": "How do you use SQL?"}
    answer = "I used SQL um to join sales tables for 3 dashboards, for example the weekly report."
    typed = interview.feedback(q, answer, {})
    spoken = interview.feedback(q, answer, {}, spoken_seconds=8)
    assert typed["pace"] is None and spoken["pace"]["wpm"] == round(len(answer.split()) / (8 / 60))
    assert spoken["seconds"] == 8 and "About 8 seconds" in spoken["length"]
    assert spoken["kind"] == "clarity"
    text = " ".join(str(v) for v in spoken.values()).lower()
    for word in ("confident", "confidence", "nervous", "emotion", "anxious", "tone"):
        assert word not in text


def test_better_version_takes_the_result_from_the_resume():
    result = "The dashboard cut report time from 2 days to 2 hours."
    star = {"situation": "x", "task": "y", "action": "z", "result": result}
    q = {"id": "q9", "group": "hr", "q": "Tell me about a time you finished something hard.", "star": star}
    fb = interview.feedback(q, "When I was at Acme I had to build a dashboard and I built it in Power BI.", {})
    assert fb["star"]["result"] is False
    assert fb["better"].endswith("The dashboard cut report time from 2 days to 2 hours.")
    q["star"]["result"] = interview.RESULT_GAP
    assert (
        "[add the result" in interview.feedback(q, "When I was at Acme I had to build it and I built it.", {})["better"]
    )
