import { useRef, useState } from 'react';
import { useParams, useNavigate, Link } from 'react-router-dom';
import { Card, CardBody, CardHeader, Button, Chip, Select, SelectItem, Input, addToast } from '@heroui/react';
import { FiArrowLeft, FiDownload, FiUpload, FiCheckCircle, FiAlertTriangle } from 'react-icons/fi';
import {
  useDownloadImportTemplate, usePreviewLeaseImport, useCommitLeaseImport,
  useAnalyzeGenericLeaseImport, usePreviewMappedLeaseImport,
  useBuildings, useCustomOptions, useBrokers, useCreateBroker, useCreateUnit,
} from '../hooks/useApi';
import { errMsg, fmt, fmtDate } from '../utils/fmt';
import { LeaseImportColumnMapper, type ColumnSelection } from '../components/LeaseImportColumnMapper';

/** A unit number like "700 and 701" or "1001 & 1002" names TWO physical units combined
 * in the sheet's text — not one real unit. Auto-creating a unit literally called that
 * would put nonsense inventory in the system, so these are flagged instead of offered
 * as a normal create. Heuristic, not exhaustive — matches the patterns actually seen in
 * client sheets (R8's discovery data). */
function looksLikeCombinedUnitRef(unitNumber: string): boolean {
  return /\band\b/i.test(unitNumber) || /&/.test(unitNumber) || /,/.test(unitNumber);
}

/**
 * Bulk rent-history import (R1/R2/R8) — see
 * docs/client-discovery/HISTORICAL_DATA_SHEET_IMPORT_SPEC.md.
 *
 * Three steps, deliberately never collapsed into one: nothing is written until the user
 * has SEEN a row-by-row preview and explicitly confirmed it. That preview step is the
 * safeguard that made reopening "no CSV for backfill" (2026-08-12) safe for bulk loads —
 * removing it would just be CSV import with extra steps.
 */
