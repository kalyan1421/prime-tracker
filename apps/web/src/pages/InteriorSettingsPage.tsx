/**
 * Interiors settings: BuilderTrend's cost codes, and who may lock, unlock and approve.
 *
 * The approval rules are the client's "option that can be set by super admin" (2026-10-17):
 * Founder and PM hold every power by default, the change-order limit starts at $60,000,
 * and only Super Admin (system:config) may change any of it. Cost codes are edited by
 * anyone who can edit fit-outs.
 */
import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Button, Switch, addToast } from '@heroui/react';
import { FiArrowLeft, FiPlus, FiSave } from 'react-icons/fi';
import {
  useInteriorCostCodes, useInteriorCostingSettings, useSaveInteriorCostCode, useUpdateInteriorCostingSettings,
} from '../hooks/useApi';
import { errMsg } from '../utils/fmt';
import { LoadingState } from '../components/ui';
import { useAuthStore } from '../store/authStore';
import { groupCodes, money, Note, SectionCard, TD, TH, type CostCode } from '../components/InteriorCostingParts';

/** Roles that can reach the fit-out money routes at all (interior:edit or interior:finance). */
const ROLES = [
  { key: 'FOUNDER', label: 'Founder' },
  { key: 'PROJECT_MANAGER', label: 'Project Manager' },
  { key: 'FINANCE', label: 'Finance' },
  { key: 'ACCOUNTING', label: 'Accounting' },
  { key: 'AR_AP', label: 'AR/AP' },
];

const RULES: { key: string; label: string; hint: string }[] = [
  { key: 'lockRoles', label: 'Approve & lock the estimate', hint: 'Locking turns the estimate into the original budget.' },
  { key: 'unlockRoles', label: 'Unlock a locked estimate', hint: 'Always asks for a reason, kept in the activity log.' },
  { key: 'coApproverRoles', label: 'Approve change orders up to the limit', hint: '' },
  { key: 'coAboveLimitRoles', label: 'Approve change orders above the limit', hint: '' },
  { key: 'poApproverRoles', label: 'Approve purchase orders', hint: 'An approved PO is committed cost.' },
  { key: 'varianceRoles', label: 'Approve a variance PO', hint: 'A PO that takes a cost code over its revised budget.' },
  { key: 'billApproverRoles', label: 'Approve bills', hint: 'Anyone with fit-out finance access can enter and pay bills.' },
];

