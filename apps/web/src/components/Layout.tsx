import { Outlet, NavLink, useNavigate } from 'react-router-dom';
import {
  Avatar, Dropdown, DropdownTrigger, DropdownMenu, DropdownItem,
  Chip, Tooltip, Button, Badge, Popover, PopoverTrigger, PopoverContent,
} from '@heroui/react';
import {
  FiHome, FiFolder, FiSettings, FiLogOut, FiChevronDown, FiShield,
  FiMenu, FiPieChart, FiBell, FiUsers, FiCheck, FiTarget, FiBriefcase,
  FiCheckSquare, FiPackage,
} from 'react-icons/fi';
import { useState } from 'react';
import { useAuthStore } from '../store/authStore';
import { useDisclosure } from '@heroui/react';
import api from '../lib/api';
import MfaSetupModal from './MfaSetupModal';
import { useNotifications, useMarkNotificationsRead } from '../hooks/useApi';

const BASE_NAV_ITEMS = [
  { label: 'Dashboard', icon: FiHome, pathKey: 'dashboard' },
  { label: 'Projects', icon: FiFolder, path: '/projects' },
  { label: 'Inventory', icon: FiPackage, path: '/inventory' },
  { label: 'Tasks', icon: FiCheckSquare, path: '/tasks' },
  { label: 'Leads', icon: FiTarget, path: '/leads', roles: ['SUPER_ADMIN', 'FOUNDER', 'EXECUTIVE', 'SALES', 'MARKETING'] },
  { label: 'Investors', icon: FiBriefcase, path: '/investors', permission: 'investor:view' },
  { label: 'Reports', icon: FiPieChart, pathKey: 'reports', roles: ['SUPER_ADMIN', 'FOUNDER', 'EXECUTIVE', 'FINANCE', 'ACCOUNTING', 'PROJECT_MANAGER', 'SALES', 'MARKETING'] },
  { label: 'Admin', icon: FiUsers, path: '/admin', permission: 'user:manage' },
];

function getDashPath(role: string) {
  if (['SUPER_ADMIN', 'FOUNDER', 'EXECUTIVE'].includes(role)) return '/dashboard/founder';
  if (['CONSTRUCTION', 'PROJECT_MANAGER'].includes(role)) return '/dashboard/construction';
  if (['SALES', 'MARKETING'].includes(role)) return '/dashboard/sales';
  return '/';
}

function getReportsPath(role: string) {
  if (['SUPER_ADMIN', 'FOUNDER', 'EXECUTIVE', 'FINANCE', 'ACCOUNTING'].includes(role)) return '/reports/founder';
  if (['CONSTRUCTION', 'PROJECT_MANAGER'].includes(role)) return '/reports/construction';
  if (['SALES', 'MARKETING'].includes(role)) return '/reports/sales';
  return '/reports';
}

function NotificationPanel() {
  const { data } = useNotifications(20);
  const markRead = useMarkNotificationsRead();
  const navigate = useNavigate();

  const notifications = (data?.notifications as any[]) || [];
  const unread = notifications.filter((n: any) => !n.readAt);

  return (
    <div className="w-[340px]">
      <div className="flex items-center justify-between px-4 py-3 border-b border-gray-100">
        <p className="font-semibold text-sm text-gray-700">Notifications</p>
        {unread.length > 0 && (
          <button
            className="text-xs text-blue-600 hover:underline"
            onClick={() => markRead.mutate(undefined)}
          >
            Mark all read
          </button>
        )}
      </div>
      <div className="max-h-[380px] overflow-auto">
        {notifications.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-10 text-gray-400">
            <FiBell className="text-2xl mb-2" />
            <p className="text-sm">No notifications</p>
          </div>
        ) : (
          notifications.map((n: any) => (
            <div
              key={n.id}
              className={`px-4 py-3 border-b border-gray-50 cursor-pointer hover:bg-gray-50 transition-colors ${!n.readAt ? 'bg-blue-50/40' : ''}`}
              onClick={() => {
                if (!n.readAt) markRead.mutate([n.id]);
                if (n.link) navigate(n.link);
              }}
            >
              <div className="flex gap-2 items-start">
                {!n.readAt && <span className="mt-1.5 h-2 w-2 shrink-0 rounded-full bg-blue-500" />}
                {n.readAt && <span className="mt-1.5 h-2 w-2 shrink-0" />}
                <div className="flex-1 min-w-0">
                  <p className="text-xs font-medium text-gray-800 leading-tight">{n.title}</p>
                  <p className="text-xs text-gray-500 mt-0.5 line-clamp-2">{n.body}</p>
                  <p className="text-[10px] text-gray-400 mt-1">
                    {new Date(n.createdAt).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}
                  </p>
                </div>
              </div>
            </div>
          ))
        )}
      </div>
      <div className="px-4 py-2 border-t border-gray-100">
        <button
          className="text-xs text-blue-600 hover:underline w-full text-center"
          onClick={() => navigate('/settings/notifications')}
        >
          Notification Settings
        </button>
      </div>
    </div>
  );
}

