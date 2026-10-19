import { useMemo, useRef, useState } from 'react';
import { Avatar, Button, Tooltip, addToast } from '@heroui/react';
import { FiMessageSquare, FiSend, FiEdit2, FiTrash2, FiAtSign } from 'react-icons/fi';
import {
  useLeadComments, useAddLeadComment, useUpdateLeadComment, useDeleteLeadComment,
  useAssignableUsers,
} from '../hooks/useApi';
import { useAuthStore } from '../store/authStore';
import { errMsg } from '../utils/fmt';
import { MentionTextarea, type MentionTextareaHandle } from './MentionTextarea';

/**
 * Discussion thread on a lead.
 *
 * Deliberately NOT merged into the activity timeline: that log records what was DONE to a
 * lead (a call, a status change) and is read as evidence; this is people talking about it.
 * Merging the two was tried on this project and reversed.
 *
 * @mentions are plain text — the server resolves names against the live roster using the
 * same parser the Update Board and unit/project comments use. Typing "@" opens a search
 * list (MentionTextarea, shared with the unit/project comments) that narrows as you type;
 * it only makes the name easy to enter correctly and is not a separate mention format.
 */

function relativeTime(iso: string) {
  const mins = Math.round((Date.now() - new Date(iso).getTime()) / 60_000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.round(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.round(hrs / 24);
  if (days < 7) return `${days}d ago`;
  return new Date(iso).toLocaleDateString(undefined, { day: 'numeric', month: 'short' });
}

/** Highlight resolved-looking @names so a mention reads differently from ordinary text. */
function renderBody(content: string, names: string[]) {
  if (names.length === 0) return content;
  // Longest first so "@Sarah Chen" wins over "@Sarah".
  const sorted = [...names].sort((a, b) => b.length - a.length);
  const escaped = sorted.map((n) => n.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
  const re = new RegExp(`@(${escaped.join('|')})`, 'gi');
  const out: Array<string | JSX.Element> = [];
  let last = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(content)) !== null) {
    if (m.index > last) out.push(content.slice(last, m.index));
    out.push(
      <span key={`${m.index}-${m[0]}`} className="font-medium text-blue-700 bg-blue-50 rounded px-0.5">
        {m[0]}
      </span>,
    );
    last = m.index + m[0].length;
  }
  if (last < content.length) out.push(content.slice(last));
  return out;
}

export function LeadCommentThread({ leadId }: { leadId: string }) {
  const { user, hasPermission } = useAuthStore();
  const { data } = useLeadComments(leadId);
  const { data: users } = useAssignableUsers();
  const add = useAddLeadComment();
  const edit = useUpdateLeadComment();
  const del = useDeleteLeadComment();

  const [draft, setDraft] = useState('');
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editDraft, setEditDraft] = useState('');
  const boxRef = useRef<MentionTextareaHandle>(null);

  const comments: any[] = (data as any[]) || [];
  const canPost = hasPermission('lead:edit');
  const userList: any[] = (users as any[]) || [];
  // Only for highlighting @names in rendered comments; the picker takes the full users.
  const names = useMemo(() => userList.map((u: any) => u.name).filter(Boolean), [userList]);

  const post = async () => {
    if (!draft.trim()) return;
    try {
      await add.mutateAsync({ leadId, content: draft.trim() });
      setDraft('');
    } catch (e) {
      addToast({ title: errMsg(e, 'Could not post'), color: 'danger' });
    }
  };

  const saveEdit = async (id: string) => {
    if (!editDraft.trim()) return;
    try {
      await edit.mutateAsync({ commentId: id, content: editDraft.trim(), leadId });
      setEditingId(null);
    } catch (e) {
      addToast({ title: errMsg(e, 'Could not save'), color: 'danger' });
    }
  };

  const remove = async (id: string) => {
    if (!confirm('Delete this comment?')) return;
    try {
      await del.mutateAsync({ commentId: id, leadId });
    } catch (e) {
      addToast({ title: errMsg(e, 'Could not delete'), color: 'danger' });
    }
  };

  return (
    <div className="mb-4">
      <p className="text-sm font-semibold text-gray-700 mb-1.5 flex items-center gap-1.5">
        <FiMessageSquare className="w-3.5 h-3.5" aria-hidden="true" /> Discussion
        {comments.length > 0 && <span className="text-gray-500">({comments.length})</span>}
      </p>

      {comments.length === 0 && (
        <p className="text-xs text-gray-500 mb-2">
          Nothing discussed yet. Use @ to pull someone in.
        </p>
      )}

      <div className="space-y-2 mb-2">
        {comments.map((c: any) => {
          const mine = c.author?.id === user?.id;
          return (
            <div key={c.id} className="flex gap-2">
              <Avatar
                size="sm" name={c.author?.name} src={c.author?.avatarUrl}
                className="w-6 h-6 text-[11px] shrink-0"
              />
              <div className="flex-1 min-w-0 group">
                <div className="flex items-center gap-1.5 flex-wrap">
                  <span className="text-xs font-medium text-gray-900">{c.author?.name ?? 'Someone'}</span>
                  <span className="text-[11px] text-gray-500">{relativeTime(c.createdAt)}</span>
                  {c.editedAt && (
                    <Tooltip content={`Edited ${relativeTime(c.editedAt)}`}>
                      <span className="text-[11px] text-gray-500">(edited)</span>
                    </Tooltip>
                  )}
                  {mine && canPost && editingId !== c.id && (
                    <span className="ml-auto flex items-center gap-0.5 can-hover:opacity-0 group-hover:opacity-100 group-focus-within:opacity-100 transition-opacity">
                      <Button
                        isIconOnly size="sm" variant="light" aria-label="Edit comment"
                        className="h-6 w-6 min-w-0"
                        onPress={() => { setEditingId(c.id); setEditDraft(c.content); }}
                      >
                        <FiEdit2 className="w-3 h-3" />
                      </Button>
                      <Button
                        isIconOnly size="sm" variant="light" color="danger" aria-label="Delete comment"
                        className="h-6 w-6 min-w-0"
                        onPress={() => remove(c.id)}
                      >
                        <FiTrash2 className="w-3 h-3" />
                      </Button>
                    </span>
                  )}
                </div>

                {editingId === c.id ? (
                  <div className="mt-1">
                    <MentionTextarea
                      minRows={2} maxRows={8}
                      value={editDraft}
                      onChange={setEditDraft}
                      onSubmit={() => saveEdit(c.id)}
                      submitOn="mod-enter"
                      users={userList}
                      ariaLabel="Edit comment"
                    />
                    <div className="flex gap-1 mt-1">
                      <Button size="sm" color="primary" className="h-6 min-w-0 px-2 text-[11px]"
                        onPress={() => saveEdit(c.id)} isLoading={edit.isPending}>
                        Save
                      </Button>
                      <Button size="sm" variant="light" className="h-6 min-w-0 px-2 text-[11px]"
                        onPress={() => setEditingId(null)}>
                        Cancel
                      </Button>
                    </div>
                  </div>
                ) : (
                  <p className="text-xs text-gray-700 whitespace-pre-wrap break-words mt-0.5">
                    {renderBody(c.content, names)}
                  </p>
                )}
              </div>
            </div>
          );
        })}
      </div>

      {canPost && (
        <div>
          <MentionTextarea
            ref={boxRef}
            minRows={2} maxRows={8}
            placeholder="Add to the discussion… type @ to search for someone to notify"
            value={draft}
            onChange={setDraft}
            // Cmd/Ctrl+Enter posts. Plain Enter must stay a newline — people write
            // multi-line notes here and losing one mid-sentence is maddening.
            onSubmit={post}
            submitOn="mod-enter"
            users={userList}
            ariaLabel="New comment"
          />
          <div className="flex items-center gap-1 mt-1">
            <Button
              size="sm" variant="flat" className="h-7 min-w-0 px-2 text-[11px]"
              startContent={<FiAtSign className="w-3 h-3" />}
              onPress={() => boxRef.current?.startMention()}
            >
              Mention
            </Button>
            <Button
              size="sm" color="primary" className="h-7 min-w-0 px-2.5 text-[11px] ml-auto"
              startContent={<FiSend className="w-3 h-3" />}
              onPress={post} isLoading={add.isPending} isDisabled={!draft.trim()}
            >
              Post
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
