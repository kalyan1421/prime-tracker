/**
 * UserProfileCard — the one profile surface, rendered in two places:
 *
 *   /profile          mode="self"   a person editing their own details
 *   Admin -> Users    mode="admin"  an admin editing someone else's
 *
 * One component on purpose. The lease form was duplicated between the project tab and
 * the unit page and drifted until fields were visible in one place and uneditable in
 * the other; two profile views would rot the same way.
 *
 * What is editable here is IDENTITY only — name, avatar, phone, job title. Role, roles,
 * active status and email are authorization/identity-key concerns and live on separate
 * admin-only routes. The API enforces this independently: UpdateProfileDto has no such
 * fields, so a request carrying one is rejected before it reaches the service.
 */
import { useEffect, useState } from 'react';
import {
  Card, CardBody, CardHeader, Button, Input, Avatar, Chip, Divider, addToast,
} from '@heroui/react';
import {
  FiUser, FiMail, FiPhone, FiBriefcase, FiShield, FiClock, FiKey, FiCheck, FiFolder,
} from 'react-icons/fi';
import { useUpdateMyProfile, useUpdateUser, useChangePassword } from '../hooks/useApi';
import { useAuthStore } from '../store/authStore';
import { errMsg, fmtDate } from '../utils/fmt';

/** Roles that only ever see the projects they are a member of. */
const SCOPED_ROLES = ['PROJECT_MANAGER', 'CONSTRUCTION', 'SALES', 'MARKETING'];

interface Props {
  user: any;
  mode: 'self' | 'admin';
  /** Projects the viewer can actually see — used to explain their access. */
  visibleProjects?: any[];
}

