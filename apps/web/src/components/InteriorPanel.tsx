import { useState } from 'react';
import { Link } from 'react-router-dom';
import {
  Card, CardBody, CardHeader, Chip, Button, Input, Select, SelectItem,
  Modal, ModalContent, ModalHeader, ModalBody, ModalFooter,
  useDisclosure, addToast,
} from '@heroui/react';
import { FiHome, FiPlus, FiArrowRight, FiCheckCircle, FiExternalLink } from 'react-icons/fi';
import {
  useInteriorProjects, useCreateInterior, useAdvanceInteriorPhase, useApproveInterior,
  useInteriorTemplates,
} from '../hooks/useApi';
import { useAuthStore } from '../store/authStore';
import { fmt, fmtDate } from '../utils/fmt';
import { INTERIOR_PHASES } from '../constants/interior';

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

const errMsg = (err: unknown, fallback: string) => {
  const msg = (err as any)?.response?.data?.message;
  return Array.isArray(msg) ? msg.join(', ') : typeof msg === 'string' ? msg : fallback;
};

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

/** Per-unit Interior / Fit-Out panel. Drop into UnitDetailPage. */
export function InteriorPanel({ unitId, unitNumber, unitSqft }: { unitId: string; unitNumber?: string; unitSqft?: number }) {
  const { data, isLoading } = useInteriorProjects({ unitId });
  const { data: templatesData } = useInteriorTemplates();
  const templates: any[] = Array.isArray(templatesData) ? templatesData : [];
  const create = useCreateInterior();
  const { isOpen, onOpen, onClose } = useDisclosure();
  const canEditInterior = useAuthStore((s) => s.hasPermission('interior:edit'));

  // Prefill from the existing unit: name from its number, area from its sqft.
  const defaultForm = (): Record<string, string> => ({
    name: unitNumber ? `Unit ${unitNumber} fit-out` : '',
    ratePerSqft: '',
    area: unitSqft != null ? String(unitSqft) : '',
    packageTemplateId: '',
  });
  const [form, setForm] = useState<Record<string, string>>(defaultForm);

  // Reset to the unit's defaults each time the dialog opens.
  const openModal = () => { setForm(defaultForm()); onOpen(); };

  const projects: any[] = Array.isArray(data) ? data : [];

  const submit = async () => {
    if (!form.name.trim()) return addToast({ title: 'Name is required', color: 'warning' });
    try {
      await create.mutateAsync({
        unitId,
        name: form.name.trim(),
        contractType: 'PER_SQFT',
        ratePerSqft: form.ratePerSqft ? Number(form.ratePerSqft) : undefined,
        area: form.area ? Number(form.area) : undefined,
        packageTemplateId: form.packageTemplateId || undefined,
      });
      addToast({ title: 'Interior project created', color: 'success' });
      setForm(defaultForm());
      onClose();
    } catch (e) {
      addToast({ title: errMsg(e, 'Failed to create'), color: 'danger' });
    }
  };

  return (
    <Card shadow="sm">
      <CardHeader className="pb-2 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <FiHome className="text-amber-600" />
          <p className="font-semibold text-sm text-gray-600">
            Interior / Fit-Out {projects.length > 0 && `(${projects.length})`}
          </p>
        </div>
        {canEditInterior && (
          <Button size="sm" variant="flat" color="primary" startContent={<FiPlus />} onPress={openModal}>
            Start fit-out
          </Button>
        )}
      </CardHeader>
      <CardBody className="pt-0 space-y-3">
        {isLoading && <p className="text-sm text-gray-400">Loading…</p>}
        {!isLoading && projects.length === 0 && (
          <p className="text-sm text-gray-400">
            No interior project yet. Fit-out is optional and starts after the shell is complete.
          </p>
        )}
        {projects.map((p) => (
          <InteriorProjectCard key={p.id} project={p} />
        ))}
      </CardBody>

      <Modal isOpen={isOpen} onClose={onClose}>
        <ModalContent>
          <ModalHeader>Start interior fit-out</ModalHeader>
          <ModalBody className="space-y-3">
            {(unitNumber || unitSqft != null) && (
              <p className="text-xs text-gray-500">
                Prefilled from{unitNumber ? ` Unit ${unitNumber}` : ' this unit'}
                {unitSqft != null ? ` · ${Number(unitSqft).toLocaleString()} sqft` : ''} — edit as needed.
              </p>
            )}
            <Input
              label="Name" value={form.name}
              onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
              placeholder="e.g. Unit 204 fit-out"
            />
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
                    // Seed rate from the package default when the user hasn't typed one.
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
            <div className="flex gap-3">
              <Input
                type="number" label="Rate / sqft ($)" value={form.ratePerSqft}
                onChange={(e) => setForm((f) => ({ ...f, ratePerSqft: e.target.value }))}
              />
              <Input
                type="number" label="Area (sqft)" value={form.area}
                onChange={(e) => setForm((f) => ({ ...f, area: e.target.value }))}
              />
            </div>
            {form.ratePerSqft && form.area && (
              <p className="text-xs text-gray-500">
                Contract value ≈ {fmt(Number(form.ratePerSqft) * Number(form.area))}
              </p>
            )}
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

function InteriorProjectCard({ project }: { project: any }) {
  const advance = useAdvanceInteriorPhase();
  const approve = useApproveInterior();
  const canEdit = useAuthStore((s) => s.hasPermission('interior:edit'));
  const idx = INTERIOR_PHASES.indexOf(project.phase);
  const next = idx >= 0 && idx < INTERIOR_PHASES.length - 1 ? INTERIOR_PHASES[idx + 1] : null;

  const doAdvance = async () => {
    if (!next) return;
    try {
      await advance.mutateAsync({ id: project.id, target: next });
      addToast({ title: `Advanced to ${PHASE_LABEL[next]}`, color: 'success' });
    } catch (e) {
      // Surfaces the gate messages: shell-not-complete / missing city-approval or handover doc.
      addToast({ title: errMsg(e, 'Cannot advance'), color: 'danger' });
    }
  };

  return (
    <div className="rounded-lg border border-gray-100 p-3 space-y-3">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="font-medium text-sm">{project.name}</p>
          <p className="text-xs text-gray-400">
            {project.contractType === 'PER_SQFT' && project.contractValue
              ? `${fmt(Number(project.contractValue))} · per sqft`
              : project.status}
            {project.handoverAt && ` · handed over ${fmtDate(project.handoverAt)}`}
          </p>
        </div>
        <Chip size="sm" color={project.status === 'COMPLETED' ? 'success' : 'primary'} variant="flat">
          {project.status}
        </Chip>
      </div>

      <PhaseStepper current={project.phase} />

      {canEdit && (
        <div className="flex flex-wrap gap-2">
          {next && (
            <Button
              size="sm" color="primary" variant="flat" endContent={<FiArrowRight />}
              isLoading={advance.isPending} onPress={doAdvance}
            >
              Advance to {PHASE_LABEL[next]}
            </Button>
          )}
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

      {/* Full workspace: scope, invoices, snags, documents live on the detail page
          (the per-unit card only carries quick status + phase actions). */}
      <Link
        to={`/interior/${project.id}`}
        className="inline-flex items-center gap-1 text-xs font-medium text-blue-600 hover:underline"
      >
        Open full workspace <FiExternalLink size={12} />
      </Link>
    </div>
  );
}
