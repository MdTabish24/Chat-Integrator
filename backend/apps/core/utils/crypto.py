"""
Encryption utilities for secure data storage.

Updated to use AES-256-GCM for authenticated encryption.
Migrated from backend/src/utils/encryption.ts
"""

import hashlib
import base64
import os
from typing import Optional
from cryptography.hazmat.primitives.ciphers.aead import AESGCM
from django.conf import settings


class EncryptionError(Exception):
    """Custom exception for encryption errors"""
    pass


# Constants for AES-256-GCM
IV_LENGTH = 12  # 96 bits - recommended for GCM
TAG_LENGTH = 16  # 128 bits - authentication tag
KEY_LENGTH = 32  # 256 bits for AES-256


def get_key() -> bytes:
    """
    Ensure the key is 32 bytes for AES-256.
    If the key is not exactly 32 bytes, hash it to create a valid key.
    
    Returns:
        32-byte key suitable for AES-256
    """
    key = settings.ENCRYPTION_KEY.encode()
    if len(key) != KEY_LENGTH:
        # Hash the key to ensure it's 32 bytes
        return hashlib.sha256(key).digest()
    return key


def _validate_encrypted_format(data: bytes) -> bool:
    """
    Validate that encrypted data has the correct format.
    Format: IV (12 bytes) + ciphertext (variable) + tag (16 bytes, appended by GCM)
    
    Args:
        data: The encrypted data bytes to validate
        
    Returns:
        True if format is valid, False otherwise
    """
    # Minimum length: IV (12) + at least 1 byte ciphertext + tag (16)
    min_length = IV_LENGTH + 1 + TAG_LENGTH
    return len(data) >= min_length


def encrypt(text: str) -> str:
    """
    Encrypt a string using AES-256-GCM.
    Returns the encrypted string as base64 encoded data.
    Format: base64(IV + ciphertext + tag)
    
    AES-256-GCM provides:
    - Confidentiality (encryption)
    - Integrity (authentication tag)
    - Authenticity (verifies data hasn't been tampered with)
    
    Args:
        text: The plain text to encrypt
        
    Returns:
        Base64 encoded encrypted string containing IV + ciphertext + tag
        
    Raises:
        EncryptionError: If encryption fails or input is invalid
    """
    if text is None:
        raise EncryptionError('Cannot encrypt None value')
    
    if not isinstance(text, str):
        raise EncryptionError('Input must be a string')
    
    if not text:
        raise EncryptionError('Cannot encrypt empty text')
    
    try:
        # Generate random IV (12 bytes for GCM - NIST recommended)
        iv = os.urandom(IV_LENGTH)
        
        # Create AESGCM cipher
        aesgcm = AESGCM(get_key())
        
        # Encrypt (GCM automatically appends authentication tag)
        ciphertext = aesgcm.encrypt(iv, text.encode('utf-8'), None)
        
        # Combine IV + ciphertext (tag is already appended by GCM)
        encrypted_data = iv + ciphertext
        
        # Return as base64 encoded string
        return base64.b64encode(encrypted_data).decode('ascii')
    
    except EncryptionError:
        raise
    except Exception as e:
        raise EncryptionError(f'Failed to encrypt data: {str(e)}')


def decrypt(text: str) -> str:
    """
    Decrypt a string that was encrypted with the encrypt function.
    Expects base64 encoded data in format: IV + ciphertext + tag
    
    Args:
        text: The base64 encoded encrypted text to decrypt
        
    Returns:
        Decrypted plain text string
        
    Raises:
        EncryptionError: If decryption fails, format is invalid, or authentication fails
    """
    if text is None:
        raise EncryptionError('Cannot decrypt None value')
    
    if not isinstance(text, str):
        raise EncryptionError('Input must be a string')
    
    if not text:
        raise EncryptionError('Cannot decrypt empty text')
    
    try:
        # Decode base64
        try:
            encrypted_data = base64.b64decode(text)
        except Exception:
            raise EncryptionError('Invalid encrypted text format: not valid base64')
        
        # Validate format
        if not _validate_encrypted_format(encrypted_data):
            raise EncryptionError('Invalid encrypted text format: data too short')
        
        # Extract IV and ciphertext (tag is part of ciphertext in GCM)
        iv = encrypted_data[:IV_LENGTH]
        ciphertext = encrypted_data[IV_LENGTH:]
        
        # Create AESGCM cipher
        aesgcm = AESGCM(get_key())
        
        # Decrypt (GCM automatically verifies authentication tag)
        plaintext = aesgcm.decrypt(iv, ciphertext, None)
        
        return plaintext.decode('utf-8')
    
    except EncryptionError:
        raise
    except Exception as e:
        # GCM will raise InvalidTag if authentication fails
        if 'InvalidTag' in str(type(e).__name__) or 'tag' in str(e).lower():
            raise EncryptionError('Decryption failed: data integrity check failed (tampered or corrupted)')
        raise EncryptionError(f'Failed to decrypt data: {str(e)}')


def hash_text(text: str) -> str:
    """
    Hash a text using SHA-256.
    
    Args:
        text: The text to hash
        
    Returns:
        Hashed string (hex format)
        
    Raises:
        EncryptionError: If input is invalid
    """
    if text is None:
        raise EncryptionError('Cannot hash None value')
    
    if not isinstance(text, str):
        raise EncryptionError('Input must be a string')
    
    return hashlib.sha256(text.encode()).hexdigest()


def verify_encryption_key() -> bool:
    """
    Verify if the encryption key is properly configured.
    
    Returns:
        True if key is valid and encryption/decryption works, False otherwise
    """
    try:
        test_string = 'test-encryption-key-verification'
        encrypted = encrypt(test_string)
        decrypted = decrypt(encrypted)
        return decrypted == test_string
    except Exception as e:
        print(f'Encryption key verification failed: {e}')
        return False


def is_encrypted(text: str) -> bool:
    """
    Check if a string appears to be encrypted (valid base64 with correct format).
    
    Args:
        text: The text to check
        
    Returns:
        True if the text appears to be encrypted, False otherwise
    """
    if not text or not isinstance(text, str):
        return False
    
    try:
        # Try to decode as base64
        decoded = base64.b64decode(text)
        # Check if it has the minimum length for our format
        return _validate_encrypted_format(decoded)
    except Exception:
        return False
