import { useState } from 'react';
import {
  Modal, ModalContent, ModalHeader, ModalBody, ModalFooter,
  Button, Input,
} from '@heroui/react';
import { FiShield, FiAlertTriangle } from 'react-icons/fi';
import { useMfaStepUpStore } from '../store/mfaStepUpStore';
import { useMfaVerify } from '../hooks/useApi';
import { useAuthStore } from '../store/authStore';

/**
 * App-wide MFA "step-up" modal. Mounted once near the app root (see
 * Layout.tsx). It has no props — it's entirely driven by `mfaStepUpStore`,
 * which the axios interceptor in `lib/api.ts` flips on whenever any request
 * comes back with the 403 "MFA verification required" response. This makes
 * the flow generic: any `@RequireMfa()`-gated endpoint (loans, users,
 * quickbooks, or anything added later) gets this prompt automatically,
 * with zero special-casing in the feature code that made the request.
 */
export default function MfaStepUpModal() {
  const pending = useMfaStepUpStore((s) => s.pending);
  const resolveMfaStepUp = useMfaStepUpStore((s) => s.resolveMfaStepUp);
  const rejectMfaStepUp = useMfaStepUpStore((s) => s.rejectMfaStepUp);

  const user = useAuthStore((s) => s.user);
  const updateTokens = useAuthStore((s) => s.updateTokens);
  const setMfaVerified = useAuthStore((s) => s.setMfaVerified);

  const [token, setToken] = useState('');
  const [error, setError] = useState('');
  const mfaVerify = useMfaVerify();

  const mfaEnabled = !!user?.mfaEnabled;

  const reset = () => {
    setToken('');
    setError('');
  };

  const handleVerify = async () => {
    if (token.length !== 6) return;
    setError('');
    try {
      const { accessToken, refreshToken } = await mfaVerify.mutateAsync(token);
      updateTokens(accessToken, refreshToken);
      setMfaVerified(true);
      reset();
      // Drains the queue — every request waiting on this step-up retries
      // now, picking up the fresh token via the request interceptor.
      resolveMfaStepUp();
    } catch {
      // Invalid code — let the user retry. Do NOT reject the queue here;
      // only Cancel should fail the pending request(s).
      setError('Invalid code — please try again.');
      setToken('');
    }
  };

  const handleCancel = () => {
    reset();
    rejectMfaStepUp(new Error('MFA verification cancelled'));
  };

  return (
    <Modal isOpen={pending} onClose={handleCancel} isDismissable={false} size="sm">
      <ModalContent>
        <ModalHeader className="flex items-center gap-2">
          <FiShield className="text-blue-600" />
          Verify It&apos;s You
        </ModalHeader>
        <ModalBody>
          {mfaEnabled ? (
            <div className="space-y-4">
              <p className="text-sm text-gray-600">
                This action requires two-factor verification. Enter the 6-digit code from your
                authenticator app to continue.
              </p>
              <Input
                size="sm"
                label="6-digit code"
                placeholder="000000"
                value={token}
                onChange={(e) => {
                  setToken(e.target.value.replace(/\D/g, '').slice(0, 6));
                  setError('');
                }}
                maxLength={6}
                autoFocus
                onKeyDown={(e) => {
                  if (e.key === 'Enter') handleVerify();
                }}
                classNames={{ input: 'text-center text-xl tracking-[0.4em] font-mono' }}
                isInvalid={!!error}
                errorMessage={error}
              />
            </div>
          ) : (
            <div className="flex items-start gap-2 p-3 bg-amber-50 rounded-lg border border-amber-200">
              <FiAlertTriangle className="text-amber-600 shrink-0 mt-0.5" />
              <p className="text-sm text-amber-700">
                You need to set up two-factor authentication before performing this action. Open
                your profile menu (top right) and choose <strong>&quot;Set Up MFA&quot;</strong> to
                get started, then try again.
              </p>
            </div>
          )}
        </ModalBody>
        <ModalFooter>
          <Button size="sm" variant="light" onPress={handleCancel}>Cancel</Button>
          {mfaEnabled && (
            <Button
              size="sm"
              color="primary"
              onPress={handleVerify}
              isLoading={mfaVerify.isPending}
              isDisabled={token.length !== 6}
            >
              Verify
            </Button>
          )}
        </ModalFooter>
      </ModalContent>
    </Modal>
  );
}
