/**
 * The sale's paperwork, uploaded from inside the sale itself.
 *
 * The gate refusal reads "upload them to the sale's documents, then move the stage" — and
 * until this existed there was no such place. `document.saleId` is what
 * SalesService.assertStageDocumentsAttached counts, and nothing in the app could write that
 * column: the upload DTO had no saleId and the service never set one. So the CLOSED gate
 * was unsatisfiable through the UI. Sales could read exactly why a deal would not close and
 * had no way to act on it.
 *
 * It lives in the edit dialog rather than in the project's Documents tab because that is
 * where the refusal is read. Being told what is missing and having to go somewhere else,
 * find the same sale again, and get the category right is how a Deed ends up filed against
 * the project with no link to the deal it belongs to.
 *
 * EVERY sale document is listed and uploadable here, not only the ones the pending stage
 * move happens to owe (changed 2026-09-02). The panel used to render the required subset
 * and nothing else, so a Deed that arrived early had nowhere to go until somebody set the
 * status dropdown to Closed — paperwork does not arrive in pipeline order. The required
 * ones are marked as such and are still what the counter counts; the rest are simply
 * available.
 *
 * Each row is one category, so the file lands with the right category without anybody
 * choosing it from a list of fourteen. The server files it against the sale's unit and
 * project too — see DocumentsService.create — which is what puts it on the unit page.
 */

import { useRef, useState } from 'react';
import { Button, Chip, addToast } from '@heroui/react';
import { FiCheckCircle, FiUpload, FiExternalLink, FiRefreshCw } from 'react-icons/fi';
import { useDocuments, useUploadDocument } from '../hooks/useApi';
import { useAuthStore } from '../store/authStore';
import { errMsg } from '../utils/fmt';
import { SALE_STAGE_DOCS } from './DocumentGateChip';

const CATEGORY_LABEL: Record<string, string> = {
  LOI: 'LOI',
  BOOKING_AGREEMENT: 'Booking Agreement',
  DEED: 'Deed',
  NOC: 'NOC',
  POSSESSION_CERTIFICATE: 'Possession Certificate',
};

/** Same forward pipeline the server gates on, so the two agree on what a stage owes. */
const STAGE_ORDER = ['PROSPECT', 'LOI_SIGNED', 'UNDER_CONTRACT', 'CLOSED'];

/**
 * Every document a sale can carry, in pipeline order. Derived from the same map the gate
 * mirrors rather than typed out again, so adding a category to a stage adds an upload row
 * here with no second edit.
 */
export const SALE_PAPERWORK_CATEGORIES: string[] = STAGE_ORDER
  .flatMap((stage) => SALE_STAGE_DOCS[stage] ?? [])
  .filter((c, i, all) => all.indexOf(c) === i);

/**
 * Cumulative over the rungs crossed, mirroring requiredDocsForTransition. Skipping a stage
 * must not buy a discount on its paperwork, so Prospect → Closed owes all five; moving one
 * rung at a time owes only that rung's.
 */
export function docsRequiredForMove(from: string, to: string): string[] {
  const toIdx = STAGE_ORDER.indexOf(to);
  if (toIdx < 0) return [];
  const fromIdx = STAGE_ORDER.indexOf(from);
  if (toIdx <= fromIdx) return [];
  const out: string[] = [];
  for (let i = fromIdx + 1; i <= toIdx; i++) {
    for (const c of SALE_STAGE_DOCS[STAGE_ORDER[i]] ?? []) if (!out.includes(c)) out.push(c);
  }
  return out;
}

