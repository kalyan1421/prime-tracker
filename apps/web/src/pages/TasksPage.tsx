import { useState, useRef } from 'react';
import {
    Button, Input, Select, SelectItem, Textarea, Modal, ModalContent,
    ModalHeader, ModalBody, ModalFooter, Chip, Avatar, Tooltip,
    useDisclosure, addToast,
} from '@heroui/react';
import {
    FiPlus, FiSearch, FiPaperclip,
    FiMessageSquare, FiCalendar, FiUser, FiChevronRight, FiX,
    FiDownload, FiSend, FiCheckSquare, FiAlertCircle, FiClock,
    FiEdit2, FiTrash2,
} from 'react-icons/fi';
import {
    useTasks, useTask, useCreateTask, useUpdateTask, useDeleteTask,
    useTaskComments, useCreateTaskComment, useDeleteTaskComment,
    useUploadTaskAttachment, useDeleteTaskAttachment,
    useProjects, useBuildings, useUnits, useUsers, useAssignableUsers, useCustomOptions,
} from '../hooks/useApi';
import { usePagination } from '../hooks/usePagination';
import { Pagination } from '../components/ui';
import { useAuthStore } from '../store/authStore';
import { apiAssetUrl } from '../lib/api';

function statusColor(status: string) {
    switch (status) {
        case 'TODO': return 'default';
        case 'IN_PROGRESS': return 'primary';
        case 'DONE': return 'success';
        case 'CANCELLED': return 'danger';
        default: return 'default';
    }
}

function priorityColor(priority: string) {
    switch (priority) {
        case 'LOW': return 'success';
        case 'MEDIUM': return 'warning';
        case 'HIGH': return 'danger';
        case 'URGENT': return 'danger';
        default: return 'default';
    }
}

function priorityIcon(priority: string) {
    if (priority === 'URGENT' || priority === 'HIGH') return <FiAlertCircle className="inline mr-1" />;
    if (priority === 'IN_PROGRESS') return <FiClock className="inline mr-1" />;
    return null;
}

