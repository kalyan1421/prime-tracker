import { Outlet, NavLink, useNavigate, useLocation } from 'react-router-dom';
import { ErrorBoundary } from './ErrorBoundary';
import {
  Avatar, Dropdown, DropdownTrigger, DropdownMenu, DropdownItem,
  Chip, Tooltip, Button, Badge, Popover, PopoverTrigger, PopoverContent,
} from '@heroui/react';
import {
  FiHome, FiFolder, FiSettings, FiLogOut, FiChevronDown, FiShield, FiUser,
  FiMenu, FiPieChart, FiBell, FiUsers, FiCheck, FiTarget, FiBriefcase,
  FiCheckSquare, FiPackage, FiX, FiBarChart2, FiGrid, FiTrendingUp, FiTrendingDown,
} from 'react-icons/fi';
import { useEffect, useState } from 'react';
import { useAuthStore } from '../store/authStore';
import { useDisclosure } from '@heroui/react';
import api from '../lib/api';
import MfaSetupModal from './MfaSetupModal';
import MfaStepUpModal from './MfaStepUpModal';
import { useNotifications, useMarkNotificationsRead, useNotificationsSocket } from '../hooks/useApi';

const BASE_NAV_ITEMS = [
  { label: 'Dashboard', icon: FiHome, pathKey: 'dashboard' },
  { label: 'Projects', icon: FiFolder, path: '/projects' },
  { label: 'Inventory', icon: FiPackage, path: '/inventory' },
  { label: 'Interior', icon: FiGrid, path: '/interior', permission: 'interior:view' },
  { label: 'Cash Flow', icon: FiTrendingUp, path: '/cashflow', permission: 'financial:view' },
  { label: 'Receivables', icon: FiTrendingDown, path: '/receivables', permission: 'interior:finance' },
  { label: 'Tasks', icon: FiCheckSquare, path: '/tasks' },
  { label: 'Leads', icon: FiTarget, path: '/leads', permission: 'lead:view' },
  { label: 'Ads & Campaigns', icon: FiBarChart2, path: '/campaigns', permission: 'campaign:view' },
  { label: 'Investors', icon: FiBriefcase, path: '/investors', permission: 'investor:view' },
  { label: 'Brokers', icon: FiUsers, path: '/brokers', permission: 'broker:view' },
  // Any-of: the Reports hub holds four independently gated report tabs, so the link
  // shows when the viewer can see at least one of them. This was a role list, which
  // let CONSTRUCTION and VIEWER through to a page where every tab was empty.
  { label: 'Reports', icon: FiPieChart, pathKey: 'reports', anyPermission: ['financial:view', 'sales:view', 'lease:view', 'loan:view'] },
  { label: 'Admin', icon: FiUsers, path: '/admin', permission: 'user:manage' },
];

function getDashPath(role: string) {
  if (['SUPER_ADMIN', 'FOUNDER', 'EXECUTIVE'].includes(role)) return '/dashboard/founder';
  if (['CONSTRUCTION', 'PROJECT_MANAGER'].includes(role)) return '/dashboard/construction';
  if (['SALES', 'MARKETING'].includes(role)) return '/dashboard/sales';
  return '/';
}

/**
 * Where the "Reports" nav item points.
 *
 * Driven by permissions, not by role name, because the destinations are themselves
 * permission-gated and the two lists drifted: PROJECT_MANAGER was sent to
 * /reports/construction, which requires financial:view (ConstructionReportsPage renders
 * only the portfolio report) — a permission PROJECT_MANAGER does not hold. The link was
 * visible and clicking it bounced them silently back to "/".
 *
 * Ordered most-specific first; /reports is the hub and gates each of its tabs itself.
 */
function getReportsPath(hasPermission: (p: string) => boolean) {
  if (hasPermission('financial:view')) return '/reports/founder';
  if (hasPermission('sales:view')) return '/reports/sales';
  return '/reports';
}

