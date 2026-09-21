import { useState } from 'react';
import { Card, CardBody, CardHeader, Button, Chip, Textarea, Modal, ModalContent, ModalHeader, ModalBody, ModalFooter, addToast } from '@heroui/react';
import { FiEye, FiCheck, FiX, FiClock, FiAlertTriangle, FiCalendar, FiRotateCcw } from 'react-icons/fi';
import { useSiteVisitAttention, useDecideSiteVisit } from '../hooks/useApi';
import { errMsg } from '../utils/fmt';

/**
 * "Site Visits — needs attention". The card the client asked for: pending viewing
 * requests visible on the main dashboard rather than buried in the Leads page.
 *
 * Two audiences, one card:
 *   approvers -> everything awaiting their decision, with Confirm/Reject inline
 *   reps      -> their own pending, upcoming, and rejected-or-missed visits
 *
 * It renders NOTHING when the queue is empty. A dashboard full of empty zero-states
 * teaches people to stop reading it.
 */

function hoursUntil(iso: string) {
  return (new Date(iso).getTime() - Date.now()) / 3_600_000;
}

/** Undecided and imminent is the case that actually costs a deal, so it escalates. */
function severityOf(v: any): 'critical' | 'warning' | 'info' {
  if (v.status === 'REJECTED') return 'critical';
  const h = hoursUntil(v.startsAt);
  if (v.status === 'CONFIRMED' && h < 0 && !v.completedAt) return 'critical';
  if (h < 48) return 'critical';
  if (h < 24 * 7) return 'warning';
  return 'info';
}

const SEV_STYLE: Record<string, string> = {
  critical: 'bg-red-50 border-red-200',
  warning: 'bg-amber-50 border-amber-200',
  info: 'bg-blue-50 border-blue-200',
};
const SEV_ICON: Record<string, any> = {
  critical: FiAlertTriangle, warning: FiClock, info: FiCalendar,
};

function whenLabel(v: any) {
  try {
    return new Intl.DateTimeFormat('en-US', {
      timeZone: v.timezone || 'America/Chicago',
      weekday: 'short', day: 'numeric', month: 'short',
      hour: 'numeric', minute: '2-digit', hour12: true,
    }).format(new Date(v.startsAt));
  } catch {
    return new Date(v.startsAt).toLocaleString();
  }
}

function propertyLabel(v: any) {
  if (v.unit) return `Unit ${v.unit.unitNumber}`;
  if (v.building) return v.building.name;
  return v.project?.name ?? null;
}

