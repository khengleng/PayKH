import { createPrivateKey, createPublicKey, generateKeyPairSync, sign, verify, KeyObject } from 'crypto';

export interface Ed25519KeyPairPem {
  publicKeyPem: string;
  privateKeyPem: string;
}

function asBuffer(value: string | Buffer): Buffer {
  return Buffer.isBuffer(value) ? value : Buffer.from(value, 'utf8');
}

export function generateEd25519KeyPair(): Ed25519KeyPairPem {
  const { publicKey, privateKey } = generateKeyPairSync('ed25519');
  return {
    publicKeyPem: publicKey.export({ format: 'pem', type: 'spki' }).toString(),
    privateKeyPem: privateKey.export({ format: 'pem', type: 'pkcs8' }).toString(),
  };
}

export function loadEd25519PrivateKey(privateKeyPem: string): KeyObject {
  return createPrivateKey(privateKeyPem);
}

export function loadEd25519PublicKey(publicKeyPem: string): KeyObject {
  return createPublicKey(publicKeyPem);
}

export function publicKeyPemFromPrivateKey(privateKeyPem: string): string {
  return createPublicKey(loadEd25519PrivateKey(privateKeyPem)).export({ format: 'pem', type: 'spki' }).toString();
}

export function signEd25519(privateKeyPem: string, payload: string | Buffer): string {
  return sign(null, asBuffer(payload), loadEd25519PrivateKey(privateKeyPem)).toString('base64');
}

export function verifyEd25519(publicKeyPem: string, payload: string | Buffer, signatureBase64: string): boolean {
  return verify(null, asBuffer(payload), loadEd25519PublicKey(publicKeyPem), Buffer.from(signatureBase64, 'base64'));
}
