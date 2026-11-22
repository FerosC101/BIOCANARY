import hashlib
import hmac
import secrets
from datetime import timedelta

import jwt
from argon2 import PasswordHasher
from argon2.exceptions import VerificationError

from .config import get_settings
from .db import utcnow

SESSION_COOKIE = "biocanary_session"
_hasher = PasswordHasher()
# Verified against when the account does not exist, so response time does not reveal valid accounts.
_DUMMY = _hasher.hash("no-such-account")


def hash_password(password: str) -> str:
    return _hasher.hash(password)


def verify_password(password: str, stored: str | None) -> bool:
    try:
        return _hasher.verify(stored or _DUMMY, password) and stored is not None
    except VerificationError:
        return False


def create_session_token(user_id: int) -> str:
    s = get_settings()
    now = utcnow()
    return jwt.encode(
        {"sub": str(user_id), "iat": now, "exp": now + timedelta(hours=s.session_hours)}, s.secret_key, "HS256"
    )


def read_session_token(token: str) -> int | None:
    try:
        return int(jwt.decode(token, get_settings().secret_key, algorithms=["HS256"])["sub"])
    except (jwt.PyJWTError, KeyError, ValueError):
        return None


def new_device_key() -> str:
    return "bck_" + secrets.token_urlsafe(32)


def hash_device_key(key: str) -> str:
    # Device keys carry 256 bits of entropy, so a fast hash is sufficient.
    return hashlib.sha256(key.encode()).hexdigest()


def device_key_matches(key: str, stored: str) -> bool:
    return hmac.compare_digest(hash_device_key(key), stored)