function NotificationPanel() {
  const { data } = useNotifications(20);
  const markRead = useMarkNotificationsRead();
  const navigate = useNavigate();

  const notifications = (data?.notifications as any[]) || [];
  // Same reason as the badge: gating this control on the fetched page meant that a user
  // whose newest 20 were read but who still had older unread ones saw no "Mark all read"
  // at all — the only way to clear them was to scroll back and open each one.
  const unreadCount = (data?.unreadCount as number) ?? 0;

  return (
    <div className="w-[min(340px,90vw)]">
      <div className="flex items-center justify-between px-4 py-3 border-b border-gray-100">
        <div className="flex items-baseline gap-2">
          <p className="font-semibold text-sm text-gray-700">Notifications</p>
          {unreadCount > 0 && (
            <span className="text-[11px] text-gray-400">{unreadCount} unread</span>
          )}
        </div>
        {unreadCount > 0 && (
          <button
            className="text-xs text-blue-600 hover:underline disabled:opacity-50"
            disabled={markRead.isPending}
            onClick={() => markRead.mutate(undefined)}
          >
            Mark all read
          </button>
        )}
      </div>
      <div className="max-h-[60vh] sm:max-h-[380px] overflow-auto">
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

/**
 * Sidebar.
 *
 * Two modes:
 *   - Desktop (lg+): inline 60px (collapsed) or 220px (expanded). Persists across navigation.
 *   - Mobile (<lg):  off-canvas drawer; hidden by default. Tapping the hamburger slides
 *                    it in with a backdrop. Tapping a nav item or backdrop closes it.
 *
 * Why off-canvas: on a 375px screen, even a 60px sidebar takes 16% of the width and
 * shrinks the content area to a point where 2-column grids barely fit.
 */
function Sidebar({
  collapsed,
  mobileOpen,
  onMobileClose,
}: {
  collapsed: boolean;
  mobileOpen: boolean;
  onMobileClose: () => void;
}) {
  const { hasPermission, hasAnyPermission, user } = useAuthStore();
  const role = user?.role ?? '';
  const dashPath = getDashPath(role);
  const reportsPath = getReportsPath(hasPermission);

  const navItems = BASE_NAV_ITEMS.map((item) => ({
    ...item,
    path: item.path ?? (item.pathKey === 'dashboard' ? dashPath : item.pathKey === 'reports' ? reportsPath : '/'),
  }));

  // Lock body scroll while the mobile drawer is open
  useEffect(() => {
    if (mobileOpen) {
      const orig = document.body.style.overflow;
      document.body.style.overflow = 'hidden';
      return () => { document.body.style.overflow = orig; };
    }
  }, [mobileOpen]);

  const navList = (
    <div className="flex flex-col gap-1 px-2">
      {navItems.map((item) => {
        if (item.permission && !hasPermission(item.permission)) return null;
        if (item.anyPermission && !hasAnyPermission(...item.anyPermission)) return null;
        const Icon = item.icon;
        const isDashItem = item.pathKey === 'dashboard';
        const isReportsItem = item.pathKey === 'reports';
        return (
          <Tooltip key={item.path} content={collapsed ? item.label : ''} placement="right" isDisabled={!collapsed}>
            <NavLink
              to={item.path}
              end={!isDashItem && !isReportsItem}
              onClick={onMobileClose}
              className={({ isActive }) => {
                const active = isActive
                  || (isDashItem && (window.location.pathname.startsWith('/dashboard') || window.location.pathname === '/'))
                  || (isReportsItem && window.location.pathname.startsWith('/reports'));
                return `flex items-center gap-3 px-3 py-2.5 rounded-md text-sm font-medium transition-colors min-h-[44px] ${active
                    ? 'bg-blue-50 text-blue-600 font-semibold'
                    : 'text-gray-600 hover:bg-gray-100 active:bg-gray-200'
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
  );

  const userFooter = !collapsed && user && (
    <div className="absolute bottom-4 left-0 right-0 px-4">
      <hr className="mb-3 border-gray-200" />
      <div className="flex items-center gap-2 flex-wrap">
        <Chip size="sm" variant="flat" color="primary">{user.role.replace('_', ' ')}</Chip>
        {user.mfaEnabled && (
          <Tooltip content="MFA enabled">
            <span><FiShield className="text-green-500 text-xs" /></span>
          </Tooltip>
        )}
      </div>
    </div>
  );

  return (
    <>
      {/* Desktop sidebar — inline, persistent */}
      <nav
        className={`${collapsed ? 'w-[60px]' : 'w-[220px]'} hidden lg:flex lg:flex-col sticky top-0 h-screen bg-white border-r border-gray-200 transition-all duration-200 overflow-y-auto overflow-x-hidden pt-4 shrink-0`}
      >
        <div className={`${collapsed ? 'px-2 justify-center' : 'px-4 justify-start'} flex items-center mb-8`}>
          {collapsed ? (
            <img src="/logomark-blue.png" alt="Prime Developers" className="h-8 w-8 object-contain shrink-0" />
          ) : (
            <img src="/logo-full-blue.png" alt="Prime Developers" className="h-10 object-contain" />
          )}
        </div>
        {navList}
        {userFooter}
      </nav>

      {/* Mobile drawer — off-canvas with backdrop */}
      <div
        className={`lg:hidden fixed inset-0 z-50 transition-opacity ${mobileOpen ? 'opacity-100 pointer-events-auto' : 'opacity-0 pointer-events-none'}`}
        aria-hidden={!mobileOpen}
      >
        {/* Backdrop */}
        <button
          type="button"
          aria-label="Close menu"
          onClick={onMobileClose}
          className="absolute inset-0 bg-black/40"
        />
        {/* Drawer panel */}
        <aside
          className={`absolute left-0 top-0 h-full w-[260px] max-w-[80vw] bg-white shadow-xl flex flex-col transition-transform ${mobileOpen ? 'translate-x-0' : '-translate-x-full'}`}
          style={{ paddingTop: 'env(safe-area-inset-top)' }}
        >
          <div className="flex items-center justify-between px-4 py-3 border-b border-gray-100">
            <img src="/logo-full-blue.png" alt="Prime Developers" className="h-9 object-contain" />
            <Button isIconOnly variant="light" size="sm" onPress={onMobileClose} aria-label="Close menu">
              <FiX />
            </Button>
          </div>
          <div className="flex-1 overflow-y-auto py-3">
            <div className="flex flex-col gap-1 px-2">
              {navItems.map((item) => {
                if (item.permission && !hasPermission(item.permission)) return null;
                if (item.anyPermission && !hasAnyPermission(...item.anyPermission)) return null;
                const Icon = item.icon;
                const isDashItem = item.pathKey === 'dashboard';
                const isReportsItem = item.pathKey === 'reports';
                return (
                  <NavLink
                    key={item.path}
                    to={item.path}
                    end={!isDashItem && !isReportsItem}
                    onClick={onMobileClose}
                    className={({ isActive }) => {
                      const active = isActive
                        || (isDashItem && (window.location.pathname.startsWith('/dashboard') || window.location.pathname === '/'))
                        || (isReportsItem && window.location.pathname.startsWith('/reports'));
                      return `flex items-center gap-3 px-4 py-3 rounded-md text-sm font-medium transition-colors min-h-[48px] ${active
                          ? 'bg-blue-50 text-blue-600 font-semibold'
                          : 'text-gray-700 hover:bg-gray-100 active:bg-gray-200'
                        }`;
                    }}
                  >
                    <Icon className="text-lg shrink-0" />
                    <span>{item.label}</span>
                  </NavLink>
                );
              })}
            </div>
          </div>
          {user && (
            <div className="px-4 py-3 border-t border-gray-100" style={{ paddingBottom: 'max(env(safe-area-inset-bottom), 0.75rem)' }}>
              <div className="flex items-center gap-2 flex-wrap">
                <Chip size="sm" variant="flat" color="primary">{user.role.replace('_', ' ')}</Chip>
                {user.mfaEnabled && <FiShield className="text-green-500 text-xs" aria-label="MFA enabled" />}
              </div>
            </div>
          )}
        </aside>
      </div>
    </>
  );
}

function TopBar({ onToggleSidebar }: { onToggleSidebar: () => void }) {
  const navigate = useNavigate();
  const { user, logout } = useAuthStore();
  const { isOpen: isMfaOpen, onOpen: onMfaOpen, onClose: onMfaClose } = useDisclosure();
  const { data: notifData } = useNotifications(20);
  useNotificationsSocket(); // establishes real-time push; falls back to stale polling silently

  // Count unread from the SERVER's tally, not from the 20 rows this panel fetched.
  // Filtering the page counts only what happens to be on it, so once a user has more
  // than 20 notifications the badge reports whatever share of the newest 20 is unread —
  // it reads 0 while 200 older ones are still unread, then jumps back to non-zero as
  // soon as a new notification pushes an older unread row into view. That is why the
  // bell appeared to "forget" that everything had been marked read.
  const unreadCount = (notifData?.unreadCount as number) ?? 0;

  const handleLogout = async () => {
    try {
      await api.post('/auth/logout');
    } catch { /* ignore */ }
    logout();
    navigate('/login');
  };

  return (
    <header
      className="h-14 bg-white border-b border-gray-200 flex items-center px-3 sm:px-4 justify-between sticky top-0 z-30"
      style={{ paddingTop: 'env(safe-area-inset-top)' }}
    >
      <div className="flex items-center gap-2">
        <Button
          isIconOnly
          variant="light"
          size="sm"
          onPress={onToggleSidebar}
          aria-label="Toggle navigation menu"
        >
          <FiMenu />
        </Button>
        {/* Logo on mobile only — hidden on lg where the sidebar shows it */}
        <img src="/logomark-blue.png" alt="Prime Developers" className="h-7 w-7 object-contain lg:hidden" />
      </div>

      <div className="flex items-center gap-1 sm:gap-2">
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

        <Dropdown placement="bottom-end">
          <DropdownTrigger>
            <button className="flex items-center gap-2 cursor-pointer outline-none px-1 py-1 rounded-md hover:bg-gray-50 min-h-[40px]">
              <Avatar size="sm" name={user?.name} src={user?.avatarUrl} />
              <span className="text-sm font-medium hidden md:block max-w-[120px] truncate">{user?.name}</span>
              {user?.mfaEnabled && (
                <Tooltip content="MFA enabled">
                  <span className="hidden sm:inline"><FiShield className="text-green-500 text-xs" /></span>
                </Tooltip>
              )}
              <FiChevronDown size={14} className="hidden sm:inline" />
            </button>
          </DropdownTrigger>
          <DropdownMenu aria-label="User menu">
            <DropdownItem key="profile" startContent={<FiUser />} onPress={() => navigate('/profile')}>
              My Profile
            </DropdownItem>
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

function MfaBanner() {
  const { user } = useAuthStore();
  const { isOpen, onOpen, onClose } = useDisclosure();

  const shouldPrompt = !user?.mfaEnabled && ['SUPER_ADMIN', 'FOUNDER', 'EXECUTIVE', 'FINANCE', 'ACCOUNTING'].includes(user?.role ?? '');
  if (!shouldPrompt) return null;

  return (
    <>
      <div className="bg-amber-50 border-b border-amber-200 px-4 sm:px-6 py-2 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2">
        <div className="flex items-start gap-2 text-sm text-amber-700">
          <FiShield className="shrink-0 mt-0.5" />
          <span>
            <strong>Recommended:</strong> Enable two-factor auth to protect your {user?.role?.replace('_', ' ')} account.
          </span>
        </div>
        <Button size="sm" color="warning" variant="flat" onPress={onOpen} className="self-start sm:self-auto">
          Set Up Now
        </Button>
      </div>
      <MfaSetupModal isOpen={isOpen} onClose={onClose} />
    </>
  );
}

export default function Layout() {
  // Desktop collapse state (only matters at lg+)
  const [collapsed, setCollapsed] = useState(false);
  // Mobile drawer state (only matters below lg)
  const [mobileOpen, setMobileOpen] = useState(false);
  const location = useLocation();

  const handleToggle = () => {
    // The hamburger does double duty: toggles desktop sidebar, opens mobile drawer.
    // matchMedia is the source of truth — relying on innerWidth misses zoom changes.
    if (window.matchMedia('(min-width: 1024px)').matches) {
      setCollapsed((c) => !c);
    } else {
      setMobileOpen(true);
    }
  };

  return (
    <div className="flex min-h-[100dvh]">
      <Sidebar
        collapsed={collapsed}
        mobileOpen={mobileOpen}
        onMobileClose={() => setMobileOpen(false)}
      />
      <div className="flex flex-col flex-1 min-w-0">
        <TopBar onToggleSidebar={handleToggle} />
        <MfaBanner />
        <main
          className="flex-1 overflow-auto p-4 md:p-6 bg-gray-50"
          style={{ paddingBottom: 'max(env(safe-area-inset-bottom), 1rem)' }}
        >
          {/* Per-page boundary: a render throw on one page shows the fallback in the
              content area only — the sidebar/topbar stay intact. Keyed by pathname so
              navigating to another route remounts it and clears the caught error. */}
          <ErrorBoundary key={location.pathname} section="page">
            <Outlet />
          </ErrorBoundary>
        </main>
      </div>
      <MfaStepUpModal />
    </div>
  );
}