function Sidebar({ collapsed }: { collapsed: boolean }) {
  const { hasPermission, user } = useAuthStore();
  const role = user?.role ?? '';
  const dashPath = getDashPath(role);
  const reportsPath = getReportsPath(role);

  const navItems = BASE_NAV_ITEMS.map((item) => ({
    ...item,
    path: item.path ?? (item.pathKey === 'dashboard' ? dashPath : item.pathKey === 'reports' ? reportsPath : '/'),
  }));

  return (
    <nav
      className={`${collapsed ? 'w-[60px]' : 'w-[220px]'} min-h-screen bg-white border-r border-gray-200 transition-all duration-200 overflow-hidden pt-4 relative`}
    >
      <div className={`${collapsed ? 'px-2 justify-center' : 'px-4 justify-start'} flex items-center mb-8`}>
        {collapsed ? (
          <img src="/logomark-blue.png" alt="Prime Developers" className="h-8 w-8 object-contain shrink-0" />
        ) : (
          <img src="/logo-full-blue.png" alt="Prime Developers" className="h-10 object-contain" />
        )}
      </div>

      <div className="flex flex-col gap-1 px-2">
        {navItems.map((item) => {
          if (item.permission && !hasPermission(item.permission)) return null;
          if (item.roles && !item.roles.includes(role)) return null;
          const Icon = item.icon;
          // Dashboard item: match any /dashboard/* or root /
          const isDashItem = item.pathKey === 'dashboard';
          const isReportsItem = item.pathKey === 'reports';
          return (
            <Tooltip key={item.path} content={collapsed ? item.label : ''} placement="right" isDisabled={!collapsed}>
              <NavLink
                to={item.path}
                end={!isDashItem && !isReportsItem}
                className={({ isActive }) => {
                  const active = isActive
                    || (isDashItem && (window.location.pathname.startsWith('/dashboard') || window.location.pathname === '/'))
                    || (isReportsItem && window.location.pathname.startsWith('/reports'));
                  return `flex items-center gap-3 px-3 py-2 rounded-md text-sm font-medium transition-colors ${active
                      ? 'bg-blue-50 text-blue-600 font-semibold'
                      : 'text-gray-600 hover:bg-gray-100'
                    }`;
                }}
              >
                <Icon className="text-lg shrink-0" />
                {!collapsed && <span className="whitespace-nowrap">{item.label}</span>}
              </NavLink>
            </Tooltip>
          );
        })}
      </div>

      {!collapsed && user && (
        <div className="absolute bottom-4 left-0 right-0 px-4">
          <hr className="mb-3 border-gray-200" />
          <div className="flex items-center gap-2">
            <Chip size="sm" variant="flat" color="primary">{user.role.replace('_', ' ')}</Chip>
            {user.mfaEnabled && (
              <Tooltip content="MFA enabled">
                <span><FiShield className="text-green-500 text-xs" /></span>
              </Tooltip>
            )}
          </div>
        </div>
      )}
    </nav>
  );
}

