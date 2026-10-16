/**
 * Move the monday "Site Tracker" board onto this one (client, 2026-10-16).
 *
 * Preview first, always: the upload is read and every board row is shown with what it will
 * become — which units, how many checklist steps, blocker, priority, owners — and why a row
 * will be left out. Nothing is written until "Import". Properties the file names in a way
 * that does not match a project are chosen here, and the preview re-runs with the choice.
 *
 * Founder / Super Admin only (siteTracker:manage): it writes across every property at once.
 */
import { useMemo, useState } from 'react';
import {
  Button, Chip, Select, SelectItem, Modal, ModalContent, ModalHeader, ModalBody, ModalFooter, addToast,
} from '@heroui/react';
import { FiUploadCloud } from 'react-icons/fi';
import { useSiteTrackerImport, type SiteTrackerImportResult } from '../hooks/useApi';
import { errMsg } from '../utils/fmt';

const STATUS_CHIP: Record<string, { label: string; color: 'success' | 'primary' | 'default' | 'warning' | 'danger' }> = {
  ready: { label: 'Will import', color: 'primary' },
  imported: { label: 'Imported', color: 'success' },
  skipped: { label: 'Already tracked', color: 'default' },
  unmatched: { label: 'Not matched', color: 'warning' },
  error: { label: 'Problem', color: 'danger' },
};

