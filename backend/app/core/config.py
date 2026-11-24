"""Settings, read from environment variables (or a local .env file)."""

import re
from functools import lru_cache
from typing import Annotated, Literal

from pydantic import field_validator
from pydantic_settings import BaseSettings, NoDecode, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

    # Fails closed: a service created without APP_ENV is production (no /docs, Secure cookies, no codes in the
    # log). Local development sets APP_ENV=dev in .env (see .env.example); the tests set "test".
    app_env: Literal["dev", "test", "prod"] = "prod"
    # How many proxies sit in front of the API and append the caller's address to X-Forwarded-For (Render: 1).
    # The client IP used for rate limits and audit entries is the entry that many from the right, so a caller
    # cannot choose its own by sending the header. 0 = no proxy: use the socket address.
    trusted_proxy_hops: int = 1
    # MongoDB (Atlas in production). Atlas gives a mongodb+srv:// URI; local tests use a one-node replica set.
    mongodb_uri: str = "mongodb://127.0.0.1:27017/?replicaSet=rs0"
    mongodb_db: str = "nm7"
    secret_key: str = "dev-only-secret-change-me"
    # Encrypts authenticator secrets. Falls back to SECRET_KEY; changing it breaks existing admin authenticators.
    encryption_key: str = ""
    # The Chrome Web Store reviewer's password (app/autoapply/reviewer.py). Empty (the default): Admin → Auto Apply
    # makes a strong random one. Set: that one is used (Admin still shows it to the owner, never anyone else).
    cws_reviewer_password: str = ""
    cors_origins: Annotated[list[str], NoDecode] = ["http://localhost:5173"]
    # Extra allowed origins as a full-match regex, e.g. Vercel preview deployments. Keep it tied to your own
    # project and team, never all of *.vercel.app (anyone can deploy there). Empty = none.
    cors_origin_regex: str = ""
    cookie_domain: str | None = None
    # "lax" when the site and API share a domain (nm7.si + api.nm7.si). "none" when they are different sites,
    # e.g. testing on *.onrender.com (needs HTTPS; the origin check still blocks other sites).
    cookie_samesite: Literal["lax", "none"] = "lax"

    # Email: Resend (default) or Zoho ZeptoMail. Without a key, dev prints emails to the log and production refuses
    # to promise a code (the email endpoints answer 503 "Email is temporarily unavailable").
    email_provider: Literal["resend", "zeptomail"] = "resend"
    email_from: str = "Nm7 <no-reply@nm7.si>"
    email_reply_to: str = "info@nm7.si"
    support_inbox: str = "info@nm7.si"  # support tickets are emailed here
    site_url: str = "https://nm7.si"  # links in emails
    resend_api_key: str = ""
    resend_url: str = "https://api.resend.com/emails"
    zeptomail_token: str = ""
    zeptomail_url: str = "https://api.zeptomail.in/v1.1/email"  # India data centre
    # Auto Apply 2.0 email applications (A3): each candidate's own apply address on this domain (sent with Resend; the
    # domain is verified in Resend → Domains, see docs/autoapply/apply-nm7-si-dns.md) and the signing secret of the
    # Resend webhook (inbound replies, bounces, complaints). Without the secret or the Resend key the email channel
    # stays off and email jobs fall back to "Ready" (one tap by the candidate).
    autoapply_email_domain: str = "apply.nm7.si"
    resend_inbound_secret: str = ""

    # One-time owner setup from the website (POST /api/admin/setup) for hosts without a shell. Only works while no
    # admin exists and the token is at least 24 characters. Remove it after use.
    admin_setup_token: str = ""

    # "Snap photos": reading resume details from photos with the Claude API. Without a key the feature answers
    # 503 feature_off and everything else works.
    anthropic_api_key: str = ""
    anthropic_model: str = "claude-haiku-5-5"  # an unusable answer is retried once on claude-sonnet-5-5

    # Job board: the bearer key the morning job-collector sends to POST /api/jobs/ingest (JOB_INGEST_KEY, set in
    # Render by the owner; at least 32 characters). Without it the upload answers 503 and nothing else changes.
    job_ingest_key: str = ""
    # Admin → Daily report: the latest nightly (e2e) / smoke-live results from GitHub Actions, only when a read-only
    # token is set (GITHUB_STATUS_TOKEN, optional; without it the report says "not connected").
    github_status_token: str = ""
    github_status_repo: str = "NareshMaddela021/NM7"

    # "Continue with Google" (optional): the OAuth web client ID from Google Cloud Console (GOOGLE_CLIENT_ID). It is
    # public, not a secret: the site-flags endpoint hands it to the browser. Empty (default) hides the Google button.
    google_client_id: str = ""
    # Browser tests only: Google's public keys (a JWKS as JSON) to trust instead of fetching them from Google, so test
    # tokens signed with a test key work. Ignored when APP_ENV is prod (the default), so it can't be used live.
    google_test_jwks: str = ""
    google_test_client_id: str = ""  # browser tests only, with the above: accepted but never shown in site flags

    # Error reporting (optional): a Sentry DSN. Without it errors are only logged (with a request id).
    sentry_dsn: str = ""

    # Vetting Trust T2: DigiLocker documents through a KYC vendor (Admin → Skill checks → Vetting Trust → DigiLocker
    # picks the provider; without keys only the test provider works). Setu DigiLocker: the three keys from the Setu
    # Bridge dashboard, sandbox URL until the production keys arrive. The webhook secret signs the vendor's callback.
    # The callback URL to give the vendor is api_public_url + /api/public/trust/digilocker/callback/<provider>.
    setu_dg_client_id: str = ""
    setu_dg_client_secret: str = ""
    setu_dg_product_instance_id: str = ""
    setu_dg_base_url: str = "https://dg-sandbox.setu.co"
    digilocker_webhook_secret: str = ""
    api_public_url: str = "https://nm7-api.onrender.com"

    # Vetting Trust T3: ID + live selfie face check (Admin → Skill checks → Vetting Trust → ID + selfie picks the
    # provider; without keys only the test provider works). Amazon Rekognition in Mumbai: an IAM user's access key with
    # only the Rekognition actions in docs/trust/T3-vendors.md; the collection holds face vectors for the joining check.
    rekognition_access_key_id: str = ""
    rekognition_secret_access_key: str = ""
    rekognition_region: str = "ap-south-1"
    rekognition_collection: str = "nm7-trust-faces"

    # Vetting Trust T4: employer business verification (GSTIN / Udyam / CIN lookups; Admin → Skill checks → Vetting
    # Trust → Employer checks picks the provider; without a token only the test provider works). Surepass KYC APIs:
    # one Bearer token for all three registries (docs/trust/T4-vendors.md). Sandbox https://sandbox.surepass.io,
    # live https://kyc-api.surepass.io.
    surepass_token: str = ""
    surepass_base_url: str = "https://sandbox.surepass.io"

    # Vetting Trust T5: WhatsApp + AI calls to matching candidates when a company posts a job (Admin → Skill checks →
    # Vetting Trust → Calls & WhatsApp picks the providers; without keys only the test providers work). WhatsApp: Meta
    # Cloud API (a permanent System User token, the phone number id, the app secret that signs webhooks, and a verify
    # token we choose for the webhook set-up). AI calls: Bolna (an API key, the agent id, a secret we choose that signs
    # its call-result webhook). docs/trust/T5-vendors.md. Never printed, logged or returned.
    whatsapp_access_token: str = ""
    whatsapp_phone_number_id: str = ""
    whatsapp_app_secret: str = ""
    whatsapp_verify_token: str = ""
    whatsapp_graph_url: str = "https://graph.facebook.com/v21.0"
    bolna_api_key: str = ""
    bolna_agent_id: str = ""
    bolna_base_url: str = "https://api.bolna.ai"
    voice_webhook_secret: str = ""

    # Vetting Trust T10: the spoken-English score's pronunciation part (Admin → Skill checks → Vetting Trust → Spoken
    # English picks the provider; without a key pronunciation is "not measured"). Azure AI Speech, Pronunciation
    # Assessment (REST, short audio): one Speech resource key and its region (docs/trust/T10-vendors.md).
    azure_speech_key: str = ""
    azure_speech_region: str = "centralindia"

    # Vetting Trust T14: running candidates' code for coding tasks, OUTSIDE this server (Admin → Skill checks → Vetting
    # Trust → Coding tasks picks the provider; without keys only the test sandbox works). Judge0 CE: on RapidAPI (the
    # URL below + a RapidAPI key) or self-hosted on its own small VM (its URL + the X-Auth-Token it was set up with).
    # docs/trust/T14-vendors.md. Never printed, logged or returned.
    judge0_url: str = "https://judge0-ce.p.rapidapi.com"
    judge0_rapidapi_key: str = ""
    judge0_auth_token: str = ""

    # Blog: the older articles in the Hygraph project "Team Nm7" (model BlogPost), read-only and published content only,
    # merged into nm7.si/blog by the site build (GET /api/blog/legacy, app/blog). HYGRAPH_TOKEN is a read-only Permanent
    # Auth Token of that project (default stage Published), set in Render; never printed, logged or returned. Without
    # it the source is off and the blog shows only its own posts. HYGRAPH_ENDPOINT is the project's Content API URL
    # (Project settings > Endpoints). The posts are kept in memory for BLOG_CACHE_MINUTES.
    hygraph_token: str = ""
    hygraph_endpoint: str = "https://ap-south-1.cdn.hygraph.com/content/cmtxihlft00uf06v1drejgj89/master"
    blog_cache_minutes: int = 360

    # Razorpay — empty until keys exist
    razorpay_key_id: str = ""
    razorpay_key_secret: str = ""
    razorpay_webhook_secret: str = ""

    @field_validator("cors_origins", mode="before")
    @classmethod
    def _split_origins(cls, v: str | list[str]) -> list[str]:
        if isinstance(v, str):
            return [o.strip().rstrip("/") for o in v.split(",") if o.strip()]
        return v

    @field_validator("cors_origin_regex")
    @classmethod
    def _valid_regex(cls, v: str) -> str:
        v = v.strip()
        if v:
            re.compile(v)  # fail at start-up, not on the first request
        return v

    @field_validator("cookie_domain", mode="before")
    @classmethod
    def _blank_is_none(cls, v: str | None) -> str | None:
        return v or None

    def origin_allowed(self, origin: str) -> bool:
        origin = origin.rstrip("/")
        if origin in self.cors_origins:
            return True
        return bool(self.cors_origin_regex) and re.fullmatch(self.cors_origin_regex, origin) is not None

    @property
    def is_prod(self) -> bool:
        return self.app_env == "prod"


@lru_cache
def get_settings() -> Settings:
    s = Settings()
    if s.is_prod and s.secret_key.startswith("dev-only"):
        raise RuntimeError("SECRET_KEY must be set in production")
    return s
