# ruff: noqa: E501  (the API notes)
"""Amazon Rekognition in the Mumbai region (ap-south-1): the real face-check adapter. Isolated: httpx and SigV4 signing
by hand (no AWS SDK). Photos are sent as bytes in the request body and never stored by Nm7; Rekognition does not keep
the photos of DetectFaces / CompareFaces / DetectText calls. IndexFaces keeps a face *vector* (not the photo) in the
collection, and Nm7 keeps only its FaceId (encrypted) for the joining-day check; DeleteFaces removes it.

  read_id      DetectText (Aadhaar words or a 12-digit "1234 5678 9012" number → refused; PAN / licence words)
               + DetectFaces on the card (is there a face?)
  liveness     DetectFaces (ALL attributes) on each of the 2–3 frames: exactly one clear face in each, the asked
               movement (head turn: yaw changes by 15°+; smile: Smile true on a later frame), and CompareFaces between the
               first and last frame (the same face all along). This is a challenge-response check on still frames, not
               Rekognition's certified "Face Liveness" (which needs AWS's streaming video component in the browser):
               see docs/trust/T3-vendors.md for the upgrade.
  match        CompareFaces (selfie → card), the best Similarity
  enroll       IndexFaces into REKOGNITION_COLLECTION (created on first use), ExternalImageId = a keyed hash of the user
  same_person  SearchFacesByImage in the collection, the Similarity of the stored FaceId
  forget       DeleteFaces

API: POST https://rekognition.<region>.amazonaws.com/, X-Amz-Target: RekognitionService.<Action>,
Content-Type: application/x-amz-json-1.1, Signature Version 4 (service "rekognition"). The IAM user needs only
rekognition:DetectFaces, CompareFaces, DetectText, IndexFaces, SearchFacesByImage, DeleteFaces, CreateCollection.
Keys are read from settings and never logged.
"""

import base64
import hashlib
import hmac
import json
import logging
import re
from datetime import UTC, datetime
from typing import Any

import httpx

from app.core.config import get_settings
from app.core.security import keyed_hash
from app.trust.face.providers import IdRead, Score

log = logging.getLogger("nm7.trust.face.rekognition")

HTTP_CLIENT: httpx.AsyncClient | None = None  # tests put a mock transport here
TIMEOUT = 15
YAW_MIN = 15.0  # degrees of head turn for the turn challenges
AADHAAR_TEXT = re.compile(r"aadhaar|aadhar|uidai|unique identification|आधार|\b\d{4}\s\d{4}\s\d{4}\b", re.I)
PAN_TEXT = re.compile(r"income tax|permanent account|\b[A-Z]{5}\d{4}[A-Z]\b", re.I)
DL_TEXT = re.compile(r"driving licen|transport|\bDL\b|licence no|license no", re.I)


class RekognitionError(Exception):
    def __init__(self, kind: str, message: str = ""):
        super().__init__(kind)
        self.kind = kind  # e.g. "InvalidParameterException" (no face), "ResourceNotFoundException" (no collection)
        self.message = message


def _hmac(key: bytes, msg: str) -> bytes:
    return hmac.new(key, msg.encode(), hashlib.sha256).digest()


def sign(
    method: str, host: str, region: str, target: str, body: bytes, akid: str, secret: str, at: datetime
) -> dict[str, str]:
    """AWS Signature Version 4 headers for one JSON call (service "rekognition")."""
    amz_date = at.strftime("%Y%m%dT%H%M%SZ")
    day = at.strftime("%Y%m%d")
    headers = {
        "content-type": "application/x-amz-json-1.1",
        "host": host,
        "x-amz-date": amz_date,
        "x-amz-target": target,
    }
    signed = ";".join(sorted(headers))
    canonical = "\n".join([method, "/", "", "".join(f"{k}:{headers[k]}\n" for k in sorted(headers)), signed,
                           hashlib.sha256(body).hexdigest()])  # fmt: skip
    scope = f"{day}/{region}/rekognition/aws4_request"
    to_sign = "\n".join(["AWS4-HMAC-SHA256", amz_date, scope, hashlib.sha256(canonical.encode()).hexdigest()])
    k = _hmac(_hmac(_hmac(_hmac(("AWS4" + secret).encode(), day), region), "rekognition"), "aws4_request")
    sig = hmac.new(k, to_sign.encode(), hashlib.sha256).hexdigest()
    return {
        **headers,
        "authorization": f"AWS4-HMAC-SHA256 Credential={akid}/{scope}, SignedHeaders={signed}, Signature={sig}",
    }


