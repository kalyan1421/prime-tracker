import { UnsupportedMediaTypeException } from '@nestjs/common';
import { extname } from 'path';

/**
 * ============================================================================
 * What Prime Tracker accepts as an upload, and how it hands each type back
 * ============================================================================
 *
 * Before this existed there was no allowlist anywhere: whatever the browser declared as
 * `file.mimetype` became the S3 ContentType, and signed GETs set no Content-Disposition.
 * An uploaded `.html` or `.svg` therefore rendered inline from the bucket's origin — a
 * phishing page or a script with a Prime-issued link. Three rules close that:
 *
 *   1. ALLOWLIST BY EXTENSION. Every upload route in the app — the document vault, the
 *      shared /documents/upload-file used for photos and update-board files, the
 *      presigned PUT and task attachments — accepts the same set, chosen from what the
 *      web uploaders actually offer: site photos (`accept="image/*"`, so HEIC from
 *      iPhones), the vault's PDFs, Office files, spreadsheets, drawings, scans and the
 *      odd zipped drawing set or forwarded email. HTML, SVG, XML, scripts and
 *      executables are simply not on it.
 *
 *   2. THE DECLARED TYPE MUST AGREE. The browser's type is checked against the
 *      extension (a `.pdf` sent as `text/html` is refused) but never trusted: the
 *      ContentType we store is DERIVED from the extension, server-side. A generic
 *      `application/octet-stream` passes, because that is what browsers send for
 *      anything they do not recognise (DWG, MSG, sometimes HEIC).
 *
 *   3. ONLY IMAGES AND PDFS RENDER INLINE. Everything else is signed with
 *      `Content-Disposition: attachment`, so even a file that slipped past (or one
 *      uploaded before this policy existed) downloads rather than renders.
 */
export type UploadKind = 'image' | 'document' | 'video';

export interface UploadType {
  /** The Content-Type we store and serve. Derived from the extension, never from the browser. */
  contentType: string;
  /** Browser-declared types consistent with this extension (lower-case, no parameters). */
  declared: readonly string[];
  /** Safe to show in a browser tab: raster images and PDF. Everything else downloads. */
  inline: boolean;
  kind: UploadKind;
}

const image = (contentType: string, declared: string[], inline = true): UploadType =>
  ({ contentType, declared: [contentType, ...declared], inline, kind: 'image' });
const doc = (contentType: string, declared: string[] = []): UploadType =>
  ({ contentType, declared: [contentType, ...declared], inline: false, kind: 'document' });

const JPEG = image('image/jpeg', ['image/pjpeg', 'image/jpg']);
const HEIC = image('image/heic', ['image/heif', 'image/heic-sequence', 'image/heif-sequence'], false);
const TIFF = image('image/tiff', ['image/tif', 'image/x-tiff'], false);

/** Keyed by lower-case extension without the dot. */
export const UPLOAD_TYPES: Readonly<Record<string, UploadType>> = Object.freeze({
  // Photos. JPEG/PNG/WebP/GIF render in every browser; HEIC and TIFF do not, so they
  // download rather than open as a broken image.
  jpg: JPEG,
  jpeg: JPEG,
  jfif: JPEG, // what Windows names a JPEG saved from a browser
  png: image('image/png', []),
  webp: image('image/webp', []),
  gif: image('image/gif', []),
  avif: image('image/avif', []),
  heic: HEIC,
  heif: HEIC,
  tif: TIFF,
  tiff: TIFF,

  // PDF is the one document type that opens inline — the vault's View button relies on it.
  pdf: { contentType: 'application/pdf', declared: ['application/pdf', 'application/x-pdf'], inline: true, kind: 'document' },

  // Office. Macro-enabled variants (.docm/.xlsm/.pptm) are deliberately absent.
  doc: doc('application/msword'),
  docx: doc('application/vnd.openxmlformats-officedocument.wordprocessingml.document'),
  xls: doc('application/vnd.ms-excel'),
  xlsx: doc('application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'),
  ppt: doc('application/vnd.ms-powerpoint'),
  pptx: doc('application/vnd.openxmlformats-officedocument.presentationml.presentation'),
  odt: doc('application/vnd.oasis.opendocument.text'),
  ods: doc('application/vnd.oasis.opendocument.spreadsheet'),
  rtf: doc('application/rtf', ['text/rtf']),
  // Windows declares a .csv as application/vnd.ms-excel whenever Excel is installed.
  csv: doc('text/csv', ['application/csv', 'text/x-csv', 'text/comma-separated-values', 'application/vnd.ms-excel', 'text/plain']),
  txt: doc('text/plain'),

  // DRAWING is a vault category; CAD files are what it holds.
  dwg: doc('image/vnd.dwg', ['application/acad', 'application/x-acad', 'application/autocad_dwg', 'application/dwg', 'application/x-dwg', 'image/x-dwg']),
  dxf: doc('image/vnd.dxf', ['application/dxf', 'application/x-dxf', 'image/x-dxf']),

  // A zipped drawing set, and correspondence forwarded into the file.
  zip: doc('application/zip', ['application/x-zip-compressed', 'application/x-zip', 'multipart/x-zip']),
  eml: doc('message/rfc822'),
  msg: doc('application/vnd.ms-outlook'),

  // Short site walk-through clips. Download-only: no reason to stream them inline.
  mp4: { contentType: 'video/mp4', declared: ['video/mp4'], inline: false, kind: 'video' },
  mov: { contentType: 'video/quicktime', declared: ['video/quicktime'], inline: false, kind: 'video' },
});

