import { Fragment } from 'react';
import { Avatar, Chip, Tooltip } from '@heroui/react';
import { FiChevronDown, FiChevronRight, FiPhoneCall } from 'react-icons/fi';
import { fmtDate } from '../utils/fmt';
import { useCollapsibleGroups } from '../hooks/useCollapsibleGroups';

/**
 * The spreadsheet view, added ALONGSIDE the card list rather than replacing it
 * (client, 2026-09-21). Columns mirror the monday board the team is moving off:
 * Name · Team · Source · VIA · Date · Follow-up · Contact · Status · Building/Unit · Calls.
 *
 * Grouped by project and collapsible, reusing the shared hook rather than a local
 * open/closed map — the same pattern the other long lists on this project settled on.
 */

export interface LeadsGridProps {
  leads: any[];
  statusToken: Record<string, { bg: string; text: string; dot: string }>;
  statusLabels: Record<string, string>;
  sourceLabels: Record<string, string>;
  viaLabels: Record<string, string>;
  selectedId?: string;
  onSelect: (lead: any) => void;
}

function followUpDays(lead: any): number | null {
  if (!lead?.followUpDate) return null;
  const p = String(lead.followUpDate).slice(0, 10).split('-').map(Number);
  if (p.length !== 3 || p.some(Number.isNaN)) return null;
  const due = Date.UTC(p[0], p[1] - 1, p[2]);
  const n = new Date();
  return Math.round((due - Date.UTC(n.getFullYear(), n.getMonth(), n.getDate())) / 86_400_000);
}

const TH = 'px-2 py-1.5 text-left text-[11px] font-semibold text-gray-600 whitespace-nowrap';
const TD = 'px-2 py-1.5 text-xs text-gray-700 whitespace-nowrap';

