/**
 * One place to look for "what has happened on this unit".
 *
 * The unit page used to carry two separate sections — Site Updates and Comments — and a
 * person checking on a unit had to read both and merge them in their head. This is that
 * merge, done once.
 *
 * IT DOES NOT MERGE THE UNDERLYING RECORDS, deliberately. Reading what is actually in them
 * settles it: the comments say "Signage approved by the city", "Coastal Ventures under
 * contract", "buildout contract signed" and are tagged Marketing / Sales / Financial; the
 * site updates say "cabinets delivered, plumber tomorrow" and carry photos, a channel and a
 * checklist stage. Those are two audiences with two vocabularies that happen to hang off the
 * same unit. Folding them into one table would put marketing chatter in the construction
 * feed and lose the type taxonomy the dashboard groups by. What was worth fixing was having
 * to look in two places, and that is a reading problem, not a storage one.
 */
import { useMemo, useState } from 'react';
import { Button, Chip, Avatar, Textarea, Select, SelectItem, addToast } from '@heroui/react';
import { FiClipboard, FiMessageSquare, FiCamera, FiCornerDownRight, FiCheckSquare, FiSmartphone } from 'react-icons/fi';
import {
  useDailyLogs, useUnitComments, useCreateComment, useCustomOptions,
} from '../hooks/useApi';
import { DailyLogFeed } from './DailyLogFeed';
import { PermissionGate, LoadingState } from './ui';
import { fmtDate, errMsg } from '../utils/fmt';

type Item =
  | { kind: 'update'; at: string; id: string; log: any }
  | { kind: 'comment'; at: string; id: string; comment: any };

const COMMENT_COLOR: Record<string, 'secondary' | 'primary' | 'success'> = {
  MARKETING: 'secondary', SALES: 'primary', FINANCIAL: 'success',
};

