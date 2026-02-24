import pytest
from fastapi import HTTPException
from fastapi.security import HTTPAuthorizationCredentials

from app.auth import decode_token


@pytest.mark.asyncio
async def test_decode_token_rejects_missing_token():
    with pytest.raises(HTTPException) as exc:
        await decode_token(None)
    assert exc.value.status_code == 401


@pytest.mark.asyncio
async def test_decode_token_rejects_invalid_token():
    creds = HTTPAuthorizationCredentials(scheme="Bearer", credentials="invalid.jwt.token")
    with pytest.raises(HTTPException) as exc:
        await decode_token(creds)
    assert exc.value.status_code == 401
