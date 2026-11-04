import crypto from 'node:crypto';

const CIPHER = 'aes-256-gcm';
const IV_BYTES = 12;
const TAG_BYTES = 16;

function loadKey(name: 'ENCRYPTION_KEY' | 'ENCRYPTION_KEY_PREVIOUS'): Buffer {
  const encoded = process.env[name];
  if (!encoded) {
    throw new Error(`${name} tidak diatur`);
  }
  const key = Buffer.from(encoded, 'base64');
  if (key.length !== 32) {
    throw new Error(`${name} harus berupa 32 byte base64`);
  }
  return key;
}

function keyId(key: Buffer): string {
  return crypto.createHash('sha256').update(key).digest('hex').slice(0, 8);
}

export function encryptSecret(plaintext: string, aad: string): string {
  const key = loadKey('ENCRYPTION_KEY');
  const iv = crypto.randomBytes(IV_BYTES);
  const cipher = crypto.createCipheriv(CIPHER, key, iv);
  cipher.setAAD(Buffer.from(aad, 'utf8'));
  const ciphertext = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return [
    'v1',
    keyId(key),
    iv.toString('base64'),
    ciphertext.toString('base64'),
    tag.toString('base64'),
  ].join(':');
}

export function decryptSecret(stored: string, aad: string): string {
  const parts = stored.split(':');
  if (parts.length !== 5 || parts[0] !== 'v1') {
    throw new Error('format ciphertext tidak dikenal');
  }
  const [, kid, ivB64, ciphertextB64, tagB64] = parts;
  const primary = loadKey('ENCRYPTION_KEY');
  const previous = process.env.ENCRYPTION_KEY_PREVIOUS
    ? loadKey('ENCRYPTION_KEY_PREVIOUS')
    : null;

  const key = keyId(primary) === kid ? primary : previous && keyId(previous) === kid ? previous : null;
  if (!key) {
    throw new Error(`kid ${kid} tidak cocok dengan kunci yang tersedia`);
  }

  const iv = Buffer.from(ivB64, 'base64');
  const tag = Buffer.from(tagB64, 'base64');
  if (iv.length !== IV_BYTES || tag.length !== TAG_BYTES) {
    throw new Error('iv atau tag tidak valid');
  }

  const decipher = crypto.createDecipheriv(CIPHER, key, iv);
  decipher.setAAD(Buffer.from(aad, 'utf8'));
  decipher.setAuthTag(tag);
  return Buffer.concat([
    decipher.update(Buffer.from(ciphertextB64, 'base64')),
    decipher.final(),
  ]).toString('utf8');
}

export function rotateSecret(stored: string, aad: string): string {
  return encryptSecret(decryptSecret(stored, aad), aad);
}
