import { useState, useEffect } from 'react';
import { Routes, Route, Navigate } from 'react-router-dom';
import { useAuthStore } from './store/authStore';
import Layout from './components/Layout';
import { ErrorBoundary } from './components/ErrorBoundary';
import LoginPage from './pages/LoginPage';
import AuthCallbackPage from './pages/AuthCallbackPage';
import DashboardPage from './pages/DashboardPage';
import ProjectsPage from './pages/ProjectsPage';
import ProjectDetailPage from './pages/ProjectDetailPage';
import AdminPage from './pages/AdminPage';
import ReportsPage from './pages/ReportsPage';
import UnitDetailPage from './pages/UnitDetailPage';
import LeadsPage from './pages/LeadsPage';
import CampaignsPage from './pages/CampaignsPage';
import VacancyReportPage from './pages/VacancyReportPage';
import BuildingDetailPage from './pages/BuildingDetailPage';
import SettingsPage from './pages/SettingsPage';
import ProfilePage from './pages/ProfilePage';
import FounderDashboardPage from './pages/FounderDashboardPage';
import ConstructionDashboardPage from './pages/ConstructionDashboardPage';
import SalesDashboardPage from './pages/SalesDashboardPage';
import FinanceDashboardPage from './pages/FinanceDashboardPage';
import FounderReportsPage from './pages/FounderReportsPage';
import ConstructionReportsPage from './pages/ConstructionReportsPage';
import SalesReportsPage from './pages/SalesReportsPage';
import InvestorsPage from './pages/InvestorsPage';
import InvestorDetailPage from './pages/InvestorDetailPage';
import TasksPage from './pages/TasksPage';
import UpdatesPage from './pages/UpdatesPage';
import SiteTrackerPage from './pages/SiteTrackerPage';
import InventoryPage from './pages/InventoryPage';
import InteriorPortfolioPage from './pages/InteriorPortfolioPage';
import InteriorProjectDetailPage from './pages/InteriorProjectDetailPage';
import CashflowPage from './pages/CashflowPage';
import BrokersPage from './pages/BrokersPage';
import ReceivablesPage from './pages/ReceivablesPage';
import RentHistoryImportPage from './pages/RentHistoryImportPage';
import SaleHistoryImportPage from './pages/SaleHistoryImportPage';

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
    if (!hasAnyPermission(...needed)) return <Navigate to="/" replace />;
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
        <Route path="projects/:id/units/:unitId" element={<UnitDetailPage />} />
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
        <Route path="tasks" element={<TasksPage />} />
        <Route path="updates" element={<ProtectedRoute permission="updateBoard:view"><UpdatesPage /></ProtectedRoute>} />
        <Route path="site-tracker" element={<ProtectedRoute permission="siteTracker:view"><SiteTrackerPage /></ProtectedRoute>} />
        <Route path="inventory" element={<InventoryPage />} />
        <Route path="interior" element={<ProtectedRoute permission="interior:view"><InteriorPortfolioPage /></ProtectedRoute>} />
        <Route path="cashflow" element={<ProtectedRoute permission="financial:view"><CashflowPage /></ProtectedRoute>} />
        <Route path="interior/:id" element={<ProtectedRoute permission="interior:view"><InteriorProjectDetailPage /></ProtectedRoute>} />
        <Route path="brokers" element={<ProtectedRoute permission="broker:view"><BrokersPage /></ProtectedRoute>} />
        <Route path="receivables" element={<ProtectedRoute permission="financial:view"><ReceivablesPage /></ProtectedRoute>} />
        <Route path="profile" element={<ProfilePage />} />
        <Route path="settings/notifications" element={<SettingsPage />} />
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
      </Route>
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
