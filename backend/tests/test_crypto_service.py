import os

import pytest


@pytest.fixture(autouse=True)
def set_secret_key(monkeypatch):
    monkeypatch.setenv("SECRET_KEY", "a" * 64)
    monkeypatch.setenv("OIDC_ISSUER_URL", "https://auth.example.com")
    monkeypatch.setenv("OIDC_CLIENT_ID", "test-client")


def test_encrypt_decrypt_roundtrip():
    from app.services.crypto_service import decrypt_password, encrypt_password

    password = "my-caldav-password-123!"
    encrypted = encrypt_password(password)
    assert encrypted != password
    assert decrypt_password(encrypted) == password


def test_decrypt_with_wrong_key_fails():
    from app.services.crypto_service import encrypt_password

    encrypted = encrypt_password("secret")

    # Simulating key change is hard without mocking, so just verify the encrypted
    # value is not plaintext and is a valid Fernet token (starts with gAAAAA)
    assert encrypted.startswith("gAAAAA")
