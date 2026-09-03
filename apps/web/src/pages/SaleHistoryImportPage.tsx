import { useRef, useState } from 'react';
import { useParams, useNavigate, Link } from 'react-router-dom';
import { Card, CardBody, CardHeader, Button, Chip, Select, SelectItem, Input, addToast } from '@heroui/react';
import { ImportStepRail, FileDropZone } from '../components/ImportFlow';
import { FiArrowLeft, FiDownload, FiUpload, FiCheckCircle, FiAlertTriangle, FiEdit3, FiSkipForward } from 'react-icons/fi';
import {
  useDownloadSaleImportTemplate, usePreviewSaleImport, useCommitSaleImport,
  useBuildings, useCreateBuilding, useCreateUnit, useCustomOptions, useBrokers,
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
 * Missing values (R11): a row blocked only by a blank or wrong cell — no closing date, no
 * price, an unmatched broker — is fixable in place. The Status cell renders an input for
 * exactly the fields that row's errors name; "Apply corrections & re-check" re-runs the
 * same preview endpoint with those values, so a typed-in date is validated (and a typed-in
 * unit number resolved) by the very same server code that reads the cells. Nothing is
 * written to the spreadsheet and nothing is written to the database until Import.
 *
 * Missing buildings/units (R10): a row can fail to resolve because the unit doesn't
 * exist yet, or because its building doesn't. Both are offered as an explicit,
 * reviewed create step before re-checking the file — never silent, since a wrong guess
 * here (wrong building, wrong type) is real inventory a human then has to notice and fix.
 */
/**
 * Which blocked fields a reviewer can retype in place (R11), and how a row's error text
 * maps to them. Matching on the error strings — rather than re-deriving "what's missing"
 * from the row data — keeps the offer honest: an input appears only for a field the server
 * itself has objected to, so a wording change on the server can never leave a stale editor
 * behind that silently does nothing.
 *
 * Deliberately NOT offered: the optional payment/commission fields. A row is never blocked
 * on them, and quietly typing a deposit into an import preview is a data-entry path nobody
 * asked for — those belong on the sale itself after import.
 */
const FIXABLE_FIELDS: {
  key: string;
  label: string;
  type: 'text' | 'number' | 'date' | 'broker' | 'building';
  matches: (err: string) => boolean;
}[] = [
  {
    key: 'unitNumber', label: 'Unit Number', type: 'text',
    matches: (e) => e.startsWith('Unit Number is required')
      || e.includes('was not found in this project')
      || e.includes('exists in more than one building'),
  },
  {
    key: 'building', label: 'Building', type: 'building',
    matches: (e) => e.includes('exists in more than one building') || e.includes('— not "'),
  },
  { key: 'buyer', label: 'Buyer', type: 'text', matches: (e) => e.startsWith('Buyer is required') },
  {
    key: 'purchasePrice', label: 'Purchase Price', type: 'number',
    matches: (e) => e.startsWith('Purchase Price is required') || e.startsWith('Purchase Price "'),
  },
  {
    key: 'closingDate', label: 'Closing Date', type: 'date',
    matches: (e) => e.startsWith('Closing Date'),
  },
  {
    key: 'brokerName', label: 'Broker', type: 'broker',
    matches: (e) => e.startsWith('Broker "') || e.includes('no Broker Name was set'),
  },
];

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
  // Only for the inline broker fix — a user without broker:view gets a plain name input
  // instead (the server resolves by name either way).
  const brokers = useBrokers();

  const [fileName, setFileName] = useState<string | null>(null);
  const [preview, setPreview] = useState<any | null>(null);
  const [result, setResult] = useState<any | null>(null);
  const [lastFile, setLastFile] = useState<File | null>(null);

  // Per-missing-building-name Type choice, and per-missing-unit-number Building/Type/Sqft
  // choice — same shape and reasoning as RentHistoryImportPage's missing-unit step.
  // Per-row typed-in corrections (R11), keyed by the sheet's own row number. `appliedEdits`
  // is the serialized set the CURRENT preview was produced from — anything typed since is
  // unchecked, which is why Import is held until it has been re-checked.
  const [edits, setEdits] = useState<Record<number, Record<string, string>>>({});
  /** Values in the fill-every-row bar — staging only; they do nothing until applied. */
  const [bulkValues, setBulkValues] = useState<Record<string, string>>({});
  const [appliedEdits, setAppliedEdits] = useState('{}');

  const [missingBuildingTypes, setMissingBuildingTypes] = useState<Record<string, string>>({});
  const [missingUnitDefaults, setMissingUnitDefaults] = useState<Record<string, { buildingId: string; unitType: string; sqft: string }>>({});
  const [creatingBuildings, setCreatingBuildings] = useState(false);
  const [creatingUnits, setCreatingUnits] = useState(false);

  const runPreview = async (file: File, overrides: Record<number, Record<string, string>>) => {
    if (!projectId) return;
    try {
      const data = await previewImport.mutateAsync({ file, projectId, overrides });
      setPreview(data);
      setAppliedEdits(JSON.stringify(overrides));
    } catch (e) {
      addToast({ title: errMsg(e, 'Could not read this file'), color: 'danger' });
      setPreview(null);
    }
  };

  // A new file resets the corrections: they're keyed by row number, and row 7 of another
  // file is a different sale.
  const handleFilePicked = async (file: File) => {
    if (!projectId) return;
    setFileName(file.name);
    setResult(null);
    setLastFile(file);
    setEdits({});
    await runPreview(file, {});
  };

  /** Re-checks the same file, carrying whatever corrections have been typed so far. */
  const rerunPreview = async (overrides = edits) => {
    if (lastFile) await runPreview(lastFile, overrides);
  };

  const editsDirty = JSON.stringify(edits) !== appliedEdits;
  const editedRowCount = Object.keys(edits).length;

  const setEdit = (rowNumber: number, field: string, value: string) => {
    setEdits((s) => ({ ...s, [rowNumber]: { ...s[rowNumber], [field]: value } }));
  };

  const clearEdits = async () => {
    setEdits({});
    setBulkValues({});
    await rerunPreview({});
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
        title: `Imported ${data.imported} sale${data.imported === 1 ? '' : 's'}`
          + `${data.skipped ? `, ${data.skipped} already recorded` : ''}`
          + `${data.failed ? `, ${data.failed} failed` : ''}`,
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
    setEdits({});
    setBulkValues({});
    setAppliedEdits('{}');
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  /**
   * One editor for one correctable field, used both per row and in the fill-every-row bar
   * above the table — they must stay literally the same control, or "apply to all" would
   * quietly accept a value the per-row box would have rejected.
   *
   * Both pickers list what the row is actually matched against, so a fix can't fail on a
   * typo the way retyping a name would; each falls back to free text when its list is
   * empty (a user without broker:view still gets to fix a row).
   */
  const renderFixInput = (
    f: (typeof FIXABLE_FIELDS)[number],
    value: string,
    onValue: (v: string) => void,
  ) => {
    const options: string[] | null =
      f.type === 'broker' ? ((brokers.data as any[]) || []).map((b: any) => b.name)
        : f.type === 'building' ? ((buildings.data as any[]) || []).map((b: any) => b.name)
          : null;
    if (options && options.length > 0) {
      const blank = f.type === 'broker' ? 'No broker' : 'Any building';
      return (
        <Select
          key={f.key} size="sm" label={f.label} className="max-w-[180px]"
          selectedKeys={value ? [value] : []}
          onSelectionChange={(keys) => onValue((Array.from(keys)[0] as string) || '')}
        >
          {[
            <SelectItem key="" textValue={blank}>{blank}</SelectItem>,
            ...options.map((n: string) => <SelectItem key={n} textValue={n}>{n}</SelectItem>),
          ]}
        </Select>
      );
    }
    return (
      <Input
        key={f.key}
        size="sm"
        label={f.label}
        className={f.type === 'date' ? 'max-w-[170px]' : 'max-w-[160px]'}
        type={f.type === 'number' ? 'number' : f.type === 'date' ? 'date' : 'text'}
        value={value}
        onChange={(e) => onValue(e.target.value)}
      />
    );
  };

  // Rows still blocked, and which correctable field each is waiting on. Drives both the
  // fill-every-row bar and the plain-English "why is Import still 0" line — a 38-row file
  // whose rows all need the same missing column should not be fixed 38 times by hand.
  const blockedRows: any[] = preview ? preview.sales.filter((r: any) => r.status === 'error') : [];
  const rowsNeeding = (f: (typeof FIXABLE_FIELDS)[number]) =>
    blockedRows.filter((r: any) => r.errors.some(f.matches));
  const bulkFields = FIXABLE_FIELDS.filter((f) => rowsNeeding(f).length >= 2);
  // Blocked by something no input here can fix — a combined "812, 814" reference, a unit
  // that has to be created first. Counted separately so the fixable count stays honest.
  const unfixableCount = blockedRows.filter(
    (r: any) => !FIXABLE_FIELDS.some((f) => r.errors.some(f.matches)),
  ).length;

  /** Fills one field on every row that is blocked on it, still editable per row after. */
  const fillAll = (f: (typeof FIXABLE_FIELDS)[number], value: string) => {
    const targets = rowsNeeding(f);
    setEdits((s) => {
      const next = { ...s };
      for (const r of targets) next[r.rowNumber] = { ...next[r.rowNumber], [f.key]: value };
      return next;
    });
  };

  /**
   * Which of the three steps the page is on. Drives the rail at the top, and the
   * placeholder that stands in for step 3 before a file has been read.
   *
   * The page used to be three stacked full-width cards on a max-w-6xl column, two of
   * which held a single small button — so most of a 1150px-wide screen was empty and
   * there was no sign that a third step existed at all until a file happened to parse.
   * It read as a broken page rather than as step 1 of 3.
   */
  const step: 1 | 2 | 3 = result ? 3 : preview ? 3 : fileName ? 2 : 1;

  return (
    <div className="space-y-5 max-w-3xl mx-auto pb-6">
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

      <ImportStepRail
        current={step}
        labels={['Get the template', 'Upload the file', 'Review & import']}
      />

      <Card shadow="none" className="border border-gray-200">
        <CardHeader className="flex flex-col items-start gap-1 pb-2">
          <p className="font-semibold text-sm text-gray-800">1. Download the template</p>
          <p className="text-xs text-gray-500">
            Two tabs: Sales, and Commission Installments. Fill in Sales at minimum.
          </p>
        </CardHeader>
        <CardBody className="pt-0">
          <Button
            size="sm"
            variant="flat"
            className="w-fit"
            startContent={<FiDownload />}
            isLoading={downloadTemplate.isPending}
            onPress={() => downloadTemplate.mutate()}
          >
            Download template (.xlsx)
          </Button>
        </CardBody>
      </Card>

      <Card shadow="none" className="border border-gray-200">
        <CardHeader className="flex flex-col items-start gap-1 pb-2">
          <p className="font-semibold text-sm text-gray-800">2. Upload your filled-in file</p>
          <p className="text-xs text-gray-500">Nothing is saved yet — this only parses and checks the file.</p>
        </CardHeader>
        <CardBody className="pt-0">
          <FileDropZone
            inputRef={fileInputRef}
            onFile={handleFilePicked}
            fileName={fileName}
            isLoading={previewImport.isPending}
            hint="Only the file is read — nothing is saved yet"
          />
        </CardBody>
      </Card>

      {/* Step 3 exists before there is anything to put in it. Without this the page just
          stopped after step 2 and the reader had no way to know a review stage was
          coming. */}
      {!preview && !result && (
        <Card shadow="none" className="border border-dashed border-gray-200 bg-gray-50/40">
          <CardBody className="py-6 text-center">
            <p className="text-sm font-medium text-gray-500">3. Review &amp; import</p>
            <p className="text-xs text-gray-500 mt-1">
              Every row, with its errors, appears here once a file is read. You confirm
              before anything is written.
            </p>
          </CardBody>
        </Card>
      )}

      {preview && (
        <Card>
          <CardHeader className="flex flex-col items-start gap-1">
            <p className="font-semibold text-sm">3. Review before importing</p>
            <div className="flex gap-2 mt-1">
              <Chip size="sm" color="success" variant="flat">{preview.summary.ready} ready</Chip>
              {preview.summary.duplicates > 0 && (
                <Chip size="sm" variant="flat">{preview.summary.duplicates} already imported</Chip>
              )}
              {preview.summary.errors > 0 && (
                <Chip size="sm" color="danger" variant="flat">{preview.summary.errors} with errors</Chip>
              )}
              {preview.orphaned.length > 0 && (
                <Chip size="sm" color="warning" variant="flat">{preview.orphaned.length} unmatched commission row(s)</Chip>
              )}
              {editedRowCount > 0 && (
                <Chip size="sm" variant="flat" startContent={<FiEdit3 className="w-3 h-3" />}>
                  {editedRowCount} row{editedRowCount === 1 ? '' : 's'} corrected here
                </Chip>
              )}
            </div>
            {preview.summary.errors > 0 && (
              <p className="text-xs text-gray-500 mt-1">
                A row missing only a value — a closing date, a price, a broker — can be filled in below
                without touching the spreadsheet. Type it in, then re-check: your entries are validated the
                same way the file's own cells are.
              </p>
            )}
          </CardHeader>
          <CardBody className="space-y-4">
            {blockedRows.length > 0 && (
              <div className="rounded-lg border border-gray-200 bg-gray-50 p-3 space-y-3">
                {/* Says plainly why Import reads 0, instead of leaving it to be inferred
                    from 38 identical red sentences. */}
                <p className="text-xs text-gray-700">
                  <span className="font-semibold">{blockedRows.length} row{blockedRows.length === 1 ? '' : 's'} still blocked:</span>{' '}
                  {[
                    ...FIXABLE_FIELDS
                      .filter((f) => rowsNeeding(f).length > 0)
                      .map((f) => `${rowsNeeding(f).length} ${rowsNeeding(f).length === 1 ? 'needs' : 'need'} a ${f.label}`),
                    ...(unfixableCount > 0
                      ? [`${unfixableCount} can't be fixed here — see the notes below the table`] : []),
                  ].join(' · ')}
                </p>
                {bulkFields.length > 0 && (
                  <>
                    <p className="text-xs text-gray-500">
                      Fill one in for every row that's missing it — each row stays editable afterwards, so a
                      value that's right for most rows and wrong for two is still worth setting here.
                    </p>
                    <div className="flex flex-wrap items-end gap-2">
                      {bulkFields.map((f) => (
                        <div key={f.key} className="flex items-end gap-1.5">
                          {renderFixInput(f, bulkValues[f.key] ?? '', (v) => setBulkValues((b) => ({ ...b, [f.key]: v })))}
                          <Button
                            size="sm" variant="flat"
                            isDisabled={!bulkValues[f.key]}
                            onPress={() => fillAll(f, bulkValues[f.key])}
                          >
                            Apply to {rowsNeeding(f).length}
                          </Button>
                        </div>
                      ))}
                    </div>
                  </>
                )}
              </div>
            )}

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
                  {preview.sales.map((s: any) => {
                    const rowEdits = edits[s.rowNumber] ?? {};
                    // An editor is shown for every field this row's errors name, plus any
                    // field already corrected — so a value just typed stays adjustable
                    // (and clearable) once the row goes green.
                    const touched: string[] = [...Object.keys(rowEdits), ...(s.edited ?? [])];
                    const fields = FIXABLE_FIELDS.filter(
                      (f) => touched.includes(f.key) || s.errors.some(f.matches),
                    );
                    return (
                      <tr key={s.rowNumber} className="border-b border-gray-50 align-top">
                        <td className="px-2 py-1.5 text-gray-500 tabular-nums">{s.rowNumber}</td>
                        <td className="px-2 py-1.5">{s.unitNumber || '—'}</td>
                        <td className="px-2 py-1.5">{s.buyer || '—'}</td>
                        <td className="px-2 py-1.5 text-gray-500 whitespace-nowrap">
                          {s.data.closingDate ? fmtDate(s.data.closingDate) : '—'}
                        </td>
                        <td className="px-2 py-1.5 tabular-nums">
                          {s.data.salePrice != null ? fmt(s.data.salePrice) : '—'}
                        </td>
                        <td className="px-2 py-1.5 space-y-2">
                          {s.status === 'ready' && (
                            <span className="inline-flex items-center gap-1 text-emerald-700">
                              <FiCheckCircle className="w-3.5 h-3.5" /> Ready
                            </span>
                          )}
                          {/* Not an error and not an action — this row is simply already
                              done, which is what most of a re-uploaded sheet looks like. */}
                          {s.status === 'duplicate' && (
                            <span className="inline-flex items-center gap-1 text-gray-500">
                              <FiSkipForward className="w-3.5 h-3.5" /> Already imported — will be skipped
                            </span>
                          )}
                          {s.status === 'error' && (
                            <span className="inline-flex items-start gap-1 text-rose-700">
                              <FiAlertTriangle className="w-3.5 h-3.5 mt-0.5 shrink-0" />
                              <span>{s.errors.join(' ')}</span>
                            </span>
                          )}
                          {(s.warnings?.length ?? 0) > 0 && (
                            <span className="inline-flex items-start gap-1 text-amber-700">
                              <FiAlertTriangle className="w-3.5 h-3.5 mt-0.5 shrink-0" />
                              <span>{s.warnings.join(' ')}</span>
                            </span>
                          )}
                          {(s.edited?.length ?? 0) > 0 && (
                            <span className="inline-flex items-center gap-1 text-[11px] text-gray-500 ml-2">
                              <FiEdit3 className="w-3 h-3" />
                              {s.edited.length} value{s.edited.length === 1 ? '' : 's'} entered here, not from the file
                            </span>
                          )}
                          {fields.length > 0 && (
                            <div className="flex flex-wrap items-end gap-2">
                              {fields.map((f) => renderFixInput(
                                f,
                                rowEdits[f.key] ?? '',
                                (v) => setEdit(s.rowNumber, f.key, v),
                              ))}
                            </div>
                          )}
                        </td>
                      </tr>
                    );
                  })}
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

            {(editedRowCount > 0 || editsDirty) && (
              <div className="rounded-lg border border-blue-200 bg-blue-50 p-3 flex flex-wrap items-center gap-2">
                <p className="text-xs text-blue-800 flex-1 min-w-[240px]">
                  {editsDirty
                    ? 'Corrections typed above haven\'t been checked yet — re-check to validate them and see which rows turn green.'
                    : 'These corrections have been applied to the preview. They live here only: your spreadsheet is untouched, and nothing is saved until you press Import.'}
                </p>
                <Button
                  size="sm" color="primary" variant={editsDirty ? 'solid' : 'flat'}
                  isLoading={previewImport.isPending}
                  onPress={() => rerunPreview()}
                >
                  Apply corrections &amp; re-check
                </Button>
                <Button size="sm" variant="flat" isDisabled={previewImport.isPending} onPress={clearEdits}>
                  Discard corrections
                </Button>
              </div>
            )}

            {!result && (
              <div className="flex flex-wrap items-center gap-2">
                <Button size="sm" variant="flat" onPress={startOver}>Start over</Button>
                <Button
                  size="sm"
                  color="primary"
                  // Held while an unchecked correction exists: the ready count and the rows
                  // about to be committed are the ones the SERVER last validated, so
                  // importing now would silently drop what was just typed.
                  isDisabled={preview.summary.ready === 0 || editsDirty}
                  isLoading={commitImport.isPending}
                  onPress={handleCommit}
                >
                  Import {preview.summary.ready} ready row{preview.summary.ready === 1 ? '' : 's'}
                </Button>
                {editsDirty && (
                  <span className="text-xs text-gray-500">Re-check your corrections first.</span>
                )}
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
              {result.skipped > 0 && (
                <Chip size="sm" variant="flat">{result.skipped} already recorded, skipped</Chip>
              )}
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
