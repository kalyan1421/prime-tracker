/**
 * The destructive half of a Site Tracker row: clear its checklist, or take the unit off
 * the board entirely.
 *
 * The board shipped with "Track a unit" and no reverse, so the two mistakes it makes most
 * often had no remedy on the screen where they are made:
 *
 *   WRONG CHECKLIST — a unit seeded from the wrong stage list. applyTemplate is one-time
 *   only, so the forty wrong stages could not be replaced, only deleted one trash icon at
 *   a time — and forty deletes against a 10 req/sec throttle stops partway through.
 *
 *   WRONG UNIT — a unit put on the tracker that was never going to be built. Clearing the
 *   fields by hand does not remove it: the grid calls a unit tracked if ANY of four signals
 *   is set, so a half-cleared unit sits there looking like live work with nothing on it.
 *
 * Both confirmations count what is actually about to go, from the row already on screen —
 * "18 stages" reads differently when 11 of them are done, and that is precisely the case
 * where someone should stop. They also name what does NOT happen, because that is the part
 * people get wrong: neither action deletes the unit, and neither deletes what anyone said
 * about it.
 */
import { useState } from 'react';
import {
  Button, Dropdown, DropdownTrigger, DropdownMenu, DropdownItem, Tooltip,
  Modal, ModalContent, ModalHeader, ModalBody, ModalFooter, addToast,
} from '@heroui/react';
import { FiMoreHorizontal } from 'react-icons/fi';
import { useClearUnitChecklist, useUntrackUnit } from '../hooks/useApi';
import { errMsg } from '../utils/fmt';

export interface SiteTrackerRowSummary {
  id: string;
  unitNumber: string;
  totalStages: number;
  doneStages: number;
  updateCount?: number;
  assigneeCount: number;
  blockerStatus: string | null;
  sitePriority: string | null;
}

type Action = 'clear' | 'untrack';

