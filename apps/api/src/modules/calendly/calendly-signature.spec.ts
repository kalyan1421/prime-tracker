import { createHmac } from 'node:crypto';
import { verifyCalendlySignature, parseSignatureHeader } from './calendly-signature';

const KEY = 'whsec_test_key';
const BODY = JSON.stringify({ event: 'invitee.created', payload: { uri: 'https://api.calendly.com/x' } });

const sign = (body: string, t: number, key = KEY) =>
  `t=${t},v1=${createHmac('sha256', key).update(`${t}.${body}`).digest('hex')}`;

describe('verifyCalendlySignature', () => {
  const now = 1_700_000_000;

  it('accepts a correctly signed payload', () => {
    const res = verifyCalendlySignature({
      rawBody: BODY, header: sign(BODY, now), signingKey: KEY, nowSeconds: now,
    });
    expect(res.ok).toBe(true);
  });

  it('rejects a payload signed with a different key', () => {
    const res = verifyCalendlySignature({
      rawBody: BODY, header: sign(BODY, now, 'wrong_key'), signingKey: KEY, nowSeconds: now,
    });
    expect(res).toEqual({ ok: false, reason: 'signature mismatch' });
  });

  it('rejects a body that was altered after signing', () => {
    // The whole point: a tampered booking must not be importable.
    const header = sign(BODY, now);
    const tampered = BODY.replace('invitee.created', 'invitee.canceled');
    expect(verifyCalendlySignature({
      rawBody: tampered, header, signingKey: KEY, nowSeconds: now,
    }).ok).toBe(false);
  });

  it('rejects a replay of an old capture', () => {
    const res = verifyCalendlySignature({
      rawBody: BODY, header: sign(BODY, now - 3600), signingKey: KEY, nowSeconds: now,
    });
    expect(res).toEqual({ ok: false, reason: 'timestamp outside tolerance' });
  });

  it('rejects a far-future timestamp too, not just an old one', () => {
    const res = verifyCalendlySignature({
      rawBody: BODY, header: sign(BODY, now + 3600), signingKey: KEY, nowSeconds: now,
    });
    expect(res.ok).toBe(false);
  });

  it.each([undefined, '', 'garbage', 't=123', 'v1=abc'])('rejects a malformed header (%s)', (header) => {
    expect(verifyCalendlySignature({
      rawBody: BODY, header: header as any, signingKey: KEY, nowSeconds: now,
    }).ok).toBe(false);
  });

  it('does not throw when the digest lengths differ', () => {
    // timingSafeEqual throws on a length mismatch, so the guard has to come first.
    expect(() => verifyCalendlySignature({
      rawBody: BODY, header: `t=${now},v1=short`, signingKey: KEY, nowSeconds: now,
    })).not.toThrow();
  });

  it('is byte-exact: re-serialising the parsed body breaks it', () => {
    // Why the controller must use req.rawBody. Same data, different bytes, no match.
    const reserialised = JSON.stringify(JSON.parse(BODY.replace('{"event"', '{ "event"')));
    const spaced = BODY.replace('{"event"', '{ "event"');
    expect(verifyCalendlySignature({
      rawBody: reserialised, header: sign(spaced, now), signingKey: KEY, nowSeconds: now,
    }).ok).toBe(false);
  });

  it('parses the header into its parts', () => {
    expect(parseSignatureHeader('t=123,v1=abc')).toEqual({ t: '123', v1: 'abc' });
  });
});
