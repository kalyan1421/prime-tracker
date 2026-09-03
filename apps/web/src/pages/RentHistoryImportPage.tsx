import { useRef, useState } from 'react';
import { useParams, useNavigate, Link } from 'react-router-dom';
import { Card, CardBody, CardHeader, Button, Chip, Select, SelectItem, Input, addToast } from '@heroui/react';
import { ImportStepRail, FileDropZone } from '../components/ImportFlow';
import { FiArrowLeft, FiDownload, FiUpload, FiCheckCircle, FiAlertTriangle } from 'react-icons/fi';
import {
  useDownloadImportTemplate, usePreviewLeaseImport, useCommitLeaseImport,
  useAnalyzeGenericLeaseImport, usePreviewMappedLeaseImport,
  useBuildings, useCreateBuilding, useCustomOptions, useBrokers, useCreateBroker, useCreateUnit,
} from '../hooks/useApi';
import { errMsg, fmt, fmtDate } from '../utils/fmt';
import {
  looksLikeCombinedUnitRef, looksLikeWholeBuildingRef, looksLikeNonUnitRef,
  createSequentiallyRateLimited,
} from '../utils/import-helpers';
import { BUILDING_TYPES } from '../components/BuildingFormModal';
import { LeaseImportColumnMapper, type ColumnSelection } from '../components/LeaseImportColumnMapper';
import { HISTORICAL_REASONS } from '../components/TenancyBackfillFields';

/** In-progress values typed into one preview row. All strings — parsed on apply. */
type RowFix = {
  unitNumber?: string; building?: string; tenantName?: string;
  leaseStart?: string; leaseEnd?: string; terminationDate?: string;
  terminationReason?: string; monthlyRent?: string; brokerId?: string; newBrokerName?: string;
};

/** Sentinel for the Building picker's "no building" choice, since '' is how HeroUI
 * reports "nothing selected" — the two have to be told apart, because clearing a wrong
 * Building label IS the fix when a sheet writes "Centro Plaza - Building 2". */
const NO_BUILDING = '__none__';

/**
 * Which fields this row can be fixed by hand, derived from the errors it actually has.
 * Only what is broken is offered: a row missing Lease End gets a date box, not a form.
 *
 * Matched on the message text those checks emit (lease-import.service.ts). Both sides
 * need changing together — a reworded error silently stops offering its fix, which is
 * why each match is the distinctive fragment rather than the whole sentence.
 */
function fixableFields(errors: string[]): Set<keyof RowFix> {
  const f = new Set<keyof RowFix>();
  const has = (fragment: string) => errors.some((e) => e.includes(fragment));
  // A row can name the wrong unit, or the right unit under a building label that never
  // matched — both are pointing errors, fixed by re-pointing the row, not by creating
  // inventory. The "create the missing unit/building" panels below are unchanged and
  // remain the answer when the unit genuinely isn't in the project.
  if (has('Unit Number is required') || has('was not found in this project')
    || has('exists in more than one building')) f.add('unitNumber');
  if (has('exists in more than one building') || has('as this row states')) f.add('building');
  if (has('Tenant Name is required')) f.add('tenantName');
  if (has('Lease Start is required')) f.add('leaseStart');
  if (has('Lease End is required')) f.add('leaseEnd');
  if (has('Monthly Rent is required')) f.add('monthlyRent');
  if (has('Termination Reason')) { f.add('terminationReason'); f.add('terminationDate'); }
  if (has('Broker "') || has('no Broker Name was set')) f.add('brokerId');
  return f;
}

/**
 * The subset of correctable fields worth filling for EVERY row that needs them. A source
 * sheet that omits a column omits it for all 38 rows, and fixing that 38 times by hand is
 * the difference between a usable tool and a spreadsheet with extra steps. Each row stays
 * editable afterwards, so a value right for most rows and wrong for two is still worth
 * setting here.
 */
