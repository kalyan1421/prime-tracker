import React, { useState } from 'react';
import {
  Card, CardBody, CardHeader, Tabs, Tab, Button, Select, SelectItem,
  Chip, Avatar, Spinner, Input, Switch, Textarea,
  Modal, ModalContent, ModalHeader, ModalBody, ModalFooter,
  useDisclosure, addToast,
} from '@heroui/react';
import { FiUsers, FiLink, FiFileText, FiRefreshCw, FiCheck, FiX, FiPlus, FiEdit2, FiTrash2, FiSearch, FiShield, FiMinus, FiEye, FiEyeOff, FiSliders, FiLock } from 'react-icons/fi';
import {
  useUsers, useUpdateUserRole, useUpdateUserRoles, useToggleUserActive, useCreateUser, useUpdateUser, useDeleteUser,
  useSetUserPassword,
  useAuditLog, useAuditFilterOptions, useQBStatus, useQBSync,
  useRoleCounts, useRoleDefinitions,
  useCustomOptions, useCreateCustomOption, useDeleteCustomOption,
  type CustomOption,
} from '../hooks/useApi';
import { fmtDate } from '../utils/fmt';
import { StatusBadge, LoadingState, ErrorState } from '../components/ui';
import { useAuthStore } from '../store/authStore';
import { API_BASE_URL } from '../lib/api';

export default function AdminPage() {
  return (
    <div>
      <h1 className="text-xl sm:text-2xl font-bold mb-4 sm:mb-6">Administration</h1>

      <Tabs color="primary" size="sm" classNames={{ tabList: "overflow-x-auto scrollbar-none flex-nowrap" }}>
        <Tab key="users" title={<div className="flex items-center gap-1"><FiUsers /><span>Users</span></div>}>
          <UsersPanel />
        </Tab>
        <Tab key="roles" title={<div className="flex items-center gap-1"><FiShield /><span>Roles</span></div>}>
          <RolesPanel />
        </Tab>
        <Tab key="integrations" title={<div className="flex items-center gap-1"><FiLink /><span>Integrations</span></div>}>
          <IntegrationsPanel />
        </Tab>
        <Tab key="audit" title={<div className="flex items-center gap-1"><FiFileText /><span>Audit Log</span></div>}>
          <AuditPanel />
        </Tab>
        <Tab key="options" title={<div className="flex items-center gap-1"><FiSliders /><span>Options</span></div>}>
          <OptionsPanel />
        </Tab>
      </Tabs>
    </div>
  );
}

// ---- Users Panel ----
const ROLES = [
  'SUPER_ADMIN', 'FOUNDER', 'EXECUTIVE', 'FINANCE', 'ACCOUNTING', 'AR_AP',
  'PROJECT_MANAGER', 'CONSTRUCTION', 'SALES', 'MARKETING', 'LEGAL', 'VIEWER',
];

const ROLE_CHIP_COLOR: Record<string, 'primary' | 'success' | 'secondary' | 'warning' | 'danger' | 'default'> = {
  SUPER_ADMIN: 'danger',
  FOUNDER: 'primary',
  EXECUTIVE: 'primary',
  FINANCE: 'success',
  ACCOUNTING: 'success',
  AR_AP: 'success',
  PROJECT_MANAGER: 'secondary',
  CONSTRUCTION: 'warning',
  SALES: 'warning',
  MARKETING: 'secondary',
  LEGAL: 'default',
  VIEWER: 'default',
};

// Role categories for the multi-role picker grid
const ROLE_CATEGORIES = [
  {
    label: 'Leadership',
    color: 'bg-blue-50 border-blue-200',
    chipColor: 'primary' as const,
    roles: ['FOUNDER', 'EXECUTIVE'],
  },
  {
    label: 'Finance',
    color: 'bg-emerald-50 border-emerald-200',
    chipColor: 'success' as const,
    roles: ['FINANCE', 'ACCOUNTING', 'AR_AP'],
  },
  {
    label: 'Operations',
    color: 'bg-amber-50 border-amber-200',
    chipColor: 'warning' as const,
    roles: ['PROJECT_MANAGER', 'CONSTRUCTION', 'SALES', 'MARKETING'],
  },
  {
    label: 'Support',
    color: 'bg-slate-50 border-slate-200',
    chipColor: 'default' as const,
    roles: ['LEGAL', 'VIEWER'],
  },
];

function MultiRolePicker({
  selectedRoles,
  onChange,
  availableRoles,
}: {
  selectedRoles: string[];
  onChange: (roles: string[]) => void;
  availableRoles: string[];
}) {
  const toggle = (role: string) => {
    if (selectedRoles.includes(role)) {
      const next = selectedRoles.filter((r) => r !== role);
      if (next.length === 0) return; // must keep at least one
      onChange(next);
    } else {
      onChange([...selectedRoles, role]);
    }
  };

  return (
    <div className="space-y-3">
      {ROLE_CATEGORIES.map((cat) => {
        const visibleRoles = cat.roles.filter((r) => availableRoles.includes(r));
        if (!visibleRoles.length) return null;
        return (
          <div key={cat.label}>
            <p className="text-[10px] font-bold uppercase tracking-widest text-gray-400 mb-1.5">{cat.label}</p>
            <div className="flex flex-wrap gap-1.5">
              {visibleRoles.map((role) => {
                const active = selectedRoles.includes(role);
                return (
                  <button
                    key={role}
                    type="button"
                    onClick={() => toggle(role)}
                    className={`inline-flex items-center gap-1 px-2.5 py-1 rounded-lg text-xs font-medium border transition-all duration-150 ${
                      active
                        ? 'bg-slate-800 text-white border-slate-800 shadow-sm'
                        : 'bg-white text-slate-500 border-slate-200 hover:border-slate-400 hover:text-slate-700'
                    }`}
                  >
                    {active && <FiCheck className="w-3 h-3" />}
                    {role.replace(/_/g, ' ')}
                  </button>
                );
              })}
            </div>
          </div>
        );
      })}
    </div>
  );
}

