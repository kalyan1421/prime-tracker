/**
 * Jest globalSetup: decide ONCE, before any test file is collected, whether a database
 * is reachable.
 *
 * This has to happen here rather than in a `beforeAll`. `describe.skip` is chosen while
 * the file is being COLLECTED, which is long before any hook runs — so a flag set in
 * beforeAll is always still false when it is read, and every case skips silently. That
 * is a test suite that looks green and checks nothing.
 *
 * globalSetup runs in the main process before workers are forked, so the env var it
 * sets is inherited by all of them.
 */
const { PrismaClient } = require('@prisma/client');

module.exports = async () => {
  const prisma = new PrismaClient();
  try {
    await prisma.$queryRaw`SELECT 1`;
    process.env.INTEGRATION_DB = '1';
    console.log('\n  [integration] database reachable — constraint tests will run');
  } catch (e) {
    process.env.INTEGRATION_DB = '';
    console.warn(
      `\n  [integration] NO database reachable (${e.message.split('\n')[0]}) — constraint tests will SKIP`,
    );
  } finally {
    await prisma.$disconnect();
  }
};
