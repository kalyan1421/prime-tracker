import { InternalServerErrorException, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  S3Client,
  PutObjectCommand,
  GetObjectCommand,
  DeleteObjectCommand,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { StorageDriver } from './storage.driver';

/**
 * AWS S3 driver. Activated with STORAGE_DRIVER=s3.
 *
 * Credentials come from the default AWS provider chain — on EC2 that's the
 * instance IAM role, so no keys are stored in the app. Required env:
 *   S3_BUCKET, AWS_REGION
 * Optional:
 *   S3_PUBLIC_BASE_URL  — e.g. a CloudFront domain for public objects.
 *                         Falls back to the virtual-hosted S3 URL.
 */
export class S3StorageDriver implements StorageDriver {
  private readonly logger = new Logger(S3StorageDriver.name);
  private readonly client: S3Client;
  private readonly bucket: string;
  private readonly publicBase: string;

  constructor(config: ConfigService) {
    const region = config.get<string>('AWS_REGION', 'us-east-1');
    this.bucket = config.get<string>('S3_BUCKET', '');
    if (!this.bucket) {
      this.logger.warn('S3_BUCKET not set — file uploads will fail while STORAGE_DRIVER=s3');
    }
    this.publicBase =
      config.get<string>('S3_PUBLIC_BASE_URL', '') ||
      `https://${this.bucket}.s3.${region}.amazonaws.com`;
    // Newer SDK versions default to computing a flexible checksum (CRC32) over the
    // command's Body even when only presigning — createPresignedUpload() builds a
    // PutObjectCommand with no Body, so the checksum of an *empty* payload gets
    // signed into the URL's query string. S3 then rejects the browser's real PUT
    // (real bytes vs. the empty-body checksum). WHEN_REQUIRED restores the old
    // behavior: only compute/require a checksum when the operation demands one.
    this.client = new S3Client({ region, requestChecksumCalculation: 'WHEN_REQUIRED' });
  }

  async upload(buffer: Buffer, mimeType: string, storagePath: string): Promise<{ publicUrl: string }> {
    try {
      await this.client.send(
        new PutObjectCommand({
          Bucket: this.bucket,
          Key: storagePath,
          Body: buffer,
          ContentType: mimeType,
        }),
      );
    } catch (err) {
      this.logger.error(`S3 upload failed: ${(err as Error).message}`);
      throw new InternalServerErrorException('File upload failed');
    }
    return { publicUrl: `${this.publicBase}/${storagePath}` };
  }

  async delete(storagePath: string): Promise<void> {
    try {
      await this.client.send(new DeleteObjectCommand({ Bucket: this.bucket, Key: storagePath }));
    } catch (err) {
      this.logger.warn(`S3 delete failed for ${storagePath}: ${(err as Error).message}`);
    }
  }

  async signedUrl(storagePath: string, expiresInSeconds: number): Promise<string> {
    return getSignedUrl(
      this.client,
      new GetObjectCommand({ Bucket: this.bucket, Key: storagePath }),
      { expiresIn: expiresInSeconds },
    );
  }

  async createPresignedUpload(
    storagePath: string,
    mimeType: string,
  ): Promise<{ uploadUrl: string; token: string }> {
    const uploadUrl = await getSignedUrl(
      this.client,
      new PutObjectCommand({ Bucket: this.bucket, Key: storagePath, ContentType: mimeType }),
      { expiresIn: 900 },
    );
    // S3 presigned PUT needs no separate token; the browser PUTs directly to uploadUrl.
    return { uploadUrl, token: '' };
  }
}