function UsersPanel() {
  const { user: currentUser } = useAuthStore();
  const { data, isLoading, error } = useUsers();
  const updateRole = useUpdateUserRole();
  const updateRoles = useUpdateUserRoles();
  const toggleActive = useToggleUserActive();
  const createUser = useCreateUser();
  const updateUser = useUpdateUser();
  const availableRoles = currentUser?.role === 'SUPER_ADMIN' ? ROLES : ROLES.filter((r) => r !== 'SUPER_ADMIN');
  const deleteUser = useDeleteUser();
  const setUserPassword = useSetUserPassword();

  const [search, setSearch] = useState('');
  const [roleFilter, setRoleFilter] = useState('');
  const [selectedUser, setSelectedUser] = useState<any>(null);
  const [editForm, setEditForm] = useState({ name: '', email: '', phone: '', jobTitle: '' });
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [createForm, setCreateForm] = useState({ name: '', email: '', roles: ['VIEWER'] as string[], password: '', confirmPassword: '' });
  const [showCreatePassword, setShowCreatePassword] = useState(false);
  const createPasswordMismatch = createForm.password.length > 0 && createForm.password !== createForm.confirmPassword;
  const createPasswordTooShort = createForm.password.length > 0 && createForm.password.length < 8;
  // local state for the multi-role picker (mirrors selectedUser.roles until saved)
  const [pendingRoles, setPendingRoles] = useState<string[]>([]);
  const [rolesChanged, setRolesChanged] = useState(false);
  const [pwForm, setPwForm] = useState({ newPassword: '', confirm: '' });
  const [pwError, setPwError] = useState('');
  const [showPw, setShowPw] = useState(false);

  const { isOpen: isCreateOpen, onOpen: onCreateOpen, onClose: onCreateClose } = useDisclosure();
  const { isOpen: isEditOpen, onOpen: onEditOpen, onClose: onEditClose } = useDisclosure();
  const { isOpen: isPwOpen, onOpen: onPwOpen, onClose: onPwClose } = useDisclosure();

  if (isLoading) return <LoadingState />;
  if (error) return <ErrorState />;

  const users = (data as any[]) || [];

  const filtered = users.filter((u: any) => {
    const matchesSearch =
      !search ||
      u.name?.toLowerCase().includes(search.toLowerCase()) ||
      u.email?.toLowerCase().includes(search.toLowerCase());
    const matchesRole = !roleFilter || u.role === roleFilter;
    return matchesSearch && matchesRole;
  });

  const handleRoleChange = async (userId: string, role: string) => {
    try {
      await updateRole.mutateAsync({ id: userId, role });
      if (selectedUser?.id === userId) setSelectedUser((u: any) => ({ ...u, role }));
      addToast({ title: 'Role updated', color: 'success' });
    } catch {
      addToast({ title: 'Failed to update role', color: 'danger' });
    }
  };

  const handleToggleActive = async (userId: string, isActive: boolean) => {
    try {
      await toggleActive.mutateAsync({ id: userId, isActive: !isActive });
      if (selectedUser?.id === userId) setSelectedUser((u: any) => ({ ...u, isActive: !isActive }));
      addToast({ title: isActive ? 'User deactivated' : 'User activated', color: 'success' });
    } catch {
      addToast({ title: 'Failed to update user', color: 'danger' });
    }
  };

  const handleCreateUser = async () => {
    if (createPasswordMismatch || createPasswordTooShort) return;
    try {
      await createUser.mutateAsync({
        name: createForm.name,
        email: createForm.email,
        roles: createForm.roles,
        password: createForm.password || undefined,
      });
      addToast({ title: 'User created', color: 'success' });
      onCreateClose();
      setCreateForm({ name: '', email: '', roles: ['VIEWER'], password: '', confirmPassword: '' });
      setShowCreatePassword(false);
    } catch (err: any) {
      addToast({ title: err?.response?.data?.message || 'Failed to create user', color: 'danger' });
    }
  };

  const handleEditSave = async () => {
    if (!selectedUser) return;
    try {
      const updated = await updateUser.mutateAsync({ id: selectedUser.id, data: editForm });
      setSelectedUser((u: any) => ({ ...u, ...updated }));
      addToast({ title: 'User updated', color: 'success' });
      onEditClose();
    } catch {
      addToast({ title: 'Failed to update user', color: 'danger' });
    }
  };

  const handleDelete = async () => {
    if (!selectedUser) return;
    try {
      await deleteUser.mutateAsync(selectedUser.id);
      addToast({ title: 'User deleted', color: 'success' });
      setSelectedUser(null);
      setShowDeleteConfirm(false);
    } catch (err: any) {
      addToast({ title: err?.response?.data?.message || 'Failed to delete user', color: 'danger' });
    }
  };

  const openSidePanel = (u: any) => {
    setSelectedUser(u);
    setShowDeleteConfirm(false);
    const initialRoles = u.roles?.length ? u.roles : [u.role];
    setPendingRoles(initialRoles);
    setRolesChanged(false);
  };

  const handleRolesPendingChange = (roles: string[]) => {
    setPendingRoles(roles);
    const current = selectedUser?.roles?.length ? selectedUser.roles : [selectedUser?.role];
    setRolesChanged(JSON.stringify([...roles].sort()) !== JSON.stringify([...current].sort()));
  };

  const handleSaveRoles = async () => {
    if (!selectedUser || !pendingRoles.length) return;
    try {
      await updateRoles.mutateAsync({ id: selectedUser.id, roles: pendingRoles });
      setSelectedUser((u: any) => ({ ...u, roles: pendingRoles, role: pendingRoles[0] }));
      setRolesChanged(false);
      addToast({ title: 'Roles updated', color: 'success' });
    } catch {
      addToast({ title: 'Failed to update roles', color: 'danger' });
    }
  };

  return (
    <div className="mt-4 flex gap-4">
      {/* Main table */}
      <div className="flex-1 min-w-0">
        <Card shadow="sm">
          <CardHeader className="pb-0 flex-col gap-3 items-stretch">
            {/* Search + Add */}
            <div className="flex items-center gap-2">
              <Input
                size="sm"
                placeholder="Search by name or email..."
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                startContent={<FiSearch className="text-gray-400" />}
                className="flex-1"
              />
              <Button size="sm" color="primary" startContent={<FiPlus />} onPress={onCreateOpen}>
                Add User
              </Button>
            </div>
            {/* Role filter chips */}
            <div className="flex items-center gap-1 flex-wrap">
              <span className="text-xs text-gray-500 mr-1">Filter:</span>
              <Chip
                size="sm"
                variant={roleFilter === '' ? 'solid' : 'flat'}
                color="default"
                className="cursor-pointer"
                onClick={() => setRoleFilter('')}
              >
                All
              </Chip>
              {ROLES.map((r) => (
                <Chip
                  key={r}
                  size="sm"
                  variant={roleFilter === r ? 'solid' : 'flat'}
                  color={ROLE_CHIP_COLOR[r]}
                  className="cursor-pointer"
                  onClick={() => setRoleFilter(roleFilter === r ? '' : r)}
                >
                  {r.replace(/_/g, ' ')}
                </Chip>
              ))}
              <span className="ml-auto text-xs text-gray-400">{filtered.length} users</span>
            </div>
          </CardHeader>
          <CardBody className="pt-2">
            <div className="overflow-x-auto">
              <div className="responsive-table-wrap"><table className="w-full text-sm min-w-[560px]">
                <thead>
                  <tr className="border-b border-gray-200">
                    <th className="text-left py-2 px-2 text-xs font-semibold text-gray-500 uppercase">User</th>
                    <th className="text-left py-2 px-2 text-xs font-semibold text-gray-500 uppercase">Email</th>
                    <th className="text-left py-2 px-2 text-xs font-semibold text-gray-500 uppercase">Role</th>
                    <th className="text-left py-2 px-2 text-xs font-semibold text-gray-500 uppercase">Status</th>
                    <th className="text-left py-2 px-2 text-xs font-semibold text-gray-500 uppercase">Last Login</th>
                    <th className="text-left py-2 px-2 text-xs font-semibold text-gray-500 uppercase">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {filtered.map((u: any) => (
                    <tr
                      key={u.id}
                      className={`border-b border-gray-50 cursor-pointer hover:bg-gray-50 transition-colors ${selectedUser?.id === u.id ? 'bg-blue-50' : ''}`}
                      onClick={() => openSidePanel(u)}
                    >
                      <td className="py-2 px-2">
                        <div className="flex items-center gap-2">
                          <Avatar size="sm" name={u.name} src={u.avatarUrl} className="w-7 h-7 flex-shrink-0" />
                          <span className="font-medium truncate max-w-[140px]">{u.name}</span>
                        </div>
                      </td>
                      <td className="py-2 px-2 text-gray-600 text-xs truncate max-w-[180px]">{u.email}</td>
                      <td className="py-2 px-2">
                        <div className="flex flex-wrap gap-1">
                          {(u.roles?.length ? u.roles : [u.role]).map((r: string) => (
                            <Chip key={r} size="sm" variant="flat" color={ROLE_CHIP_COLOR[r] || 'default'}>
                              {r?.replace(/_/g, ' ')}
                            </Chip>
                          ))}
                        </div>
                      </td>
                      <td className="py-2 px-2">
                        <Chip size="sm" variant="flat" color={u.isActive ? 'success' : 'danger'}>
                          {u.isActive ? 'Active' : 'Disabled'}
                        </Chip>
                      </td>
                      <td className="py-2 px-2 text-xs text-gray-500 whitespace-nowrap">
                        {fmtDate(u.lastLoginAt)}
                      </td>
                      <td className="py-2 px-2" onClick={(e) => e.stopPropagation()}>
                        <div className="flex items-center gap-1">
                          <Button
                            size="sm"
                            isIconOnly
                            variant="light"
                            onPress={() => {
                              openSidePanel(u);
                              setEditForm({ name: u.name, email: u.email, phone: u.phone ?? '', jobTitle: u.jobTitle ?? '' });
                              onEditOpen();
                            }}
                          >
                            <FiEdit2 className="text-gray-500" />
                          </Button>
                          <Button
                            size="sm"
                            isIconOnly
                            variant="light"
                            color="danger"
                            onPress={() => {
                              openSidePanel(u);
                              setShowDeleteConfirm(true);
                            }}
                          >
                            <FiTrash2 />
                          </Button>
                        </div>
                      </td>
                    </tr>
                  ))}
                  {filtered.length === 0 && (
                    <tr>
                      <td colSpan={6} className="py-8 text-center text-sm text-gray-400">
                        No users found
                      </td>
                    </tr>
                  )}
                </tbody>
              </table></div>
            </div>
          </CardBody>
        </Card>
      </div>

      {/* Side Panel */}
      {selectedUser && (
        <div className="w-80 flex-shrink-0">
          <Card shadow="sm" className="sticky top-4">
            <CardHeader className="flex justify-between items-center pb-0">
              <span className="text-sm font-semibold text-gray-700">User Details</span>
              <Button
                size="sm"
                isIconOnly
                variant="light"
                onPress={() => { setSelectedUser(null); setShowDeleteConfirm(false); }}
              >
                <FiX />
              </Button>
            </CardHeader>
            <CardBody className="flex flex-col gap-4">
              {/* Avatar + identity */}
              <div className="flex flex-col items-center gap-2 py-2">
                <Avatar
                  size="lg"
                  name={selectedUser.name}
                  src={selectedUser.avatarUrl}
                  className="w-16 h-16"
                />
                <div className="text-center">
                  <p className="font-semibold text-gray-800">{selectedUser.name}</p>
                  <p className="text-xs text-gray-500">{selectedUser.email}</p>
                </div>
                <div className="flex flex-wrap gap-1 justify-center">
                  {(pendingRoles.length ? pendingRoles : [selectedUser.role]).map((r: string) => (
                    <Chip key={r} size="sm" variant="flat" color={ROLE_CHIP_COLOR[r] || 'default'}>
                      {r?.replace(/_/g, ' ')}
                    </Chip>
                  ))}
                  <Chip size="sm" variant="flat" color={selectedUser.isActive ? 'success' : 'danger'}>
                    {selectedUser.isActive ? 'Active' : 'Disabled'}
                  </Chip>
                </div>
              </div>

              {/* Multi-role picker */}
              <div>
                <div className="flex items-center justify-between mb-2">
                  <p className="text-xs font-semibold text-gray-500 uppercase">Roles</p>
                  {rolesChanged && (
                    <Button
                      size="sm"
                      color="primary"
                      variant="flat"
                      onPress={handleSaveRoles}
                      isLoading={updateRoles.isPending}
                      className="h-6 text-xs px-2"
                    >
                      Save roles
                    </Button>
                  )}
                </div>
                <MultiRolePicker
                  selectedRoles={pendingRoles}
                  onChange={handleRolesPendingChange}
                  availableRoles={availableRoles}
                />
                <p className="text-[10px] text-gray-400 mt-2">
                  Click to toggle · First selected = primary role
                </p>
              </div>

              {/* Status toggle */}
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-xs font-semibold text-gray-500 uppercase">Account Active</p>
                  <p className="text-xs text-gray-400">{selectedUser.isActive ? 'User can log in' : 'Access blocked'}</p>
                </div>
                <Switch
                  size="sm"
                  isSelected={selectedUser.isActive}
                  onValueChange={() => handleToggleActive(selectedUser.id, selectedUser.isActive)}
                />
              </div>

              {/* MFA status */}
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-xs font-semibold text-gray-500 uppercase">MFA</p>
                  <p className="text-xs text-gray-400">{selectedUser.mfaEnabled ? 'Enabled' : 'Not set up'}</p>
                </div>
                <FiShield className={selectedUser.mfaEnabled ? 'text-green-500' : 'text-gray-300'} />
              </div>

              {/* Dates */}
              <div className="grid grid-cols-2 gap-2 text-xs">
                <div>
                  <p className="text-gray-400 uppercase font-semibold">Last Login</p>
                  <p className="text-gray-700">{fmtDate(selectedUser.lastLoginAt) || '—'}</p>
                </div>
                <div>
                  <p className="text-gray-400 uppercase font-semibold">Created</p>
                  <p className="text-gray-700">{fmtDate(selectedUser.createdAt) || '—'}</p>
                </div>
              </div>

              {/* Action buttons */}
              <div className="flex flex-col gap-2 pt-2 border-t border-gray-100">
                <div className="flex gap-2">
                  <Button
                    size="sm"
                    variant="bordered"
                    startContent={<FiEdit2 />}
                    className="flex-1"
                    onPress={() => {
                      setEditForm({ name: selectedUser.name, email: selectedUser.email, phone: selectedUser.phone ?? '', jobTitle: selectedUser.jobTitle ?? '' });
                      onEditOpen();
                    }}
                  >
                    Edit
                  </Button>
                  <Button
                    size="sm"
                    color="danger"
                    variant="flat"
                    startContent={<FiTrash2 />}
                    className="flex-1"
                    onPress={() => setShowDeleteConfirm(true)}
                  >
                    Delete
                  </Button>
                </div>
                <Button
                  size="sm"
                  variant="flat"
                  startContent={<FiLock />}
                  onPress={() => { setPwForm({ newPassword: '', confirm: '' }); setPwError(''); onPwOpen(); }}
                >
                  Reset password
                </Button>
              </div>
            </CardBody>
          </Card>
        </div>
      )}

      {/* Create User Modal */}
      <Modal isOpen={isCreateOpen} onClose={onCreateClose} scrollBehavior="inside">
        <ModalContent>
          <ModalHeader>Add User</ModalHeader>
          <ModalBody>
            <div className="flex flex-col gap-4">
              <Input
                size="sm"
                label="Name"
                isRequired
                value={createForm.name}
                onChange={(e) => setCreateForm((f) => ({ ...f, name: e.target.value }))}
              />
              <Input
                size="sm"
                label="Email"
                isRequired
                type="email"
                value={createForm.email}
                onChange={(e) => setCreateForm((f) => ({ ...f, email: e.target.value }))}
              />
              <div>
                <p className="text-xs font-medium text-gray-600 mb-1.5">Roles</p>
                <MultiRolePicker
                  selectedRoles={createForm.roles}
                  onChange={(roles) => setCreateForm((f) => ({ ...f, roles }))}
                  availableRoles={availableRoles}
                />
              </div>
              <div className="border-t border-gray-100 pt-3">
                <p className="text-xs font-medium text-gray-600 mb-1.5 flex items-center gap-1.5">
                  <FiLock className="text-gray-400" /> Password (optional)
                </p>
                <div className="flex flex-col gap-2">
                  <Input
                    size="sm"
                    label="Password"
                    type={showCreatePassword ? 'text' : 'password'}
                    autoComplete="new-password"
                    value={createForm.password}
                    onChange={(e) => setCreateForm((f) => ({ ...f, password: e.target.value }))}
                    isInvalid={createPasswordTooShort}
                    errorMessage={createPasswordTooShort ? 'Minimum 8 characters' : undefined}
                    endContent={
                      <button
                        type="button"
                        onClick={() => setShowCreatePassword((v) => !v)}
                        className="text-gray-400 hover:text-gray-600"
                        aria-label={showCreatePassword ? 'Hide password' : 'Show password'}
                      >
                        {showCreatePassword ? <FiEyeOff /> : <FiEye />}
                      </button>
                    }
                  />
                  <Input
                    size="sm"
                    label="Confirm Password"
                    type={showCreatePassword ? 'text' : 'password'}
                    autoComplete="new-password"
                    value={createForm.confirmPassword}
                    onChange={(e) => setCreateForm((f) => ({ ...f, confirmPassword: e.target.value }))}
                    isInvalid={createPasswordMismatch}
                    errorMessage={createPasswordMismatch ? 'Passwords do not match' : undefined}
                  />
                </div>
                <p className="text-[11px] text-gray-400 mt-1.5">
                  Leave blank to allow Google Sign-In only. Set a password to also enable email/password login.
                </p>
              </div>
            </div>
          </ModalBody>
          <ModalFooter>
            <Button size="sm" variant="light" onPress={onCreateClose}>Cancel</Button>
            <Button
              size="sm"
              color="primary"
              onPress={handleCreateUser}
              isLoading={createUser.isPending}
              isDisabled={!createForm.name || !createForm.email || !createForm.roles.length || createPasswordMismatch || createPasswordTooShort}
            >
              Create User
            </Button>
          </ModalFooter>
        </ModalContent>
      </Modal>

      {/* Edit Modal */}
      <Modal isOpen={isEditOpen} onClose={onEditClose} scrollBehavior="inside">
        <ModalContent>
          <ModalHeader>Edit User</ModalHeader>
          <ModalBody>
            <div className="flex flex-col gap-4">
              <Input
                size="sm"
                label="Name"
                isRequired
                value={editForm.name}
                onChange={(e) => setEditForm((f) => ({ ...f, name: e.target.value }))}
              />
              <Input
                size="sm"
                label="Email"
                isRequired
                type="email"
                value={editForm.email}
                onChange={(e) => setEditForm((f) => ({ ...f, email: e.target.value }))}
              />
              <Input
                size="sm"
                label="Job title"
                value={editForm.jobTitle}
                onChange={(e) => setEditForm((f) => ({ ...f, jobTitle: e.target.value }))}
              />
              <Input
                size="sm"
                label="Phone"
                value={editForm.phone}
                onChange={(e) => setEditForm((f) => ({ ...f, phone: e.target.value }))}
              />
              <p className="text-[11px] text-gray-400">
                Role and account status are changed from the row actions, not here.
              </p>
            </div>
          </ModalBody>
          <ModalFooter>
            <Button size="sm" variant="light" onPress={onEditClose}>Cancel</Button>
            <Button
              size="sm"
              color="primary"
              onPress={handleEditSave}
              isLoading={updateUser.isPending}
            >
              Save Changes
            </Button>
          </ModalFooter>
        </ModalContent>
      </Modal>

      {/* Reset Password Modal.
          No "current password" field — an admin uses this precisely when the user
          cannot sign in. The self-service path (/profile) does require it. */}
      <Modal isOpen={isPwOpen} onClose={onPwClose} scrollBehavior="inside">
        <ModalContent>
          <ModalHeader className="flex flex-col gap-0.5">
            <span>Reset password</span>
            <span className="text-xs font-normal text-gray-500">{selectedUser?.name} · {selectedUser?.email}</span>
          </ModalHeader>
          <ModalBody>
            <div className="flex flex-col gap-3">
              <Input
                size="sm"
                label="New password"
                type={showPw ? 'text' : 'password'}
                autoComplete="new-password"
                value={pwForm.newPassword}
                isInvalid={pwForm.newPassword.length > 0 && pwForm.newPassword.length < 8}
                errorMessage={
                  pwForm.newPassword.length > 0 && pwForm.newPassword.length < 8
                    ? 'At least 8 characters'
                    : undefined
                }
                onChange={(e) => { setPwForm((f) => ({ ...f, newPassword: e.target.value })); setPwError(''); }}
                endContent={
                  <button type="button" className="text-gray-400" onClick={() => setShowPw((v) => !v)}>
                    {showPw ? <FiEyeOff /> : <FiEye />}
                  </button>
                }
              />
              <Input
                size="sm"
                label="Confirm password"
                type={showPw ? 'text' : 'password'}
                autoComplete="new-password"
                value={pwForm.confirm}
                isInvalid={pwForm.confirm.length > 0 && pwForm.confirm !== pwForm.newPassword}
                errorMessage={
                  pwForm.confirm.length > 0 && pwForm.confirm !== pwForm.newPassword
                    ? 'Passwords do not match'
                    : undefined
                }
                onChange={(e) => { setPwForm((f) => ({ ...f, confirm: e.target.value })); setPwError(''); }}
              />
              <p className="text-xs text-gray-500 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2">
                This signs <strong>{selectedUser?.name}</strong> out of every device. Tell them the
                new password over a channel they already trust — it is not emailed to them.
              </p>
              {pwError && <p className="text-xs text-red-600">{pwError}</p>}
            </div>
          </ModalBody>
          <ModalFooter>
            <Button size="sm" variant="light" onPress={onPwClose}>Cancel</Button>
            <Button
              size="sm"
              color="primary"
              isLoading={setUserPassword.isPending}
              isDisabled={pwForm.newPassword.length < 8 || pwForm.newPassword !== pwForm.confirm}
              onPress={async () => {
                try {
                  const r = await setUserPassword.mutateAsync({
                    id: selectedUser.id,
                    newPassword: pwForm.newPassword,
                  });
                  addToast({
                    title: `Password reset for ${selectedUser.name}`,
                    description: `${r?.sessionsRevoked ?? 0} active session(s) signed out.`,
                    color: 'success',
                  });
                  setPwForm({ newPassword: '', confirm: '' });
                  onPwClose();
                } catch (err: any) {
                  setPwError(err?.response?.data?.message || 'Could not reset password');
                }
              }}
            >
              Reset password
            </Button>
          </ModalFooter>
        </ModalContent>
      </Modal>

      {/* Delete Confirm Modal */}
      <Modal isOpen={showDeleteConfirm} onClose={() => setShowDeleteConfirm(false)} scrollBehavior="inside">
        <ModalContent>
          <ModalHeader>Delete User</ModalHeader>
          <ModalBody>
            <p className="text-sm text-gray-700">
              Delete <strong>{selectedUser?.name}</strong>? This cannot be undone.
            </p>
          </ModalBody>
          <ModalFooter>
            <Button size="sm" variant="light" onPress={() => setShowDeleteConfirm(false)}>
              Cancel
            </Button>
            <Button
              size="sm"
              color="danger"
              onPress={handleDelete}
              isLoading={deleteUser.isPending}
            >
              Delete
            </Button>
          </ModalFooter>
        </ModalContent>
      </Modal>
    </div>
  );
}

