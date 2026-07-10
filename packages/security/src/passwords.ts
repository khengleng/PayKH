import bcrypt from 'bcryptjs';

/**
 * User passwords are low-entropy, so they use bcrypt (a slow KDF) — unlike API
 * keys which are high-entropy and use SHA-256.
 */
const ROUNDS = 12;

export async function hashPassword(plaintext: string): Promise<string> {
  return bcrypt.hash(plaintext, ROUNDS);
}

export async function verifyPassword(plaintext: string, hash: string): Promise<boolean> {
  return bcrypt.compare(plaintext, hash);
}