const BULK_FIELDS: { key: keyof RowFix; label: string; type: 'date' | 'number' | 'reason' | 'building' }[] = [
  { key: 'building', label: 'Building', type: 'building' },
  { key: 'leaseStart', label: 'Lease Start', type: 'date' },
  { key: 'leaseEnd', label: 'Lease End', type: 'date' },
  { key: 'monthlyRent', label: 'Monthly Rent', type: 'number' },
  { key: 'terminationReason', label: 'Why it ended', type: 'reason' },
  { key: 'terminationDate', label: 'Moved out', type: 'date' },
];

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

  // Missing-building/unit auto-create (R9.2 units; buildings added for parity with
  // SaleHistoryImportPage — a unit can't be created until its building exists).
  const buildings = useBuildings(projectId || '');
  const createBuilding = useCreateBuilding();
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

  // Per-missing-unit-number choices for the "create units" step, and per-missing-building
  // -name Type choice for the "create buildings" step that has to happen first.
  const [missingUnitDefaults, setMissingUnitDefaults] = useState<Record<string, { buildingId: string; unitType: string; sqft: string }>>({});
  const [creatingUnits, setCreatingUnits] = useState(false);
  const [missingBuildingTypes, setMissingBuildingTypes] = useState<Record<string, string>>({});
  const [creatingBuildings, setCreatingBuildings] = useState(false);


  // Per-row fixes, keyed by sheet row number. `rowOverrides` is what has been APPLIED and
  // is re-sent with every preview; `rowFixes` is the not-yet-applied form state. Two maps
  // rather than one because a re-check has to send the confirmed set, not half-typed
  // input. Covers the broker (R9.3) and, since 2026-08-25, any value the source file
  // simply never recorded — 11 rows of the client's own workbook have no Lease End.
  // rowOverrides is what's actually SENT and persists across reruns (e.g. after creating
  // missing units); rowFixes is the not-yet-applied in-progress input.
  const [rowOverrides, setRowOverrides] = useState<Record<number, Record<string, unknown>>>({});
  const [rowFixes, setRowFixes] = useState<Record<number, RowFix>>({});
  const [applyingRowFixes, setApplyingRowFixes] = useState(false);

  const handleFilePicked = async (file: File, overrideRows?: Record<number, Record<string, unknown>>) => {
    if (!projectId) return;
    setFileName(file.name);
    setResult(null);
    setTemplateFile(file);
    try {
      const data = await previewImport.mutateAsync({
        file, projectId, rowOverrides: overrideRows ?? rowOverrides,
      });
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

  const handleConfirmMapping = async (overrideRows?: Record<number, Record<string, unknown>>) => {
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
        rowOverrides: overrideRows ?? rowOverrides,
      });
      setPreview(data);
      // Persist so a LATER rerun (e.g. after creating missing units) keeps this fix.
      if (overrideRows) setRowOverrides(overrideRows);
    } catch (e) {
      addToast({ title: errMsg(e, 'Could not parse this file with the current mapping'), color: 'danger' });
    }
  };

  const hasPendingFixes = Object.values(rowFixes).some(
    (f) => Object.values(f).some((v) => typeof v === 'string' && v.trim()),
  );

  /** Staging values for the fill-every-row bar — they do nothing until applied. */
  const [bulkValues, setBulkValues] = useState<Record<string, string>>({});

  const blockedRows: any[] = preview ? preview.tenancies.filter((t: any) => t.status === 'error') : [];
  const rowsNeeding = (key: keyof RowFix) =>
    blockedRows.filter((t: any) => fixableFields(t.errors).has(key));
  const bulkFields = BULK_FIELDS.filter((f) => rowsNeeding(f.key).length >= 2);
  // Blocked by something no input here can fix — a combined "812, 814" reference, a unit
  // that has to be created first. Counted apart so the fixable tally stays honest.
  const unfixableCount = blockedRows.filter((t: any) => fixableFields(t.errors).size === 0).length;

  const fillAll = (key: keyof RowFix, value: string) => {
    const targets = rowsNeeding(key);
    setRowFixes((s) => {
      const next = { ...s };
      for (const t of targets) next[t.rowNumber] = { ...next[t.rowNumber], [key]: value };
      return next;
    });
  };

  /**
   * Applies every typed-in fix at once and re-checks the file.
   *
   * Newly-typed broker names become real brokers first (deduped within the batch, so
   * naming the same broker on four rows creates one). Everything else is passed straight
   * back to the server as a row override and re-validated there — nothing is committed
   * from what was typed here without going through the same checks as a parsed cell.
   */
  const handleApplyRowFixes = async () => {
    if (!hasPendingFixes) {
      addToast({ title: 'Fill in at least one field first', color: 'warning' });
      return;
    }
    setApplyingRowFixes(true);
    const next: Record<number, Record<string, unknown>> = { ...rowOverrides };
    const nameToId = new Map<string, string>();
    for (const [rowNumStr, fix] of Object.entries(rowFixes)) {
      const rowNum = Number(rowNumStr);
      const patch: Record<string, unknown> = { ...next[rowNum] };
      try {
        if (fix.newBrokerName?.trim()) {
          const key = fix.newBrokerName.trim().toLowerCase();
          let id = nameToId.get(key);
          if (!id) {
            const created = await createBroker.mutateAsync({ name: fix.newBrokerName.trim() });
            id = created.id as string;
            nameToId.set(key, id);
          }
          patch.brokerId = id;
        } else if (fix.brokerId) {
          patch.brokerId = fix.brokerId;
        }
        if (fix.unitNumber?.trim()) patch.unitNumber = fix.unitNumber.trim();
        // null, not '' — the server treats an explicit null as "clear this label" and an
        // absent key as "the sheet's value stands".
        if (fix.building) patch.building = fix.building === NO_BUILDING ? null : fix.building;
        if (fix.tenantName?.trim()) patch.tenantName = fix.tenantName.trim();
        if (fix.leaseStart) patch.leaseStart = fix.leaseStart;
        if (fix.leaseEnd) patch.leaseEnd = fix.leaseEnd;
        if (fix.terminationDate) patch.terminationDate = fix.terminationDate;
        if (fix.terminationReason) patch.terminationReason = fix.terminationReason;
        // Guard the parse: an unparseable figure must not silently become NaN and then
        // read server-side as "no rent given".
        if (fix.monthlyRent?.trim()) {
          const rent = Number(fix.monthlyRent);
          if (Number.isFinite(rent)) patch.monthlyRent = rent;
          else addToast({ title: `Row ${rowNum}: "${fix.monthlyRent}" is not a number`, color: 'danger' });
        }
        if (Object.keys(patch).length) next[rowNum] = patch;
      } catch (e) {
        addToast({ title: errMsg(e, `Could not apply the fix for row ${rowNum}`), color: 'danger' });
      }
    }
    setRowFixes({});
    setRowOverrides(next);
    if (mode === 'template' && templateFile) await handleFilePicked(templateFile, next);
    else await handleConfirmMapping(next);
    setApplyingRowFixes(false);
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

  // Rows the file carries for a DIFFERENT project (see otherProject) are skipped, not
  // broken — nothing about them is this project's to fix, so they stay out of every
  // "create this" and "fix that" list below.
  // When the sheet names projects at all, every row shows its own label — the only
  // safeguard left for a file whose labels matched no project (nothing got filtered).
  const hasProjectColumn = (preview?.projectLabels?.length ?? 0) > 0;
  const ourRows: any[] = preview ? preview.tenancies.filter((t: any) => !t.otherProject) : [];
  const otherProjectRows: any[] = preview ? preview.tenancies.filter((t: any) => t.otherProject) : [];

  // Whole-building rows, in full — a lease over an entire building has no unit to
  // resolve to, so it is shown in detail for manual entry rather than half-fixed here.
  const wholeBuildingRows: any[] = ourRows.filter((t: any) => looksLikeWholeBuildingRef(t.unitNumber));

  // Distinct unit numbers the preview couldn't resolve — offered as "create these units".
  const missingUnitNumbers: string[] = preview
    ? Array.from(new Set(
        ourRows
          .filter((t: any) => !t.data.unitId && t.errors.some((e: string) => e.includes('was not found in this project')))
          .map((t: any) => t.unitNumber)
          .filter(Boolean),
      ))
    : [];
  // Three kinds of Unit Number are never offered as a plain create, because each would
  // put a unit in the system that doesn't exist in the world: "700 and 701" (two units),
  // "Building 6 (whole)" (a building), "101 (prior)" / "Not recorded" (a marker or a
  // placeholder). Each gets its own explanation below instead.
  const combinedUnitNumbers = missingUnitNumbers.filter(looksLikeCombinedUnitRef);
  const wholeBuildingUnitNumbers = missingUnitNumbers.filter(looksLikeWholeBuildingRef);
  const nonUnitRefs = missingUnitNumbers.filter(looksLikeNonUnitRef);
  const creatableUnitNumbers = missingUnitNumbers.filter(
    (n) => !looksLikeCombinedUnitRef(n) && !looksLikeWholeBuildingRef(n) && !looksLikeNonUnitRef(n),
  );

  // Distinct Building labels those rows name that don't exist in this project yet
  // (case-insensitive) — offered first, since a missing unit's Building picker needs
  // somewhere to point once created. Same shape as SaleHistoryImportPage.
  const unresolvedRows = ourRows.filter(
    (t: any) => !t.data.unitId && t.errors.some((e: string) => e.includes('was not found in this project')),
  );
  const existingBuildingNames = new Set(((buildings.data as any[]) || []).map((b: any) => b.name.trim().toLowerCase()));
  const missingBuildingNames: string[] = Array.from(new Set(
    unresolvedRows
      .map((t: any) => (t.building || '').trim())
      .filter((b: string) => b && !existingBuildingNames.has(b.toLowerCase())),
  ));

  /** The project's building whose name matches what this row's Building cell said, if any. */
  const buildingForUnit = (num: string) => {
    const row = unresolvedRows.find((t: any) => t.unitNumber === num);
    if (!row) return null;
    return ((buildings.data as any[]) || [])
      .find((b: any) => b.name.trim().toLowerCase() === (row.building || '').trim().toLowerCase()) ?? null;
  };

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
        const sheetSqft = preview.tenancies.find((t: any) => t.unitNumber === num)?.sqft;
        const fallback = {
          buildingId: buildingForUnit(num)?.id ?? '',
          unitType: '',
          sqft: sheetSqft ? String(sheetSqft) : '',
        };
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
    // as resolved once we re-preview. Rate-limited: a real batch can exceed the API's
    // 10 req/s short-burst throttle, and a plain sequential loop starts 429ing partway
    // through — see createSequentiallyRateLimited.
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
    setMissingBuildingTypes({});
    setRowOverrides({});
    setBulkValues({});
    setRowFixes({});
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  /**
   * Which rung of the current mode's flow we are on — see ImportStepRail. The two modes
   * have different middle steps, so this is read against whichever labels are rendered.
   */
  const templateStep: number = result || preview
    ? 3
    : mode === 'generic'
      ? (analyzeResult ? 2 : 1)
      : (fileName ? 2 : 1);

  return (
    <div className="space-y-5 max-w-3xl mx-auto pb-6">
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

      {/* One rail per mode: the two paths genuinely have different steps — the template
          path has a download first, the generic path has a column-mapping stage instead. */}
      <ImportStepRail
        current={templateStep}
        labels={mode === 'template'
          ? ['Get the template', 'Upload the file', 'Review & import']
          : ['Upload the spreadsheet', 'Map the columns', 'Review & import']}
      />

      {mode === 'template' ? (
        <>
          <Card shadow="none" className="border border-gray-200">
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
        </>
      ) : (
        <>
          <Card shadow="none" className="border border-gray-200">
            <CardHeader className="flex flex-col items-start gap-1 pb-2">
              <p className="font-semibold text-sm text-gray-800">1. Upload the client's spreadsheet as-is</p>
              <p className="text-xs text-gray-500">
                Any column layout — we'll guess which column is which and let you correct it
                before anything is checked or saved.
              </p>
            </CardHeader>
            <CardBody className="pt-0">
              <FileDropZone
                inputRef={fileInputRef}
                onFile={handleGenericFilePicked}
                fileName={fileName}
                isLoading={analyzeGeneric.isPending}
                hint="We read the columns first and ask you to confirm them"
              />
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
                    <span className="text-xs text-gray-500">or</span>
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
              {preview.summary.duplicates > 0 && (
                <Chip size="sm" variant="flat" title="Already in the system from an earlier run of this import — skipped, not re-imported">
                  {preview.summary.duplicates} already imported
                </Chip>
              )}
              {preview.summary.skippedOtherProject > 0 && (
                <Chip size="sm" variant="flat" title="Rows this file carries for other projects — upload it from those projects to bring them in">
                  {preview.summary.skippedOtherProject} for other projects
                </Chip>
              )}
              {preview.orphaned.length > 0 && (
                <Chip size="sm" color="warning" variant="flat">{preview.orphaned.length} unmatched exception/commission row(s)</Chip>
              )}
            </div>
          </CardHeader>
          <CardBody className="space-y-4">
            {blockedRows.length > 0 && (
              <div className="rounded-lg border border-gray-200 bg-gray-50 p-3 space-y-3">
                {/* Says plainly what is holding the import back, instead of leaving it to
                    be counted off a column of identical red sentences. */}
                <p className="text-xs text-gray-700">
                  <span className="font-semibold">
                    {blockedRows.length} row{blockedRows.length === 1 ? '' : 's'} still blocked:
                  </span>{' '}
                  {[
                    ...BULK_FIELDS
                      .filter((f) => rowsNeeding(f.key).length > 0)
                      .map((f) => `${rowsNeeding(f.key).length} ${rowsNeeding(f.key).length === 1 ? 'needs' : 'need'} a ${f.label}`),
                    ...(rowsNeeding('brokerId').length > 0 ? [`${rowsNeeding('brokerId').length} need a Broker`] : []),
                    ...(unfixableCount > 0
                      ? [`${unfixableCount} can't be fixed here — see the notes below the table`] : []),
                  ].join(' · ')}
                </p>
                {bulkFields.length > 0 && (
                  <>
                    <p className="text-xs text-gray-500">
                      Fill one in for every row that's missing it — each row stays editable afterwards.
                    </p>
                    <div className="flex flex-wrap items-end gap-2">
                      {bulkFields.map((f) => (
                        <div key={f.key} className="flex items-end gap-1.5">
                          {f.type === 'reason' ? (
                            <Select
                              size="sm" label={f.label} className="max-w-[190px]"
                              selectedKeys={bulkValues[f.key] ? [bulkValues[f.key]] : []}
                              onSelectionChange={(keys) => setBulkValues((b) => ({ ...b, [f.key]: (Array.from(keys)[0] as string) || '' }))}
                            >
                              {HISTORICAL_REASONS.map((r) => (
                                <SelectItem key={r.key} textValue={r.label}>{r.label}</SelectItem>
                              ))}
                            </Select>
                          ) : f.type === 'building' ? (
                            <Select
                              size="sm" label={f.label} className="max-w-[190px]"
                              selectedKeys={bulkValues[f.key] ? [bulkValues[f.key]] : []}
                              onSelectionChange={(keys) => setBulkValues((b) => ({ ...b, [f.key]: (Array.from(keys)[0] as string) || '' }))}
                            >
                              {[
                                <SelectItem key={NO_BUILDING} textValue="No building — match by unit number">
                                  No building — match by unit number
                                </SelectItem>,
                                ...((buildings.data as any[]) || []).map((b: any) => (
                                  <SelectItem key={b.name} textValue={b.name}>{b.name}</SelectItem>
                                )),
                              ]}
                            </Select>
                          ) : (
                            <Input
                              size="sm" label={f.label} className={f.type === 'date' ? 'max-w-[160px]' : 'max-w-[140px]'}
                              type={f.type === 'date' ? 'date' : 'number'}
                              value={bulkValues[f.key] ?? ''}
                              onChange={(e) => setBulkValues((b) => ({ ...b, [f.key]: e.target.value }))}
                            />
                          )}
                          <Button
                            size="sm" variant="flat"
                            isDisabled={!bulkValues[f.key]}
                            onPress={() => fillAll(f.key, bulkValues[f.key])}
                          >
                            Apply to {rowsNeeding(f.key).length}
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
                    {hasProjectColumn && <th className="px-2 py-1.5 font-semibold">Project</th>}
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
                      <td className="px-2 py-1.5 text-gray-500 tabular-nums">{t.rowNumber}</td>
                      {hasProjectColumn && (
                        <td className={`px-2 py-1.5 whitespace-nowrap ${t.otherProject ? 'text-rose-700' : 'text-gray-500'}`}>
                          {t.sheetProject || '—'}
                        </td>
                      )}
                      <td className="px-2 py-1.5">{t.unitNumber || '—'}</td>
                      <td className="px-2 py-1.5">{t.tenantName || '—'}</td>
                      <td className="px-2 py-1.5 text-gray-500 whitespace-nowrap">
                        {t.data.leaseStart ? fmtDate(t.data.leaseStart) : '—'} –{' '}
                        {t.data.terminationDate ? fmtDate(t.data.terminationDate) : (t.willBeActive ? 'ongoing' : '—')}
                      </td>
                      <td className="px-2 py-1.5 tabular-nums">
                        {t.data.monthlyRent != null ? fmt(t.data.monthlyRent) : '—'}
                        {t.rentSplitBasis === 'sqft' && (
                          <span className="ml-1 text-[11px] text-teal-700" title="Split proportionally by sqft from a Combined Deal total">
                            (split)
                          </span>
                        )}
                        {t.rentSplitBasis === 'even' && (
                          <span className="ml-1 text-[11px] text-amber-700" title="No per-unit Sqft in the sheet — the deal total was divided equally across its units. Add Sqft to split it properly.">
                            (even split)
                          </span>
                        )}
                      </td>
                      <td className="px-2 py-1.5">
                        {t.warnings?.length > 0 && (
                          <div className="mb-1 space-y-0.5">
                            {t.warnings.map((w: string, i: number) => (
                              <div key={i} className="inline-flex items-start gap-1 text-amber-700">
                                <FiAlertTriangle className="w-3.5 h-3.5 mt-0.5 shrink-0" />
                                <span>{w}</span>
                              </div>
                            ))}
                          </div>
                        )}
                        {t.status === 'duplicate' ? (
                          <span className="inline-flex items-center gap-1 text-gray-500" title="This tenancy is already on this unit with the same start date — skipped, not imported again">
                            <FiCheckCircle className="w-3.5 h-3.5" /> Already imported
                          </span>
                        ) : t.status === 'ready' ? (
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
                              {(() => {
                                // Only what THIS row is missing is offered — the source
                                // files genuinely never recorded some of these, so the
                                // value has to be enterable here rather than in Excel.
                                const fields = fixableFields(t.errors);
                                if (fields.size === 0) return null;
                                const fix = rowFixes[t.rowNumber] ?? {};
                                const set = (patch: Partial<RowFix>) =>
                                  setRowFixes((s) => ({ ...s, [t.rowNumber]: { ...s[t.rowNumber], ...patch } }));
                                return (
                                  <div className="flex flex-wrap items-end gap-1.5 pt-1">
                                    {fields.has('unitNumber') && (
                                      <Input
                                        size="sm" label="Unit Number" className="max-w-[130px]"
                                        placeholder={t.unitNumber || undefined}
                                        value={fix.unitNumber ?? ''} onChange={(e) => set({ unitNumber: e.target.value })}
                                      />
                                    )}
                                    {fields.has('building') && (
                                      <Select
                                        size="sm" label="Building" className="max-w-[170px]"
                                        selectedKeys={fix.building ? [fix.building] : []}
                                        onSelectionChange={(keys) => set({ building: (Array.from(keys)[0] as string) || '' })}
                                      >
                                        {[
                                          <SelectItem key={NO_BUILDING} textValue="No building — match by unit number">
                                            No building — match by unit number
                                          </SelectItem>,
                                          ...((buildings.data as any[]) || []).map((b: any) => (
                                            <SelectItem key={b.name} textValue={b.name}>{b.name}</SelectItem>
                                          )),
                                        ]}
                                      </Select>
                                    )}
                                    {fields.has('tenantName') && (
                                      <Input
                                        size="sm" label="Tenant Name" className="max-w-[170px]"
                                        value={fix.tenantName ?? ''} onChange={(e) => set({ tenantName: e.target.value })}
                                      />
                                    )}
                                    {fields.has('leaseStart') && (
                                      <Input
                                        size="sm" type="date" label="Lease Start" className="max-w-[150px]"
                                        value={fix.leaseStart ?? ''} onChange={(e) => set({ leaseStart: e.target.value })}
                                      />
                                    )}
                                    {fields.has('leaseEnd') && (
                                      <Input
                                        size="sm" type="date" label="Lease End" className="max-w-[150px]"
                                        value={fix.leaseEnd ?? ''} onChange={(e) => set({ leaseEnd: e.target.value })}
                                      />
                                    )}
                                    {fields.has('monthlyRent') && (
                                      <Input
                                        size="sm" type="number" label="Monthly Rent" className="max-w-[130px]"
                                        value={fix.monthlyRent ?? ''} onChange={(e) => set({ monthlyRent: e.target.value })}
                                      />
                                    )}
                                    {fields.has('terminationReason') && (
                                      <>
                                        <Select
                                          size="sm" label="Why it ended" className="max-w-[190px]"
                                          selectedKeys={fix.terminationReason ? [fix.terminationReason] : []}
                                          onSelectionChange={(keys) => set({ terminationReason: (Array.from(keys)[0] as string) || '' })}
                                        >
                                          {HISTORICAL_REASONS.map((r) => (
                                            <SelectItem key={r.key} textValue={r.label}>{r.label}</SelectItem>
                                          ))}
                                        </Select>
                                        {/* The sheet often gives a reason but no date, which would
                                            otherwise import as a tenancy that never ended. */}
                                        <Input
                                          size="sm" type="date" label="Moved out" className="max-w-[150px]"
                                          value={fix.terminationDate ?? ''} onChange={(e) => set({ terminationDate: e.target.value })}
                                        />
                                      </>
                                    )}
                                    {fields.has('brokerId') && (
                                      <>
                                        <Select
                                          size="sm" label="Broker" className="max-w-[160px]"
                                          isDisabled={!!fix.newBrokerName?.trim()}
                                          selectedKeys={fix.brokerId ? [fix.brokerId] : []}
                                          onSelectionChange={(keys) => set({ brokerId: (Array.from(keys)[0] as string) || '' })}
                                        >
                                          {((brokers.data as any[]) || []).map((b: any) => (
                                            <SelectItem key={b.id} textValue={b.name}>{b.name}</SelectItem>
                                          ))}
                                        </Select>
                                        <span className="text-[11px] text-gray-500 pb-1.5">or</span>
                                        <Input
                                          size="sm" label="New broker" className="max-w-[140px]"
                                          isDisabled={!!fix.brokerId}
                                          value={fix.newBrokerName ?? ''} onChange={(e) => set({ newBrokerName: e.target.value })}
                                        />
                                      </>
                                    )}
                                  </div>
                                );
                              })()}
                            </span>
                          </span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {(hasPendingFixes || Object.keys(rowOverrides).length > 0) && (
              <div className="flex items-center justify-end gap-3">
                {Object.keys(rowOverrides).length > 0 && (
                  <span className="text-[11px] text-gray-500">
                    {Object.keys(rowOverrides).length} row{Object.keys(rowOverrides).length === 1 ? '' : 's'} fixed by
                    hand — re-sent on every re-check, and validated like any other value
                  </span>
                )}
                <Button size="sm" color="primary" isDisabled={!hasPendingFixes} isLoading={applyingRowFixes} onPress={handleApplyRowFixes}>
                  Apply fixes &amp; re-check
                </Button>
              </div>
            )}

            {(preview.projectLabels?.length ?? 0) > 1 && (
              <div
                className={`rounded-lg border p-3 ${preview.matchedProjectLabel
                  ? 'border-gray-200 bg-gray-50' : 'border-amber-300 bg-amber-50'}`}
              >
                {preview.matchedProjectLabel ? (
                  <p className="text-xs text-gray-600">
                    This file's Project column covers {preview.projectLabels.length} projects. Only its{' '}
                    <span className="font-semibold text-gray-800">"{preview.matchedProjectLabel}"</span> rows are
                    being added here; {otherProjectRows.length} row{otherProjectRows.length === 1 ? '' : 's'} for{' '}
                    {(preview.projectLabels as string[]).filter((l) => l !== preview.matchedProjectLabel).join(', ')}{' '}
                    {otherProjectRows.length === 1 ? 'was' : 'were'} skipped. Upload the same file from each of
                    those projects' Revenue tabs to bring them in.
                  </p>
                ) : (
                  <p className="text-xs text-amber-900">
                    <span className="font-semibold">Check this preview carefully.</span> The file's Project
                    column names {preview.projectLabels.length} projects
                    ({(preview.projectLabels as string[]).join(', ')}), and none of them matches this project's
                    name — so nothing could be filtered out automatically. Unit numbers repeat across projects,
                    so a row from another project can resolve against a same-numbered unit here.
                  </p>
                )}
              </div>
            )}

            {wholeBuildingRows.length > 0 && (
              <div className="rounded-lg border border-amber-300 bg-amber-50 p-3 space-y-2">
                <p className="text-xs font-semibold text-amber-900">
                  {wholeBuildingRows.length} row{wholeBuildingRows.length === 1 ? '' : 's'} lease a WHOLE BUILDING,
                  not a unit — nothing below is imported. A whole-building lease attaches to the Building itself,
                  and this importer only ever resolves to a Unit. Here is everything the sheet says about{' '}
                  {wholeBuildingRows.length === 1 ? 'it' : 'them'}, so you can add{' '}
                  {wholeBuildingRows.length === 1 ? 'it' : 'them'} by hand from Revenue → Add Lease against the
                  building:
                </p>
                <div className="overflow-x-auto rounded-lg border border-amber-200 bg-white">
                  <table className="min-w-full text-xs">
                    <thead className="bg-amber-50 text-amber-900">
                      <tr>
                        {['Row', 'Building', 'Tenant', 'Sqft', 'Lease Start', 'Lease End', 'Monthly Rent', 'Deposit']
                          .map((h) => <th key={h} className="px-2 py-1.5 text-left font-semibold whitespace-nowrap">{h}</th>)}
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-amber-100">
                      {wholeBuildingRows.map((t: any) => (
                        <tr key={t.rowNumber}>
                          <td className="px-2 py-1.5 text-gray-500">{t.rowNumber}</td>
                          <td className="px-2 py-1.5 font-medium text-gray-800 whitespace-nowrap">
                            {t.building || t.unitNumber}
                          </td>
                          <td className="px-2 py-1.5 text-gray-700">{t.tenantName}</td>
                          <td className="px-2 py-1.5 text-gray-600">{t.sqft ? t.sqft.toLocaleString() : '—'}</td>
                          <td className="px-2 py-1.5 text-gray-600 whitespace-nowrap">{fmtDate(t.data.leaseStart) || '—'}</td>
                          <td className="px-2 py-1.5 text-gray-600 whitespace-nowrap">{fmtDate(t.data.leaseEnd) || '—'}</td>
                          <td className="px-2 py-1.5 text-gray-800 whitespace-nowrap">
                            {t.data.monthlyRent != null ? fmt(t.data.monthlyRent) : '—'}
                          </td>
                          <td className="px-2 py-1.5 text-gray-600 whitespace-nowrap">
                            {t.data.securityDeposit != null ? fmt(t.data.securityDeposit) : '—'}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                {wholeBuildingRows.some((t: any) => t.data.notes) && (
                  <ul className="text-[11px] text-amber-800 space-y-1">
                    {wholeBuildingRows.filter((t: any) => t.data.notes).map((t: any) => (
                      <li key={t.rowNumber}>
                        <span className="font-medium">Row {t.rowNumber} ({t.building || t.unitNumber}) notes:</span>{' '}
                        {t.data.notes}
                      </li>
                    ))}
                  </ul>
                )}
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
                      <span className="font-medium">"{num}"</span> — a "(prior)" suffix marks an earlier tenancy
                      of a unit that already exists, and a placeholder means the source never recorded one.
                      Either way, creating a unit by this name would split that unit's history across two
                      records. Point the row at the real Unit Number in the sheet, then re-check.
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
                  {creatableUnitNumbers.length === 1 ? "doesn't" : "don't"} exist in this project yet. The
                  Building is pre-filled from the sheet wherever it already matches one — pick a Type for the
                  ones you want created. This is a real, separate write, done before anything about the leases
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
                    // The sheet's own Sqft (when mapped) pre-fills this instead of asking
                    // the user to type in something the file already told us.
                    const sheetSqft = preview.tenancies.find((t: any) => t.unitNumber === num)?.sqft;
                    const choice = missingUnitDefaults[num] ?? {
                      buildingId: buildingForUnit(num)?.id ?? '',
                      unitType: '',
                      sqft: sheetSqft ? String(sheetSqft) : '',
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