// ---- Integrations Panel ----
function IntegrationsPanel() {
  const { data: qbStatus, isLoading } = useQBStatus();
  const qbSync = useQBSync();

  if (isLoading) return <LoadingState />;
  const qb = qbStatus as any;

  return (
    <div className="mt-4">
      <Card shadow="sm">
        <CardHeader className="flex justify-between items-center">
          <div className="flex items-center gap-2">
            <span className="font-semibold">QuickBooks Online</span>
            <Chip size="sm" variant="flat" color={qb?.connected ? 'success' : 'default'}>
              {qb?.connected ? 'Connected' : 'Not Connected'}
            </Chip>
          </div>
          {qb?.connected ? (
            <Button
              size="sm"
              variant="bordered"
              startContent={qbSync.isPending ? <Spinner size="sm" /> : <FiRefreshCw />}
              onPress={() => qbSync.mutate()}
              isDisabled={qbSync.isPending}
            >
              Sync Now
            </Button>
          ) : (
            <Button size="sm" color="primary" as="a" href={`${API_BASE_URL}/api/quickbooks/connect`}>
              Connect QuickBooks
            </Button>
          )}
        </CardHeader>
        <CardBody className="pt-0">
          {qb?.connected ? (
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
              <div>
                <p className="text-xs text-gray-500">Company</p>
                <p className="text-sm font-medium">{qb.companyName || '\u2014'}</p>
              </div>
              <div>
                <p className="text-xs text-gray-500">Last Sync</p>
                <p className="text-sm font-medium">{fmtDate(qb.lastSyncAt)}</p>
              </div>
              <div>
                <p className="text-xs text-gray-500">Status</p>
                {qbSync.isSuccess ? (
                  <p className="text-sm text-green-600 font-medium">Sync complete</p>
                ) : qbSync.isError ? (
                  <p className="text-sm text-red-600 font-medium">Sync failed</p>
                ) : (
                  <p className="text-sm text-gray-500">Ready</p>
                )}
              </div>
            </div>
          ) : (
            <p className="text-sm text-gray-500">
              Connect your QuickBooks Online account to sync vendor bills, payments, and actuals.
            </p>
          )}
        </CardBody>
      </Card>
    </div>
  );
}