function TopBar({ onToggleSidebar }: { onToggleSidebar: () => void }) {
  const navigate = useNavigate();
  const { user, logout } = useAuthStore();
  const { isOpen: isMfaOpen, onOpen: onMfaOpen, onClose: onMfaClose } = useDisclosure();
  const { data: notifData } = useNotifications(20);

  const notifications = (notifData?.notifications as any[]) || [];
  const unreadCount = notifications.filter((n: any) => !n.readAt).length;

  const handleLogout = async () => {
    try {
      await api.post('/auth/logout');
    } catch { /* ignore */ }
    logout();
    navigate('/login');
  };

  return (
    <header className="h-14 bg-white border-b border-gray-200 flex items-center px-4 justify-between">
      <Button
        isIconOnly
        variant="light"
        size="sm"
        onPress={onToggleSidebar}
        aria-label="Toggle sidebar"
      >
        <FiMenu />
      </Button>

      <div className="flex items-center gap-2">
        {/* Bell notification icon */}
        <Popover placement="bottom-end" offset={8}>
          <PopoverTrigger>
            <Button isIconOnly variant="light" size="sm" aria-label="Notifications">
              <Badge
                content={unreadCount > 0 ? (unreadCount > 9 ? '9+' : unreadCount) : undefined}
                color="danger"
                size="sm"
                isInvisible={unreadCount === 0}
              >
                <FiBell className="text-gray-600" />
              </Badge>
            </Button>
          </PopoverTrigger>
          <PopoverContent className="p-0 shadow-lg rounded-xl overflow-hidden border border-gray-200">
            <NotificationPanel />
          </PopoverContent>
        </Popover>

        {/* User dropdown */}
        <Dropdown>
          <DropdownTrigger>
            <button className="flex items-center gap-2 cursor-pointer outline-none">
              <Avatar size="sm" name={user?.name} src={user?.avatarUrl} />
              <span className="text-sm font-medium hidden md:block">{user?.name}</span>
              {user?.mfaEnabled && (
                <Tooltip content="MFA enabled">
                  <span><FiShield className="text-green-500 text-xs" /></span>
                </Tooltip>
              )}
              <FiChevronDown size={14} />
            </button>
          </DropdownTrigger>
          <DropdownMenu aria-label="User menu">
            <DropdownItem key="mfa" startContent={<FiShield />} onPress={onMfaOpen}>
              {user?.mfaEnabled ? 'MFA Settings' : 'Set Up MFA'}
              {user?.mfaEnabled && (
                <Chip size="sm" color="success" variant="flat" className="ml-2 text-[10px]">Active</Chip>
              )}
            </DropdownItem>
            <DropdownItem key="notif-settings" startContent={<FiBell />} onPress={() => navigate('/settings/notifications')}>
              Notification Settings
            </DropdownItem>
            <DropdownItem key="signout" startContent={<FiLogOut />} onPress={handleLogout} color="danger">
              Sign Out
            </DropdownItem>
          </DropdownMenu>
        </Dropdown>
      </div>

      <MfaSetupModal isOpen={isMfaOpen} onClose={onMfaClose} />
    </header>
  );
}

// MFA Prompt Banner for FINANCE/FOUNDER roles not yet enrolled
function MfaBanner() {
  const { user } = useAuthStore();
  const { isOpen, onOpen, onClose } = useDisclosure();

  const shouldPrompt = !user?.mfaEnabled && ['SUPER_ADMIN', 'FOUNDER', 'EXECUTIVE', 'FINANCE', 'ACCOUNTING'].includes(user?.role ?? '');
  if (!shouldPrompt) return null;

  return (
    <>
      <div className="bg-amber-50 border-b border-amber-200 px-6 py-2 flex items-center justify-between">
        <div className="flex items-center gap-2 text-sm text-amber-700">
          <FiShield className="shrink-0" />
          <span>
            <strong>Recommended:</strong> Enable two-factor authentication to protect your {user?.role?.replace('_', ' ')} account.
          </span>
        </div>
        <div className="flex items-center gap-2">
          <Button size="sm" color="warning" variant="flat" onPress={onOpen}>
            Set Up Now
          </Button>
        </div>
      </div>
      <MfaSetupModal isOpen={isOpen} onClose={onClose} />
    </>
  );
}

export default function Layout() {
  const [collapsed, setCollapsed] = useState(false);

  return (
    <div className="flex min-h-screen">
      <Sidebar collapsed={collapsed} />
      <div className="flex flex-col flex-1 overflow-hidden">
        <TopBar onToggleSidebar={() => setCollapsed((c) => !c)} />
        <MfaBanner />
        <main className="flex-1 overflow-auto p-6 bg-gray-50">
          <Outlet />
        </main>
      </div>
    </div>
  );
}