def _img(b: bytes) -> dict[str, str]:
    return {"Bytes": base64.b64encode(b).decode()}


class Rekognition:
    key = "rekognition"
    label = "Amazon Rekognition (Mumbai)"
    test = False

    ENV = ("REKOGNITION_ACCESS_KEY_ID", "REKOGNITION_SECRET_ACCESS_KEY", "REKOGNITION_REGION", "REKOGNITION_COLLECTION")

    def keys(self) -> dict[str, bool]:
        s = get_settings()
        return {k: bool(getattr(s, k.lower(), "")) for k in self.ENV}

    def ready(self) -> bool:
        s = get_settings()
        return bool(s.rekognition_access_key_id and s.rekognition_secret_access_key and s.rekognition_region)

    async def _call(self, action: str, payload: dict[str, Any]) -> tuple[dict[str, Any], str]:
        s = get_settings()
        region = s.rekognition_region
        host = f"rekognition.{region}.amazonaws.com"
        body = json.dumps(payload).encode()
        headers = sign("POST", host, region, f"RekognitionService.{action}", body, s.rekognition_access_key_id,
                       s.rekognition_secret_access_key, datetime.now(UTC))  # fmt: skip
        headers.pop("host")
        client = HTTP_CLIENT or httpx.AsyncClient(timeout=TIMEOUT)
        try:
            r = await client.post(f"https://{host}/", content=body, headers=headers)
        finally:
            if client is not HTTP_CLIENT:
                await client.aclose()
        ref = r.headers.get("x-amzn-requestid", "")
        try:
            data = r.json()
        except ValueError:
            data = {}
        if r.status_code >= 400:
            kind = str(data.get("__type") or f"http_{r.status_code}").rsplit("#", 1)[-1]
            log.warning(
                "rekognition %s failed: %s", action, kind
            )  # never the body (it echoes nothing secret, but still)
            raise RekognitionError(kind, str(data.get("message") or data.get("Message") or "")[:200])
        return data, ref

    async def read_id(self, image: bytes, *, hint: str = "") -> IdRead:
        text, ref = await self._call("DetectText", {"Image": _img(image)})
        words = " ".join(t.get("DetectedText", "") for t in text.get("TextDetections") or [] if t.get("Type") == "LINE")
        if AADHAAR_TEXT.search(words):
            return IdRead("aadhaar", True, ref)  # refused: nothing more is asked about this card
        kind = "pan" if PAN_TEXT.search(words) else "dl" if DL_TEXT.search(words) else "unknown"
        faces, _ = await self._call("DetectFaces", {"Image": _img(image), "Attributes": ["DEFAULT"]})
        return IdRead(kind, bool(faces.get("FaceDetails")), ref)

    async def liveness(self, frames: list[bytes], challenge: str, *, hint: str = "") -> Score:
        details = []
        ref = ""
        for f in frames:
            got, ref = await self._call("DetectFaces", {"Image": _img(f), "Attributes": ["ALL"]})
            faces = [d for d in got.get("FaceDetails") or [] if float(d.get("Confidence") or 0) >= 90]
            if len(faces) != 1:
                return Score(10, "We need exactly one face in the camera, well lit, in every photo.", ref)
            if (faces[0].get("FaceOccluded") or {}).get("Value") is True:
                return Score(15, "Something is covering your face. Please take off a mask or sunglasses.", ref)
            details.append(faces[0])
        if challenge in ("turn_left", "turn_right"):
            yaw0 = float((details[0].get("Pose") or {}).get("Yaw") or 0)
            moved = max(abs(float((d.get("Pose") or {}).get("Yaw") or 0) - yaw0) for d in details[1:])
            ok = moved >= YAW_MIN  # either direction: front cameras mirror the picture
        else:  # smile
            ok = any((d.get("Smile") or {}).get("Value") is True for d in details[1:])
        if not ok:
            return Score(30, "We couldn’t see the movement we asked for. Please try again and follow the prompt.", ref)
        try:
            same, ref = await self._call(
                "CompareFaces",
                {"SourceImage": _img(frames[0]), "TargetImage": _img(frames[-1]), "SimilarityThreshold": 0},
            )
        except RekognitionError:
            return Score(20, "We couldn’t compare the photos. Please try again in good light.", ref)
        sim = max([float(m.get("Similarity") or 0) for m in same.get("FaceMatches") or []] or [0])
        if sim < 90:
            return Score(25, "The face changed during the check. Please do it again on your own.", ref)
        return Score(min(99.0, sim), "", ref)

    async def match(self, selfie: bytes, id_image: bytes, *, hint: str = "") -> Score:
        try:
            got, ref = await self._call(
                "CompareFaces", {"SourceImage": _img(selfie), "TargetImage": _img(id_image), "SimilarityThreshold": 0}
            )
        except RekognitionError as e:
            if e.kind == "InvalidParameterException":
                return Score(0, "We couldn’t find a clear face in the selfie or on the card.")
            raise
        sim = max([float(m.get("Similarity") or 0) for m in got.get("FaceMatches") or []] or [0])
        if not got.get("FaceMatches") and not got.get("UnmatchedFaces"):
            return Score(0, "We couldn’t find a face on the card photo.", ref)
        return Score(
            sim, "" if sim >= 80 else "The selfie and the photo on the card don’t look like the same person.", ref
        )

    def _collection(self) -> str:
        return get_settings().rekognition_collection or "nm7-trust-faces"

    async def enroll(self, uid: str, selfie: bytes, *, hint: str = "") -> str:
        payload = {"CollectionId": self._collection(), "Image": _img(selfie), "ExternalImageId": keyed_hash("face-ext", uid)[:40],
                   "MaxFaces": 1, "QualityFilter": "AUTO", "DetectionAttributes": ["DEFAULT"]}  # fmt: skip
        try:
            got, _ = await self._call("IndexFaces", payload)
        except RekognitionError as e:
            if e.kind != "ResourceNotFoundException":
                raise
            await self._call("CreateCollection", {"CollectionId": self._collection()})
            got, _ = await self._call("IndexFaces", payload)
        recs = got.get("FaceRecords") or []
        if not recs:
            raise RekognitionError("NoFaceIndexed")
        return str(recs[0]["Face"]["FaceId"])

    async def same_person(self, uid: str, reference: str, selfie: bytes, *, hint: str = "") -> Score:
        try:
            got, ref = await self._call("SearchFacesByImage", {"CollectionId": self._collection(), "Image": _img(selfie),
                                                               "MaxFaces": 10, "FaceMatchThreshold": 50})  # fmt: skip
        except RekognitionError as e:
            if e.kind == "InvalidParameterException":
                return Score(0, "We couldn’t find a clear face in today’s selfie.")
            raise
        sim = max(
            [
                float(m.get("Similarity") or 0)
                for m in got.get("FaceMatches") or []
                if (m.get("Face") or {}).get("FaceId") == reference
            ]
            or [0]
        )
        return Score(
            sim, "" if sim >= 80 else "Today’s selfie doesn’t look like the person from the earlier check.", ref
        )

    async def forget(self, reference: str) -> None:
        await self._call("DeleteFaces", {"CollectionId": self._collection(), "FaceIds": [reference]})

    async def count_faces(self, image: bytes, *, hint: str = "") -> int:
        """T8 webcam snapshots: clear faces in one still photo (DetectFaces, confidence 90+)."""
        got, _ = await self._call("DetectFaces", {"Image": _img(image), "Attributes": ["DEFAULT"]})
        return sum(1 for f in got.get("FaceDetails") or [] if float(f.get("Confidence") or 0) >= 90)
