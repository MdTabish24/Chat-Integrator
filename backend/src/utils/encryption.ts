import crypto from 'crypto';
import dotenv from 'dotenv';

dotenv.config();

const ALGORITHM = 'aes-256-cbc';
const ENCRYPTION_KEY = process.env.ENCRYPTION_KEY || 'default-key-change-in-production!!';
const IV_LENGTH = 16;

/**
 * Ensure the key is 32 bytes for AES-256
 * If the key is not exactly 32 bytes, hash it to create a valid key
 */
const getKey = (): Buffer => {
  const key = Buffer.from(ENCRYPTION_KEY);
  if (key.length !== 32) {
    // Hash the key to ensure it's 32 bytes
    return crypto.createHash('sha256').update(key).digest();
  }
  return key;
};

/**
 * Encrypt a string using AES-256-CBC
 * Returns the encrypted string in format: iv:encryptedData
 * 
 * @param text - The plain text to encrypt
 * @returns Encrypted string with IV prepended
 */
export const encrypt = (text: string): string => {
  if (!text) {
    throw new Error('Cannot encrypt empty text');
  }

  try {
    const iv = crypto.randomBytes(IV_LENGTH);
    const cipher = crypto.createCipheriv(ALGORITHM, getKey(), iv);
    let encrypted = cipher.update(text, 'utf8', 'hex');
    encrypted += cipher.final('hex');
    return iv.toString('hex') + ':' + encrypted;
  } catch (error) {
    console.error('Encryption error:', error);
    throw new Error('Failed to encrypt data');
  }
};

/**
 * Decrypt a string that was encrypted with the encrypt function
 * Expects format: iv:encryptedData
 * 
 * @param text - The encrypted text to decrypt
 * @returns Decrypted plain text string
 */
export const decrypt = (text: string): string => {
  if (!text) {
    throw new Error('Cannot decrypt empty text');
  }

  try {
    const parts = text.split(':');
    if (parts.length < 2) {
      throw new Error('Invalid encrypted text format');
    }

    const iv = Buffer.from(parts.shift()!, 'hex');
    const encryptedText = parts.join(':');
    const decipher = crypto.createDecipheriv(ALGORITHM, getKey(), iv);
    let decrypted = decipher.update(encryptedText, 'hex', 'utf8');
    decrypted += decipher.final('utf8');
    return decrypted;
  } catch (error) {
    console.error('Decryption error:', error);
    throw new Error('Failed to decrypt data');
  }
};

/**
 * Hash a password using SHA-256
 * Note: For production use, consider using bcrypt instead
 * 
 * @param text - The text to hash
 * @returns Hashed string
 */
export const hash = (text: string): string => {
  return crypto.createHash('sha256').update(text).digest('hex');
};

/**
 * Verify if the encryption key is properly configured
 * @returns true if key is valid, false otherwise
 */
export const verifyEncryptionKey = (): boolean => {
  try {
    const testString = 'test-encryption-key-verification';
    const encrypted = encrypt(testString);
    const decrypted = decrypt(encrypted);
    return decrypted === testString;
  } catch (error) {
    console.error('Encryption key verification failed:', error);
    return false;
  }
};
