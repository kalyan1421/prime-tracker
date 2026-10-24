import { Injectable, Logger, PayloadTooLargeException, BadRequestException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { extname } from 'path';
import type { Readable } from 'stream';
import { v4 as uuidv4 } from 'uuid';
import { StorageDriver } from './storage.driver';
import { S3StorageDriver } from './s3.driver';
import { MAX_PRESIGNED_UPLOAD_BYTES, assertAllowedUpload, servingHeadersFor } from './upload-policy';

@Injectable()
export class StorageService {
  private readonly driver: StorageDriver;
  private readonly logger = new Logger(StorageService.name);

  constructor(private config: ConfigService) {
    this.driver = new S3StorageDriver(this.config);
    this.logger.log('Storage driver: s3');
  }

  /** Build the canonical object path: {projectId|misc}/{category|general}/{slug}-{uuid}.{ext} */
  private buildPath(
    originalName: string,
    opts: { projectId?: string; projectName?: string; category?: string },
  ): string {
    // projectId/category come straight from the request body — strip anything that
    // isn't a safe key segment so a value like "../../deploy" can't escape the object
    // prefix and write elsewhere in the (shared) bucket. Path traversal hardening.
    const safeSegment = (raw: string | undefined, fallback: string) => {
      const cleaned = (raw ?? '').replace(/[^a-zA-Z0-9_-]/g, '');
      return cleaned.length ? cleaned : fallback;
    };
    const folder1 = safeSegment(opts.projectId, 'misc');
    const folder2 = safeSegment(opts.category?.toLowerCase(), 'general');
    // extname of an attacker filename is bounded (last ".xyz"), but strip separators defensively.
    const ext = extname(originalName).replace(/[^a-zA-Z0-9.]/g, '');
    const slug = opts.projectName
      ? opts.projectName.replace(/[^a-zA-Z0-9]/g, '-').toLowerCase()
      : 'file';
    return `${folder1}/${folder2}/${slug}-${uuidv4()}${ext}`;
  }

  /**
   * Store an upload. The policy check lives HERE rather than in each controller so no
   * upload route can forget it: an extension off the allowlist, or a declared type that
   * contradicts the extension, is refused before anything reaches the bucket, and the
   * stored ContentType is the one derived from the extension — `mimeType` (the browser's
   * claim) is only ever checked, never written. Callers persist the returned
   * `contentType` rather than `file.mimetype` for the same reason.
   */
  async upload(
    fileBuffer: Buffer,
    mimeType: string,
    originalName: string,
    opts: { projectId?: string; projectName?: string; category?: string },
  ): Promise<{ storagePath: string; publicUrl: string; contentType: string }> {
    const { contentType } = assertAllowedUpload(originalName, mimeType);
    const storagePath = this.buildPath(originalName, opts);
    const { publicUrl } = await this.driver.upload(fileBuffer, contentType, storagePath);
    return { storagePath, publicUrl, contentType };
  }

  async delete(storagePath: string): Promise<void> {
    return this.driver.delete(storagePath);
  }

  /**
   * Generate a signed URL valid for 1 hour for private buckets.
   *
   * Every URL carries the type derived from the key's extension, and anything that is not
   * an image or a PDF carries `Content-Disposition: attachment` — so an HTML, SVG or Office
   * file downloads instead of rendering from the bucket's origin. `downloadName` is the
   * human file name to save as (a document's fileName); it defaults to the key's basename.
   */
  async signedUrl(
    storagePath: string,
    expiresInSeconds = 3600,
    opts: { downloadName?: string } = {},
  ): Promise<string> {
    const headers = servingHeadersFor(storagePath, opts.downloadName);
    return this.driver.signedUrl(storagePath, expiresInSeconds, {
      contentType: headers.contentType,
      contentDisposition: headers.disposition,
    });
  }

  /**
   * Stream an object back through the API — for routes the browser fetches with its
   * Authorization header (a redirect to the bucket would be a cross-origin XHR, which the
   * bucket's CORS rules do not allow). Same derived headers as signedUrl().
   */
  async download(
    storagePath: string,
    downloadName?: string,
  ): Promise<{ body: Readable; contentLength?: number; contentType: string; disposition?: string }> {
    const headers = servingHeadersFor(storagePath, downloadName);
    const { body, contentLength } = await this.driver.getObject(storagePath);
    return { body, contentLength, contentType: headers.contentType, disposition: headers.disposition };
  }

  /**
   * Generate a presigned upload URL so the client can upload directly to storage,
   * bypassing the API for large files (>10MB). For Supabase, `token` authenticates
   * the upload; for S3 it is '' and the browser PUTs directly to `uploadUrl`.
   *
   * The same allowlist as upload() applies, and the URL is bound to the derived content
   * type and the exact declared size: the browser must PUT with `Content-Type:
   * <contentType>` and a body of exactly `size` bytes, or S3 rejects the signature. It
   * used to be issued with no type and no size at all, so anyone holding
   * `document:upload` could put any number of bytes of any type into the bucket.
   */
  async createPresignedUpload(
    originalName: string,
    opts: { projectId?: string; projectName?: string; category?: string },
    declared: { contentType?: string; size: number },
  ): Promise<{ uploadUrl: string; storagePath: string; token: string; contentType: string; maxBytes: number }> {
    const { contentType } = assertAllowedUpload(originalName, declared.contentType);
    if (!Number.isInteger(declared.size) || declared.size <= 0) {
      throw new BadRequestException('size must be the file size in bytes');
    }
    if (declared.size > MAX_PRESIGNED_UPLOAD_BYTES) {
      throw new PayloadTooLargeException(
        `File is too large. The maximum direct upload size is ${MAX_PRESIGNED_UPLOAD_BYTES / (1024 * 1024)} MB.`,
      );
    }
    const storagePath = this.buildPath(originalName, opts);
    const { uploadUrl, token } = await this.driver.createPresignedUpload(storagePath, contentType, declared.size);
    return { uploadUrl, storagePath, token, contentType, maxBytes: MAX_PRESIGNED_UPLOAD_BYTES };
  }
}
