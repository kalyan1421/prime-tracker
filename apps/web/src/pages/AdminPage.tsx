import React, { useState } from 'react';
import {
  Card, CardBody, CardHeader, Tabs, Tab, Button, Select, SelectItem,
  Chip, Avatar, Spinner, Input, Switch, Textarea,
  Modal, ModalContent, ModalHeader, ModalBody, ModalFooter,
  useDisclosure, addToast,
} from '@heroui/react';
import { FiUsers, FiLink, FiFileText, FiRefreshCw, FiCheck, FiX, FiPlus, FiEdit2, FiTrash2, FiSearch, FiShield, FiGrid, FiMinus, FiEye } from 'react-icons/fi';
import {
  useUsers, useUpdateUserRole, useToggleUserActive, useCreateUser, useUpdateUser, useDeleteUser,
  useAuditLog, useQBStatus, useQBSync,
  useOrganizations, useOrganization, useCreateOrganization, useUpdateOrganization,
  useDeactivateOrganization, useAddOrgMember, useRemoveOrgMember,
  useRoleCounts, useRoleDefinitions,
} from '../hooks/useApi';
import { StatusBadge, LoadingState, ErrorState, fmtDate } from '../components/ui';
import { useAuthStore } from '../store/authStore';

export default function AdminPage() {
  return (
    <div>
      <h1 className="text-2xl font-bold mb-6">Administration</h1>

      <Tabs color="primary" size="sm">
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
        <Tab key="organizations" title={<div className="flex items-center gap-1"><FiGrid /><span>Organizations</span></div>}>
          <OrganizationsPanel />
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

function UsersPanel() {
  const { user: currentUser } = useAuthStore();
  const { data, isLoading, error } = useUsers();
  const updateRole = useUpdateUserRole();
  const toggleActive = useToggleUserActive();
  const createUser = useCreateUser();
  const updateUser = useUpdateUser();
  const availableRoles = currentUser?.role === 'SUPER_ADMIN' ? ROLES : ROLES.filter((r) => r !== 'SUPER_ADMIN');
  const deleteUser = useDeleteUser();

  const [search, setSearch] = useState('');
  const [roleFilter, setRoleFilter] = useState('');
  const [selectedUser, setSelectedUser] = useState<any>(null);
  const [editForm, setEditForm] = useState({ name: '', email: '' });
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [createForm, setCreateForm] = useState({ name: '', email: '', role: 'VIEWER' });

  const { isOpen: isCreateOpen, onOpen: onCreateOpen, onClose: onCreateClose } = useDisclosure();
  const { isOpen: isEditOpen, onOpen: onEditOpen, onClose: onEditClose } = useDisclosure();

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
    try {
      await createUser.mutateAsync(createForm);
      addToast({ title: 'User created', color: 'success' });
      onCreateClose();
      setCreateForm({ name: '', email: '', role: 'VIEWER' });
    } catch {
      addToast({ title: 'Failed to create user', color: 'danger' });
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
              <table className="w-full text-sm">
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
                        <Chip size="sm" variant="flat" color={ROLE_CHIP_COLOR[u.role] || 'default'}>
                          {u.role?.replace(/_/g, ' ')}
                        </Chip>
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
                              setEditForm({ name: u.name, email: u.email });
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
              </table>
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
                <div className="flex gap-2">
                  <Chip size="sm" variant="flat" color={ROLE_CHIP_COLOR[selectedUser.role] || 'default'}>
                    {selectedUser.role?.replace(/_/g, ' ')}
                  </Chip>
                  <Chip size="sm" variant="flat" color={selectedUser.isActive ? 'success' : 'danger'}>
                    {selectedUser.isActive ? 'Active' : 'Disabled'}
                  </Chip>
                </div>
              </div>

              {/* Role selector */}
              <div>
                <p className="text-xs font-semibold text-gray-500 uppercase mb-1">Role</p>
                <Select
                  size="sm"
                  selectedKeys={selectedUser.role ? [selectedUser.role] : []}
                  onSelectionChange={(keys) => {
                    const val = Array.from(keys)[0] as string;
                    if (val) handleRoleChange(selectedUser.id, val);
                  }}
                >
                  {availableRoles.map((r) => (
                    <SelectItem key={r}>{r.replace(/_/g, ' ')}</SelectItem>
                  ))}
                </Select>
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
              <div className="flex gap-2 pt-2 border-t border-gray-100">
                <Button
                  size="sm"
                  variant="bordered"
                  startContent={<FiEdit2 />}
                  className="flex-1"
                  onPress={() => {
                    setEditForm({ name: selectedUser.name, email: selectedUser.email });
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
            </CardBody>
          </Card>
        </div>
      )}

      {/* Create User Modal */}
      <Modal isOpen={isCreateOpen} onClose={onCreateClose}>
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
              <Select
                size="sm"
                label="Role"
                selectedKeys={createForm.role ? [createForm.role] : []}
                onSelectionChange={(keys) => {
                  const val = Array.from(keys)[0] as string;
                  if (val) setCreateForm((f) => ({ ...f, role: val }));
                }}
              >
                {availableRoles.map((r) => (
                  <SelectItem key={r}>{r.replace(/_/g, ' ')}</SelectItem>
                ))}
              </Select>
            </div>
          </ModalBody>
          <ModalFooter>
            <Button size="sm" variant="light" onPress={onCreateClose}>Cancel</Button>
            <Button
              size="sm"
              color="primary"
              onPress={handleCreateUser}
              isLoading={createUser.isPending}
            >
              Create User
            </Button>
          </ModalFooter>
        </ModalContent>
      </Modal>

      {/* Edit Modal */}
      <Modal isOpen={isEditOpen} onClose={onEditClose}>
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

      {/* Delete Confirm Modal */}
      <Modal isOpen={showDeleteConfirm} onClose={() => setShowDeleteConfirm(false)}>
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
            <Button size="sm" color="primary" as="a" href="/api/quickbooks/connect">
              Connect QuickBooks
            </Button>
          )}
        </CardHeader>
        <CardBody className="pt-0">
          {qb?.connected ? (
            <div className="grid grid-cols-3 gap-4">
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
function AuditPanel() {
  const [actionFilter, setActionFilter] = useState('');
  const { data, isLoading, error } = useAuditLog({
    action: actionFilter || undefined,
    limit: 100,
  });

  if (isLoading) return <LoadingState />;
  if (error) return <ErrorState />;

  const events = (data as any[]) || [];

  return (
    <div className="mt-4">
      <div className="flex justify-between mb-4">
        <p className="font-semibold text-sm text-gray-600">{events.length} events</p>
        <Select
          size="sm"
          className="w-[160px]"
          placeholder="All actions"
          selectedKeys={actionFilter ? [actionFilter] : []}
          onSelectionChange={(keys) => {
            const val = Array.from(keys)[0] as string;
            setActionFilter(val || '');
          }}
        >
          {['CREATE', 'UPDATE', 'DELETE', 'LOGIN', 'LOGOUT', 'MFA_VERIFY', 'QB_SYNC', 'ROLE_CHANGE'].map((a) => (
            <SelectItem key={a}>{a}</SelectItem>
          ))}
        </Select>
      </div>

      <Card shadow="sm">
        <CardBody className="p-0">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-gray-200">
                  <th className="text-left py-2 px-3 text-xs font-semibold text-gray-500 uppercase">Timestamp</th>
                  <th className="text-left py-2 px-3 text-xs font-semibold text-gray-500 uppercase">User</th>
                  <th className="text-left py-2 px-3 text-xs font-semibold text-gray-500 uppercase">Action</th>
                  <th className="text-left py-2 px-3 text-xs font-semibold text-gray-500 uppercase">Entity</th>
                  <th className="text-left py-2 px-3 text-xs font-semibold text-gray-500 uppercase">Entity ID</th>
                  <th className="text-left py-2 px-3 text-xs font-semibold text-gray-500 uppercase">IP</th>
                </tr>
              </thead>
              <tbody>
                {events.map((e: any) => (
                  <tr key={e.id} className="border-b border-gray-50">
                    <td className="py-2 px-3 text-xs text-gray-500 whitespace-nowrap">
                      {new Date(e.createdAt).toLocaleString()}
                    </td>
                    <td className="py-2 px-3">{e.user?.name || e.userId || '\u2014'}</td>
                    <td className="py-2 px-3"><StatusBadge status={e.action} /></td>
                    <td className="py-2 px-3">{e.entity || '\u2014'}</td>
                    <td className="py-2 px-3 font-mono text-xs text-gray-500">
                      {e.entityId ? e.entityId.substring(0, 8) + '\u2026' : '\u2014'}
                    </td>
                    <td className="py-2 px-3 text-xs text-gray-500">{e.ipAddress || '\u2014'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </CardBody>
      </Card>
    </div>
  );
}

// ---- Organizations Panel ----

const ENTITY_TYPES = ['LLC', 'LP', 'Corp'];

const ORG_ROLE_COLOR: Record<string, 'success' | 'primary'> = {
  LEAD: 'success',
  EMPLOYEE: 'primary',
};

function errMsg(err: any, fallback: string): string {
  return err?.response?.data?.message || fallback;
}

const EMPTY_ORG = { name: '', entityType: '', description: '' };

function OrganizationsPanel() {
  const { data: orgs, isLoading, error } = useOrganizations();
  const { data: users } = useUsers();
  const createOrg = useCreateOrganization();
  const updateOrg = useUpdateOrganization();
  const deactivateOrg = useDeactivateOrganization();
  const addMember = useAddOrgMember();
  const removeMember = useRemoveOrgMember();

  const [selectedOrgId, setSelectedOrgId] = useState<string | null>(null);
  const [orgForm, setOrgForm] = useState<Record<string, string>>(EMPTY_ORG);
  const [editingOrgId, setEditingOrgId] = useState<string | null>(null);
  const [memberForm, setMemberForm] = useState({ userId: '', orgRole: 'EMPLOYEE' });

  const { isOpen: isOrgModalOpen, onOpen: onOrgModalOpen, onClose: onOrgModalClose } = useDisclosure();
  const { isOpen: isMemberModalOpen, onOpen: onMemberModalOpen, onClose: onMemberModalClose } = useDisclosure();

  // Fetch selected org details (with members)
  const { data: selectedOrg } = useOrganization(selectedOrgId || '');

  if (isLoading) return <LoadingState />;
  if (error) return <ErrorState />;

  const orgList = (orgs as any[]) || [];
  const allUsers = (users as any[]) || [];

  // Filter users for "Add Member": exclude founders and already-members
  const existingMemberIds = (selectedOrg as any)?.memberships?.map((m: any) => m.user?.id) || [];
  const availableUsers = allUsers.filter(
    (u: any) => u.role !== 'FOUNDER' && !existingMemberIds.includes(u.id),
  );

  const handleOpenCreate = () => {
    setOrgForm(EMPTY_ORG);
    setEditingOrgId(null);
    onOrgModalOpen();
  };

  const handleOpenEdit = (org: any) => {
    setOrgForm({
      name: org.name || '',
      entityType: org.entityType || '',
      description: org.description || '',
    });
    setEditingOrgId(org.id);
    onOrgModalOpen();
  };

  const handleSaveOrg = async () => {
    try {
      if (editingOrgId) {
        await updateOrg.mutateAsync({ id: editingOrgId, ...orgForm });
        addToast({ title: 'Organization updated', color: 'success' });
      } else {
        await createOrg.mutateAsync(orgForm);
        addToast({ title: 'Organization created', color: 'success' });
      }
      onOrgModalClose();
    } catch (err: any) {
      addToast({ title: errMsg(err, 'Failed to save organization'), color: 'danger' });
    }
  };

  const handleDeactivateToggle = async (org: any) => {
    if (org.isActive) {
      // Deactivate
      try {
        await deactivateOrg.mutateAsync(org.id);
        addToast({ title: 'Organization deactivated', color: 'success' });
      } catch (err: any) {
        addToast({ title: errMsg(err, 'Failed to deactivate organization'), color: 'danger' });
      }
    } else {
      // Reactivate via update
      try {
        await updateOrg.mutateAsync({ id: org.id, isActive: true } as any);
        addToast({ title: 'Organization activated', color: 'success' });
      } catch (err: any) {
        addToast({ title: errMsg(err, 'Failed to activate organization'), color: 'danger' });
      }
    }
  };

  const handleAddMember = async () => {
    if (!selectedOrgId || !memberForm.userId) return;
    try {
      await addMember.mutateAsync({
        orgId: selectedOrgId,
        userId: memberForm.userId,
        orgRole: memberForm.orgRole,
      });
      addToast({ title: 'Member added', color: 'success' });
      setMemberForm({ userId: '', orgRole: 'EMPLOYEE' });
      onMemberModalClose();
    } catch (err: any) {
      addToast({ title: errMsg(err, 'Failed to add member'), color: 'danger' });
    }
  };

  const handleRemoveMember = async (userId: string) => {
    if (!selectedOrgId) return;
    if (!window.confirm('Remove this member from the organization?')) return;
    try {
      await removeMember.mutateAsync({ orgId: selectedOrgId, userId });
      addToast({ title: 'Member removed', color: 'success' });
    } catch (err: any) {
      addToast({ title: errMsg(err, 'Failed to remove member'), color: 'danger' });
    }
  };

  return (
    <div className="mt-4">
      {/* Header */}
      <div className="flex items-center justify-between mb-4">
        <p className="text-sm text-gray-500">{orgList.length} organization{orgList.length !== 1 ? 's' : ''}</p>
        <Button size="sm" color="primary" startContent={<FiPlus />} onPress={handleOpenCreate}>
          Add Organization
        </Button>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        {/* Left: Org list */}
        <div className="lg:col-span-1 flex flex-col gap-3">
          {orgList.map((org: any) => (
            <Card
              key={org.id}
              shadow="sm"
              isPressable
              onPress={() => setSelectedOrgId(org.id)}
              className={`transition-colors ${selectedOrgId === org.id ? 'border-2 border-primary-400' : ''}`}
            >
              <CardBody className="py-3 px-4">
                <div className="flex items-center justify-between mb-1">
                  <span className="font-semibold text-sm">{org.name}</span>
                  <div className="flex items-center gap-1">
                    {org.entityType && (
                      <Chip size="sm" variant="flat" color="secondary">{org.entityType}</Chip>
                    )}
                    <Chip size="sm" variant="flat" color={org.isActive ? 'success' : 'danger'}>
                      {org.isActive ? 'Active' : 'Inactive'}
                    </Chip>
                  </div>
                </div>
                <div className="flex items-center gap-4 text-xs text-gray-500">
                  <span>{org._count?.memberships ?? 0} members</span>
                  <span>{org._count?.projects ?? 0} projects</span>
                </div>
              </CardBody>
            </Card>
          ))}
          {orgList.length === 0 && (
            <p className="text-sm text-gray-400 text-center py-8">No organizations yet</p>
          )}
        </div>

        {/* Right: Org detail */}
        <div className="lg:col-span-2">
          {selectedOrg ? (
            <Card shadow="sm">
              <CardHeader className="flex justify-between items-center pb-2">
                <div className="flex items-center gap-3">
                  <h3 className="text-lg font-semibold">{(selectedOrg as any).name}</h3>
                  {(selectedOrg as any).entityType && (
                    <Chip size="sm" variant="flat" color="secondary">
                      {(selectedOrg as any).entityType}
                    </Chip>
                  )}
                </div>
                <div className="flex items-center gap-2">
                  <div className="flex items-center gap-1 text-xs text-gray-500">
                    <span>{(selectedOrg as any).isActive ? 'Active' : 'Inactive'}</span>
                    <Switch
                      size="sm"
                      isSelected={(selectedOrg as any).isActive}
                      onValueChange={() => handleDeactivateToggle(selectedOrg)}
                    />
                  </div>
                  <Button
                    size="sm"
                    variant="bordered"
                    startContent={<FiEdit2 />}
                    onPress={() => handleOpenEdit(selectedOrg)}
                  >
                    Edit
                  </Button>
                </div>
              </CardHeader>
              <CardBody className="pt-0">
                {(selectedOrg as any).description && (
                  <p className="text-sm text-gray-600 mb-4">{(selectedOrg as any).description}</p>
                )}

                {/* Members section — tree view: Founders → Leads → Employees */}
                <div className="flex items-center justify-between mb-3">
                  <p className="text-sm font-semibold text-gray-700">
                    Team ({(allUsers.filter((u: any) => u.role === 'FOUNDER').length) + ((selectedOrg as any).memberships?.length || 0)})
                  </p>
                  <Button size="sm" variant="flat" color="primary" startContent={<FiPlus />} onPress={onMemberModalOpen}>
                    Add Member
                  </Button>
                </div>

                {(() => {
                  const memberships = (selectedOrg as any).memberships || [];
                  const founders = allUsers.filter((u: any) => u.role === 'FOUNDER');
                  const leads = memberships.filter((m: any) => m.orgRole === 'LEAD');
                  const employees = memberships.filter((m: any) => m.orgRole === 'EMPLOYEE');

                  return (
                    <div className="flex flex-col gap-1">
                      {/* Founders tier */}
                      {founders.length > 0 && (
                        <div>
                          <p className="text-xs font-semibold text-purple-600 uppercase tracking-wider mb-1.5 px-1">Founders</p>
                          <div className="flex flex-col gap-1 mb-3">
                            {founders.map((u: any) => (
                              <div key={u.id} className="flex items-center justify-between py-2 px-3 rounded-lg bg-purple-50 border border-purple-100">
                                <div className="flex items-center gap-3">
                                  <Avatar size="sm" name={u.name} src={u.avatarUrl} className="w-8 h-8" />
                                  <div>
                                    <p className="text-sm font-medium">{u.name}</p>
                                    <p className="text-xs text-gray-500">{u.email}</p>
                                  </div>
                                </div>
                                <Chip size="sm" variant="flat" color="secondary">FOUNDER</Chip>
                              </div>
                            ))}
                          </div>
                        </div>
                      )}

                      {/* Leads tier */}
                      {leads.length > 0 && (
                        <div>
                          <div className="flex items-center gap-2 mb-1.5 px-1">
                            <div className="w-4 border-l-2 border-b-2 border-gray-300 h-3 ml-2" />
                            <p className="text-xs font-semibold text-green-600 uppercase tracking-wider">Leads</p>
                          </div>
                          <div className="flex flex-col gap-1 ml-4 mb-3">
                            {leads.map((m: any) => (
                              <div key={m.id} className="flex items-center justify-between py-2 px-3 rounded-lg bg-green-50 border border-green-100">
                                <div className="flex items-center gap-3">
                                  <Avatar size="sm" name={m.user?.name} src={m.user?.avatarUrl} className="w-8 h-8" />
                                  <div>
                                    <p className="text-sm font-medium">{m.user?.name}</p>
                                    <p className="text-xs text-gray-500">{m.user?.email}</p>
                                  </div>
                                </div>
                                <div className="flex items-center gap-2">
                                  <Chip size="sm" variant="flat" color="success">LEAD</Chip>
                                  <Button size="sm" isIconOnly variant="light" color="danger" onPress={() => handleRemoveMember(m.user?.id)}>
                                    <FiTrash2 />
                                  </Button>
                                </div>
                              </div>
                            ))}
                          </div>
                        </div>
                      )}

                      {/* Employees tier */}
                      {employees.length > 0 && (
                        <div>
                          <div className="flex items-center gap-2 mb-1.5 px-1">
                            <div className="w-4 border-l-2 border-b-2 border-gray-300 h-3 ml-6" />
                            <p className="text-xs font-semibold text-blue-600 uppercase tracking-wider">Members</p>
                          </div>
                          <div className="flex flex-col gap-1 ml-8">
                            {employees.map((m: any) => (
                              <div key={m.id} className="flex items-center justify-between py-2 px-3 rounded-lg bg-blue-50 border border-blue-100">
                                <div className="flex items-center gap-3">
                                  <Avatar size="sm" name={m.user?.name} src={m.user?.avatarUrl} className="w-8 h-8" />
                                  <div>
                                    <p className="text-sm font-medium">{m.user?.name}</p>
                                    <p className="text-xs text-gray-500">{m.user?.email}</p>
                                  </div>
                                </div>
                                <div className="flex items-center gap-2">
                                  <Chip size="sm" variant="flat" color="primary">MEMBER</Chip>
                                  <Button size="sm" isIconOnly variant="light" color="danger" onPress={() => handleRemoveMember(m.user?.id)}>
                                    <FiTrash2 />
                                  </Button>
                                </div>
                              </div>
                            ))}
                          </div>
                        </div>
                      )}

                      {founders.length === 0 && memberships.length === 0 && (
                        <p className="text-sm text-gray-400 text-center py-4">No members yet</p>
                      )}
                    </div>
                  );
                })()}
              </CardBody>
            </Card>
          ) : (
            <Card shadow="sm">
              <CardBody className="py-12 text-center text-sm text-gray-400">
                Select an organization to view details
              </CardBody>
            </Card>
          )}
        </div>
      </div>

      {/* Create/Edit Organization Modal */}
      <Modal isOpen={isOrgModalOpen} onClose={onOrgModalClose}>
        <ModalContent>
          <ModalHeader>{editingOrgId ? 'Edit Organization' : 'Create Organization'}</ModalHeader>
          <ModalBody>
            <div className="flex flex-col gap-4">
              <Input
                size="sm"
                label="Name"
                isRequired
                value={orgForm.name}
                onChange={(e) => setOrgForm((f) => ({ ...f, name: e.target.value }))}
              />
              <Select
                size="sm"
                label="Entity Type"
                selectedKeys={orgForm.entityType ? [orgForm.entityType] : []}
                onSelectionChange={(keys) => {
                  const val = Array.from(keys)[0] as string;
                  setOrgForm((f) => ({ ...f, entityType: val || '' }));
                }}
              >
                {ENTITY_TYPES.map((t) => (
                  <SelectItem key={t}>{t}</SelectItem>
                ))}
              </Select>
              <Textarea
                size="sm"
                label="Description"
                value={orgForm.description}
                onChange={(e) => setOrgForm((f) => ({ ...f, description: e.target.value }))}
              />
            </div>
          </ModalBody>
          <ModalFooter>
            <Button size="sm" variant="light" onPress={onOrgModalClose}>Cancel</Button>
            <Button
              size="sm"
              color="primary"
              onPress={handleSaveOrg}
              isLoading={createOrg.isPending || updateOrg.isPending}
            >
              {editingOrgId ? 'Save Changes' : 'Create Organization'}
            </Button>
          </ModalFooter>
        </ModalContent>
      </Modal>

      {/* Add Member Modal */}
      <Modal isOpen={isMemberModalOpen} onClose={onMemberModalClose}>
        <ModalContent>
          <ModalHeader>Add Member</ModalHeader>
          <ModalBody>
            <div className="flex flex-col gap-4">
              <Select
                size="sm"
                label="User"
                selectedKeys={memberForm.userId ? [memberForm.userId] : []}
                onSelectionChange={(keys) => {
                  const val = Array.from(keys)[0] as string;
                  setMemberForm((f) => ({ ...f, userId: val || '' }));
                }}
              >
                {availableUsers.map((u: any) => (
                  <SelectItem key={u.id}>{u.name} ({u.email})</SelectItem>
                ))}
              </Select>
              <Select
                size="sm"
                label="Organization Role"
                selectedKeys={[memberForm.orgRole]}
                onSelectionChange={(keys) => {
                  const val = Array.from(keys)[0] as string;
                  if (val) setMemberForm((f) => ({ ...f, orgRole: val }));
                }}
              >
                <SelectItem key="LEAD">Lead</SelectItem>
                <SelectItem key="EMPLOYEE">Employee</SelectItem>
              </Select>
            </div>
          </ModalBody>
          <ModalFooter>
            <Button size="sm" variant="light" onPress={onMemberModalClose}>Cancel</Button>
            <Button
              size="sm"
              color="primary"
              onPress={handleAddMember}
              isLoading={addMember.isPending}
              isDisabled={!memberForm.userId}
            >
              Add Member
            </Button>
          </ModalFooter>
        </ModalContent>
      </Modal>
    </div>
  );
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
                  <div className="grid grid-cols-3 gap-3">
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
              <table className="w-full text-xs">
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
              </table>
            </div>
          </CardBody>
        </Card>
      )}
    </div>
  );
}
