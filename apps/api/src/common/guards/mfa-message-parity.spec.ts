import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { MFA_REQUIRED_MESSAGE } from '@prime-tracker/shared';

/**
 * The web client decides whether to open the TOTP step-up modal by string-matching the
 * 403 body against its own copy of this message. If the two ever disagree, the guard
 * still refuses correctly and the user sees a bare "Forbidden" with no prompt and no
 * way forward — a silent break with nothing in the logs to explain it.
 *
 * The obvious fix, importing the shared constant in the web app, is unavailable: the web
 * package has no dependency on @prime-tracker/shared and the deploy-web CI job does not
 * build it, so that import breaks the production deploy rather than just the local build.
 * Until that workflow is fixed, this test is what holds the two copies together.
 */
describe('MFA step-up message parity (API guard vs web client)', () => {
  const webApiClient = join(
    __dirname, '..', '..', '..', '..', 'web', 'src', 'lib', 'api.ts',
  );

  it('the web client still carries a literal to compare against', () => {
    const src = readFileSync(webApiClient, 'utf8');
    // If this fails the constant was moved or renamed. Update the regex — do not
    // delete the test, or the two copies can drift apart unnoticed.
    expect(/const MFA_REQUIRED_MESSAGE\s*=\s*'([^']+)'/.test(src)).toBe(true);
  });

  it('matches the shared constant exactly', () => {
    const src = readFileSync(webApiClient, 'utf8');
    const webValue = /const MFA_REQUIRED_MESSAGE\s*=\s*'([^']+)'/.exec(src)?.[1];
    // A mismatch means users hitting an MFA-gated route get a bare 403 with no
    // step-up modal and no way to complete the action.
    expect(webValue).toBe(MFA_REQUIRED_MESSAGE);
  });
});
