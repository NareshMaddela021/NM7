"""Browser tests only: a fresh RSA key for "Sign in with Google" test tokens, made each time the test API starts.

`python -m tests.e2e_google_key <file>` writes {kid, pem} (the private key, for the test that signs tokens) to <file>
and prints the matching public JWKS, which e2e-live/api.sh gives the API as GOOGLE_TEST_JWKS (ignored in production).
No key is kept in the repository.
"""

import base64
import json
import secrets
import sys

from cryptography.hazmat.primitives import serialization
from cryptography.hazmat.primitives.asymmetric import rsa


def _b64(n: int) -> str:
    return base64.urlsafe_b64encode(n.to_bytes((n.bit_length() + 7) // 8, "big")).rstrip(b"=").decode()


def main(path: str) -> None:
    key = rsa.generate_private_key(public_exponent=65537, key_size=2048)
    kid = f"e2e-{secrets.token_hex(4)}"
    pem = key.private_bytes(
        serialization.Encoding.PEM, serialization.PrivateFormat.PKCS8, serialization.NoEncryption()
    ).decode()
    with open(path, "w") as f:
        json.dump({"kid": kid, "pem": pem}, f)
    n = key.public_key().public_numbers()
    jwk = {"kty": "RSA", "alg": "RS256", "use": "sig", "kid": kid, "n": _b64(n.n), "e": _b64(n.e)}
    print(json.dumps({"keys": [jwk]}))


if __name__ == "__main__":
    main(sys.argv[1])
