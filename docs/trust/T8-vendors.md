# Vetting Trust T8: vendors

**Nothing new to sign up for.** The integrity rating is plain arithmetic on data Nm7 already has (no AI, no vendor).

The optional face check on webcam snapshots reuses the **T3 face-check provider** (Admin → Skill checks → Vetting
Trust → ID + selfie → Provider). With the test provider nothing is sent anywhere. With **Amazon Rekognition (Mumbai)**
(see `docs/trust/T3-vendors.md`, same keys, nothing new in Render), each snapshot costs:

| Call | What for | Approx. cost |
| --- | --- | --- |
| DetectFaces | how many faces are in the still photo | ~US$0.001 ≈ ₹0.09 |
| SearchFacesByImage | same person as the ID + selfie check (only when exactly one face is seen and the person has a T3 face reference) | ~US$0.001 ≈ ₹0.09 |

About **₹0.70 per test or interview** with 4 photos (only for people who said yes to snapshots). Turn the face check
off in Admin → Vetting Trust → Integrity rating (“Check faces …”) to store the photos without any vendor call.

The IAM user from T3 already has both permissions (`rekognition:DetectFaces`, `rekognition:SearchFacesByImage`). No new
env vars.
