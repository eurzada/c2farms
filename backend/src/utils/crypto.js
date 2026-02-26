import crypto from 'crypto';

const ALGORITHM = 'aes-256-gcm';
const IV_LENGTH = 12;
const AUTH_TAG_LENGTH = 16;

function getKey() {
  const key = process.env.QB_TOKEN_ENCRYPTION_KEY;
  if (!key) return null;
  if (key.length === 64) return Buffer.from(key, 'hex');
  return Buffer.from(key, 'base64');
}

/**
 * Encrypt a plaintext string with AES-256-GCM.
 * Returns base64-encoded (iv + authTag + ciphertext).
 * If QB_TOKEN_ENCRYPTION_KEY is not set, returns plaintext unchanged (dev mode).
 */
export function encrypt(plaintext) {
  const key = getKey();
  if (!key) return plaintext;

  const iv = crypto.randomBytes(IV_LENGTH);
  const cipher = crypto.createCipheriv(ALGORITHM, key, iv, { authTagLength: AUTH_TAG_LENGTH });
  const encrypted = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const authTag = cipher.getAuthTag();

  return Buffer.concat([iv, authTag, encrypted]).toString('base64');
}

/**
 * Decrypt a base64-encoded ciphertext produced by encrypt().
 * If QB_TOKEN_ENCRYPTION_KEY is not set, returns input unchanged (dev mode).
 * Gracefully handles pre-encryption plaintext data.
 */
export function decrypt(ciphertext) {
  const key = getKey();
  if (!key) return ciphertext;

  const packed = Buffer.from(ciphertext, 'base64');
  if (packed.length < IV_LENGTH + AUTH_TAG_LENGTH + 1) return ciphertext;

  const iv = packed.subarray(0, IV_LENGTH);
  const authTag = packed.subarray(IV_LENGTH, IV_LENGTH + AUTH_TAG_LENGTH);
  const encrypted = packed.subarray(IV_LENGTH + AUTH_TAG_LENGTH);

  try {
    const decipher = crypto.createDecipheriv(ALGORITHM, key, iv, { authTagLength: AUTH_TAG_LENGTH });
    decipher.setAuthTag(authTag);
    return Buffer.concat([decipher.update(encrypted), decipher.final()]).toString('utf8');
  } catch {
    // Pre-encryption plaintext or corrupted data — return as-is
    return ciphertext;
  }
}
