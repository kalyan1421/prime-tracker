import { useState } from 'react';
import {
  Modal, ModalContent, ModalHeader, ModalBody, ModalFooter,
  Button, Input, Chip, addToast,
} from '@heroui/react';
import { FiShield, FiCheck, FiAlertTriangle } from 'react-icons/fi';
import { useMfaSetup, useMfaEnable } from '../hooks/useApi';
import { useAuthStore } from '../store/authStore';

interface Props {
  isOpen: boolean;
  onClose: () => void;
}

type Step = 'intro' | 'qr' | 'verify' | 'done';

export default function MfaSetupModal({ isOpen, onClose }: Props) {
  const { user } = useAuthStore();
  const [step, setStep] = useState<Step>('intro');
  const [qrCode, setQrCode] = useState('');
  const [secret, setSecret] = useState('');
  const [token, setToken] = useState('');

  const mfaSetup = useMfaSetup();
  const mfaEnable = useMfaEnable();

  const handleStart = async () => {
    try {
      const data = await mfaSetup.mutateAsync();
      setQrCode(data.qrCodeUrl);
      setSecret(data.secret);
      setStep('qr');
    } catch {
      addToast({ title: 'Failed to initialize MFA setup', color: 'danger' });
    }
  };

  const handleVerify = async () => {
    if (token.length !== 6) {
      addToast({ title: 'Enter the 6-digit code from your authenticator app', color: 'warning' });
      return;
    }
    try {
      await mfaEnable.mutateAsync(token);
      setStep('done');
    } catch {
      addToast({ title: 'Invalid code — please try again', color: 'danger' });
      setToken('');
    }
  };

  const handleClose = () => {
    setStep('intro');
    setToken('');
    setQrCode('');
    setSecret('');
    onClose();
  };

  return (
    <Modal isOpen={isOpen} onClose={handleClose} scrollBehavior="inside" size="md" isDismissable={false}>
      <ModalContent>
        {step === 'intro' && (
          <>
            <ModalHeader className="flex items-center gap-2">
              <FiShield className="text-blue-600" />
              Set Up Two-Factor Authentication
            </ModalHeader>
            <ModalBody>
              <div className="space-y-4 text-sm text-gray-600">
                {user?.mfaEnabled ? (
                  <div className="flex items-center gap-2 p-3 bg-green-50 rounded-lg border border-green-200">
                    <FiCheck className="text-green-600 shrink-0" />
                    <p className="text-green-700 font-medium">MFA is already enabled on your account.</p>
                  </div>
                ) : (
                  <div className="flex items-center gap-2 p-3 bg-amber-50 rounded-lg border border-amber-200">
                    <FiAlertTriangle className="text-amber-600 shrink-0" />
                    <p className="text-amber-700">MFA is not yet enabled. Protect your account with an authenticator app.</p>
                  </div>
                )}
                <p>
                  Two-factor authentication adds an extra layer of security. You&apos;ll need a
                  TOTP app like <strong>Google Authenticator</strong>, <strong>Authy</strong>, or
                  <strong> 1Password</strong>.
                </p>
                <ul className="list-disc list-inside space-y-1 text-gray-500">
                  <li>Scan the QR code with your authenticator app</li>
                  <li>Enter the 6-digit code to confirm</li>
                  <li>MFA will be required for sensitive operations</li>
                </ul>
              </div>
            </ModalBody>
            <ModalFooter>
              <Button size="sm" variant="light" onPress={handleClose}>Cancel</Button>
              {!user?.mfaEnabled && (
                <Button size="sm" color="primary" onPress={handleStart} isLoading={mfaSetup.isPending}>
                  Set Up MFA
                </Button>
              )}
              {user?.mfaEnabled && (
                <Button size="sm" variant="light" onPress={handleClose}>Close</Button>
              )}
            </ModalFooter>
          </>
        )}

        {step === 'qr' && (
          <>
            <ModalHeader className="flex items-center gap-2">
              <FiShield className="text-blue-600" />
              Scan QR Code
            </ModalHeader>
            <ModalBody>
              <div className="space-y-4">
                <p className="text-sm text-gray-600">
                  Scan this QR code with your authenticator app, then click Continue.
                </p>
                <div className="flex justify-center p-4 bg-white border-2 border-gray-200 rounded-xl">
                  {qrCode && <img src={qrCode} alt="MFA QR Code" className="w-48 h-48" />}
                </div>
                <div className="p-3 bg-gray-50 rounded-lg">
                  <p className="text-xs text-gray-500 mb-1">Can&apos;t scan? Enter this key manually:</p>
                  <p className="font-mono text-xs text-gray-700 break-all select-all">{secret}</p>
                </div>
              </div>
            </ModalBody>
            <ModalFooter>
              <Button size="sm" variant="light" onPress={() => setStep('intro')}>Back</Button>
              <Button size="sm" color="primary" onPress={() => setStep('verify')}>
                Continue
              </Button>
            </ModalFooter>
          </>
        )}

        {step === 'verify' && (
          <>
            <ModalHeader className="flex items-center gap-2">
              <FiShield className="text-blue-600" />
              Verify Setup
            </ModalHeader>
            <ModalBody>
              <div className="space-y-4">
                <p className="text-sm text-gray-600">
                  Enter the 6-digit code shown in your authenticator app to confirm setup.
                </p>
                <Input
                  size="sm"
                  label="6-digit code"
                  placeholder="000000"
                  value={token}
                  onChange={(e) => setToken(e.target.value.replace(/\D/g, '').slice(0, 6))}
                  maxLength={6}
                  autoFocus
                  onKeyDown={(e) => { if (e.key === 'Enter') handleVerify(); }}
                  classNames={{ input: 'text-center text-xl tracking-[0.4em] font-mono' }}
                />
              </div>
            </ModalBody>
            <ModalFooter>
              <Button size="sm" variant="light" onPress={() => setStep('qr')}>Back</Button>
              <Button
                size="sm"
                color="primary"
                onPress={handleVerify}
                isLoading={mfaEnable.isPending}
                isDisabled={token.length !== 6}
              >
                Verify & Enable
              </Button>
            </ModalFooter>
          </>
        )}

        {step === 'done' && (
          <>
            <ModalHeader className="flex items-center gap-2">
              <FiCheck className="text-green-600" />
              MFA Enabled
            </ModalHeader>
            <ModalBody>
              <div className="space-y-4 text-center py-4">
                <div className="flex justify-center">
                  <div className="w-16 h-16 rounded-full bg-green-100 flex items-center justify-center">
                    <FiCheck className="text-green-600 text-3xl" />
                  </div>
                </div>
                <div>
                  <p className="text-base font-semibold text-gray-800">Two-factor authentication is now active</p>
                  <p className="text-sm text-gray-500 mt-1">
                    Your account is protected. You&apos;ll need your authenticator app for sensitive operations.
                  </p>
                </div>
                <Chip size="sm" color="success" variant="flat" startContent={<FiShield />}>MFA Active</Chip>
              </div>
            </ModalBody>
            <ModalFooter>
              <Button size="sm" color="primary" onPress={handleClose}>Done</Button>
            </ModalFooter>
          </>
        )}
      </ModalContent>
    </Modal>
  );
}
