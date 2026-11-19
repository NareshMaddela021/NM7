# Vetting Trust T3: vendors for the ID + live selfie check

Until a real provider is set up, Nm7 uses the **test provider** (no real face check). On the live site the test
provider works only for admins, demo accounts and the Trust testers, and its badge says "(test)". So nothing changes for
real candidates until you finish the steps below **and** switch the provider in Admin.

## What we picked: Amazon Rekognition, Mumbai region (ap-south-1)

Why: the photos stay in India (Mumbai data centre), it is pay-per-photo with no minimum and no sales contract, the API is
stable and well documented, and it can keep a face reference (not a photo) for the joining-day check and delete it when
we ask. The adapter is one file (`backend/app/trust/face/rekognition.py`) and needs no AWS SDK.

What Nm7 asks Rekognition, per check:

| Step | Calls | Photos sent |
|---|---|---|
| ID + selfie check (before the interview / a skill check) | DetectText + DetectFaces on the card, DetectFaces on 3 selfie frames, CompareFaces (first vs last frame), CompareFaces (selfie vs card), IndexFaces (only when it passes) | 8 image operations |
| Joining-day check | DetectFaces on 2–3 frames, CompareFaces (first vs last), SearchFacesByImage | 4–5 image operations |
| Consent taken back / retention over | DeleteFaces | none |

### Approximate cost (check the AWS pricing page for Mumbai before you rely on it)

- Image APIs: about **US$0.001–0.0013 per image** for the first million a month (≈ ₹0.09–0.11).
- So **one ID + selfie check ≈ ₹0.8–1**, **one joining-day check ≈ ₹0.4–0.6**. 1,000 candidates ≈ ₹1,000–1,500 a month.
- Stored faces (for the joining-day check): about US$0.00001 per face per month — practically nothing.
- New AWS accounts get a free tier (about 5,000 images a month for the first 12 months).
- No monthly minimum, no setup fee. AWS bills in INR through Amazon Web Services India (GST invoice).

### Liveness: what it is now, and the upgrade

Now: a **challenge-response** check on 2–3 still frames (the page asks the candidate to turn their head left or right, or
smile; Rekognition reads the head angle / smile on each frame and checks it is the same face throughout). It stops a
printed photo or a photo on a phone held up to the camera. It does **not** stop a good pre-recorded video that happens to
show the asked movement.

Upgrade (when needed): **Rekognition Face Liveness** (certified passive liveness, about US$0.015 ≈ ₹1.3 per check). It
needs AWS's video-streaming component in the browser (Amplify UI `FaceLivenessDetector`) and a Cognito identity pool,
which is ~200 KB of extra JavaScript — that's why it isn't in this item. The provider interface already has a separate
`liveness()` step, so it can be swapped in without touching the rest. **Needs vendor docs confirmation** when we do it.

Alternatives (one more adapter file each): HyperVerge, IDfy, Signzy — Indian KYC vendors with certified liveness and face
match, usually ₹3–10 per check with a sales contract and a monthly minimum. Worth it if a client asks for an
"iBeta-certified liveness" stamp.

## What Naresh must do

1. **AWS account** (if Nm7 doesn't have one): https://aws.amazon.com → Create account → business details, card, PAN /
   GSTIN for the INR invoice. Turn on MFA for the root user.
2. **Opt out of AI training (important for DPDP):** AWS may keep and use photos sent to some Rekognition APIs to improve
   the service unless you opt out. AWS Organizations → Policies → **AI services opt-out policies** → enable, attach a
   policy with `"services": {"default": {"opt_out_policy": {"@@assign": "optOut"}}}` to the account. (Organizations is
   free; you can create an organization with just this one account.)
3. **IAM user just for Nm7's face check** (IAM → Users → Create user, no console access) with this inline policy:

   ```json
   {
     "Version": "2012-10-17",
     "Statement": [
       {"Effect": "Allow", "Action": ["rekognition:DetectFaces", "rekognition:CompareFaces", "rekognition:DetectText"], "Resource": "*"},
       {"Effect": "Allow", "Action": ["rekognition:IndexFaces", "rekognition:SearchFacesByImage", "rekognition:DeleteFaces", "rekognition:CreateCollection"],
        "Resource": "arn:aws:rekognition:ap-south-1:<ACCOUNT_ID>:collection/nm7-trust-faces"}
     ]
   }
   ```

   Then Security credentials → Create access key ("Application running outside AWS"). Copy both values once.
4. **Render → nm7-api → Environment**, add:

   | Variable | Value |
   |---|---|
   | `REKOGNITION_ACCESS_KEY_ID` | the access key id |
   | `REKOGNITION_SECRET_ACCESS_KEY` | the secret access key |
   | `REKOGNITION_REGION` | `ap-south-1` (the default) |
   | `REKOGNITION_COLLECTION` | `nm7-trust-faces` (the default; Nm7 creates it on the first check) |

   Never paste these anywhere else. Admin shows only "set / not set".
5. **Try it ("sandbox")**: Rekognition has no separate sandbox; the free tier is the sandbox. With the keys set, add your
   own email as a Trust tester, then Admin → Skill checks → Vetting Trust → **ID + selfie** → Provider: *Amazon
   Rekognition (Mumbai)* → Save. Do the check from Profile & settings → ID + selfie check with your PAN or licence, on a
   phone and on a laptop. Try a wrong card (someone else's photo) and a photo of a photo: both should go to "try again".
   Then switch the provider back to the test provider if you're not ready to go live.
6. Look at the pass marks (default 90 for liveness, ID match and same person). Rekognition's similarity for the same
   person with a good card photo is usually 95+; old or worn cards score lower. If many honest candidates end up with a
   person, lower the ID match mark a little (not below 80).

## Things to know

- The **test provider** passes every real camera photo. It fails on purpose when the profile name contains "nolive"
  (liveness) or "nomatch" (ID match), or "otherface" at the joining check — handy for trying the review flow.
- An **Aadhaar card is always refused** (the candidate can only pick driving licence or PAN; a photo that reads as
  Aadhaar is refused before any face check and nothing about it is kept).
- **DigiLocker photo as the ID source:** not used. T2 deliberately drops every photo DigiLocker sends, and Setu's
  DigiLocker XML photo field needs vendor docs confirmation; the candidate photographs the card instead.
