import { useState, useEffect } from 'react';
import { Routes, Route, Navigate } from 'react-router-dom';
import { useAuthStore } from './store/authStore';
import Layout from './components/Layout';
import { ErrorBoundary } from './components/ErrorBoundary';
import { lazyPage } from './utils/lazyPage';
import LoginPage from './pages/LoginPage';
import AuthCallbackPage from './pages/AuthCallbackPage';
import NotFoundPage from './pages/NotFoundPage';

// Pages behind the logged-in layout load on demand (see utils/lazyPage). Login, the
// OAuth callback and the not-found page stay in the main bundle: they render before or
// outside the layout's loading state.
const DashboardPage = lazyPage(() => import('./pages/DashboardPage'));
const ProjectsPage = lazyPage(() => import('./pages/ProjectsPage'));
const ProjectDetailPage = lazyPage(() => import('./pages/ProjectDetailPage'));
const AdminPage = lazyPage(() => import('./pages/AdminPage'));
const ReportsPage = lazyPage(() => import('./pages/ReportsPage'));
const UnitDetailPage = lazyPage(() => import('./pages/UnitDetailPage'));
const LeadsPage = lazyPage(() => import('./pages/LeadsPage'));
const CampaignsPage = lazyPage(() => import('./pages/CampaignsPage'));
const VacancyReportPage = lazyPage(() => import('./pages/VacancyReportPage'));
const BuildingDetailPage = lazyPage(() => import('./pages/BuildingDetailPage'));
const SettingsPage = lazyPage(() => import('./pages/SettingsPage'));
const VisitAvailabilityPage = lazyPage(() => import('./pages/VisitAvailabilityPage'));
const ProfilePage = lazyPage(() => import('./pages/ProfilePage'));
const FounderDashboardPage = lazyPage(() => import('./pages/FounderDashboardPage'));
const ConstructionDashboardPage = lazyPage(() => import('./pages/ConstructionDashboardPage'));
const SalesDashboardPage = lazyPage(() => import('./pages/SalesDashboardPage'));
const FinanceDashboardPage = lazyPage(() => import('./pages/FinanceDashboardPage'));
const FounderReportsPage = lazyPage(() => import('./pages/FounderReportsPage'));
const ConstructionReportsPage = lazyPage(() => import('./pages/ConstructionReportsPage'));
const SalesReportsPage = lazyPage(() => import('./pages/SalesReportsPage'));
const InvestorsPage = lazyPage(() => import('./pages/InvestorsPage'));
const InvestorDetailPage = lazyPage(() => import('./pages/InvestorDetailPage'));
const TasksPage = lazyPage(() => import('./pages/TasksPage'));
const UpdatesPage = lazyPage(() => import('./pages/UpdatesPage'));
const SiteTrackerPage = lazyPage(() => import('./pages/SiteTrackerPage'));
const InventoryPage = lazyPage(() => import('./pages/InventoryPage'));
const InteriorPortfolioPage = lazyPage(() => import('./pages/InteriorPortfolioPage'));
const InteriorProjectDetailPage = lazyPage(() => import('./pages/InteriorProjectDetailPage'));
const InteriorSettingsPage = lazyPage(() => import('./pages/InteriorSettingsPage'));
const CashflowPage = lazyPage(() => import('./pages/CashflowPage'));
const BrokersPage = lazyPage(() => import('./pages/BrokersPage'));
const ReceivablesPage = lazyPage(() => import('./pages/ReceivablesPage'));
const RentHistoryImportPage = lazyPage(() => import('./pages/RentHistoryImportPage'));
const SaleHistoryImportPage = lazyPage(() => import('./pages/SaleHistoryImportPage'));

/**
 * `permission` accepts an array for pages that are a hub over several independently
 * gated sections (Reports): the page opens if the viewer can see at least one section,
 * and each section gates itself.
 */
