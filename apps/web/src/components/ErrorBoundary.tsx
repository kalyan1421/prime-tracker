import React from 'react';
import { Button, Card, CardBody } from '@heroui/react';
import { FiAlertOctagon, FiRefreshCw } from 'react-icons/fi';

/**
 * Catches render and lifecycle errors in the subtree below it so a single broken
 * component (or stale API shape) doesn't blank the entire app.
 *
 * Use at multiple granularities:
 *   - <ErrorBoundary> around the router (last-resort safety net)
 *   - <ErrorBoundary> around each page section (Dashboard tab, Project tab, etc.)
 * Prefer fine-grained boundaries — they keep the rest of the page usable.
 *
 * Note: error boundaries do NOT catch errors in event handlers, async code, or SSR.
 * For async/network errors, surface them via TanStack Query's onError + toast.
 */
interface Props {
  children: React.ReactNode;
  fallback?: React.ReactNode;
  /** Label shown in the default fallback so it's clear which section crashed. */
  section?: string;
  /** Called with the error so the parent can log to Sentry/etc. */
  onError?: (err: Error, info: React.ErrorInfo) => void;
}

interface State {
  error: Error | null;
}

export class ErrorBoundary extends React.Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: React.ErrorInfo) {
    // eslint-disable-next-line no-console
    console.error('[ErrorBoundary] caught error in', this.props.section ?? 'unknown', error, info);
    this.props.onError?.(error, info);
  }

  reset = () => this.setState({ error: null });

  render() {
    if (this.state.error) {
      if (this.props.fallback) return this.props.fallback;

      return (
        <Card shadow="sm" className="bg-red-50 border border-red-200">
          <CardBody className="p-6 flex items-start gap-4">
            <FiAlertOctagon className="text-red-600 flex-shrink-0 mt-1" size={24} />
            <div className="flex-1">
              <h3 className="font-semibold text-red-900">
                Something went wrong{this.props.section ? ` in ${this.props.section}` : ''}
              </h3>
              <p className="text-sm text-red-700 mt-1">
                {this.state.error.message || 'An unexpected error occurred.'}
              </p>
              <p className="text-xs text-red-700 mt-2">
                The rest of the app should still work — try refreshing this section.
              </p>
              <Button
                size="sm"
                color="danger"
                variant="flat"
                className="mt-3"
                startContent={<FiRefreshCw />}
                onPress={this.reset}
              >
                Retry
              </Button>
            </div>
          </CardBody>
        </Card>
      );
    }
    return this.props.children;
  }
}
