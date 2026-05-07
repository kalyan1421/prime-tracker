import { Injectable, InternalServerErrorException, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createClient, SupabaseClient } from '@supabase/supabase-js';
import { extname } from 'path';
import { v4 as uuidv4 } from 'uuid';

const BUCKET = 'documents';

@Injectable()
export class StorageService {
  private readonly client: SupabaseClient;
  private readonly logger = new Logger(StorageService.name);

  constructor(private config: ConfigService) {
    const url = this.config.get<string>('SUPABASE_URL') ?? '';
    const key = this.config.get<string>('SUPABASE_SERVICE_ROLE_KEY') ?? '';
    if (!url || !key) {
      this.logger.warn('SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY not set — file uploads will fail');
    }
    this.client = createClient(url || 'https://placeholder.supabase.co', key || 'placeholder', {
      auth: { persistSession: false },
    });
  }

  /**
   * Upload a file to Supabase Storage.
   * Path: {projectId}/{category}/{projectName}-{uuid}.{ext}
   * Falls back to 'misc' when projectId/category are absent.
   */
  async upload(
    fileBuffer: Buffer,
    mimeType: string,
    originalName: string,
    opts: { projectId?: string; projectName?: string; category?: string },
  ): Promise<{ storagePath: string; publicUrl: string }> {
    const folder1 = opts.projectId ?? 'misc';
    const folder2 = (opts.category ?? 'general').toLowerCase();
    const ext = extname(originalName);
    const slug = opts.projectName
      ? opts.projectName.replace(/[^a-zA-Z0-9]/g, '-').toLowerCase()
      : 'file';
    const filename = `${slug}-${uuidv4()}${ext}`;
    const storagePath = `${folder1}/${folder2}/${filename}`;

    const { error } = await this.client.storage
      .from(BUCKET)
      .upload(storagePath, fileBuffer, { contentType: mimeType, upsert: false });

    if (error) {
      this.logger.error(`Storage upload failed: ${error.message}`);
      throw new InternalServerErrorException('File upload failed');
    }

    const { data } = this.client.storage.from(BUCKET).getPublicUrl(storagePath);
    return { storagePath, publicUrl: data.publicUrl };
  }

  async delete(storagePath: string): Promise<void> {
    const { error } = await this.client.storage.from(BUCKET).remove([storagePath]);
    if (error) {
      this.logger.warn(`Storage delete failed for ${storagePath}: ${error.message}`);
    }
  }

  /** Generate a signed URL valid for 1 hour for private buckets. */
  async signedUrl(storagePath: string, expiresInSeconds = 3600): Promise<string> {
    const { data, error } = await this.client.storage
      .from(BUCKET)
      .createSignedUrl(storagePath, expiresInSeconds);
    if (error || !data) throw new InternalServerErrorException('Could not generate download URL');
    return data.signedUrl;
  }

  /**
   * Generate a presigned upload URL so the client can upload directly to Supabase Storage,
   * bypassing the API for large files. Returns the URL the browser should PUT to,
   * the storage path the file will live at, and a token to use for authenticated uploads.
   * Use this for any file > 10MB to avoid blocking the API process.
   */
  async createPresignedUpload(
    originalName: string,
    opts: { projectId?: string; projectName?: string; category?: string },
  ): Promise<{ uploadUrl: string; storagePath: string; token: string }> {
    const folder1 = opts.projectId ?? 'misc';
    const folder2 = (opts.category ?? 'general').toLowerCase();
    const ext = extname(originalName);
    const slug = opts.projectName
      ? opts.projectName.replace(/[^a-zA-Z0-9]/g, '-').toLowerCase()
      : 'file';
    const filename = `${slug}-${uuidv4()}${ext}`;
    const storagePath = `${folder1}/${folder2}/${filename}`;

    const { data, error } = await this.client.storage
      .from(BUCKET)
      .createSignedUploadUrl(storagePath);

    if (error || !data) {
      this.logger.error(`Presigned upload URL failed: ${error?.message}`);
      throw new InternalServerErrorException('Could not create upload URL');
    }
    return { uploadUrl: data.signedUrl, storagePath: data.path, token: data.token };
  }
}