function ProtectedRoute({ children, permission }: { children: React.ReactNode; permission?: string | string[] }) {
  const { isAuthenticated, hasAnyPermission } = useAuthStore();
  // Zustand's persist middleware rehydrates from localStorage asynchronously
  // (even though localStorage is sync, `await storage.getItem` creates a
  // microtask). We defer routing until after the first mount so the microtask
  // has resolved and isAuthenticated reflects the persisted session.
  const [hydrated, setHydrated] = useState(false);
  useEffect(() => { setHydrated(true); }, []);

  if (!hydrated) return null;
  if (!isAuthenticated) return <Navigate to="/login" replace />;
  if (permission) {
    const needed = Array.isArray(permission) ? permission : [permission];
    // Say so, rather than bouncing to "/". A silent redirect to the dashboard was
    // indistinguishable from a typo, an archived record, or the click simply not
    // registering — and it discarded the URL, so there was nothing left to ask about.
    if (!hasAnyPermission(...needed)) return <NotFoundPage reason="forbidden" />;
  }
  return <ErrorBoundary section="page">{children}</ErrorBoundary>;
}

function RootRedirect() {
  const { user } = useAuthStore();
  const role = user?.role ?? '';
  if (['SUPER_ADMIN', 'FOUNDER', 'EXECUTIVE'].includes(role)) return <Navigate to="/dashboard/founder" replace />;
  if (['CONSTRUCTION', 'PROJECT_MANAGER'].includes(role)) return <Navigate to="/dashboard/construction" replace />;
  if (['SALES', 'MARKETING'].includes(role)) return <Navigate to="/dashboard/sales" replace />;
  if (['FINANCE', 'ACCOUNTING', 'AR_AP'].includes(role)) return <Navigate to="/dashboard/finance" replace />;
  if (role === 'LEGAL') return <Navigate to="/projects" replace />;
  return <DashboardPage />;
}

