import base64

from cryptography.fernet import Fernet
from cryptography.hazmat.primitives.hashes import SHA256
from cryptography.hazmat.primitives.kdf.hkdf import HKDF

from app.config import settings


def _get_fernet() -> Fernet:
    key_bytes = settings.secret_key.encode()
    derived = HKDF(
        algorithm=SHA256(),
        length=32,
        salt=b"nesto-caldav",
        info=b"credential-encryption",
    ).derive(key_bytes)
    fernet_key = base64.urlsafe_b64encode(derived)
    return Fernet(fernet_key)


def encrypt_password(plaintext: str) -> str:
    return _get_fernet().encrypt(plaintext.encode()).decode()


def decrypt_password(ciphertext: str) -> str:
    return _get_fernet().decrypt(ciphertext.encode()).decode()
