# ruff: noqa: E501  (URLs and headers)
"""Azure AI Speech — Pronunciation Assessment over the short-audio REST API (speech-to-text v1).

  POST https://{region}.stt.speech.microsoft.com/speech/recognition/conversation/cognitiveservices/v1
       ?language=en-IN&format=detailed
  headers  Ocp-Apim-Subscription-Key: <key>
           Content-Type: audio/wav; codecs=audio/pcm; samplerate=16000
           Pronunciation-Assessment: base64(JSON {ReferenceText, GradingSystem: HundredMark, Granularity: Word,
                                                  Dimension: Comprehensive, EnableMiscue: false})
  answer   {RecognitionStatus: "Success", NBest: [{AccuracyScore, FluencyScore, CompletenessScore, PronScore, …}]}
           (newer answers nest the four scores under NBest[0].PronunciationAssessment: both are read)

The reference text is what the browser's speech recognition heard (unscripted speech). Short-audio REST takes up to
30 seconds of audio per request (the page sends at most 20). NEEDS VENDOR DOCS CONFIRMATION before going live: that
en-IN is on the Pronunciation Assessment language list for the chosen region, and the exact answer shape for the
current API version (docs/trust/T10-vendors.md). The clip is sent from memory and never written anywhere.
"""

import base64
import json
import logging

import httpx

from app.core.config import get_settings
from app.trust.spoken.providers import Assessment, ProviderError

log = logging.getLogger("nm7.trust.spoken.azure")
TIMEOUT = httpx.Timeout(20.0, connect=5.0)
HTTP_CLIENT: httpx.AsyncClient | None = None  # tests put a client with a mock transport here


def _num(d: dict, *keys: str) -> float | None:
    for k in keys:
        v = d.get(k)
        if isinstance(v, (int, float)):
            return float(v)
    return None


def parse(j: dict) -> Assessment:
    if str(j.get("RecognitionStatus") or "") != "Success" or not j.get("NBest"):
        raise ProviderError(f"recognition {j.get('RecognitionStatus') or 'empty'}")
    best = j["NBest"][0] or {}
    pa = best.get("PronunciationAssessment") or best
    acc = _num(pa, "AccuracyScore")
    if acc is None:
        raise ProviderError("no accuracy score")
    return Assessment(acc, _num(pa, "FluencyScore"), _num(pa, "CompletenessScore"), str(j.get("Id") or j.get("Offset") or "")[:80],
                      len(str(best.get("Lexical") or "").split()))  # fmt: skip


class Azure:
    key = "azure"
    label = "Azure AI Speech (Pronunciation Assessment)"
    test = False

    def keys(self) -> dict[str, bool]:
        s = get_settings()
        return {"AZURE_SPEECH_KEY": bool(s.azure_speech_key), "AZURE_SPEECH_REGION": bool(s.azure_speech_region)}

    def ready(self) -> bool:
        return all(self.keys().values())

    async def assess(self, audio: bytes, reference: str, *, locale: str = "en-IN") -> Assessment:
        s = get_settings()
        cfg = {"ReferenceText": (reference or "")[:1000], "GradingSystem": "HundredMark", "Granularity": "Word",
               "Dimension": "Comprehensive", "EnableMiscue": False}  # fmt: skip
        url = f"https://{s.azure_speech_region}.stt.speech.microsoft.com/speech/recognition/conversation/cognitiveservices/v1"
        headers = {"Ocp-Apim-Subscription-Key": s.azure_speech_key, "Accept": "application/json",
                   "Content-Type": "audio/wav; codecs=audio/pcm; samplerate=16000",
                   "Pronunciation-Assessment": base64.b64encode(json.dumps(cfg).encode()).decode()}  # fmt: skip
        client = HTTP_CLIENT or httpx.AsyncClient(timeout=TIMEOUT)
        try:
            r = await client.post(
                url, params={"language": locale, "format": "detailed"}, content=audio, headers=headers
            )
        except httpx.HTTPError as e:
            raise ProviderError(type(e).__name__) from None
        finally:
            if HTTP_CLIENT is None:
                await client.aclose()
        if r.status_code in (401, 403):
            log.warning("azure speech: the key was refused (%s)", r.status_code)
            raise ProviderError("auth")
        if r.status_code != 200:
            raise ProviderError(f"status {r.status_code}")
        try:
            j = r.json()
        except ValueError:
            raise ProviderError("not json") from None
        a = parse(j)
        a.ref = a.ref or r.headers.get("X-RequestId", "")[:80]
        return a
