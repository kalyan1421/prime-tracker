import { Button } from '@heroui/react';
import { FiBarChart2 } from 'react-icons/fi';
import { useNavigate } from 'react-router-dom';
import { useAuthStore } from '../store/authStore';

const ROLE_DEFS: { role: string; label: string; description: string; color: 'danger' | 'primary' | 'success' | 'secondary' | 'warning' | 'default'; permissions: string[] }[] = [
  {
    role: 'SUPER_ADMIN', label: 'Super Admin', description: 'Full system access + config',
    color: 'danger',
    permissions: [
      'project:view', 'project:create', 'project:edit', 'project:delete',
      'financial:view', 'financial:edit', 'financial:export', 'loan:view', 'loan:edit',
      'budget:view', 'budget:edit', 'actual:view', 'actual:edit',
      'sales:view', 'sales:edit', 'lease:view', 'lease:edit', 'lead:view', 'lead:edit',
      'building:view', 'building:edit', 'unit:view', 'unit:edit',
      'milestone:view', 'milestone:edit',
      'draw:view', 'draw:edit', 'draw:approve',
      'vendor:view', 'vendor:edit', 'contract:view', 'contract:edit', 'payment:approve',
      'document:view', 'document:upload', 'document:delete',
      'comment:view', 'comment:edit',
      'investor:view', 'investor:manage',
      'report:portfolio', 'report:sales', 'report:revenue', 'report:debt',
      'user:manage', 'role:manage', 'audit:view', 'quickbooks:manage', 'system:config', 'org:manage',
    ],
  },
  {
    role: 'FOUNDER', label: 'Founder', description: 'Full business access',
    color: 'primary',
    permissions: [
      'project:view', 'project:create', 'project:edit', 'project:delete',
      'financial:view', 'financial:edit', 'financial:export', 'loan:view', 'loan:edit',
      'budget:view', 'budget:edit', 'actual:view', 'actual:edit',
      'sales:view', 'sales:edit', 'lease:view', 'lease:edit', 'lead:view', 'lead:edit',
      'building:view', 'building:edit', 'unit:view', 'unit:edit',
      'milestone:view', 'milestone:edit',
      'draw:view', 'draw:edit', 'draw:approve',
      'vendor:view', 'vendor:edit', 'contract:view', 'contract:edit', 'payment:approve',
      'document:view', 'document:upload', 'document:delete',
      'comment:view', 'comment:edit',
      'investor:view', 'investor:manage',
      'report:portfolio', 'report:sales', 'report:revenue', 'report:debt',
      'user:manage', 'role:manage', 'audit:view', 'quickbooks:manage', 'org:manage',
    ],
  },
  {
    role: 'EXECUTIVE', label: 'Executive', description: 'Read all + financial approvals',
    color: 'primary',
    permissions: [
      'project:view', 'building:view', 'unit:view',
      'financial:view', 'financial:edit', 'financial:export',
      'loan:view', 'budget:view', 'actual:view',
      'draw:view', 'draw:approve', 'sales:view', 'lease:view', 'lead:view',
      'milestone:view', 'vendor:view', 'contract:view', 'payment:approve',
      'document:view', 'investor:view',
      'comment:view', 'comment:edit', 'audit:view',
      'report:portfolio', 'report:sales', 'report:revenue', 'report:debt',
    ],
  },
  {
    role: 'FINANCE', label: 'Finance', description: 'Financials, loans, investors',
    color: 'success',
    permissions: [
      'project:view', 'building:view', 'unit:view',
      'financial:view', 'financial:edit', 'financial:export',
      'loan:view', 'loan:edit', 'budget:view', 'budget:edit', 'actual:view', 'actual:edit',
      'draw:view', 'draw:edit', 'draw:approve',
      'sales:view', 'lease:view', 'milestone:view',
      'vendor:view', 'vendor:edit', 'contract:view', 'payment:approve',
      'document:view', 'document:upload',
      'investor:view', 'investor:manage',
      'comment:view', 'comment:edit', 'quickbooks:manage',
      'report:portfolio', 'report:revenue', 'report:debt',
    ],
  },
  {
    role: 'ACCOUNTING', label: 'Accounting', description: 'Budgets, actuals, QB sync',
    color: 'success',
    permissions: [
      'project:view', 'building:view', 'unit:view',
      'financial:view', 'financial:edit', 'financial:export',
      'loan:view', 'budget:view', 'budget:edit', 'actual:view', 'actual:edit',
      'draw:view', 'vendor:view', 'contract:view',
      'document:view', 'document:upload',
      'comment:view', 'comment:edit', 'quickbooks:manage', 'report:portfolio',
    ],
  },
  {
    role: 'AR_AP', label: 'AR/AP', description: 'Draws, payments, actuals',
    color: 'success',
    permissions: [
      'project:view', 'building:view', 'unit:view',
      'financial:view', 'budget:view', 'actual:view', 'actual:edit',
      'draw:view', 'draw:edit', 'vendor:view', 'contract:view', 'payment:approve',
      'document:view', 'comment:view',
    ],
  },
  {
    role: 'PROJECT_MANAGER', label: 'Project Manager', description: 'Projects, buildings, vendors',
    color: 'secondary',
    permissions: [
      'project:view', 'project:create', 'project:edit',
      'building:view', 'building:edit', 'unit:view', 'unit:edit',
      'financial:view', 'budget:view', 'actual:view',
      'draw:view', 'draw:edit', 'sales:view', 'lease:view',
      'milestone:view', 'milestone:edit',
      'vendor:view', 'vendor:edit', 'contract:view', 'contract:edit',
      'document:view', 'document:upload',
      'comment:view', 'comment:edit', 'report:portfolio',
    ],
  },
  {
    role: 'CONSTRUCTION', label: 'Construction', description: 'Milestones, documents',
    color: 'warning',
    permissions: [
      'project:view', 'building:view', 'unit:view',
      'financial:view', 'budget:view', 'draw:view',
      'milestone:view', 'milestone:edit', 'vendor:view',
      'document:view', 'document:upload',
      'comment:view', 'comment:edit',
    ],
  },
  {
    role: 'SALES', label: 'Sales', description: 'Pipeline, leads, leases',
    color: 'warning',
    permissions: [
      'project:view', 'building:view', 'unit:view', 'unit:edit',
      'sales:view', 'sales:edit', 'lease:view', 'lease:edit',
      'lead:view', 'lead:edit',
      'document:view', 'document:upload',
      'comment:view', 'comment:edit',
      'report:sales', 'report:revenue',
    ],
  },
  {
    role: 'MARKETING', label: 'Marketing', description: 'Leads, marketing docs',
    color: 'secondary',
    permissions: [
      'project:view', 'building:view', 'unit:view',
      'lead:view', 'lead:edit',
      'document:view', 'document:upload',
      'comment:view', 'comment:edit', 'report:sales',
    ],
  },
  {
    role: 'LEGAL', label: 'Legal', description: 'Contracts, leases, docs',
    color: 'default',
    permissions: [
      'project:view', 'building:view', 'unit:view',
      'financial:view', 'loan:view', 'sales:view', 'lease:view',
      'vendor:view', 'contract:view',
      'document:view', 'document:upload',
      'comment:view', 'comment:edit',
    ],
  },
  {
    role: 'VIEWER', label: 'Viewer', description: 'Read-only access',
    color: 'default',
    permissions: [
      'project:view', 'building:view', 'unit:view', 'milestone:view', 'comment:view',
    ],
  },
];

