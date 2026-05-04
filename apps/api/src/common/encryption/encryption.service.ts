import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createCipheriv, createDecipheriv, randomBytes } from 'crypto';

@Injectable()
export class EncryptionService {
  private readonly key: Buffer;
  private readonly algorithm = 'aes-256-gcm';

  constructor(private config: ConfigService) {
    const hexKey = this.config.getOrThrow<string>('ENCRYPTION_KEY');
    this.key = Buffer.from(hexKey, 'hex');
    if (this.key.length !== 32) {
      throw new Error('ENCRYPTION_KEY must be 32 bytes (64 hex chars)');
    }
  }

  encrypt(plaintext: string): string {
    const iv = randomBytes(12);
    const cipher = createCipheriv(this.algorithm, this.key, iv);
    const encrypted = Buffer.concat([
      cipher.update(plaintext, 'utf8'),
      cipher.final(),
    ]);
    const authTag = cipher.getAuthTag();
    // Format: base64(iv:authTag:ciphertext)
    const combined = Buffer.concat([iv, authTag, encrypted]);
    return combined.toString('base64');
  }

  decrypt(encryptedBase64: string): string {
    const combined = Buffer.from(encryptedBase64, 'base64');
    const iv = combined.subarray(0, 12);
    const authTag = combined.subarray(12, 28);
    const ciphertext = combined.subarray(28);
    const decipher = createDecipheriv(this.algorithm, this.key, iv);
    decipher.setAuthTag(authTag);
    const decrypted = Buffer.concat([
      decipher.update(ciphertext),
      decipher.final(),
    ]);
    return decrypted.toString('utf8');
  }

  /** Encrypt a JSON object's specified fields */
  encryptFields<T extends Record<string, unknown>>(
    obj: T,
    fields: (keyof T)[],
  ): T & { encryptedFields: string } {
    const sensitiveData: Record<string, unknown> = {};
    const result = { ...obj } as T & { encryptedFields: string };

    for (const field of fields) {
      if (obj[field] !== undefined && obj[field] !== null) {
        sensitiveData[field as string] = obj[field];
      }
    }

    result.encryptedFields = this.encrypt(JSON.stringify(sensitiveData));
    return result;
  }

  /** Decrypt and merge encrypted fields back */
  decryptFields<T extends Record<string, unknown>>(
    obj: T & { encryptedFields?: string },
  ): T {
    if (!obj.encryptedFields) return obj;
    try {
      const decrypted = JSON.parse(this.decrypt(obj.encryptedFields));
      return { ...obj, ...decrypted };
    } catch {
      return obj;
    }
  }
}
