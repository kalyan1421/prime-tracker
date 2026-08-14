import { useState } from 'react';
import { Card, CardBody, CardHeader, Switch, Chip, Tooltip, addToast } from '@heroui/react';
import { FiBell, FiMail, FiMessageCircle, FiSmartphone, FiAlertCircle, FiInfo, FiSettings } from 'react-icons/fi';
import {
  useNotificationPreferences,
  useUpdateNotificationPreference,
  useOrganizations,
  type NotificationPreference,
} from '../hooks/useApi';
import { useAuthStore } from '../store/authStore';
import { ForecastProbabilitiesPanel } from '../components/ForecastProbabilitiesPanel';

// ─── notification type config ────────────────────────────────────────────────

const TYPE_LABELS: Record<string, { label: string; description: string; group: string }> = {
  MILESTONE_OVERDUE:     { label: 'Milestone Overdue',          description: 'When a milestone passes its due date without completion', group: 'Projects' },
  LEASE_EXPIRING_30:     { label: 'Lease Expiring (30 days)',   description: 'When a tenant lease expires within 30 days', group: 'Leases' },
  LEASE_EXPIRING_7:      { label: 'Lease Expiring (7 days)',    description: 'When a tenant lease expires within 7 days', group: 'Leases' },
  LOAN_MATURITY_60:      { label: 'Loan Maturing (60 days)',    description: 'When a loan matures within 60 days', group: 'Financial' },
  DRAW_REQUEST_SUBMITTED:{ label: 'Draw Request Needs Approval',description: 'When a draw request is submitted and needs your sign-off', group: 'Financial' },
  DRAW_REQUEST_APPROVED: { label: 'Draw Request Approved',      description: 'When a draw request is approved internally', group: 'Financial' },
  DRAW_REQUEST_FUNDED:   { label: 'Draw Request Funded',        description: 'When a draw request is funded by the lender', group: 'Financial' },
  DRAW_FUNDING_OVERDUE:  { label: 'Draw Funding Overdue',       description: 'When a draw passes its expected funding date without arriving', group: 'Financial' },
  BUDGET_VARIANCE:       { label: 'Budget Variance Alert',      description: 'When project spending exceeds budget by more than 10%', group: 'Financial' },
  PAYMENT_DUE_7:         { label: 'Sale Payment Due (7 days)',  description: 'When a buyer instalment falls due within 7 days', group: 'Financial' },
  PAYMENT_OVERDUE:       { label: 'Sale Payment Overdue',       description: 'When a buyer instalment passes its due date unpaid', group: 'Financial' },
  COMMENT_FINANCIAL:     { label: 'Financial Comment',          description: 'When a financial comment is added to a project or unit', group: 'Comments' },
  COMMENT_SALES:         { label: 'Sales Comment',              description: 'When a sales comment is added', group: 'Comments' },
  COMMENT_MARKETING:     { label: 'Marketing Comment',          description: 'When a marketing comment is added', group: 'Comments' },
  LEAD_ASSIGNED:         { label: 'Lead Assigned',              description: 'When a lead is assigned to you', group: 'Leads' },
  LEAD_STATUS_CHANGED:   { label: 'Lead Status Change',         description: 'When a lead you own changes status', group: 'Leads' },
  INTERIOR_PHASE_CHANGED:{ label: 'Interior Phase Change',      description: 'When a fit-out project moves to a new phase', group: 'Interiors' },
  INTERIOR_HANDOVER_DUE: { label: 'Interior Handover Due',      description: 'When a fit-out handover date is approaching', group: 'Interiors' },
  SNAG_OVERDUE:          { label: 'Snag Overdue',               description: 'When a snag/punch-list item passes its target date', group: 'Interiors' },
};

/**
 * Client-side fallback for the delivery tier. The API is expected to return
 * `tier` on each preference; this map is only consulted when it doesn't (and for
 * any type this page doesn't know about, which falls back to FYI — the quieter,
 * safer default). ACTION = someone has to do something, so it emails by default.
 * FYI = awareness only, so it stays in-app unless the user opts in.
 */
