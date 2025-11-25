"""
Encryption utilities for secure data storage.

Migrated from backend/src/utils/encryption.ts
"""

import hashlib
from cryptography.hazmat.primitives.ciphers import Cipher, algorithms, modes
from cryptography.hazmat.backends import default_backend
from cryptography.hazmat.primitives import padding
import os
from django.conf import settings


class EncryptionError(Exception):
    """Custom exception for encryption errors"""
    pass


def get_key() -> bytes:
    """
    Ensure the key is 32 bytes for AES-256
    If the key is not exactly 32 bytes, hash it to create a valid key
    
    Migrated from: getKey() in encryption.ts
    """
    key = settings.ENCRYPTION_KEY.encode()
    if len(key) != 32:
        # Hash the key to ensure it's 32 bytes
        return hashlib.sha256(key).digest()
    return key


def encrypt(text: str) -> str:
    """
    Encrypt a string using AES-256-CBC
    Returns the encrypted string in format: iv:encryptedData
    
    Migrated from: encrypt() in encryption.ts
    
    Args:
        text: The plain text to encrypt
        
    Returns:
        Encrypted string with IV prepended
        
    Raises:
        EncryptionError: If encryption fails
    """
    if not text:
        raise EncryptionError('Cannot encrypt empty text')
    
    try:
        # Generate random IV (16 bytes for AES)
        iv = os.urandom(16)
        
        # Create cipher
        cipher = Cipher(
            algorithms.AES(get_key()),
            modes.CBC(iv),
            backend=default_backend()
        )
        encryptor = cipher.encryptor()
        
        # Pad the text to be multiple of 16 bytes
        padder = padding.PKCS7(128).padder()
        padded_data = padder.update(text.encode()) + padder.finalize()
        
        # Encrypt
        encrypted = encryptor.update(padded_data) + encryptor.finalize()
        
        # Return IV:encrypted format
        return iv.hex() + ':' + encrypted.hex()
    
    except Exception as e:
        raise EncryptionError(f'Failed to encrypt data: {str(e)}')


def decrypt(text: str) -> str:
    """
    Decrypt a string that was encrypted with the encrypt function
    Expects format: iv:encryptedData
    
    Migrated from: decrypt() in encryption.ts
    
    Args:
        text: The encrypted text to decrypt
        
    Returns:
        Decrypted plain text string
        
    Raises:
        EncryptionError: If decryption fails
    """
    if not text:
        raise EncryptionError('Cannot decrypt empty text')
    
    try:
        # Split IV and encrypted data
        parts = text.split(':')
        if len(parts) < 2:
            raise EncryptionError('Invalid encrypted text format')
        
        iv = bytes.fromhex(parts[0])
        encrypted_text = bytes.fromhex(':'.join(parts[1:]))
        
        # Create cipher
        cipher = Cipher(
            algorithms.AES(get_key()),
            modes.CBC(iv),
            backend=default_backend()
        )
        decryptor = cipher.decryptor()
        
        # Decrypt
        decrypted_padded = decryptor.update(encrypted_text) + decryptor.finalize()
        
        # Unpad
        unpadder = padding.PKCS7(128).unpadder()
        decrypted = unpadder.update(decrypted_padded) + unpadder.finalize()
        
        return decrypted.decode('utf-8')
    
    except Exception as e:
        raise EncryptionError(f'Failed to decrypt data: {str(e)}')


def hash_text(text: str) -> str:
    """
    Hash a text using SHA-256
    
    Migrated from: hash() in encryption.ts
    
    Args:
        text: The text to hash
        
    Returns:
        Hashed string (hex format)
    """
    return hashlib.sha256(text.encode()).hexdigest()


def verify_encryption_key() -> bool:
    """
    Verify if the encryption key is properly configured
    
    Migrated from: verifyEncryptionKey() in encryption.ts
    
    Returns:
        True if key is valid, False otherwise
    """
    try:
        test_string = 'test-encryption-key-verification'
        encrypted = encrypt(test_string)
        decrypted = decrypt(encrypted)
        return decrypted == test_string
    except Exception as e:
        print(f'Encryption key verification failed: {e}')
        return False