function fmtDate(d?: string | null) {
    if (!d) return '—';
    return new Date(d).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

function isOverdue(dueDate?: string | null, status?: string) {
    if (!dueDate || status === 'DONE' || status === 'CANCELLED') return false;
    return new Date(dueDate) < new Date();
}

const PAGE_SIZE = 20;

export default function TasksPage({ projectId: propProjectId }: { projectId?: string }) {
    return <TasksPageInner projectId={propProjectId} />;
}

export function TasksPageInner({ projectId: propProjectId }: { projectId?: string }) {
    const { user } = useAuthStore();
    const { data: taskStatusOpts = [] } = useCustomOptions('task_status');
    const { data: taskPriorityOpts = [] } = useCustomOptions('task_priority');
    const [search, setSearch] = useState('');
    const [filterProject, setFilterProject] = useState(propProjectId ?? '');
    const [filterStatus, setFilterStatus] = useState('');
    const [filterPriority, setFilterPriority] = useState('');
    const [filterAssignee, setFilterAssignee] = useState('');
    const [selectedTaskId, setSelectedTaskId] = useState<string | null>(null);
    const { isOpen: isCreateOpen, onOpen: onCreateOpen, onClose: onCreateClose } = useDisclosure();

    const { data: tasks = [], isLoading: loadingTasks } = useTasks({
        projectId: filterProject || undefined,
        status: filterStatus || undefined,
        priority: filterPriority || undefined,
        assignedTo: filterAssignee || undefined,
    });
    const { data: projects = [] } = useProjects();
    const { data: allUsers = [] } = useAssignableUsers();

    const filteredTasks = search
        ? (tasks as any[]).filter((t: any) =>
            t.title.toLowerCase().includes(search.toLowerCase()) ||
            (t.description ?? '').toLowerCase().includes(search.toLowerCase())
        )
        : (tasks as any[]);

    const selectedTask = selectedTaskId
        ? (tasks as any[]).find((t: any) => t.id === selectedTaskId)
        : null;

    const { page, setPage, totalPages, paged: pagedTasks, total } = usePagination(
        filteredTasks, PAGE_SIZE, [search, filterProject, filterStatus, filterPriority, filterAssignee],
    );

    return (
        <div className="flex flex-col lg:flex-row gap-0 h-full min-h-[100dvh]" style={{ background: 'none' }}>
            {/* Main list */}
            <div className={`flex flex-col flex-1 min-w-0 transition-all ${selectedTaskId ? 'lg:pr-0' : ''}`}>
                {/* Header */}
                <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 mb-4 sm:mb-6">
                    <div>
                        <h1 className="text-xl sm:text-2xl font-bold text-gray-900">Tasks</h1>
                        <p className="text-sm text-gray-500 mt-0.5">
                            {filteredTasks.length} task{filteredTasks.length !== 1 ? 's' : ''}
                            {filterProject || filterStatus || filterPriority ? ' (filtered)' : ''}
                        </p>
                    </div>
                    <Button
                        color="primary"
                        startContent={<FiPlus />}
                        onPress={onCreateOpen}
                        id="new-task-btn"
                        className="self-start sm:self-auto"
                    >
                        New Task
                    </Button>
                </div>

                {/* Filter bar */}
                <div className="grid grid-cols-1 sm:grid-cols-2 xl:flex gap-3 mb-5">
                    <Input
                        placeholder="Search tasks…"
                        startContent={<FiSearch className="text-gray-400" />}
                        value={search}
                        onValueChange={setSearch}
                        className="w-full sm:w-56"
                        size="sm"
                        id="task-search"
                    />
                    {!propProjectId && (
                        <Select
                            placeholder="All Projects"
                            selectedKeys={filterProject ? [filterProject] : []}
                            onSelectionChange={(keys) => setFilterProject(Array.from(keys)[0] as string ?? '')}
                            className="w-full sm:w-44"
                            size="sm"
                            id="filter-project"
                        >
                            {(projects as any[]).map((p: any) => (
                                <SelectItem key={p.id}>{p.name}</SelectItem>
                            ))}
                        </Select>
                    )}
                    <Select
                        placeholder="Any Status"
                        selectedKeys={filterStatus ? [filterStatus] : []}
                        onSelectionChange={(keys) => setFilterStatus(Array.from(keys)[0] as string ?? '')}
                        className="w-full sm:w-40"
                        size="sm"
                        id="filter-status"
                    >
                        {taskStatusOpts.map((o) => (
                            <SelectItem key={o.value} textValue={o.label}>{o.label}</SelectItem>
                        ))}
                    </Select>
                    <Select
                        placeholder="Any Priority"
                        selectedKeys={filterPriority ? [filterPriority] : []}
                        onSelectionChange={(keys) => setFilterPriority(Array.from(keys)[0] as string ?? '')}
                        className="w-full sm:w-40"
                        size="sm"
                        id="filter-priority"
                    >
                        {taskPriorityOpts.map((o) => (
                            <SelectItem key={o.value} textValue={o.label}>{o.label}</SelectItem>
                        ))}
                    </Select>
                    <Select
                        placeholder="Any Assignee"
                        selectedKeys={filterAssignee ? [filterAssignee] : []}
                        onSelectionChange={(keys) => setFilterAssignee(Array.from(keys)[0] as string ?? '')}
                        className="w-full sm:w-44"
                        size="sm"
                        id="filter-assignee"
                    >
                        {(allUsers as any[]).map((u: any) => (
                            <SelectItem key={u.id}>{u.name}</SelectItem>
                        ))}
                    </Select>
                    {(filterProject || filterStatus || filterPriority || filterAssignee || search) && (
                        <Button
                            size="sm"
                            variant="flat"
                            startContent={<FiX />}
                            onPress={() => {
                                setSearch('');
                                if (!propProjectId) setFilterProject('');
                                setFilterStatus('');
                                setFilterPriority('');
                                setFilterAssignee('');
                            }}
                        >
                            Clear
                        </Button>
                    )}
                </div>

                {/* Task list */}
                {loadingTasks ? (
                    <div className="flex items-center justify-center py-20 text-gray-400">
                        <div className="w-8 h-8 border-2 border-blue-500 border-t-transparent rounded-full animate-spin mx-auto mb-3" />
                        <p className="text-sm">Loading tasks…</p>
                    </div>
                ) : filteredTasks.length === 0 ? (
                    <div className="flex flex-col items-center justify-center py-20 text-gray-400">
                        <FiCheckSquare className="text-5xl mb-3 opacity-30" />
                        <p className="font-medium">No tasks found</p>
                        <p className="text-sm mt-1">Create your first task to get started</p>
                        <Button color="primary" size="sm" className="mt-4" onPress={onCreateOpen} startContent={<FiPlus />}>
                            New Task
                        </Button>
                    </div>
                ) : (
                    <>
                        <div className="space-y-2">
                            {pagedTasks.map((task: any) => (
                                <TaskRow
                                    key={task.id}
                                    task={task}
                                    isSelected={selectedTaskId === task.id}
                                    onSelect={() => setSelectedTaskId(task.id === selectedTaskId ? null : task.id)}
                                />
                            ))}
                        </div>
                        <Pagination
                            page={page}
                            totalPages={totalPages}
                            total={total}
                            pageSize={PAGE_SIZE}
                            itemLabel="tasks"
                            onPrev={() => setPage((p) => p - 1)}
                            onNext={() => setPage((p) => p + 1)}
                        />
                    </>
                )}
            </div>

            {/* Side panel */}
            {selectedTaskId && (
                <div className="w-full lg:w-[440px] lg:shrink-0 lg:ml-6 bg-white border border-gray-200 rounded-xl shadow-lg overflow-hidden flex flex-col mt-4 lg:mt-0 lg:sticky lg:top-6 lg:max-h-[calc(100vh_-_120px)]">
                    <TaskSidePanel
                        taskId={selectedTaskId}
                        onClose={() => setSelectedTaskId(null)}
                        onDeleted={() => setSelectedTaskId(null)}
                        allUsers={allUsers as any[]}
                        projects={projects as any[]}
                    />
                </div>
            )}

            {/* Create Modal */}
            {isCreateOpen && (
                <CreateTaskModal
                    isOpen={isCreateOpen}
                    onClose={onCreateClose}
                    defaultProjectId={propProjectId}
                    projects={projects as any[]}
                    users={allUsers as any[]}
                    currentUserId={user?.id ?? ''}
                />
            )}
        </div>
    );
}

// ---- Task Row ----
function TaskRow({
    task,
    isSelected,
    onSelect,
}: {
    task: any;
    isSelected: boolean;
    onSelect: () => void;
}) {
    const overdue = isOverdue(task.dueDate, task.status);

    return (
        <div
            onClick={onSelect}
            className={`flex flex-col sm:flex-row sm:items-center gap-3 px-4 py-3 rounded-lg border cursor-pointer transition-all hover:shadow-sm ${isSelected
                ? 'border-blue-300 bg-blue-50/60 shadow-sm'
                : 'border-gray-200 bg-white hover:border-gray-300 hover:bg-gray-50/50'
                }`}
            id={`task-row-${task.id}`}
        >
            {/* Status chip */}
            <div className="shrink-0">
                <Chip size="sm" color={statusColor(task.status) as any} variant="flat" className="text-xs font-medium min-w-[80px] justify-center">
                    {task.status.replace('_', ' ')}
                </Chip>
            </div>

            {/* Title + meta */}
            <div className="flex-1 min-w-0">
                <p className={`text-sm font-medium truncate ${task.status === 'DONE' ? 'line-through text-gray-400' : 'text-gray-900'}`}>
                    {task.title}
                </p>
                <div className="flex items-center gap-2 sm:gap-3 mt-0.5 flex-wrap">
                    {task.project && (
                        <span className="text-xs text-gray-400 truncate max-w-[120px]">{task.project.name}</span>
                    )}
                    {task.building && (
                        <span className="text-xs text-gray-400 truncate">{task.building.name}</span>
                    )}
                    {task.unit && (
                        <span className="text-xs text-gray-400 truncate">Unit {task.unit.unitNumber}</span>
                    )}
                </div>
            </div>

            <div className="flex w-full sm:w-auto items-center gap-3 flex-wrap sm:flex-nowrap">
                <Chip size="sm" color={priorityColor(task.priority) as any} variant="dot" className="text-xs">
                    {task.priority}
                </Chip>
                <div className="flex items-center gap-1 text-xs">
                    <FiCalendar className={overdue ? 'text-red-500' : 'text-gray-400'} />
                    <span className={overdue ? 'text-red-600 font-medium' : 'text-gray-500'}>
                        {fmtDate(task.dueDate)}
                    </span>
                </div>
                {task.assignedUser ? (
                    <Tooltip content={task.assignedUser.name}>
                        <Avatar size="sm" name={task.assignedUser.name} src={task.assignedUser.avatarUrl} className="w-6 h-6 text-xs" />
                    </Tooltip>
                ) : (
                    <div className="w-6 h-6 rounded-full bg-gray-100 flex items-center justify-center">
                        <FiUser className="text-gray-400 text-xs" />
                    </div>
                )}
                <div className="flex items-center gap-2 text-xs text-gray-400">
                    {task._count?.comments > 0 && (
                        <span className="flex items-center gap-0.5"><FiMessageSquare />{task._count.comments}</span>
                    )}
                    {task._count?.attachments > 0 && (
                        <span className="flex items-center gap-0.5"><FiPaperclip />{task._count.attachments}</span>
                    )}
                </div>
            </div>

            <FiChevronRight className="hidden sm:block text-gray-300 shrink-0" />
        </div>
    );
}

// ---- Side Panel ----
function TaskSidePanel({
    taskId,
    onClose,
    onDeleted,
    allUsers,
    projects,
}: {
    taskId: string;
    onClose: () => void;
    onDeleted: () => void;
    allUsers: any[];
    projects: any[];
}) {
    const { user } = useAuthStore();
    const { data: panelStatusOpts = [] } = useCustomOptions('task_status');
    const { data: panelPriorityOpts = [] } = useCustomOptions('task_priority');
    const { data: task, isLoading: loadingTask } = useTask(taskId);

    const { data: comments = [], isLoading: loadingComments } = useTaskComments(taskId);
    const createComment = useCreateTaskComment();
    const deleteComment = useDeleteTaskComment();
    const updateTask = useUpdateTask();
    const deleteTask = useDeleteTask();
    const uploadAttachment = useUploadTaskAttachment();
    const deleteAttachment = useDeleteTaskAttachment();

    const [commentText, setCommentText] = useState('');
    const [isEditing, setIsEditing] = useState(false);
    const [editForm, setEditForm] = useState<any>({});
    const [confirmDelete, setConfirmDelete] = useState(false);
    const fileInputRef = useRef<HTMLInputElement>(null);

    if (loadingTask) {
        return (
            <div className="flex items-center justify-center h-40 text-gray-400 text-sm">
                Loading…
            </div>
        );
    }

    if (!task) {
        return (
            <div className="flex items-center justify-center h-40 text-gray-400 text-sm">
                Task not found.
            </div>
        );
    }

    const set = (field: string) => (e: any) =>
        setEditForm((f: any) => ({ ...f, [field]: e.target?.value ?? e }));

    function startEdit() {
        setEditForm({
            title: task.title,
            description: task.description ?? '',
            status: task.status,
            priority: task.priority,
            dueDate: task.dueDate ? task.dueDate.slice(0, 10) : '',
            assignedTo: task.assignedTo ?? '',
        });
        setIsEditing(true);
    }

    async function saveEdit() {
        try {
            await updateTask.mutateAsync({
                id: task.id,
                data: {
                    ...editForm,
                    dueDate: editForm.dueDate || null,
                    assignedTo: editForm.assignedTo || null,
                },
            });
            addToast({ title: 'Task updated', color: 'success' });
            setIsEditing(false);
        } catch {
            addToast({ title: 'Failed to update task', color: 'danger' });
        }
    }

    async function handleDelete() {
        try {
            await deleteTask.mutateAsync(task.id);
            addToast({ title: 'Task deleted', color: 'success' });
            onDeleted();
        } catch {
            addToast({ title: 'Failed to delete task', color: 'danger' });
        }
    }

    async function postComment() {
        if (!commentText.trim()) return;
        try {
            await createComment.mutateAsync({ taskId, content: commentText.trim() });
            setCommentText('');
        } catch {
            addToast({ title: 'Failed to post comment', color: 'danger' });
        }
    }

    async function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
        const file = e.target.files?.[0];
        if (!file) return;
        const fd = new FormData();
        fd.append('file', file);
        try {
            await uploadAttachment.mutateAsync({ taskId, formData: fd });
            addToast({ title: 'File attached', color: 'success' });
        } catch {
            addToast({ title: 'Upload failed', color: 'danger' });
        }
        e.target.value = '';
    }

    async function handleStatusChange(newStatus: string) {
        try {
            await updateTask.mutateAsync({ id: task.id, data: { status: newStatus } });
        } catch {
            addToast({ title: 'Failed to update status', color: 'danger' });
        }
    }

    const overdue = isOverdue(task.dueDate, task.status);
    const canEdit = task.createdBy === user?.id || ['SUPER_ADMIN', 'FOUNDER', 'EXECUTIVE', 'PROJECT_MANAGER'].includes(user?.role ?? '');

    return (
        <div className="flex flex-col h-full">
            {/* Panel header */}
            <div className="flex items-start justify-between px-5 py-4 border-b border-gray-100">
                <div className="flex-1 min-w-0 pr-4">
                    {isEditing ? (
                        <Input
                            value={editForm.title}
                            onChange={set('title')}
                            className="font-semibold"
                            size="sm"
                            id="edit-task-title"
                        />
                    ) : (
                        <p className={`font-semibold text-gray-900 text-base leading-tight ${task.status === 'DONE' ? 'line-through text-gray-400' : ''}`}>
                            {task.title}
                        </p>
                    )}
                    <div className="flex items-center gap-2 mt-2 flex-wrap">
                        {/* Quick status change */}
                        {panelStatusOpts.map((o) => (
                            <button
                                key={o.value}
                                onClick={() => handleStatusChange(o.value)}
                                className={`text-xs px-2 py-0.5 rounded-full border transition-colors ${task.status === o.value
                                    ? 'bg-blue-600 text-white border-blue-600'
                                    : 'border-gray-200 text-gray-500 hover:border-gray-400'
                                    }`}
                            >
                                {o.label}
                            </button>
                        ))}
                    </div>
                </div>
                <div className="flex items-center gap-1 shrink-0">
                    {canEdit && !isEditing && (
                        <Tooltip content="Edit task">
                            <Button isIconOnly size="sm" variant="light" onPress={startEdit} id="edit-task-btn">
                                <FiEdit2 className="text-gray-500" />
                            </Button>
                        </Tooltip>
                    )}
                    {canEdit && !isEditing && (
                        <Tooltip content="Delete task" color="danger">
                            <Button isIconOnly size="sm" variant="light" color="danger" onPress={() => setConfirmDelete(true)} id="delete-task-btn">
                                <FiTrash2 />
                            </Button>
                        </Tooltip>
                    )}
                    <Button isIconOnly size="sm" variant="light" onPress={onClose}>
                        <FiX className="text-gray-400" />
                    </Button>
                </div>
            </div>

            {/* Panel body — scrollable */}
            <div className="flex-1 overflow-y-auto px-5 py-4 space-y-5">
                {/* Fields */}
                {isEditing ? (
                    <div className="space-y-3">
                        <Textarea
                            label="Description"
                            value={editForm.description}
                            onChange={set('description')}
                            minRows={2}
                            id="edit-task-desc"
                        />
                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                            <Select
                                label="Status"
                                selectedKeys={editForm.status ? [editForm.status] : []}
                                onSelectionChange={(keys) => setEditForm((f: any) => ({ ...f, status: Array.from(keys)[0] as string }))}
                                size="sm"
                                id="edit-task-status"
                            >
                                {panelStatusOpts.map((o) => <SelectItem key={o.value} textValue={o.label}>{o.label}</SelectItem>)}
                            </Select>
                            <Select
                                label="Priority"
                                selectedKeys={editForm.priority ? [editForm.priority] : []}
                                onSelectionChange={(keys) => setEditForm((f: any) => ({ ...f, priority: Array.from(keys)[0] as string }))}
                                size="sm"
                                id="edit-task-priority"
                            >
                                {panelPriorityOpts.map((o) => <SelectItem key={o.value} textValue={o.label}>{o.label}</SelectItem>)}
                            </Select>
                        </div>
                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                            <Input
                                type="date"
                                label="Due Date"
                                value={editForm.dueDate}
                                onChange={set('dueDate')}
                                size="sm"
                                id="edit-task-due"
                            />
                            <Select
                                label="Assigned To"
                                selectedKeys={editForm.assignedTo ? [editForm.assignedTo] : []}
                                onSelectionChange={(keys) => setEditForm((f: any) => ({ ...f, assignedTo: Array.from(keys)[0] as string ?? '' }))}
                                size="sm"
                                id="edit-task-assignee"
                            >
                                {allUsers.map((u: any) => <SelectItem key={u.id}>{u.name}</SelectItem>)}
                            </Select>
                        </div>
                        <div className="flex gap-2 pt-1">
                            <Button size="sm" color="primary" onPress={saveEdit} isLoading={updateTask.isPending} id="save-task-btn">Save</Button>
                            <Button size="sm" variant="flat" onPress={() => setIsEditing(false)}>Cancel</Button>
                        </div>
                    </div>
                ) : (
                    <div className="space-y-3">
                        {task.description && (
                            <p className="text-sm text-gray-600 whitespace-pre-wrap">{task.description}</p>
                        )}
                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-sm">
                            <div className="flex flex-col gap-0.5">
                                <span className="text-xs text-gray-400 uppercase tracking-wide">Priority</span>
                                <Chip size="sm" color={priorityColor(task.priority) as any} variant="flat">
                                    {priorityIcon(task.priority)}{task.priority}
                                </Chip>
                            </div>
                            <div className="flex flex-col gap-0.5">
                                <span className="text-xs text-gray-400 uppercase tracking-wide">Due Date</span>
                                <span className={`text-sm font-medium flex items-center gap-1 ${overdue ? 'text-red-600' : 'text-gray-700'}`}>
                                    <FiCalendar />
                                    {fmtDate(task.dueDate)}
                                    {overdue && <span className="text-xs text-red-500 ml-1">Overdue</span>}
                                </span>
                            </div>
                            <div className="flex flex-col gap-0.5">
                                <span className="text-xs text-gray-400 uppercase tracking-wide">Assigned To</span>
                                {task.assignedUser ? (
                                    <div className="flex items-center gap-1.5">
                                        <Avatar size="sm" name={task.assignedUser.name} src={task.assignedUser.avatarUrl} className="w-5 h-5 text-xs" />
                                        <span className="text-sm text-gray-700">{task.assignedUser.name}</span>
                                    </div>
                                ) : (
                                    <span className="text-sm text-gray-400">Unassigned</span>
                                )}
                            </div>
                            <div className="flex flex-col gap-0.5">
                                <span className="text-xs text-gray-400 uppercase tracking-wide">Created By</span>
                                <span className="text-sm text-gray-700">{task.createdByUser?.name}</span>
                            </div>
                            {task.project && (
                                <div className="flex flex-col gap-0.5">
                                    <span className="text-xs text-gray-400 uppercase tracking-wide">Project</span>
                                    <span className="text-sm text-gray-700">{task.project.name}</span>
                                </div>
                            )}
                            {task.building && (
                                <div className="flex flex-col gap-0.5">
                                    <span className="text-xs text-gray-400 uppercase tracking-wide">Building</span>
                                    <span className="text-sm text-gray-700">{task.building.name}</span>
                                </div>
                            )}
                            {task.unit && (
                                <div className="flex flex-col gap-0.5">
                                    <span className="text-xs text-gray-400 uppercase tracking-wide">Unit</span>
                                    <span className="text-sm text-gray-700">Unit {task.unit.unitNumber}</span>
                                </div>
                            )}
                        </div>
                    </div>
                )}

                {/* Attachments */}
                <div>
                    <div className="flex items-center justify-between mb-2">
                        <span className="text-xs font-semibold text-gray-500 uppercase tracking-wide">
                            Attachments {task.attachments?.length > 0 && `(${task.attachments.length})`}
                        </span>
                        <button
                            onClick={() => fileInputRef.current?.click()}
                            className="text-xs text-blue-600 hover:underline flex items-center gap-1"
                            id="attach-file-btn"
                        >
                            <FiPaperclip /> Attach file
                        </button>
                        <input
                            ref={fileInputRef}
                            type="file"
                            className="hidden"
                            onChange={handleFileChange}
                            id="task-file-input"
                        />
                    </div>
                    {task.attachments?.length > 0 ? (
                        <div className="space-y-1.5">
                            {task.attachments.map((att: any) => (
                                <div key={att.id} className="flex items-center gap-2 px-3 py-2 bg-gray-50 rounded-lg border border-gray-100 group">
                                    <FiPaperclip className="text-gray-400 shrink-0" />
                                    <span className="text-sm text-gray-700 flex-1 truncate">{att.fileName}</span>
                                    {att.fileSize && (
                                        <span className="text-xs text-gray-400">{(att.fileSize / 1024).toFixed(0)} KB</span>
                                    )}
                                    <a
                                        href={apiAssetUrl(att.fileUrl)}
                                        target="_blank"
                                        rel="noreferrer"
                                        className="text-blue-500 hover:text-blue-700"
                                    >
                                        <FiDownload />
                                    </a>
                                    {(att.uploadedById === user?.id || ['SUPER_ADMIN', 'FOUNDER', 'EXECUTIVE', 'PROJECT_MANAGER'].includes(user?.role ?? '')) && (
                                        <button
                                            onClick={() => deleteAttachment.mutate({ taskId, attachmentId: att.id })}
                                            className="text-red-400 hover:text-red-600 opacity-0 group-hover:opacity-100 transition-opacity"
                                        >
                                            <FiX />
                                        </button>
                                    )}
                                </div>
                            ))}
                        </div>
                    ) : (
                        <p className="text-xs text-gray-400 py-2">No attachments yet</p>
                    )}
                </div>

                <hr className="border-gray-100" />

                {/* Comments */}
                <div>
                    <span className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-3 block">
                        Comments {(comments as any[]).length > 0 && `(${(comments as any[]).length})`}
                    </span>
                    {loadingComments ? (
                        <p className="text-xs text-gray-400">Loading…</p>
                    ) : (comments as any[]).length === 0 ? (
                        <p className="text-xs text-gray-400 py-1">No comments yet. Be the first!</p>
                    ) : (
                        <div className="space-y-3">
                            {(comments as any[]).map((c: any) => (
                                <div key={c.id} className="flex gap-2.5 group">
                                    <Avatar size="sm" name={c.user?.name} src={c.user?.avatarUrl} className="w-7 h-7 text-xs shrink-0 mt-0.5" />
                                    <div className="flex-1 min-w-0">
                                        <div className="flex items-center gap-2">
                                            <span className="text-xs font-semibold text-gray-700">{c.user?.name}</span>
                                            <span className="text-xs text-gray-400">
                                                {new Date(c.createdAt).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}
                                            </span>
                                            {(c.userId === user?.id || ['SUPER_ADMIN', 'FOUNDER'].includes(user?.role ?? '')) && (
                                                <button
                                                    onClick={() => deleteComment.mutate({ taskId, commentId: c.id })}
                                                    className="text-red-400 hover:text-red-600 opacity-0 group-hover:opacity-100 transition-opacity ml-auto"
                                                >
                                                    <FiX className="text-xs" />
                                                </button>
                                            )}
                                        </div>
                                        <p className="text-sm text-gray-600 mt-0.5 whitespace-pre-wrap">{c.content}</p>
                                    </div>
                                </div>
                            ))}
                        </div>
                    )}
                </div>
            </div>

            {/* Comment input — sticky bottom */}
            <div className="border-t border-gray-100 px-4 py-3 bg-white">
                <div className="flex gap-2">
                    <Avatar size="sm" name={user?.name} src={user?.avatarUrl} className="w-7 h-7 text-xs shrink-0 mt-1" />
                    <div className="flex-1 flex gap-2">
                        <Textarea
                            placeholder="Write a comment…"
                            value={commentText}
                            onValueChange={setCommentText}
                            minRows={1}
                            maxRows={4}
                            size="sm"
                            className="flex-1"
                            id="task-comment-input"
                            onKeyDown={(e) => {
                                if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) postComment();
                            }}
                        />
                        <Button
                            isIconOnly
                            color="primary"
                            size="sm"
                            onPress={postComment}
                            isLoading={createComment.isPending}
                            isDisabled={!commentText.trim()}
                            id="post-comment-btn"
                        >
                            <FiSend />
                        </Button>
                    </div>
                </div>
            </div>

            {/* Confirm delete modal */}
            <Modal isOpen={confirmDelete} onClose={() => setConfirmDelete(false)} size="sm">
                <ModalContent>
                    <ModalHeader>Delete Task</ModalHeader>
                    <ModalBody>
                        <p className="text-sm text-gray-600">
                            Are you sure you want to delete "<strong>{task.title}</strong>"? This cannot be undone.
                        </p>
                    </ModalBody>
                    <ModalFooter>
                        <Button variant="flat" onPress={() => setConfirmDelete(false)}>Cancel</Button>
                        <Button color="danger" onPress={handleDelete} isLoading={deleteTask.isPending} id="confirm-delete-task-btn">
                            Delete
                        </Button>
                    </ModalFooter>
                </ModalContent>
            </Modal>
        </div>
    );
}

