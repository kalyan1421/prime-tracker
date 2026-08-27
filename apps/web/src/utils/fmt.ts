export function errMsg(err: unknown, fallback: string): string {
  const msg = (err as any)?.response?.data?.message;
  return Array.isArray(msg) ? msg.join(', ') : typeof msg === 'string' ? msg : fallback;
}

export function fmt(n: number | null | undefined): string {
  if (n == null) return '$0';
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 }).format(n);
}

export function fmtPct(n: number | null | undefined): string {
  if (n == null) return '0%';
  return `${n >= 0 ? '+' : ''}${n.toFixed(1)}%`;
}

export function fmtDate(d: string | null | undefined): string {
  if (!d) return '—';
  return new Date(d).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' });
}

/**
 * Month and day, with the year only when it is not the current one.
 *
 * A construction checklist is read at a glance and almost every date on it is this year, so
 * "Sep 1, 2026" spends four characters on something the reader already knows. The year comes
 * back the moment it stops being obvious — a build running past New Year would otherwise
 * show "Dec 20 – Jan 4" with no way to tell which January.
 */
export function fmtDateShort(d: string | null | undefined): string {
  if (!d) return '—';
  const date = new Date(d);
  const sameYear = date.getUTCFullYear() === new Date().getUTCFullYear();
  return date.toLocaleDateString('en-US', {
    month: 'short', day: 'numeric', ...(sameYear ? {} : { year: 'numeric' }), timeZone: 'UTC',
  });
}