/**
 * What browsers declare when they do not know a type. Accepted for any allowed extension:
 * it says nothing either way, and the stored type comes from the extension regardless.
 */
const GENERIC_DECLARED = new Set(['', 'application/octet-stream', 'binary/octet-stream', 'application/unknown', 'application/x-unknown']);

/** Served for an object whose extension is not on the list (legacy uploads). */
export const FALLBACK_CONTENT_TYPE = 'application/octet-stream';

/** Lower-case extension without the dot, or '' when there is none. */
export function extensionOf(fileName: string): string {
  return extname(fileName ?? '').slice(1).toLowerCase();
}

/** The policy entry for a file name, or null when its extension is not accepted. */
export function uploadTypeFor(fileName: string): UploadType | null {
  const ext = extensionOf(fileName);
  return ext && Object.prototype.hasOwnProperty.call(UPLOAD_TYPES, ext) ? UPLOAD_TYPES[ext] : null;
}

/** `text/plain; charset=utf-8` → `text/plain`. */
function normaliseDeclared(declared: string | undefined | null): string {
  return String(declared ?? '').split(';')[0].trim().toLowerCase();
}

/**
 * Refuse anything off the list, or anything whose declared type contradicts its name.
 * Returns the policy entry so the caller stores the DERIVED content type.
 *
 * 415 rather than 400: the request is well-formed, the media type is what is refused.
 */
export function assertAllowedUpload(fileName: string, declaredType?: string | null): UploadType {
  const type = uploadTypeFor(fileName);
  if (!type) {
    throw new UnsupportedMediaTypeException(
      `"${fileName}" is not a file type Prime Tracker accepts. Upload a PDF, a photo ` +
        '(JPG, PNG, WebP, GIF, AVIF, HEIC, TIFF), an Office or CSV/text document, ' +
        'a drawing (DWG/DXF), a ZIP, an email (EML/MSG) or a short MP4/MOV video.',
    );
  }
  const declared = normaliseDeclared(declaredType);
  if (!GENERIC_DECLARED.has(declared) && !type.declared.includes(declared)) {
    throw new UnsupportedMediaTypeException(
      `"${fileName}" was sent as ${declared}, which does not match its .${extensionOf(fileName)} ` +
        'extension. Re-save the file with the right extension and upload it again.',
    );
  }
  return type;
}

/**
 * RFC 6266 `attachment` header with an ASCII fallback and the UTF-8 original, so a
 * download keeps its human name ("Deed – Unit 101.pdf") rather than the bucket key.
 */
export function attachmentDisposition(fileName: string): string {
  const name = (fileName || 'download').replace(/[\r\n]/g, ' ');
  const ascii = name.replace(/[^\x20-\x7e]/g, '_').replace(/["\\]/g, '_');
  return `attachment; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(name)}`;
}

/**
 * Headers a signed GET (or a streamed download) must carry for this object. The type is
 * re-derived from the key's extension on every read, which is what also neutralises
 * objects stored BEFORE this policy with a browser-declared `text/html`.
 */
export function servingHeadersFor(
  storagePath: string,
  downloadName?: string,
): { contentType: string; disposition?: string } {
  const type = uploadTypeFor(storagePath);
  if (type?.inline) return { contentType: type.contentType };
  const name = downloadName || storagePath.split('/').pop() || 'download';
  return {
    contentType: type?.contentType ?? FALLBACK_CONTENT_TYPE,
    disposition: attachmentDisposition(name),
  };
}

/**
 * Upper bound on a presigned direct-to-bucket PUT. The API-proxied routes cap at 50 MB
 * (multer `fileSize`); the presigned route exists for genuinely large files, so it gets
 * headroom — but not none, because an unbounded PUT is a free storage bill for anyone
 * holding `document:upload`. The size is signed into the URL (Content-Length), so S3
 * itself refuses a body of any other length.
 */
export const MAX_PRESIGNED_UPLOAD_BYTES = 100 * 1024 * 1024;