export const TYPE_TIER: Record<string, 'ACTION' | 'FYI'> = {
  MILESTONE_OVERDUE: 'ACTION',
  LEASE_EXPIRING_30: 'ACTION',
  LEASE_EXPIRING_7: 'ACTION',
  LOAN_MATURITY_60: 'ACTION',
  DRAW_REQUEST_SUBMITTED: 'ACTION',
  DRAW_FUNDING_OVERDUE: 'ACTION',
  BUDGET_VARIANCE: 'ACTION',
  PAYMENT_DUE_7: 'ACTION',
  PAYMENT_OVERDUE: 'ACTION',
  LEAD_ASSIGNED: 'ACTION',
  INTERIOR_HANDOVER_DUE: 'ACTION',
  SNAG_OVERDUE: 'ACTION',
  DRAW_REQUEST_APPROVED: 'FYI',
  DRAW_REQUEST_FUNDED: 'FYI',
  COMMENT_FINANCIAL: 'FYI',
  COMMENT_SALES: 'FYI',
  COMMENT_MARKETING: 'FYI',
  LEAD_STATUS_CHANGED: 'FYI',
  INTERIOR_PHASE_CHANGED: 'FYI',
};

/** Whether a tier emails when the user hasn't overridden it. */
const TIER_EMAILS_BY_DEFAULT: Record<'ACTION' | 'FYI', boolean> = { ACTION: true, FYI: false };

const TIERS = [
  {
    key: 'ACTION' as const,
    title: 'Action needed',
    blurb: 'Something is waiting on you. These email you by default so they do not sit unseen.',
    icon: <FiAlertCircle size={15} />,
    accent: 'text-amber-600 bg-amber-50',
  },
  {
    key: 'FYI' as const,
    title: 'For your information',
    blurb: 'Awareness only. These stay in-app by default — switch email on for any you want pushed.',
    icon: <FiInfo size={15} />,
    accent: 'text-blue-600 bg-blue-50',
  },
];

// Fallback label for a type the API knows about but this page doesn't yet.
function humanize(type: string) {
  return type
    .toLowerCase()
    .split('_')
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(' ');
}

// ─── email tri-state control ──────────────────────────────────────────────────

type EmailChoice = 'default' | 'on' | 'off';

/**
 * Email has THREE states, not two: null (inherit the tier default), true, false.
 * A plain switch can only show two, and rendering null as "off" would be a lie —
 * for an ACTION type the default is ON, so an off-looking switch would tell the
 * user they get no email when they do. A segmented radio group shows all three
 * at once and never has to guess, and the Default option spells out what it
 * currently resolves to ("Default · On") so inheriting is never ambiguous.
 */
function EmailChoiceControl({
  value,
  defaultsTo,
  label,
  isDisabled,
  onChange,
}: {
  value: EmailChoice;
  defaultsTo: boolean;
  label: string;
  isDisabled: boolean;
  onChange: (choice: EmailChoice) => void;
}) {
  const options: { key: EmailChoice; text: string; hint: string }[] = [
    {
      key: 'default',
      text: `Default · ${defaultsTo ? 'On' : 'Off'}`,
      hint: defaultsTo
        ? 'Follow the default for action-needed alerts: email is sent.'
        : 'Follow the default for FYI alerts: in-app only, no email.',
    },
    { key: 'on', text: 'Always', hint: 'Always email me about this, overriding the default.' },
    { key: 'off', text: 'Never', hint: 'Never email me about this, overriding the default.' },
  ];

  return (
    <div
      role="radiogroup"
      aria-label={`${label} email delivery`}
      className={`inline-flex items-center rounded-lg border border-gray-200 bg-gray-50 p-0.5 ${
        isDisabled ? 'opacity-50' : ''
      }`}
    >
      {options.map((opt) => {
        const selected = value === opt.key;
        return (
          <Tooltip key={opt.key} content={opt.hint} delay={400}>
            <button
              type="button"
              role="radio"
              aria-checked={selected}
              disabled={isDisabled}
              onClick={() => !selected && onChange(opt.key)}
              className={`px-2.5 py-1 text-[11px] font-medium rounded-md transition-colors whitespace-nowrap ${
                selected
                  ? 'bg-white text-gray-800 shadow-sm border border-gray-200'
                  : 'text-gray-500 hover:text-gray-700'
              } ${isDisabled ? 'cursor-not-allowed' : 'cursor-pointer'}`}
            >
              {opt.text}
            </button>
          </Tooltip>
        );
      })}
    </div>
  );
}

