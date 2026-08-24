import { useRef, useState } from 'react';
import { useParams, useNavigate, Link } from 'react-router-dom';
import { Card, CardBody, CardHeader, Button, Chip, Select, SelectItem, Input, addToast } from '@heroui/react';
import { FiArrowLeft, FiDownload, FiUpload, FiCheckCircle, FiAlertTriangle } from 'react-icons/fi';
import {
  useDownloadSaleImportTemplate, usePreviewSaleImport, useCommitSaleImport,
  useBuildings, useCreateBuilding, useCreateUnit, useCustomOptions,
} from '../hooks/useApi';
import { errMsg, fmt, fmtDate } from '../utils/fmt';
import {
  looksLikeCombinedUnitRef, looksLikeWholeBuildingRef, looksLikeNonUnitRef,
  createSequentiallyRateLimited,
} from '../utils/import-helpers';
import { BUILDING_TYPES } from '../components/BuildingFormModal';

/**
 * Bulk sale-history import (R5) — the sale-side counterpart of RentHistoryImportPage
 * (R1/R2). Same three-step shape: nothing is written until the preview is reviewed and
 * explicitly confirmed. See docs/client-discovery/HISTORICAL_DATA_SHEET_IMPORT_SPEC.md.
 *
 * Missing buildings/units (R10): a row can fail to resolve because the unit doesn't
 * exist yet, or because its building doesn't. Both are offered as an explicit,
 * reviewed create step before re-checking the file — never silent, since a wrong guess
 * here (wrong building, wrong type) is real inventory a human then has to notice and fix.
 */