// ---- Audit Log Panel ----
const AUDIT_ACTION_STYLE: Record<string, string> = {
  CREATE: 'bg-emerald-50 text-emerald-700 border-emerald-200',
  UPDATE: 'bg-blue-50 text-blue-700 border-blue-200',
  DELETE: 'bg-red-50 text-red-700 border-red-200',
  ROLE_CHANGE: 'bg-amber-50 text-amber-700 border-amber-200',
  LOGIN: 'bg-slate-50 text-slate-500 border-slate-200',
  LOGOUT: 'bg-slate-50 text-slate-500 border-slate-200',
};

/** Relative-day heading, so a long log reads as "when" before "what". */
function dayLabel(iso: string) {
  const d = new Date(iso);
  const today = new Date();
  const startOf = (x: Date) => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime();
  const diff = Math.round((startOf(today) - startOf(d)) / 86_400_000);
  if (diff === 0) return 'Today';
  if (diff === 1) return 'Yesterday';
  return d.toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric', year: d.getFullYear() === today.getFullYear() ? undefined : 'numeric' });
}

const DATE_PRESETS = [
  { key: '', label: 'All time' },
  { key: '1', label: 'Today' },
  { key: '7', label: '7 days' },
  { key: '30', label: '30 days' },
  { key: '90', label: '90 days' },
];