// ─── component ────────────────────────────────────────────────────────────────

export default function SettingsPage() {
  const { data: prefs, isLoading } = useNotificationPreferences();
  const updatePref = useUpdateNotificationPreference();
  const [pendingType, setPendingType] = useState<string | null>(null);

  // Org-level settings are gated on org:manage (Founder / Super Admin). The hook already
  // refuses to fire without it, but gating here as well keeps the section out of the page
  // entirely rather than rendering an empty card for everyone else.
  const { hasPermission } = useAuthStore();
  const canManageOrg = hasPermission('org:manage');
  const { data: orgs } = useOrganizations();
  // Prime is a single organization (client-confirmed 2026-08-14), so the first row is the
  // one. Reading it from the list rather than hardcoding an id keeps this correct if that
  // ever changes.
  const orgId = Array.isArray(orgs) ? (orgs[0] as any)?.id : undefined;

  const list: NotificationPreference[] = Array.isArray(prefs) ? prefs : [];

  // The API is the source of truth for which types exist; TYPE_LABELS only adds
  // copy. Anything new the backend starts returning still renders (humanized).
  const rows = list.map((p) => {
    const cfg = TYPE_LABELS[p.type];
    return {
      type: p.type,
      label: cfg?.label ?? humanize(p.type),
      description: cfg?.description ?? '',
      group: cfg?.group ?? '',
      enabled: p.enabled ?? true,
      emailEnabled: p.emailEnabled ?? null,
      tier: p.tier ?? TYPE_TIER[p.type] ?? 'FYI',
    };
  });

  const save = async (type: string, patch: { enabled?: boolean; emailEnabled?: boolean | null }) => {
    setPendingType(type);
    try {
      await updatePref.mutateAsync({ type, ...patch });
    } catch {
      addToast({ title: 'Failed to update preference', color: 'danger' });
    } finally {
      setPendingType(null);
    }
  };

  return (
    <div className="max-w-3xl mx-auto space-y-8">
      {/* page header */}
      <div className="flex items-center gap-3">
        <div className="w-10 h-10 rounded-xl bg-blue-50 flex items-center justify-center">
          <FiSettings className="text-blue-600" size={18} />
        </div>
        <div>
          <h1 className="text-xl font-bold text-gray-800">Settings</h1>
          <p className="text-sm text-gray-500 mt-0.5">
            Your notification preferences{canManageOrg ? ', and organization-wide defaults' : ''}.
          </p>
        </div>
      </div>

      {/* Org-level settings. Hidden entirely without org:manage rather than shown disabled —
          these are company-wide financial assumptions, not personal preferences. */}
      {canManageOrg && <ForecastProbabilitiesPanel orgId={orgId} />}

      {/* ── notification preferences ── */}
      <div className="flex items-center gap-3 pt-2">
        <div className="w-10 h-10 rounded-xl bg-blue-50 flex items-center justify-center">
          <FiBell className="text-blue-600" size={18} />
        </div>
        <div>
          <h2 className="text-lg font-bold text-gray-800">Notification Preferences</h2>
          <p className="text-sm text-gray-500 mt-0.5">
            In-app and email are set separately. Leave email on <span className="font-medium">Default</span> to
            follow the recommendation for that kind of alert.
          </p>
        </div>
      </div>

      {/* channel legend */}
      <div className="flex flex-wrap items-center gap-3 rounded-xl bg-gray-50 border border-gray-100 px-4 py-3">
        <span className="text-xs font-semibold text-gray-500 uppercase tracking-wide mr-1">Channels:</span>
        <span className="flex items-center gap-1 text-xs px-2 py-0.5 rounded-full font-medium bg-green-100 text-green-700">
          <FiSmartphone size={13} /> In-App
        </span>
        <span className="flex items-center gap-1 text-xs px-2 py-0.5 rounded-full font-medium bg-green-100 text-green-700">
          <FiMail size={13} /> Email
        </span>
        <div className="flex items-center gap-1.5">
          <span className="flex items-center gap-1 text-xs px-2 py-0.5 rounded-full font-medium bg-gray-100 text-gray-400">
            <FiMessageCircle size={13} /> WhatsApp
          </span>
          <Chip size="sm" variant="flat" className="text-[10px] bg-amber-50 text-amber-600">
            Coming soon
          </Chip>
        </div>
      </div>

      {/* preferences, grouped by delivery tier */}
      {isLoading ? (
        <div className="space-y-4">
          {[1, 2].map((i) => (
            <div key={i} className="h-64 bg-gray-50 rounded-xl animate-pulse" />
          ))}
        </div>
      ) : (
        <div className="space-y-5">
          {TIERS.map((tier) => {
            const tierRows = rows.filter((r) => r.tier === tier.key);
            if (!tierRows.length) return null;
            const defaultsTo = TIER_EMAILS_BY_DEFAULT[tier.key];

            return (
              <Card key={tier.key} shadow="sm">
                <CardHeader className="pb-1 pt-4 px-5 block">
                  <div className="flex items-center gap-2">
                    <span className={`w-6 h-6 rounded-lg flex items-center justify-center ${tier.accent}`}>
                      {tier.icon}
                    </span>
                    <p className="text-sm font-semibold text-gray-700">{tier.title}</p>
                  </div>
                  <p className="text-xs text-gray-400 mt-1 leading-relaxed">{tier.blurb}</p>
                </CardHeader>
                <CardBody className="pt-2 px-5 pb-3">
                  {/* column header row */}
                  <div className="flex items-center justify-end gap-6 mb-1 pr-1">
                    <span className="flex items-center gap-1 text-[11px] font-medium text-gray-500 w-10 justify-center">
                      <FiSmartphone size={12} /> App
                    </span>
                    <span className="flex items-center gap-1 text-[11px] font-medium text-gray-500 w-[186px] justify-start pl-1">
                      <FiMail size={12} /> Email
                    </span>
                  </div>

                  <div className="space-y-0">
                    {tierRows.map((row) => {
                      const busy = pendingType === row.type;
                      const emailChoice: EmailChoice =
                        row.emailEnabled === null ? 'default' : row.emailEnabled ? 'on' : 'off';

                      return (
                        <div
                          key={row.type}
                          className="flex items-center justify-between py-3 border-b border-gray-50 last:border-0"
                        >
                          {/* label + description */}
                          <div className="flex-1 pr-4 min-w-0">
                            <div className="flex items-center gap-2">
                              <p className="text-sm font-medium text-gray-800">{row.label}</p>
                              {row.group && (
                                <span className="text-[10px] uppercase tracking-wide text-gray-400 bg-gray-50 border border-gray-100 rounded px-1.5 py-px">
                                  {row.group}
                                </span>
                              )}
                            </div>
                            {row.description && (
                              <p className="text-xs text-gray-400 mt-0.5 leading-relaxed">{row.description}</p>
                            )}
                          </div>

                          {/* channel controls */}
                          <div className="flex items-center gap-6 shrink-0">
                            {/* In-app — a genuine on/off */}
                            <div className="w-10 flex justify-center">
                              <Switch
                                size="sm"
                                isSelected={row.enabled}
                                onValueChange={(val) => save(row.type, { enabled: val })}
                                isDisabled={busy}
                                color="primary"
                                aria-label={`${row.label} in-app notification`}
                              />
                            </div>

                            {/* Email — default / always / never */}
                            <EmailChoiceControl
                              value={emailChoice}
                              defaultsTo={defaultsTo}
                              label={row.label}
                              isDisabled={busy}
                              onChange={(choice) =>
                                save(row.type, {
                                  emailEnabled: choice === 'default' ? null : choice === 'on',
                                })
                              }
                            />
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </CardBody>
              </Card>
            );
          })}
        </div>
      )}

      {/* WhatsApp coming-soon callout */}
      <div className="rounded-xl border border-amber-100 bg-amber-50 p-4 flex items-start gap-3">
        <FiMessageCircle className="text-amber-500 mt-0.5 shrink-0" size={16} />
        <div>
          <p className="text-sm font-semibold text-amber-800">WhatsApp notifications — coming soon</p>
          <p className="text-xs text-amber-600 mt-0.5 leading-relaxed">
            WhatsApp delivery is planned for a future release. In-app notifications and email (via SMTP)
            are live now.
          </p>
        </div>
      </div>
    </div>
  );
}
