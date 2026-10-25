import { createHmac } from 'crypto';

/**
 * Signs a push to the website: HMAC-SHA256 over `<timestamp>.<raw body>`.
 *
 * Mirror of PrimeDevelopers-web apps/api/src/modules/tracker-sync/tracker-signature.ts,
 * which verifies it. Both test suites assert the same vector — change one side
 * and the other's test fails.
 */
export const TIMESTAMP_HEADER = 'X-Prime-Timestamp';
export const SIGNATURE_HEADER = 'X-Prime-Signature';

export function sign(secret: string, timestamp: string, rawBody: string): string {
  const mac = createHmac('sha256', secret);
  mac.update(`${timestamp}.`);
  mac.update(rawBody);
  return `sha256=${mac.digest('hex')}`;
}
