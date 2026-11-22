from fastapi import APIRouter, HTTPException, Request, Response
from sqlalchemy import select

from ..cloud.registry import get_cache
from ..config import get_settings
from ..models import User
from ..schemas import LoginIn
from ..security import SESSION_COOKIE, create_session_token, verify_password
from .deps import CurrentUser, Db

router = APIRouter(prefix="/auth", tags=["Authentication"])


def _user(u: User) -> dict:
    return {"email": u.email, "name": u.name, "role": u.role}


@router.post("/login")
def login(body: LoginIn, request: Request, response: Response, db: Db):
    s = get_settings()
    email = body.email.strip().lower()
    client = request.client.host if request.client else "unknown"
    if get_cache().incr(f"login:{client}:{email}", 900) > s.login_attempts_per_15_min:
        raise HTTPException(429, "Too many sign-in attempts. Try again in 15 minutes.")
    user = db.scalar(select(User).where(User.email == email))
    if not verify_password(body.password, user.password_hash if user and user.active else None):
        raise HTTPException(401, "The email or password is incorrect.")
    get_cache().delete(f"login:{client}:{email}")
    response.set_cookie(
        SESSION_COOKIE, create_session_token(user.id), max_age=s.session_hours * 3600, httponly=True, samesite="lax", secure=s.cookie_secure
    )
    return _user(user)


@router.post("/logout", status_code=204)
def logout(response: Response):
    response.delete_cookie(SESSION_COOKIE)


@router.get("/me")
def me(user: CurrentUser):
    return _user(user)
