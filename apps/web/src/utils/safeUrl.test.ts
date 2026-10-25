import { describe, it, expect } from 'vitest';
import { isSafeLinkUrl } from './safeUrl';

describe('isSafeLinkUrl', () => {
  it('allows web, mail and phone links', () => {
    expect(isSafeLinkUrl('https://example.com/plan.pdf')).toBe(true);
    expect(isSafeLinkUrl('http://example.com')).toBe(true);
    expect(isSafeLinkUrl('mailto:pm@example.com')).toBe(true);
    expect(isSafeLinkUrl('tel:+15125550100')).toBe(true);
  });

  it('refuses script and data links, however they are spelt', () => {
    // The browser treats every one of these as javascript: when it is an href.
    expect(isSafeLinkUrl('javascript:alert(1)')).toBe(false);
    expect(isSafeLinkUrl('JavaScript:alert(1)')).toBe(false);
    expect(isSafeLinkUrl('  javascript:alert(1)')).toBe(false);
    expect(isSafeLinkUrl('java\tscript:alert(1)')).toBe(false);
    expect(isSafeLinkUrl('data:text/html,<script>alert(1)</script>')).toBe(false);
    expect(isSafeLinkUrl('vbscript:msgbox(1)')).toBe(false);
  });

  it('refuses relative, empty and non-string values', () => {
    expect(isSafeLinkUrl('//evil.example')).toBe(false);
    expect(isSafeLinkUrl('www.example.com')).toBe(false);
    expect(isSafeLinkUrl('')).toBe(false);
    expect(isSafeLinkUrl(undefined)).toBe(false);
    expect(isSafeLinkUrl({ toString: () => 'https://x' })).toBe(false);
  });
});