export function SaleGateDocuments({ saleId, currentStatus = '', targetStatus = '' }: {
  /** Absent while the sale is still being created — documents attach to a sale that exists. */
  saleId?: string;
  /**
   * The move being contemplated, if any. Used only to mark which rows are REQUIRED and to
   * word the header — omit both and the panel is a plain paperwork list.
   */
  currentStatus?: string;
  targetStatus?: string;
}) {
  const { hasPermission } = useAuthStore();
  const canUpload = hasPermission('document:upload');
  const required = docsRequiredForMove(currentStatus, targetStatus);
  const moving = required.length > 0;

  const { data, isLoading } = useDocuments({ saleId });
  const docs: any[] = Array.isArray(data) ? data : [];
  const upload = useUploadDocument();
  const inputRef = useRef<HTMLInputElement>(null);
  const [pending, setPending] = useState<string | null>(null);

  // A sale that does not exist yet has nothing to attach to. Say so plainly rather than
  // offering an upload that cannot work — and only when a move actually needs something,
  // since otherwise there is no news to deliver.
  if (!saleId) {
    if (!moving) return null;
    return (
      <div className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2.5">
        <p className="text-xs text-amber-800">
          Moving straight to {targetStatus.replace(/_/g, ' ').toLowerCase()} needs{' '}
          {required.map((c) => CATEGORY_LABEL[c] ?? c).join(', ')} on file. Save the sale
          first — documents attach to a sale that exists — then upload them here.
        </p>
      </div>
    );
  }

  const have = new Set(docs.map((d) => d.category));
  const missing = required.filter((c) => !have.has(c));
  // The counter tracks the pending move when there is one, and the whole file otherwise.
  const counted = moving ? required : SALE_PAPERWORK_CATEGORIES;
  const countedHave = counted.filter((c) => have.has(c));
  const none = countedHave.length === 0;

  const pick = (category: string) => {
    setPending(category);
    inputRef.current?.click();
  };

  const onFile = async (file: File | undefined) => {
    const category = pending;
    setPending(null);
    if (inputRef.current) inputRef.current.value = '';
    if (!file || !category) return;
    const fd = new FormData();
    fd.append('file', file);
    fd.append('saleId', saleId);
    fd.append('category', category);
    try {
      await upload.mutateAsync(fd);
      addToast({ title: `${CATEGORY_LABEL[category] ?? category} attached`, color: 'success' });
    } catch (e) {
      addToast({ title: errMsg(e, 'Could not attach the document'), color: 'danger' });
    }
  };

  return (
    <div className={`rounded-lg border px-3 py-2.5 ${
      moving && missing.length > 0 ? 'border-amber-200 bg-amber-50/60' : 'border-gray-200 bg-gray-50/60'
    }`}>
      <div className="flex items-center justify-between gap-2 mb-2">
        <p className="text-xs font-semibold text-gray-800">
          {moving
            ? `Paperwork for ${targetStatus.replace(/_/g, ' ').toLowerCase()}`
            : 'Sale paperwork'}
        </p>
        <Chip
          size="sm"
          variant="flat"
          color={none ? 'default' : countedHave.length === counted.length ? 'success' : 'warning'}
        >
          {none && !isLoading ? 'No documents uploaded' : `${countedHave.length} of ${counted.length}`}
        </Chip>
      </div>

      <input
        ref={inputRef}
        type="file"
        className="hidden"
        onChange={(e) => onFile(e.target.files?.[0])}
      />

      <div className="space-y-1">
        {SALE_PAPERWORK_CATEGORIES.map((category) => {
          const doc = docs.find((d) => d.category === category);
          const isRequired = required.includes(category);
          return (
            <div key={category} className="flex items-center gap-2 text-xs">
              {doc ? (
                <FiCheckCircle className="w-3.5 h-3.5 shrink-0 text-emerald-600" />
              ) : (
                <span className={`w-3.5 h-3.5 shrink-0 rounded-full border ${
                  isRequired ? 'border-amber-400' : 'border-gray-300'
                }`} />
              )}
              <span className={doc || !isRequired ? 'text-gray-700' : 'text-gray-800 font-medium'}>
                {CATEGORY_LABEL[category] ?? category}
              </span>
              {isRequired && !doc && (
                <span className="text-[11px] font-medium uppercase tracking-wide text-amber-700">
                  Required
                </span>
              )}
              {doc ? (
                <span className="ml-auto flex items-center gap-1.5 min-w-0">
                  <a
                    href={doc.fileUrl} target="_blank" rel="noreferrer"
                    className="inline-flex items-center gap-1 text-blue-600 hover:text-blue-700 truncate max-w-[180px]"
                  >
                    <span className="truncate">{doc.fileName}</span>
                    <FiExternalLink className="w-3 h-3 shrink-0" />
                  </a>
                  {canUpload && (
                    <button
                      type="button"
                      onClick={() => pick(category)}
                      className="shrink-0 text-gray-500 hover:text-blue-600 p-0.5 rounded"
                      title={`Upload another ${CATEGORY_LABEL[category] ?? category}`}
                      aria-label={`Upload another ${CATEGORY_LABEL[category] ?? category}`}
                    >
                      <FiRefreshCw className="w-3 h-3" />
                    </button>
                  )}
                </span>
              ) : canUpload ? (
                <Button
                  size="sm" variant="flat" className="ml-auto h-6 min-w-0 px-2"
                  startContent={<FiUpload className="w-3 h-3" />}
                  isLoading={upload.isPending && pending === category}
                  onPress={() => pick(category)}
                >
                  Upload
                </Button>
              ) : (
                <span className="ml-auto text-gray-500">Not attached</span>
              )}
            </div>
          );
        })}
      </div>

      <p className="mt-2 text-[11px] text-gray-500">
        {isLoading
          ? 'Checking what is on file…'
          : moving && missing.length === 0
            ? 'All on file — this sale can move stage.'
            : 'Filed against this sale and its unit, so it shows on both.'}
      </p>
    </div>
  );
}
