/**
 * The paperwork that came in on one lead — the brochure that was sent, the LOI draft that
 * came back, the ID proof collected at a site visit.
 *
 * `Document.leadId` existed as a column and was reachable from nowhere: not the upload
 * DTO, not DocumentsService.create, not the list endpoint, not any screen. A lead's
 * paperwork had to be filed against the project with nothing tying it to the enquiry it
 * arrived on, which is the same failure the sale anchor had before 2026-08-14.
 *
 * Shared by both places a lead is read — the cross-project Leads page and the project's
 * own Leads tab — rather than written twice, because two copies drift and the second one
 * is always the one missing the delete button.
 *
 * A lead document is filed against the lead's PROJECT too, but deliberately NOT against
 * its unit: a unit carries many enquiries and most never convert, so copying every
 * prospect's brochure onto the unit would bury the deed under paperwork for deals that
 * never happened. See DocumentsService.create.
 */

import { useRef, useState } from 'react';
import { Button, Select, SelectItem, Chip, addToast } from '@heroui/react';
import { FiFileText, FiUpload, FiTrash2, FiExternalLink } from 'react-icons/fi';
import { useDocuments, useUploadDocument, useDeleteDocument } from '../hooks/useApi';
import { useAuthStore } from '../store/authStore';
import { errMsg, fmtDate } from '../utils/fmt';

/**
 * Every value here is a real `DocCategory`. The unit panel's list carried two that were
 * not — LEASE_DOCS and OTHER — and picking either 400'd the upload, so the list is worth
 * checking against the enum rather than written from memory.
 */
const LEAD_DOC_CATEGORIES = [
  'BROCHURE', 'LOI', 'GENERAL', 'FINANCIAL', 'LEGAL', 'CONTRACT', 'RECEIPT', 'PHOTO',
] as const;

export function LeadDocumentsPanel({ leadId }: { leadId: string }) {
  const { hasPermission } = useAuthStore();
  // Both from `document:upload`, because that is what the server actually gates DELETE
  // /documents/:id on — there is no `document:delete` permission. Asking for one would
  // hide the button from everybody, which is the same class of bug as a query that never
  // runs: a control that can never appear.
  const canUpload = hasPermission('document:upload');
  const canDelete = canUpload;

  const { data, isLoading } = useDocuments({ leadId });
  const docs: any[] = Array.isArray(data) ? data : [];
  const upload = useUploadDocument();
  const removeDoc = useDeleteDocument();

  const fileRef = useRef<HTMLInputElement>(null);
  const [category, setCategory] = useState<string>('BROCHURE');

  const onFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = ''; // so the same file can be re-picked after a failure
    if (!file) return;
    const fd = new FormData();
    fd.append('file', file);
    fd.append('leadId', leadId);
    fd.append('category', category);
    try {
      await upload.mutateAsync(fd);
      addToast({ title: `Uploaded ${file.name}`, color: 'success' });
    } catch (err) {
      addToast({ title: errMsg(err, 'Upload failed'), color: 'danger' });
    }
  };

  const onDelete = async (id: string, name: string) => {
    if (!confirm(`Delete "${name}"?`)) return;
    try {
      await removeDoc.mutateAsync(id);
      addToast({ title: 'Document deleted', color: 'success' });
    } catch (err) {
      addToast({ title: errMsg(err, 'Delete failed'), color: 'danger' });
    }
  };

  return (
    <div className="border-t border-gray-100 pt-3 mt-3">
      <div className="flex flex-wrap items-center justify-between gap-2 mb-2">
        <div className="flex items-center gap-1.5">
          <FiFileText className="w-3.5 h-3.5 text-violet-600" />
          <p className="text-sm font-semibold text-gray-700">Documents</p>
          {!isLoading && docs.length === 0 && (
            <Chip size="sm" variant="flat" color="warning" className="text-[11px]">
              None uploaded
            </Chip>
          )}
          {docs.length > 0 && (
            <span className="text-xs text-gray-500 tabular-nums">{docs.length}</span>
          )}
        </div>
        {canUpload && (
          <div className="flex items-center gap-1.5">
            {/* Category is chosen BEFORE the file picker opens, because the picker is a
                native dialog — there is no moment after it closes to ask. Same reason
                BuildingDetailPage orders it this way. */}
            <Select
              aria-label="Document category"
              size="sm"
              className="w-[135px]"
              selectedKeys={[category]}
              onSelectionChange={(k) => {
                const v = Array.from(k)[0] as string;
                if (v) setCategory(v);
              }}
            >
              {LEAD_DOC_CATEGORIES.map((c) => (
                <SelectItem key={c} textValue={c.replace(/_/g, ' ')}>{c.replace(/_/g, ' ')}</SelectItem>
              ))}
            </Select>
            <Button
              size="sm" variant="flat" isLoading={upload.isPending}
              startContent={<FiUpload className="w-3 h-3" />}
              onPress={() => fileRef.current?.click()}
              className="h-8"
            >
              Upload
            </Button>
            <input ref={fileRef} type="file" className="hidden" onChange={onFile} />
          </div>
        )}
      </div>

      {isLoading ? (
        <p className="text-xs text-gray-500 py-2">Loading…</p>
      ) : docs.length === 0 ? (
        <p className="text-xs text-gray-500 py-2">
          {canUpload
            ? 'Nothing filed against this lead yet — the brochure sent, an LOI draft, ID proof from a site visit.'
            : 'Nothing filed against this lead yet.'}
        </p>
      ) : (
        <ul className="space-y-1">
          {docs.map((d) => (
            <li key={d.id} className="flex items-center gap-2 text-xs py-1">
              <FiFileText className="w-3.5 h-3.5 shrink-0 text-gray-400" />
              <a
                href={d.fileUrl} target="_blank" rel="noreferrer"
                className="inline-flex items-center gap-1 text-blue-600 hover:text-blue-700 truncate min-w-0"
              >
                <span className="truncate">{d.fileName}</span>
                <FiExternalLink className="w-3 h-3 shrink-0" />
              </a>
              <span className="ml-auto shrink-0 text-gray-500">
                {String(d.category || '').replace(/_/g, ' ')}
              </span>
              <span className="shrink-0 text-gray-500 tabular-nums">{fmtDate(d.createdAt)}</span>
              {canDelete && (
                <button
                  type="button"
                  onClick={() => onDelete(d.id, d.fileName)}
                  className="shrink-0 text-gray-300 hover:text-red-700 transition-colors"
                  title={`Delete ${d.fileName}`}
                  aria-label={`Delete ${d.fileName}`}
                >
                  <FiTrash2 className="w-3.5 h-3.5" />
                </button>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
