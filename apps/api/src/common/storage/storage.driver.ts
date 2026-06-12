/**
 * Storage driver abstraction so the file backend can be switched from Supabase
 * Storage to AWS S3 via the STORAGE_DRIVER env var, with no change to callers.
 *
 * StorageService owns path generation (folder/slug/uuid); a driver only performs
 * the backend operation on an already-computed storagePath.
 */
export interface StorageDriver {
  upload(buffer: Buffer, mimeType: string, storagePath: string): Promise<{ publicUrl: string }>;
  delete(storagePath: string): Promise<void>;
  /** Time-limited GET URL for private objects. */
  signedUrl(storagePath: string, expiresInSeconds: number): Promise<string>;
  /**
   * Direct-to-storage upload URL so large files bypass the API.
   * `token` is Supabase-specific (auth for the signed upload); S3 returns '' —
   * the browser does a plain PUT to `uploadUrl`.
   */
  createPresignedUpload(
    storagePath: string,
    mimeType: string,
  ): Promise<{ uploadUrl: string; token: string }>;
}
