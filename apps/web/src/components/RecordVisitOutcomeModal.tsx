import { useState } from 'react';
import {
  Modal, ModalContent, ModalHeader, ModalBody, ModalFooter, Button, Textarea, addToast,
} from '@heroui/react';
import { FiCheckCircle, FiUserX } from 'react-icons/fi';
import { useRecordVisitOutcome } from '../hooks/useApi';
import { errMsg } from '../utils/fmt';

/**
 * What happened at the visit.
 *
 * Both outcomes close the visit — a no-show is a recorded fact, not an unresolved one —
 * which is what stops the daily missed-visit sweep chasing it forever. Both also write
 * onto the lead's activity timeline, because that is where reps actually read a lead's
 * history.
 */
export function RecordVisitOutcomeModal({
  isOpen, onClose, visit,
}: { isOpen: boolean; onClose: () => void; visit: any }) {
  const [result, setResult] = useState<'COMPLETED' | 'NO_SHOW'>('COMPLETED');
  const [note, setNote] = useState('');
  const record = useRecordVisitOutcome();

  const submit = async () => {
    try {
      await record.mutateAsync({ id: visit.id, result, note: note.trim() || undefined });
      addToast({ title: 'Outcome recorded', color: 'success' });
      setNote(''); setResult('COMPLETED');
      onClose();
    } catch (e) {
      addToast({ title: errMsg(e, 'Could not record the outcome'), color: 'danger' });
    }
  };

  const option = (
    value: 'COMPLETED' | 'NO_SHOW', Icon: any, title: string, sub: string,
  ) => (
    <button
      type="button"
      onClick={() => setResult(value)}
      aria-pressed={result === value}
      className={`flex-1 text-left p-3 rounded-lg border transition-colors ${
        result === value
          ? 'border-blue-400 bg-blue-50'
          : 'border-gray-200 bg-white hover:bg-gray-50'
      }`}
    >
      <span className="flex items-center gap-2 text-sm font-medium text-gray-900">
        <Icon className="w-4 h-4" aria-hidden="true" /> {title}
      </span>
      <span className="block text-xs text-gray-600 mt-0.5">{sub}</span>
    </button>
  );

  return (
    <Modal isOpen={isOpen} onClose={onClose} size="md">
      <ModalContent>
        <ModalHeader className="flex flex-col gap-1">
          <span className="text-base">Record what happened</span>
          <span className="text-xs font-normal text-gray-500">
            {visit?.lead?.name || 'Unnamed lead'}
          </span>
        </ModalHeader>
        <ModalBody className="gap-3">
          <div className="flex gap-2">
            {option('COMPLETED', FiCheckCircle, 'Visit happened', 'They came and saw the property')}
            {option('NO_SHOW', FiUserX, 'No-show', 'They did not turn up')}
          </div>
          <Textarea
            size="sm"
            label="Notes"
            labelPlacement="outside"
            placeholder={result === 'COMPLETED'
              ? 'e.g. liked the corner unit, asked about payment terms'
              : 'e.g. called twice, no answer'}
            value={note}
            onChange={(e) => setNote(e.target.value)}
            description="This goes on the lead's timeline."
          />
        </ModalBody>
        <ModalFooter>
          <Button size="sm" variant="light" onPress={onClose}>Cancel</Button>
          <Button size="sm" color="primary" onPress={submit} isLoading={record.isPending}>
            Save outcome
          </Button>
        </ModalFooter>
      </ModalContent>
    </Modal>
  );
}