function relativeAge(iso: string) {
  const mins = Math.round((Date.now() - new Date(iso).getTime()) / 60_000);
  if (mins < 60) return `${Math.max(1, mins)}m ago`;
  const hrs = Math.round(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  return `${Math.round(hrs / 24)}d ago`;
}

export function SiteVisitAttentionCard() {
  const { data, isLoading } = useSiteVisitAttention();
  const decide = useDecideSiteVisit();
  const [rejecting, setRejecting] = useState<any>(null);
  const [reason, setReason] = useState('');

  if (isLoading || !data) return null;
  const items: any[] = data.role === 'approver' ? (data.pending ?? []) : (data.mine ?? []);
  if (items.length === 0) return null;

  const isApprover = data.role === 'approver';

  const confirm = async (v: any) => {
    try {
      await decide.mutateAsync({ id: v.id, confirmed: true });
      addToast({ title: 'Site visit confirmed', color: 'success' });
    } catch (e) {
      addToast({ title: errMsg(e, 'Could not confirm the visit'), color: 'danger' });
    }
  };

  const submitRejection = async () => {
    if (!reason.trim()) {
      addToast({ title: 'Give a reason so the rep knows whether to rebook', color: 'warning' });
      return;
    }
    try {
      await decide.mutateAsync({ id: rejecting.id, confirmed: false, decisionNote: reason.trim() });
      addToast({ title: 'Site visit rejected', color: 'success' });
      setRejecting(null);
      setReason('');
    } catch (e) {
      addToast({ title: errMsg(e, 'Could not reject the visit'), color: 'danger' });
    }
  };

  return (
    <>
      <Card shadow="sm">
        <CardHeader className="pb-2">
          <div className="flex items-center justify-between w-full gap-2">
            <div className="flex items-center gap-2">
              <FiEye className="text-blue-600" aria-hidden="true" />
              <p className="font-semibold text-sm text-blue-700">
                {isApprover ? 'Site Visits — Awaiting Your Confirmation' : 'Your Site Visits'}
              </p>
            </div>
            <Chip size="sm" variant="flat" color={isApprover ? 'warning' : 'primary'}>{items.length}</Chip>
          </div>
        </CardHeader>
        <CardBody className="pt-0 space-y-2">
          {items.map((v) => {
            const sev = severityOf(v);
            const Icon = SEV_ICON[sev];
            const prop = propertyLabel(v);
            const overdueOutcome = v.status === 'CONFIRMED' && hoursUntil(v.startsAt) < 0 && !v.completedAt;
            return (
              <div key={v.id} className={`flex items-start gap-3 p-3 rounded-lg border ${SEV_STYLE[sev]}`}>
                <Icon className="mt-0.5 shrink-0 text-gray-700" size={16} aria-hidden="true" />
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="text-sm font-medium text-gray-900">
                      {v.lead?.name || 'Unnamed lead'}
                    </span>
                    {prop && <span className="text-xs text-gray-700">· {prop}</span>}
                    <span className="text-xs font-medium text-gray-900 tabular-nums">{whenLabel(v)}</span>
                    {!isApprover && (
                      <Chip size="sm" variant="flat" color={
                        v.status === 'REJECTED' ? 'danger'
                          : v.status === 'CONFIRMED' ? 'success' : 'warning'
                      }>
                        {v.status === 'REQUESTED' ? 'Awaiting confirmation' : v.status.replace('_', ' ')}
                      </Chip>
                    )}
                  </div>
                  <p className="text-xs text-gray-700 mt-0.5">
                    {isApprover
                      ? `Requested by ${v.requestedBy?.name ?? 'someone'} · ${relativeAge(v.requestedAt)}`
                      : v.status === 'REJECTED'
                        ? `Rejected${v.decisionNote ? `: “${v.decisionNote}”` : ''} — rebook when you can`
                        : overdueOutcome
                          ? 'This visit has passed — record what happened or rebook it'
                          : `Host: ${v.host?.name ?? '—'}`}
                    {isApprover && v.requestNote ? ` · “${v.requestNote}”` : ''}
                  </p>
                </div>
                {isApprover && (
                  <div className="flex items-center gap-1 shrink-0">
                    <Button
                      size="sm" color="success" variant="flat"
                      startContent={<FiCheck className="w-3.5 h-3.5" />}
                      onPress={() => confirm(v)}
                      isDisabled={decide.isPending}
                      aria-label={`Confirm site visit for ${v.lead?.name || 'lead'}`}
                    >
                      Confirm
                    </Button>
                    <Button
                      size="sm" color="danger" variant="light"
                      startContent={<FiX className="w-3.5 h-3.5" />}
                      onPress={() => { setRejecting(v); setReason(''); }}
                      isDisabled={decide.isPending}
                      aria-label={`Reject site visit for ${v.lead?.name || 'lead'}`}
                    >
                      Reject
                    </Button>
                  </div>
                )}
                {!isApprover && v.status === 'REJECTED' && (
                  <FiRotateCcw className="mt-0.5 shrink-0 text-red-500" size={14} aria-hidden="true" />
                )}
              </div>
            );
          })}
        </CardBody>
      </Card>

      <Modal isOpen={!!rejecting} onClose={() => setRejecting(null)} size="md">
        <ModalContent>
          <ModalHeader className="text-base">Reject this site visit</ModalHeader>
          <ModalBody>
            <p className="text-sm text-gray-700">
              {rejecting?.lead?.name} · {rejecting && whenLabel(rejecting)}
            </p>
            <Textarea
              size="sm"
              label="Reason"
              labelPlacement="outside"
              placeholder="e.g. travelling that week — try the following Tuesday"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              description="The rep sees this, so say whether to rebook."
              isRequired
            />
          </ModalBody>
          <ModalFooter>
            <Button size="sm" variant="light" onPress={() => setRejecting(null)}>Cancel</Button>
            <Button size="sm" color="danger" onPress={submitRejection} isLoading={decide.isPending}>
              Reject visit
            </Button>
          </ModalFooter>
        </ModalContent>
      </Modal>
    </>
  );
}
