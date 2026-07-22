import { Card, CardBody, CardHeader, Switch, Chip, Tooltip, addToast } from '@heroui/react';
import { FiBell, FiMail, FiMessageCircle, FiSmartphone } from 'react-icons/fi';
import { useNotificationPreferences, useUpdateNotificationPreference } from '../hooks/useApi';

// ─── notification type config ────────────────────────────────────────────────

const TYPE_LABELS: Record<string, { label: string; description: string; group: string }> = {
  MILESTONE_OVERDUE:    { label: 'Milestone Overdue',      description: 'When a milestone passes its due date without completion', group: 'Projects' },
  LEASE_EXPIRING_30:    { label: 'Lease Expiring (30 days)', description: 'When a tenant lease expires within 30 days', group: 'Leases' },
  LEASE_EXPIRING_7:     { label: 'Lease Expiring (7 days)', description: 'When a tenant lease expires within 7 days', group: 'Leases' },
  LOAN_MATURITY_60:     { label: 'Loan Maturing (60 days)', description: 'When a loan matures within 60 days', group: 'Financial' },
  DRAW_REQUEST_SUBMITTED:{ label: 'Draw Request Needs Approval', description: 'When a draw request is submitted and needs your sign-off', group: 'Financial' },
  DRAW_REQUEST_APPROVED:{ label: 'Draw Request Approved',   description: 'When a draw request is approved internally', group: 'Financial' },
  DRAW_REQUEST_FUNDED:  { label: 'Draw Request Funded',     description: 'When a draw request is funded by the lender', group: 'Financial' },
  BUDGET_VARIANCE:      { label: 'Budget Variance Alert',   description: 'When project spending exceeds budget by more than 10%', group: 'Financial' },
  COMMENT_FINANCIAL:    { label: 'Financial Comment',       description: 'When a financial comment is added to a project or unit', group: 'Comments' },
  COMMENT_SALES:        { label: 'Sales Comment',           description: 'When a sales comment is added', group: 'Comments' },
  COMMENT_MARKETING:    { label: 'Marketing Comment',       description: 'When a marketing comment is added', group: 'Comments' },
  LEAD_ASSIGNED:        { label: 'Lead Assigned',           description: 'When a lead is assigned to you', group: 'Leads' },
  LEAD_STATUS_CHANGE:   { label: 'Lead Status Change',      description: 'When a lead you own changes status', group: 'Leads' },
};

const GROUPS = ['Projects', 'Leases', 'Financial', 'Comments', 'Leads'];

// ─── channel config ───────────────────────────────────────────────────────────

const CHANNELS = [
  { key: 'in_app', label: 'In-App', icon: <FiSmartphone size={13} />, live: true },
  { key: 'email',  label: 'Email',  icon: <FiMail size={13} />,       live: true },
  { key: 'whatsapp', label: 'WhatsApp', icon: <FiMessageCircle size={13} />, live: false },
] as const;

// ─── component ────────────────────────────────────────────────────────────────