export default function App() {
  return (
    <Routes>
      <Route path="/login" element={<LoginPage />} />
      <Route path="/auth/callback" element={<AuthCallbackPage />} />
      <Route
        path="/"
        element={
          <ProtectedRoute>
            <Layout />
          </ProtectedRoute>
        }
      >
        <Route index element={<RootRedirect />} />
        <Route path="projects" element={<ProjectsPage />} />
        <Route path="projects/:id" element={<ProjectDetailPage />} />
        <Route path="projects/:id/units/:unitId" element={<ProtectedRoute permission="unit:view"><UnitDetailPage /></ProtectedRoute>} />
        <Route path="projects/:id/buildings/:buildingId" element={<ProtectedRoute permission="building:view"><BuildingDetailPage /></ProtectedRoute>} />
        <Route path="projects/:id/rent-history-import" element={<ProtectedRoute permission="unit:history:backfill"><RentHistoryImportPage /></ProtectedRoute>} />
        <Route path="projects/:id/sale-history-import" element={<ProtectedRoute permission="unit:history:backfill"><SaleHistoryImportPage /></ProtectedRoute>} />
        <Route path="projects/:id/:tab" element={<ProjectDetailPage />} />
        {/* milestone:view is here so CONSTRUCTION/PROJECT_MANAGER can reach the hub at all.
            The hub has no tab of its own for them — every tab needs a financial, sales,
            lease or loan permission — so it forwards them to /reports/construction rather
            than bouncing them to "/" the way this gate used to. */}
        <Route path="reports" element={<ProtectedRoute permission={['financial:view', 'sales:view', 'lease:view', 'loan:view', 'milestone:view']}><ReportsPage /></ProtectedRoute>} />
        <Route path="leads" element={<ProtectedRoute permission="lead:view"><LeadsPage /></ProtectedRoute>} />
        {/* Unified into a single Leads section — old Lead Dashboard route now redirects. */}
        <Route path="leads/dashboard" element={<Navigate to="/leads" replace />} />
        <Route path="campaigns" element={<ProtectedRoute permission="campaign:view"><CampaignsPage /></ProtectedRoute>} />
        <Route path="reports/vacancy" element={<ProtectedRoute permission="sales:view"><VacancyReportPage /></ProtectedRoute>} />
        <Route path="tasks" element={<ProtectedRoute permission="task:view"><TasksPage /></ProtectedRoute>} />
        <Route path="updates" element={<ProtectedRoute permission="updateBoard:view"><UpdatesPage /></ProtectedRoute>} />
        <Route path="site-tracker" element={<ProtectedRoute permission="siteTracker:view"><SiteTrackerPage /></ProtectedRoute>} />
        <Route path="inventory" element={<InventoryPage />} />
        <Route path="interior" element={<ProtectedRoute permission="interior:view"><InteriorPortfolioPage /></ProtectedRoute>} />
        <Route path="cashflow" element={<ProtectedRoute permission="financial:view"><CashflowPage /></ProtectedRoute>} />
        <Route path="interior/settings" element={<ProtectedRoute permission="interior:view"><InteriorSettingsPage /></ProtectedRoute>} />
        <Route path="interior/:id" element={<ProtectedRoute permission="interior:view"><InteriorProjectDetailPage /></ProtectedRoute>} />
        <Route path="brokers" element={<ProtectedRoute permission="broker:view"><BrokersPage /></ProtectedRoute>} />
        <Route path="receivables" element={<ProtectedRoute permission="financial:view"><ReceivablesPage /></ProtectedRoute>} />
        <Route path="profile" element={<ProfilePage />} />
        <Route path="settings/notifications" element={<SettingsPage />} />
        <Route
          path="settings/availability"
          element={<ProtectedRoute permission="siteVisit:view"><VisitAvailabilityPage /></ProtectedRoute>}
        />
        <Route path="dashboard/founder" element={<ProtectedRoute permission="unit:view"><FounderDashboardPage /></ProtectedRoute>} />
        <Route path="dashboard/construction" element={<ProtectedRoute permission="unit:view"><ConstructionDashboardPage /></ProtectedRoute>} />
        <Route path="dashboard/sales" element={<ProtectedRoute permission="unit:view"><SalesDashboardPage /></ProtectedRoute>} />
        <Route path="dashboard/finance" element={<ProtectedRoute permission="financial:view"><FinanceDashboardPage /></ProtectedRoute>} />
        <Route path="reports/founder" element={<ProtectedRoute permission="financial:view"><FounderReportsPage /></ProtectedRoute>} />
        {/* milestone:view, not financial:view — ConstructionReportsPage's own tabs (Budget &
            Cost / Draw Requests) each self-gate on the finer-grained permission they actually
            need; the route itself only needs to admit anyone who can see at least ONE tab, and
            Milestone & Schedule (financial:view-free) is the one CONSTRUCTION/PROJECT_MANAGER
            hold that the route was previously blocking them from entirely. */}
        <Route path="reports/construction" element={<ProtectedRoute permission="milestone:view"><ConstructionReportsPage /></ProtectedRoute>} />
        <Route path="reports/sales" element={<ProtectedRoute permission="sales:view"><SalesReportsPage /></ProtectedRoute>} />
        <Route
          path="investors"
          element={
            <ProtectedRoute permission="investor:view">
              <InvestorsPage />
            </ProtectedRoute>
          }
        />
        <Route
          path="investors/:id"
          element={
            <ProtectedRoute permission="investor:view">
              <InvestorDetailPage />
            </ProtectedRoute>
          }
        />
        <Route
          path="admin/*"
          element={
            <ProtectedRoute permission="user:manage">
              <AdminPage />
            </ProtectedRoute>
          }
        />
        {/* Unknown paths render a 404 instead of silently redirecting to "/".
            Last child of the layout route, so a signed-in user keeps the sidebar and can
            navigate onwards, and an unauthenticated one still hits this route's
            ProtectedRoute and lands on /login. `/login` and `/auth/callback` are more
            specific than this splat, so React Router still prefers them. */}
        <Route path="*" element={<NotFoundPage />} />
      </Route>
    </Routes>
  );
}
