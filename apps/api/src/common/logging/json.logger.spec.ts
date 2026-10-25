import { JsonLogger, resolveLogLevels } from './json.logger';
import { describeEvent } from '../events/event-bus.service';
import { clampLimit } from '../pagination/pagination.dto';

describe('resolveLogLevels', () => {
  it('defaults to info in production and debug in development', () => {
    expect(resolveLogLevels(undefined, true)).toEqual(['fatal', 'error', 'warn', 'log']);
    expect(resolveLogLevels(undefined, false)).toContain('debug');
  });

  it('honours LOG_LEVEL, case-insensitively, and ignores a typo', () => {
    expect(resolveLogLevels('DEBUG', true)).toContain('debug');
    expect(resolveLogLevels('warn', true)).toEqual(['fatal', 'error', 'warn']);
    expect(resolveLogLevels('loud', true)).toEqual(['fatal', 'error', 'warn', 'log']);
  });
});

describe('JsonLogger', () => {
  let write: jest.SpyInstance;
  beforeEach(() => {
    write = jest.spyOn(process.stdout, 'write').mockImplementation(() => true);
  });
  afterEach(() => write.mockRestore());

  it('drops debug and verbose at the production default', () => {
    const logger = new JsonLogger('', { logLevels: resolveLogLevels(undefined, true) });
    logger.debug('event payload');
    logger.verbose('noise');
    expect(write).not.toHaveBeenCalled();

    logger.log('started', 'Bootstrap');
    expect(write).toHaveBeenCalledTimes(1);
    expect(JSON.parse(String(write.mock.calls[0][0]))).toMatchObject({ level: 'log', context: 'Bootstrap', message: 'started' });
  });

  it('emits debug when LOG_LEVEL asks for it', () => {
    const logger = new JsonLogger('', { logLevels: resolveLogLevels('debug', true) });
    logger.debug('details');
    expect(write).toHaveBeenCalledTimes(1);
  });
});

describe('describeEvent (the EventBus debug line)', () => {
  it('names the event and its ids — never the buyer, tenant or amounts', () => {
    const line = describeEvent({
      type: 'lease.rentChanged', leaseId: 'l1', projectId: 'p1', from: 4200, to: 4500,
      effectiveAt: new Date('2026-01-01'), source: 'MANUAL',
    } as any);
    expect(line).toBe('lease.rentChanged leaseId=l1 projectId=p1');

    const sale = describeEvent({ type: 'lease.terminated', leaseId: 'l2', projectId: 'p1', tenantName: 'Mathnasium' } as any);
    expect(sale).not.toContain('Mathnasium');
  });
});

describe('clampLimit', () => {
  it.each([
    [undefined, 20], ['', 20], ['abc', 20], ['0', 20], ['-5', 20], ['15', 15], ['1000000', 100], [50, 50], [Number.NaN, 20],
  ])('%p → %i', (raw, expected) => {
    expect(clampLimit(raw, 20, 100)).toBe(expected);
  });
});
