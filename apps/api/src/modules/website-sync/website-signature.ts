import { createHmac } from 'crypto';

/**
 * Signs a push to the website: HMAC-SHA256 over `<timestamp>.<path and query>.<raw body>`.
 *
 * The path and query are signed because the query carries `force=true` (override the
 * website's mass-removal guard) and `dryRun=true`; unsigned, anyone holding a captured
 * push could replay it inside the 5-minute window with `force=true` added.
 *
 * Mirror of PrimeDevelopers-web apps/api/src/modules/tracker-sync/tracker-signature.ts,
 * which verifies it. Both test suites assert the same vector — change one side and the
 * other's test fails.
 */
export const TIMESTAMP_HEADER = 'X-Prime-Timestamp';
export const SIGNATURE_HEADER = 'X-Prime-Signature';

/** `target` is the request's path plus query string, exactly as sent: `/api/…?force=true`. */
export function sign(secret: string, timestamp: string, target: string, rawBody: string): string {
  const mac = createHmac('sha256', secret);
  mac.update(`${timestamp}.${target}.`);
  mac.update(rawBody);
  return `sha256=${mac.digest('hex')}`;
}
