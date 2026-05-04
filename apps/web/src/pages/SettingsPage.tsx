import { Card, CardBody, CardHeader, Switch, addToast } from '@heroui/react';
import { FiBell } from 'react-icons/fi';
import { useNotificationPreferences, useUpdateNotificationPreference } from '../hooks/useApi';

const TYPE_LABELS: Record<string, { label: string; description: string; group: string }> = {
  MILESTONE_OVERDUE: { label: 'Milestone Overdue', description: 'When a project milestone passes its due date', group: 'Projects' },
  LEASE_EXPIRING_30: { label: 'Lease Expiring (30 days)', description: 'When a tenant lease expires within 30 days', group: 'Leases' },
  LEASE_EXPIRING_7: { label: 'Lease Expiring (7 days)', description: 'When a tenant lease expires within 7 days', group: 'Leases' },
  LOAN_MATURITY_60: { label: 'Loan Maturing (60 days)', description: 'When a loan matures within 60 days', group: 'Financial' },
  DRAW_REQUEST_APPROVED: { label: 'Draw Request Approved', description: 'When a draw request is approved', group: 'Financial' },
  DRAW_REQUEST_FUNDED: { label: 'Draw Request Funded', description: 'When a draw request is funded', group: 'Financial' },
  BUDGET_VARIANCE: { label: 'Budget Variance Alert', description: 'When project spending exceeds budget by more than 10%', group: 'Financial' },
  COMMENT_FINANCIAL: { label: 'Financial Comment', description: 'When a financial comment is added to a project or unit', group: 'Comments' },
  COMMENT_SALES: { label: 'Sales Comment', description: 'When a sales comment is added', group: 'Comments' },
  COMMENT_MARKETING: { label: 'Marketing Comment', description: 'When a marketing comment is added', group: 'Comments' },
  LEAD_ASSIGNED: { label: 'Lead Assigned', description: 'When a lead is assigned to you', group: 'Leads' },
  LEAD_STATUS_CHANGE: { label: 'Lead Status Change', description: 'When a lead status changes', group: 'Leads' },
};

const GROUPS = ['Projects', 'Leases', 'Financial', 'Comments', 'Leads'];

export default function SettingsPage() {
  const { data: prefs, isLoading } = useNotificationPreferences();
  const updatePref = useUpdateNotificationPreference();

  const prefMap: Record<string, boolean> = {};
  if (Array.isArray(prefs)) {
    for (const p of prefs) {
      prefMap[p.type] = p.enabled;
    }
  }

  const handleToggle = async (type: string, enabled: boolean) => {
    try {
      await updatePref.mutateAsync({ type, enabled });
    } catch {
      addToast({ title: 'Failed to update preference', color: 'danger' });
    }
  };

  return (
    <div className="max-w-2xl mx-auto">
      <div className="flex items-center gap-3 mb-6">
        <FiBell className="text-2xl text-blue-600" />
        <div>
          <h1 className="text-xl font-bold text-gray-800">Notification Preferences</h1>
          <p className="text-sm text-gray-500">Control which events trigger in-app and email notifications</p>
        </div>
      </div>

      {isLoading ? (
        <div className="text-center py-12 text-gray-400">Loading preferences...</div>
      ) : (
        <div className="space-y-6">
          {GROUPS.map((group) => {
            const groupTypes = Object.entries(TYPE_LABELS).filter(([, cfg]) => cfg.group === group);
            if (groupTypes.length === 0) return null;

            return (
              <Card key={group} shadow="sm">
                <CardHeader className="pb-0">
                  <p className="text-sm font-semibold text-gray-700">{group}</p>
                </CardHeader>
                <CardBody className="pt-2">
                  <div className="space-y-1">
                    {groupTypes.map(([type, cfg]) => (
                      <div
                        key={type}
                        className="flex items-center justify-between py-3 border-b border-gray-50 last:border-0"
                      >
                        <div className="flex-1 pr-4">
                          <p className="text-sm font-medium text-gray-800">{cfg.label}</p>
                          <p className="text-xs text-gray-500 mt-0.5">{cfg.description}</p>
                        </div>
                        <Switch
                          size="sm"
                          isSelected={prefMap[type] ?? true}
                          onValueChange={(val) => handleToggle(type, val)}
                          isDisabled={updatePref.isPending}
                          color="primary"
                        />
                      </div>
                    ))}
                  </div>
                </CardBody>
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
}
