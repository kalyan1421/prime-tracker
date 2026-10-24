import { spawnSync } from 'child_process';
import { join } from 'path';

/**
 * prisma/seed-demo-users.ts gives a SUPER_ADMIN a password that is printed in the repo,
 * and `pnpm db:seed` runs it. It must refuse unless ALLOW_DEMO_SEED=true is on the command
 * line, and always under NODE_ENV=production.
 *
 * Run as a real process, because the guard is top-level script code. DATABASE_URL points
 * at a port nothing listens on, so even a broken guard could not reach a database — and
 * the assertions check for the refusal message, so a connection failure (also exit 1)
 * cannot pass for one.
 */
const SEED = join(__dirname, '..', '..', 'prisma', 'seed-demo-users.ts');

function runSeed(env: Record<string, string>) {
  return spawnSync(process.execPath, ['-r', 'ts-node/register/transpile-only', SEED], {
    cwd: join(__dirname, '..', '..'),
    env: {
      PATH: process.env.PATH ?? '',
      DATABASE_URL: 'postgresql://nobody@127.0.0.1:1/none',
      DIRECT_URL: 'postgresql://nobody@127.0.0.1:1/none',
      ...env,
    },
    encoding: 'utf8',
    timeout: 60_000,
  });
}

describe('seed-demo-users.ts guard', () => {
  it('refuses without the explicit opt-in', () => {
    const run = runSeed({ NODE_ENV: 'development' });
    expect(run.status).toBe(1);
    expect(run.stderr).toContain('Refusing to seed demo users');
    expect(run.stdout).not.toContain('SUPER_ADMIN');
  });

  it('refuses under NODE_ENV=production even when opted in', () => {
    const run = runSeed({ NODE_ENV: 'production', ALLOW_DEMO_SEED: 'true' });
    expect(run.status).toBe(1);
    expect(run.stderr).toContain('NODE_ENV=production');
  });
});
