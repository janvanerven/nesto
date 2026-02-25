import logging
from typing import Any

import httpx
import jwt
from jwt import PyJWKClient, PyJWTError
from fastapi import Depends, HTTPException
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer

from app.config import settings

from app.database import get_db as _get_db

logger = logging.getLogger(__name__)

security = HTTPBearer(auto_error=False)

_jwks_client: PyJWKClient | None = None


def _get_jwks_client() -> PyJWKClient:
    """Return a cached PyJWKClient, discovering the JWKS URI on first call."""
    global _jwks_client
    if _jwks_client is None:
        issuer = settings.oidc_issuer_url.rstrip("/")
        discovery_url = f"{issuer}/.well-known/openid-configuration"
        # Synchronous fetch at startup — only happens once
        resp = httpx.get(discovery_url, follow_redirects=True, timeout=10.0)
        resp.raise_for_status()
        jwks_uri = resp.json()["jwks_uri"]
        _jwks_client = PyJWKClient(
            jwks_uri,
            cache_jwk_set=True,
            lifespan=86400,  # 24 hours, matches previous TTL
        )
    return _jwks_client


async def decode_token(
    credentials: HTTPAuthorizationCredentials | None = Depends(security),
) -> dict[str, Any]:
    if credentials is None:
        raise HTTPException(status_code=401, detail="Not authenticated")

    token = credentials.credentials
    try:
        client = _get_jwks_client()
        signing_key = client.get_signing_key_from_jwt(token)
        payload = jwt.decode(
            token,
            key=signing_key.key,
            algorithms=["RS256"],
            audience=settings.oidc_client_id,
            issuer=settings.oidc_issuer_url,
        )
        return payload
    except (PyJWTError, httpx.HTTPError, KeyError) as e:
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
