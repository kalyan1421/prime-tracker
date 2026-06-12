import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { extname } from 'path';
import { v4 as uuidv4 } from 'uuid';
import { StorageDriver } from './storage.driver';
import { SupabaseStorageDriver } from './supabase.driver';
import { S3StorageDriver } from './s3.driver';

/**
 * Provider-agnostic file storage. Path generation lives here; the backend
 * (Supabase Storage or AWS S3) is chosen by STORAGE_DRIVER and implemented by
 * a StorageDriver. Default is `supabase` so existing deployments are unchanged;
 * set STORAGE_DRIVER=s3 at AWS cutover.
 */
@Injectable()
export class StorageService {
  private readonly driver: StorageDriver;
  private readonly logger = new Logger(StorageService.name);

  constructor(private config: ConfigService) {
    const driverName = this.config.get<string>('STORAGE_DRIVER', 'supabase').toLowerCase();
    this.driver =
      driverName === 's3'
        ? new S3StorageDriver(this.config)
        : new SupabaseStorageDriver(this.config);
    this.logger.log(`Storage driver: ${driverName === 's3' ? 's3' : 'supabase'}`);
  }

  /** Build the canonical object path: {projectId|misc}/{category|general}/{slug}-{uuid}.{ext} */
  private buildPath(
    originalName: string,
    opts: { projectId?: string; projectName?: string; category?: string },
  ): string {
    const folder1 = opts.projectId ?? 'misc';
    const folder2 = (opts.category ?? 'general').toLowerCase();
    const ext = extname(originalName);
    const slug = opts.projectName
      ? opts.projectName.replace(/[^a-zA-Z0-9]/g, '-').toLowerCase()
      : 'file';
    return `${folder1}/${folder2}/${slug}-${uuidv4()}${ext}`;
  }

  async upload(
    fileBuffer: Buffer,
    mimeType: string,
    originalName: string,
    opts: { projectId?: string; projectName?: string; category?: string },
  ): Promise<{ storagePath: string; publicUrl: string }> {
    const storagePath = this.buildPath(originalName, opts);
    const { publicUrl } = await this.driver.upload(fileBuffer, mimeType, storagePath);
    return { storagePath, publicUrl };
  }

  async delete(storagePath: string): Promise<void> {
    return this.driver.delete(storagePath);
  }

  /** Generate a signed URL valid for 1 hour for private buckets. */
  async signedUrl(storagePath: string, expiresInSeconds = 3600): Promise<string> {
    return this.driver.signedUrl(storagePath, expiresInSeconds);
  }

  /**
   * Generate a presigned upload URL so the client can upload directly to storage,
   * bypassing the API for large files (>10MB). For Supabase, `token` authenticates
   * the upload; for S3 it is '' and the browser PUTs directly to `uploadUrl`.
   */
  async createPresignedUpload(
    originalName: string,
    opts: { projectId?: string; projectName?: string; category?: string },
  ): Promise<{ uploadUrl: string; storagePath: string; token: string }> {
    const storagePath = this.buildPath(originalName, opts);
    const mimeType = ''; // not known at presign time; S3 PUT may omit ContentType
    const { uploadUrl, token } = await this.driver.createPresignedUpload(storagePath, mimeType);
    return { uploadUrl, storagePath, token };
  }
}