// ---- Create Task Modal ----
function CreateTaskModal({
    isOpen,
    onClose,
    defaultProjectId,
    projects,
    users,
    currentUserId,
}: {
    isOpen: boolean;
    onClose: () => void;
    defaultProjectId?: string;
    projects: any[];
    users: any[];
    currentUserId: string;
}) {
    const createTask = useCreateTask();
    const { data: taskStatusOpts = [] } = useCustomOptions('task_status');
    const { data: taskPriorityOpts = [] } = useCustomOptions('task_priority');
    const [form, setForm] = useState({
        title: '',
        description: '',
        projectId: defaultProjectId ?? '',
        buildingId: '',
        unitId: '',
        status: 'TODO',
        priority: 'MEDIUM',
        dueDate: '',
        assignedTo: currentUserId,
    });

    const { data: buildings = [] } = useBuildings(form.projectId);
    const { data: units = [] } = useUnits(form.projectId);

    const set = (field: string) => (e: any) =>
        setForm((f) => ({ ...f, [field]: e.target?.value ?? e }));

    const filteredUnits = form.buildingId
        ? (units as any[]).filter((u: any) => u.buildingId === form.buildingId)
        : (units as any[]);

    async function handleCreate() {
        if (!form.title.trim()) {
            addToast({ title: 'Title is required', color: 'danger' });
            return;
        }
        if (!form.projectId) {
            addToast({ title: 'Project is required', color: 'danger' });
            return;
        }
        try {
            await createTask.mutateAsync({
                ...form,
                buildingId: form.buildingId || undefined,
                unitId: form.unitId || undefined,
                dueDate: form.dueDate || undefined,
                assignedTo: form.assignedTo || undefined,
            });
            addToast({ title: 'Task created!', color: 'success' });
            onClose();
            setForm({
                title: '',
                description: '',
                projectId: defaultProjectId ?? '',
                buildingId: '',
                unitId: '',
                status: 'TODO',
                priority: 'MEDIUM',
                dueDate: '',
                assignedTo: currentUserId,
            });
        } catch {
            addToast({ title: 'Failed to create task', color: 'danger' });
        }
    }

    return (
        <Modal isOpen={isOpen} onClose={onClose} size="lg" scrollBehavior="inside">
            <ModalContent>
                <ModalHeader>
                    <div className="flex items-center gap-2">
                        <FiCheckSquare className="text-blue-500" />
                        New Task
                    </div>
                </ModalHeader>
                <ModalBody className="space-y-4 pb-2">
                    <Input
                        label="Title"
                        placeholder="What needs to be done?"
                        value={form.title}
                        onChange={set('title')}
                        isRequired
                        id="new-task-title"
                    />
                    <Textarea
                        label="Description / Notes"
                        placeholder="Add details, context or notes…"
                        value={form.description}
                        onChange={set('description')}
                        minRows={2}
                        id="new-task-desc"
                    />
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                        <Select
                            label="Project"
                            isRequired
                            selectedKeys={form.projectId ? [form.projectId] : []}
                            onSelectionChange={(keys) => {
                                const v = Array.from(keys)[0] as string ?? '';
                                setForm((f) => ({ ...f, projectId: v, buildingId: '', unitId: '' }));
                            }}
                            id="new-task-project"
                        >
                            {projects.map((p: any) => <SelectItem key={p.id}>{p.name}</SelectItem>)}
                        </Select>
                        <Select
                            label="Building (optional)"
                            selectedKeys={form.buildingId ? [form.buildingId] : []}
                            onSelectionChange={(keys) => {
                                const v = Array.from(keys)[0] as string ?? '';
                                setForm((f) => ({ ...f, buildingId: v, unitId: '' }));
                            }}
                            isDisabled={!form.projectId}
                            id="new-task-building"
                        >
                            {(buildings as any[]).map((b: any) => <SelectItem key={b.id}>{b.name}</SelectItem>)}
                        </Select>
                    </div>
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                        <Select
                            label="Unit (optional)"
                            selectedKeys={form.unitId ? [form.unitId] : []}
                            onSelectionChange={(keys) => setForm((f) => ({ ...f, unitId: Array.from(keys)[0] as string ?? '' }))}
                            isDisabled={!form.projectId}
                            id="new-task-unit"
                        >
                            {filteredUnits.map((u: any) => (
                                <SelectItem key={u.id}>Unit {u.unitNumber}</SelectItem>
                            ))}
                        </Select>
                        <Select
                            label="Assign To"
                            selectedKeys={form.assignedTo ? [form.assignedTo] : []}
                            onSelectionChange={(keys) => setForm((f) => ({ ...f, assignedTo: Array.from(keys)[0] as string ?? '' }))}
                            id="new-task-assignee"
                        >
                            {users.map((u: any) => <SelectItem key={u.id}>{u.name}</SelectItem>)}
                        </Select>
                    </div>
                    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
                        <Select
                            label="Priority"
                            selectedKeys={[form.priority]}
                            onSelectionChange={(keys) => setForm((f) => ({ ...f, priority: Array.from(keys)[0] as string ?? 'MEDIUM' }))}
                            id="new-task-priority"
                        >
                            {taskPriorityOpts.map((o) => <SelectItem key={o.value} textValue={o.label}>{o.label}</SelectItem>)}
                        </Select>
                        <Select
                            label="Status"
                            selectedKeys={[form.status]}
                            onSelectionChange={(keys) => setForm((f) => ({ ...f, status: Array.from(keys)[0] as string ?? 'TODO' }))}
                            id="new-task-status"
                        >
                            {taskStatusOpts.map((o) => <SelectItem key={o.value} textValue={o.label}>{o.label}</SelectItem>)}
                        </Select>
                        <Input
                            type="date"
                            label="Due Date"
                            value={form.dueDate}
                            onChange={set('dueDate')}
                            id="new-task-due"
                        />
                    </div>
                </ModalBody>
                <ModalFooter>
                    <Button variant="flat" onPress={onClose}>Cancel</Button>
                    <Button color="primary" onPress={handleCreate} isLoading={createTask.isPending} id="create-task-submit-btn">
                        Create Task
                    </Button>
                </ModalFooter>
            </ModalContent>
        </Modal>
    );
}