export default function RentHistoryImportPage() {
  const { id: projectId } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const fileInputRef = useRef<HTMLInputElement>(null);

  const downloadTemplate = useDownloadImportTemplate();
  const previewImport = usePreviewLeaseImport();
  const commitImport = useCommitLeaseImport();
  const analyzeGeneric = useAnalyzeGenericLeaseImport();
  const previewMapped = usePreviewMappedLeaseImport();

  // Missing-unit auto-create (R9.2)
  const buildings = useBuildings(projectId || '');
  const unitTypes = useCustomOptions('unit_type');
  const createUnit = useCreateUnit();
  // Default broker for commission installments with no broker column (R9.2)
  const brokers = useBrokers();
  const createBroker = useCreateBroker();

  const [mode, setMode] = useState<'template' | 'generic'>('template');
  const [fileName, setFileName] = useState<string | null>(null);
  const [preview, setPreview] = useState<any | null>(null);
  const [result, setResult] = useState<any | null>(null);
  const [templateFile, setTemplateFile] = useState<File | null>(null);

  // Generic column-mapping (R9) — the client's own spreadsheet, any layout.
  const [genericFile, setGenericFile] = useState<File | null>(null);
  const [analyzeResult, setAnalyzeResult] = useState<any | null>(null);
  const [colSelections, setColSelections] = useState<Record<number, ColumnSelection>>({});
  const [defaultBrokerId, setDefaultBrokerId] = useState('');
  const [newBrokerName, setNewBrokerName] = useState('');

  // Per-missing-unit-number choices for the "create units" step.
  const [missingUnitDefaults, setMissingUnitDefaults] = useState<Record<string, { buildingId: string; unitType: string; sqft: string }>>({});
  const [creatingUnits, setCreatingUnits] = useState(false);

  // Per-row broker fixes (R9.3) — different tenants often have different brokers, so this
  // fixes one row at a time instead of forcing one sheet-wide default. Keyed by rowNumber.
  // rowBrokerOverrides is what's actually SENT and persists across reruns (e.g. after
  // creating missing units); rowBrokerChoices is the not-yet-applied in-progress picks.
  const [rowBrokerOverrides, setRowBrokerOverrides] = useState<Record<number, string>>({});
  const [rowBrokerChoices, setRowBrokerChoices] = useState<Record<number, { brokerId: string; newName: string }>>({});
  const [applyingRowBrokers, setApplyingRowBrokers] = useState(false);

  const handleFilePicked = async (file: File) => {
    if (!projectId) return;
    setFileName(file.name);
    setResult(null);
    setTemplateFile(file);
    try {
      const data = await previewImport.mutateAsync({ file, projectId });
      setPreview(data);
    } catch (e) {
      addToast({ title: errMsg(e, 'Could not read this file'), color: 'danger' });
      setPreview(null);
    }
  };

  const handleGenericFilePicked = async (file: File) => {
    setFileName(file.name);
    setResult(null);
    setPreview(null);
    setGenericFile(file);
    try {
      const data = await analyzeGeneric.mutateAsync(file);
      setAnalyzeResult(data);
      const initial: Record<number, ColumnSelection> = {};
      for (const f of data.fields) {
        initial[f.index] = {
          field: f.splitSuggestion ? '' : (f.suggestedField ?? ''),
          splitEnabled: !!f.splitSuggestion,
        };
      }
      setColSelections(initial);
    } catch (e) {
      addToast({ title: errMsg(e, 'Could not read this file'), color: 'danger' });
      setAnalyzeResult(null);
    }
  };

  const handleConfirmMapping = async (overrideRowBrokers?: Record<number, string>) => {
    if (!projectId || !genericFile || !analyzeResult) return;
    const columns: { columnIndex: number; field: string; splitPart?: 'psf' | 'total' }[] = [];
    for (const [idxStr, sel] of Object.entries(colSelections)) {
      const columnIndex = Number(idxStr);
      if (sel.splitEnabled) {
        // Each column's split target pair is its OWN (rent vs NNN vs TI all split
        // differently) — never hardcode rentPsf/monthlyRent here, or a second split
        // column silently overwrites the first one's value with its own.
        const parts = analyzeResult.fields.find((f: any) => f.index === columnIndex)?.splitSuggestion?.parts;
        if (!parts) continue;
        columns.push({ columnIndex, field: parts[0], splitPart: 'psf' });
        columns.push({ columnIndex, field: parts[1], splitPart: 'total' });
      } else if (sel.field) {
        columns.push({ columnIndex, field: sel.field });
      }
    }
    if (columns.length === 0) {
      addToast({ title: 'Map at least one column before continuing', color: 'warning' });
      return;
    }
    try {
      // A typed new broker name wins over picking an existing one — create it first so
      // there's a real id to pass as the sheet-wide commission fallback. Resolved into
      // defaultBrokerId and the text field cleared immediately after, so re-running this
      // (e.g. after creating missing units) reuses the broker instead of recreating it.
      let brokerId = defaultBrokerId || undefined;
      if (newBrokerName.trim()) {
        const created = await createBroker.mutateAsync({ name: newBrokerName.trim() });
        brokerId = created.id;
        setDefaultBrokerId(created.id);
        setNewBrokerName('');
      }
      const data = await previewMapped.mutateAsync({
        file: genericFile, projectId, mapping: { orientation: analyzeResult.orientation, columns }, defaultBrokerId: brokerId,
        rowBrokerOverrides: overrideRowBrokers ?? rowBrokerOverrides,
      });
      setPreview(data);
      // Persist so a LATER rerun (e.g. after creating missing units) keeps this fix.
      if (overrideRowBrokers) setRowBrokerOverrides(overrideRowBrokers);
    } catch (e) {
      addToast({ title: errMsg(e, 'Could not parse this file with the current mapping'), color: 'danger' });
    }
  };

  // A row's own broker fix — different tenants often have different brokers, so this is
  // per-row, not the sheet-wide default above. Creates any newly-typed broker names
  // (deduped within this one batch), merges into rowBrokerOverrides, and re-checks.
  const handleApplyRowBrokers = async () => {
    const entries = Object.entries(rowBrokerChoices).filter(([, c]) => c.brokerId || c.newName.trim());
    if (entries.length === 0) {
      addToast({ title: 'Pick or type a broker for at least one row first', color: 'warning' });
      return;
    }
    setApplyingRowBrokers(true);
    const nextOverrides = { ...rowBrokerOverrides };
    const nameToId = new Map<string, string>();
    for (const [rowNumStr, choice] of entries) {
      const rowNum = Number(rowNumStr);
      try {
        if (choice.newName.trim()) {
          const key = choice.newName.trim().toLowerCase();
          let id = nameToId.get(key);
          if (!id) {
            const created = await createBroker.mutateAsync({ name: choice.newName.trim() });
            id = created.id as string;
            nameToId.set(key, id);
          }
          nextOverrides[rowNum] = id as string;
        } else if (choice.brokerId) {
          nextOverrides[rowNum] = choice.brokerId;
        }
      } catch (e) {
        addToast({ title: errMsg(e, `Could not set a broker for row ${rowNum}`), color: 'danger' });
      }
    }
    setRowBrokerChoices({});
    await handleConfirmMapping(nextOverrides);
    setApplyingRowBrokers(false);
  };

  // Re-runs whichever preview path is active, after missing units were just created —
  // so newly-resolvable rows immediately show as ready without a manual re-upload.
  const rerunPreview = async () => {
    if (mode === 'template' && templateFile) {
      await handleFilePicked(templateFile);
    } else if (mode === 'generic') {
      await handleConfirmMapping();
    }
  };

  // Distinct unit numbers the preview couldn't resolve — offered as "create these units".
  const missingUnitNumbers: string[] = preview
    ? Array.from(new Set(
        preview.tenancies
          .filter((t: any) => !t.data.unitId && t.errors.some((e: string) => e.includes('was not found in this project')))
          .map((t: any) => t.unitNumber)
          .filter(Boolean),
      ))
    : [];
  // "700 and 701" etc. name two units combined, not one real unit — never offered as a
  // plain create, only flagged (see looksLikeCombinedUnitRef).
  const creatableUnitNumbers = missingUnitNumbers.filter((n) => !looksLikeCombinedUnitRef(n));
  const combinedUnitNumbers = missingUnitNumbers.filter(looksLikeCombinedUnitRef);

  // Fills every creatable row with the same Building/Type at once — the common case is
  // one project, one or two buildings, so picking per-row 9 times is pure friction.
  const applyToAllUnits = (patch: { buildingId?: string; unitType?: string }) => {
    setMissingUnitDefaults((s) => {
      const next = { ...s };
      for (const num of creatableUnitNumbers) {
        const sheetSqft = preview.tenancies.find((t: any) => t.unitNumber === num)?.sqft;
        const fallback = { buildingId: '', unitType: '', sqft: sheetSqft ? String(sheetSqft) : '' };
        next[num] = { ...fallback, ...next[num], ...patch };
      }
      return next;
    });
  };

  const handleCreateMissingUnits = async () => {
    const toCreate = creatableUnitNumbers
      .map((num) => ({ num, choice: missingUnitDefaults[num] }))
      .filter((x) => x.choice?.buildingId && x.choice?.unitType);
    if (toCreate.length === 0) {
      addToast({ title: 'Pick a Building and Type for at least one unit first', color: 'warning' });
      return;
    }
    setCreatingUnits(true);
    // One unit failing (e.g. it already exists — someone re-ran this after a previous
    // attempt partly succeeded) must not block the rest of the batch, and must not skip
    // re-checking the file: whatever DID succeed (or already existed) should still show
    // as resolved once we re-preview.
    let created = 0;
    const failures: string[] = [];
    for (const { num, choice } of toCreate) {
      try {
        await createUnit.mutateAsync({
          buildingId: choice.buildingId,
          unitNumber: num,
          unitType: choice.unitType,
          sqft: choice.sqft ? Number(choice.sqft) : undefined,
        });
        created += 1;
        setMissingUnitDefaults((s) => { const next = { ...s }; delete next[num]; return next; });
      } catch (e) {
        failures.push(`Unit ${num}: ${errMsg(e, 'failed')}`);
      }
    }
    if (created > 0) {
      addToast({ title: `Created ${created} unit${created === 1 ? '' : 's'}`, color: 'success' });
    }
    if (failures.length > 0) {
      addToast({ title: `${failures.length} couldn't be created — re-checking the file anyway`, description: failures.join(' · '), color: 'danger' });
    }
    await rerunPreview();
    setCreatingUnits(false);
  };

  const handleCommit = async () => {
    if (!preview) return;
    const readyRows = preview.tenancies.filter((t: any) => t.status === 'ready').map((t: any) => t.data);
    if (readyRows.length === 0) return;
    try {
      const data = await commitImport.mutateAsync(readyRows);
      setResult(data);
      addToast({
        title: `Imported ${data.imported} tenanc${data.imported === 1 ? 'y' : 'ies'}${data.failed ? `, ${data.failed} failed` : ''}`,
        color: data.failed ? 'warning' : 'success',
      });
    } catch (e) {
      addToast({ title: errMsg(e, 'Import failed'), color: 'danger' });
    }
  };

  const startOver = () => {
    setPreview(null);
    setResult(null);
    setFileName(null);
    setTemplateFile(null);
    setGenericFile(null);
    setAnalyzeResult(null);
    setColSelections({});
    setDefaultBrokerId('');
    setNewBrokerName('');
    setMissingUnitDefaults({});
    setRowBrokerOverrides({});
    setRowBrokerChoices({});
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  return (
    <div className="p-6 space-y-4 max-w-6xl mx-auto">
      <div>
        <Link
          to={projectId ? `/projects/${projectId}/revenue` : '/projects'}
          className="text-sm text-gray-500 hover:text-gray-700 flex items-center gap-1 mb-2"
        >
          <FiArrowLeft className="w-3.5 h-3.5" /> Back to project
        </Link>
        <h1 className="text-xl font-bold text-gray-900">Import rent history</h1>
        <p className="text-sm text-gray-500 mt-1">
          Bulk-enter past tenancies from a spreadsheet. Nothing is written until you review
          the preview below and confirm it — this is a faster path to the same result the
          single-tenancy backfill form produces, not a shortcut around reviewing the data.
        </p>
      </div>

      <div className="flex gap-2">
        <Button
          size="sm"
          variant={mode === 'template' ? 'solid' : 'flat'}
          color={mode === 'template' ? 'primary' : 'default'}
          onPress={() => { setMode('template'); startOver(); }}
        >
          Use our template
        </Button>
        <Button
          size="sm"
          variant={mode === 'generic' ? 'solid' : 'flat'}
          color={mode === 'generic' ? 'primary' : 'default'}
          onPress={() => { setMode('generic'); startOver(); }}
        >
          Upload your own spreadsheet
        </Button>
      </div>

      {mode === 'template' ? (
        <>
          <Card>
            <CardHeader className="flex flex-col items-start gap-1">
              <p className="font-semibold text-sm">1. Download the template</p>
              <p className="text-xs text-gray-500">
                Three tabs: Tenancies, Ledger Exceptions (for months that weren't paid in full),
                and Commission Installments. Fill in Tenancies at minimum.
              </p>
            </CardHeader>
            <CardBody>
              <Button
                size="sm"
                variant="flat"
                startContent={<FiDownload />}
                isLoading={downloadTemplate.isPending}
                onPress={() => downloadTemplate.mutate()}
              >
                Download template (.xlsx)
              </Button>
            </CardBody>
          </Card>

          <Card>
            <CardHeader className="flex flex-col items-start gap-1">
              <p className="font-semibold text-sm">2. Upload your filled-in file</p>
              <p className="text-xs text-gray-500">Nothing is saved yet — this only parses and checks the file.</p>
            </CardHeader>
            <CardBody className="flex flex-row items-center gap-3">
              <input
                ref={fileInputRef}
                type="file"
                accept=".xlsx"
                className="hidden"
                onChange={(e) => {
                  const file = e.target.files?.[0];
                  if (file) handleFilePicked(file);
                }}
              />
              <Button
                size="sm"
                color="primary"
                variant="flat"
                startContent={<FiUpload />}
                isLoading={previewImport.isPending}
                onPress={() => fileInputRef.current?.click()}
              >
                {fileName ? 'Choose a different file' : 'Choose file'}
              </Button>
              {fileName && <span className="text-xs text-gray-500">{fileName}</span>}
            </CardBody>
          </Card>
        </>
      ) : (
        <>
          <Card>
            <CardHeader className="flex flex-col items-start gap-1">
              <p className="font-semibold text-sm">1. Upload the client's spreadsheet as-is</p>
              <p className="text-xs text-gray-500">
                Any column layout — we'll guess which column is which and let you correct it
                before anything is checked or saved.
              </p>
            </CardHeader>
            <CardBody className="flex flex-row items-center gap-3">
              <input
                ref={fileInputRef}
                type="file"
                accept=".xlsx"
                className="hidden"
                onChange={(e) => {
                  const file = e.target.files?.[0];
                  if (file) handleGenericFilePicked(file);
                }}
              />
              <Button
                size="sm"
                color="primary"
                variant="flat"
                startContent={<FiUpload />}
                isLoading={analyzeGeneric.isPending}
                onPress={() => fileInputRef.current?.click()}
              >
                {fileName ? 'Choose a different file' : 'Choose file'}
              </Button>
              {fileName && <span className="text-xs text-gray-500">{fileName}</span>}
            </CardBody>
          </Card>

          {analyzeResult && !preview && (
            <Card>
              <CardHeader className="flex flex-col items-start gap-1">
                <p className="font-semibold text-sm">2. Confirm what each column means</p>
                <p className="text-xs text-gray-500">
                  {analyzeResult.recordCount} record{analyzeResult.recordCount === 1 ? '' : 's'} detected.
                  Nothing is saved yet — this only affects how the file is read.
                </p>
              </CardHeader>
              <CardBody className="space-y-4">
                <LeaseImportColumnMapper
                  fields={analyzeResult.fields}
                  recordCount={analyzeResult.recordCount}
                  selections={colSelections}
                  onChange={(index, selection) => setColSelections((s) => ({ ...s, [index]: selection }))}
                />

                <div className="rounded-lg border border-gray-200 p-3 space-y-2">
                  <p className="text-xs font-semibold text-gray-700">Broker for commission installments (optional)</p>
                  <p className="text-xs text-gray-500">
                    Only needed if you mapped a commission-amount column but your file has no Broker Name
                    column — every commission installment needs a broker to attribute to.
                  </p>
                  <div className="flex flex-wrap gap-2 items-end">
                    <Select
                      size="sm"
                      label="Existing broker"
                      className="max-w-xs"
                      isDisabled={!!newBrokerName.trim()}
                      selectedKeys={defaultBrokerId ? [defaultBrokerId] : []}
                      onSelectionChange={(keys) => setDefaultBrokerId((Array.from(keys)[0] as string) || '')}
                    >
                      {[{ id: '', name: '— none —' }, ...((brokers.data as any[]) || [])].map((b: any) => (
                        <SelectItem key={b.id} textValue={b.name}>{b.name}</SelectItem>
                      ))}
                    </Select>
                    <span className="text-xs text-gray-400">or</span>
                    <Input
                      size="sm"
                      label="Type a new broker name"
                      className="max-w-xs"
                      isDisabled={!!defaultBrokerId}
                      value={newBrokerName}
                      onChange={(e) => setNewBrokerName(e.target.value)}
                    />
                  </div>
                </div>

                <div className="flex gap-2">
                  <Button size="sm" variant="flat" onPress={startOver}>Start over</Button>
                  <Button
                    size="sm" color="primary"
                    isLoading={previewMapped.isPending || createBroker.isPending}
                    onPress={() => handleConfirmMapping()}
                  >
                    Continue to preview
                  </Button>
                </div>
              </CardBody>
            </Card>
          )}
        </>
      )}

      {preview && (
        <Card>
          <CardHeader className="flex flex-col items-start gap-1">
            <p className="font-semibold text-sm">3. Review before importing</p>
            <div className="flex gap-2 mt-1">
              <Chip size="sm" color="success" variant="flat">{preview.summary.ready} ready</Chip>
              {preview.summary.errors > 0 && (
                <Chip size="sm" color="danger" variant="flat">{preview.summary.errors} with errors</Chip>
              )}
              {preview.orphaned.length > 0 && (
                <Chip size="sm" color="warning" variant="flat">{preview.orphaned.length} unmatched exception/commission row(s)</Chip>
              )}
            </div>
          </CardHeader>
          <CardBody className="space-y-4">
            <div className="overflow-x-auto -mx-2">
              <table className="w-full text-xs">
                <thead>
                  <tr className="text-left text-gray-500 border-b border-gray-100">
                    <th className="px-2 py-1.5 font-semibold">Row</th>
                    <th className="px-2 py-1.5 font-semibold">Unit</th>
                    <th className="px-2 py-1.5 font-semibold">Tenant</th>
                    <th className="px-2 py-1.5 font-semibold">Dates</th>
                    <th className="px-2 py-1.5 font-semibold">Rent</th>
                    <th className="px-2 py-1.5 font-semibold">Status</th>
                  </tr>
                </thead>
                <tbody>
                  {preview.tenancies.map((t: any) => (
                    <tr key={t.rowNumber} className="border-b border-gray-50">
                      <td className="px-2 py-1.5 text-gray-400 tabular-nums">{t.rowNumber}</td>
                      <td className="px-2 py-1.5">{t.unitNumber || '—'}</td>
                      <td className="px-2 py-1.5">{t.tenantName || '—'}</td>
                      <td className="px-2 py-1.5 text-gray-500 whitespace-nowrap">
                        {t.data.leaseStart ? fmtDate(t.data.leaseStart) : '—'} –{' '}
                        {t.data.terminationDate ? fmtDate(t.data.terminationDate) : (t.willBeActive ? 'ongoing' : '—')}
                      </td>
                      <td className="px-2 py-1.5 tabular-nums">
                        {t.data.monthlyRent != null ? fmt(t.data.monthlyRent) : '—'}
                        {t.rentAutoSplit && (
                          <span className="ml-1 text-[10px] text-teal-600" title="Split proportionally by sqft from a Combined Deal total">
                            (split)
                          </span>
                        )}
                      </td>
                      <td className="px-2 py-1.5">
                        {t.status === 'ready' ? (
                          <span className="inline-flex items-center gap-1 text-emerald-700">
                            <FiCheckCircle className="w-3.5 h-3.5" />
                            {t.willBeActive ? (
                              <span title="No Termination Date — imports as a live ACTIVE lease and updates the unit's current status">
                                Ready · Active
                              </span>
                            ) : 'Ready'}
                          </span>
                        ) : (
                          <span className="inline-flex items-start gap-1 text-rose-700">
                            <FiAlertTriangle className="w-3.5 h-3.5 mt-0.5 shrink-0" />
                            <span className="space-y-1">
                              {t.errors.map((err: string, i: number) => <div key={i}>{err}</div>)}
                              {mode === 'generic' && t.errors.some((e: string) => e.includes('no Broker Name was set')) && (
                                <div className="flex flex-wrap items-end gap-1.5 pt-1">
                                  <Select
                                    size="sm" label="Broker for this row" className="max-w-[160px]"
                                    isDisabled={!!rowBrokerChoices[t.rowNumber]?.newName.trim()}
                                    selectedKeys={rowBrokerChoices[t.rowNumber]?.brokerId ? [rowBrokerChoices[t.rowNumber].brokerId] : []}
                                    onSelectionChange={(keys) => setRowBrokerChoices((s) => ({
                                      ...s, [t.rowNumber]: { brokerId: (Array.from(keys)[0] as string) || '', newName: s[t.rowNumber]?.newName ?? '' },
                                    }))}
                                  >
                                    {((brokers.data as any[]) || []).map((b: any) => (
                                      <SelectItem key={b.id} textValue={b.name}>{b.name}</SelectItem>
                                    ))}
                                  </Select>
                                  <span className="text-[11px] text-gray-400">or</span>
                                  <Input
                                    size="sm" label="Type a new name" className="max-w-[140px]"
                                    isDisabled={!!rowBrokerChoices[t.rowNumber]?.brokerId}
                                    value={rowBrokerChoices[t.rowNumber]?.newName ?? ''}
                                    onChange={(e) => setRowBrokerChoices((s) => ({
                                      ...s, [t.rowNumber]: { brokerId: s[t.rowNumber]?.brokerId ?? '', newName: e.target.value },
                                    }))}
                                  />
                                </div>
                              )}
                            </span>
                          </span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {Object.values(rowBrokerChoices).some((c) => c.brokerId || c.newName.trim()) && (
              <div className="flex justify-end">
                <Button size="sm" color="primary" isLoading={applyingRowBrokers} onPress={handleApplyRowBrokers}>
                  Apply broker fixes &amp; re-check
                </Button>
              </div>
            )}

            {combinedUnitNumbers.length > 0 && (
              <div className="rounded-lg border border-amber-200 bg-amber-50 p-3">
                <p className="text-xs font-semibold text-amber-800 mb-1">
                  {combinedUnitNumbers.length} row{combinedUnitNumbers.length === 1 ? '' : 's'} name more than one
                  unit combined, not a single real unit number — not offered for auto-create:
                </p>
                <ul className="text-xs text-amber-700 space-y-0.5">
                  {combinedUnitNumbers.map((num) => (
                    <li key={num}>
                      <span className="font-medium">"{num}"</span> — create the individual units first
                      (Project → Units → Add Unit), then re-check this file. A combined deal across several
                      units is a Combined Deal Reference on each unit's own row, not one unit named "{num}".
                    </li>
                  ))}
                </ul>
              </div>
            )}

            {creatableUnitNumbers.length > 0 && (
              <div className="rounded-lg border border-blue-200 bg-blue-50 p-3 space-y-3">
                <p className="text-xs font-semibold text-blue-800">
                  {creatableUnitNumbers.length} unit{creatableUnitNumbers.length === 1 ? "" : "s"} in this file{' '}
                  {creatableUnitNumbers.length === 1 ? "doesn't" : "don't"} exist in this project yet. Pick a
                  Building and Type for the ones you want created — this is a real, separate write, done before
                  anything about the leases themselves is saved.
                </p>

                {creatableUnitNumbers.length > 1 && (
                  <div className="flex flex-wrap items-end gap-2 bg-white rounded-lg p-2 border border-blue-100">
                    <span className="text-xs font-medium text-gray-700 min-w-[90px]">Apply to all</span>
                    <Select
                      size="sm" label="Building" className="max-w-[200px]"
                      onSelectionChange={(keys) => applyToAllUnits({ buildingId: (Array.from(keys)[0] as string) || '' })}
                    >
                      {((buildings.data as any[]) || []).map((b: any) => (
                        <SelectItem key={b.id} textValue={b.name}>{b.name}</SelectItem>
                      ))}
                    </Select>
                    <Select
                      size="sm" label="Type" className="max-w-[180px]"
                      onSelectionChange={(keys) => applyToAllUnits({ unitType: (Array.from(keys)[0] as string) || '' })}
                    >
                      {((unitTypes.data as any[]) || []).map((t: any) => (
                        <SelectItem key={t.value} textValue={t.label}>{t.label}</SelectItem>
                      ))}
                    </Select>
                    <span className="text-[11px] text-gray-400 pb-1.5">— still editable per unit below</span>
                  </div>
                )}

                <div className="space-y-2">
                  {creatableUnitNumbers.map((num) => {
                    // The sheet's own Sqft (when mapped) pre-fills this instead of asking
                    // the user to type in something the file already told us.
                    const sheetSqft = preview.tenancies.find((t: any) => t.unitNumber === num)?.sqft;
                    const choice = missingUnitDefaults[num] ?? { buildingId: '', unitType: '', sqft: sheetSqft ? String(sheetSqft) : '' };
                    const setChoice = (patch: Partial<typeof choice>) =>
                      setMissingUnitDefaults((s) => ({ ...s, [num]: { ...choice, ...patch } }));
                    return (
                      <div key={num} className="flex flex-wrap items-end gap-2 bg-white rounded-lg p-2 border border-blue-100">
                        <span className="text-xs font-medium text-gray-700 min-w-[90px]">Unit {num}</span>
                        <Select
                          size="sm" label="Building" className="max-w-[200px]"
                          selectedKeys={choice.buildingId ? [choice.buildingId] : []}
                          onSelectionChange={(keys) => setChoice({ buildingId: (Array.from(keys)[0] as string) || '' })}
                        >
                          {((buildings.data as any[]) || []).map((b: any) => (
                            <SelectItem key={b.id} textValue={b.name}>{b.name}</SelectItem>
                          ))}
                        </Select>
                        <Select
                          size="sm" label="Type" className="max-w-[180px]"
                          selectedKeys={choice.unitType ? [choice.unitType] : []}
                          onSelectionChange={(keys) => setChoice({ unitType: (Array.from(keys)[0] as string) || '' })}
                        >
                          {((unitTypes.data as any[]) || []).map((t: any) => (
                            <SelectItem key={t.value} textValue={t.label}>{t.label}</SelectItem>
                          ))}
                        </Select>
                        <Input
                          size="sm" type="number" label="Sqft (optional)" className="max-w-[140px]"
                          value={choice.sqft} onChange={(e) => setChoice({ sqft: e.target.value })}
                        />
                      </div>
                    );
                  })}
                </div>
                <Button size="sm" color="primary" isLoading={creatingUnits} onPress={handleCreateMissingUnits}>
                  Create these units &amp; re-check the file
                </Button>
              </div>
            )}

            {preview.orphaned.length > 0 && (
              <div className="rounded-lg border border-amber-200 bg-amber-50 p-3">
                <p className="text-xs font-semibold text-amber-800 mb-1">
                  These rows in Ledger Exceptions / Commission Installments couldn't be matched to a Tenancies row:
                </p>
                <ul className="text-xs text-amber-700 space-y-0.5">
                  {preview.orphaned.map((o: any, i: number) => (
                    <li key={i}>{o.sheet} row {o.rowNumber} ({o.unitNumber} / {o.tenantName}) — {o.error}</li>
                  ))}
                </ul>
              </div>
            )}

            {!result && (
              <div className="flex gap-2">
                <Button size="sm" variant="flat" onPress={startOver}>Start over</Button>
                <Button
                  size="sm"
                  color="primary"
                  isDisabled={preview.summary.ready === 0}
                  isLoading={commitImport.isPending}
                  onPress={handleCommit}
                >
                  Import {preview.summary.ready} ready row{preview.summary.ready === 1 ? '' : 's'}
                </Button>
              </div>
            )}
          </CardBody>
        </Card>
      )}

      {result && (
        <Card>
          <CardHeader>
            <p className="font-semibold text-sm">Results</p>
          </CardHeader>
          <CardBody className="space-y-3">
            <div className="flex gap-2">
              <Chip size="sm" color="success" variant="flat">{result.imported} imported</Chip>
              {result.failed > 0 && <Chip size="sm" color="danger" variant="flat">{result.failed} failed</Chip>}
            </div>
            {result.failed > 0 && (
              <ul className="text-xs text-rose-700 space-y-0.5">
                {result.results.filter((r: any) => !r.success).map((r: any, i: number) => (
                  <li key={i}>{r.tenantName} — {r.error}</li>
                ))}
              </ul>
            )}
            <div className="flex gap-2">
              <Button size="sm" variant="flat" onPress={startOver}>Import another file</Button>
              <Button size="sm" color="primary" onPress={() => navigate(`/projects/${projectId}/revenue`)}>
                Back to project
              </Button>
            </div>
          </CardBody>
        </Card>
      )}
    </div>
  );
}