const PAGE_SIZE = 50;

function AuditPanel() {
  const [action, setAction] = useState('');
  const [entity, setEntity] = useState('');
  const [userId, setUserId] = useState('');
  const [days, setDays] = useState('');
  const [page, setPage] = useState(1);

  // A preset is turned into an absolute startDate here rather than on the server, so the
  // boundary follows the viewer's own midnight instead of the API host's.
  const startDate = days
    ? new Date(Date.now() - (Number(days) - 1) * 86_400_000).toISOString().slice(0, 10)
    : undefined;

  const { data: options } = useAuditFilterOptions();
  const { data, isLoading, error, isFetching } = useAuditLog({
    action: action || undefined,
    entity: entity || undefined,
    userId: userId || undefined,
    startDate,
    page,
    limit: PAGE_SIZE,
  });

  // Any filter change invalidates the current page number.
  const setFilter = (fn: () => void) => { fn(); setPage(1); };

  if (isLoading) return <LoadingState />;
  if (error) return <ErrorState />;

  // GET /audit returns a paginated wrapper ({ events, total, page, limit }).
  const events = (data as any)?.events || [];
  const total = (data as any)?.total ?? 0;
  const opts = (options as any) || {};
  const activeCount = [action, entity, userId, days].filter(Boolean).length;
  const lastPage = Math.max(1, Math.ceil(total / PAGE_SIZE));

  // Group consecutive events by calendar day for the date separators.
  const groups: { day: string; rows: any[] }[] = [];
  for (const e of events) {
    const label = dayLabel(e.createdAt);
    if (groups.length && groups[groups.length - 1].day === label) groups[groups.length - 1].rows.push(e);
    else groups.push({ day: label, rows: [e] });
  }

  return (
    <div className="mt-4">
      {/* Filter bar */}
      <Card shadow="sm" className="mb-3">
        <CardBody className="py-3">
          <div className="flex flex-wrap items-center gap-2">
            <Select
              size="sm" aria-label="Action" className="w-[170px]" placeholder="All actions"
              selectedKeys={action ? [action] : []}
              onSelectionChange={(k) => setFilter(() => setAction((Array.from(k)[0] as string) || ''))}
            >
              {((opts.actions ?? []) as any[]).map((a) => (
                <SelectItem key={a.value} textValue={a.value}>
                  {a.value.replace(/_/g, ' ')} ({a.count})
                </SelectItem>
              ))}
            </Select>

            <Select
              size="sm" aria-label="Entity" className="w-[190px]" placeholder="All entities"
              selectedKeys={entity ? [entity] : []}
              onSelectionChange={(k) => setFilter(() => setEntity((Array.from(k)[0] as string) || ''))}
            >
              {((opts.entities ?? []) as any[]).map((e) => (
                <SelectItem key={e.value} textValue={e.value}>{e.value} ({e.count})</SelectItem>
              ))}
            </Select>

            <Select
              size="sm" aria-label="User" className="w-[200px]" placeholder="Anyone"
              selectedKeys={userId ? [userId] : []}
              onSelectionChange={(k) => setFilter(() => setUserId((Array.from(k)[0] as string) || ''))}
            >
              {((opts.actors ?? []) as any[]).map((u) => (
                <SelectItem key={u.value} textValue={u.label}>{u.label} ({u.count})</SelectItem>
              ))}
            </Select>

            <div className="flex items-center gap-1 ml-auto">
              {DATE_PRESETS.map((p) => (
                <button
                  key={p.key || 'all'}
                  onClick={() => setFilter(() => setDays(p.key))}
                  className={`px-2.5 py-1 rounded-lg text-xs font-medium border transition-colors ${
                    days === p.key
                      ? 'bg-slate-800 text-white border-slate-800'
                      : 'bg-white text-slate-500 border-slate-200 hover:border-slate-400'
                  }`}
                >
                  {p.label}
                </button>
              ))}
            </div>
          </div>

          <div className="flex items-center gap-3 mt-2.5 text-xs text-gray-500">
            {/* The server's total, not events.length — the page holds at most 50, and
                reporting that as the count made a 716-event log read as "50 events". */}
            <span>
              <strong className="text-gray-700">{total.toLocaleString()}</strong> event{total === 1 ? '' : 's'}
              {activeCount > 0 && ' matching'}
            </span>
            {isFetching && <Spinner size="sm" />}
            {activeCount > 0 && (
              <button
                className="text-blue-600 hover:underline"
                onClick={() => setFilter(() => { setAction(''); setEntity(''); setUserId(''); setDays(''); })}
              >
                Clear {activeCount} filter{activeCount === 1 ? '' : 's'}
              </button>
            )}
          </div>
        </CardBody>
      </Card>

      <Card shadow="sm">
        <CardBody className="p-0">
          {events.length === 0 ? (
            <div className="py-12 text-center text-sm text-gray-400">
              No audit events match these filters.
            </div>
          ) : (
            <div className="overflow-x-auto">
              <div className="responsive-table-wrap"><table className="w-full text-sm min-w-[680px]">
                <thead>
                  <tr className="border-b border-gray-200">
                    <th className="text-left py-2 px-3 text-xs font-semibold text-gray-500 uppercase w-[92px]">Time</th>
                    <th className="text-left py-2 px-3 text-xs font-semibold text-gray-500 uppercase">User</th>
                    <th className="text-left py-2 px-3 text-xs font-semibold text-gray-500 uppercase w-[120px]">Action</th>
                    <th className="text-left py-2 px-3 text-xs font-semibold text-gray-500 uppercase">Entity</th>
                    <th className="text-left py-2 px-3 text-xs font-semibold text-gray-500 uppercase">Details</th>
                    <th className="text-left py-2 px-3 text-xs font-semibold text-gray-500 uppercase w-[110px]">IP</th>
                  </tr>
                </thead>
                <tbody>
                  {groups.map((g) => (
                    <React.Fragment key={g.day}>
                      <tr className="bg-gray-50/70">
                        <td colSpan={6} className="py-1.5 px-3 text-[10px] font-bold uppercase tracking-widest text-gray-400">
                          {g.day}
                        </td>
                      </tr>
                      {g.rows.map((e: any) => (
                        <tr key={e.id} className="border-b border-gray-50 hover:bg-gray-50/50">
                          <td className="py-2 px-3 text-xs text-gray-500 whitespace-nowrap">
                            {new Date(e.createdAt).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })}
                          </td>
                          <td className="py-2 px-3">
                            <span className="text-gray-800">{e.user?.name || '\u2014'}</span>
                            {e.user?.email && <span className="block text-[11px] text-gray-400">{e.user.email}</span>}
                          </td>
                          <td className="py-2 px-3">
                            <span className={`inline-block px-2 py-0.5 rounded-md border text-[10px] font-bold tracking-wide ${AUDIT_ACTION_STYLE[e.action] || 'bg-gray-50 text-gray-600 border-gray-200'}`}>
                              {e.action.replace(/_/g, ' ')}
                            </span>
                          </td>
                          <td className="py-2 px-3">
                            <span className="text-gray-700">{e.entity || '\u2014'}</span>
                            {e.entityId && (
                              <span className="block font-mono text-[10px] text-gray-400" title={e.entityId}>
                                {e.entityId.substring(0, 8)}…
                              </span>
                            )}
                          </td>
                          {/* metadata was recorded on 265 of these events and never shown —
                              it is where "why" lives (PASSWORD_RESET_BY_ADMIN, sessionsRevoked). */}
                          <td className="py-2 px-3 text-xs text-gray-500 max-w-[280px]">
                            <AuditDetails event={e} />
                          </td>
                          <td className="py-2 px-3 text-xs text-gray-400">{e.ipAddress || '\u2014'}</td>
                        </tr>
                      ))}
                    </React.Fragment>
                  ))}
                </tbody>
              </table></div>
            </div>
          )}
        </CardBody>
      </Card>

      {lastPage > 1 && (
        <div className="flex items-center justify-between mt-3">
          <p className="text-xs text-gray-500">
            Page {page} of {lastPage}
          </p>
          <div className="flex gap-2">
            <Button size="sm" variant="bordered" isDisabled={page <= 1} onPress={() => setPage((p) => p - 1)}>
              Previous
            </Button>
            <Button size="sm" variant="bordered" isDisabled={page >= lastPage} onPress={() => setPage((p) => p + 1)}>
              Next
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}

/**
 * The human-readable "what changed" for one event.
 *
 * Prefers metadata (an explicit note the writer chose to leave, e.g.
 * PASSWORD_RESET_BY_ADMIN) and falls back to naming the fields in newValues. Full
 * old/new payloads are deliberately not rendered inline — some carry encrypted loan
 * fields and long document blobs, and a log you cannot skim is a log nobody reads.
 */
function AuditDetails({ event }: { event: any }) {
  const meta = event.metadata && typeof event.metadata === 'object' ? event.metadata : null;
  if (meta) {
    const entries = Object.entries(meta).filter(([, v]) => v !== null && v !== undefined);
    if (entries.length) {
      return (
        <span className="flex flex-wrap gap-1">
          {entries.slice(0, 3).map(([k, v]) => (
            <span key={k} className="inline-block bg-gray-100 rounded px-1.5 py-0.5 text-[10px] text-gray-600">
              {k === 'event' ? String(v).replace(/_/g, ' ').toLowerCase() : `${k}: ${String(v)}`}
            </span>
          ))}
        </span>
      );
    }
  }
  const changed = event.newValues && typeof event.newValues === 'object'
    ? Object.keys(event.newValues)
    : [];
  if (changed.length) {
    return (
      <span className="text-[11px] text-gray-400">
        {changed.slice(0, 4).join(', ')}{changed.length > 4 ? ` +${changed.length - 4}` : ''}
      </span>
    );
  }
  return <span className="text-gray-300">—</span>;
}

// ---- Roles Panel ----

const CATEGORY_LABELS: Record<string, string> = {
  admin: 'Administration',
  leadership: 'Leadership',
  finance: 'Finance',
  operations: 'Operations',
  support: 'Support',
};

const CATEGORY_ORDER = ['admin', 'leadership', 'finance', 'operations', 'support'];

function RolesPanel() {
  const { data: defs, isLoading: defsLoading } = useRoleDefinitions();
  const { data: counts, isLoading: countsLoading } = useRoleCounts();
  const { data: usersData } = useUsers();
  const [selectedRole, setSelectedRole] = useState<string | null>(null);
  const [viewMode, setViewMode] = useState<'cards' | 'matrix'>('cards');

  if (defsLoading || countsLoading) return <LoadingState />;

  const roles = (defs as any)?.roles || [];
  const permissionCategories = (defs as any)?.permissionCategories || [];
  const roleCounts = (counts as Record<string, number>) || {};
  const users = (usersData as any[]) || [];

  const selectedRoleData = roles.find((r: any) => r.role === selectedRole);
  const selectedRoleUsers = users.filter((u: any) => u.role === selectedRole);

  // Group roles by category
  const grouped: Record<string, any[]> = {};
  for (const r of roles) {
    const cat = r.category || 'support';
    if (!grouped[cat]) grouped[cat] = [];
    grouped[cat].push(r);
  }

  return (
    <div className="mt-4">
      {/* View toggle */}
      <div className="flex items-center gap-3 mb-4">
        <Button
          size="sm"
          variant={viewMode === 'cards' ? 'solid' : 'flat'}
          color="primary"
          onPress={() => setViewMode('cards')}
        >
          Cards
        </Button>
        <Button
          size="sm"
          variant={viewMode === 'matrix' ? 'solid' : 'flat'}
          color="primary"
          onPress={() => setViewMode('matrix')}
        >
          Permission Matrix
        </Button>
        <span className="ml-auto text-xs text-gray-400">{roles.length} roles defined</span>
      </div>

      {viewMode === 'cards' ? (
        <div className="flex gap-4">
          {/* Cards grid */}
          <div className="flex-1 min-w-0">
            {CATEGORY_ORDER.map((cat) => {
              const catRoles = grouped[cat];
              if (!catRoles?.length) return null;
              return (
                <div key={cat} className="mb-6">
                  <h3 className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-3">
                    {CATEGORY_LABELS[cat] || cat}
                  </h3>
                  <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
                    {catRoles.map((r: any) => (
                      <Card
                        key={r.role}
                        shadow="sm"
                        isPressable
                        className={`cursor-pointer transition-all ${selectedRole === r.role ? 'ring-2 ring-blue-400' : ''}`}
                        onPress={() => setSelectedRole(selectedRole === r.role ? null : r.role)}
                      >
                        <CardBody className="p-4">
                          <div className="flex items-center justify-between mb-2">
                            <Chip size="sm" variant="flat" color={ROLE_CHIP_COLOR[r.role] || 'default'}>
                              {r.label}
                            </Chip>
                            <span className="text-xs text-gray-400 font-medium">
                              {roleCounts[r.role] || 0} user{(roleCounts[r.role] || 0) !== 1 ? 's' : ''}
                            </span>
                          </div>
                          <p className="text-xs text-gray-500 line-clamp-2">{r.description}</p>
                          <p className="text-xs text-gray-300 mt-2">{r.permissions?.length || 0} permissions</p>
                        </CardBody>
                      </Card>
                    ))}
                  </div>
                </div>
              );
            })}
          </div>

          {/* Side panel */}
          {selectedRoleData && (
            <div className="w-80 flex-shrink-0">
              <Card shadow="sm" className="sticky top-4">
                <CardHeader className="flex justify-between items-center pb-0">
                  <div className="flex items-center gap-2">
                    <Chip size="sm" variant="flat" color={ROLE_CHIP_COLOR[selectedRoleData.role] || 'default'}>
                      {selectedRoleData.label}
                    </Chip>
                    <Chip size="sm" variant="flat" color="default">
                      {CATEGORY_LABELS[selectedRoleData.category] || selectedRoleData.category}
                    </Chip>
                  </div>
                  <Button size="sm" isIconOnly variant="light" onPress={() => setSelectedRole(null)}>
                    <FiX />
                  </Button>
                </CardHeader>
                <CardBody className="flex flex-col gap-4">
                  <p className="text-xs text-gray-500">{selectedRoleData.description}</p>

                  {/* Permissions by category */}
                  <div>
                    <p className="text-xs font-semibold text-gray-500 uppercase mb-2">Permissions</p>
                    <div className="space-y-3 max-h-[400px] overflow-y-auto pr-1">
                      {permissionCategories.map((pc: any) => {
                        const hasAny = pc.permissions.some((p: string) => selectedRoleData.permissions?.includes(p));
                        if (!hasAny && selectedRoleData.role !== 'SUPER_ADMIN') return null;
                        return (
                          <div key={pc.key}>
                            <p className="text-xs font-medium text-gray-600 mb-1">{pc.label}</p>
                            <div className="space-y-0.5">
                              {pc.permissions.map((perm: string) => {
                                const has = selectedRoleData.permissions?.includes(perm);
                                return (
                                  <div key={perm} className="flex items-center gap-2 text-xs">
                                    {has ? (
                                      <FiCheck className="text-green-500 flex-shrink-0" />
                                    ) : (
                                      <FiMinus className="text-gray-300 flex-shrink-0" />
                                    )}
                                    <span className={has ? 'text-gray-700' : 'text-gray-300'}>
                                      {perm}
                                    </span>
                                  </div>
                                );
                              })}
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </div>

                  {/* Users with this role */}
                  <div>
                    <p className="text-xs font-semibold text-gray-500 uppercase mb-2">
                      Users ({selectedRoleUsers.length})
                    </p>
                    {selectedRoleUsers.length === 0 ? (
                      <p className="text-xs text-gray-400">No users with this role</p>
                    ) : (
                      <div className="space-y-2 max-h-[200px] overflow-y-auto">
                        {selectedRoleUsers.map((u: any) => (
                          <div key={u.id} className="flex items-center gap-2">
                            <Avatar size="sm" name={u.name} src={u.avatarUrl} className="w-6 h-6 flex-shrink-0" />
                            <div className="min-w-0">
                              <p className="text-xs font-medium text-gray-700 truncate">{u.name}</p>
                              <p className="text-xs text-gray-400 truncate">{u.email}</p>
                            </div>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                </CardBody>
              </Card>
            </div>
          )}
        </div>
      ) : (
        /* Matrix view */
        <Card shadow="sm">
          <CardBody className="p-0">
            <div className="overflow-x-auto">
              <div className="responsive-table-wrap"><table className="w-full text-xs min-w-[480px]">
                <thead>
                  <tr className="border-b border-gray-200 bg-gray-50">
                    <th className="text-left py-2 px-3 font-semibold text-gray-500 uppercase sticky left-0 bg-gray-50 min-w-[180px]">
                      Permission
                    </th>
                    {roles.map((r: any) => (
                      <th
                        key={r.role}
                        className="py-2 px-1 text-center font-semibold min-w-[60px]"
                      >
                        <Chip size="sm" variant="flat" color={ROLE_CHIP_COLOR[r.role] || 'default'} className="text-[10px]">
                          {r.label.length > 8 ? r.label.substring(0, 7) + '\u2026' : r.label}
                        </Chip>
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {permissionCategories.map((pc: any) => (
                    <React.Fragment key={`cat-${pc.key}`}>
                      <tr className="bg-gray-50">
                        <td
                          colSpan={roles.length + 1}
                          className="py-1.5 px-3 font-semibold text-gray-600 uppercase text-[10px] tracking-wider sticky left-0 bg-gray-50"
                        >
                          {pc.label}
                        </td>
                      </tr>
                      {pc.permissions.map((perm: string) => (
                        <tr key={perm} className="border-b border-gray-50 hover:bg-gray-50">
                          <td className="py-1 px-3 text-gray-600 sticky left-0 bg-white font-mono">
                            {perm}
                          </td>
                          {roles.map((r: any) => {
                            const has = r.permissions?.includes(perm);
                            return (
                              <td key={r.role} className="py-1 px-1 text-center">
                                {has ? (
                                  <FiCheck className="inline text-green-500" />
                                ) : (
                                  <FiMinus className="inline text-gray-200" />
                                )}
                              </td>
                            );
                          })}
                        </tr>
                      ))}
                    </React.Fragment>
                  ))}
                </tbody>
              </table></div>
            </div>
          </CardBody>
        </Card>
      )}
    </div>
  );
}

// ---- Options Panel ----

const CATEGORY_META: Record<string, { label: string; description: string }> = {
  project_status: { label: 'Project Status',    description: 'Status values for projects (Active, On Hold, etc.)' },
  project_phase:  { label: 'Project Phase',     description: 'Phases in the project lifecycle' },
  unit_status:    { label: 'Unit Status',        description: 'Status values for individual units' },
  unit_type:      { label: 'Unit Type',          description: 'Types of units (Retail, Medical, Office, etc.)' },
  sale_status:    { label: 'Sale Status',        description: 'Stages in the sales pipeline' },
  lead_status:    { label: 'Lead Status',        description: 'Lead funnel stages' },
  milestone_status:{ label: 'Milestone Status', description: 'Milestone progress states' },
  lease_status:   { label: 'Lease Status',       description: 'Lease lifecycle states' },
  task_status:    { label: 'Task Status',        description: 'Task board column states' },
  task_priority:  { label: 'Task Priority',      description: 'Priority levels for tasks' },
  budget_category:{ label: 'Budget Category',    description: 'Categories for budget lines, commitments, and actuals' },
  loan_type:      { label: 'Loan Type',          description: 'Types of loans (Construction, Permanent, Bridge, etc.)' },
};

const COLOR_OPTIONS = [
  { value: 'default',   label: 'Gray'   },
  { value: 'primary',   label: 'Blue'   },
  { value: 'secondary', label: 'Purple' },
  { value: 'success',   label: 'Green'  },
  { value: 'warning',   label: 'Orange' },
  { value: 'danger',    label: 'Red'    },
];

function slugify(s: string) {
  return s.trim().toUpperCase().replace(/\s+/g, '_').replace(/[^A-Z0-9_]/g, '');
}

function CategoryOptions({ category }: { category: string }) {
  const { data: options = [], isLoading } = useCustomOptions(category);
  const createOpt = useCreateCustomOption();
  const deleteOpt = useDeleteCustomOption();

  const [newLabel, setNewLabel] = useState('');
  const [newColor, setNewColor] = useState('default');
  const [adding, setAdding] = useState(false);

  const handleAdd = async () => {
    const label = newLabel.trim();
    if (!label) return;
    const value = slugify(label);
    if (options.some((o: CustomOption) => o.value === value)) {
      addToast({ title: 'A option with that value already exists', color: 'warning' });
      return;
    }
    try {
      await createOpt.mutateAsync({ category, value, label, color: newColor });
      setNewLabel('');
      setNewColor('default');
      setAdding(false);
      addToast({ title: 'Option added', color: 'success' });
    } catch {
      addToast({ title: 'Failed to add option', color: 'danger' });
    }
  };

  if (isLoading) return <div className="py-6 text-center text-gray-400">Loading…</div>;

  return (
    <div className="space-y-2">
      {options.map((opt: CustomOption) => (
        <div
          key={opt.id}
          className={`flex items-center justify-between px-3 py-2 rounded-lg border ${opt.isSystem ? 'bg-gray-50 border-gray-200' : 'bg-white border-blue-100'}`}
        >
          <div className="flex items-center gap-3">
            <Chip
              size="sm"
              color={(opt.color as any) || 'default'}
              variant="flat"
            >
              {opt.label}
            </Chip>
            <span className="text-xs text-gray-400 font-mono">{opt.value}</span>
            {opt.isSystem && (
              <Chip size="sm" variant="flat" color="default" className="text-[10px]">system</Chip>
            )}
          </div>
          {!opt.isSystem && (
            <Button
              size="sm"
              isIconOnly
              variant="light"
              color="danger"
              onPress={async () => {
                try {
                  await deleteOpt.mutateAsync(opt.id);
                  addToast({ title: 'Option removed', color: 'success' });
                } catch {
                  addToast({ title: 'Cannot remove this option', color: 'danger' });
                }
              }}
            >
              <FiTrash2 size={13} />
            </Button>
          )}
        </div>
      ))}

      {adding ? (
        <div className="flex gap-2 pt-1 flex-wrap">
          <Input
            size="sm"
            placeholder="Label (e.g. Interior Fit-Out)"
            value={newLabel}
            onValueChange={setNewLabel}
            className="flex-1 min-w-[180px]"
            autoFocus
            onKeyDown={(e) => { if (e.key === 'Enter') handleAdd(); if (e.key === 'Escape') setAdding(false); }}
          />
          <Select
            size="sm"
            selectedKeys={[newColor]}
            onSelectionChange={(keys) => setNewColor(Array.from(keys)[0] as string)}
            className="w-32"
            aria-label="Color"
          >
            {COLOR_OPTIONS.map((c) => (
              <SelectItem key={c.value} textValue={c.label}>{c.label}</SelectItem>
            ))}
          </Select>
          <Button size="sm" color="primary" onPress={handleAdd} isLoading={createOpt.isPending}>Add</Button>
          <Button size="sm" variant="light" onPress={() => { setAdding(false); setNewLabel(''); }}>Cancel</Button>
        </div>
      ) : (
        <Button
          size="sm"
          variant="light"
          color="primary"
          startContent={<FiPlus />}
          onPress={() => setAdding(true)}
          className="mt-1"
        >
          Add option
        </Button>
      )}
    </div>
  );
}

function OptionsPanel() {
  const categories = Object.keys(CATEGORY_META);
  const [selected, setSelected] = useState(categories[0]);

  return (
    <div className="mt-4 flex flex-col sm:flex-row gap-4">
      {/* Left sidebar — category list */}
      <Card className="sm:w-56 shrink-0">
        <CardBody className="p-2">
          <p className="text-xs text-gray-400 font-medium px-2 py-1 uppercase tracking-wide">Categories</p>
          <div className="space-y-0.5">
            {categories.map((cat) => (
              <button
                key={cat}
                onClick={() => setSelected(cat)}
                className={`w-full text-left text-sm px-3 py-2 rounded-lg transition-colors ${
                  selected === cat
                    ? 'bg-blue-50 text-blue-700 font-medium'
                    : 'text-gray-700 hover:bg-gray-50'
                }`}
              >
                {CATEGORY_META[cat]?.label ?? cat}
              </button>
            ))}
          </div>
        </CardBody>
      </Card>

      {/* Right — options for selected category */}
      <div className="flex-1">
        <Card>
          <CardHeader className="flex flex-col items-start gap-0.5 pb-2">
            <h3 className="font-semibold text-base">{CATEGORY_META[selected]?.label}</h3>
            <p className="text-xs text-gray-500">{CATEGORY_META[selected]?.description}</p>
            <p className="text-xs text-gray-400 mt-1">System options (gray) are always present. Custom options can be added and removed.</p>
          </CardHeader>
          <CardBody className="pt-0">
            <CategoryOptions category={selected} />
          </CardBody>
        </Card>
      </div>
    </div>
  );
}
