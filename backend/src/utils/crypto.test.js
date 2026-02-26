import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import crypto from 'crypto';

describe('crypto utils', () => {
  let originalKey;

  beforeEach(() => {
    originalKey = process.env.QB_TOKEN_ENCRYPTION_KEY;
  });

  afterEach(() => {
    if (originalKey !== undefined) {
      process.env.QB_TOKEN_ENCRYPTION_KEY = originalKey;
    } else {
      delete process.env.QB_TOKEN_ENCRYPTION_KEY;
    }
  });

  // Dynamic import to pick up env changes
  async function loadCrypto() {
    // The module reads env at call time via getKey(), so static import is fine
    const mod = await import('./crypto.js');
    return mod;
  }

  it('passes through plaintext when no encryption key is set', async () => {
    delete process.env.QB_TOKEN_ENCRYPTION_KEY;
    const { encrypt, decrypt } = await loadCrypto();

    expect(encrypt('my-secret-token')).toBe('my-secret-token');
    expect(decrypt('my-secret-token')).toBe('my-secret-token');
  });

  it('encrypts and decrypts with a hex key', async () => {
    process.env.QB_TOKEN_ENCRYPTION_KEY = crypto.randomBytes(32).toString('hex');
    const { encrypt, decrypt } = await loadCrypto();

    const plaintext = 'oauth-access-token-12345';
    const encrypted = encrypt(plaintext);

    expect(encrypted).not.toBe(plaintext);
    expect(decrypt(encrypted)).toBe(plaintext);
  });

  it('encrypts and decrypts with a base64 key', async () => {
    process.env.QB_TOKEN_ENCRYPTION_KEY = crypto.randomBytes(32).toString('base64');
    const { encrypt, decrypt } = await loadCrypto();

    const plaintext = 'oauth-refresh-token-67890';
    const encrypted = encrypt(plaintext);

    expect(encrypted).not.toBe(plaintext);
    expect(decrypt(encrypted)).toBe(plaintext);
  });

  it('produces different ciphertexts for the same plaintext (random IV)', async () => {
    process.env.QB_TOKEN_ENCRYPTION_KEY = crypto.randomBytes(32).toString('hex');
    const { encrypt } = await loadCrypto();

    const a = encrypt('same-token');
    const b = encrypt('same-token');
    expect(a).not.toBe(b);
  });

  it('gracefully handles pre-encryption plaintext when key is set', async () => {
    process.env.QB_TOKEN_ENCRYPTION_KEY = crypto.randomBytes(32).toString('hex');
    const { decrypt } = await loadCrypto();

    // Short plaintext that can't be valid ciphertext
    expect(decrypt('short')).toBe('short');

    // Longer plaintext that fails decryption
    expect(decrypt('placeholder_access_token')).toBe('placeholder_access_token');
  });
});