export function LeadsGrid({
  leads, statusToken, statusLabels, sourceLabels, viaLabels, selectedId, onSelect,
}: LeadsGridProps) {
  // Group by project — the client's board is one board per project, and an ungrouped
  // 600-row sheet is the flat-list problem this codebase has already fixed once.
  const groups = leads.reduce((acc: Record<string, any[]>, l: any) => {
    const key = l.project?.name ?? 'No project';
    (acc[key] ||= []).push(l);
    return acc;
  }, {});
  const groupNames = Object.keys(groups).sort();
  // The shared hook takes reset-deps and answers per key against a caller-supplied
  // default, so groups reopen when the filtered set changes rather than staying
  // collapsed around rows that are no longer there.
  const { isExpanded, toggle } = useCollapsibleGroups([leads.length, groupNames.join('|')]);

  return (
    <div className="overflow-x-auto border border-gray-200 rounded-lg bg-white">
      <table className="w-full border-collapse">
        <thead className="bg-gray-50 border-b border-gray-200">
          <tr>
            <th className={TH}>Name</th>
            <th className={TH}>Team</th>
            <th className={TH}>Source</th>
            <th className={TH}>VIA</th>
            <th className={TH}>Added</th>
            <th className={TH}>Follow-up</th>
            <th className={TH}>Contact</th>
            <th className={TH}>Status</th>
            <th className={TH}>Building / Unit</th>
            <th className={TH}>Campaign</th>
            <th className={`${TH} text-right`}>Calls</th>
          </tr>
        </thead>
        <tbody>
          {groupNames.map((name) => (
            <Fragment key={name}>
              <tr
                className="bg-gray-50/70 border-y border-gray-200 cursor-pointer hover:bg-gray-100"
                onClick={() => toggle(name, isExpanded(name, true))}
              >
                <td colSpan={11} className="px-2 py-1.5">
                  <span className="flex items-center gap-1.5 text-[11px] font-semibold text-gray-700">
                    {isExpanded(name, true)
                      ? <FiChevronDown className="w-3 h-3" aria-hidden="true" />
                      : <FiChevronRight className="w-3 h-3" aria-hidden="true" />}
                    {name}
                    <span className="text-gray-500 tabular-nums">({groups[name].length})</span>
                  </span>
                </td>
              </tr>
              {isExpanded(name, true) && groups[name].map((lead: any) => {
                const t = statusToken[lead.status] ?? statusToken.NEW;
                const fu = followUpDays(lead);
                return (
                  <tr
                    key={lead.id}
                    onClick={() => onSelect(lead)}
                    className={`border-b border-gray-100 cursor-pointer hover:bg-blue-50/40 ${
                      selectedId === lead.id ? 'bg-blue-50' : ''
                    }`}
                  >
                    <td className={`${TD} font-medium text-gray-900 max-w-[14rem] truncate`}>
                      {lead.name || <span className="italic text-gray-500 font-normal">Unnamed</span>}
                    </td>
                    <td className={TD}>
                      {lead.assignedUser ? (
                        <Tooltip content={lead.assignedUser.name}>
                          <Avatar
                            size="sm" name={lead.assignedUser.name} src={lead.assignedUser.avatarUrl}
                            className="w-5 h-5 text-[11px]"
                          />
                        </Tooltip>
                      ) : <span className="text-gray-500">—</span>}
                    </td>
                    <td className={TD}>{sourceLabels[lead.source] || lead.source}</td>
                    <td className={TD}>
                      {lead.via
                        ? <span className="px-1.5 py-0.5 rounded bg-indigo-50 text-indigo-700 text-[11px] font-medium">
                            {viaLabels[lead.via] || String(lead.via).replace(/_/g, ' ')}
                          </span>
                        : <span className="text-gray-500">—</span>}
                    </td>
                    <td className={`${TD} tabular-nums`}>{fmtDate(lead.createdAt)}</td>
                    <td className={`${TD} tabular-nums`}>
                      {fu == null ? <span className="text-gray-500">—</span> : (
                        <span className={
                          fu < 0 ? 'text-rose-700 font-medium'
                            : fu === 0 ? 'text-amber-700 font-medium' : 'text-gray-700'
                        }>
                          {fu < 0 ? `${Math.abs(fu)}d late` : fu === 0 ? 'Today' : fmtDate(lead.followUpDate)}
                        </span>
                      )}
                    </td>
                    <td className={`${TD} max-w-[12rem] truncate`}>
                      {lead.phone || lead.email || <span className="text-gray-500">—</span>}
                    </td>
                    <td className={TD}>
                      <span className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[11px] font-medium ${t.bg} ${t.text}`}>
                        <span className={`inline-block w-1.5 h-1.5 rounded-full ${t.dot}`} aria-hidden="true" />
                        {statusLabels[lead.status] || String(lead.status).replace('_', ' ')}
                      </span>
                    </td>
                    <td className={TD}>
                      {lead.unit ? `Unit ${lead.unit.unitNumber}`
                        : lead.building ? lead.building.name
                        : <span className="text-gray-500">—</span>}
                    </td>
                    <td className={`${TD} max-w-[10rem] truncate`}>
                      {lead.campaign
                        ? <Chip size="sm" variant="flat" color="warning">{lead.campaign.name}</Chip>
                        : <span className="text-gray-500">—</span>}
                    </td>
                    <td className={`${TD} text-right`}>
                      {lead.callCount > 0 ? (
                        <Tooltip content={lead.lastCall
                          ? `Last ${fmtDate(lead.lastCall.occurredAt)}${lead.lastCall.note ? `: ${lead.lastCall.note}` : ''}`
                          : ''}>
                          <span className="inline-flex items-center gap-1 tabular-nums text-gray-700">
                            <FiPhoneCall className="w-3 h-3" aria-hidden="true" />{lead.callCount}
                          </span>
                        </Tooltip>
                      ) : <span className="text-gray-500">—</span>}
                    </td>
                  </tr>
                );
              })}
            </Fragment>
          ))}
        </tbody>
      </table>
    </div>
  );
}
