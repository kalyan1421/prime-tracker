/**
 * ForecastProbabilitiesPanel — tune the sale-stage probabilities that drive the
 * weighted pipeline forecast.
 *
 * These numbers feed the figure Prime quotes to lenders ("expected pipeline revenue
 * $X.YM"), so this is deliberately a Founder/Super-Admin screen (`org:manage`) rather than
 * something anyone with sales access can move.
 *
 * Only three stages are editable, and that is not an oversight. `SalesForecastService`
 * filters CLOSED and CANCELLED out of the pipeline BEFORE weighting anything, so a
 * probability stored against either has no effect on the forecast at all. Rendering them
 * as inputs would be offering two controls that do nothing. The server rejects them too.
 */

import { useEffect, useMemo, useState } from 'react';
import {
  Card, CardBody, CardHeader, Button, Input, Chip, addToast,
} from '@heroui/react';
import { FiTrendingUp, FiRotateCcw } from 'react-icons/fi';
import { useOrgSettings, useUpdateOrgSettings } from '../hooks/useApi';
import { errMsg } from '../utils/fmt';

/**
 * The editable stages, in pipeline order.
 *
 * ⚠️ MIRRORS `WRITABLE_SALE_STAGE_PROBABILITIES` in `packages/shared` — the source of
 * truth, which the API validates against. Duplicated rather than imported for the same
 * reason as the project-role list: `apps/web` has no dependency on `@prime-tracker/shared`
 * and the `deploy-web` CI job builds the web app WITHOUT building that package first, so
 * an import here would break the production deploy. Keep the two in step.
 *
 * The order matters — the server enforces that probabilities never DECREASE along it.
 */
const STAGES = [
  { key: 'PROSPECT', label: 'Prospect', hint: 'First contact — a deal exists, little else' },
  { key: 'LOI_SIGNED', label: 'LOI signed', hint: 'Letter of intent executed' },
  { key: 'UNDER_CONTRACT', label: 'Under contract', hint: 'Contract signed, working to close' },
] as const;

/** Stored as 0..1; shown as a percentage, which is how people actually talk about it. */
const toPct = (v: unknown) => {
  const n = Number(v);
  return Number.isFinite(n) ? String(Math.round(n * 1000) / 10) : '';
};

export function ForecastProbabilitiesPanel({ orgId }: { orgId?: string }) {
  const { data, isLoading } = useOrgSettings(orgId);
  const save = useUpdateOrgSettings();

  const stored = (data as any)?.saleStageProbabilities;
  const [form, setForm] = useState<Record<string, string>>({});

  // Seed from the server once it arrives, and re-seed whenever it changes underneath —
  // otherwise a save elsewhere leaves this form showing stale figures.
  useEffect(() => {
    if (!stored) return;
    setForm(Object.fromEntries(STAGES.map((s) => [s.key, toPct(stored[s.key])])));
  }, [stored]);

  const parsed = useMemo(
    () => STAGES.map((s) => ({ ...s, pct: parseFloat(form[s.key] ?? '') })),
    [form],
  );

  // Mirror the server's two rules so the problem is visible while typing rather than
  // arriving as a 400. The server remains the authority.
  const rangeError = parsed.find((p) => !Number.isFinite(p.pct) || p.pct < 0 || p.pct > 100);
  const orderError = !rangeError
    ? parsed.slice(1).find((p, i) => p.pct < parsed[i].pct)
    : undefined;
  const orderPrev = orderError ? parsed[parsed.findIndex((p) => p.key === orderError.key) - 1] : null;

  const dirty = stored
    ? STAGES.some((s) => (form[s.key] ?? '') !== toPct(stored[s.key]))
    : false;

  const submit = async () => {
    if (!orgId) return;
    try {
      await save.mutateAsync({
        orgId,
        // Back to 0..1 for the wire. Rounded to 4dp so 33.3% does not arrive as a
        // repeating decimal the server then reflects back slightly differently.
        data: {
          saleStageProbabilities: Object.fromEntries(
            parsed.map((p) => [p.key, Math.round((p.pct / 100) * 10000) / 10000]),
          ),
        },
      });
      addToast({ title: 'Forecast probabilities updated', color: 'success' });
    } catch (e) {
      addToast({ title: errMsg(e, 'Could not save probabilities'), color: 'danger' });
    }
  };

  const reset = () => {
    if (!stored) return;
    setForm(Object.fromEntries(STAGES.map((s) => [s.key, toPct(stored[s.key])])));
  };

  return (
    <Card shadow="sm">
      <CardHeader className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <FiTrendingUp className="text-blue-600 shrink-0" />
          <div>
            <p className="text-sm font-semibold text-gray-800">Sales forecast probabilities</p>
            <p className="text-xs text-gray-500">
              How likely a deal is to close at each stage. Drives the weighted pipeline forecast.
            </p>
          </div>
        </div>
        {(data as any)?.usingDefaults && (
          <Chip size="sm" variant="flat" color="default">Using defaults</Chip>
        )}
      </CardHeader>
      <CardBody className="space-y-3">
        {isLoading ? (
          <p className="text-xs text-gray-500">Loading…</p>
        ) : !orgId ? (
          <p className="text-xs text-gray-500">No organization available.</p>
        ) : (
          <>
            {STAGES.map((s) => (
              <div key={s.key} className="flex items-center gap-3">
                <div className="flex-1 min-w-0">
                  <p className="text-sm text-gray-700">{s.label}</p>
                  <p className="text-[11px] text-gray-500 truncate">{s.hint}</p>
                </div>
                <Input
                  size="sm"
                  type="number"
                  className="w-28"
                  aria-label={`${s.label} probability, percent`}
                  endContent={<span className="text-xs text-gray-600">%</span>}
                  value={form[s.key] ?? ''}
                  onChange={(e) => setForm((p) => ({ ...p, [s.key]: e.target.value }))}
                />
              </div>
            ))}

            {/* Why the other two stages are not here. Without this the omission reads as a
                bug rather than a deliberate constraint. */}
            <p className="text-[11px] text-gray-500 border-t border-gray-100 pt-2">
              Closed and Cancelled deals are excluded from the pipeline before it is weighted,
              so they have no probability to tune.
            </p>

            {rangeError && (
              <p className="text-xs text-amber-700">
                {rangeError.label} must be a percentage between 0 and 100.
              </p>
            )}
            {orderError && orderPrev && (
              <p className="text-xs text-amber-700">
                {orderError.label} ({orderError.pct}%) is lower than {orderPrev.label} ({orderPrev.pct}%).
                A deal should not become less likely as it advances.
              </p>
            )}

            <div className="flex justify-end gap-2 pt-1">
              <Button
                size="sm" variant="light" startContent={<FiRotateCcw size={13} />}
                onPress={reset} isDisabled={!dirty || save.isPending}
              >
                Revert
              </Button>
              <Button
                size="sm" color="primary"
                onPress={submit}
                isLoading={save.isPending}
                isDisabled={!dirty || !!rangeError || !!orderError}
              >
                Save
              </Button>
            </div>
          </>
        )}
      </CardBody>
    </Card>
  );
}
