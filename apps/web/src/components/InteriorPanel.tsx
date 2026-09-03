import { useState } from 'react';
import { Link } from 'react-router-dom';
import {
  Card, CardBody, CardHeader, Chip, Button, Input, Select, SelectItem,
  Modal, ModalContent, ModalHeader, ModalBody, ModalFooter, Tooltip,
  useDisclosure, addToast,
} from '@heroui/react';
import {
  FiHome, FiPlus, FiArrowRight, FiCheckCircle, FiExternalLink, FiEdit2, FiX, FiCheck, FiAlertTriangle,
} from 'react-icons/fi';
import {
  useInteriorProjects, useCreateInterior, useUpdateInterior,
  useAdvanceInteriorPhase, useApproveInterior, useInteriorTemplates, useUsers, useAssignableUsers,
} from '../hooks/useApi';
import { useAuthStore } from '../store/authStore';
import { fmt, fmtDate, errMsg } from '../utils/fmt';
import { INTERIOR_PHASES } from '../constants/interior';
import { FormError } from './FormError';

export { INTERIOR_PHASES };

const PHASE_LABEL: Record<string, string> = {
  DESIGN: 'Design',
  CLIENT_APPROVAL: 'Client Approval',
  CITY_APPROVAL: 'City Approval',
  PROCUREMENT: 'Procurement',
  EXECUTION: 'Execution',
  SNAGGING: 'Snagging',
  HANDOVER: 'Handover',
};

const CONTRACT_TYPES = ['PER_SQFT', 'FIXED', 'COST_PLUS'] as const;

/**
 * PER_SQFT is the only contract type with a formula behind it (rate x area), and the API
 * derives the value from that formula unless an explicit contractValue is supplied — in
 * which case the explicit one wins, deliberately, so a negotiated total can override the
 * arithmetic. That makes it the caller's job not to send a value it did not mean.
 *
 * FIXED and COST_PLUS have no formula: their value is entered by hand (client, 2026-09-01),
 * so it must be sent.
 */
const derivesOwnValue = (contractType: string) => contractType === 'PER_SQFT';

function PhaseStepper({ current }: { current: string }) {
  const idx = INTERIOR_PHASES.indexOf(current as any);
  return (
    <div className="flex flex-wrap gap-1.5 items-center">
      {INTERIOR_PHASES.map((p, i) => (
        <Chip
          key={p}
          size="sm"
          variant={i === idx ? 'solid' : 'flat'}
          color={i < idx ? 'success' : i === idx ? 'primary' : 'default'}
          className={i > idx ? 'opacity-50' : ''}
        >
          {PHASE_LABEL[p]}
        </Chip>
      ))}
    </div>
  );
}

/**
 * Interior / Fit-Out panel for one anchor — a unit (UnitDetailPage) or a building
 * (BuildingDetailPage).
 *
 * InteriorProject is anchored to a unit XOR a building, and the API has always accepted
 * either; only the unit half had a UI, so a building-level fit-out (a whole floor, a
 * common area, a LOT) could not be created anywhere in the app.
 */
