import { InternalServerErrorException, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createClient, SupabaseClient } from '@supabase/supabase-js';
import { StorageDriver } from './storage.driver';

const BUCKET = 'documents';

/** Default driver — Supabase Storage (unchanged behaviour from the original service). */
export class SupabaseStorageDriver implements StorageDriver {
  private readonly client: SupabaseClient;
  private readonly logger = new Logger(SupabaseStorageDriver.name);

  constructor(config: ConfigService) {
    const url = config.get<string>('SUPABASE_URL') ?? '';
    const key = config.get<string>('SUPABASE_SERVICE_ROLE_KEY') ?? '';
    if (!url || !key) {
      this.logger.warn('SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY not set — file uploads will fail');
    }
    this.client = createClient(url || 'https://placeholder.supabase.co', key || 'placeholder', {
      auth: { persistSession: false },
    });
  }

  async upload(buffer: Buffer, mimeType: string, storagePath: string): Promise<{ publicUrl: string }> {
    const { error } = await this.client.storage
      .from(BUCKET)
      .upload(storagePath, buffer, { contentType: mimeType, upsert: false });
    if (error) {
      this.logger.error(`Storage upload failed: ${error.message}`);
      throw new InternalServerErrorException('File upload failed');
    }
    const { data } = this.client.storage.from(BUCKET).getPublicUrl(storagePath);
    return { publicUrl: data.publicUrl };
  }

  async delete(storagePath: string): Promise<void> {
    const { error } = await this.client.storage.from(BUCKET).remove([storagePath]);
    if (error) {
      this.logger.warn(`Storage delete failed for ${storagePath}: ${error.message}`);
    }
  }

  async signedUrl(storagePath: string, expiresInSeconds: number): Promise<string> {
    const { data, error } = await this.client.storage
      .from(BUCKET)
      .createSignedUrl(storagePath, expiresInSeconds);
    if (error || !data) throw new InternalServerErrorException('Could not generate download URL');
    return data.signedUrl;
  }

  async createPresignedUpload(storagePath: string): Promise<{ uploadUrl: string; token: string }> {
    const { data, error } = await this.client.storage.from(BUCKET).createSignedUploadUrl(storagePath);
    if (error || !data) {
      this.logger.error(`Presigned upload URL failed: ${error?.message}`);
      throw new InternalServerErrorException('Could not create upload URL');
    }
    return { uploadUrl: data.signedUrl, token: data.token };
  }
}