export default function SaleHistoryImportPage() {
  const { id: projectId } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const fileInputRef = useRef<HTMLInputElement>(null);

  const downloadTemplate = useDownloadSaleImportTemplate();
  const previewImport = usePreviewSaleImport();
  const commitImport = useCommitSaleImport();

  // Missing-building/unit auto-create (R10)
  const buildings = useBuildings(projectId || '');
  const createBuilding = useCreateBuilding();
  const unitTypes = useCustomOptions('unit_type');
  const createUnit = useCreateUnit();

  const [fileName, setFileName] = useState<string | null>(null);
  const [preview, setPreview] = useState<any | null>(null);
  const [result, setResult] = useState<any | null>(null);
  const [lastFile, setLastFile] = useState<File | null>(null);

  // Per-missing-building-name Type choice, and per-missing-unit-number Building/Type/Sqft
  // choice — same shape and reasoning as RentHistoryImportPage's missing-unit step.
  const [missingBuildingTypes, setMissingBuildingTypes] = useState<Record<string, string>>({});
  const [missingUnitDefaults, setMissingUnitDefaults] = useState<Record<string, { buildingId: string; unitType: string; sqft: string }>>({});
  const [creatingBuildings, setCreatingBuildings] = useState(false);
  const [creatingUnits, setCreatingUnits] = useState(false);

  const handleFilePicked = async (file: File) => {
    if (!projectId) return;
    setFileName(file.name);
    setResult(null);
    setLastFile(file);
    try {
      const data = await previewImport.mutateAsync({ file, projectId });
      setPreview(data);
    } catch (e) {
      addToast({ title: errMsg(e, 'Could not read this file'), color: 'danger' });
      setPreview(null);
    }
  };

  const rerunPreview = async () => {
    if (lastFile) await handleFilePicked(lastFile);
  };

  // Rows whose unit didn't resolve because the unit truly doesn't exist (not because of a
  // building-label mismatch — resolveUnit gives that its own, more specific error, and a
  // mismatched label is a data-entry fix, not a "create a building" situation).
  const unresolvedRows = preview
    ? preview.sales.filter((s: any) => !s.data.unitId && s.errors.some((e: string) => e.includes('was not found in this project')))
    : [];

  // Distinct building names those rows reference that don't already exist in this
  // project (case-insensitive) — offered as "create these buildings" first, since a
  // missing unit's Building picker below needs somewhere to point once created.
  const existingBuildingNames = new Set(((buildings.data as any[]) || []).map((b: any) => b.name.trim().toLowerCase()));
  const missingBuildingNames: string[] = Array.from(new Set(
    unresolvedRows
      .map((s: any) => (s.building || '').trim())
      .filter((b: string) => b && !existingBuildingNames.has(b.toLowerCase())),
  ));

  // Distinct unit numbers to offer creating — same combined-reference exclusion as rent
  // history (see looksLikeCombinedUnitRef), for the same reason: "104, 106" is two units'
  // worth of ambiguity, not one unit's name.
  const missingUnitNumbers: string[] = Array.from(new Set(unresolvedRows.map((s: any) => s.unitNumber).filter(Boolean)));
  const creatableUnitNumbers = missingUnitNumbers.filter(
    (n) => !looksLikeCombinedUnitRef(n) && !looksLikeWholeBuildingRef(n) && !looksLikeNonUnitRef(n),
  );
  const combinedUnitNumbers = missingUnitNumbers.filter(looksLikeCombinedUnitRef);
  const wholeBuildingUnitNumbers = missingUnitNumbers.filter(looksLikeWholeBuildingRef);
  const nonUnitRefs = missingUnitNumbers.filter(looksLikeNonUnitRef);

  const applyTypeToAllBuildings = (buildingType: string) => {
    setMissingBuildingTypes((s) => {
      const next = { ...s };
      for (const name of missingBuildingNames) next[name] = buildingType;
      return next;
    });
  };

  const handleCreateMissingBuildings = async () => {
    const toCreate = missingBuildingNames.filter((name) => missingBuildingTypes[name]);
    if (toCreate.length === 0) {
      addToast({ title: 'Pick a Building Type for at least one building first', color: 'warning' });
      return;
    }
    setCreatingBuildings(true);
    const outcomes = await createSequentiallyRateLimited(toCreate, (name) =>
      createBuilding.mutateAsync({ projectId, name, buildingType: missingBuildingTypes[name] }));
    const created = outcomes.filter((o) => !o.error).length;
    const failures = outcomes.filter((o) => o.error).map((o) => `${o.item}: ${errMsg(o.error, 'failed')}`);
    setMissingBuildingTypes((s) => {
      const next = { ...s };
      for (const o of outcomes) if (!o.error) delete next[o.item];
      return next;
    });
    if (created > 0) addToast({ title: `Created ${created} building${created === 1 ? '' : 's'}`, color: 'success' });
    if (failures.length > 0) {
      addToast({ title: `${failures.length} couldn't be created`, description: failures.join(' · '), color: 'danger' });
    }
    await rerunPreview();
    setCreatingBuildings(false);
  };

  // Fills every creatable row with the same Building/Type at once — the common case is
  // one project, one or two buildings, so picking per-row 9 times is pure friction.
  const applyToAllUnits = (patch: { buildingId?: string; unitType?: string }) => {
    setMissingUnitDefaults((s) => {
      const next = { ...s };
      for (const num of creatableUnitNumbers) {
        const row = unresolvedRows.find((r: any) => r.unitNumber === num);
        const matchedBuilding = row
          ? ((buildings.data as any[]) || []).find((b: any) => b.name.trim().toLowerCase() === (row.building || '').trim().toLowerCase())
          : null;
        const fallback = { buildingId: matchedBuilding?.id ?? '', unitType: '', sqft: row?.sqft ? String(row.sqft) : '' };
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
    const outcomes = await createSequentiallyRateLimited(toCreate, ({ num, choice }) =>
      createUnit.mutateAsync({
        buildingId: choice.buildingId,
        unitNumber: num,
        unitType: choice.unitType,
        sqft: choice.sqft ? Number(choice.sqft) : undefined,
      }));
    const created = outcomes.filter((o) => !o.error).length;
    const failures = outcomes.filter((o) => o.error).map((o) => `Unit ${o.item.num}: ${errMsg(o.error, 'failed')}`);
    setMissingUnitDefaults((s) => {
      const next = { ...s };
      for (const o of outcomes) if (!o.error) delete next[o.item.num];
      return next;
    });
    if (created > 0) addToast({ title: `Created ${created} unit${created === 1 ? '' : 's'}`, color: 'success' });
    if (failures.length > 0) {
      addToast({ title: `${failures.length} couldn't be created — re-checking the file anyway`, description: failures.join(' · '), color: 'danger' });
    }
    await rerunPreview();
    setCreatingUnits(false);
  };

  const handleCommit = async () => {
    if (!preview) return;
    const readyRows = preview.sales.filter((s: any) => s.status === 'ready').map((s: any) => s.data);
    if (readyRows.length === 0) return;
    try {
      const data = await commitImport.mutateAsync(readyRows);
      setResult(data);
      addToast({
        title: `Imported ${data.imported} sale${data.imported === 1 ? '' : 's'}${data.failed ? `, ${data.failed} failed` : ''}`,
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
    setLastFile(null);
    setMissingBuildingTypes({});
    setMissingUnitDefaults({});
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
        <h1 className="text-xl font-bold text-gray-900">Import sale history</h1>
        <p className="text-sm text-gray-500 mt-1">
          Bulk-enter closed sales from a spreadsheet. Nothing is written until you review
          the preview below and confirm it. If a unit's past tenancy is also being
          imported, import the rent history first — a backfilled sale ends whatever
          tenancy it finds on record at the closing date.
        </p>
      </div>

      <Card>
        <CardHeader className="flex flex-col items-start gap-1">
          <p className="font-semibold text-sm">1. Download the template</p>
          <p className="text-xs text-gray-500">
            Two tabs: Sales, and Commission Installments. Fill in Sales at minimum.
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
                <Chip size="sm" color="warning" variant="flat">{preview.orphaned.length} unmatched commission row(s)</Chip>
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
                    <th className="px-2 py-1.5 font-semibold">Buyer</th>
                    <th className="px-2 py-1.5 font-semibold">Closing Date</th>
                    <th className="px-2 py-1.5 font-semibold">Price</th>
                    <th className="px-2 py-1.5 font-semibold">Status</th>
                  </tr>
                </thead>
                <tbody>
                  {preview.sales.map((s: any) => (
                    <tr key={s.rowNumber} className="border-b border-gray-50">
                      <td className="px-2 py-1.5 text-gray-500 tabular-nums">{s.rowNumber}</td>
                      <td className="px-2 py-1.5">{s.unitNumber || '—'}</td>
                      <td className="px-2 py-1.5">{s.buyer || '—'}</td>
                      <td className="px-2 py-1.5 text-gray-500 whitespace-nowrap">
                        {s.data.closingDate ? fmtDate(s.data.closingDate) : '—'}
                      </td>
                      <td className="px-2 py-1.5 tabular-nums">
                        {s.data.salePrice != null ? fmt(s.data.salePrice) : '—'}
                      </td>
                      <td className="px-2 py-1.5">
                        {s.status === 'ready' ? (
                          <span className="inline-flex items-center gap-1 text-emerald-700">
                            <FiCheckCircle className="w-3.5 h-3.5" /> Ready
                          </span>
                        ) : (
                          <span className="inline-flex items-start gap-1 text-rose-700">
                            <FiAlertTriangle className="w-3.5 h-3.5 mt-0.5 shrink-0" />
                            <span>{s.errors.join(' ')}</span>
                          </span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {wholeBuildingUnitNumbers.length > 0 && (
              <div className="rounded-lg border border-amber-200 bg-amber-50 p-3">
                <p className="text-xs font-semibold text-amber-800 mb-1">
                  {preview.sales.filter((s: any) => wholeBuildingUnitNumbers.includes(s.unitNumber)).length} row(s)
                  are whole-building sales, not unit sales, and can't go through this tool:
                </p>
                <p className="text-xs text-amber-700">
                  A row whose Unit Number says "Entire Building" means the sale was for the whole building, not
                  one unit in it. This importer only ever resolves to a Unit. Once the building itself exists
                  (create it above if it's listed as missing), add these sales by hand from the project's
                  Revenue tab — Add Sale supports attaching to a Building directly.
                </p>
              </div>
            )}

            {nonUnitRefs.length > 0 && (
              <div className="rounded-lg border border-amber-200 bg-amber-50 p-3">
                <p className="text-xs font-semibold text-amber-800 mb-1">
                  {nonUnitRefs.length} row{nonUnitRefs.length === 1 ? '' : 's'} don't name a real unit — not
                  offered for auto-create:
                </p>
                <ul className="text-xs text-amber-700 space-y-0.5">
                  {nonUnitRefs.map((num) => (
                    <li key={num}>
                      <span className="font-medium">"{num}"</span> — a "(prior)" suffix marks an earlier record
                      for a unit that already exists, and a placeholder means the source never recorded one.
                      Creating a unit by this name would split that unit's history in two. Point the row at the
                      real Unit Number in the sheet, then re-check.
                    </li>
                  ))}
                </ul>
              </div>
            )}

            {combinedUnitNumbers.length > 0 && (
              <div className="rounded-lg border border-amber-200 bg-amber-50 p-3">
                <p className="text-xs font-semibold text-amber-800 mb-1">
                  These unit numbers name more than one unit and won't be auto-created:
                </p>
                <ul className="text-xs text-amber-700 space-y-1">
                  {combinedUnitNumbers.map((num) => (
                    <li key={num}>
                      <span className="font-medium">"{num}"</span> — create the individual units first
                      (Project → Units → Add Unit, or Combine Units if the sale really is one
                      combined deal across them), then re-check this file.
                    </li>
                  ))}
                </ul>
              </div>
            )}

            {missingBuildingNames.length > 0 && (
              <div className="rounded-lg border border-blue-200 bg-blue-50 p-3 space-y-3">
                <p className="text-xs font-semibold text-blue-800">
                  {missingBuildingNames.length} building{missingBuildingNames.length === 1 ? '' : 's'} in this
                  file {missingBuildingNames.length === 1 ? "doesn't" : "don't"} exist in this project yet. Pick
                  a Type for the ones you want created — units below can't be assigned to a building until it
                  exists.
                </p>
                {missingBuildingNames.length > 1 && (
                  <div className="flex flex-wrap items-end gap-2 bg-white rounded-lg p-2 border border-blue-100">
                    <span className="text-xs font-medium text-gray-700 min-w-[90px]">Apply to all</span>
                    <Select
                      size="sm" label="Building Type" className="max-w-[200px]"
                      onSelectionChange={(keys) => applyTypeToAllBuildings((Array.from(keys)[0] as string) || '')}
                    >
                      {BUILDING_TYPES.map((t) => (
                        <SelectItem key={t} textValue={t}>{t}</SelectItem>
                      ))}
                    </Select>
                  </div>
                )}
                <div className="space-y-2">
                  {missingBuildingNames.map((name) => (
                    <div key={name} className="flex flex-wrap items-end gap-2 bg-white rounded-lg p-2 border border-blue-100">
                      <span className="text-xs font-medium text-gray-700 min-w-[180px]">{name}</span>
                      <Select
                        size="sm" label="Type" className="max-w-[200px]"
                        selectedKeys={missingBuildingTypes[name] ? [missingBuildingTypes[name]] : []}
                        onSelectionChange={(keys) => setMissingBuildingTypes((s) => ({ ...s, [name]: (Array.from(keys)[0] as string) || '' }))}
                      >
                        {BUILDING_TYPES.map((t) => (
                          <SelectItem key={t} textValue={t}>{t}</SelectItem>
                        ))}
                      </Select>
                    </div>
                  ))}
                </div>
                <Button size="sm" color="primary" isLoading={creatingBuildings} onPress={handleCreateMissingBuildings}>
                  Create these buildings &amp; re-check the file
                </Button>
              </div>
            )}

            {creatableUnitNumbers.length > 0 && (
              <div className="rounded-lg border border-blue-200 bg-blue-50 p-3 space-y-3">
                <p className="text-xs font-semibold text-blue-800">
                  {creatableUnitNumbers.length} unit{creatableUnitNumbers.length === 1 ? '' : 's'} in this file{' '}
                  {creatableUnitNumbers.length === 1 ? "doesn't" : "don't"} exist in this project yet. The
                  Building is pre-filled from the sheet where it already matches one — pick a Type for the ones
                  you want created. This is a real, separate write, done before anything about the sales
                  themselves is saved.
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
                    <span className="text-[11px] text-gray-500 pb-1.5">— still editable per unit below</span>
                  </div>
                )}

                <div className="space-y-2">
                  {creatableUnitNumbers.map((num) => {
                    const row = unresolvedRows.find((r: any) => r.unitNumber === num);
                    const matchedBuilding = row
                      ? ((buildings.data as any[]) || []).find((b: any) => b.name.trim().toLowerCase() === (row.building || '').trim().toLowerCase())
                      : null;
                    const choice = missingUnitDefaults[num] ?? {
                      buildingId: matchedBuilding?.id ?? '', unitType: '', sqft: row?.sqft ? String(row.sqft) : '',
                    };
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
                  These Commission Installments rows couldn't be matched to a Sales row:
                </p>
                <ul className="text-xs text-amber-700 space-y-0.5">
                  {preview.orphaned.map((o: any, i: number) => (
                    <li key={i}>{o.sheet} row {o.rowNumber} ({o.unitNumber} / {o.buyer}) — {o.error}</li>
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
                  <li key={i}>{r.buyer} — {r.error}</li>
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