export function InteriorPanel({ unitId, buildingId, unitNumber, buildingName, unitSqft }: {
  unitId?: string;
  buildingId?: string;
  unitNumber?: string;
  buildingName?: string;
  /** Prefills the pricing area — a unit's sqft, or a building's if it has one. */
  unitSqft?: number;
}) {
  const anchorLabel = unitNumber ? `Unit ${unitNumber}` : buildingName ?? 'this building';
  const isUnit = !!unitId;
  const { data, isLoading } = useInteriorProjects(unitId ? { unitId } : { buildingId });
  const { data: templatesData } = useInteriorTemplates();
  const { data: usersData } = useAssignableUsers();
  const templates: any[] = Array.isArray(templatesData) ? templatesData : [];
  const users: any[] = Array.isArray(usersData) ? usersData : [];
  const create = useCreateInterior();
  const { isOpen, onOpen, onClose } = useDisclosure();
  const canEditInterior = useAuthStore((s) => s.hasPermission('interior:edit'));
  const [interiorErr, setInteriorErr] = useState<string | null>(null);

  const projects: any[] = Array.isArray(data) ? data : [];

  // Multiple concurrent interior projects per unit are allowed (client decision,
  // 2026-07-29) — e.g. separate contractors on separate scopes, or tracking
  // competing proposals before picking one. Previously capped at one active
  // project; that cap is gone, so "Start fit-out" is always available.
  const activeCount = projects.filter(
    (p) => p.status !== 'COMPLETED' && p.status !== 'CANCELLED',
  ).length;
  const canCreate = canEditInterior;

  const defaultForm = (): Record<string, string> => ({
    name: unitNumber ? `Unit ${unitNumber} fit-out` : buildingName ? `${buildingName} fit-out` : '',
    packageTemplateId: '',
    contractType: 'PER_SQFT',
    ratePerSqft: '',
    area: unitSqft != null ? String(unitSqft) : '',
    contractValue: '',
    pmId: '',
    startDate: '',
    targetEnd: '',
  });
  const [form, setForm] = useState<Record<string, string>>(defaultForm);
  const set = (k: string) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) =>
    setForm((f) => ({ ...f, [k]: e.target.value }));

  const openModal = () => { setForm(defaultForm()); setInteriorErr(null); onOpen(); };

  const submit = async () => {
    if (!form.name.trim()) { setInteriorErr('Name is required'); return; }
    setInteriorErr(null);
    try {
      await create.mutateAsync({
        // Exactly one of these — the API rejects both or neither.
        ...(unitId ? { unitId } : { buildingId }),
        name: form.name.trim(),
        contractType: form.contractType || 'PER_SQFT',
        ratePerSqft: form.ratePerSqft ? Number(form.ratePerSqft) : undefined,
        area: form.area ? Number(form.area) : undefined,
        // Only sent for the contract types that have no formula. A PER_SQFT job's value
        // IS rate x area and the API derives it; sending a figure as well would override
        // that derivation with whatever happened to be in the field.
        contractValue: derivesOwnValue(form.contractType)
          ? undefined
          : form.contractValue ? Number(form.contractValue) : undefined,
        packageTemplateId: form.packageTemplateId || undefined,
        pmId: form.pmId || undefined,
        startDate: form.startDate || undefined,
        targetEnd: form.targetEnd || undefined,
      });
      addToast({ title: 'Interior project created', color: 'success' });
      setForm(defaultForm());
      onClose();
    } catch (e) {
      setInteriorErr(errMsg(e, 'Failed to create'));
    }
  };

  return (
    // Matches the unit page's Section chrome (rounded-2xl, bordered, no shadow) rather
    // than HeroUI's default Card look — this panel sits directly among Section-wrapped
    // panels on UnitDetailPage and previously looked like a different component's UI.
    <Card className="border border-gray-200 shadow-none rounded-2xl">
      <CardHeader className="pb-2 flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <FiHome className="text-amber-600" />
          <p className="font-semibold text-sm text-gray-600">
            Interior / Fit-Out {projects.length > 0 && `(${projects.length})`}
          </p>
        </div>
        {canCreate && (
          <Button size="sm" variant="flat" color="primary" startContent={<FiPlus />} onPress={openModal}>
            Start fit-out
          </Button>
        )}
        {/* Only worth a chip once it's not just restating the header count — i.e. some
            projects on this unit have wrapped up (COMPLETED/CANCELLED) and some haven't. */}
        {canEditInterior && activeCount > 0 && activeCount < projects.length && (
          <Chip size="sm" variant="flat" color="warning">{activeCount} active</Chip>
        )}
      </CardHeader>
      <CardBody className="pt-0 space-y-3">
        {isLoading && <p className="text-sm text-gray-500">Loading…</p>}
        {!isLoading && projects.length === 0 && (
          <p className="text-sm text-gray-500">
            No interior project yet. Fit-out is optional and starts after the shell is complete.
          </p>
        )}
        {projects.map((p) => (
          <InteriorProjectCard key={p.id} project={p} templates={templates} users={users} />
        ))}
      </CardBody>

      {/* Create modal */}
      <Modal isOpen={isOpen} onClose={onClose} size="lg">
        <ModalContent>
          <ModalHeader>Start interior fit-out</ModalHeader>
          <ModalBody className="space-y-3">
            {(unitNumber || buildingName || unitSqft != null) && (
              <p className="text-xs text-gray-500">
                Prefilled from {anchorLabel}
                {unitSqft != null ? ` · ${Number(unitSqft).toLocaleString()} sqft` : ''} — edit as needed.
              </p>
            )}
            <FormError message={interiorErr} />

            <Input
              label="Name" value={form.name}
              onChange={(e) => { setForm((f) => ({ ...f, name: e.target.value })); setInteriorErr(null); }}
              placeholder={isUnit ? "e.g. Unit 204 fit-out" : "e.g. Ground floor common-area fit-out"}
              isInvalid={!!interiorErr && !form.name.trim()}
              errorMessage="Required"
            />

            {/* Package template */}
            {templates.length > 0 && (
              <Select
                label="Package (optional)"
                placeholder="Custom — no package"
                selectedKeys={form.packageTemplateId ? [form.packageTemplateId] : []}
                onChange={(e) => {
                  const id = e.target.value;
                  const tpl = templates.find((t) => t.id === id);
                  setForm((f) => ({
                    ...f,
                    packageTemplateId: id,
                    ratePerSqft: f.ratePerSqft || (tpl?.defaultRatePerSqft != null ? String(tpl.defaultRatePerSqft) : ''),
                  }));
                }}
              >
                {templates.map((t) => (
                  <SelectItem key={t.id} textValue={t.name}>
                    {t.name}{t.items?.length ? ` · ${t.items.length} items` : ''}
                  </SelectItem>
                ))}
              </Select>
            )}
            {form.packageTemplateId && (
              <p className="text-xs text-gray-500">
                This package's BOQ lines will be copied into the new fit-out's scope.
              </p>
            )}

            {/* Contract */}
            <div className="grid grid-cols-3 gap-2">
              <Select
                size="sm" label="Contract type"
                selectedKeys={[form.contractType]}
                onChange={(e) => setForm((f) => ({ ...f, contractType: e.target.value }))}
              >
                {CONTRACT_TYPES.map((ct) => (
                  <SelectItem key={ct} textValue={ct}>{ct.replace('_', ' ')}</SelectItem>
                ))}
              </Select>
              <Input size="sm" type="number" label="Rate / sqft ($)" value={form.ratePerSqft} onChange={set('ratePerSqft')} />
              <Input size="sm" type="number" label="Area (sqft)" value={form.area} onChange={set('area')} />
            </div>
            {!derivesOwnValue(form.contractType) && (
              <Input
                size="sm" type="number"
                label={form.contractType === 'COST_PLUS' ? 'Contract value ($) — cost plus' : 'Fixed contract value ($)'}
                description="Entered manually — this contract type has no rate x area formula."
                value={form.contractValue} onChange={set('contractValue')}
              />
            )}
            {form.ratePerSqft && form.area && form.contractType === 'PER_SQFT' && (
              <p className="text-xs text-gray-500">
                Contract value ≈ {fmt(Number(form.ratePerSqft) * Number(form.area))}
              </p>
            )}

            {/* PM + Dates */}
            {users.length > 0 && (
              <Select
                size="sm" label="Project manager (optional)"
                placeholder="Unassigned"
                selectedKeys={form.pmId ? [form.pmId] : []}
                onChange={(e) => setForm((f) => ({ ...f, pmId: e.target.value }))}
              >
                {users.map((u) => (
                  <SelectItem key={u.id} textValue={u.name ?? u.email}>{u.name ?? u.email}</SelectItem>
                ))}
              </Select>
            )}
            <div className="grid grid-cols-2 gap-2">
              <Input size="sm" type="date" label="Start date" value={form.startDate} onChange={set('startDate')} />
              <Input size="sm" type="date" label="Target handover" value={form.targetEnd} onChange={set('targetEnd')} />
            </div>
          </ModalBody>
          <ModalFooter>
            <Button variant="light" onPress={onClose}>Cancel</Button>
            <Button color="primary" onPress={submit} isLoading={create.isPending}>Create</Button>
          </ModalFooter>
        </ModalContent>
      </Modal>
    </Card>
  );
}

