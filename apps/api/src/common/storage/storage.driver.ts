import type { Readable } from 'stream';

/**
 * Storage driver abstraction so the file backend can be switched from Supabase
 * Storage to AWS S3 via the STORAGE_DRIVER env var, with no change to callers.
 *
 * StorageService owns path generation (folder/slug/uuid) and the upload policy
 * (upload-policy.ts); a driver only performs the backend operation on an
 * already-computed storagePath with an already-derived content type.
 */
export interface StorageDriver {
  upload(buffer: Buffer, mimeType: string, storagePath: string): Promise<{ publicUrl: string }>;
  delete(storagePath: string): Promise<void>;
  /**
   * Time-limited GET URL for private objects. `response` overrides the headers the
   * object is served with — the type derived from its extension, and `attachment` for
   * anything that must not render inline (see servingHeadersFor).
   */
  signedUrl(
    storagePath: string,
    expiresInSeconds: number,
    response?: { contentType?: string; contentDisposition?: string },
  ): Promise<string>;
  /**
   * Direct-to-storage upload URL so large files bypass the API. The content type and
   * exact byte length are signed into it, so the bucket refuses any other body.
   * `token` is Supabase-specific (auth for the signed upload); S3 returns '' — the
   * browser does a plain PUT to `uploadUrl` with the same Content-Type header.
   */
  createPresignedUpload(
    storagePath: string,
    mimeType: string,
    contentLength: number,
  ): Promise<{ uploadUrl: string; token: string }>;
  /** Read an object back through the API (for routes that stream rather than redirect). */
  getObject(storagePath: string): Promise<{ body: Readable; contentLength?: number }>;
}
