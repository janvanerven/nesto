import asyncio
import logging
import time
from typing import Any

import httpx
from fastapi import Depends, HTTPException
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from jose import JWTError, jwt

from app.config import settings

from app.database import get_db as _get_db

logger = logging.getLogger(__name__)

security = HTTPBearer(auto_error=False)

_jwks_cache: dict[str, Any] = {}
_jwks_cache_time: float = 0
_jwks_lock = asyncio.Lock()
_JWKS_CACHE_TTL = 86400  # 24 hours


async def _get_jwks() -> dict[str, Any]:
    global _jwks_cache, _jwks_cache_time
    async with _jwks_lock:
        now = time.time()
        if _jwks_cache and (now - _jwks_cache_time) < _JWKS_CACHE_TTL:
            return _jwks_cache

        async with httpx.AsyncClient(follow_redirects=True) as client:
            issuer = settings.oidc_issuer_url.rstrip("/")
            discovery_url = f"{issuer}/.well-known/openid-configuration"
            discovery = await client.get(discovery_url)
            discovery.raise_for_status()
            jwks_uri = discovery.json()["jwks_uri"]
            jwks_resp = await client.get(jwks_uri)
            jwks_resp.raise_for_status()
            _jwks_cache = jwks_resp.json()
            _jwks_cache_time = now
            return _jwks_cache


async def decode_token(
    credentials: HTTPAuthorizationCredentials | None = Depends(security),
) -> dict[str, Any]:
    if credentials is None:
        raise HTTPException(status_code=401, detail="Not authenticated")

    token = credentials.credentials
    try:
        jwks = await _get_jwks()
        payload = jwt.decode(
            token,
            jwks,
            algorithms=["RS256"],
            audience=settings.oidc_client_id,
            issuer=settings.oidc_issuer_url,
        )
        return payload
    except (JWTError, httpx.HTTPError, KeyError) as e:
        logger.warning("Token decode failed: %s: %s", type(e).__name__, e)
        raise HTTPException(status_code=401, detail="Invalid or expired token")


async def get_current_user_id(
    token: dict[str, Any] = Depends(decode_token),
    db=Depends(_get_db),
) -> str:
    sub = token.get("sub")
    if not sub:
        raise HTTPException(status_code=401, detail="Token missing subject")
    # Ensure user record exists for FK constraints
    from app.services.user_service import upsert_user
    email = token.get("email", "")
    name = token.get("preferred_username", token.get("name", email))
    avatar = token.get("picture")
    await upsert_user(db, sub=sub, email=email, name=name, avatar=avatar)
    return sub