function InteriorProjectCard({ project, templates, users }: { project: any; templates: any[]; users: any[] }) {
  const advance = useAdvanceInteriorPhase();
  const approve = useApproveInterior();
  const update = useUpdateInterior();
  const canEdit = useAuthStore((s) => s.hasPermission('interior:edit'));
  const idx = INTERIOR_PHASES.indexOf(project.phase);
  const next = idx >= 0 && idx < INTERIOR_PHASES.length - 1 ? INTERIOR_PHASES[idx + 1] : null;

  const [editing, setEditing] = useState(false);
  const [editErr, setEditErr] = useState<string | null>(null);
  const [editForm, setEditForm] = useState({
    name: project.name ?? '',
    contractType: project.contractType ?? 'PER_SQFT',
    ratePerSqft: project.ratePerSqft != null ? String(project.ratePerSqft) : '',
    area: project.area != null ? String(project.area) : '',
    contractValue: project.contractValue != null ? String(project.contractValue) : '',
    pmId: project.pm?.id ?? '',
    startDate: project.startDate ? String(project.startDate).slice(0, 10) : '',
    targetEnd: project.targetEnd ? String(project.targetEnd).slice(0, 10) : '',
  });
  const setEdit = (k: keyof typeof editForm) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) =>
    setEditForm((f) => ({ ...f, [k]: e.target.value }));

  const openEdit = () => {
    setEditForm({
      name: project.name ?? '',
      contractType: project.contractType ?? 'PER_SQFT',
      ratePerSqft: project.ratePerSqft != null ? String(project.ratePerSqft) : '',
      area: project.area != null ? String(project.area) : '',
      contractValue: project.contractValue != null ? String(project.contractValue) : '',
      pmId: project.pm?.id ?? '',
      startDate: project.startDate ? String(project.startDate).slice(0, 10) : '',
      targetEnd: project.targetEnd ? String(project.targetEnd).slice(0, 10) : '',
    });
    setEditErr(null);
    setEditing(true);
  };

  const saveEdit = async () => {
    if (!editForm.name.trim()) { setEditErr('Name is required'); return; }
    setEditErr(null);
    try {
      await update.mutateAsync({
        id: project.id,
        data: {
          name: editForm.name.trim(),
          contractType: editForm.contractType || undefined,
          ratePerSqft: editForm.ratePerSqft ? Number(editForm.ratePerSqft) : undefined,
          area: editForm.area ? Number(editForm.area) : undefined,
          // See derivesOwnValue: this form prefills contractValue from the stored record,
          // so re-sending it on a PER_SQFT job pinned the total at its old figure forever —
          // the API honours an explicit value over the derived one, by design. Changing the
          // rate from 100 to 200 left the contract sitting at the original amount.
          contractValue: derivesOwnValue(editForm.contractType)
            ? undefined
            : editForm.contractValue ? Number(editForm.contractValue) : undefined,
          pmId: editForm.pmId || null,
          startDate: editForm.startDate || undefined,
          targetEnd: editForm.targetEnd || undefined,
        },
      });
      addToast({ title: 'Fit-out updated', color: 'success' });
      setEditing(false);
    } catch (e) {
      setEditErr(errMsg(e, 'Failed to update'));
    }
  };

  const doAdvance = async () => {
    if (!next) return;
    try {
      await advance.mutateAsync({ id: project.id, target: next });
      addToast({ title: `Advanced to ${PHASE_LABEL[next]}`, color: 'success' });
    } catch (e) {
      addToast({ title: errMsg(e, 'Cannot advance'), color: 'danger' });
    }
  };

  if (editing) {
    return (
      <div className="rounded-xl border border-amber-100 bg-amber-50/40 p-3 space-y-3">
        <div className="flex items-center justify-between">
          <span className="text-xs font-semibold text-amber-700 uppercase tracking-wide">Edit fit-out</span>
          <div className="flex gap-1">
            <Button size="sm" isIconOnly variant="light" aria-label="Cancel" onPress={() => setEditing(false)}>
              <FiX className="w-3.5 h-3.5 text-gray-400" />
            </Button>
            <Button size="sm" isIconOnly color="primary" aria-label="Save" isLoading={update.isPending} onPress={saveEdit}>
              <FiCheck className="w-3.5 h-3.5" />
            </Button>
          </div>
        </div>
        <FormError message={editErr} />

        <Input
          size="sm" label="Name" value={editForm.name}
          onChange={(e) => { setEditForm((f) => ({ ...f, name: e.target.value })); setEditErr(null); }}
          isInvalid={!!editErr && editErr.includes('Name')}
        />

        <div className="grid grid-cols-3 gap-2">
          <Select
            size="sm" label="Contract type"
            selectedKeys={[editForm.contractType]}
            onChange={(e) => setEditForm((f) => ({ ...f, contractType: e.target.value }))}
          >
            {CONTRACT_TYPES.map((ct) => (
              <SelectItem key={ct} textValue={ct}>{ct.replace('_', ' ')}</SelectItem>
            ))}
          </Select>
          <Input size="sm" type="number" label="Rate / sqft ($)" value={editForm.ratePerSqft} onChange={setEdit('ratePerSqft')} />
          <Input size="sm" type="number" label="Area (sqft)" value={editForm.area} onChange={setEdit('area')} />
        </div>
        {!derivesOwnValue(editForm.contractType) && (
          <Input
            size="sm" type="number"
            label={editForm.contractType === 'COST_PLUS' ? 'Contract value ($) — cost plus' : 'Fixed contract value ($)'}
            description="Entered manually — this contract type has no rate x area formula."
            value={editForm.contractValue} onChange={setEdit('contractValue')}
          />
        )}

        {users.length > 0 && (
          <Select
            size="sm" label="Project manager"
            placeholder="Unassigned"
            selectedKeys={editForm.pmId ? [editForm.pmId] : []}
            onChange={(e) => setEditForm((f) => ({ ...f, pmId: e.target.value }))}
          >
            {users.map((u) => (
              <SelectItem key={u.id} textValue={u.name ?? u.email}>{u.name ?? u.email}</SelectItem>
            ))}
          </Select>
        )}
        <div className="grid grid-cols-2 gap-2">
          <Input size="sm" type="date" label="Start date" value={editForm.startDate} onChange={setEdit('startDate')} />
          <Input size="sm" type="date" label="Target handover" value={editForm.targetEnd} onChange={setEdit('targetEnd')} />
        </div>

        <div className="flex justify-end gap-2 pt-1">
          <Button size="sm" variant="light" onPress={() => setEditing(false)}>Cancel</Button>
          <Button size="sm" color="primary" isLoading={update.isPending} onPress={saveEdit}>Save changes</Button>
        </div>
      </div>
    );
  }

  return (
    <div className="rounded-lg border border-gray-100 p-3 space-y-3">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="font-medium text-sm">{project.name}</p>
          {/* Contract value used to only render for PER_SQFT (the one type with a formula
              behind it) and silently dropped for FIXED/COST_PLUS, even though both carry
              a hand-entered contractValue same as PER_SQFT does. */}
          <p className="text-xs text-gray-500">
            {[
              project.contractValue != null
                ? `${fmt(Number(project.contractValue))}${project.contractType === 'PER_SQFT' ? ' · per sqft' : ''}`
                : null,
              project.pm?.name ? `PM: ${project.pm.name}` : null,
              project.handoverAt ? `handed over ${fmtDate(project.handoverAt)}` : null,
            ].filter(Boolean).join(' · ')}
          </p>
          {(project.startDate || project.targetEnd) && (
            <p className="text-xs text-gray-500">
              {project.startDate ? fmtDate(project.startDate) : '—'} → {project.targetEnd ? fmtDate(project.targetEnd) : '—'}
            </p>
          )}
        </div>
        <div className="flex items-center gap-1 shrink-0">
          {/* Fetched via _count.snags since the list query was built, never shown on this
              card — the only place a viewer could see the punch-list size was opening the
              full workspace. Total on file, not just open ones: the count has no status
              filter behind it, so this states what it counts rather than implying more. */}
          {project._count?.snags > 0 && (
            <Tooltip size="sm" content={`${project._count.snags} snag${project._count.snags === 1 ? '' : 's'} on file`}>
              <span>
                <Chip size="sm" color="warning" variant="flat" startContent={<FiAlertTriangle className="w-3 h-3" />}>
                  {project._count.snags}
                </Chip>
              </span>
            </Tooltip>
          )}
          <Chip size="sm" color={project.status === 'COMPLETED' ? 'success' : 'primary'} variant="flat">
            {project.status}
          </Chip>
          {canEdit && project.status !== 'COMPLETED' && project.status !== 'CANCELLED' && (
            <Button size="sm" isIconOnly variant="light" aria-label="Edit fit-out" onPress={openEdit}>
              <FiEdit2 className="w-3.5 h-3.5 text-gray-400" />
            </Button>
          )}
        </div>
      </div>

      <PhaseStepper current={project.phase} />

      {canEdit && (
        <div className="flex flex-wrap gap-2">
          {/* Handover is the one transition that captures a client sign-off (and, when
              punch-list items are still open, a written reason for going ahead anyway).
              That form lives in the full workspace, so send the user there rather than
              firing a second, sign-off-less handover path from here. */}
          {next === 'HANDOVER' ? (
            // A real anchor, not `Button as={Link}` — HeroUI renders that as a <button>
            // with no href, so it announces as a button and cannot be middle-clicked or
            // opened in a new tab. This is navigation; it should be a link.
            <Link
              to={`/interior/${project.id}`}
              className="inline-flex items-center gap-1.5 rounded-medium bg-success-50 px-3 py-1.5 text-xs font-medium text-success-700 hover:bg-success-100 transition-colors"
            >
              Complete handover <FiArrowRight />
            </Link>
          ) : next ? (
            <Button
              size="sm" color="primary" variant="flat" endContent={<FiArrowRight />}
              isLoading={advance.isPending} onPress={doAdvance}
            >
              Advance to {PHASE_LABEL[next]}
            </Button>
          ) : null}
          {project.phase === 'CLIENT_APPROVAL' && (
            <Button size="sm" variant="flat" startContent={<FiCheckCircle />}
              onPress={() => approve.mutate({ id: project.id, kind: 'client' })}>
              Record client approval
            </Button>
          )}
          {project.phase === 'CITY_APPROVAL' && (
            <Button size="sm" variant="flat" startContent={<FiCheckCircle />}
              onPress={() => approve.mutate({ id: project.id, kind: 'city' })}>
              Record city approval
            </Button>
          )}
        </div>
      )}

      <Link
        to={`/interior/${project.id}`}
        className="inline-flex items-center gap-1 text-xs font-medium text-blue-600 hover:underline"
      >
        Open full workspace <FiExternalLink size={12} />
      </Link>
    </div>
  );
}
