import React, { useRef } from 'react';
import { Button, Chip, Tooltip } from '@heroui/react';
import { FiUpload, FiCheckCircle, FiAlertTriangle, FiPaperclip, FiTrash2 } from 'react-icons/fi';

/**
 * Document checklist for a draw request.
 *
 *   ✓ Lien Waiver         3 files     [Upload]
 *   ✓ Inspection Report   1 file      [Upload]
 *   ⚠ Sworn Statement     0 files     [Upload]      ← red, blocks submit
 *   ⚠ Vendor Invoice      0 files     [Upload]      ← red
 *
 * Required documents that haven't been uploaded show the warning icon and
 * a red border — the same items the backend's required-doc gate enforces
 * on draw transitions.
 */

export type DrawDocType =
  | 'LIEN_WAIVER'
  | 'INSPECTION_REPORT'
  | 'SWORN_STATEMENT'
  | 'VENDOR_INVOICE'
  | 'CHANGE_ORDER'
  | 'OTHER';

const DOC_LABELS: Record<DrawDocType, string> = {
  LIEN_WAIVER:       'Lien Waiver',
  INSPECTION_REPORT: 'Inspection Report',
  SWORN_STATEMENT:   'Sworn Statement',
  VENDOR_INVOICE:    'Vendor Invoice',
  CHANGE_ORDER:      'Change Order',
  OTHER:             'Other',
};

export interface ChecklistItem {
  type: DrawDocType;
  required: boolean;
  uploaded: number;
}

export interface AttachedDocument {
  id: string;
  documentType: DrawDocType;
  filename: string;
  storagePath: string;
  uploadedAt: string;
  uploadedBy?: { id: string; name: string };
}

export function DocumentChecklist({
  checklist,
  attachments,
  onUpload,
  onRemove,
  uploading = false,
  readOnly = false,
}: {
  checklist: ChecklistItem[];
  attachments: AttachedDocument[];
  onUpload: (type: DrawDocType, file: File) => void;
  onRemove: (id: string) => void;
  uploading?: boolean;
  readOnly?: boolean;
}) {
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const pendingTypeRef = useRef<DrawDocType | null>(null);

  const triggerUpload = (type: DrawDocType) => {
    pendingTypeRef.current = type;
    fileInputRef.current?.click();
  };

  const handleFileChosen = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    const type = pendingTypeRef.current;
    if (file && type) onUpload(type, file);
    // Reset so re-uploading the same file fires onChange again
    e.target.value = '';
    pendingTypeRef.current = null;
  };

  // Group attachments by type for inline display
  const byType = new Map<DrawDocType, AttachedDocument[]>();
  for (const a of attachments) {
    const arr = byType.get(a.documentType) ?? [];
    arr.push(a);
    byType.set(a.documentType, arr);
  }

  return (
    <div className="space-y-2">
      {/* Hidden file input — single instance reused per upload click */}
      <input
        ref={fileInputRef}
        type="file"
        className="hidden"
        onChange={handleFileChosen}
        aria-hidden
      />

      {checklist.map((item) => {
        const missing = item.required && item.uploaded === 0;
        const uploaded = byType.get(item.type) ?? [];
        return (
          <div
            key={item.type}
            className={`rounded-lg border p-3 ${
              missing ? 'border-red-200 bg-red-50/40' : 'border-gray-200 bg-white'
            }`}
          >
            <div className="flex items-center justify-between gap-3 flex-wrap">
              <div className="flex items-center gap-2 min-w-0">
                {missing ? (
                  <FiAlertTriangle className="text-red-500 shrink-0" />
                ) : (
                  <FiCheckCircle className="text-green-500 shrink-0" />
                )}
                <span className={`font-medium text-sm ${missing ? 'text-red-700' : 'text-gray-800'}`}>
                  {DOC_LABELS[item.type]}
                </span>
                {item.required && (
                  <Chip size="sm" variant="flat" className="bg-gray-100 text-gray-600 text-[10px]">Required</Chip>
                )}
                <Chip size="sm" variant="flat" className="text-[10px]">
                  {item.uploaded} {item.uploaded === 1 ? 'file' : 'files'}
                </Chip>
              </div>
              {!readOnly && (
                <Button
                  size="sm"
                  variant="flat"
                  color={missing ? 'danger' : 'default'}
                  startContent={<FiUpload />}
                  onPress={() => triggerUpload(item.type)}
                  isDisabled={uploading}
                >
                  Upload
                </Button>
              )}
            </div>

            {uploaded.length > 0 && (
              <ul className="mt-2 space-y-1">
                {uploaded.map((doc) => (
                  <li key={doc.id} className="flex items-center justify-between gap-2 text-xs text-gray-600 bg-white rounded border border-gray-100 px-2 py-1">
                    <span className="flex items-center gap-1.5 min-w-0">
                      <FiPaperclip className="shrink-0" />
                      <span className="truncate">{doc.filename}</span>
                      {doc.uploadedBy && (
                        <Tooltip content={`Uploaded by ${doc.uploadedBy.name}`}>
                          <span className="text-gray-400 shrink-0">· {doc.uploadedBy.name}</span>
                        </Tooltip>
                      )}
                    </span>
                    {!readOnly && (
                      <Button
                        size="sm"
                        variant="light"
                        color="danger"
                        isIconOnly
                        onPress={() => onRemove(doc.id)}
                        aria-label="Remove document"
                      >
                        <FiTrash2 className="text-xs" />
                      </Button>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </div>
        );
      })}
    </div>
  );
}
