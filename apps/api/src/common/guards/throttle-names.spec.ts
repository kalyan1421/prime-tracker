import { readdirSync, readFileSync, statSync } from 'fs';
import { join } from 'path';

/**
 * Every `@Throttle()` override must name a throttler that ThrottlerModule actually
 * registers.
 *
 * ThrottlerModule.forRoot in app.module.ts registers three NAMED throttlers — short,
 * medium, long — and no unnamed one. ThrottlerGuard resolves a per-route override by
 * reading the metadata key `THROTTLER_LIMIT_<name>` once per configured throttler, so an
 * override keyed on a name that is not configured sets metadata nothing ever reads: the
 * decorator is accepted, the limit is silently discarded, and the global ceiling applies.
 *
 * That is not hypothetical. All five overrides on AuthController were written as
 * `@Throttle({ default: ... })` and every one of them was inert — including the 5/min on
 * /auth/mfa/verify, which in practice allowed 100 TOTP guesses a minute against a 6-digit
 * code. Nothing failed; the decorators simply did nothing.
 *
 * A filesystem sweep rather than a list, so a new controller is covered the moment it is
 * written — the same reasoning as route-permissions.spec.ts next door.
 */

const SRC_DIR = join(__dirname, '..', '..');
const APP_MODULE = join(SRC_DIR, 'app.module.ts');

/** Throttler names registered in ThrottlerModule.forRoot, read from the source. */
function configuredThrottlerNames(): string[] {
  const src = readFileSync(APP_MODULE, 'utf8');
  const block = src.slice(src.indexOf('ThrottlerModule.forRoot'));
  const end = block.indexOf(']);');
  const names = [...block.slice(0, end).matchAll(/name:\s*'([^']+)'/g)].map((m) => m[1]);
  // An unnamed entry would make `default` legitimate, so assert our premise holds.
  return names;
}

function controllerFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) out.push(...controllerFiles(full));
    else if (entry.endsWith('.controller.ts')) out.push(full);
  }
  return out;
}

describe('@Throttle overrides name a configured throttler', () => {
  const names = configuredThrottlerNames();

  it('registers only named throttlers (so `default` is never valid)', () => {
    expect(names.length).toBeGreaterThan(0);
    expect(names).toEqual(expect.arrayContaining(['short', 'medium', 'long']));
  });

  const files = controllerFiles(SRC_DIR).filter((f) => readFileSync(f, 'utf8').includes('@Throttle('));

  it('finds at least one @Throttle override to check', () => {
    // Guards against the sweep silently matching nothing after a refactor.
    expect(files.length).toBeGreaterThan(0);
  });

  it.each(files)('%s uses only configured throttler names', (file) => {
    const src = readFileSync(file, 'utf8');
    const used = [...src.matchAll(/@Throttle\(\{\s*([A-Za-z_][A-Za-z0-9_]*)\s*:/g)].map((m) => m[1]);
    expect(used.length).toBeGreaterThan(0);
    for (const name of used) {
      expect(names).toContain(name);
    }
  });
});