export default function InteriorSettingsPage() {
  const { hasPermission } = useAuthStore();
  const canEditCodes = hasPermission('interior:edit');
  const { data: settings, isLoading } = useInteriorCostingSettings();
  const saveSettings = useUpdateInteriorCostingSettings();
  const [draft, setDraft] = useState<Record<string, any> | null>(null);

  useEffect(() => { if (settings && !draft) setDraft({ ...settings, coLimit: String(settings.coLimit) }); }, [settings, draft]);

  if (isLoading || !draft) return <LoadingState message="Loading interiors settings…" />;
  const canEditRules = !!settings?.canEdit;

  const toggle = (rule: string, role: string) => setDraft((d) => {
    const cur: string[] = d![rule] ?? [];
    return { ...d, [rule]: cur.includes(role) ? cur.filter((r) => r !== role) : [...cur, role] };
  });

  const save = async () => {
    const coLimit = Number(String(draft.coLimit).replace(/[$,\s]/g, ''));
    if (!Number.isFinite(coLimit) || coLimit < 0) { addToast({ title: 'The change order limit must be zero or more', color: 'warning' }); return; }
    try {
      const out = await saveSettings.mutateAsync({ ...Object.fromEntries(RULES.map((r) => [r.key, draft[r.key]])), coLimit });
      setDraft({ ...out, canEdit: true, coLimit: String(out.coLimit) });
      addToast({ title: 'Approval rules saved', color: 'success' });
    } catch (e) {
      addToast({ title: errMsg(e, 'Could not save the approval rules'), color: 'danger' });
    }
  };

  return (
    <div className="space-y-4">
      <Link to="/interior" className="inline-flex items-center gap-1 text-sm text-blue-600 hover:underline">
        <FiArrowLeft /> Interior Portfolio
      </Link>
      <h1 className="text-2xl font-bold">Interiors — cost codes & approvals</h1>

      <SectionCard
        title="Approval rules"
        hint={canEditRules ? 'Super Admin can change these.' : 'Only Super Admin can change these.'}
        right={canEditRules && (
          <Button size="sm" color="primary" startContent={<FiSave className="h-3.5 w-3.5" />} isLoading={saveSettings.isPending} onPress={save}>Save rules</Button>
        )}
      >
        <div className="space-y-3 p-4">
          <div className="flex flex-wrap items-center gap-3">
            <label htmlFor="co-limit" className="text-sm font-medium text-gray-900">Change order approval limit</label>
            <input
              id="co-limit" inputMode="decimal" disabled={!canEditRules} value={draft.coLimit}
              onChange={(e) => setDraft((d) => ({ ...d, coLimit: e.target.value }))}
              className="h-9 w-40 rounded-lg border border-gray-200 px-2.5 text-sm tabular-nums outline-none focus:border-blue-500 disabled:bg-gray-50"
            />
            <span className="text-xs text-gray-500">Currently {money(Number(settings.coLimit))}. A change order above this needs the "above the limit" roles.</span>
          </div>
          <div className="overflow-x-auto rounded-lg border border-gray-200">
            <table className="w-full min-w-[760px] border-collapse">
              <thead className="bg-gray-50">
                <tr>
                  <th className={`${TH} text-left`}>Who may…</th>
                  {ROLES.map((r) => <th key={r.key} className={`${TH} text-center`}>{r.label}</th>)}
                </tr>
              </thead>
              <tbody>
                {RULES.map((rule) => (
                  <tr key={rule.key} className="border-t border-gray-100">
                    <td className={TD}>
                      <div className="font-medium text-gray-900">{rule.label}</div>
                      {rule.hint && <div className="text-[11px] text-gray-500">{rule.hint}</div>}
                    </td>
                    {ROLES.map((role) => {
                      const on = (draft[rule.key] ?? []).includes(role.key);
                      return (
                        <td key={role.key} className={`${TD} text-center`}>
                          <input
                            type="checkbox" checked={on} disabled={!canEditRules}
                            aria-label={`${role.label} may ${rule.label.toLowerCase()}`}
                            onChange={() => toggle(rule.key, role.key)} className="h-4 w-4"
                          />
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <Note>Super Admin can always do all of these. Roles not listed have no access to fit-out money.</Note>
        </div>
      </SectionCard>

      <CostCodesCard canEdit={canEditCodes} />
    </div>
  );
}

const CELL = 'h-8 w-full rounded border border-gray-200 bg-white px-2 text-xs text-gray-900 outline-none focus:border-blue-500 disabled:border-transparent disabled:bg-transparent';

function CostCodesCard({ canEdit }: { canEdit: boolean }) {
  const { data } = useInteriorCostCodes(true);
  const codes: CostCode[] = Array.isArray(data) ? data : [];
  const save = useSaveInteriorCostCode();
  const [nw, setNw] = useState({ code: '', name: '', groupCode: '', groupName: '' });

  const patch = async (id: string, body: Record<string, any>) => {
    try { await save.mutateAsync({ id, data: body }); }
    catch (e) { addToast({ title: errMsg(e, 'Could not save the cost code'), color: 'danger' }); }
  };

  const add = async () => {
    if (!nw.name.trim() || !nw.groupName.trim()) { addToast({ title: 'A cost code needs a name and a group', color: 'warning' }); return; }
    try {
      await save.mutateAsync({ data: { code: nw.code.trim() || null, name: nw.name.trim(), groupCode: nw.groupCode.trim() || null, groupName: nw.groupName.trim() } });
      setNw({ code: '', name: '', groupCode: nw.groupCode, groupName: nw.groupName });
      addToast({ title: 'Cost code added', color: 'success' });
    } catch (e) {
      addToast({ title: errMsg(e, 'Could not add the cost code'), color: 'danger' });
    }
  };

  return (
    <SectionCard title="Cost codes" hint="As they appear in BuilderTrend. A switched-off code stays on old lines but is not offered for new ones.">
      <div className="overflow-x-auto">
        <table className="w-full min-w-[760px] border-collapse">
          <thead className="bg-gray-50">
            <tr>
              <th className={`${TH} text-left w-[110px]`}>Code</th>
              <th className={`${TH} text-left`}>Name</th>
              <th className={`${TH} text-left w-[90px]`}>Group #</th>
              <th className={`${TH} text-left`}>Group</th>
              <th className={`${TH} text-center w-[90px]`}>In use</th>
            </tr>
          </thead>
          <tbody>
            {groupCodes(codes).map((g) => g.codes.map((c) => (
              <CodeRow key={c.id} code={c} canEdit={canEdit} onPatch={(b) => patch(c.id, b)} />
            )))}
            {canEdit && (
              <tr className="border-t border-dashed border-gray-200 bg-blue-50/40">
                <td className="px-2 py-1.5"><input aria-label="New code" placeholder="e.g. 09.10" value={nw.code} onChange={(e) => setNw((s) => ({ ...s, code: e.target.value }))} className={CELL} /></td>
                <td className="px-2 py-1.5"><input aria-label="New code name" placeholder="Name" value={nw.name} onChange={(e) => setNw((s) => ({ ...s, name: e.target.value }))} onKeyDown={(e) => e.key === 'Enter' && add()} className={CELL} /></td>
                <td className="px-2 py-1.5"><input aria-label="New code group number" placeholder="09" value={nw.groupCode} onChange={(e) => setNw((s) => ({ ...s, groupCode: e.target.value }))} className={CELL} /></td>
                <td className="px-2 py-1.5"><input aria-label="New code group" list="cost-code-groups" placeholder="Group" value={nw.groupName} onChange={(e) => setNw((s) => ({ ...s, groupName: e.target.value }))} onKeyDown={(e) => e.key === 'Enter' && add()} className={CELL} /></td>
                <td className="px-2 py-1.5 text-center">
                  <Button size="sm" color="primary" isIconOnly aria-label="Add cost code" isLoading={save.isPending} onPress={add}><FiPlus className="h-3.5 w-3.5" /></Button>
                </td>
              </tr>
            )}
          </tbody>
        </table>
        <datalist id="cost-code-groups">{[...new Set(codes.map((c) => c.groupName))].map((g) => <option key={g} value={g} />)}</datalist>
      </div>
    </SectionCard>
  );
}

function CodeRow({ code, canEdit, onPatch }: { code: CostCode; canEdit: boolean; onPatch: (b: Record<string, any>) => void }) {
  const init = () => ({ code: code.code ?? '', name: code.name, groupCode: code.groupCode ?? '', groupName: code.groupName });
  const [d, setD] = useState(init);
  useEffect(() => { setD(init()); }, [code.code, code.name, code.groupCode, code.groupName]); // eslint-disable-line react-hooks/exhaustive-deps

  const commit = (k: keyof ReturnType<typeof init>) => {
    const v = d[k].trim();
    if (v === (init()[k] ?? '').trim()) return;
    if ((k === 'name' || k === 'groupName') && !v) { setD(init()); return; }
    onPatch({ [k]: v || null });
  };
  const cell = (k: keyof ReturnType<typeof init>, label: string) => (
    <input
      aria-label={`${label} for ${code.name}`} disabled={!canEdit} value={d[k]}
      onChange={(e) => setD((s) => ({ ...s, [k]: e.target.value }))} onBlur={() => commit(k)}
      onKeyDown={(e) => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); }}
      className={`${CELL} ${code.active ? '' : 'text-gray-500'}`}
    />
  );
  return (
    <tr className="border-t border-gray-100">
      <td className="px-2 py-1">{cell('code', 'Code')}</td>
      <td className="px-2 py-1">{cell('name', 'Name')}</td>
      <td className="px-2 py-1">{cell('groupCode', 'Group number')}</td>
      <td className="px-2 py-1">{cell('groupName', 'Group')}</td>
      <td className="px-2 py-1 text-center">
        <Switch size="sm" isSelected={code.active} isDisabled={!canEdit} aria-label={`${code.name} in use`} onValueChange={(v) => onPatch({ active: v })} />
      </td>
    </tr>
  );
}
