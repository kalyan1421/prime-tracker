/**
 * InteriorDocumentsPanel — Scoped document vault for one interior fit-out project.
 *
 * Categories surfaced: DRAWING, CITY_APPROVAL, HANDOVER_CERTIFICATE, CONTRACT, PHOTO, GENERAL.
 * Each category can be "required" by a phase gate — shown with a red dot when missing.
 *
 * Upload flow: multipart POST /documents with interiorProjectId in the body.
 */

import { useRef, useState } from 'react';
import { Button, Chip, Tooltip, Select, SelectItem, addToast } from '@heroui/react';
import {
  FiUpload, FiDownload, FiTrash2, FiFile, FiFileText,
  FiImage, FiAlertCircle, FiCheckCircle, FiFilter,
} from 'react-icons/fi';
import { useInteriorDocuments, useUploadDocument, useDeleteDocument } from '../hooks/useApi';
import { fmtDate, errMsg } from '../utils/fmt';
import { apiAssetUrl } from '../lib/api';

// ─── types & config ───────────────────────────────────────────────────────────

type InteriorDocCategory =
  | 'DRAWING'
  | 'CITY_APPROVAL'
  | 'HANDOVER_CERTIFICATE'
  | 'CONTRACT'
  | 'PHOTO'
  | 'GENERAL';

const CAT_META: Record<InteriorDocCategory, { label: string; color: string; required?: boolean }> = {
  DRAWING:              { label: 'Design Drawing',        color: 'bg-purple-100 text-purple-700' },
  CITY_APPROVAL:        { label: 'City Approval',         color: 'bg-blue-100 text-blue-700',   required: true },
  HANDOVER_CERTIFICATE: { label: 'Handover Certificate',  color: 'bg-green-100 text-green-700', required: true },
  CONTRACT:             { label: 'Contract',              color: 'bg-amber-100 text-amber-700' },
  PHOTO:                { label: 'Site Photo',            color: 'bg-pink-100 text-pink-700' },
  GENERAL:              { label: 'General',               color: 'bg-gray-100 text-gray-600' },
};

const ALL_CATS = Object.keys(CAT_META) as InteriorDocCategory[];

/** Categories required before certain phase gates can pass */
const PHASE_REQUIRED_DOCS: Record<string, InteriorDocCategory[]> = {
  CITY_APPROVAL: ['DRAWING'],
  HANDOVER:      ['CITY_APPROVAL', 'HANDOVER_CERTIFICATE'],
};

function docIcon(mime = '') {
  if (mime.startsWith('image/')) return <FiImage className="text-pink-400" />;
  if (mime.includes('pdf'))       return <FiFileText className="text-red-400" />;
  return <FiFile className="text-gray-400" />;
}

// ─── component ────────────────────────────────────────────────────────────────