export default function LoginPage() {
  const navigate = useNavigate();
  const { setAuth } = useAuthStore();

  const handleRoleLogin = (rd: (typeof ROLE_DEFS)[number]) => {
    setAuth(
      {
        id: `demo-user-${rd.role.toLowerCase()}`,
        name: `Demo ${rd.label}`,
        email: `demo-${rd.role.toLowerCase()}@primedevelopers.com`,
        role: rd.role,
        permissions: rd.permissions,
        mfaEnabled: false,
        mfaVerified: false,
      },
      `demo-${rd.role}`,
      `demo-refresh-${rd.role}`,
    );
    navigate('/', { replace: true });
  };

  return (
    <div className="min-h-screen bg-gray-50 flex items-center justify-center">
      <div className="bg-white p-10 rounded-xl shadow-lg max-w-[640px] w-full">
        <div className="flex flex-col items-center gap-6">
          <FiBarChart2 className="text-blue-600 text-4xl" />
          <div className="text-center">
            <h1 className="text-2xl font-bold text-gray-800">Prime Tracker</h1>
            <p className="text-sm text-gray-500 mt-1">Dev Login — select a role to continue</p>
          </div>

          <div className="w-full grid grid-cols-3 gap-3">
            {ROLE_DEFS.map((rd) => (
              <Button
                key={rd.role}
                color={rd.color}
                variant="flat"
                className="flex flex-col h-auto py-3 px-4 items-start"
                onPress={() => handleRoleLogin(rd)}
              >
                <span className="font-semibold text-sm">{rd.label}</span>
                <span className="text-xs opacity-70 font-normal line-clamp-1">{rd.description}</span>
              </Button>
            ))}
          </div>

          <p className="text-xs text-gray-400 text-center">
            The Prime Developer · Internal Dev Dashboard
          </p>
        </div>
      </div>
    </div>
  );
}
