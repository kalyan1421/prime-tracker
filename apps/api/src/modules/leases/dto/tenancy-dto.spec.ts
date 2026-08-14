import { ValidationPipe } from '@nestjs/common';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { EndTenancyDto } from './end-tenancy.dto';
import { AssignTenantDto } from './assign-tenant.dto';

/**
 * DTO validation for the tenancy transitions.
 *
 * These run the real `ValidationPipe` rules, which no other test in the repo does —
 * every existing spec calls the service directly and therefore starts AFTER validation
 * has already happened. A DTO that silently accepted a bad enum value would look fine
 * in all 649 of them.
 */

/**
 * The pipe as main.ts actually configures it. `forbidNonWhitelisted` is the setting
 * that makes an undeclared field a 400 rather than a silently-dropped one, and it is
 * what several assertions below actually rest on.
 */
const productionPipe = new ValidationPipe({
  whitelist: true,
  forbidNonWhitelisted: true,
  transform: true,
});

const throughPipe = (Dto: any, payload: Record<string, unknown>) =>
  productionPipe.transform(payload, { type: 'body', metatype: Dto });

/**
 * The pipe throws a BadRequestException whose top-level `.message` is just "Bad Request
 * Exception" — the field-level detail lives in `.response.message`. Asserting on the
 * outer message would pass for any 400 at all, including one thrown for a different
 * reason, so these dig out the real payload.
 */
const pipeRejection = async (Dto: any, payload: Record<string, unknown>): Promise<string[]> => {
  try {
    await throughPipe(Dto, payload);
    throw new Error('expected the pipe to reject, but it accepted the payload');
  } catch (err: any) {
    const detail = err?.response?.message;
    if (!detail) throw err;
    return Array.isArray(detail) ? detail : [detail];
  }
};

const errorsOn = async (Dto: any, payload: Record<string, unknown>) => {
  const dto = plainToInstance(Dto, payload);
  const errors = await validate(dto as object);
  return errors.map((e) => e.property);
};

const VALID_END = {
  terminationDate: '2026-06-30',
  terminationReason: 'EARLY_TERMINATION',
};

describe('EndTenancyDto', () => {
  it('accepts the minimum a real end-tenancy needs', async () => {
    expect(await errorsOn(EndTenancyDto, VALID_END)).toEqual([]);
  });

  it('requires a move-out date', async () => {
    expect(await errorsOn(EndTenancyDto, { terminationReason: 'EXPIRED' }))
      .toContain('terminationDate');
  });

  it('rejects a date that is not a date', async () => {
    expect(await errorsOn(EndTenancyDto, { ...VALID_END, terminationDate: 'last Tuesday' }))
      .toContain('terminationDate');
  });

  it('requires a reason — a tenancy that ended for no stated reason cannot be reported on', async () => {
    expect(await errorsOn(EndTenancyDto, { terminationDate: '2026-06-30' }))
      .toContain('terminationReason');
  });

  it('rejects a reason outside the enum', async () => {
    // The reason is what tells renewal and relocation apart from a genuine turnover, so
    // a free-text value would break the derivation, not just the reporting.
    expect(await errorsOn(EndTenancyDto, { ...VALID_END, terminationReason: 'BECAUSE' }))
      .toContain('terminationReason');
  });

  it.each([
    'EXPIRED', 'NON_RENEWAL', 'EARLY_TERMINATION', 'EVICTION', 'MUTUAL',
    'LANDLORD_TERMINATED', 'RENEWED', 'RELOCATED', 'ASSIGNED', 'TENANT_BOUGHT',
  ])('accepts %s', async (terminationReason) => {
    expect(await errorsOn(EndTenancyDto, { ...VALID_END, terminationReason })).toEqual([]);
  });

  it('rejects a deposit disposition outside the enum', async () => {
    // A mistyped disposition must not fall through to DECIDE_LATER silently — that
    // would read as "nobody has decided" when someone did.
    expect(await errorsOn(EndTenancyDto, { ...VALID_END, depositDisposition: 'KEEP_IT' }))
      .toContain('depositDisposition');
  });

  it.each(['REFUND', 'FORFEIT', 'TRANSFER', 'DECIDE_LATER'])(
    'accepts the %s disposition',
    async (depositDisposition) => {
      expect(await errorsOn(EndTenancyDto, { ...VALID_END, depositDisposition })).toEqual([]);
    },
  );

  it('leaves the disposition optional so an omission still means "nobody has decided"', async () => {
    expect(await errorsOn(EndTenancyDto, VALID_END)).toEqual([]);
  });

  it('the production pipe rejects an undeclared field rather than dropping it', async () => {
    // whitelist alone would strip it silently; forbidNonWhitelisted is what tells the
    // caller their field did nothing.
    const messages = await pipeRejection(EndTenancyDto, { ...VALID_END, unitId: 'sneaky' });
    expect(messages.join(' ')).toMatch(/unitId should not exist/);
  });

  it('caps the free-text fields', async () => {
    expect(await errorsOn(EndTenancyDto, { ...VALID_END, terminationNote: 'x'.repeat(1001) }))
      .toContain('terminationNote');
    expect(await errorsOn(EndTenancyDto, { ...VALID_END, depositNote: 'x'.repeat(501) }))
      .toContain('depositNote');
  });
});

const VALID_ASSIGN = {
  effectiveDate: '2026-06-01',
  toTenantName: 'Sharma Retail LLC',
};

describe('AssignTenantDto', () => {
  it('accepts the minimum a real assignment needs', async () => {
    expect(await errorsOn(AssignTenantDto, VALID_ASSIGN)).toEqual([]);
  });

  it('requires the incoming tenant name', async () => {
    expect(await errorsOn(AssignTenantDto, { effectiveDate: '2026-06-01' }))
      .toContain('toTenantName');
  });

  it('rejects a blank incoming tenant name', async () => {
    expect(await errorsOn(AssignTenantDto, { ...VALID_ASSIGN, toTenantName: '' }))
      .toContain('toTenantName');
  });

  it('requires an effective date', async () => {
    expect(await errorsOn(AssignTenantDto, { toTenantName: 'X LLC' }))
      .toContain('effectiveDate');
  });

  it('rejects a malformed email rather than storing an unreachable contact', async () => {
    expect(await errorsOn(AssignTenantDto, { ...VALID_ASSIGN, toTenantEmail: 'not-an-email' }))
      .toContain('toTenantEmail');
  });

  it('rejects a reason outside the enum', async () => {
    expect(await errorsOn(AssignTenantDto, { ...VALID_ASSIGN, reason: 'VIBES' }))
      .toContain('reason');
  });

  it('REJECTS rent, term or date fields — an assignment that changed those would be a new lease', async () => {
    // The absence of these fields from the DTO is the design, and forbidNonWhitelisted
    // is what turns that absence into enforcement. If they ever became acceptable, the
    // two operations have blurred and the ledger's continuity guarantee is gone.
    const messages = await pipeRejection(AssignTenantDto, {
      ...VALID_ASSIGN, monthlyRent: 9999, leaseEnd: '2030-01-01', termMonths: 60,
    });
    const joined = messages.join(' ');
    expect(joined).toMatch(/monthlyRent should not exist/);
    expect(joined).toMatch(/leaseEnd should not exist/);
    expect(joined).toMatch(/termMonths should not exist/);
  });

  it('lets a clean assignment through the production pipe untouched', async () => {
    await expect(throughPipe(AssignTenantDto, VALID_ASSIGN)).resolves.toMatchObject({
      toTenantName: 'Sharma Retail LLC',
    });
  });
});
