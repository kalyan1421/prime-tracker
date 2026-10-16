import { useEffect, useState } from 'react';
import {
  Modal, ModalContent, ModalHeader, ModalBody, ModalFooter, Button, Input, Select, SelectItem,
  Textarea, addToast,
} from '@heroui/react';
import { useUpdateLeadActivity } from '../hooks/useApi';
import { errMsg } from '../utils/fmt';

const ACTIVITY_TYPES = ['CALL', 'EMAIL', 'MEETING', 'SITE_VISIT', 'FOLLOW_UP', 'NOTE', 'STATUS_CHANGE'];

/** YYYY-MM-DD of an instant in the viewer's own timezone — what a date input shows. */
function localYmd(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/**
 * Correcting an entry on a lead's activity timeline — the wrong type picked, a typo in
 * the note, or a call logged against the wrong day. Shared by the Leads page and the
 * project Leads tab so the two timelines cannot drift apart.
 *
 * Only the fields that actually changed are sent, so opening the modal and saving
 * without touching the date never rewrites the time of day it was originally logged at.
 */
export function EditLeadActivityModal({
  activity, leadId, onClose,
}: { activity: any | null; leadId: string; onClose: () => void }) {
  const update = useUpdateLeadActivity();
  const [type, setType] = useState('NOTE');
  const [note, setNote] = useState('');
  const [date, setDate] = useState('');

  const originalDate = activity ? localYmd(new Date(activity.occurredAt ?? activity.createdAt)) : '';

  useEffect(() => {
    if (!activity) return;
    setType(activity.type);
    setNote(activity.note ?? '');
    setDate(originalDate);
  }, [activity?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  const today = localYmd(new Date());

  const save = async () => {
    if (!activity) return;
    const data: Record<string, unknown> = {};
    if (type !== activity.type) data.type = type;
    if (note.trim() !== (activity.note ?? '')) data.note = note.trim();
    if (date && date !== originalDate) {
      // Noon local, matching the call calendar's back-dating: a date-only value stored at
      // midnight can land on the previous day once read back in another timezone. Today
      // uses "now" instead, because noon is still in the future every morning and the API
      // refuses future-dated activities.
      data.occurredAt = date === today
        ? new Date().toISOString()
        : new Date(`${date}T12:00:00`).toISOString();
    }
    if (Object.keys(data).length === 0) { onClose(); return; }

    try {
      await update.mutateAsync({ leadId, activityId: activity.id, data });
      addToast({ title: 'Activity updated', color: 'success' });
      onClose();
    } catch (e) {
      addToast({ title: errMsg(e, 'Could not update the activity'), color: 'danger' });
    }
  };

  return (
    <Modal isOpen={!!activity} onClose={onClose} size="md">
      <ModalContent>
        <ModalHeader className="text-base">Edit activity</ModalHeader>
        <ModalBody className="gap-3">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <Select
              size="sm"
              label="Activity Type"
              labelPlacement="outside"
              selectedKeys={new Set([type])}
              onSelectionChange={(keys) => {
                const next = Array.from(keys)[0] as string | undefined;
                if (next) setType(next);
              }}
            >
              {ACTIVITY_TYPES.map((t) => (
                <SelectItem key={t} textValue={t.replace('_', ' ')}>{t.replace('_', ' ')}</SelectItem>
              ))}
            </Select>
            <Input
              size="sm"
              type="date"
              label="Date"
              labelPlacement="outside"
              value={date}
              max={today}
              onChange={(e) => setDate(e.target.value)}
            />
          </div>
          <Textarea
            size="sm"
            label="Notes"
            labelPlacement="outside"
            value={note}
            onChange={(e) => setNote(e.target.value)}
            minRows={3}
            maxLength={2000}
          />
        </ModalBody>
        <ModalFooter>
          <Button size="sm" variant="light" onPress={onClose}>Cancel</Button>
          <Button
            size="sm"
            color="primary"
            onPress={save}
            isLoading={update.isPending}
            isDisabled={!note.trim() || !date || date > today}
          >
            Save
          </Button>
        </ModalFooter>
      </ModalContent>
    </Modal>
  );
}
