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
