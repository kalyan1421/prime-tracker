import { Link, useLocation } from 'react-router-dom';
import { Button } from '@heroui/react';
import { FiArrowLeft, FiCompass, FiLock } from 'react-icons/fi';

/**
 * The two dead ends the router can reach, told apart.
 *
 * Both used to be `<Navigate to="/" replace />`: an unknown URL and a page the viewer's role
 * cannot open landed silently on their dashboard, with the URL they clicked gone from the
 * address bar. A stale bookmark, a typo, a link to an archived project and a revoked
 * permission were indistinguishable from each other and from "nothing happened".
 *
 * `reason` is what separates them — "this address does not exist" is a different message from
 * "this page exists and is not yours", and conflating them either teases the viewer with
 * pages they cannot have or hides a real typo behind a permission excuse.
 */
export default function NotFoundPage({ reason = 'not-found' }: { reason?: 'not-found' | 'forbidden' }) {
  const { pathname } = useLocation();
  const forbidden = reason === 'forbidden';

  return (
    <div className="flex justify-center py-16">
      <div className="flex max-w-md flex-col items-center gap-3 text-center">
        <div
          className={`flex h-12 w-12 items-center justify-center rounded-full ${
            forbidden ? 'bg-amber-50 text-amber-700' : 'bg-gray-100 text-gray-500'
          }`}
        >
          {forbidden ? <FiLock className="h-5 w-5" /> : <FiCompass className="h-5 w-5" />}
        </div>

        <p className="text-lg font-semibold text-gray-700">
          {forbidden ? "You don't have access to this page" : 'Page not found'}
        </p>

        <p className="text-sm text-gray-500">
          {forbidden
            ? 'This page exists, but your role does not include it. Ask an admin if you need access.'
            : 'That address does not match anything in Prime Tracker. It may have been renamed, or the record may have been archived.'}
        </p>

        {/* The path itself, so a mistyped or truncated link is obvious at a glance rather
            than something the reader has to reconstruct from memory. */}
        <code className="max-w-full truncate rounded bg-gray-50 px-2 py-1 text-xs text-gray-500">
          {pathname}
        </code>

        <Button
          as={Link}
          to="/"
          size="sm"
          variant="flat"
          className="mt-2"
          startContent={<FiArrowLeft className="text-xs" />}
        >
          Back to dashboard
        </Button>
      </div>
    </div>
  );
}