export function InteriorDocumentsPanel({
  interiorProjectId,
  currentPhase,
  projectId,
}: {
  interiorProjectId: string;
  currentPhase?: string;
  projectId?: string;
}) {
  const { data, isLoading } = useInteriorDocuments(interiorProjectId);
  const upload  = useUploadDocument();
  const del     = useDeleteDocument();

  const fileInputRef    = useRef<HTMLInputElement>(null);
  const pendingCatRef   = useRef<InteriorDocCategory>('GENERAL');

  const [filterCat, setFilterCat]   = useState<InteriorDocCategory | 'ALL'>('ALL');
  const [uploadCat, setUploadCat]   = useState<InteriorDocCategory>('GENERAL');
  const [uploading, setUploading]   = useState(false);

  const docs: any[] = Array.isArray(data) ? data : [];

  // ── gate summary ─────────────────────────────────────────────────────────────
  const uploadedCats = new Set(docs.map((d) => d.category as InteriorDocCategory));
  const requiredForPhase: InteriorDocCategory[] =
    currentPhase ? (PHASE_REQUIRED_DOCS[currentPhase] ?? []) : [];
  const missingRequired = requiredForPhase.filter((c) => !uploadedCats.has(c));

  // ── filtered list ─────────────────────────────────────────────────────────────
  const filtered = filterCat === 'ALL' ? docs : docs.filter((d) => d.category === filterCat);

  // ── upload flow ───────────────────────────────────────────────────────────────
  const triggerUpload = (cat: InteriorDocCategory) => {
    pendingCatRef.current = cat;
    fileInputRef.current?.click();
  };

  const handleFileChosen = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    e.target.value = '';
    setUploading(true);
    try {
      const fd = new FormData();
      fd.append('file', file);
      fd.append('interiorProjectId', interiorProjectId);
      fd.append('category', pendingCatRef.current);
      if (projectId) fd.append('projectId', projectId);
      await upload.mutateAsync(fd);
      addToast({ title: 'Document uploaded', color: 'success' });
    } catch (e2) {
      addToast({ title: errMsg(e2, 'Upload failed'), color: 'danger' });
    } finally {
      setUploading(false);
    }
  };

  const handleDelete = async (id: string) => {
    if (!confirm('Delete this document?')) return;
    try {
      await del.mutateAsync(id);
      addToast({ title: 'Document deleted', color: 'success' });
    } catch (e2) {
      addToast({ title: errMsg(e2, 'Delete failed'), color: 'danger' });
    }
  };

  // ── render ────────────────────────────────────────────────────────────────────
  return (
    <div className="space-y-4">
      {/* hidden file input */}
      <input ref={fileInputRef} type="file" className="hidden" onChange={handleFileChosen} aria-hidden />

      {/* ── phase gate summary ── */}
      {currentPhase && requiredForPhase.length > 0 && (
        <div className={`rounded-xl border p-3 ${missingRequired.length > 0 ? 'border-amber-200 bg-amber-50' : 'border-green-100 bg-green-50'}`}>
          <p className="text-xs font-semibold flex items-center gap-1.5 mb-2 text-gray-600">
            {missingRequired.length > 0
              ? <><FiAlertCircle className="text-amber-500" /> Required for next phase advance</>
              : <><FiCheckCircle className="text-green-500" /> All required docs uploaded</>}
          </p>
          <div className="flex flex-wrap gap-1.5">
            {requiredForPhase.map((cat) => {
              const has = uploadedCats.has(cat);
              return (
                <button
                  key={cat}
                  onClick={() => !has && triggerUpload(cat)}
                  className={`flex items-center gap-1 text-xs px-2.5 py-1 rounded-full transition-colors ${
                    has
                      ? 'bg-green-100 text-green-700'
                      : 'bg-amber-100 text-amber-700 hover:bg-amber-200 cursor-pointer'
                  }`}
                >
                  {has ? <FiCheckCircle size={11} /> : <FiUpload size={11} />}
                  {CAT_META[cat].label}
                  {!has && <span className="font-semibold ml-0.5">↑</span>}
                </button>
              );
            })}
          </div>
        </div>
      )}

      {/* ── toolbar ── */}
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <div className="flex items-center gap-1.5 flex-wrap">
          <FiFilter size={12} className="text-gray-400 shrink-0" />
          {(['ALL', ...ALL_CATS] as const).map((cat) => {
            const count = cat === 'ALL' ? docs.length : docs.filter((d) => d.category === cat).length;
            if (cat !== 'ALL' && count === 0) return null;
            return (
              <button
                key={cat}
                onClick={() => setFilterCat(cat)}
                className={`px-2.5 py-0.5 rounded-full text-xs font-medium transition-colors ${
                  filterCat === cat
                    ? 'bg-blue-600 text-white'
                    : 'bg-gray-100 text-gray-500 hover:bg-gray-200'
                }`}
              >
                {cat === 'ALL' ? `All (${count})` : CAT_META[cat].label}
                {cat !== 'ALL' && count > 0 && ` (${count})`}
              </button>
            );
          })}
        </div>

        {/* quick upload by category */}
        <div className="flex items-center gap-2">
          <Select
            size="sm"
            aria-label="Upload category"
            selectedKeys={[uploadCat]}
            onSelectionChange={(k) => setUploadCat(Array.from(k)[0] as InteriorDocCategory)}
            className="w-40"
          >
            {ALL_CATS.map((c) => <SelectItem key={c}>{CAT_META[c].label}</SelectItem>)}
          </Select>
          <Button
            size="sm" color="primary" startContent={<FiUpload size={13} />}
            isLoading={uploading}
            onPress={() => triggerUpload(uploadCat)}
          >
            Upload
          </Button>
        </div>
      </div>

      {/* ── doc grid ── */}
      {isLoading && (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
          {[1, 2, 3].map((i) => <div key={i} className="h-24 bg-gray-50 rounded-xl animate-pulse" />)}
        </div>
      )}

      {!isLoading && filtered.length === 0 && (
        <div className="rounded-xl border border-dashed border-gray-200 py-10 text-center">
          <FiFile className="mx-auto mb-2 text-xl text-gray-300" />
          <p className="text-sm text-gray-400">
            {filterCat === 'ALL' ? 'No documents uploaded yet.' : `No ${CAT_META[filterCat as InteriorDocCategory]?.label} documents.`}
          </p>
          <Button
            size="sm" variant="flat" color="primary" className="mt-3"
            startContent={<FiUpload size={12} />}
            onPress={() => triggerUpload(filterCat === 'ALL' ? 'GENERAL' : (filterCat as InteriorDocCategory))}
          >
            Upload first document
          </Button>
        </div>
      )}

      {!isLoading && filtered.length > 0 && (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          {filtered.map((doc: any) => {
            const catMeta = CAT_META[doc.category as InteriorDocCategory];
            return (
              <div key={doc.id} className="rounded-xl border border-gray-100 bg-white p-3 flex items-start gap-3 hover:border-gray-200 transition-colors">
                <div className="text-xl mt-0.5 shrink-0">{docIcon(doc.mimeType)}</div>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium text-gray-800 truncate">{doc.fileName}</p>
                  <div className="flex items-center gap-2 mt-1 flex-wrap">
                    {catMeta && (
                      <span className={`text-[10px] px-2 py-0.5 rounded-full font-medium ${catMeta.color}`}>
                        {catMeta.label}
                      </span>
                    )}
                    {doc.fileSize && (
                      <span className="text-[10px] text-gray-400">
                        {(doc.fileSize / 1024).toFixed(0)} KB
                      </span>
                    )}
                  </div>
                  <p className="text-[10px] text-gray-400 mt-1">
                    {doc.uploadedBy?.name} · {fmtDate(doc.createdAt)}
                  </p>
                  <div className="flex gap-1.5 mt-2">
                    <a href={apiAssetUrl(doc.fileUrl)} target="_blank" rel="noreferrer">
                      <Button size="sm" variant="flat" startContent={<FiFileText size={11} />} className="h-6 text-[11px]">
                        View
                      </Button>
                    </a>
                    <a href={apiAssetUrl(doc.fileUrl)} download={doc.fileName}>
                      <Button size="sm" variant="flat" startContent={<FiDownload size={11} />} className="h-6 text-[11px]">
                        Download
                      </Button>
                    </a>
                    <Tooltip content="Delete">
                      <Button
                        size="sm" variant="light" color="danger" isIconOnly className="h-6 w-6 min-w-6"
                        onPress={() => handleDelete(doc.id)}
                        aria-label="Delete document"
                      >
                        <FiTrash2 size={11} />
                      </Button>
                    </Tooltip>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