export function UserProfileCard({ user, mode, visibleProjects }: Props) {
  const isSelf = mode === 'self';
  const { patchUser } = useAuthStore();
  const updateMine = useUpdateMyProfile();
  const updateTheirs = useUpdateUser();
  const changePassword = useChangePassword();

  const [form, setForm] = useState({ name: '', phone: '', jobTitle: '', avatarUrl: '' });
  const [dirty, setDirty] = useState(false);
  const set = (k: string) => (e: React.ChangeEvent<HTMLInputElement>) => {
    setForm((f) => ({ ...f, [k]: e.target.value }));
    setDirty(true);
  };

  useEffect(() => {
    setForm({
      name: user?.name ?? '',
      phone: user?.phone ?? '',
      jobTitle: user?.jobTitle ?? '',
      avatarUrl: user?.avatarUrl ?? '',
    });
    setDirty(false);
  }, [user?.id, user?.name, user?.phone, user?.jobTitle, user?.avatarUrl]);

  const roles: string[] = user?.roles?.length ? user.roles : [user?.role].filter(Boolean);
  const isScoped = roles.some((r) => SCOPED_ROLES.includes(r));
  // Straight from the auth payload — this is the union the API actually granted, so it
  // cannot drift from a locally recomputed copy of the role map.
  const permissions: string[] = user?.permissions ?? [];

  const save = async () => {
    const payload = {
      name: form.name.trim(),
      phone: form.phone.trim(),
      jobTitle: form.jobTitle.trim(),
      avatarUrl: form.avatarUrl.trim(),
    };
    try {
      // Admin edits go through PUT /users/:id, which also owns email; self-service
      // cannot touch email at all, so the payloads differ by exactly that field.
      const saved = isSelf
        ? await updateMine.mutateAsync(payload)
        : await updateTheirs.mutateAsync({
          id: user.id,
          data: { name: payload.name, phone: payload.phone, jobTitle: payload.jobTitle },
        });
      // Keep the TopBar name/avatar in step without forcing a re-login.
      if (isSelf) patchUser({ name: saved.name, avatarUrl: saved.avatarUrl, phone: saved.phone, jobTitle: saved.jobTitle });
      addToast({ title: 'Profile updated', color: 'success' });
      setDirty(false);
    } catch (e) {
      addToast({ title: errMsg(e, 'Failed to update profile'), color: 'danger' });
    }
  };

  return (
    <div className="flex flex-col gap-5">
      {/* ── Identity ─────────────────────────────────────────────────────── */}
      <Card shadow="sm">
        <CardHeader className="flex items-center gap-3 pb-2">
          <Avatar size="lg" name={form.name || user?.name} src={form.avatarUrl || user?.avatarUrl} />
          <div className="min-w-0">
            <p className="font-semibold text-gray-800 truncate">{user?.name}</p>
            <p className="text-xs text-gray-500 truncate">{user?.jobTitle || 'No job title set'}</p>
          </div>
        </CardHeader>
        <CardBody className="pt-2">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <Input size="sm" label="Full name" value={form.name} onChange={set('name')}
              startContent={<FiUser className="text-gray-400 text-sm" />} />
            <Input size="sm" label="Job title" value={form.jobTitle} onChange={set('jobTitle')}
              startContent={<FiBriefcase className="text-gray-400 text-sm" />} />
            <Input size="sm" label="Phone" value={form.phone} onChange={set('phone')}
              startContent={<FiPhone className="text-gray-400 text-sm" />} />
            {/* Email is the Google SSO identity key — changing it would orphan the
                account from its sign-in, so it is read-only for everyone. */}
            <Input size="sm" label="Email" value={user?.email ?? ''} isReadOnly isDisabled
              startContent={<FiMail className="text-gray-400 text-sm" />}
              description="Sign-in identity — cannot be changed" />
            <Input size="sm" label="Avatar URL" value={form.avatarUrl} onChange={set('avatarUrl')}
              className="sm:col-span-2" description="Leave blank to fall back to initials" />
          </div>
          <div className="flex justify-end mt-4">
            <Button size="sm" color="primary" onPress={save} isDisabled={!dirty}
              isLoading={updateMine.isPending || updateTheirs.isPending}>
              Save changes
            </Button>
          </div>
        </CardBody>
      </Card>

      {/* ── Access ───────────────────────────────────────────────────────── */}
      <Card shadow="sm">
        <CardHeader className="pb-1">
          <p className="font-semibold text-sm text-gray-700">Access</p>
        </CardHeader>
        <CardBody className="pt-1">
          <p className="text-[11px] uppercase tracking-wide text-gray-400 font-semibold mb-1.5">
            {roles.length > 1 ? 'Roles' : 'Role'}
          </p>
          <div className="flex flex-wrap gap-1.5 mb-3">
            {roles.map((r) => (
              <Chip key={r} size="sm" variant="flat" color="primary" className="text-[11px]">
                {r.replace(/_/g, ' ')}
              </Chip>
            ))}
            {roles.length === 0 && <span className="text-xs text-gray-400">No role assigned</span>}
          </div>
          {mode === 'admin' && (
            <p className="text-[11px] text-gray-400 mb-3">
              Roles and account status are changed in the Users table, not here.
            </p>
          )}

          <Divider className="my-3" />

          {/* The answer to "why can't I see that project?" — nothing else in the app
              tells a user whether they are project-scoped or portfolio-wide. */}
          <div className="flex items-start gap-2">
            <FiFolder className="text-gray-400 mt-0.5 shrink-0" />
            <div className="min-w-0">
              <p className="text-sm text-gray-700">
                {isScoped
                  ? 'You only see projects you are assigned to.'
                  : 'You can see every project in the portfolio.'}
              </p>
              {isSelf && visibleProjects && (
                <p className="text-xs text-gray-500 mt-0.5">
                  {visibleProjects.length === 0
                    ? 'You are not assigned to any project yet — ask an admin to add you.'
                    : `${visibleProjects.length} project${visibleProjects.length === 1 ? '' : 's'}: ${visibleProjects.map((p: any) => p.name).join(', ')}`}
                </p>
              )}
              <p className="text-[11px] text-gray-400 mt-1">
                {permissions.length} permission{permissions.length === 1 ? '' : 's'} across{' '}
                {roles.length} role{roles.length === 1 ? '' : 's'}
              </p>
            </div>
          </div>
        </CardBody>
      </Card>

      {/* ── Security (self only) ─────────────────────────────────────────── */}
      {isSelf && (
        <Card shadow="sm">
          <CardHeader className="pb-1">
            <p className="font-semibold text-sm text-gray-700">Security</p>
          </CardHeader>
          <CardBody className="pt-1">
            <div className="flex items-center gap-2 text-sm text-gray-700 mb-1.5">
              <FiShield className={user?.mfaEnabled ? 'text-green-600' : 'text-gray-400'} />
              {user?.mfaEnabled
                ? <span>Two-factor authentication is <span className="text-green-700 font-medium">on</span></span>
                : <span className="text-gray-500">Two-factor authentication is off</span>}
            </div>
            {user?.lastLoginAt && (
              <div className="flex items-center gap-2 text-xs text-gray-500 mb-3">
                <FiClock className="text-gray-400" />
                Last sign-in {fmtDate(user.lastLoginAt)}
              </div>
            )}
            <Divider className="my-3" />
            <ChangePasswordForm changePassword={changePassword} />
          </CardBody>
        </Card>
      )}
    </div>
  );
}

