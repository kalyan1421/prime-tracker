/**
 * /profile — a person's own account page.
 *
 * The identity fields come from the auth store rather than a fetch: the login response
 * already carries them, and re-fetching would need /users/:id, which is user:manage
 * gated — every non-admin would 403 on their own profile.
 *
 * Projects are fetched because "which projects can I see" is the question this page
 * exists to answer, and only the API knows once scoping is applied.
 */
import { FiUser } from 'react-icons/fi';
import { useAuthStore } from '../store/authStore';
import { useProjects } from '../hooks/useApi';
import { UserProfileCard } from '../components/UserProfileCard';
import { LoadingState } from '../components/ui';

export default function ProfilePage() {
  const { user } = useAuthStore();
  const { data: projects, isLoading } = useProjects();

  if (!user) return <LoadingState />;

  const list = Array.isArray(projects) ? projects : ((projects as any)?.data ?? []);

  return (
    <div className="p-4 sm:p-6 max-w-[900px] mx-auto">
      <div className="flex items-center gap-2 mb-5">
        <FiUser className="text-blue-600" />
        <h1 className="text-xl font-bold text-gray-800">My Profile</h1>
      </div>
      <UserProfileCard
        user={user}
        mode="self"
        visibleProjects={isLoading ? undefined : list}
      />
    </div>
  );
}
