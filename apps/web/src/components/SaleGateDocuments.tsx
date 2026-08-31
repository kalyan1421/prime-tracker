/**
 * Upload the documents a sale's next stage is gated on, from inside the sale itself.
 *
 * The gate refusal reads "upload them to the sale's documents, then move the stage" — and
 * until now there was no such place. `document.saleId` is what
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
 * Each row is one required category, so the file lands with the right category without
 * anybody choosing it from a list of fourteen. The server files it against the sale's unit
 * and project too — see DocumentsService.create.
 */

import { useRef, useState } from 'react';
import { Button, Chip, addToast } from '@heroui/react';
import { FiCheckCircle, FiUpload, FiExternalLink } from 'react-icons/fi';
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

export function SaleGateDocuments({ saleId, currentStatus, targetStatus }: {
  /** Absent while the sale is still being created — documents attach to a sale that exists. */
  saleId?: string;
  currentStatus: string;
  targetStatus: string;
}) {
  const { hasPermission } = useAuthStore();
  const canUpload = hasPermission('document:upload');
  const required = docsRequiredForMove(currentStatus, targetStatus);

  const { data, isLoading } = useDocuments({ saleId });
  const docs: any[] = Array.isArray(data) ? data : [];
  const upload = useUploadDocument();
  const inputRef = useRef<HTMLInputElement>(null);
  const [pending, setPending] = useState<string | null>(null);

  if (required.length === 0) return null;

  // A sale that does not exist yet has nothing to attach to. Say so plainly rather than
  // offering an upload that cannot work.
  if (!saleId) {
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
      missing.length === 0 ? 'border-emerald-200 bg-emerald-50/60' : 'border-amber-200 bg-amber-50/60'
    }`}>
      <div className="flex items-center justify-between gap-2 mb-2">
        <p className="text-xs font-semibold text-gray-800">
          Paperwork for {targetStatus.replace(/_/g, ' ').toLowerCase()}
        </p>
        <Chip size="sm" variant="flat" color={missing.length === 0 ? 'success' : 'warning'}>
          {required.length - missing.length} of {required.length}
        </Chip>
      </div>

      <input
        ref={inputRef}
        type="file"
        className="hidden"
        onChange={(e) => onFile(e.target.files?.[0])}
      />

      <div className="space-y-1">
        {required.map((category) => {
          const doc = docs.find((d) => d.category === category);
          return (
            <div key={category} className="flex items-center gap-2 text-xs">
              {doc ? (
                <FiCheckCircle className="w-3.5 h-3.5 shrink-0 text-emerald-600" />
              ) : (
                <span className="w-3.5 h-3.5 shrink-0 rounded-full border border-amber-400" />
              )}
              <span className={doc ? 'text-gray-700' : 'text-gray-800 font-medium'}>
                {CATEGORY_LABEL[category] ?? category}
              </span>
              {doc ? (
                <a
                  href={doc.fileUrl} target="_blank" rel="noreferrer"
                  className="ml-auto inline-flex items-center gap-1 text-blue-600 hover:text-blue-700 truncate max-w-[45%]"
                >
                  <span className="truncate">{doc.fileName}</span>
                  <FiExternalLink className="w-3 h-3 shrink-0" />
                </a>
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
          : missing.length === 0
            ? 'All on file — this sale can move stage.'
            : 'Filed against this sale and its unit, so it shows on both.'}
      </p>
    </div>
  );
}