export function UnitActivity({ unitId, projectId }: { unitId: string; projectId: string }) {
  const [composing, setComposing] = useState<'update' | 'comment'>('update');

  const logsQ = useDailyLogs(projectId, undefined, unitId);
  const commentsQ = useUnitComments(unitId);

  const items = useMemo<Item[]>(() => {
    const logs: any[] = Array.isArray(logsQ.data) ? logsQ.data : [];
    const comments: any[] = Array.isArray(commentsQ.data) ? commentsQ.data : [];
    const merged: Item[] = [
      // logDate is the day being reported, which is the date a reader cares about; createdAt
      // is only when it was typed up.
      ...logs.map((l) => ({ kind: 'update' as const, at: l.logDate ?? l.createdAt, id: l.id, log: l })),
      ...comments.map((c) => ({ kind: 'comment' as const, at: c.createdAt, id: c.id, comment: c })),
    ];
    return merged.sort((a, b) => new Date(b.at).getTime() - new Date(a.at).getTime());
  }, [logsQ.data, commentsQ.data]);

  const loading = logsQ.isLoading || commentsQ.isLoading;

  return (
    <div className="space-y-4">
      <PermissionGate permission="dailylog:view">
        <div className="rounded-lg border border-gray-100 bg-gray-50/50 p-3">
          <div className="mb-2 flex gap-1">
            {(['update', 'comment'] as const).map((k) => (
              <button
                key={k} type="button" onClick={() => setComposing(k)}
                className={`flex items-center gap-1.5 rounded-md px-2.5 py-1 text-xs font-medium transition-colors ${
                  composing === k ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-600 hover:text-gray-900'
                }`}
              >
                {k === 'update' ? <FiClipboard size={12} /> : <FiMessageSquare size={12} />}
                {k === 'update' ? 'Site update' : 'Comment'}
              </button>
            ))}
          </div>
          {composing === 'update' ? (
            /* The full site-update composer — photos, stage pin, date. `showList` off
               because the merged timeline below is already showing the posts. */
            <DailyLogFeed projectId={projectId} unitId={unitId} showList={false} bare />
          ) : (
            <CommentComposer unitId={unitId} />
          )}
        </div>
      </PermissionGate>

      {loading ? <LoadingState message="Loading activity…" /> : items.length === 0 ? (
        <p className="text-sm text-gray-500">Nothing recorded on this unit yet.</p>
      ) : (
        <ol className="space-y-3">
          {items.map((it) => (
            <li key={`${it.kind}-${it.id}`}>
              {it.kind === 'update'
                ? <UpdateRow log={it.log} />
                : <CommentRow comment={it.comment} />}
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}

function CommentComposer({ unitId }: { unitId: string }) {
  const create = useCreateComment();
  const { data: typeOpts } = useCustomOptions('comment_type');
  const types: any[] = Array.isArray(typeOpts) && typeOpts.length
    ? typeOpts
    : [{ value: 'MARKETING', label: 'Marketing' }, { value: 'SALES', label: 'Sales' }, { value: 'FINANCIAL', label: 'Financial' }];
  const [text, setText] = useState('');
  const [commentType, setCommentType] = useState('MARKETING');

  return (
    <div className="space-y-2">
      <Textarea
        size="sm" minRows={2} value={text} onValueChange={setText}
        label="A note for the team" placeholder="Signage approved by the city…"
      />
      <div className="flex gap-2">
        <Select
          size="sm" className="max-w-[160px]" aria-label="Comment type"
          selectedKeys={new Set([commentType])}
          onSelectionChange={(k) => setCommentType((Array.from(k)[0] as string) ?? 'MARKETING')}
        >
          {types.map((t) => (
            <SelectItem key={t.value} textValue={t.label}>{t.label}</SelectItem>
          ))}
        </Select>
        <Button
          size="sm" color="primary" className="flex-1" isLoading={create.isPending}
          isDisabled={!text.trim()}
          onPress={async () => {
            try {
              await create.mutateAsync({ unitId, content: text.trim(), commentType });
              setText('');
            } catch (e) {
              addToast({ title: errMsg(e, 'Could not add the comment'), color: 'danger' });
            }
          }}
        >
          Post comment
        </Button>
      </div>
    </div>
  );
}

function UpdateRow({ log }: { log: any }) {
  const photos: any[] = log.photos ?? [];
  const replies: any[] = log.replies ?? [];
  return (
    <div className="rounded-lg border border-gray-100 p-3">
      <div className="flex items-center gap-2">
        <Avatar size="sm" name={log.author?.name} src={log.author?.avatarUrl} className="h-6 w-6 text-[11px]" />
        <span className="text-sm font-medium text-gray-900">{log.author?.name}</span>
        <span className="text-xs text-gray-500">{fmtDate(log.logDate)}</span>
        <Chip size="sm" variant="flat" color="primary" className="text-[11px]" startContent={<FiClipboard className="text-xs" />}>
          Site update
        </Chip>
        {log.source === 'MOBILE' && (
          <Chip size="sm" variant="flat" className="text-[11px]" startContent={<FiSmartphone className="text-xs" />}>
            From site
          </Chip>
        )}
      </div>
      <p className="mt-2 whitespace-pre-wrap text-sm text-gray-700">{log.notes}</p>
      <div className="mt-2 flex flex-wrap items-center gap-1.5">
        {log.stage?.label && (
          <Chip size="sm" variant="flat" color="warning" className="text-[11px]" startContent={<FiCheckSquare className="text-xs" />}>
            {log.stage.label}
          </Chip>
        )}
        {photos.length > 0 && (
          <Chip size="sm" variant="flat" className="text-[11px]" startContent={<FiCamera className="text-xs" />}>
            {photos.length} photo{photos.length === 1 ? '' : 's'}
          </Chip>
        )}
      </div>
      {photos.length > 0 && (
        <div className="mt-2 flex flex-wrap gap-2">
          {photos.map((p) => (
            <img
              key={p.id} src={p.url} alt={p.caption || ''}
              className="h-16 w-16 rounded border border-gray-200 object-cover"
              onError={(e) => { (e.target as HTMLImageElement).style.opacity = '0.3'; }}
            />
          ))}
        </div>
      )}
      {replies.length > 0 && (
        <div className="mt-2 space-y-1.5 border-l-2 border-gray-100 pl-3">
          {replies.map((r) => (
            <div key={r.id} className="text-xs text-gray-600">
              <FiCornerDownRight className="mr-1 inline text-gray-400" />
              <span className="font-medium text-gray-700">{r.author?.name}</span> {r.notes}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function CommentRow({ comment: c }: { comment: any }) {
  return (
    <div className="rounded-lg border border-gray-100 p-3">
      <div className="flex items-center gap-2">
        <Avatar size="sm" name={c.user?.name ?? c.author?.name} className="h-6 w-6 text-[11px]" />
        <span className="text-sm font-medium text-gray-900">{c.user?.name ?? c.author?.name}</span>
        <span className="text-xs text-gray-500">{fmtDate(c.createdAt)}</span>
        <Chip size="sm" variant="flat" color={COMMENT_COLOR[c.commentType] ?? 'default'} className="text-[11px]"
          startContent={<FiMessageSquare className="text-xs" />}>
          {(c.commentType ?? 'Comment').charAt(0) + (c.commentType ?? 'omment').slice(1).toLowerCase()}
        </Chip>
      </div>
      <p className="mt-2 whitespace-pre-wrap text-sm text-gray-700">{c.content}</p>
    </div>
  );
}
