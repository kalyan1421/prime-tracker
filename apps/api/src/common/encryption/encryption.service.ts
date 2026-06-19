import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createCipheriv, createDecipheriv, randomBytes } from 'crypto';

/**
 * AES-256-GCM field encryption with key versioning so the key can be rotated
 * without losing access to historical ciphertext.
 *
 * Ciphertext formats supported on decrypt:
 *   - "<keyId>:<base64(iv|tag|data)>"  — versioned (written by this class now)
 *   - "<base64(iv|tag|data)>"          — legacy, unversioned (older rows)
 *
 * Rotation procedure:
 *   1. Generate a new 64-hex key. Set ENCRYPTION_KEY=<new>, ENCRYPTION_KEY_ID=v2,
 *      and ENCRYPTION_KEY_RETIRED="v1:<oldHex>".
 *   2. Deploy. New writes are tagged "v2:"; old "v1:"/legacy rows still decrypt
 *      because the retired key is loaded.
 *   3. Re-encrypt existing rows at leisure (read → encrypt → write).
 *   4. Once no ciphertext references the old key, drop ENCRYPTION_KEY_RETIRED.
 */
@Injectable()
export class EncryptionService {
  private readonly algorithm = 'aes-256-gcm';
  private readonly currentKeyId: string;
  private readonly currentKey: Buffer;
  /** All keys available for decryption, keyed by id (current + any retired). */
  private readonly keys = new Map<string, Buffer>();

  constructor(private config: ConfigService) {
    this.currentKeyId = this.config.get<string>('ENCRYPTION_KEY_ID', 'v1');
    this.currentKey = this.parseKey(this.config.getOrThrow<string>('ENCRYPTION_KEY'), 'ENCRYPTION_KEY');
    this.keys.set(this.currentKeyId, this.currentKey);

    // Optional retired keys for in-flight rotation: "v1:<hex>,v0:<hex>"
    const retired = this.config.get<string>('ENCRYPTION_KEY_RETIRED', '');
    for (const pair of retired.split(',').map((s) => s.trim()).filter(Boolean)) {
      const idx = pair.indexOf(':');
      const id = pair.slice(0, idx);
      const hex = pair.slice(idx + 1);
      this.keys.set(id, this.parseKey(hex, `ENCRYPTION_KEY_RETIRED[${id}]`));
    }
  }

  private parseKey(hex: string, label: string): Buffer {
    const key = Buffer.from(hex, 'hex');
    if (key.length !== 32) {
      throw new Error(`${label} must be 32 bytes (64 hex chars)`);
    }
    return key;
  }

  encrypt(plaintext: string): string {
    const iv = randomBytes(12);
    const cipher = createCipheriv(this.algorithm, this.currentKey, iv);
    const encrypted = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
    const authTag = cipher.getAuthTag();
    const combined = Buffer.concat([iv, authTag, encrypted]).toString('base64');
    // Tag with the key id so a future rotation knows which key produced this.
    return `${this.currentKeyId}:${combined}`;
  }

  decrypt(encrypted: string): string {
    const sep = encrypted.indexOf(':');
    // base64 never contains ':', so a ':' before the payload marks a key id.
    if (sep > 0) {
      const keyId = encrypted.slice(0, sep);
      const key = this.keys.get(keyId);
      if (key) {
        return this.decryptWith(encrypted.slice(sep + 1), key);
      }
      // Unknown id — fall through and try every key (defensive).
    }

    // Legacy unversioned ciphertext (or unknown id): try each known key. GCM's
    // auth tag makes a wrong-key attempt throw, so try-in-order is safe.
    // If there was an (unknown) "<id>:" prefix, strip it; legacy values have none.
    const payload = sep > 0 ? encrypted.slice(sep + 1) : encrypted;
    let lastErr: unknown;
    for (const key of this.keys.values()) {
      try {
        return this.decryptWith(payload, key);
      } catch (err) {
        lastErr = err;
      }
    }
    throw lastErr ?? new Error('Unable to decrypt: no matching key');
  }

  private decryptWith(base64: string, key: Buffer): string {
    const combined = Buffer.from(base64, 'base64');
    const iv = combined.subarray(0, 12);
    const authTag = combined.subarray(12, 28);
    const ciphertext = combined.subarray(28);
    const decipher = createDecipheriv(this.algorithm, key, iv);
    decipher.setAuthTag(authTag);
    return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString('utf8');
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
