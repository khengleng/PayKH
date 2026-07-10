import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { encrypt, decrypt, loadEncryptionKey } from '@paykh/security';

/** Thin injectable wrapper over @paykh/security AES-256-GCM using ENCRYPTION_KEY. */
@Injectable()
export class CryptoService {
  private readonly key: Buffer;

  constructor(config: ConfigService) {
    this.key = loadEncryptionKey(config.get<string>('encryptionKey') as string);
  }

  encrypt(plaintext: string): string {
    return encrypt(plaintext, this.key);
  }

  decrypt(serialized: string): string {
    return decrypt(serialized, this.key);
  }
}
