import { UnsupportedMediaTypeException, PayloadTooLargeException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  MAX_PRESIGNED_UPLOAD_BYTES, assertAllowedUpload, attachmentDisposition, servingHeadersFor, uploadTypeFor,
} from './upload-policy';
import { StorageService } from './storage.service';
import { S3StorageDriver } from './s3.driver';
import { isSafeStorageKey } from './storage-key';

/**
 * The upload policy: what is accepted, what type is stored, and how it is served back.
 *
 * Before it existed the browser's declared type became the S3 ContentType and signed GETs
 * carried no Content-Disposition, so an uploaded .html or .svg rendered inline from the
 * bucket's origin.
 */
describe('upload policy — what is accepted', () => {
  it.each([
    ['site.jpg', 'image/jpeg'],
    ['IMG_0412.HEIC', 'image/heic'],
    ['IMG_0412.heic', 'application/octet-stream'], // what Chrome sends for HEIC
    ['deed.pdf', 'application/pdf'],
    ['rent-roll.xlsx', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'],
    ['export.csv', 'application/vnd.ms-excel'], // Windows + Excel installed
    ['notes.txt', 'text/plain; charset=utf-8'],
    ['floor-plan.dwg', ''],
    ['email.msg', 'application/octet-stream'],
  ])('accepts %s sent as %p', (name, declared) => {
    expect(() => assertAllowedUpload(name, declared)).not.toThrow();
  });

  it.each([
    ['page.html', 'text/html'],
    ['logo.svg', 'image/svg+xml'],
    ['payload.xml', 'application/xml'],
    ['run.exe', 'application/x-msdownload'],
    ['script.js', 'text/javascript'],
    ['budget.xlsm', 'application/vnd.ms-excel.sheet.macroEnabled.12'],
    ['no-extension', 'application/pdf'],
  ])('refuses %s', (name, declared) => {
    expect(() => assertAllowedUpload(name, declared)).toThrow(UnsupportedMediaTypeException);
  });

  it('refuses an allowed extension whose declared type contradicts it', () => {
    // The classic disguise: an HTML page renamed to .pdf, sent with its real type.
    expect(() => assertAllowedUpload('invoice.pdf', 'text/html')).toThrow(/does not match its \.pdf extension/);
    expect(() => assertAllowedUpload('photo.png', 'image/svg+xml')).toThrow(UnsupportedMediaTypeException);
  });

  it('derives the stored type from the extension, never from the browser', () => {
    expect(assertAllowedUpload('scan.JPG', 'application/octet-stream').contentType).toBe('image/jpeg');
    expect(assertAllowedUpload('report.csv', 'text/plain').contentType).toBe('text/csv');
  });

  it('does not treat prototype keys as extensions', () => {
    expect(uploadTypeFor('x.constructor')).toBeNull();
    expect(uploadTypeFor('x.__proto__')).toBeNull();
  });
});

describe('upload policy — how a stored object is served', () => {
  it('lets images and PDFs render inline, with the derived type', () => {
    expect(servingHeadersFor('p1/photo/site-abc.png')).toEqual({ contentType: 'image/png' });
    expect(servingHeadersFor('p1/deed/deed-abc.pdf')).toEqual({ contentType: 'application/pdf' });
  });

  it('forces everything else to download', () => {
    const docx = servingHeadersFor('p1/contract/lease-abc.docx', 'Lease – Unit 4.docx');
    expect(docx.contentType).toBe('application/vnd.openxmlformats-officedocument.wordprocessingml.document');
    expect(docx.disposition).toMatch(/^attachment; /);
    expect(docx.disposition).toContain("filename*=UTF-8''Lease%20%E2%80%93%20Unit%204.docx");
  });

  it('neutralises a legacy object stored before the policy (e.g. an .html upload)', () => {
    const legacy = servingHeadersFor('p1/general/file-abc.html');
    expect(legacy.contentType).toBe('application/octet-stream');
    expect(legacy.disposition).toMatch(/^attachment; filename="file-abc.html"/);
  });

  it('keeps the disposition header injection-proof', () => {
    const header = attachmentDisposition('a"b\r\nSet-Cookie: x.pdf');
    expect(header).not.toMatch(/[\r\n]/);
    expect(header).toMatch(/^attachment; filename="a_b  Set-Cookie: x.pdf"/);
  });
});

describe('StorageService', () => {
  const makeService = () => {
    const service = new StorageService(new ConfigService({ S3_BUCKET: 'test-bucket', AWS_REGION: 'us-east-1' }));
    const driver = {
      upload: jest.fn().mockResolvedValue({ publicUrl: 'https://bucket/x' }),
      delete: jest.fn(),
      signedUrl: jest.fn().mockResolvedValue('https://signed'),
      createPresignedUpload: jest.fn().mockResolvedValue({ uploadUrl: 'https://put', token: '' }),
      getObject: jest.fn(),
    };
    (service as any).driver = driver;
    return { service, driver };
  };

  it('refuses a disallowed upload before anything reaches the bucket', async () => {
    const { service, driver } = makeService();
    await expect(service.upload(Buffer.from('<script>'), 'text/html', 'x.html', {})).rejects.toThrow(
      UnsupportedMediaTypeException,
    );
    expect(driver.upload).not.toHaveBeenCalled();
  });

  it('writes the derived content type, not the declared one, and returns it', async () => {
    const { service, driver } = makeService();
    const out = await service.upload(Buffer.from('x'), 'application/octet-stream', 'IMG_1.heic', { projectId: 'p1' });
    expect(driver.upload).toHaveBeenCalledWith(expect.any(Buffer), 'image/heic', expect.stringMatching(/^p1\/general\/file-.*\.heic$/));
    expect(out.contentType).toBe('image/heic');
  });

  it('signs GETs with attachment for non-inline types and the human file name', async () => {
    const { service, driver } = makeService();
    await service.signedUrl('p1/contract/x.docx', 3600, { downloadName: 'Lease.docx' });
    expect(driver.signedUrl).toHaveBeenCalledWith('p1/contract/x.docx', 3600, {
      contentType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      contentDisposition: expect.stringMatching(/^attachment; filename="Lease.docx"/),
    });

    await service.signedUrl('p1/photo/x.jpg');
    expect(driver.signedUrl).toHaveBeenLastCalledWith('p1/photo/x.jpg', 3600, {
      contentType: 'image/jpeg',
      contentDisposition: undefined,
    });
  });

  it('binds a presigned PUT to the derived type and the declared size', async () => {
    const { service, driver } = makeService();
    const out = await service.createPresignedUpload('plans.pdf', { projectId: 'p1' }, { contentType: 'application/pdf', size: 1234 });
    expect(driver.createPresignedUpload).toHaveBeenCalledWith(expect.stringMatching(/\.pdf$/), 'application/pdf', 1234);
    expect(out.contentType).toBe('application/pdf');
  });

  it('refuses a presigned PUT over the size cap, or of a disallowed type', async () => {
    const { service, driver } = makeService();
    await expect(
      service.createPresignedUpload('big.pdf', {}, { contentType: 'application/pdf', size: MAX_PRESIGNED_UPLOAD_BYTES + 1 }),
    ).rejects.toThrow(PayloadTooLargeException);
    await expect(
      service.createPresignedUpload('x.svg', {}, { contentType: 'image/svg+xml', size: 10 }),
    ).rejects.toThrow(UnsupportedMediaTypeException);
    expect(driver.createPresignedUpload).not.toHaveBeenCalled();
  });
});

/**
 * The S3 driver's signatures, computed offline with throwaway credentials — getSignedUrl
 * never touches the network, so this asserts what S3 will actually enforce.
 */
describe('S3StorageDriver — signed URLs', () => {
  const env = { ...process.env };
  beforeAll(() => {
    process.env.AWS_ACCESS_KEY_ID = 'AKIAIOSFODNN7EXAMPLE';
    process.env.AWS_SECRET_ACCESS_KEY = 'wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY';
  });
  afterAll(() => {
    process.env = env;
  });
  const driver = () => new S3StorageDriver(new ConfigService({ S3_BUCKET: 'test-bucket', AWS_REGION: 'us-east-1' }));

  it('signs Content-Type and Content-Length into a presigned PUT, so S3 refuses any other body', async () => {
    const { uploadUrl } = await driver().createPresignedUpload('p1/general/x.pdf', 'application/pdf', 1234);
    const signed = new URL(uploadUrl).searchParams.get('X-Amz-SignedHeaders') ?? '';
    expect(signed.split(';')).toEqual(expect.arrayContaining(['content-type', 'content-length', 'host']));
  });

  it('puts the response overrides on a signed GET', async () => {
    const url = await driver().signedUrl('p1/general/x.html', 60, {
      contentType: 'application/octet-stream',
      contentDisposition: 'attachment; filename="x.html"',
    });
    const params = new URL(url).searchParams;
    expect(params.get('response-content-disposition')).toBe('attachment; filename="x.html"');
    expect(params.get('response-content-type')).toBe('application/octet-stream');
  });
});

describe('isSafeStorageKey', () => {
  it.each(['p1/photo/site-1.jpg', 'misc/general/file-abc.pdf'])('accepts %s', (key) => {
    expect(isSafeStorageKey(key)).toBe(true);
  });

  it.each([
    '../other/deed.pdf', 'p1/../../x', '/etc/passwd', '\\\\server\\share', 'https://evil.example/x.jpg',
    's3://bucket/key', 'data:image/png;base64,AAAA', '', '   ', 42,
  ])('refuses %p', (key) => {
    expect(isSafeStorageKey(key)).toBe(false);
  });
});
