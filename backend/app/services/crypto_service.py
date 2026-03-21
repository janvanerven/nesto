import base64

from cryptography.fernet import Fernet
from cryptography.hazmat.primitives.hashes import SHA256
from cryptography.hazmat.primitives.kdf.hkdf import HKDF

from app.config import settings

_fernet_instance: Fernet | None = None


def _get_fernet() -> Fernet:
    """Return a module-level cached Fernet instance.

    Key derivation is intentionally expensive (HKDF); doing it on every
    encrypt/decrypt call is wasteful. The secret_key is fixed for the
    lifetime of the process, so caching is safe.
    """
    global _fernet_instance
    if _fernet_instance is None:
        key_bytes = settings.secret_key.encode()
        derived = HKDF(
            algorithm=SHA256(),
            length=32,
            salt=b"nesto-caldav",
            info=b"credential-encryption",
        ).derive(key_bytes)
        fernet_key = base64.urlsafe_b64encode(derived)
        _fernet_instance = Fernet(fernet_key)
    return _fernet_instance


def encrypt_password(plaintext: str) -> str:
    return _get_fernet().encrypt(plaintext.encode()).decode()


def decrypt_password(ciphertext: str) -> str:
    return _get_fernet().decrypt(ciphertext.encode()).decode()