export function MondayImportModal({ projects, onClose }: {
  projects: { id: string; name: string }[];
  onClose: () => void;
}) {
  const run = useSiteTrackerImport();
  const [file, setFile] = useState<File | null>(null);
  const [projectMap, setProjectMap] = useState<Record<string, string>>({});
  const [result, setResult] = useState<SiteTrackerImportResult | null>(null);
  const [err, setErr] = useState<string | null>(null);

  const go = async (apply: boolean, map = projectMap) => {
    if (!file) return;
    setErr(null);
    try {
      const res = await run.mutateAsync({ file, apply, projectMap: map });
      setResult(res);
      if (apply) {
        addToast({
          title: `${res.totals.imported} row${res.totals.imported === 1 ? '' : 's'} imported from monday`,
          color: res.totals.imported ? 'success' : 'warning',
        });
      }
    } catch (e) {
      setErr(errMsg(e, 'Could not read that file'));
    }
  };

  const chooseProject = (group: string, projectId: string) => {
    const next = { ...projectMap, [group]: projectId };
    setProjectMap(next);
    void go(false, next);
  };

  const groups = useMemo(() => {
    if (!result) return [];
    return result.groups.map((g) => ({ ...g, rows: result.rows.filter((r) => r.group === g.name) }));
  }, [result]);

  const ready = result?.totals.ready ?? 0;
  const applied = !!result?.applied;

  return (
    <Modal isOpen onOpenChange={onClose} size="5xl" scrollBehavior="inside">
      <ModalContent>
        <ModalHeader className="flex flex-col gap-0.5">
          <span className="text-sm font-semibold">Import from monday</span>
          <span className="text-[11px] font-normal text-gray-500">
            In monday, open the Site Tracker board, choose ⋯ → Export board to Excel, and upload that file here.
          </span>
        </ModalHeader>
        <ModalBody className="gap-3 pb-4">
          {err && <div className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">{err}</div>}

          <label className="flex cursor-pointer flex-wrap items-center gap-3 rounded-lg border border-dashed border-gray-300 px-3 py-3 hover:bg-gray-50">
            <FiUploadCloud className="text-gray-500" size={18} />
            <span className="text-sm text-gray-700">{file ? file.name : 'Choose the .xlsx export'}</span>
            <input
              id="monday-import-file"
              type="file" accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
              className="sr-only"
              onChange={(e) => { setFile(e.target.files?.[0] ?? null); setResult(null); setProjectMap({}); }}
            />
            {file && !result && (
              <Button size="sm" color="primary" className="ml-auto" isLoading={run.isPending} onPress={() => go(false)}>
                Preview
              </Button>
            )}
          </label>

          {result && (
            <>
              <div className="flex flex-wrap items-center gap-2 text-xs text-gray-700">
                {applied
                  ? <span className="font-medium">Done — {result.totals.imported} imported.</span>
                  : <span className="font-medium">Preview — nothing has been written yet.</span>}
                {(['ready', 'imported', 'skipped', 'unmatched', 'error'] as const)
                  .filter((k) => result.totals[k] > 0)
                  .map((k) => (
                    <Chip key={k} size="sm" variant="flat" color={STATUS_CHIP[k].color} className="text-[11px]">
                      {result.totals[k]} {STATUS_CHIP[k].label.toLowerCase()}
                    </Chip>
                  ))}
              </div>
              {result.warnings.map((w) => (
                <p key={w} className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">{w}</p>
              ))}

              {groups.map((g) => (
                <section key={g.name} className="rounded-lg border border-gray-200">
                  <header className="flex flex-wrap items-center gap-2 border-b border-gray-100 bg-gray-50 px-3 py-2">
                    <span className="text-xs font-semibold text-gray-900">{g.name || '(no heading)'}</span>
                    <span className="text-[11px] text-gray-500">→</span>
                    <Select
                      size="sm" aria-label={`Property for ${g.name}`} className="max-w-[240px]"
                      placeholder="Choose the property" isDisabled={applied || run.isPending}
                      selectedKeys={g.projectId ? [g.projectId] : []}
                      onChange={(e) => e.target.value && chooseProject(g.name, e.target.value)}
                    >
                      {projects.map((p) => <SelectItem key={p.id} textValue={p.name}>{p.name}</SelectItem>)}
                    </Select>
                  </header>
                  <div className="overflow-x-auto">
                    <table className="w-full min-w-[760px] text-xs">
                      <thead>
                        <tr className="text-left text-[11px] uppercase tracking-wide text-gray-500">
                          <th className="px-3 py-1.5 font-semibold">monday row</th>
                          <th className="px-3 py-1.5 font-semibold">Becomes</th>
                          <th className="px-3 py-1.5 font-semibold">Checklist</th>
                          <th className="px-3 py-1.5 font-semibold">Blocker · priority</th>
                          <th className="px-3 py-1.5 font-semibold">Owners</th>
                          <th className="px-3 py-1.5 font-semibold">Status</th>
                        </tr>
                      </thead>
                      <tbody>
                        {g.rows.map((r) => (
                          <tr key={`${r.row}-${r.label}`} className="border-t border-gray-100 align-top">
                            <td className="px-3 py-2">
                              <div className="font-medium text-gray-900">{r.label}</div>
                              <div className="text-[11px] text-gray-500">row {r.row}</div>
                            </td>
                            <td className="px-3 py-2 text-gray-700">
                              {r.units.length
                                ? <>{r.units.length > 1 ? 'Units' : 'Unit'} {r.units.map((u) => u.unitNumber).join(', ')}
                                    {r.building && <div className="text-[11px] text-gray-500">{r.building}</div>}</>
                                : <span className="text-gray-500">—</span>}
                            </td>
                            <td className="px-3 py-2 tabular-nums text-gray-700">{r.stages ? `${r.stages} steps` : '—'}</td>
                            <td className="px-3 py-2 text-gray-700">
                              {[r.blocker === 'YES' ? 'Blocked' : r.blocker === 'NO' ? 'Not blocked' : null, r.priority?.toLowerCase()]
                                .filter(Boolean).join(' · ') || '—'}
                            </td>
                            <td className="px-3 py-2 text-gray-700">{r.owners.join(', ') || '—'}</td>
                            <td className="px-3 py-2">
                              <Chip size="sm" variant="flat" color={STATUS_CHIP[r.status].color} className="text-[11px]">
                                {STATUS_CHIP[r.status].label}
                              </Chip>
                              {r.messages.map((m) => (
                                <p key={m} className="mt-1 max-w-[260px] text-[11px] text-gray-600">{m}</p>
                              ))}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </section>
              ))}
            </>
          )}
        </ModalBody>
        <ModalFooter>
          <Button size="sm" variant="light" onPress={onClose} isDisabled={run.isPending}>
            {applied ? 'Close' : 'Cancel'}
          </Button>
          {result && !applied && (
            <Button
              size="sm" color="primary" isDisabled={ready === 0} isLoading={run.isPending}
              onPress={() => go(true)}
            >
              Import {ready} row{ready === 1 ? '' : 's'}
            </Button>
          )}
        </ModalFooter>
      </ModalContent>
    </Modal>
  );
}
