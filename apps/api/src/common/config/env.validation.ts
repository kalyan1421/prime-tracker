/**
 * Fail-fast environment validation, run by ConfigModule at boot.
 *
 * Without this, a missing secret stays `undefined` until the first request that
 * reads it (or the first `getOrThrow` call), so a misconfigured deploy looks
 * healthy and then 500s in production. Validating here means the process refuses
 * to start at all when a required secret is absent or malformed.
 *
 * Dependency-free on purpose — no Joi/class-validator wiring needed for a flat
 * list of required strings.
 */

/**
 * Secrets that must be present in every environment.
 * GOOGLE_* are intentionally NOT required: Google SSO is optional (the
 * GoogleStrategy is registered conditionally), so password login works without
 * it. When all three GOOGLE_* are set, SSO turns on automatically.
 */
const REQUIRED_KEYS = [
  'DATABASE_URL',
  'JWT_ACCESS_SECRET',
  'ENCRYPTION_KEY',
] as const;

export function validateEnv(config: Record<string, unknown>): Record<string, unknown> {
  const missing = REQUIRED_KEYS.filter((k) => {
    const v = config[k];
    return v === undefined || v === null || String(v).trim() === '';
  });

  if (missing.length > 0) {
    throw new Error(
      `Missing required environment variables: ${missing.join(', ')}. ` +
        `Set them in SSM Parameter Store / .env before starting the API.`,
    );
  }

  // ENCRYPTION_KEY must be exactly 32 bytes (64 hex chars) for AES-256-GCM.
  const key = String(config.ENCRYPTION_KEY);
  if (!/^[0-9a-fA-F]{64}$/.test(key)) {
    throw new Error('ENCRYPTION_KEY must be 64 hex characters (32 bytes) for AES-256-GCM.');
  }

  // If a previous key is supplied for rotation, validate it the same way so a
  // typo doesn't silently break decryption of historical ciphertext.
  const retired = config.ENCRYPTION_KEY_RETIRED;
  if (retired !== undefined && String(retired).trim() !== '') {
    for (const pair of String(retired).split(',')) {
      const [id, hex] = pair.split(':');
      if (!id || !/^[0-9a-fA-F]{64}$/.test(hex ?? '')) {
        throw new Error(
          `ENCRYPTION_KEY_RETIRED entries must be "<id>:<64-hex>"; got "${pair.trim()}".`,
        );
      }
    }
  }

  return config;
}
