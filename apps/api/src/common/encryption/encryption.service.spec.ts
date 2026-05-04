import { EncryptionService } from './encryption.service';
import { ConfigService } from '@nestjs/config';

describe('EncryptionService', () => {
  let service: EncryptionService;

  beforeEach(() => {
    // 32-byte key as 64 hex chars
    const testKey = 'a'.repeat(64);
    const configService = {
      getOrThrow: jest.fn().mockReturnValue(testKey),
    } as unknown as ConfigService;
    service = new EncryptionService(configService);
  });

  describe('encrypt / decrypt', () => {
    it('should encrypt and decrypt a string', () => {
      const plaintext = 'Hello, Prime Developers!';
      const encrypted = service.encrypt(plaintext);
      expect(encrypted).not.toBe(plaintext);
      // Should be valid base64
      expect(() => Buffer.from(encrypted, 'base64')).not.toThrow();

      const decrypted = service.decrypt(encrypted);
      expect(decrypted).toBe(plaintext);
    });

    it('should produce different ciphertext for same plaintext (random IV)', () => {
      const plaintext = 'Same input';
      const a = service.encrypt(plaintext);
      const b = service.encrypt(plaintext);
      expect(a).not.toBe(b);
    });

    it('should handle empty string', () => {
      const encrypted = service.encrypt('');
      const decrypted = service.decrypt(encrypted);
      expect(decrypted).toBe('');
    });

    it('should handle unicode', () => {
      const plaintext = 'Hyderabad हैदराबाद 🏗️';
      const encrypted = service.encrypt(plaintext);
      expect(service.decrypt(encrypted)).toBe(plaintext);
    });

    it('should handle large strings', () => {
      const plaintext = 'x'.repeat(100_000);
      const encrypted = service.encrypt(plaintext);
      expect(service.decrypt(encrypted)).toBe(plaintext);
    });

    it('should fail to decrypt tampered ciphertext', () => {
      const encrypted = service.encrypt('secret data');
      // Tamper with the base64 string
      const buf = Buffer.from(encrypted, 'base64');
      buf[buf.length - 1] ^= 0xff; // flip last byte
      const tampered = buf.toString('base64');
      expect(() => service.decrypt(tampered)).toThrow();
    });
  });

  describe('encryptFields / decryptFields', () => {
    it('should encrypt specified fields into encryptedFields blob', () => {
      const obj = {
        id: '123',
        lender: 'First National Bank',
        principalAmt: 22000000,
        interestRate: 7.25,
        notes: 'Keep this in plain text',
      };

      const result = service.encryptFields(obj, ['lender', 'principalAmt', 'interestRate']);

      expect(result.encryptedFields).toBeDefined();
      expect(typeof result.encryptedFields).toBe('string');
      // Original fields still present (encrypt adds encryptedFields blob)
      expect(result.id).toBe('123');
      expect(result.notes).toBe('Keep this in plain text');
    });

    it('should decrypt encryptedFields back to original values', () => {
      const obj = {
        id: '123',
        lender: 'First National Bank',
        principalAmt: 22000000,
        interestRate: 7.25,
      };

      const encrypted = service.encryptFields(obj, ['lender', 'principalAmt', 'interestRate']);
      const decrypted = service.decryptFields(encrypted);

      expect(decrypted.lender).toBe('First National Bank');
      expect(decrypted.principalAmt).toBe(22000000);
      expect(decrypted.interestRate).toBe(7.25);
      expect(decrypted.id).toBe('123');
    });

    it('should handle object with no encryptedFields', () => {
      const obj = { id: '123', name: 'Test' };
      const result = service.decryptFields(obj);
      expect(result).toEqual(obj);
    });
  });
});