export function SiteTrackerRowActions({
  row, canEditChecklist, canEditTracker,
}: {
  row: SiteTrackerRowSummary;
  canEditChecklist: boolean;
  /** siteTracker:edit. Untracking needs both, because it does both jobs. */
  canEditTracker: boolean;
}) {
  const [confirm, setConfirm] = useState<Action | null>(null);
  const clear = useClearUnitChecklist();
  const untrack = useUntrackUnit();

  const canClear = canEditChecklist;
  const canUntrack = canEditChecklist && canEditTracker;
  if (!canClear && !canUntrack) return null;

  const hasStages = row.totalStages > 0;

  const run = async (action: Action) => {
    try {
      if (action === 'clear') {
        const res = await clear.mutateAsync({ unitId: row.id });
        addToast({
          title: `Checklist cleared — ${res.deleted} stage${res.deleted === 1 ? '' : 's'} removed`,
          description: res.updatesUnpinned > 0
            ? `${res.updatesUnpinned} update${res.updatesUnpinned === 1 ? '' : 's'} kept, no longer pinned to a stage.`
            : undefined,
          color: 'success',
        });
      } else {
        const res = await untrack.mutateAsync({ unitId: row.id });
        addToast({
          title: `Unit ${row.unitNumber} is off the tracker`,
          description: res.stagesDeleted > 0
            ? `${res.stagesDeleted} stage${res.stagesDeleted === 1 ? '' : 's'} removed. The unit is still in inventory.`
            : 'The unit is still in inventory.',
          color: 'success',
        });
      }
      setConfirm(null);
    } catch (e) {
      addToast({
        title: errMsg(e, action === 'clear' ? 'Could not clear the checklist' : 'Could not remove the unit'),
        color: 'danger',
      });
    }
  };

  const pending = clear.isPending || untrack.isPending;

  return (
    <>
      <Dropdown placement="bottom-end">
        <DropdownTrigger>
          <button
            type="button"
            aria-label={`More actions for unit ${row.unitNumber}`}
            className="rounded p-0.5 text-gray-500 hover:bg-gray-100 hover:text-gray-700"
          >
            <FiMoreHorizontal size={12} />
          </button>
        </DropdownTrigger>
        <DropdownMenu
          aria-label={`Actions for unit ${row.unitNumber}`}
          disabledKeys={hasStages ? [] : ['clear']}
          onAction={(key) => setConfirm(key as Action)}
        >
          {[
            ...(canClear ? [(
              <DropdownItem
                key="clear"
                textValue="Clear checklist"
                description={hasStages
                  ? `Removes all ${row.totalStages} stages, keeps the unit on the board`
                  : 'This unit has no checklist'}
              >
                Clear checklist
              </DropdownItem>
            )] : []),
            ...(canUntrack ? [(
              <DropdownItem
                key="untrack"
                textValue="Remove from tracker"
                className="text-danger"
                color="danger"
                description="Takes the unit off this board. It stays in inventory."
              >
                Remove from tracker
              </DropdownItem>
            )] : []),
          ]}
        </DropdownMenu>
      </Dropdown>

      <Modal isOpen={confirm !== null} onClose={() => !pending && setConfirm(null)} size="lg">
        <ModalContent>
          {confirm === 'clear' ? (
            <>
              <ModalHeader className="text-sm">Clear unit {row.unitNumber}'s checklist?</ModalHeader>
              <ModalBody className="gap-3 text-sm text-gray-700">
                <WhatGoes
                  lines={[
                    `All ${row.totalStages} stage${row.totalStages === 1 ? '' : 's'}`
                      + (row.doneStages > 0
                        ? ` — including ${row.doneStages} marked done, with their status, dates, inspections and notes`
                        : ', with their status, dates, inspections and notes'),
                    'Any photos attached to those stages',
                  ]}
                />
                <WhatStays
                  lines={[
                    'The unit, and everything else about it',
                    row.updateCount
                      ? `Its ${row.updateCount} site update${row.updateCount === 1 ? '' : 's'} — they stay on the feed and lose only their stage pin`
                      : 'Its site updates',
                    'Its place on this board — blocker, priority and owners are untouched',
                  ]}
                />
                <p className="text-xs text-gray-500">
                  Add stages again from the checklist, or from Track a unit.
                </p>
              </ModalBody>
              <ModalFooter>
                <Button size="sm" variant="light" onPress={() => setConfirm(null)} isDisabled={pending}>
                  Cancel
                </Button>
                <Button size="sm" color="danger" onPress={() => run('clear')} isLoading={clear.isPending}>
                  Clear {row.totalStages} stage{row.totalStages === 1 ? '' : 's'}
                </Button>
              </ModalFooter>
            </>
          ) : (
            <>
              <ModalHeader className="text-sm">Remove unit {row.unitNumber} from the tracker?</ModalHeader>
              <ModalBody className="gap-3 text-sm text-gray-700">
                <WhatGoes
                  lines={[
                    ...(row.totalStages > 0
                      ? [`Its checklist — ${row.totalStages} stage${row.totalStages === 1 ? '' : 's'}`
                          + (row.doneStages > 0 ? `, ${row.doneStages} of them done` : '')
                          + ', and any photos on them']
                      : []),
                    ...(row.blockerStatus === 'YES' ? ['Its blocker, and the reason recorded for it'] : []),
                    ...(row.assigneeCount > 0
                      ? [`Its ${row.assigneeCount} site owner${row.assigneeCount === 1 ? '' : 's'}`]
                      : []),
                    ...(row.sitePriority ? ['Its priority'] : []),
                    'The row itself — this unit stops appearing on the Site Tracker',
                  ]}
                />
                <WhatStays
                  lines={[
                    'The unit itself — its number, size, status, lease and sale are untouched, and it stays in inventory',
                    row.updateCount
                      ? `Its ${row.updateCount} site update${row.updateCount === 1 ? '' : 's'}, readable from the unit page`
                      : 'Any site updates, readable from the unit page',
                  ]}
                />
                <p className="text-xs text-gray-500">
                  Track a unit puts it back, with a fresh checklist.
                </p>
              </ModalBody>
              <ModalFooter>
                <Button size="sm" variant="light" onPress={() => setConfirm(null)} isDisabled={pending}>
                  Cancel
                </Button>
                <Button size="sm" color="danger" onPress={() => run('untrack')} isLoading={untrack.isPending}>
                  Remove from tracker
                </Button>
              </ModalFooter>
            </>
          )}
        </ModalContent>
      </Modal>
    </>
  );
}

function WhatGoes({ lines }: { lines: string[] }) {
  return (
    <div className="rounded-md border border-red-200 bg-red-50 px-3 py-2">
      <p className="text-xs font-semibold text-red-800">This deletes</p>
      <ul className="mt-1 list-disc pl-4 text-xs text-red-800 space-y-0.5">
        {lines.map((l) => <li key={l}>{l}</li>)}
      </ul>
    </div>
  );
}

function WhatStays({ lines }: { lines: string[] }) {
  return (
    <div className="rounded-md border border-gray-200 bg-gray-50 px-3 py-2">
      <p className="text-xs font-semibold text-gray-700">This keeps</p>
      <ul className="mt-1 list-disc pl-4 text-xs text-gray-700 space-y-0.5">
        {lines.map((l) => <li key={l}>{l}</li>)}
      </ul>
    </div>
  );
}