/**
 * Password change. Split out so its transient state cannot leak into the profile form.
 * The current password is required even though the session is already authenticated —
 * an unattended browser must not be enough to take over the account.
 */
function ChangePasswordForm({ changePassword }: { changePassword: ReturnType<typeof useChangePassword> }) {
  const [cur, setCur] = useState('');
  const [next, setNext] = useState('');
  const [confirm, setConfirm] = useState('');
  const [err, setErr] = useState<string | null>(null);

  const submit = async () => {
    setErr(null);
    if (next !== confirm) return setErr('The two new passwords do not match.');
    if (next.length < 8) return setErr('New password must be at least 8 characters.');
    try {
      const res = await changePassword.mutateAsync({ currentPassword: cur, newPassword: next });
      setCur(''); setNext(''); setConfirm('');
      addToast({
        title: res?.sessionsRevoked
          ? `Password changed — signed out of ${res.sessionsRevoked} other session${res.sessionsRevoked === 1 ? '' : 's'}`
          : 'Password changed',
        color: 'success',
      });
    } catch (e) {
      setErr(errMsg(e, 'Could not change password'));
    }
  };

  return (
    <div>
      <div className="flex items-center gap-2 mb-2">
        <FiKey className="text-gray-400" />
        <p className="text-sm font-medium text-gray-700">Change password</p>
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        <Input size="sm" type="password" label="Current password" value={cur}
          onChange={(e) => { setCur(e.target.value); setErr(null); }} autoComplete="current-password" />
        <Input size="sm" type="password" label="New password" value={next}
          onChange={(e) => { setNext(e.target.value); setErr(null); }} autoComplete="new-password"
          description="At least 8 characters" />
        <Input size="sm" type="password" label="Confirm new password" value={confirm}
          onChange={(e) => { setConfirm(e.target.value); setErr(null); }} autoComplete="new-password" />
      </div>
      {err && <p className="text-xs text-red-600 mt-2">{err}</p>}
      <p className="text-[11px] text-gray-400 mt-2">
        Changing your password signs you out everywhere else. Accounts that sign in with
        Google have no password to change.
      </p>
      <div className="flex justify-end mt-3">
        <Button size="sm" color="primary" variant="flat" onPress={submit}
          isDisabled={!cur || !next || !confirm}
          isLoading={changePassword.isPending}
          startContent={<FiCheck className="text-xs" />}>
          Update password
        </Button>
      </div>
    </div>
  );
}
