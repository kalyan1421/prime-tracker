import { ValidateBy, ValidationOptions, buildMessage } from 'class-validator';

/**
 * A bucket key our own upload flow produced: relative, no traversal, not a URL.
 *
 * Every route that records a `storagePath` the browser hands back (after uploading through
 * /documents/upload-file or a presigned PUT) feeds it straight to the storage signer, so a
 * value like `../other-tenant/deed.pdf`, `/etc/passwd` or `https://evil.example/x` must be
 * refused before it is stored. The tasks, daily-logs, update-board, checklist and interior
 * services each carried this exact check inline; it lives here so a DTO can apply it too,
 * and a route that forgot the service-level copy (milestone photos, draw documents,
 * building covers) is covered at the boundary.
 */
export function isSafeStorageKey(value: unknown): boolean {
  if (typeof value !== 'string') return false;
  const path = value.trim();
  if (!path || path.length > 1024) return false;
  if (path.startsWith('/') || path.startsWith('\\')) return false;
  if (path.includes('..')) return false;
  if (/^[a-z][a-z0-9+.-]*:/i.test(path)) return false; // any scheme: http:, https:, s3:, data:, file:…
  return true;
}

/** class-validator decorator for isSafeStorageKey. */
export function IsStorageKey(options?: ValidationOptions): PropertyDecorator {
  return ValidateBy(
    {
      name: 'isStorageKey',
      validator: {
        validate: (value) => isSafeStorageKey(value),
        defaultMessage: buildMessage(
          (each) => `${each}$property must be a storage key returned by the upload endpoint (relative path, no "..", not a URL)`,
          options,
        ),
      },
    },
    options,
  );
}
