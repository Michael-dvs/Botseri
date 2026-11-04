import { describe, expect, it } from 'vitest';
import crypto from 'node:crypto';
import { encryptSecret, decryptSecret } from '../../src/lib/crypto';

process.env.ENCRYPTION_KEY = crypto.randomBytes(32).toString('base64');

describe('crypto', () => {
  it('melakukan round trip dengan AAD yang sama', () => {
    const stored = encryptSecret('sk-rahasia-123', 'llm_configs.api_key_enc');
    expect(stored.startsWith('v1:')).toBe(true);
    expect(decryptSecret(stored, 'llm_configs.api_key_enc')).toBe('sk-rahasia-123');
  });

  it('menolak AAD yang berbeda', () => {
    const stored = encryptSecret('token', 'oauth_tokens.access_token_enc');
    expect(() => decryptSecret(stored, 'oauth_tokens.refresh_token_enc')).toThrow();
  });

  it('mendekripsi ciphertext yang dienkripsi kunci sebelumnya', () => {
    const previous = crypto.randomBytes(32).toString('base64');
    process.env.ENCRYPTION_KEY_PREVIOUS = process.env.ENCRYPTION_KEY;
    process.env.ENCRYPTION_KEY = previous;
    const stored = encryptSecret('nilai', 'llm_configs.api_key_enc');
    expect(decryptSecret(stored, 'llm_configs.api_key_enc')).toBe('nilai');
  });
});
