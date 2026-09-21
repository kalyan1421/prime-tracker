import { createHmac, timingSafeEqual } from 'node:crypto';

/**
 * Calendly signs each webhook with `Calendly-Webhook-Signature`:
 *
 *   t=1699999999,v1=<hex hmac-sha256 of "<t>.<raw body>" keyed with the signing key>
 *
 * Verified over the RAW REQUEST BYTES, never a re-serialised object: JSON.stringify does
 * not reproduce key order, whitespace or unicode escaping byte-for-byte, so re-encoding
 * the parsed body produces a different digest and every delivery would look forged.
 */

/** How old a signed timestamp may be. Bounds replay of a captured payload. */
const TOLERANCE_SECONDS = 5 * 60;

export interface SignatureCheck {
  ok: boolean;
  reason?: string;
}

export function parseSignatureHeader(header: string | undefined): { t?: string; v1?: string } {
  const out: Record<string, string> = {};
  for (const part of (header ?? '').split(',')) {
    const [k, v] = part.split('=');
    if (k && v) out[k.trim()] = v.trim();
  }
  return { t: out.t, v1: out.v1 };
}

export function verifyCalendlySignature(params: {
  rawBody: Buffer | string;
  header: string | undefined;
  signingKey: string;
  nowSeconds?: number;
}): SignatureCheck {
  const { t, v1 } = parseSignatureHeader(params.header);
  if (!t || !v1) return { ok: false, reason: 'missing signature header' };

  const ts = Number(t);
  if (!Number.isFinite(ts)) return { ok: false, reason: 'bad timestamp' };

  const now = params.nowSeconds ?? Math.floor(Date.now() / 1000);
  // Guard BOTH directions: a far-future timestamp is as suspicious as an old one.
  if (Math.abs(now - ts) > TOLERANCE_SECONDS) return { ok: false, reason: 'timestamp outside tolerance' };

  const raw = Buffer.isBuffer(params.rawBody) ? params.rawBody.toString('utf8') : params.rawBody;
  const expected = createHmac('sha256', params.signingKey).update(`${t}.${raw}`).digest('hex');

  const a = Buffer.from(expected, 'utf8');
  const b = Buffer.from(v1, 'utf8');
  // Length check first: timingSafeEqual throws on a length mismatch, and comparing with
  // === would leak how much of the digest matched.
  if (a.length !== b.length) return { ok: false, reason: 'signature mismatch' };
  return timingSafeEqual(a, b) ? { ok: true } : { ok: false, reason: 'signature mismatch' };
}