export default function SettingsPage() {
  const { data: prefs, isLoading } = useNotificationPreferences();
  const updatePref = useUpdateNotificationPreference();

  // Build map: type → enabled (for in-app / email — both use same flag currently)
  const prefMap: Record<string, boolean> = {};
  if (Array.isArray(prefs)) {
    for (const p of prefs) prefMap[p.type] = p.enabled;
  }

  const handleToggle = async (type: string, enabled: boolean) => {
    try {
      await updatePref.mutateAsync({ type, enabled });
    } catch {
      addToast({ title: 'Failed to update preference', color: 'danger' });
    }
  };

  return (
    <div className="max-w-3xl mx-auto space-y-8">
      {/* page header */}
      <div className="flex items-center gap-3">
        <div className="w-10 h-10 rounded-xl bg-blue-50 flex items-center justify-center">
          <FiBell className="text-blue-600" size={18} />
        </div>
        <div>
          <h1 className="text-xl font-bold text-gray-800">Notification Preferences</h1>
          <p className="text-sm text-gray-500 mt-0.5">
            Choose which events notify you and on which channels.
          </p>
        </div>
      </div>

      {/* channel legend */}
      <div className="flex flex-wrap items-center gap-3 rounded-xl bg-gray-50 border border-gray-100 px-4 py-3">
        <span className="text-xs font-semibold text-gray-500 uppercase tracking-wide mr-1">Channels:</span>
        {CHANNELS.map((ch) => (
          <div key={ch.key} className="flex items-center gap-1.5">
            <span className={`flex items-center gap-1 text-xs px-2 py-0.5 rounded-full font-medium ${
              ch.live ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-gray-400'
            }`}>
              {ch.icon} {ch.label}
            </span>
            {!ch.live && (
              <Chip size="sm" variant="flat" className="text-[10px] bg-amber-50 text-amber-600">
                Coming soon
              </Chip>
            )}
          </div>
        ))}
      </div>

      {/* notification groups */}
      {isLoading ? (
        <div className="space-y-4">
          {[1, 2, 3].map((i) => (
            <div key={i} className="h-32 bg-gray-50 rounded-xl animate-pulse" />
          ))}
        </div>
      ) : (
        <div className="space-y-5">
          {GROUPS.map((group) => {
            const groupTypes = Object.entries(TYPE_LABELS).filter(([, cfg]) => cfg.group === group);
            if (!groupTypes.length) return null;

            return (
              <Card key={group} shadow="sm">
                <CardHeader className="pb-1 pt-4 px-5">
                  <p className="text-sm font-semibold text-gray-700">{group}</p>
                </CardHeader>
                <CardBody className="pt-0 px-5 pb-3">
                  {/* channel header row */}
                  <div className="flex items-center justify-end gap-6 mb-2 pr-1">
                    {CHANNELS.map((ch) => (
                      <Tooltip key={ch.key} content={ch.live ? ch.label : `${ch.label} — coming soon`}>
                        <span className={`flex items-center gap-1 text-[11px] font-medium ${
                          ch.live ? 'text-gray-500' : 'text-gray-300'
                        }`}>
                          {ch.icon} {ch.label}
                        </span>
                      </Tooltip>
                    ))}
                  </div>

                  <div className="space-y-0">
                    {groupTypes.map(([type, cfg]) => {
                      const enabled = prefMap[type] ?? true;
                      return (
                        <div
                          key={type}
                          className="flex items-center justify-between py-3 border-b border-gray-50 last:border-0"
                        >
                          {/* label + description */}
                          <div className="flex-1 pr-4 min-w-0">
                            <p className="text-sm font-medium text-gray-800">{cfg.label}</p>
                            <p className="text-xs text-gray-400 mt-0.5 leading-relaxed">{cfg.description}</p>
                          </div>

                          {/* channel toggles */}
                          <div className="flex items-center gap-6 shrink-0">
                            {/* In-App */}
                            <Switch
                              size="sm"
                              isSelected={enabled}
                              onValueChange={(val) => handleToggle(type, val)}
                              isDisabled={updatePref.isPending}
                              color="primary"
                              aria-label={`${cfg.label} in-app notification`}
                            />
                            {/* Email — same toggle (backend sends both) */}
                            <Switch
                              size="sm"
                              isSelected={enabled}
                              onValueChange={(val) => handleToggle(type, val)}
                              isDisabled={updatePref.isPending}
                              color="primary"
                              aria-label={`${cfg.label} email notification`}
                            />
                            {/* WhatsApp — coming soon */}
                            <Tooltip content="WhatsApp notifications coming soon">
                              <span className="opacity-40 cursor-not-allowed">
                                <Switch
                                  size="sm"
                                  isSelected={false}
                                  isDisabled
                                  color="primary"
                                  aria-label={`${cfg.label} WhatsApp notification (coming soon)`}
                                />
                              </span>
                            </Tooltip>
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
            WhatsApp delivery is planned for the next release. In-app notifications and email
            (via SMTP) are live now. You can pre-configure your preferences above — they will
            apply automatically when WhatsApp goes live.
          </p>
        </div>
      </div>
    </div>
  );
}
