import { ValidationPipe } from '@nestjs/common';
import { UpdateOrgSettingsDto } from './update-org-settings.dto';

/**
 * PATCH /organizations/:id/settings carries a free-form `Record<string, number>`, which is
 * awkward under `whitelist: true, forbidNonWhitelisted: true` — those settings strip or
 * reject undeclared *properties of a validated class*, and it is not obvious without
 * checking whether that reaches into a plain-object property value.
 *
 * These run the pipe exactly as main.ts configures it, so the answer is measured rather than
 * assumed: the map's own keys must survive untouched (otherwise the service would receive an
 * empty object and reject every legitimate write), while an undeclared top-level field must
 * still 400.
 */
const productionPipe = new ValidationPipe({
  whitelist: true,
  forbidNonWhitelisted: true,
  transform: true,
  transformOptions: { enableImplicitConversion: true },
});

const throughPipe = (payload: Record<string, unknown>) =>
  productionPipe.transform(payload, { type: 'body', metatype: UpdateOrgSettingsDto });

/**
 * The pipe's top-level `.message` is just "Bad Request Exception"; the field detail lives on
 * `.response.message`. Asserting the outer one would pass for any 400 at all.
 */
const pipeRejection = async (payload: Record<string, unknown>): Promise<string[]> => {
  try {
    await throughPipe(payload);
  } catch (err: any) {
    const detail = err?.response?.message;
    if (!detail) throw err;
    return Array.isArray(detail) ? detail : [detail];
  }
  throw new Error('expected the pipe to reject, but it accepted the payload');
};

describe('UpdateOrgSettingsDto through the production ValidationPipe', () => {
  it('lets a real payload through with the probability map intact', async () => {
    const result: any = await throughPipe({
      saleStageProbabilities: { PROSPECT: 0.15, LOI_SIGNED: 0.4, UNDER_CONTRACT: 0.8 },
    });

    // The whole risk this test exists for: whitelist must not eat the map's contents.
    expect(result.saleStageProbabilities).toEqual({
      PROSPECT: 0.15,
      LOI_SIGNED: 0.4,
      UNDER_CONTRACT: 0.8,
    });
  });

  it('lets a single-stage partial through', async () => {
    const result: any = await throughPipe({ saleStageProbabilities: { PROSPECT: 0.2 } });
    expect(result.saleStageProbabilities).toEqual({ PROSPECT: 0.2 });
  });

  it('does not coerce a string value into a number', async () => {
    // enableImplicitConversion works off reflected property types; the map's values have no
    // reflected type, so "0.5" must arrive at the service still a string for it to reject.
    const result: any = await throughPipe({ saleStageProbabilities: { PROSPECT: '0.5' } });
    expect(result.saleStageProbabilities.PROSPECT).toBe('0.5');
  });

  it('accepts an empty body at the pipe (the service is what rejects a no-op write)', async () => {
    const result: any = await throughPipe({});
    expect(result.saleStageProbabilities).toBeUndefined();
  });

  it('rejects an undeclared top-level field', async () => {
    const errors = await pipeRejection({
      saleStageProbabilities: { PROSPECT: 0.2 },
      unitStaleDaysThreshold: 60, // not declared yet — must 400 rather than be ignored
    });
    expect(errors.join(' ')).toContain('unitStaleDaysThreshold');
  });

  it.each([
    ['an array', [0.1, 0.2]],
    ['a scalar', 0.5],
    ['a string', 'PROSPECT=0.2'],
    ['null', null],
  ])('rejects saleStageProbabilities when it is %s', async (_label, value) => {
    const errors = await pipeRejection({ saleStageProbabilities: value });
    expect(errors.join(' ')).toContain('saleStageProbabilities');
  });
});
