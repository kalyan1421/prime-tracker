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
import SettingsPage from './pages/SettingsPage';
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
import InventoryPage from './pages/InventoryPage';

function ProtectedRoute({ children, permission }: { children: React.ReactNode; permission?: string }) {
  const { isAuthenticated, hasPermission } = useAuthStore();
  if (!isAuthenticated) return <Navigate to="/login" replace />;
  if (permission && !hasPermission(permission)) return <Navigate to="/" replace />;
  // Per-route error boundary so one broken page doesn't blank the app shell
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
        <Route path="projects/:id/:tab" element={<ProjectDetailPage />} />
        <Route path="reports" element={<ReportsPage />} />
        <Route path="leads" element={<LeadsPage />} />
        <Route path="tasks" element={<TasksPage />} />
        <Route path="inventory" element={<InventoryPage />} />
        <Route path="settings/notifications" element={<SettingsPage />} />
        <Route path="dashboard/founder" element={<FounderDashboardPage />} />
        <Route path="dashboard/construction" element={<ConstructionDashboardPage />} />
        <Route path="dashboard/sales" element={<SalesDashboardPage />} />
        <Route path="dashboard/finance" element={<FinanceDashboardPage />} />
        <Route path="reports/founder" element={<FounderReportsPage />} />
        <Route path="reports/construction" element={<ConstructionReportsPage />} />
        <Route path="reports/sales" element={<SalesReportsPage />} />
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
